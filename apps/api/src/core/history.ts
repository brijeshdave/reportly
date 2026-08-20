// Author: Brijesh Dave <https://github.com/brijeshdave>
// Change history: records a field-level diff (who, when, field, old -> new) for a
// tracked entity. Like auditing, it must never break the mutation it observes.
import type { AuthContext, TrackedEntity } from "@reportly/shared";
import type { FastifyRequest } from "fastify";

import { db } from "@/core/db/index.js";
import { entityHistory } from "@/core/db/schema.js";

/** Fields that change on every write and carry no information for a diff. */
const IGNORED_FIELDS = new Set(["createdAt", "updatedAt"]);

type Snapshot = Record<string, unknown> | null | undefined;

function changedFields(before: Snapshot, after: Snapshot): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter((key) => {
    if (IGNORED_FIELDS.has(key)) return false;
    return JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]);
  });
}

/**
 * Write one history row per changed field. Returns how many rows were written
 * (0 when nothing changed). Never throws into the caller.
 */
export async function trackChanges(
  request: FastifyRequest,
  ctx: Pick<AuthContext, "userId">,
  entityType: TrackedEntity,
  entityId: string,
  before: Snapshot,
  after: Snapshot,
): Promise<number> {
  return recordChanges(entityType, entityId, before, after, ctx.userId, (err) =>
    request.log.warn({ err, entityType, entityId }, "Failed to record entity history"),
  );
}

/**
 * The same diff, for a service that changes something other than the entity its
 * own route is about — filing a journal entry closes the task it logs, and that
 * change belongs in the *task's* history. No request to log through, so the
 * caller says what to do with a failure.
 */
export async function recordChanges(
  entityType: TrackedEntity,
  entityId: string,
  before: Snapshot,
  after: Snapshot,
  actorId: string,
  onError: (err: unknown) => void,
): Promise<number> {
  try {
    const fields = changedFields(before, after);
    if (fields.length === 0) return 0;

    await db.insert(entityHistory).values(
      fields.map((field) => ({
        entityType,
        entityId,
        field,
        oldValue: (before?.[field] ?? null) as unknown,
        newValue: (after?.[field] ?? null) as unknown,
        actorId,
      })),
    );
    return fields.length;
  } catch (err) {
    onError(err);
    return 0;
  }
}
