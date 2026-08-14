// Author: Brijesh Dave <https://github.com/brijeshdave>
// Downtime — the second clock. Raised from a report against something that report is
// about; an entry with no end time is still running and shows in the pending queue
// until somebody closes it.
import type {
  CreateDowntime,
  DowntimeEntry,
  DowntimeTotal,
  UpdateDowntime,
} from "@reportly/shared";

import { http } from "@/services/http.js";

/** The downtime raised from one report. */
export const fetchReportDowntime = (reportId: string) =>
  http.get<DowntimeEntry[]>(`/journal/${reportId}/downtime`);

/** Outages still running — the queue of entries waiting to be closed. */
export const fetchPendingDowntime = () => http.get<DowntimeEntry[]>("/downtime/pending");

/** Total minutes down per thing, worst first. Open outages count up to now. */
export const fetchDowntimeTotals = () => http.get<DowntimeTotal[]>("/downtime/totals");

export const createDowntime = (input: CreateDowntime) =>
  http.post<DowntimeEntry>("/downtime", input);

/** Filling in `endedAt` is how an entry is closed. */
export const updateDowntime = (id: string, input: UpdateDowntime) =>
  http.patch<DowntimeEntry>(`/downtime/${id}`, input);

export const deleteDowntime = (id: string) => http.delete<void>(`/downtime/${id}`);
