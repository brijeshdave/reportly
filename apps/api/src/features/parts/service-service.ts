// Author: Brijesh Dave <https://github.com/brijeshdave>
// Recording a refill or a repair, and taking the points back when the part comes
// straight back faulty.
//
// The reversal is the only genuinely subtle rule in this module. Everything else
// is a state machine; this one has to decide *which* service a failure blames,
// and make sure it blames it once.
import {
  ERROR_CODES,
  type RecordService,
  type ServiceConsumption,
  type ServiceEvent,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { notify } from "@/core/queue/notifications.js";
import {
  consumablesByIds,
  consumablesForKind,
  getServiceKind,
  rateFor,
} from "@/features/parts/catalogue-repo.js";
import { moduleSettings } from "@/features/parts/module.js";
import * as partsRepo from "@/features/parts/parts-repo.js";
import * as repo from "@/features/parts/service-repo.js";

const iso = (d: Date) => d.toISOString();

async function toServiceEvent(row: repo.ServiceEventRow): Promise<ServiceEvent> {
  const lines = await repo.consumptionsFor(row.id);
  return {
    id: row.id,
    partId: row.partId,
    serviceKindId: row.serviceKindId,
    serviceKindName: row.serviceKindName,
    performedByName: row.performedByName,
    performedAt: iso(row.performedAt),
    notes: row.notes,
    points: row.points,
    pointsReversedAt: row.pointsReversedAt ? iso(row.pointsReversedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    consumptions: lines.map((line): ServiceConsumption => ({
      consumableId: line.consumableId,
      consumableName: line.consumableName,
      unit: line.unit === "g" ? "g" : line.unit === "ml" ? "ml" : "ea",
      quantity: line.quantity,
    })),
  };
}

export async function serviceHistory(partId: string, companyId: string): Promise<ServiceEvent[]> {
  const part = await partsRepo.getPart(partId, companyId);
  if (!part) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Part not found");
  return Promise.all((await repo.eventsFor(partId, companyId)).map(toServiceEvent));
}

/**
 * Record a refill or repair.
 *
 * Refused on a part that is **installed** — servicing one sitting inside a
 * machine would mean either it was not really serviced, or it was and nobody
 * booked it back in, and both leave the history saying something untrue — and on
 * one that is **scrapped**, which is the end state.
 *
 * Allowed on anything on a shelf, whether it is waiting for work or already
 * ready. Requiring "awaiting service" would refuse the commonest refill of all —
 * the first one, on a cartridge just registered — and topping up one already
 * ready is somebody's business, not ours.
 *
 * The rate is resolved from the model and kind rather than passed in, so what the
 * screen shows and what the ledger pays cannot differ.
 */
export async function recordService(
  partId: string,
  companyId: string,
  userId: string,
  input: RecordService,
): Promise<ServiceEvent> {
  const part = await partsRepo.getPart(partId, companyId);
  if (!part) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Part not found");
  if (part.status === "installed" || part.status === "scrapped") {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      part.status === "installed"
        ? "Book the part back in before servicing it — it is still in a machine."
        : "A scrapped part cannot be serviced.",
    );
  }

  const kind = await getServiceKind(input.serviceKindId, companyId);
  if (!kind) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Service kind not found");
  if (kind.status !== "active") {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, `"${kind.name}" is no longer offered`);
  }

  // Every consumable named has to be this company's. Otherwise a line could point
  // at another tenant's catalogue and read back as their name.
  const ids = input.consumptions.map((line) => line.consumableId);
  const known = await consumablesByIds(ids, companyId);
  const stranger = ids.find((id) => !known.has(id));
  if (stranger) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That consumable does not exist here");
  }

  await enforceKindRules(kind.name, input.serviceKindId, companyId, input.consumptions);

  const points = await rateFor(part.partModelId, input.serviceKindId, companyId);
  const performedAt = input.performedAt ? new Date(input.performedAt) : new Date();

  const id = await repo.insertService(companyId, {
    partId,
    serviceKindId: input.serviceKindId,
    performedBy: userId,
    performedAt,
    notes: input.notes ?? null,
    points,
    // No department: a part belongs to a company, not a department, so its points
    // land on the company standings rather than being credited to a team that did
    // not necessarily do the work.
    departmentId: null,
    consumptions: input.consumptions,
  });

  // Serviced means exactly that: ready to go out again, and one more cycle old.
  // This is the only transition into `ready` besides restocking one that came
  // off working, which is what makes "ready" mean something.
  await partsRepo.incrementCycleCount(partId, companyId);
  await partsRepo.updatePart(partId, companyId, { status: "ready" });

  // Said once, on the service that crosses the line — not on every service after
  // it. A message repeated every refill for the rest of a part's life is one
  // people learn to ignore, which is the opposite of what an advisory is for.
  // Comparing both sides of the increment also covers a limit lowered later: the
  // first service after the change crosses it.
  const limit = part.cycleLimit;
  if (limit !== null && part.cycleCount < limit && part.cycleCount + 1 >= limit) {
    await notify({
      type: "part.over-cycle-limit",
      companyId,
      actorUserId: userId,
      title: `${part.identifier} has passed its rated cycles`,
      body: `${part.partModelName} is rated for ${limit} services and this one has had ${part.cycleCount + 1}. Worth a look before it goes out again.`,
      link: `/cartridges/${partId}`,
      entityKind: "part",
      entityId: partId,
    });
  }

  return toServiceEvent((await repo.getEvent(id, companyId))!);
}

/**
 * What this kind of service may consume, and how much.
 *
 * Enforced here rather than left to the form. The screen offers the right ones,
 * but a rule that only the browser knows is one a second client — or a stale tab
 * — does not, and a refill recorded with a drum is a record that is not true.
 *
 * A kind with no rules is unrestricted, which is what every kind created before
 * this existed looks like. That is deliberate: the feature narrows what a kind
 * can do, and narrowing nothing is the honest starting point.
 */
async function enforceKindRules(
  kindName: string,
  serviceKindId: string,
  companyId: string,
  lines: { consumableId: string; quantity: number }[],
): Promise<void> {
  const rules = await consumablesForKind(serviceKindId);
  if (rules.length === 0) return;

  // Names for the rules as well as the lines: the "needs at least one" message
  // is about a consumable the caller did NOT send, so its name is not among the
  // ones already looked up.
  const names = await consumablesByIds(
    [...new Set([...rules.map((rule) => rule.consumableId), ...lines.map((l) => l.consumableId)])],
    companyId,
  );
  const nameOf = (id: string) => names.get(id)?.name ?? "that consumable";
  const allowed = new Map(rules.map((rule) => [rule.consumableId, rule]));

  for (const line of lines) {
    const rule = allowed.get(line.consumableId);
    if (!rule) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        `A ${kindName} does not use ${nameOf(line.consumableId)}.`,
      );
    }
    if (rule.maxQuantity !== null && line.quantity > rule.maxQuantity) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        `A ${kindName} uses at most ${rule.maxQuantity} ${nameOf(line.consumableId)}.`,
      );
    }
  }

  // And the other direction: a refill that used no toner did not happen.
  for (const rule of rules) {
    if (rule.minQuantity <= 0) continue;
    const used = lines
      .filter((line) => line.consumableId === rule.consumableId)
      .reduce((sum, line) => sum + line.quantity, 0);
    if (used < rule.minQuantity) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        `A ${kindName} needs at least ${rule.minQuantity} ${nameOf(rule.consumableId)}.`,
      );
    }
  }
}

/**
 * The points consequence of a part coming back faulty.
 *
 * Called by the return path, and deliberately quiet: it returns what it did
 * rather than throwing, because a failed reversal must never stop a technician
 * booking a part back in. The return is the fact; the points are bookkeeping.
 *
 * Three conditions, all of which have to hold:
 *
 *   - the tour ended `faulty`
 *   - it lasted no longer than the company's window. Outside that, the part wore
 *     out rather than the service being wrong, and docking somebody months later
 *     for a cartridge that ran dry is how a scheme stops being trusted
 *   - a service preceded that tour and has not already been reversed
 */
export async function reverseIfFailedInWindow(
  part: { id: string; identifier: string },
  companyId: string,
  actorUserId: string,
  placement: { installedAt: Date; removedAt: Date; outcome: string | null },
): Promise<{ reversed: boolean; serviceEventId?: string }> {
  if (placement.outcome !== "faulty") return { reversed: false };

  const { failureWindowDays } = await moduleSettings(companyId);
  const lastedMs = placement.removedAt.getTime() - placement.installedAt.getTime();
  if (lastedMs > failureWindowDays * 24 * 60 * 60 * 1000) return { reversed: false };

  // The service that sent it out — the one before it went in. A service recorded
  // after it came out cannot be what made it fail.
  const culprit = await repo.lastServiceBefore(part.id, companyId, placement.installedAt);
  if (!culprit) return { reversed: false };

  const reversed = await repo.reverseService(culprit.id, companyId);

  if (reversed && culprit.performedBy) {
    // Told, rather than left to be noticed. If the technician booked the part in
    // themselves the audience drops them as the actor — which is right, because
    // the response they just got said so on the screen in front of them.
    await notify({
      type: "part.points-reversed",
      companyId,
      actorUserId,
      userIds: [culprit.performedBy],
      title: `${culprit.points} points taken back for ${part.identifier}`,
      body: `The ${culprit.serviceKindName.toLowerCase()} you recorded came back faulty within ${failureWindowDays} days.`,
      link: `/cartridges/${part.id}`,
      entityKind: "part",
      entityId: part.id,
    });
  }

  return { reversed, serviceEventId: culprit.id };
}
