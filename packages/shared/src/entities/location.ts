// Author: Brijesh Dave <https://github.com/brijeshdave>
// Location contract. Names are unique per company (enforced by the DB in Step 2);
// `isRemote` marks the auto-created "Remote" location, which can be neither
// deleted nor deactivated: it is the fallback for people without an office.
import { z } from "zod";

import { entityStatusSchema, nameSchema, timestampsSchema, uuidSchema } from "@/entities/common.js";

export const locationSchema = z
  .object({
    id: uuidSchema,
    companyId: uuidSchema,
    name: nameSchema,
    isRemote: z.boolean(),
    /** Inactive locations keep their group scopes but are not offered for new work. */
    status: entityStatusSchema,
  })
  .merge(timestampsSchema);

export type Location = z.infer<typeof locationSchema>;

export const createLocationSchema = z.object({
  companyId: uuidSchema,
  name: nameSchema,
});

export type CreateLocation = z.infer<typeof createLocationSchema>;

// companyId is immutable after creation; only the name may change.
export const updateLocationSchema = z.object({
  name: nameSchema.optional(),
});

export type UpdateLocation = z.infer<typeof updateLocationSchema>;
