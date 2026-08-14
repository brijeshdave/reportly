// Author: Brijesh Dave <https://github.com/brijeshdave>
// A task — a piece of work handed to somebody, before it is work that has been done.
//
// The pairing with reports is the point of this: a task is the *intent*, a report is
// the *record*. Completing a task opens a work report pre-filled from it, so the
// thing you were asked to do and the thing you did are linked rather than typed
// twice, and the work still lands in the appraisal loop like any other.
//
// `state` is a small fixed set, not the configurable report-status catalogue. A task
// and a report have different lifecycles, and sharing one list would put "False
// complaint" in the task picker and "In progress on a task" in the report picker —
// two workflows quietly corrupting each other's vocabulary.
import { z } from "zod";

import { nameSchema, timestampsSchema, uuidSchema } from "@/entities/common.js";

export const TASK_STATES = ["open", "in_progress", "done", "cancelled"] as const;
export type TaskState = (typeof TASK_STATES)[number];
export const taskStateSchema = z.enum(TASK_STATES);

/** Terminal states — a task here is off the assignee's list. */
export const TASK_CLOSED_STATES: readonly TaskState[] = ["done", "cancelled"];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);

const detailText = z.string().trim().max(20000);

/** A report this task produced — the record of the work, linked back to the intent. */
export const taskReportLinkSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  state: z.string(),
});

export const taskSchema = z
  .object({
    id: uuidSchema,
    companyId: uuidSchema,
    title: nameSchema,
    detail: z.string().nullable(),

    /** Who must do it, and who handed it to them. */
    assigneeId: z.string(),
    assigneeName: nameSchema,
    assignerId: z.string(),
    assignerName: nameSchema,

    departmentId: uuidSchema.nullable(),
    departmentName: z.string().nullable(),

    dueAt: z.string().datetime().nullable(),
    priority: taskPrioritySchema,
    state: taskStateSchema,
    completedAt: z.string().datetime().nullable(),

    /** Free labels, same vocabulary a report uses — so work requested and work
     *  recorded can be found by the same words. */
    tags: z.array(z.object({ id: uuidSchema, name: nameSchema, color: z.string() })).default([]),

    /** The work reports filed against it. Empty until one is. */
    reports: z.array(taskReportLinkSchema),
  })
  .merge(timestampsSchema);
export type Task = z.infer<typeof taskSchema>;

/** A task as listed — the long detail and the linked reports dropped for the table. */
export const taskRowSchema = taskSchema.omit({ detail: true, reports: true });
export type TaskRow = z.infer<typeof taskRowSchema>;

export const createTaskSchema = z.object({
  title: nameSchema,
  detail: detailText.optional(),
  /** Yourself, or anyone below you in the reporting line. The server checks. */
  assigneeId: z.string().min(1),
  departmentId: uuidSchema.optional(),
  dueAt: z.string().datetime().optional(),
  priority: taskPrioritySchema.default("normal"),
  tagIds: z.array(uuidSchema).optional(),
});
export type CreateTask = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: nameSchema.optional(),
  detail: detailText.nullable().optional(),
  assigneeId: z.string().min(1).optional(),
  departmentId: uuidSchema.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  priority: taskPrioritySchema.optional(),
  state: taskStateSchema.optional(),
  /** Omit to leave tags untouched; send [] to clear them. */
  tagIds: z.array(uuidSchema).optional(),
});
export type UpdateTask = z.infer<typeof updateTaskSchema>;

/**
 * What the report editor needs to open pre-filled from a task. Built by the server
 * rather than assembled in the browser, so the link and the copied text come from
 * the task itself and cannot be forged into pointing somewhere else.
 */
export const taskPrefillSchema = z.object({
  taskId: uuidSchema,
  kind: z.literal("work"),
  title: z.string(),
  workSummary: z.string().nullable(),
  departmentId: uuidSchema.nullable(),
});
export type TaskPrefill = z.infer<typeof taskPrefillSchema>;
