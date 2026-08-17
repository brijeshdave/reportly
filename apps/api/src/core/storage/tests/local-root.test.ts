// Author: Brijesh Dave <https://github.com/brijeshdave>
// Where the local backend actually puts its root.
//
// `STORAGE_LOCAL_DIR` defaults to a relative "uploads", which is right for
// development — it lands beside the process. Every container deployment sets it
// to an absolute path instead, because the whole point is to reach a mounted
// volume rather than the container's own filesystem.
//
// Those two cases need different handling, and only one of them was handled.
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";

import { localRoot } from "@/core/storage/local.js";

describe("localRoot", () => {
  it("resolves a relative directory against the working directory", () => {
    // The development case: `uploads` means "beside the process".
    expect(localRoot("uploads")).toBe(join(process.cwd(), "uploads"));
  });

  it("leaves an absolute directory alone", () => {
    // The deployment case, and the one that matters. compose sets
    // STORAGE_LOCAL_DIR=/data/uploads and mounts the volume at /data. Joined
    // against a working directory of /app that becomes /app/data/uploads —
    // inside the container, on a filesystem the deploy throws away. Attachments,
    // avatars and every backup file would be written somewhere nothing is
    // mounted, and vanish on the next release with no error at any point.
    expect(localRoot("/data/uploads")).toBe("/data/uploads");
    expect(isAbsolute(localRoot("/data/uploads"))).toBe(true);
  });

  it("does not nest an absolute path under the working directory", () => {
    // Said the other way round, because this is the specific failure: the bug is
    // silent, and the only visible symptom is data that is simply gone later.
    expect(localRoot("/srv/reportly/uploads")).not.toContain(process.cwd());
  });
});
