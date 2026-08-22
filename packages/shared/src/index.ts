// Author: Brijesh Dave <https://github.com/brijeshdave>
// Public entry point for shared contracts (error envelope, list query, permission
// model, entity schemas) reused by the API and web. Single source of truth — no
// consumer re-declares these types.

export * from "@/errors.js";
export * from "@/format/dates.js";
export * from "@/http/pagination.js";
export * from "@/auth/permissions.js";
export * from "@/auth/password.js";
export * from "@/auth/sso.js";
export * from "@/settings/registry.js";
export * from "@/settings/fields.js";
export * from "@/entities/common.js";
export * from "@/entities/audit.js";
export * from "@/entities/channel.js";
export * from "@/entities/notification.js";
export * from "@/entities/queue.js";
export * from "@/entities/part.js";
export * from "@/entities/device.js";
export * from "@/entities/log.js";
export * from "@/entities/message.js";
export * from "@/entities/user.js";
export * from "@/entities/company.js";
export * from "@/entities/location.js";
export * from "@/entities/department.js";
export * from "@/entities/designation.js";
export * from "@/entities/report-config.js";
export * from "@/entities/asset.js";
export * from "@/entities/report-scope.js";
export * from "@/entities/report.js";
export * from "@/entities/report-view.js";
export * from "@/entities/appraisal.js";
export * from "@/entities/downtime.js";
export * from "@/entities/attachment.js";
export * from "@/entities/task.js";
export * from "@/entities/analytics.js";
export * from "@/entities/collaboration.js";
export * from "@/entities/group.js";
export * from "@/entities/role.js";
export * from "@/entities/shift.js";
export * from "@/entities/routine.js";
export * from "@/entities/points.js";
export * from "@/entities/backup.js";
