// Author: Brijesh Dave <https://github.com/brijeshdave>
// The physical/structural things a report can be about, and where they live.
//
// The scope model is split by how many there are, so nothing forces thousands of
// items into a hand-built tree:
//   - **Assets** — the structural few (plant, lines, stations, buildings, areas).
//     Nestable, curated, chosen from a small tree. Their *types* are configurable
//     data, so any industry defines its own (Line/Station vs Ward/Bed vs Aisle).
//   - **Devices** — the many (machines, sensors). A flat, searchable registry; each
//     optionally records where it lives (an asset), so "issues on Line 3" still
//     rolls up its devices without any device being placed in a tree by hand.
import { z } from "zod";

import {
  entityStatusSchema,
  nameSchema,
  timestampsSchema,
  uuidSchema,
  patchSchemaOf,
} from "@/entities/common.js";

/* ------------------------------ Asset types -------------------------------- */

export const assetTypeSchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    orderIndex: z.number().int(),
    /**
     * Whether an outage on something of this type is worth recording.
     *
     * Downtime means production stopped, and "production" is a fact about the
     * kind of thing rather than about the individual: every Line stops
     * production, no Desktop does. Deciding it per type is one call for six
     * types instead of one per machine — and it is what stops the panel offering
     * downtime for a PC.
     *
     * A thing with no type at all is still offered it: nobody has said either
     * way, and refusing on a fact that was never recorded loses an outage that
     * did happen.
     */
    tracksDowntime: z.boolean(),
    status: entityStatusSchema,
  })
  .merge(timestampsSchema);
export type AssetType = z.infer<typeof assetTypeSchema>;

/** A type as listed — with how many assets use it, for the "safe to retire?" call. */
export const assetTypeRowSchema = assetTypeSchema.extend({ assetCount: z.number().int() });
export type AssetTypeRow = z.infer<typeof assetTypeRowSchema>;

export const createAssetTypeSchema = z.object({
  name: nameSchema,
  orderIndex: z.number().int().default(0),
  // Assets are the production structure — plant, line, station — so this is the
  // useful default for a new one. A device type defaults the other way.
  tracksDowntime: z.boolean().default(true),
  status: entityStatusSchema.default("active"),
});
export type CreateAssetType = z.infer<typeof createAssetTypeSchema>;
export const updateAssetTypeSchema = patchSchemaOf(createAssetTypeSchema);
export type UpdateAssetType = z.infer<typeof updateAssetTypeSchema>;

/* --------------------------------- Assets ---------------------------------- */

export const assetSchema = z
  .object({
    id: uuidSchema,
    companyId: uuidSchema,
    parentId: uuidSchema.nullable(),
    typeId: uuidSchema.nullable(),
    typeName: z.string().nullable(),
    /** The site it stands at. Null = not placed yet, which is visible to every
     *  location scope — an unplaced asset is unplaced, not secret. */
    locationId: uuidSchema.nullable(),
    locationName: z.string().nullable(),
    name: nameSchema,
    status: entityStatusSchema,
  })
  .merge(timestampsSchema);
export type Asset = z.infer<typeof assetSchema>;

/** An asset as listed — with the count of devices that live at it. The client
 * assembles the tree from `parentId`. */
export const assetNodeSchema = assetSchema.extend({ deviceCount: z.number().int() });
export type AssetNode = z.infer<typeof assetNodeSchema>;

export const createAssetSchema = z.object({
  name: nameSchema,
  parentId: uuidSchema.nullable().optional(),
  typeId: uuidSchema.nullable().optional(),
  locationId: uuidSchema.nullable().optional(),
  status: entityStatusSchema.default("active"),
});
export type CreateAsset = z.infer<typeof createAssetSchema>;

export const updateAssetSchema = z.object({
  name: nameSchema.optional(),
  parentId: uuidSchema.nullable().optional(),
  typeId: uuidSchema.nullable().optional(),
  locationId: uuidSchema.nullable().optional(),
  status: entityStatusSchema.optional(),
});
export type UpdateAsset = z.infer<typeof updateAssetSchema>;

/* --------------------------------- Devices --------------------------------- */

export const deviceSchema = z
  .object({
    id: uuidSchema,
    companyId: uuidSchema,
    name: nameSchema,
    /** Free text: a serial number or vendor code, whatever is stamped on it. */
    identifier: z.string().nullable(),
    /** The organisation's own asset ID. Unique within the company, so it can be
     *  used to look the device up — distinct from `identifier`, which is a note. */
    assetTag: z.string().nullable(),
    typeId: uuidSchema.nullable(),
    typeName: z.string().nullable(),
    /** Where it lives, for roll-up (an asset), and which department owns it. */
    assetId: uuidSchema.nullable(),
    assetName: z.string().nullable(),
    departmentId: uuidSchema.nullable(),
    departmentName: z.string().nullable(),
    /** Its own site, picked directly rather than inherited through `assetId` —
     *  a device is registered before it is placed. */
    locationId: uuidSchema.nullable(),
    locationName: z.string().nullable(),
    status: entityStatusSchema,
  })
  .merge(timestampsSchema);
export type Device = z.infer<typeof deviceSchema>;

const identifierSchema = z.string().trim().max(120);

export const createDeviceSchema = z.object({
  name: nameSchema,
  identifier: identifierSchema.optional(),
  assetTag: identifierSchema.optional(),
  typeId: uuidSchema.nullable().optional(),
  assetId: uuidSchema.nullable().optional(),
  departmentId: uuidSchema.nullable().optional(),
  locationId: uuidSchema.nullable().optional(),
  status: entityStatusSchema.default("active"),
});
export type CreateDevice = z.infer<typeof createDeviceSchema>;

export const updateDeviceSchema = z.object({
  name: nameSchema.optional(),
  identifier: identifierSchema.nullable().optional(),
  assetTag: identifierSchema.nullable().optional(),
  typeId: uuidSchema.nullable().optional(),
  assetId: uuidSchema.nullable().optional(),
  departmentId: uuidSchema.nullable().optional(),
  locationId: uuidSchema.nullable().optional(),
  status: entityStatusSchema.optional(),
});
export type UpdateDevice = z.infer<typeof updateDeviceSchema>;
