// Author: Brijesh Dave <https://github.com/brijeshdave>
// Task business logic: who may be handed work, who may change it, and the hand-off
// from a completed task to the report that records the work.
//
// Assignment follows the reporting line and nothing else — you may give work to
// yourself or to someone below you. That is the same `downlineUserIds` walk report
// visibility uses, deliberately: an org where you can see someone's reports but not
// hand them a job (or the reverse) has two different answers to "who works for me".
import {
  type AuthContext,
  type CreateTask,
  ERROR_CODES,
  type Task,
  type TaskPrefill,
  type TaskPriority,
  type TaskRow,
  type TaskState,
  type PaginatedResult,
  type ResolvedListQuery,
  type UpdateTask,
  toPaginatedResult,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { notify } from "@/core/queue/notifications.js";
import { clearTags, tagsFor, tagsForMany } from "@/features/vocabulary/repo.js";
import { applyTags } from "@/features/vocabulary/service.js";
// The leaf cleanup module, not the attachments service: that service imports this
// one to ask who may see a task, and the two must not import each other in a circle.
import { removeAttachmentsFor } from "@/features/attachments/cleanup.js";
import { downlineUserIds } from "@/features/journal/hierarchy.js";
import {
  deleteTaskRow,
  getTask as getRow,
  insertTask,
  listTasks as listRows,
  type NewTask,
  openTasksAssignedBy,
  reportsForTask,
  type TaskPatch,
  type TaskRowRaw,
  updateTaskRow,
} from "@/features/tasks/repo.js";

const asState = (s: string): TaskState =>
  s === "in_progress" || s === "done" || s === "cancelled" ? s : "open";
const asPriority = (p: string): TaskPriority =>
  p === "low" || p === "high" || p === "urgent" ? p : "normal";

function serializeRow(
  row: TaskRowRaw,
  tags: { id: string; name: string; color: string }[] = [],
): TaskRow {
  return {
    tags,
    id: row.id,
    companyId: row.companyId,
    title: row.title,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    // The assigner is nullable in the database (their account may be gone) but the
    // contract promises a name, so say what happened rather than show an empty cell.
    assignerId: row.assignerId ?? "",
    assignerName: row.assignerName ?? "(removed)",
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    dueAt: row.dueAt?.toISOString() ?? null,
    priority: asPriority(row.priority),
    state: asState(row.state),
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Everyone the caller may hand work to: themselves plus their whole downline. */
async function assignableTo(ctx: AuthContext): Promise<Set<string>> {
  const below = await downlineUserIds(ctx.userId);
  below.add(ctx.userId);
  return below;
}

/**
 * The task, and only if it belongs to the caller's company — the same reasoning
 * as the journal's `requireReport`: mutations authorise on the reporting line,
 * and the line is what crosses companies. Guard the read, not just the view.
 */
async function requireTask(id: string, ctx: AuthContext): Promise<TaskRowRaw> {
  const row = await getRow(id);
  if (!row || (ctx.companyId !== null && row.companyId !== ctx.companyId)) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "Task not found");
  }
  return row;
}

/**
 * Seeing a task: it is yours, you handed it out, or its assignee is below you.
 * A 404 rather than a 403 — "no such task" tells a stranger nothing about who works
 * on what.
 */
async function assertVisible(row: TaskRowRaw, ctx: AuthContext): Promise<void> {
  // The company first, before the reporting line — the same rule, and the same
  // reason, as the journal's (SF-008). `listTasks` already scopes its query by
  // company; this is the by-id read, which is the path that had nothing.
  //
  // The line alone is not a tenant boundary: `downlineUserIds` recurses
  // `department_users` with no company filter, so somebody holding a department
  // in two companies bridges them. A null company on the context is a superadmin
  // across all of them.
  if (ctx.companyId !== null && row.companyId !== ctx.companyId) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "Task not found");
  }
  if (ctx.isSuperadmin) return;
  if (row.assigneeId === ctx.userId || row.assignerId === ctx.userId) return;
  const below = await downlineUserIds(ctx.userId);
  if (!below.has(row.assigneeId)) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "Task not found");
  }
}

export async function listTasks(
  query: ResolvedListQuery,
  ctx: AuthContext,
): Promise<PaginatedResult<TaskRow>> {
  let visible: string[] | null = null;
  if (!ctx.isSuperadmin) {
    const below = await downlineUserIds(ctx.userId);
    below.add(ctx.userId);
    visible = [...below];
  }
  const { rows, total } = await listRows(query, ctx.userId, visible, ctx.companyId);
  // One query for every row's tags rather than one per row.
  const tagsByTask = await tagsForMany(
    "task",
    rows.map((r) => r.id),
  );
  return toPaginatedResult(
    rows.map((row) => serializeRow(row, tagsByTask.get(row.id) ?? [])),
    total,
    query,
  );
}

/**
 * The open tasks the caller assigned to others — their oversight list for the
 * "To review" page, so a manager can chase the work they handed out. Company-scoped
 * to the active company; visibility is inherent (they are the assigner).
 */
export async function assignedOpenTasks(ctx: AuthContext, companyId: string): Promise<TaskRow[]> {
  const rows = await openTasksAssignedBy(ctx.userId, companyId);
  const tagsByTask = await tagsForMany(
    "task",
    rows.map((r) => r.id),
  );
  return rows.map((row) => serializeRow(row, tagsByTask.get(row.id) ?? []));
}

export async function getTask(id: string, ctx: AuthContext): Promise<Task> {
  const row = await requireTask(id, ctx);
  await assertVisible(row, ctx);
  return {
    ...serializeRow(row, await tagsFor("task", id)),
    detail: row.detail,
    reports: await reportsForTask(id),
  };
}

export async function createTask(input: CreateTask, ctx: AuthContext): Promise<Task> {
  if (!ctx.companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "X-Company-Id header is required");
  }
  if (!ctx.isSuperadmin && !(await assignableTo(ctx)).has(input.assigneeId)) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "You can only assign work to yourself or someone below you in the reporting line",
    );
  }

  const values: NewTask = {
    companyId: ctx.companyId,
    title: input.title,
    detail: input.detail ?? null,
    assigneeId: input.assigneeId,
    assignerId: ctx.userId,
    departmentId: input.departmentId ?? null,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    priority: input.priority,
  };
  const id = await insertTask(values);
  if (input.tagIds?.length) await applyTags("task", id, values.departmentId, input.tagIds);
  await notify({
    type: "task.assigned",
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    subjectUserId: input.assigneeId,
    title: `A task was assigned to you: ${input.title}`,
    body: input.detail ?? "",
    link: `/tasks`,
    entityKind: "task",
    entityId: id,
  });
  return getTask(id, ctx);
}

/**
 * Changing a task. The assignee may move it along the workflow; re-assigning it or
 * rewriting it is the assigner's (or someone above them). Split because "mark it
 * done" and "give it to somebody else" are not the same authority, and granting
 * Member `tasks:update` for the first must not hand them the second.
 */
export async function updateTask(id: string, input: UpdateTask, ctx: AuthContext): Promise<Task> {
  const row = await requireTask(id, ctx);
  await assertVisible(row, ctx);

  const isAssignee = row.assigneeId === ctx.userId;
  const manages =
    ctx.isSuperadmin ||
    row.assignerId === ctx.userId ||
    (await downlineUserIds(ctx.userId)).has(row.assigneeId);

  const editsBeyondState =
    input.title !== undefined ||
    input.detail !== undefined ||
    input.assigneeId !== undefined ||
    input.departmentId !== undefined ||
    input.dueAt !== undefined ||
    input.priority !== undefined;

  if (editsBeyondState && !manages) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "Only the person who assigned this task, or someone above them, can change it",
    );
  }
  if (input.state !== undefined && !isAssignee && !manages) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You cannot change this task");
  }

  if (input.assigneeId !== undefined && !ctx.isSuperadmin) {
    if (!(await assignableTo(ctx)).has(input.assigneeId)) {
      throw new AppError(
        403,
        ERROR_CODES.FORBIDDEN,
        "You can only assign work to yourself or someone below you in the reporting line",
      );
    }
  }

  const fields: TaskPatch = {};
  if (input.title !== undefined) fields.title = input.title;
  if (input.detail !== undefined) fields.detail = input.detail;
  if (input.assigneeId !== undefined) fields.assigneeId = input.assigneeId;
  if (input.departmentId !== undefined) fields.departmentId = input.departmentId;
  if (input.dueAt !== undefined) fields.dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (input.priority !== undefined) fields.priority = input.priority;
  if (input.state !== undefined) {
    fields.state = input.state;
    // The completion stamp is derived from the state, never sent by the client — two
    // fields that can disagree about whether something is finished will.
    fields.completedAt = input.state === "done" ? new Date() : null;
  }

  // Replaced wholesale when mentioned, untouched when absent — the same rule the
  // report editor follows, so "save" never silently drops labels.
  if (input.tagIds !== undefined) {
    await applyTags("task", id, fields.departmentId ?? row.departmentId, input.tagIds);
  }

  await updateTaskRow(id, fields);
  return getTask(id, ctx);
}

export async function deleteTask(id: string, ctx: AuthContext): Promise<void> {
  const row = await requireTask(id, ctx);
  await assertVisible(row, ctx);
  const manages = ctx.isSuperadmin || row.assignerId === ctx.userId;
  if (!manages) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "Only the person who assigned this task can delete it",
    );
  }
  // The reports it produced survive on purpose (reports.taskId is set null): the
  // record of work done, and the points on it, must not vanish with the request.
  await removeAttachmentsFor("task", id);
  // taggables is polymorphic and has no FK to the task, so its links must be
  // cleared explicitly or they outlive the record they described.
  await clearTags("task", id);
  await deleteTaskRow(id);
}

/**
 * What the report editor opens with when someone completes a task.
 *
 * Built here rather than assembled in the browser so the copied text and the link
 * come from the task itself — a client-built prefill could point its `taskId` at
 * somebody else's task and hang the work off it.
 */
export async function prefillFor(id: string, ctx: AuthContext): Promise<TaskPrefill> {
  const row = await requireTask(id, ctx);
  await assertVisible(row, ctx);
  if (row.assigneeId !== ctx.userId && !ctx.isSuperadmin) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      "Only the person the task was given to can log the work for it",
    );
  }
  return {
    taskId: row.id,
    kind: "work",
    title: row.title,
    workSummary: row.detail,
    departmentId: row.departmentId,
  };
}
