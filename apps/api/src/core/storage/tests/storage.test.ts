// Author: Brijesh Dave <https://github.com/brijeshdave>
// The local backend and the key generator — the parts that need no database.
//
// The traversal test is the important one here. Keys are server-generated today, so
// it guards a door nobody can currently reach; that is the point of having it, since
// the day a key comes from somewhere else this already holds.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LocalStorage, checksumOf } from "@/core/storage/local.js";
import { newKey } from "@/core/storage/index.js";

let root: string;
let storage: LocalStorage;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "reportly-storage-"));
  storage = new LocalStorage(root);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LocalStorage", () => {
  it("puts, gets, checks and deletes", async () => {
    const body = Buffer.from("the belt seized at 09:00");
    const key = "report/abc/file.txt";

    expect(await storage.exists(key)).toBe(false);
    await storage.put(key, body, "text/plain");

    expect(await storage.exists(key)).toBe(true);
    expect((await storage.get(key)).equals(body)).toBe(true);
    // It really is on disk where the key says, nested directories and all.
    expect((await readFile(join(root, key))).equals(body)).toBe(true);

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it("treats deleting something already gone as success", async () => {
    await expect(storage.delete("report/nothing/here.txt")).resolves.toBeUndefined();
  });

  it("refuses a key that climbs out of the storage root", async () => {
    await expect(storage.put("../../escaped.txt", Buffer.from("x"), "text/plain")).rejects.toThrow(
      /escapes the storage root/,
    );
    await expect(storage.get("../../../etc/passwd")).rejects.toThrow(/escapes the storage root/);
  });
});

describe("newKey", () => {
  it("never uses the uploader's filename as the path", () => {
    const key = newKey("report", "abc", "../../etc/passwd");
    expect(key.startsWith("report/abc/")).toBe(true);
    expect(key).not.toContain("..");
    expect(key).not.toContain("passwd");
  });

  it("keeps a plain extension so a download opens in the right thing", () => {
    expect(newKey("report", "abc", "belt.png").endsWith(".png")).toBe(true);
    expect(newKey("report", "abc", "REPORT.PDF").endsWith(".pdf")).toBe(true);
  });

  it("drops an extension that is not one", () => {
    // Nothing here should end up in a path, so anything odd is simply not carried.
    expect(newKey("report", "abc", "weird.na me").endsWith(".na me")).toBe(false);
    expect(newKey("report", "abc", "noextension")).toMatch(/^report\/abc\/[0-9a-f-]{36}$/);
  });

  it("gives two uploads of the same filename different keys", () => {
    expect(newKey("report", "abc", "photo.jpg")).not.toBe(newKey("report", "abc", "photo.jpg"));
  });
});

describe("checksumOf", () => {
  it("is the sha256 of the bytes", () => {
    // The known digest of "abc" — a wrong implementation cannot accidentally match.
    expect(checksumOf(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("differs for a single changed byte", () => {
    expect(checksumOf(Buffer.from("abc"))).not.toBe(checksumOf(Buffer.from("abd")));
  });
});
