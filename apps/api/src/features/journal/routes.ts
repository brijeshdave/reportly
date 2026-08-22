// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reports and appraisals. Reading and filing are broad (everyone reports);
// appraising a subordinate needs reports:appraise, enforced in the service so the
// author can still self-appraise. Authorship (not a blanket update permission) is
// what lets someone edit or delete their own report.
import {
  ERROR_CODES,
  PERMISSIONS,
  createJournalEntrySchema,
  listQuerySchema,
  paginatedResult,
  assignJournalEntrySchema,
  changeStatusSchema,
  awaitingReviewSchema,
  pendingAppraisalSchema,
  pointsSummarySchema,
  journalHandoverSchema,
  createWorkLogSchema,
  journalParticipantSchema,
  updateWorkLogSchema,
  workLogSchema,
  journalScoreSchema,
  setParticipantsSchema,
  setScoresSchema,
  recurrenceLinkSchema,
  rejectReportSchema,
  scoreEventSchema,
  journalEntryRowSchema,
  journalTimelineSchema,
  toPaginatedResult,
  journalEntrySchema,
  updateJournalEntrySchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { trackChanges } from "@/core/history.js";
import { AppError } from "@/core/errors.js";
import * as journal from "@/features/journal/service.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";

const idParams = z.object({ id: z.guid() });
const reportWithScores = journalEntrySchema.extend({
  /** The scoring grid, as this caller may see it — the review is blind upward. */
  scores: z.array(journalScoreSchema),
  /** Whether *this* caller may move the report along — see the service. */
  canChangeStatus: z.boolean(),
  /** Whether *this* caller may re-open it (clearing its scores). */
  canReopen: z.boolean(),
  /** Whether *this* caller may see the points-change history (blind upward, like the review). */
  canSeePointsHistory: z.boolean(),
  /** Which scoring column this caller may fill: their self split, the review, or none. */
  myScoreTier: z.enum(["self", "review"]).nullable(),
});

function activeCompany(companyId: string | null): string {
  if (!companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  return companyId;
}

export async function journalRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  // Registered before /journal/:id so "pending"/"points" are not read as ids.
  app.get(
    "/journal/pending",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Resolved reports in your downline awaiting your review",
        response: { 200: z.array(pendingAppraisalSchema) },
      },
    },
    async (request) => journal.pendingAppraisals(request.ctx!),
  );

  app.get(
    "/journal/awaiting-review",
    {
      // `journal:read`, not `journal:appraise` — this is your OWN work, and the
      // people who most need to see it waiting are the ones who cannot appraise.
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Your own entries that nobody above you has scored yet",
        description:
          "The mirror of `/journal/pending`: that is what somebody owes you, this is what you " +
          "are owed. `reviewerName` is the manager on your reporting line, or null when none " +
          "is set — which is a real state and worth saying rather than hiding.",
        response: { 200: z.array(awaitingReviewSchema) },
      },
    },
    async (request) => journal.awaitingReview(request.ctx!),
  );

  app.get(
    "/journal/points",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Your points — your own reports, plus what rolled up from your downline",
        response: { 200: pointsSummarySchema },
      },
    },
    async (request) => journal.myPoints(request.ctx!),
  );

  // The roll-up read. Lives here, not under Assets, because what it returns is a
  // page of reports and it obeys the same visibility rules as every other one.
  app.get(
    "/assets/:id/journal",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary:
          "Reports scoped to an asset, anything below it, or the devices that live at any of them",
        params: idParams,
        querystring: listQuerySchema,
        response: { 200: paginatedResult(journalEntryRowSchema) },
      },
    },
    async (request) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const query = await resolveListQuery(request.query, request.authUserId);
      const { rows, total } = await journal.listReportsUnderAsset(
        request.params.id,
        companyId,
        query,
        request.ctx!,
      );
      return toPaginatedResult(rows, total, query);
    },
  );

  app.get(
    "/journal",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Reports you may see: your own, and your downline's submitted ones",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(journalEntryRowSchema) },
      },
    },
    async (request) => {
      const query = await resolveListQuery(request.query, request.authUserId);
      const { rows, total } = await journal.listReports(query, request.ctx!);
      return toPaginatedResult(rows, total, query);
    },
  );

  app.post(
    "/journal",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_CREATE),
      schema: {
        tags: ["Journal"],
        summary: "File a report (draft or submitted)",
        body: createJournalEntrySchema,
        response: { 201: journalEntrySchema },
      },
    },
    async (request, reply) => {
      const companyId = activeCompany(request.ctx!.companyId);
      const report = await journal.createReport(request.ctx!, companyId, request.body);
      await recordAudit(request, request.ctx!, {
        action: "journal.create",
        details: { reportId: report.id, state: report.state },
      });
      reply.status(201);
      return report;
    },
  );

  app.get(
    "/journal/:id",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "A report with its scoring grid (the review is hidden below the reviewer)",
        params: idParams,
        response: { 200: reportWithScores },
      },
    },
    async (request) => journal.getReport(request.params.id, request.ctx!),
  );

  // Both of these are gated on reports:read, not analytics:view: they are facts
  // about one report you can already open, not an aggregate across everyone's.
  // The service applies the same visibility rule as GET /journal/:id.
  app.get(
    "/journal/:id/timeline",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "A report's status history, and the response/resolution times it implies",
        description:
          "Times are derived from the events, never stored. A report reopened after being resolved reports " +
          "`resolvedAt: null` — it is open now — and carries `reopened: true` so a reader knows the resolution " +
          "time spans more than one cycle.",
        params: idParams,
        response: { 200: journalTimelineSchema },
      },
    },
    async (request) => journal.getTimeline(request.params.id, request.ctx!),
  );

  app.get(
    "/journal/:id/recurrences",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "The other reports in this one's recurrence chain",
        description:
          "Walks `recurrenceOf` in both directions, so a report in the middle of a chain sees the whole story. " +
          "Each link is filtered through the caller's own visibility, so the count can be lower than the truth.",
        params: idParams,
        response: { 200: z.array(recurrenceLinkSchema) },
      },
    },
    async (request) => journal.getRecurrences(request.params.id, request.ctx!),
  );

  app.patch(
    "/journal/:id/status",
    {
      // Gated on read, with the service enforcing who may drive it — the author,
      // the assignee, or someone above them. Deliberately usable on a locked
      // report: the lock freezes the *work* so a mark cannot end up describing
      // something that changed, and a status is not the work.
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Move a report to another status",
        description:
          "Legal moves come from the status catalogue's own group/terminal flags rather than a fixed " +
          "map, so they hold for statuses an admin adds later: freely among the open states, from any " +
          "open state to any finished one, and from finished back to open (a re-open). Finished " +
          "straight to finished is refused — re-open first, so the record shows both.",
        params: idParams,
        body: changeStatusSchema,
        response: { 200: journalEntrySchema },
      },
    },
    async (request) => {
      const report = await journal.changeStatus(
        request.params.id,
        request.body.statusId,
        request.ctx!,
      );
      await recordAudit(request, request.ctx!, {
        action: "journal.status",
        details: { reportId: request.params.id, statusId: request.body.statusId },
      });
      return report;
    },
  );

  app.post(
    "/journal/:id/assign",
    {
      // Gated on read, with the service enforcing the reporting-line rule — the
      // same shape as editing. Handing work over is not a separate privilege from
      // being able to see the work.
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Hand a report to somebody, or put it down",
        description:
          "You may assign to yourself or anyone below you in the reporting line. `assigneeId: null` " +
          "returns it to nobody, which is a real state — work can be put down before the next person " +
          "picks it up. Every change appends to the handover trail.",
        params: idParams,
        body: assignJournalEntrySchema,
        response: { 200: journalEntrySchema },
      },
    },
    async (request) => {
      const report = await journal.assignReport(request.params.id, request.body, request.ctx!);
      await recordAudit(request, request.ctx!, {
        action: "journal.assign",
        details: { reportId: request.params.id, assigneeId: request.body.assigneeId },
      });
      return report;
    },
  );

  app.get(
    "/journal/:id/handovers",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Every time this report changed hands",
        params: idParams,
        response: { 200: z.array(journalHandoverSchema) },
      },
    },
    async (request) => journal.listHandovers(request.params.id, request.ctx!),
  );

  // --- the work timeline ---
  app.get(
    "/journal/:id/work",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "What was done on this entry, item by item, oldest first",
        params: idParams,
        response: { 200: z.array(workLogSchema) },
      },
    },
    async (request) => journal.listWorkLogs(request.params.id, request.ctx!),
  );

  app.post(
    "/journal/:id/work",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Log a piece of work you did on this entry",
        params: idParams,
        body: createWorkLogSchema,
        response: { 201: workLogSchema },
      },
    },
    async (request, reply) => {
      const log = await journal.addWorkLog(request.params.id, request.body, request.ctx!);
      await recordAudit(request, request.ctx!, { action: "journal.work.log", after: log });
      reply.status(201);
      return log;
    },
  );

  app.patch(
    "/journal/work/:id",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Correct a piece of work you logged",
        params: idParams,
        body: updateWorkLogSchema,
        response: { 200: workLogSchema },
      },
    },
    async (request) => journal.updateWorkLog(request.params.id, request.body, request.ctx!),
  );

  app.delete(
    "/journal/work/:id",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Remove a piece of work you logged",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await journal.removeWorkLog(request.params.id, request.ctx!);
      reply.status(204);
      return null;
    },
  );

  app.get(
    "/journal/:id/participants",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Who worked on this report, besides whoever filed it",
        params: idParams,
        response: { 200: z.array(journalParticipantSchema) },
      },
    },
    async (request) => journal.listParticipants(request.params.id, request.ctx!),
  );

  app.put(
    "/journal/:id/participants",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Record who worked on this report — the membership",
        description:
          "This is who took part, not how the points divide — points are scored separately once the " +
          "report is resolved (see /journal/:id/scores). Editable any time; dropping somebody who was " +
          "already scored drops their score too.",
        params: idParams,
        body: setParticipantsSchema,
        response: { 200: z.array(journalParticipantSchema) },
      },
    },
    async (request) =>
      journal.setReportParticipants(request.params.id, request.body.participants, request.ctx!),
  );

  // Editing and deleting are authorship-based, so gated on read (everyone who
  // reports has it) with the service enforcing "author only".
  app.patch(
    "/journal/:id",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Edit your report, or submit a draft. Refused once it is appraised (locked).",
        params: idParams,
        body: updateJournalEntrySchema,
        response: { 200: journalEntrySchema },
      },
    },
    async (request) => {
      const before = await journal.getReport(request.params.id, request.ctx!);
      const report = await journal.updateReport(request.params.id, request.ctx!, request.body);
      await recordAudit(request, request.ctx!, {
        action: "journal.update",
        details: { reportId: report.id },
      });
      await trackChanges(request, request.ctx!, "reports", report.id, before, report);
      return report;
    },
  );

  app.post(
    "/journal/:id/reopen",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Re-open a locked report for editing (author or a manager above)",
        params: idParams,
        response: { 200: journalEntrySchema },
      },
    },
    async (request) => {
      const report = await journal.reopenReport(request.params.id, request.ctx!);
      await recordAudit(request, request.ctx!, {
        action: "journal.reopen",
        details: { reportId: report.id },
      });
      return report;
    },
  );

  app.post(
    "/journal/:id/reject",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_REJECT),
      schema: {
        tags: ["Journal"],
        summary: "Reject a report filed by your downline — strikes its points",
        params: idParams,
        body: rejectReportSchema,
        response: { 200: journalEntrySchema },
      },
    },
    async (request) => {
      const report = await journal.rejectReport(
        request.params.id,
        request.ctx!,
        request.body.reason ?? null,
      );
      await recordAudit(request, request.ctx!, {
        action: "journal.reject",
        details: { reportId: report.id, reason: request.body.reason ?? null },
      });
      return report;
    },
  );

  app.post(
    "/journal/:id/unreject",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_REJECT),
      schema: {
        tags: ["Journal"],
        summary: "Lift a rejection so the report may be scored again",
        params: idParams,
        response: { 200: journalEntrySchema },
      },
    },
    async (request) => {
      const report = await journal.unrejectReport(request.params.id, request.ctx!);
      await recordAudit(request, request.ctx!, {
        action: "journal.unreject",
        details: { reportId: report.id },
      });
      return report;
    },
  );

  app.delete(
    "/journal/:id",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Delete your report",
        params: idParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await journal.deleteReport(request.params.id, request.ctx!);
      await recordAudit(request, request.ctx!, {
        action: "journal.delete",
        details: { reportId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );

  app.get(
    "/journal/:id/scores",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "The scoring grid for a report (the review is hidden below the reviewer)",
        params: idParams,
        response: { 200: z.array(journalScoreSchema) },
      },
    },
    async (request) => journal.getScores(request.params.id, request.ctx!),
  );

  app.get(
    "/journal/:id/score-events",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "The points-change history for a report (who changed what, when) — blind upward",
        params: idParams,
        response: { 200: z.array(scoreEventSchema) },
      },
    },
    async (request) => journal.getScoreEvents(request.params.id, request.ctx!),
  );

  // The tier follows from who the caller is — the author writes the self split, a
  // manager above writes the review (which needs reports:appraise). The service
  // decides, so the route only needs read.
  app.put(
    "/journal/:id/scores",
    {
      preHandler: guard(PERMISSIONS.JOURNAL_READ),
      schema: {
        tags: ["Journal"],
        summary: "Score a resolved report's workers in points (0.5 steps); re-freezes the ledger",
        description:
          "Whether this writes the self split or the management review follows from the caller's place " +
          "in the reporting line. Everyone scored must already be on the report. The first score locks " +
          "the report's content; re-opening it clears every score.",
        params: idParams,
        body: setScoresSchema,
        response: { 200: z.array(journalScoreSchema) },
      },
    },
    async (request) => {
      const scores = await journal.setScores(request.params.id, request.ctx!, request.body);
      await recordAudit(request, request.ctx!, {
        action: "journal.score",
        details: { reportId: request.params.id },
      });
      return scores;
    },
  );
}
