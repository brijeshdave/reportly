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
  ScheduleGrid,
  Shift,
  SwapRequest,
  UpdateShift,
} from "@reportly/shared";

import { http } from "@/services/http.js";

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

export function fetchSchedule(params: {
  departmentId: string;
  year: number;
  month: number;
}): Promise<ScheduleGrid> {
  return http.get<ScheduleGrid>("/schedules", { query: params });
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
  opts: { counterpartEntryId?: string; noSwap?: boolean } = {},
): Promise<SwapRequest> {
  return http.post<SwapRequest>(`/swaps/${swapId}/decision`, { decision, ...opts });
}

/** Withdraw your own pending request. */
export function cancelSwap(swapId: string): Promise<SwapRequest> {
  return http.post<SwapRequest>(`/swaps/${swapId}/cancel`, {});
}
