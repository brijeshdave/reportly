// Author: Brijesh Dave <https://github.com/brijeshdave>
// Group contract. Groups are the only holders of roles and the join point to
// companies/locations. System groups (isSystem) are immutable but clonable.
import { z } from "zod";

import { nameSchema, timestampsSchema, uuidSchema, patchSchemaOf } from "@/entities/common.js";

export const groupSchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    isSystem: z.boolean(),
    /** Everybody in this group must enrol in two-factor authentication. */
    requiresTwoFactor: z.boolean(),
  })
  .merge(timestampsSchema);

export type Group = z.infer<typeof groupSchema>;

export const createGroupSchema = z.object({
  name: nameSchema,
  requiresTwoFactor: z.boolean().default(false),
});

export type CreateGroup = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = patchSchemaOf(createGroupSchema);
export type UpdateGroup = z.infer<typeof updateGroupSchema>;
