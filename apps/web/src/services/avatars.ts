// Author: Brijesh Dave <https://github.com/brijeshdave>
// Profile picture calls. The image is resized in the browser first (see
// lib/resize-image), so what goes up is a small base64 PNG rather than a photo.
import { http } from "@/services/http.js";

/** Returns the new version stamp, which the image URL carries as a cache-buster. */
export function uploadAvatar(userId: string, base64: string): Promise<{ version: number }> {
  return http.put<{ version: number }>(`/users/${userId}/avatar`, { data: base64 });
}

export function removeAvatar(userId: string): Promise<void> {
  return http.delete<void>(`/users/${userId}/avatar`);
}
