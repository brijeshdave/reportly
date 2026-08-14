// Author: Brijesh Dave <https://github.com/brijeshdave>
// Company contract. Every company auto-gets a "Remote" location on creation
// (enforced server-side in Step 5).
import { z } from "zod";

import {
  entityStatusSchema,
  nameSchema,
  timestampsSchema,
  uuidSchema,
  patchSchemaOf,
} from "@/entities/common.js";

export const companySchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    /** Inactive companies keep their locations and group scopes. */
    status: entityStatusSchema,
  })
  .merge(timestampsSchema);

export type Company = z.infer<typeof companySchema>;

export const createCompanySchema = z.object({
  name: nameSchema,
});

export type CreateCompany = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = patchSchemaOf(createCompanySchema);
export type UpdateCompany = z.infer<typeof updateCompanySchema>;
