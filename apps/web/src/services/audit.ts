// Author: Brijesh Dave <https://github.com/brijeshdave>
// Audit service calls. The listing itself goes through the generic list service.
import { http } from "@/services/http.js";

/**
 * The action names actually present in the trail, for the filter to offer.
 *
 * Read from the rows rather than a hand-kept list: audit actions are free strings
 * written by each feature, and a catalogue would drift the first time one was
 * added.
 */
export function fetchAuditActions(): Promise<string[]> {
  return http.get<string[]>("/audit-events/actions");
}
