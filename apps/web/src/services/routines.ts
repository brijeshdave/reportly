// Author: Brijesh Dave <https://github.com/brijeshdave>
// Routine calls: the definitions a manager owns, the occurrences a member completes,
// and the log that records the times the work was done.
import type {
  CreateRoutine,
  Routine,
  RoutineCompletion,
  RoutineOccurrence,
  UpdateRoutine,
} from "@reportly/shared";

import { http } from "@/services/http.js";

/** Unpaged: My Routines groups the whole week by cadence. The team table pages. */
export const fetchAssignedRoutines = () => http.get<Routine[]>("/routines");
export const fetchRoutine = (id: string) => http.get<Routine>(`/routines/${id}`);
export const createRoutine = (input: CreateRoutine) => http.post<Routine>("/routines", input);
export const updateRoutine = (id: string, input: UpdateRoutine) =>
  http.patch<Routine>(`/routines/${id}`, input);
export const deleteRoutine = (id: string) => http.delete<void>(`/routines/${id}`);

export const fetchMyOccurrences = (from: string, to: string) =>
  http.get<RoutineOccurrence[]>("/routines/occurrences", { query: { from, to } });
export const fetchRoutineOccurrences = (id: string, from: string, to: string) =>
  http.get<RoutineOccurrence[]>(`/routines/${id}/occurrences`, { query: { from, to } });

/** Log a completion with the times the person entered (start optional, finish required). */
export const finishOccurrence = (
  id: string,
  date: string,
  input: { startedAt?: string; finishedAt: string; notes?: string },
) => http.post<RoutineCompletion>(`/routines/${id}/occurrences/${date}/finish`, input);

/** Award a month's routine points into the leaderboard (idempotent). */
export const awardRoutineMonth = (year: number, month: number) =>
  http.post<{ count: number; points: number }>("/routines/award", {}, { query: { year, month } });
