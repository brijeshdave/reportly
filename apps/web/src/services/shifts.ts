// Author: Brijesh Dave <https://github.com/brijeshdave>
// Shift catalogue service calls. Shifts are company-wide definitions the schedules
// are built on, so the list is small and unpaginated — fetched whole for the page
// and the schedule pickers alike.
import type {
  AssignEntry,
  BulkAssign,
  CreateShift,
  CreateSchedule,
  CreateSwapRequest,
  Schedule,
  ScheduleEntry,
  MyEntry,
  ScheduleGrid,
  Shift,
  SwapRequest,
  UpdateShift,
} from "@reportly/shared";

import { download, http } from "@/services/http.js";

export function fetchShifts(): Promise<Shift[]> {
  return http.get<Shift[]>("/shifts");
}

export function fetchShift(id: string): Promise<Shift> {
  return http.get<Shift>(`/shifts/${id}`);
}

export function createShift(input: CreateShift): Promise<Shift> {
  return http.post<Shift>("/shifts", input);
}

export function updateShift(id: string, input: UpdateShift): Promise<Shift> {
  return http.patch<Shift>(`/shifts/${id}`, input);
}

export function deleteShift(id: string): Promise<void> {
  return http.delete<void>(`/shifts/${id}`);
}

// --- schedules (the calendar) ---

/** Omit `locationId` for the department's central rota — the travelling staff. */
export function fetchSchedule(params: {
  departmentId: string;
  locationId?: string;
  year: number;
  month: number;
}): Promise<ScheduleGrid> {
  return http.get<ScheduleGrid>("/schedules", { query: params });
}

/**
 * Your own cells in a department for a month, across every rota it has. The
 * shift-change form is built from these: you know the day you want changed, not
 * which of the department's rotas that day sits on.
 */
export function fetchMyEntries(params: {
  departmentId: string;
  year: number;
  month: number;
}): Promise<MyEntry[]> {
  return http.get<MyEntry[]>("/schedules/my-entries", { query: params });
}

export function createSchedule(input: CreateSchedule): Promise<Schedule> {
  return http.post<Schedule>("/schedules", input);
}

export function assignEntry(scheduleId: string, input: AssignEntry): Promise<ScheduleEntry> {
  return http.post<ScheduleEntry>(`/schedules/${scheduleId}/assign`, input);
}

export function clearEntry(scheduleId: string, entryId: string): Promise<void> {
  return http.delete<void>(`/schedules/${scheduleId}/entries/${entryId}`);
}

export function bulkAssign(scheduleId: string, input: BulkAssign): Promise<{ count: number }> {
  return http.post<{ count: number }>(`/schedules/${scheduleId}/assign-bulk`, input);
}

export function publishSchedule(scheduleId: string): Promise<Schedule> {
  return http.post<Schedule>(`/schedules/${scheduleId}/publish`, {});
}

export function lockSchedule(scheduleId: string): Promise<Schedule> {
  return http.post<Schedule>(`/schedules/${scheduleId}/lock`, {});
}

/** Head of Department only — the API refuses anyone else. */
export function unlockSchedule(scheduleId: string): Promise<Schedule> {
  return http.post<Schedule>(`/schedules/${scheduleId}/unlock`, {});
}

// --- swaps ---

export function requestSwap(scheduleId: string, input: CreateSwapRequest): Promise<SwapRequest> {
  return http.post<SwapRequest>(`/schedules/${scheduleId}/swaps`, input);
}

export function fetchSwaps(box: "inbox" | "mine" | "handled"): Promise<SwapRequest[]> {
  return http.get<SwapRequest[]>("/swaps", { query: { box } });
}

export function decideSwap(
  swapId: string,
  decision: "approve" | "reject",
  opts: {
    counterpartEntryId?: string;
    noSwap?: boolean;
    /** Allow a counterpart on another site's rota — refused without it, and the
     *  reason travels with the decision. */
    allowCrossSite?: boolean;
    crossSiteReason?: string;
  } = {},
): Promise<SwapRequest> {
  return http.post<SwapRequest>(`/swaps/${swapId}/decision`, { decision, ...opts });
}

/** Withdraw your own pending request. */
export function cancelSwap(swapId: string): Promise<SwapRequest> {
  return http.post<SwapRequest>(`/swaps/${swapId}/cancel`, {});
}

/**
 * The month roster as a file. `xlsx` for a spreadsheet, `html` for the printable A4
 * landscape page — which is also how a PDF is made here: open it and print to PDF,
 * rather than carrying a headless browser in the server image to do it for you.
 */
export function exportSchedule(
  query: { departmentId: string; locationId?: string; year: number; month: number },
  format: "xlsx" | "html",
): Promise<void> {
  const stamp = `${query.year}-${String(query.month).padStart(2, "0")}`;
  return download(`/schedules/export`, `roster-${stamp}.${format}`, {
    query: { ...query, format },
  });
}
