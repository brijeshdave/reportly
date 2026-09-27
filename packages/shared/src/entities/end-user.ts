// Author: Brijesh Dave <https://github.com/brijeshdave>
// End users — the people the IT team supports, who do not themselves use Reportly.
//
// Asked for from use: the journal's "People" field offered the *account* list, so
// technicians tagged colleagues (206 targets naming 13 accounts) because that was
// the only list there was. The people the work was about were not recorded at all,
// which is why nothing could answer "whose machine keeps failing".
//
// Their own record rather than a flag on a user, and the reason is structural: an
// end user has no password, no company access, no place in the reporting line, no
// points and no inbox. A flag would oblige every surface that reads people — the
// assignment picker, the downline walk, the leaderboard, review chains, rosters — to
// exclude them one at a time, and the first one that forgot would be a leak.
import { z } from "zod";

import { entityStatusSchema, nameSchema, timestampsSchema, uuidSchema } from "@/entities/common.js";

export const endUserSchema = z
  .object({
    id: uuidSchema,
    companyId: uuidSchema,

    /**
     * Which department they belong to.
     *
     * The journal narrows its End user list to the department chosen on the entry,
     * so a person with no department is reachable only when no department is chosen.
     * Nullable all the same: a contractor or a visitor belongs to no department, and
     * inventing one for them would be a fact nobody stated.
     */
    departmentId: uuidSchema.nullable(),
    departmentName: z.string().nullable(),

    fullName: nameSchema,
    /**
     * Required and unique within the company: it is how two people with the same
     * name are told apart, and how an import knows whether it is adding somebody or
     * correcting them.
     */
    employeeNumber: z.string().trim().min(1).max(64),
    /** Anything worth knowing — a location, a shift, a machine they always use. */
    description: z.string().nullable(),
    /**
     * `inactive` keeps every entry that names them and takes them out of the picker.
     * Somebody who has left should not be deleted: their history is what the reports
     * are made of.
     */
    status: entityStatusSchema,
    /** Set where this person also has a Reportly account. */
    linkedUserId: z.string().nullable(),
    linkedUserName: z.string().nullable(),

    /** How many journal entries name them. Read-only, and the point of the record. */
    entryCount: z.number().int().optional(),
  })
  .merge(timestampsSchema);
export type EndUser = z.infer<typeof endUserSchema>;

export const createEndUserSchema = z.object({
  fullName: nameSchema,
  employeeNumber: z.string().trim().min(1).max(64),
  departmentId: uuidSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  /** Active unless somebody says otherwise — a person being added is a person here. */
  status: entityStatusSchema.default("active"),
  linkedUserId: z.string().min(1).optional(),
});
export type CreateEndUser = z.infer<typeof createEndUserSchema>;

export const updateEndUserSchema = z.object({
  fullName: nameSchema.optional(),
  employeeNumber: z.string().trim().min(1).max(64).optional(),
  departmentId: uuidSchema.nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: entityStatusSchema.optional(),
  linkedUserId: z.string().min(1).nullable().optional(),
});
export type UpdateEndUser = z.infer<typeof updateEndUserSchema>;

/**
 * One row of the import sheet.
 *
 * The department arrives as a **name**, because a spreadsheet filled in by a person
 * holds names and not ids. Unknown names are reported back rather than created: a
 * typo that silently invents a department is how a master list becomes a mess.
 */
export const endUserImportRowSchema = z.object({
  employeeNumber: z.string().trim().min(1),
  fullName: z.string().trim().min(1),
  department: z.string().trim().optional(),
  description: z.string().trim().optional(),
  status: z.string().trim().optional(),
});
export type EndUserImportRow = z.infer<typeof endUserImportRowSchema>;
