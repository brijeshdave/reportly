// Author: Brijesh Dave <https://github.com/brijeshdave>
// Department contract. Departments are owned by a company (like locations) and
// nest into a tree via `parentId`, so a company's org structure lives here. A
// user can belong to many departments, across companies, and be the Head of
// Department (HOD) of any of them — membership is a separate join, not a field on
// the user. Names are unique per company (enforced by the DB).
import { z } from "zod";

import { entityStatusSchema, nameSchema, timestampsSchema, uuidSchema } from "@/entities/common.js";

export const departmentSchema = z
  .object({
    id: uuidSchema,
    companyId: uuidSchema,
    /** Parent department, or null for a top-level department. */
    parentId: uuidSchema.nullable(),
    name: nameSchema,
    status: entityStatusSchema,
  })
  .merge(timestampsSchema);

export type Department = z.infer<typeof departmentSchema>;

/**
 * A department as listed for the tree view: the whole company's departments come
 * back flat (never paginated — the tree is assembled client-side from `parentId`)
 * with the counts each node shows without a second request.
 */
export const departmentNodeSchema = departmentSchema.extend({
  memberCount: z.number().int().nonnegative(),
  hodCount: z.number().int().nonnegative(),
  /**
   * The full path from the root, e.g. `Engineering › Backend` — a root department is
   * just its own name. A picker showing bare names says nothing about where in the
   * tree a department sits; the tree already knows, so it is carried here.
   */
  path: z.string(),
});

export type DepartmentNode = z.infer<typeof departmentNodeSchema>;

export const createDepartmentSchema = z.object({
  name: nameSchema,
  /** Omit or null to create a top-level department. */
  parentId: uuidSchema.nullable().optional(),
});

export type CreateDepartment = z.infer<typeof createDepartmentSchema>;

// `undefined` leaves a field unchanged; an explicit `null` parentId re-roots the
// department (makes it top-level).
export const updateDepartmentSchema = z.object({
  name: nameSchema.optional(),
  parentId: uuidSchema.nullable().optional(),
});

export type UpdateDepartment = z.infer<typeof updateDepartmentSchema>;

/**
 * A member's standing in a department. A *label*, not an authority: it says what to
 * call someone, while `reportsToId` says who is above them. JournalEntry visibility reads
 * the reporting line and never this — a rank and a chain that disagree must not be
 * able to hand someone access.
 */
export const DEPARTMENT_RANKS = ["hod", "lead", "member"] as const;
export type DepartmentRank = (typeof DEPARTMENT_RANKS)[number];
export const departmentRankSchema = z.enum(DEPARTMENT_RANKS);

/** One member of a department, resolved to their profile for display. */
export const departmentMemberSchema = z.object({
  userId: z.string(),
  name: nameSchema,
  email: z.string().email(),
  designation: z.string().nullable(),
  employeeId: z.string().nullable(),
  avatarVersion: z.number().nullable(),
  rank: departmentRankSchema,
  /**
   * Travelling staff: a general shift, and a different plant on different days.
   * They are rostered on the department's central rota rather than any site's.
   */
  isCentral: z.boolean(),
  /**
   * The person this member reports to — the hierarchy, and the only thing report
   * visibility is computed from. Null means nobody is above them here.
   */
  reportsToId: z.string().nullable(),
  reportsToName: z.string().nullable(),
  /** The sites this membership covers. Empty means all of the company's sites. */
  locationIds: z.array(uuidSchema),
});

export type DepartmentMember = z.infer<typeof departmentMemberSchema>;

/** Replaces the whole membership set of a department (like group assignments). */
export const setDepartmentMembersSchema = z.object({
  members: z.array(
    z.object({
      userId: z.string(),
      rank: departmentRankSchema.default("member"),
      /**
       * May name someone in *another* department on purpose: a Head of Engineering
       * reports to Management, not to anybody inside Engineering. They must be in
       * the same company, and the edge must not close a loop.
       */
      reportsToId: z.string().nullable().default(null),
      locationIds: z.array(uuidSchema).default([]),
      isCentral: z.boolean().default(false),
    }),
  ),
});

export type SetDepartmentMembers = z.infer<typeof setDepartmentMembersSchema>;

/** A department a given user belongs to, shown on their profile. */
export const userDepartmentSchema = z.object({
  departmentId: uuidSchema,
  companyId: uuidSchema,
  /**
   * The company this membership is in. A person may be in a "Maintenance" at two
   * companies — names are unique per company, never across them — so anything
   * listing memberships from more than one company must say which is which.
   */
  companyName: nameSchema,
  name: nameSchema,
  /** The full path from the root within that company, e.g. `Engineering › Backend`. */
  path: z.string(),
  rank: departmentRankSchema,
  isCentral: z.boolean(),
  reportsToId: z.string().nullable(),
  reportsToName: z.string().nullable(),
  locationIds: z.array(uuidSchema),
});

export type UserDepartment = z.infer<typeof userDepartmentSchema>;

/**
 * Someone in a person's downline: anybody below them in the reporting line, at any
 * depth. `depth` is how many links away — 1 is a direct report.
 *
 * This is the set report visibility is built on. It is computed by walking the
 * reporting edges, never inferred from rank or from the department tree: a title
 * and a chain that disagree is exactly the bug that would let the wrong person read
 * somebody's reports.
 */
export const downlineMemberSchema = z.object({
  userId: z.string(),
  name: nameSchema,
  email: z.string().email(),
  designation: z.string().nullable(),
  rank: departmentRankSchema,
  departmentId: uuidSchema,
  departmentName: nameSchema,
  reportsToId: z.string().nullable(),
  depth: z.number().int().positive(),
});

export type DownlineMember = z.infer<typeof downlineMemberSchema>;

/**
 * Somebody who already holds a membership somewhere in this company's org. These
 * are the only people a reporting edge may name — you cannot report to a stranger —
 * so the manager picker is built from exactly this list.
 */
export const orgPersonSchema = z.object({
  userId: z.string(),
  name: nameSchema,
  email: z.string().email(),
  designation: z.string().nullable(),
  /** Every department they are in, for telling two people of the same name apart. */
  departmentNames: z.array(z.string()),
});

export type OrgPerson = z.infer<typeof orgPersonSchema>;

/**
 * One person on the organisation chart: who they are, where they sit, and who they
 * report to. The chart is the reporting edges drawn out — the client assembles the
 * forest from `reportsToId`, exactly as the downline walk does on the server, so the
 * picture and the permission can never tell different stories.
 *
 * A person in two departments appears once per membership: they genuinely occupy two
 * places in the organisation, and collapsing that would hide one of them.
 */
export const orgChartNodeSchema = z.object({
  /** Unique per membership — the same person in two departments has two of these. */
  id: z.string(),
  userId: z.string(),
  name: nameSchema,
  email: z.string().email(),
  designation: z.string().nullable(),
  avatarVersion: z.number().nullable(),
  status: z.string(),
  rank: departmentRankSchema,
  departmentId: uuidSchema,
  departmentName: nameSchema,
  reportsToId: z.string().nullable(),
  locationIds: z.array(uuidSchema),
});

export type OrgChartNode = z.infer<typeof orgChartNodeSchema>;
