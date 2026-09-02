// Author: Brijesh Dave <https://github.com/brijeshdave>
// Tasks — work handed to somebody. The list is scoped by the server to your own
// plate, what you handed out, and your downline's; there is no "all tasks" call.
// The list itself goes through `useListResource` like every other table — it owns
// the paging, sorting and filtering. Only the single-record calls live here.
import type {
  CreateTask,
  HandoverTask,
  Task,
  TaskPrefill,
  TaskRow,
  UpdateTask,
} from "@reportly/shared";

import { http } from "@/services/http.js";

export const fetchTask = (id: string) => http.get<Task>(`/tasks/${id}`);

/** Open tasks you assigned to others — the manager's "To review" oversight list. */
export const fetchAssignedOpenTasks = () => http.get<TaskRow[]>("/tasks/assigned-open");

export const createTask = (input: CreateTask) => http.post<Task>("/tasks", input);

export const updateTask = (id: string, input: UpdateTask) =>
  http.patch<Task>(`/tasks/${id}`, input);

export const deleteTask = (id: string) => http.delete<void>(`/tasks/${id}`);

/** Hand a task from one person to another part-way through. Not a re-assignment:
 *  the outgoing person stays on the task so the points can be divided. */
export const handoverTask = (id: string, input: HandoverTask) =>
  http.post<Task>(`/tasks/${id}/handover`, input);

/**
 * What the report editor opens with when you complete a task. Fetched rather than
 * assembled here: the server builds it from the task, so the link cannot be pointed
 * at somebody else's work.
 */
export const fetchTaskPrefill = (id: string) => http.get<TaskPrefill>(`/tasks/${id}/prefill`);
