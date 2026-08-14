// Author: Brijesh Dave <https://github.com/brijeshdave>
// `cli storage:migrate` — the command an operator runs after switching backends.
//
// The two stand-in backends are both LocalStorage over temp directories, one playing
// "s3". That is deliberate: what is worth proving here is the *order* — verify the
// copy before repointing the row, repoint before deleting the original — and the
// refusal to move bytes that no longer match their checksum. None of that is about
// S3 specifically, and needing a live bucket to test it would mean it never got
// tested. The S3 provider itself is a thin wrapper over the AWS SDK.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { LocalStorage } from "@/core/storage/local.js";
import { migrateStorage } from "@/core/storage/migrate.js";
import type { StorageProvider } from "@/core/storage/provider.js";
import { attachmentsOnBackend } from "@/features/attachments/repo.js";
import type { StorageBackend } from "@reportly/shared";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

let app: Awaited<ReturnType<typeof buildApp>>;
let localDir: string;
let s3Dir: string;
let fakeLocal: LocalStorage;
let fakeS3: LocalStorage;

/** Stands in for `storageFor`, handing back the two temp-directory backends. */
const resolve = (backend: StorageBackend): StorageProvider =>
  backend === "s3" ? fakeS3 : fakeLocal;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  localDir = await mkdtemp(join(tmpdir(), "reportly-local-"));
  s3Dir = await mkdtemp(join(tmpdir(), "reportly-s3-"));
  fakeLocal = new LocalStorage(localDir);
  fakeS3 = new LocalStorage(s3Dir);
});
afterAll(async () => {
  await app.close();
  await rm(localDir, { recursive: true, force: true });
  await rm(s3Dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDb();
});

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => String(c).split(";")[0]).join("; ");
}

async function superadmin(): Promise<string> {
  const password = await resetSuperadmin();
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: "admin@reportly.local", password },
  });
  return cookieFrom(res);
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

/** A report with one uploaded file, whose bytes are put on the `local` stand-in. */
async function seedFile(admin: string): Promise<{ id: string; key: string }> {
  const report = (
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/journal`,
      headers: { cookie: admin, "x-company-id": DEMO_COMPANY_ID },
      payload: { kind: "issue", title: "Belt seized", state: "submitted" },
    })
  ).json();

  const boundary = "----b";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="belt.png"\r\n` +
        `Content-Type: image/png\r\n\r\n`,
    ),
    PNG,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const uploaded = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/journal/${report.id}/attachments`,
    headers: {
      cookie: admin,
      "x-company-id": DEMO_COMPANY_ID,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    payload,
  });
  expect(uploaded.statusCode).toBe(201);

  // The upload went to the real configured backend; copy the bytes onto the
  // stand-in "local" so the migration has something to find.
  const [row] = await attachmentsOnBackend("local");
  await fakeLocal.put(row!.key, PNG, "image/png");
  return { id: uploaded.json().id as string, key: row!.key };
}

describe("storage:migrate", () => {
  it("moves a file to the target backend and repoints the row", async () => {
    const admin = await superadmin();
    const { key } = await seedFile(admin);

    const result = await migrateStorage({ target: "s3", resolve });
    expect(result.moved).toBe(1);
    expect(result.failed).toEqual([]);

    // The bytes are at the destination, byte-for-byte...
    expect((await fakeS3.get(key)).equals(PNG)).toBe(true);
    // ...the original is gone, so the move is a move and not a copy...
    expect(await fakeLocal.exists(key)).toBe(false);
    // ...and the row now says where the file actually is. Without this the file is
    // invisible: reads resolve the backend from the row.
    expect(await attachmentsOnBackend("local")).toHaveLength(0);
    expect(await attachmentsOnBackend("s3")).toHaveLength(1);
  });

  it("is safe to run twice and reports nothing left to do", async () => {
    const admin = await superadmin();
    await seedFile(admin);

    expect((await migrateStorage({ target: "s3", resolve })).moved).toBe(1);
    // Everything is already on the target, so the second run finds no work — which
    // is what makes this safe to re-run after a partial failure.
    const second = await migrateStorage({ target: "s3", resolve });
    expect(second.moved).toBe(0);
    expect(second.failed).toEqual([]);
  });

  it("changes nothing on a dry run", async () => {
    const admin = await superadmin();
    const { key } = await seedFile(admin);

    const result = await migrateStorage({ target: "s3", resolve, dryRun: true });
    expect(result.skipped).toBe(1);
    expect(result.moved).toBe(0);

    // Still where it was, and the row still says so.
    expect(await fakeLocal.exists(key)).toBe(true);
    expect(await fakeS3.exists(key)).toBe(false);
    expect(await attachmentsOnBackend("local")).toHaveLength(1);
  });

  it("refuses to move bytes that no longer match their checksum, and keeps them", async () => {
    const admin = await superadmin();
    const { key } = await seedFile(admin);

    // The file rotted where it lay. Copying it on would launder a corrupt object
    // into the new backend and report success.
    await fakeLocal.put(key, Buffer.from("not the original bytes"), "image/png");

    const result = await migrateStorage({ target: "s3", resolve });
    expect(result.moved).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toMatch(/checksum mismatch at source/);

    // Nothing was deleted and nothing was repointed — the damage is reported, not
    // spread and not compounded by losing the only copy.
    expect(await fakeLocal.exists(key)).toBe(true);
    expect(await attachmentsOnBackend("local")).toHaveLength(1);
  });

  it("leaves the original in place when the destination copy does not verify", async () => {
    const admin = await superadmin();
    const { key } = await seedFile(admin);

    // A backend that accepts a write and hands back something else — the shape of a
    // silently truncated or corrupted upload.
    const lyingS3: StorageProvider = {
      name: "s3",
      put: async () => undefined,
      get: async () => Buffer.from("truncated"),
      delete: async () => undefined,
      exists: async () => true,
    };

    const result = await migrateStorage({
      target: "s3",
      resolve: (b) => (b === "s3" ? lyingS3 : fakeLocal),
    });
    expect(result.moved).toBe(0);
    expect(result.failed[0]!.reason).toMatch(/did not verify at the destination/);

    // The only good copy still exists and the row still points at it.
    expect((await fakeLocal.get(key)).equals(PNG)).toBe(true);
    expect(await attachmentsOnBackend("local")).toHaveLength(1);
  });
});
