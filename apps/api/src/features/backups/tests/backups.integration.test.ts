// Author: Brijesh Dave <https://github.com/brijeshdave>
// Backups end-to-end: a superadmin takes a database backup (a real pg_dump), it appears
// in the list, downloads as bytes, and deletes; the endpoints are gated by permission.
import { execFile } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { env } from "@/core/env.js";
import { localRoot } from "@/core/storage/local.js";
import { runFilesBackup } from "@/features/backups/service.js";
import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
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

function inject(method: string, url: string, cookie: string) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
  });
}

describe("backups", () => {
  it("takes a database backup, records it, downloads a completed one, and deletes it", async () => {
    const admin = await superadmin();

    const made = await inject("POST", "/backups?kind=database", admin);
    expect(made.statusCode).toBe(200);
    expect(made.json().kind).toBe("database");
    const backup = made.json();
    const id = backup.id;

    // The row is catalogued whatever the outcome. pg_dump must be on the API host for it
    // to complete; where it is, the dump downloads as bytes — where it is not, the row is
    // recorded as failed with the reason, which is the point of recording it.
    const list = (await inject("GET", "/backups", admin)).json();
    expect(list.some((b: { id: string }) => b.id === id)).toBe(true);

    if (backup.status === "completed") {
      expect(backup.sizeBytes).toBeGreaterThan(0);
      const download = await inject("GET", `/backups/${id}/download`, admin);
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload.length).toBeGreaterThan(0);
    } else {
      expect(backup.error).toBeTruthy();
      expect((await inject("GET", `/backups/${id}/download`, admin)).statusCode).toBe(400);
    }

    expect((await inject("DELETE", `/backups/${id}`, admin)).statusCode).toBe(204);
    const after = (await inject("GET", "/backups", admin)).json();
    expect(after.some((b: { id: string }) => b.id === id)).toBe(false);
  });

  it("does not put earlier backups inside a files backup", async () => {
    // Backups are written through the storage backend, so on disk they sit under
    // the upload root — the very directory a files backup archives. Without an
    // exclusion each run swallows the ones before it: the second holds the first,
    // the third holds both, and the archive grows exponentially over a store
    // whose actual contents never changed.
    const root = localRoot(env.STORAGE_LOCAL_DIR);
    await mkdir(join(root, "backups", "db"), { recursive: true });
    await writeFile(join(root, "attachment.bin"), Buffer.alloc(2048, 7));
    // A plausible earlier backup, big enough that its presence is unmistakable.
    await writeFile(join(root, "backups", "db", "earlier.dump"), Buffer.alloc(65536, 3));

    const made = await runFilesBackup(null);
    expect(made.status).toBe("completed");

    // Read the archive back and list it: the assertion is about what is inside,
    // not merely that the command exited zero. The storage key is deliberately
    // not on the public shape, so find the artifact where it was written.
    const written = await readdir(join(root, "backups", "files"));
    expect(written).toHaveLength(1);
    const archive = join(root, "backups", "files", written[0]!);
    const { stdout } = await promisify(execFile)("tar", ["tzf", archive]);
    const entries = stdout.split("\n").filter(Boolean);

    expect(entries).toEqual(expect.arrayContaining(["./attachment.bin"]));
    expect(entries.some((e) => e.includes("earlier.dump"))).toBe(false);
    expect(entries.some((e) => e.startsWith("./backups"))).toBe(false);
  });

  // Whether pg_dump exists on the host decides whether this backup completes, so
  // the assertions are about the transcript being kept and readable — which is
  // true either way, and is the thing that was missing.
  it("keeps what each attempt said, and hands it back as a file", async () => {
    const admin = await superadmin();
    const backup = (await inject("POST", "/backups?kind=database", admin)).json();

    // The list says whether there is anything to read, without carrying it: a
    // transcript per row would make this screen's payload enormous.
    expect(backup.hasLog).toBe(true);
    expect(JSON.stringify(backup)).not.toContain("command  ");

    const log = await inject("GET", `/backups/${backup.id}/log`, admin);
    expect(log.statusCode).toBe(200);
    expect(log.headers["content-type"]).toContain("text/plain");
    expect(log.headers["content-disposition"]).toContain(".log");
    // When it ran, what ran, and how it ended — enough to answer "why did this
    // fail?" weeks later, when log retention has pruned its side of the story.
    expect(log.body).toContain("started");
    expect(log.body).toContain("command");
    expect(log.body).toContain("outcome");
  });

  it("refuses the backup endpoints without authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/backups`,
      headers: { "x-company-id": DEMO_COMPANY_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a restore without the typed confirmation", async () => {
    const admin = await superadmin();
    // The wrong confirmation is rejected by validation before any restore runs — so this
    // never touches the database, whatever id is given.
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/backups/11111111-2222-3333-4444-555555555555/restore`,
      headers: { cookie: admin, "x-company-id": DEMO_COMPANY_ID },
      payload: { confirm: "please" },
    });
    expect(res.statusCode).toBe(400);
    // The upload restore likewise needs confirm=RESTORE in the query.
    const upload = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/backups/restore/upload?kind=database&confirm=nope`,
      headers: { cookie: admin, "x-company-id": DEMO_COMPANY_ID },
    });
    expect(upload.statusCode).toBe(400);
  });
});
