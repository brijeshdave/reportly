// Author: Brijesh Dave <https://github.com/brijeshdave>
// Files on a report. The upload is the one call in the app that does not send JSON:
// it posts a FormData body, so the browser sets the multipart boundary itself.
import {
  type Attachment,
  type AttachmentOwnerType,
  type UploadLimits,
  uploadLimitsSchema,
} from "@reportly/shared";

import { API_BASE, download, http } from "@/services/http.js";

/**
 * The limits the server will enforce. Read from the server rather than assumed, so
 * the hint on the form and the rule in the API cannot drift apart.
 */
export async function fetchUploadLimits(): Promise<UploadLimits> {
  return uploadLimitsSchema.parse(await http.get<unknown>("/upload-limits"));
}

/**
 * Where a kind of record's files live.
 *
 * Spelled out rather than derived from the owner type. It used to be
 * `` `/${ownerType}s/...` ``, which produced `/reports/:id/attachments` — and that
 * route stopped existing when the domain was renamed to Journal, so every file on
 * a journal entry 404'd while the type still said `report`. The owner type is a
 * domain word; the path is an API fact, and inferring one from the other is what
 * let them drift apart silently.
 */
const OWNER_PATHS: Record<AttachmentOwnerType, string> = {
  report: "journal",
  task: "tasks",
  "routine-completion": "routine-completions",
};

const ownerPath = (ownerType: AttachmentOwnerType, ownerId: string) =>
  `/${OWNER_PATHS[ownerType]}/${ownerId}/attachments`;

export const fetchAttachments = (ownerType: AttachmentOwnerType, ownerId: string) =>
  http.get<Attachment[]>(ownerPath(ownerType, ownerId));

/**
 * Posts one file. `http.postForm` sends the FormData untouched — setting a
 * content-type header by hand here would omit the boundary and the server would
 * reject the body it just built.
 */
export const uploadAttachment = (ownerType: AttachmentOwnerType, ownerId: string, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<Attachment>(ownerPath(ownerType, ownerId), form);
};

export const deleteAttachment = (id: string) => http.delete<void>(`/attachments/${id}`);

/**
 * Fetches the bytes and saves them, rather than pointing a plain link at the URL.
 * A bare `<a href>` would send the cookie but none of our headers — including
 * X-Company-Id, which is what the caller's permissions are resolved against — so
 * the link would 403 for everyone who is not a superadmin.
 */
export const downloadAttachment = (id: string, filename: string) =>
  download(`/attachments/${id}`, filename);

/**
 * The file's own URL, for an `<img src>`.
 *
 * Same-origin — the dev server proxies `/api`, and in production the web and API
 * sit behind one host — so the session cookie is sent automatically and no signed
 * URL or token has to be minted. The API answers with
 * `Content-Disposition: attachment`, which an `<img>` ignores and a navigation
 * obeys: the picture renders here, and following the link still downloads rather
 * than running anything inline.
 */
export const attachmentUrl = (id: string): string => `${API_BASE}/attachments/${id}`;
