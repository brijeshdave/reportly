// Author: Brijesh Dave <https://github.com/brijeshdave>
// Designation contract — the catalogue of job titles a user can be given.
//
// Global, not per-company: a user is one record who may sit in several companies,
// and they hold one job title, so a per-company catalogue would have no single
// value to put on them. (A department is per-company because a department really
// does belong to one.)
//
// Users point at a designation by id rather than copying its name, so renaming
// "Sr. Engineer" to "Senior Engineer" corrects everyone holding it at once, and the
// usage count is a fact rather than a guess at which spellings meant the same job.
import { z } from "zod";

import {
  entityStatusSchema,
  nameSchema,
  timestampsSchema,
  uuidSchema,
  patchSchemaOf,
} from "@/entities/common.js";

export const designationSchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    /**
     * Inactive means "no longer offered", not "gone". People already holding it keep
     * it — retiring a job title must not quietly strip it from the staff who have it.
     */
    status: entityStatusSchema,
  })
  .merge(timestampsSchema);

export type Designation = z.infer<typeof designationSchema>;

/** A designation as listed, with how many people hold it. */
export const designationRowSchema = designationSchema.extend({
  userCount: z.number().int().nonnegative(),
});

export type DesignationRow = z.infer<typeof designationRowSchema>;

export const createDesignationSchema = z.object({
  name: nameSchema,
  status: entityStatusSchema.default("active"),
});

export type CreateDesignation = z.infer<typeof createDesignationSchema>;

export const updateDesignationSchema = patchSchemaOf(createDesignationSchema);
export type UpdateDesignation = z.infer<typeof updateDesignationSchema>;
