// Author: Brijesh Dave <https://github.com/brijeshdave>
// Role contract. A role is a named bundle of permissions assigned to groups.
// System roles (isSystem) are immutable but clonable.
import { z } from "zod";

import { nameSchema, timestampsSchema, uuidSchema, patchSchemaOf } from "@/entities/common.js";
import { ALL_PERMISSIONS, type Permission } from "@/auth/permissions.js";

const permissionSchema = z.enum(ALL_PERMISSIONS as readonly [Permission, ...Permission[]]);

export const roleSchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    isSystem: z.boolean(),
    permissions: z.array(permissionSchema),
  })
  .merge(timestampsSchema);

export type Role = z.infer<typeof roleSchema>;

export const createRoleSchema = z.object({
  name: nameSchema,
  permissions: z.array(permissionSchema).default([]),
});

export type CreateRole = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = patchSchemaOf(createRoleSchema);
export type UpdateRole = z.infer<typeof updateRoleSchema>;
