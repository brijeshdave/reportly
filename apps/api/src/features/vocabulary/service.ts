// Author: Brijesh Dave <https://github.com/brijeshdave>
// Device types and tags — the vocabulary a department maintains for itself.
//
// The rule both share, and it is the one that matters: a catalogue row that
// something already uses is **retired, never deleted**. Deleting a device type
// set-nulls it off the devices holding it; deleting a tag cascades its links away.
// Either way a record that was filed one way silently becomes a record filed
// another way, and nobody is told. Retiring stops it being offered on new work and
// leaves the history saying what it said.
import {
  type CreateDeviceType,
  type CreateTag,
  type DeviceTypeRow,
  ERROR_CODES,
  TAG_COLORS,
  type TagRow,
  type TaggableType,
  type UpdateDeviceType,
  type UpdateTag,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { departmentExists } from "@/features/journal-config/repo.js";
import {
  colorsInUse,
  deleteDeviceTypeRow,
  deleteTagRow,
  deviceTypeInUse,
  getDeviceType,
  getTag,
  insertDeviceType,
  insertTag,
  listDeviceTypes,
  listTags,
  nameTaken,
  setTags,
  tagInUse,
  validTagIds,
  updateDeviceTypeRow,
  updateTagRow,
  type VocabularyRowRaw,
} from "@/features/vocabulary/repo.js";

function serialize(row: VocabularyRowRaw): DeviceTypeRow {
  return {
    id: row.id,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    name: row.name,
    description: row.description,
    tracksDowntime: row.tracksDowntime ?? false,
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A tag is a vocabulary row plus its colour. */
const serializeTag = (row: VocabularyRowRaw): TagRow => ({
  ...serialize(row),
  color: row.color ?? TAG_COLORS[0]!,
});

/**
 * Pick a colour for a new tag.
 *
 * Random, as asked — but drawn first from the palette colours this department is
 * *not* already using, so the first twenty tags in a department come out visually
 * distinct instead of relying on luck (with 20 colours, plain random gives a
 * repeat within the first six about half the time). Once every colour is taken it
 * falls back to the whole palette, because a duplicate colour beats no colour.
 */
async function pickColor(departmentId: string): Promise<string> {
  const used = await colorsInUse(departmentId);
  const free = TAG_COLORS.filter((c) => !used.has(c));
  const pool = free.length > 0 ? free : TAG_COLORS;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

const DUPLICATE = (what: string) =>
  new AppError(
    409,
    ERROR_CODES.CONFLICT,
    `A ${what} with that name already exists in this department`,
  );

async function assertDepartment(departmentId: string, companyId: string): Promise<void> {
  // Same message whether the department belongs to another company or does not
  // exist: telling a caller "that one is not yours" confirms it exists.
  if (!(await departmentExists(departmentId, companyId))) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That department does not exist");
  }
}

/**
 * Attach tags to a record, refusing any that are not that department's own active
 * vocabulary.
 *
 * Refused rather than quietly filtered: a tag that disappears without comment
 * looks like the save failed. A record with no department can carry no tags at all
 * — tags are department-scoped, so there is nothing to draw from.
 *
 * Lives here rather than in reports and again in tasks, because "which tags may
 * this record carry" is one rule and two copies of it would drift.
 */
export async function applyTags(
  ownerType: TaggableType,
  ownerId: string,
  departmentId: string | null | undefined,
  tagIds: string[],
): Promise<void> {
  if (tagIds.length === 0) {
    await setTags(ownerType, ownerId, []);
    return;
  }
  if (!departmentId) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Tags belong to a department, so a record without one cannot carry them",
    );
  }
  const valid = await validTagIds(departmentId, tagIds);
  const rejected = tagIds.filter((id) => !valid.has(id));
  if (rejected.length > 0) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `Some tags are not active in this ${ownerType}'s department`,
      { rejected },
    );
  }
  await setTags(ownerType, ownerId, tagIds);
}

/* ------------------------------- device types ------------------------------ */

export async function listTypes(
  companyId: string,
  departmentId?: string,
): Promise<DeviceTypeRow[]> {
  return (await listDeviceTypes(companyId, departmentId)).map(serialize);
}

/**
 * A device type, and only if it is this company's.
 *
 * The id comes from the caller, and the row is reached through its department —
 * which is what made the company look implied. It is not: the query filtered on
 * the id alone, so one company could rename or retire another's (SF-009). A
 * mismatch answers 404, not 403, so nothing is confirmed to exist.
 */
async function requireType(id: string, companyId: string | null): Promise<VocabularyRowRaw> {
  const row = await getDeviceType(id);
  if (!row || (companyId !== null && row.companyId !== companyId)) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "Device type not found");
  }
  return row;
}

export async function getType(id: string, companyId: string | null): Promise<DeviceTypeRow> {
  return serialize(await requireType(id, companyId));
}

export async function createType(
  input: CreateDeviceType,
  companyId: string,
): Promise<DeviceTypeRow> {
  await assertDepartment(input.departmentId, companyId);
  if (await nameTaken("device_types", input.departmentId, input.name))
    throw DUPLICATE("device type");
  const id = await insertDeviceType({
    departmentId: input.departmentId,
    name: input.name,
    description: input.description ?? null,
    tracksDowntime: input.tracksDowntime,
    status: input.status,
  });
  return getType(id, companyId);
}

export async function updateType(
  id: string,
  input: UpdateDeviceType,
  companyId: string | null,
): Promise<DeviceTypeRow> {
  const existing = await requireType(id, companyId);
  if (input.name && input.name !== existing.name) {
    if (await nameTaken("device_types", existing.departmentId, input.name, id)) {
      throw DUPLICATE("device type");
    }
  }
  await updateDeviceTypeRow(id, input);
  return getType(id, companyId);
}

export async function deleteType(id: string, companyId: string | null): Promise<void> {
  await requireType(id, companyId);
  const inUse = await deviceTypeInUse(id);
  if (inUse > 0) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      `${inUse} ${inUse === 1 ? "device uses" : "devices use"} this type. Deactivate it instead — those devices keep it, and it stops being offered.`,
      { deviceCount: inUse },
    );
  }
  await deleteDeviceTypeRow(id);
}

/* ----------------------------------- tags ---------------------------------- */

export async function listAllTags(companyId: string, departmentId?: string): Promise<TagRow[]> {
  return (await listTags(companyId, departmentId)).map(serializeTag);
}

/** A tag, and only if it is this company's — see `requireType` above. */
async function requireTag(id: string, companyId: string | null): Promise<VocabularyRowRaw> {
  const row = await getTag(id);
  if (!row || (companyId !== null && row.companyId !== companyId)) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "Tag not found");
  }
  return row;
}

export async function getOneTag(id: string, companyId: string | null): Promise<TagRow> {
  return serializeTag(await requireTag(id, companyId));
}

export async function createTag(input: CreateTag, companyId: string): Promise<TagRow> {
  await assertDepartment(input.departmentId, companyId);
  if (await nameTaken("tags", input.departmentId, input.name)) throw DUPLICATE("tag");
  const id = await insertTag({
    departmentId: input.departmentId,
    name: input.name,
    description: input.description ?? null,
    // The caller's custom colour wins; otherwise one is picked for them.
    color: input.color ?? (await pickColor(input.departmentId)),
    status: input.status,
  });
  return getOneTag(id, companyId);
}

export async function updateTag(
  id: string,
  input: UpdateTag,
  companyId: string | null,
): Promise<TagRow> {
  const existing = await requireTag(id, companyId);
  if (input.name && input.name !== existing.name) {
    if (await nameTaken("tags", existing.departmentId, input.name, id)) throw DUPLICATE("tag");
  }
  await updateTagRow(id, input);
  return getOneTag(id, companyId);
}

export async function deleteTag(id: string, companyId: string | null): Promise<void> {
  await requireTag(id, companyId);
  const inUse = await tagInUse(id);
  if (inUse > 0) {
    // Deleting cascades the links away, so the reports and tasks carrying this tag
    // would quietly stop carrying it — and a label somebody filed under is part of
    // what they filed.
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      `${inUse} record(s) carry this tag. Deactivate it instead — they keep it, and it stops being offered.`,
      { records: inUse },
    );
  }
  await deleteTagRow(id);
}
