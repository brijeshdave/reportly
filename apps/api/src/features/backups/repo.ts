// Author: Brijesh Dave <https://github.com/brijeshdave>
// The only code touching the `backups` table — the catalogue of dumps/archives the
// Backups page lists and restores from. The bytes live in storage under `storage_key`.
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, lt, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { backups, users } from "@/core/db/schema.js";

export interface BackupRow {
  id: string;
  kind: string;
  storageKey: string;
  sizeBytes: number;
  status: string;
  error: string | null;
  hasLog: boolean;
  createdById: string | null;
  createdByName: string | null;
  createdAt: Date;
}

const creator = alias(users, "backup_creator");

const cols = {
  id: backups.id,
  kind: backups.kind,
  storageKey: backups.storageKey,
  sizeBytes: backups.sizeBytes,
  status: backups.status,
  error: backups.error,
  // Whether there is output to read, not the output itself: a log per row would
  // make the list payload enormous for a screen that shows one line each.
  hasLog: sql<boolean>`${backups.log} IS NOT NULL`,
  createdById: backups.createdBy,
  createdByName: creator.name,
  createdAt: backups.createdAt,
};

const withCreator = () =>
  db.select(cols).from(backups).leftJoin(creator, eq(creator.id, backups.createdBy));

/** Every backup, newest first (both kinds). */
export async function listBackups(): Promise<BackupRow[]> {
  return withCreator().orderBy(desc(backups.createdAt));
}

export async function getBackup(id: string): Promise<BackupRow | null> {
  const [row] = await withCreator().where(eq(backups.id, id));
  return row ?? null;
}

/** One attempt's captured output, fetched only when somebody asks to read it. */
export async function getBackupLog(id: string): Promise<string | null> {
  const [row] = await db.select({ log: backups.log }).from(backups).where(eq(backups.id, id));
  return row?.log ?? null;
}

export interface NewBackup {
  kind: string;
  storageKey: string;
  sizeBytes: number;
  status: string;
  error: string | null;
  /** The attempt's own output, redacted and capped. */
  log: string | null;
  createdBy: string | null;
}

export async function insertBackup(fields: NewBackup): Promise<string> {
  const [row] = await db.insert(backups).values(fields).returning({ id: backups.id });
  return row!.id;
}

export async function deleteBackupRow(id: string): Promise<void> {
  await db.delete(backups).where(eq(backups.id, id));
}

/** The most recent *completed* backup of a kind — for the scheduler's "is it due?" check. */
export async function lastCompleted(kind: string): Promise<BackupRow | null> {
  const [row] = await withCreator()
    .where(and(eq(backups.kind, kind), eq(backups.status, "completed")))
    .orderBy(desc(backups.createdAt))
    .limit(1);
  return row ?? null;
}

/** Completed backups of a kind older than the cutoff — the retention prune set. */
export async function expiredBackups(kind: string, olderThan: Date): Promise<BackupRow[]> {
  return withCreator().where(and(eq(backups.kind, kind), lt(backups.createdAt, olderThan)));
}
