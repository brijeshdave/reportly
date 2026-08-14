// Author: Brijesh Dave <https://github.com/brijeshdave>
// Analytics and home-screen calls. Every response here is derived server-side —
// there is nothing to cache locally beyond the query cache, and no figure is ever
// recomputed in the browser: a client that did its own maths would disagree with
// the API the moment a rule changed.
import type {
  AssetReliabilityReport,
  Insights,
  MyDay,
  RecurrenceLink,
  RecurringIssue,
  AnalyticsWindow,
  JournalTimeline,
} from "@reportly/shared";

import { http } from "@/services/http.js";

/** An explicit window; omitted fields let the server apply its default (90 days). */
export interface WindowParams {
  from?: string;
  to?: string;
}

const windowQuery = (w: WindowParams): string => {
  const params = new URLSearchParams();
  if (w.from) params.set("from", w.from);
  if (w.to) params.set("to", w.to);
  const q = params.toString();
  return q ? `?${q}` : "";
};

export function fetchAssetReliability(
  assetId: string,
  window: WindowParams = {},
): Promise<AssetReliabilityReport> {
  return http.get<AssetReliabilityReport>(`/analytics/assets/${assetId}${windowQuery(window)}`);
}

export function fetchRecurring(
  window: WindowParams & { assetId?: string } = {},
): Promise<{ window: AnalyticsWindow; items: RecurringIssue[] }> {
  const params = new URLSearchParams();
  if (window.from) params.set("from", window.from);
  if (window.to) params.set("to", window.to);
  if (window.assetId) params.set("assetId", window.assetId);
  const q = params.toString();
  return http.get(`/analytics/recurring${q ? `?${q}` : ""}`);
}

export function fetchTimeline(reportId: string): Promise<JournalTimeline> {
  return http.get<JournalTimeline>(`/journal/${reportId}/timeline`);
}

export function fetchRecurrences(reportId: string): Promise<RecurrenceLink[]> {
  return http.get<RecurrenceLink[]>(`/journal/${reportId}/recurrences`);
}

/**
 * The home screen, in one request.
 *
 * The timezone offset is sent from the browser because only the browser knows it:
 * `getTimezoneOffset()` counts minutes *west* of UTC, so it is negated here to
 * match the server's east-positive convention. Getting this backwards would shift
 * every operator's "today" by twice their offset — which looks fine in UTC and
 * wrong everywhere else, so it is done once, here, rather than at each call site.
 */
export function fetchMyDay(): Promise<MyDay> {
  const tzOffsetMinutes = -new Date().getTimezoneOffset();
  return http.get<MyDay>(`/my-day?tzOffsetMinutes=${tzOffsetMinutes}`);
}

/**
 * Every Insights chart for a window, in one call.
 *
 * One request rather than six: they share a window and are read as one picture,
 * and six staggered responses would make the page assemble itself on screen.
 */
export function fetchInsights(params: WindowParams = {}): Promise<Insights> {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  const suffix = query.toString();
  return http.get<Insights>(`/insights${suffix ? `?${suffix}` : ""}`);
}
