// Author: Brijesh Dave <https://github.com/brijeshdave>
// Audit + change-history contracts. Audit rows are immutable: they are only ever
// inserted and read, never updated or deleted.
import { z } from "zod";

import { uuidSchema } from "@/entities/common.js";

/** Entities whose field-level changes are tracked in entity_history. */
export const TRACKED_ENTITIES = [
  "users",
  "groups",
  "roles",
  "companies",
  "locations",
  "departments",
  "designations",
  "reports",
  "assets",
  "devices",
  "tasks",
  "shifts",
  "settings",
] as const;
export type TrackedEntity = (typeof TRACKED_ENTITIES)[number];

export const auditEventSchema = z.object({
  id: uuidSchema,
  action: z.string(),
  actorId: z.string().nullable(),
  /** Resolved from actorId when the actor is a user; null for system actions. */
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  companyId: uuidSchema.nullable(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  details: z.unknown().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  createdAt: z.string().datetime(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

export const entityHistorySchema = z.object({
  id: uuidSchema,
  entityType: z.string(),
  entityId: z.string(),
  field: z.string(),
  oldValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  actorId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type EntityHistory = z.infer<typeof entityHistorySchema>;
