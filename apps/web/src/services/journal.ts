// Author: Brijesh Dave <https://github.com/brijeshdave>
// JournalEntry and scoring calls. Reports are scoped by the active company (the header
// the http client attaches). The detail comes back with its scoring grid already
// filtered for the caller — the review, and the official figure, are hidden from
// anyone at or below the worker being scored.
import type {
  AwaitingReview,
  CreateJournalEntry,
  CreateWorkLog,
  WorkLog,
  PendingAppraisal,
  PointsSummary,
  JournalEntry,
  JournalScore,
  ScoreEvent,
  SetScores,
  UpdateJournalEntry,
} from "@reportly/shared";

import { http } from "@/services/http.js";

export type JournalEntryDetail = JournalEntry & {
  scores: JournalScore[];
  canChangeStatus: boolean;
  /** Whether you may edit it — follows whoever holds the entry, not who filed it. */
  canEdit: boolean;
  /** Whether this caller may re-open it (clearing its scores). */
  canReopen: boolean;
  /** Whether this caller may see the points-change history (blind upward, like the review). */
  canSeePointsHistory: boolean;
  /** Which scoring column this caller may fill: their self split, the review, or none. */
  myScoreTier: "self" | "review" | null;
  /** Who will score it — the author's reporting manager, or null when nobody is set. */
  reviewer: { id: string; name: string } | null;
  /** The most this entry may pay, set by its severity. */
  pointsCeiling: number;
};

export function fetchReport(id: string): Promise<JournalEntryDetail> {
  return http.get<JournalEntryDetail>(`/journal/${id}`);
}

/** The points-change history — who changed whose points, when, old → new. Blind upward. */
export function fetchScoreEvents(id: string): Promise<ScoreEvent[]> {
  return http.get<ScoreEvent[]>(`/journal/${id}/score-events`);
}

export function createReport(input: CreateJournalEntry): Promise<JournalEntry> {
  return http.post<JournalEntry>("/journal", input);
}

/**
 * Move a report along its workflow. Its own call, not part of `updateReport`,
 * because it is allowed on a report whose content has been locked by appraisal —
 * the lock freezes the work, and a status is not the work.
 */
export function changeReportStatus(id: string, statusId: string | null): Promise<JournalEntry> {
  return http.patch<JournalEntry>(`/journal/${id}/status`, { statusId });
}

/** What was done on an entry, oldest first. */
export function fetchWorkLogs(reportId: string): Promise<WorkLog[]> {
  return http.get<WorkLog[]>(`/journal/${reportId}/work`);
}

export function addWorkLog(reportId: string, input: CreateWorkLog): Promise<WorkLog> {
  return http.post<WorkLog>(`/journal/${reportId}/work`, input);
}

export function updateWorkLog(logId: string, input: CreateWorkLog): Promise<WorkLog> {
  return http.patch<WorkLog>(`/journal/work/${logId}`, input);
}

export function removeWorkLog(logId: string): Promise<void> {
  return http.delete<void>(`/journal/work/${logId}`);
}

export function updateReport(id: string, input: UpdateJournalEntry): Promise<JournalEntry> {
  return http.patch<JournalEntry>(`/journal/${id}`, input);
}

export function reopenReport(id: string): Promise<JournalEntry> {
  return http.post<JournalEntry>(`/journal/${id}/reopen`);
}

/** Reject a report filed by your downline — clears its points. Un-reject to allow scoring. */
export function rejectReport(id: string, reason?: string): Promise<JournalEntry> {
  return http.post<JournalEntry>(`/journal/${id}/reject`, { reason });
}

export function unrejectReport(id: string): Promise<JournalEntry> {
  return http.post<JournalEntry>(`/journal/${id}/unreject`);
}

export function deleteReport(id: string): Promise<void> {
  return http.delete<void>(`/journal/${id}`);
}

/** Score a resolved report's workers in points; returns the grid the caller may see.
 *  The tier — your self split or the management review — follows from who you are. */
export function setScores(id: string, input: SetScores): Promise<JournalScore[]> {
  return http.put<JournalScore[]>(`/journal/${id}/scores`, input);
}

/** Resolved reports in your downline awaiting your review. */
export function fetchPending(): Promise<PendingAppraisal[]> {
  return http.get<PendingAppraisal[]>("/journal/pending");
}

/** Your own entries nobody above you has scored yet — the mirror of the above. */
export function fetchAwaitingReview(): Promise<AwaitingReview[]> {
  return http.get<AwaitingReview[]>("/journal/awaiting-review");
}

/** Your points: your own reports, plus what rolled up from your downline. */
export function fetchMyPoints(): Promise<PointsSummary> {
  return http.get<PointsSummary>("/journal/points");
}
