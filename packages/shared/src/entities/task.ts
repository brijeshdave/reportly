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

/**
 * One person on a task. A task carries a list of these rather than a single
 * assignee, because work is planned before it is handed out, split across a team,
 * and handed over when a shift ends — and one column could say none of that.
 *
 * `released` marks somebody who handed the task on. They stay on the list: the
 * points for a task that changed hands mid-flight are divided between everybody
 * who worked on it, and a name that has been removed cannot be paid.
 */
export const taskAssigneeSchema = z.object({
  id: z.string(),
  name: nameSchema,
  released: z.boolean().default(false),
});
export type TaskAssignee = z.infer<typeof taskAssigneeSchema>;

/**
 * The assignee-filter value meaning "nobody on it" — how you find the work planned
 * ahead and still waiting to be handed out.
 *
 * A word rather than an id, and shared rather than typed twice: the filter control
 * offers it and the query understands it, and those are in different packages.
 */
export const UNASSIGNED = "none";

/** A task changing hands, and who asked for it. */
export const taskHandoverSchema = z.object({
  id: uuidSchema,
  fromUserId: z.string().nullable(),
  fromUserName: z.string().nullable(),
  toUserId: z.string().nullable(),
  toUserName: z.string().nullable(),
  byUserId: z.string().nullable(),
  byUserName: z.string().nullable(),
  reason: z.string().nullable(),
  handedAt: z.string().datetime(),
});
export type TaskHandover = z.infer<typeof taskHandoverSchema>;

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

    /** Who must do it — none, one, or several — and who handed it to them. */
    assignees: z.array(taskAssigneeSchema).default([]),
    assignerId: z.string(),
    assignerName: nameSchema,

    departmentId: uuidSchema.nullable(),
    departmentName: z.string().nullable(),

    dueAt: z.string().datetime().nullable(),
    /**
     * What the task is worth — the ceiling of the entry filed against it, split
     * between whoever worked it and confirmed by their manager.
     *
     * Set by whoever raises the task and changeable only by somebody who manages
     * it, so a person writing their own work cannot decide what it earns. The
     * installation ceiling in settings bounds it.
     */
    maxPoints: z.number().min(0),
    priority: taskPrioritySchema,
    state: taskStateSchema,
    completedAt: z.string().datetime().nullable(),

    /** Free labels, same vocabulary a report uses — so work requested and work
     *  recorded can be found by the same words. */
    tags: z.array(z.object({ id: uuidSchema, name: nameSchema, color: z.string() })).default([]),

    /** The work reports filed against it. Empty until one is. */
    reports: z.array(taskReportLinkSchema),

    /** Every time it changed hands, oldest first. */
    handovers: z.array(taskHandoverSchema).default([]),
  })
  .merge(timestampsSchema);
export type Task = z.infer<typeof taskSchema>;

/** A task as listed — the long detail and the linked reports dropped for the table. */
export const taskRowSchema = taskSchema.omit({ detail: true, reports: true, handovers: true });
export type TaskRow = z.infer<typeof taskRowSchema>;

export const createTaskSchema = z.object({
  title: nameSchema,
  detail: detailText.optional(),
  /**
   * Yourself, or anyone below you in the reporting line. The server checks.
   *
   * Empty is allowed and means nobody yet — asked for directly: "allow to create
   * the task without any assign to so that i can create task in advance for my
   * team and only assign when i need to based on priority". An unassigned task
   * sits on its creator's list until it is handed out, and nobody is notified,
   * because nobody has been given anything.
   */
  assigneeIds: z.array(z.string().min(1)).default([]),
  departmentId: uuidSchema.optional(),
  dueAt: z.string().datetime().optional(),
  priority: taskPrioritySchema.default("normal"),
  /** In half points like every other number in the scoring model. The server
   *  refuses anything above the installation ceiling. */
  maxPoints: z.number().min(0).multipleOf(0.5).optional(),
  tagIds: z.array(uuidSchema).optional(),
});
export type CreateTask = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: nameSchema.optional(),
  detail: detailText.nullable().optional(),
  /** Replaced wholesale when sent; send [] to leave the task unassigned. */
  assigneeIds: z.array(z.string().min(1)).optional(),
  departmentId: uuidSchema.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  priority: taskPrioritySchema.optional(),
  /** Only somebody who manages the task may change this. */
  maxPoints: z.number().min(0).multipleOf(0.5).optional(),
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
  /** Everybody who worked on the task, including anyone who handed it over. The
   *  entry starts with them on it and the author divides the points between them. */
  participantIds: z.array(z.string()).default([]),
});
export type TaskPrefill = z.infer<typeof taskPrefillSchema>;

/**
 * Handing a task on mid-flight — "a task was long and the user's shift was
 * finished and he handed it over to someone else". The outgoing person is released
 * rather than removed, so both of them are on the entry when the work is finally
 * written up and the points are divided.
 */
export const handoverTaskSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  reason: z.string().trim().max(2000).optional(),
});
export type HandoverTask = z.infer<typeof handoverTaskSchema>;
