// Author: Brijesh Dave <https://github.com/brijeshdave>
// Generated reports — running a report shape into a grouped result, downloading it,
// and the CRUD for the saved report views. The row scope is the server's business;
// the client only ever sends a definition or a view id.
import type {
  CloneReportView,
  CreateReportView,
  ReportResult,
  ReportView,
  RunReport,
  LeaderboardResult,
  UpdateReportView,
} from "@reportly/shared";

import { PICKER_PAGE_SIZE, downloadPost, http } from "@/services/http.js";

/** The browser's UTC offset (minutes east of UTC), so ranges land on the local day. */
function tzQuery(): { tzOffsetMinutes: number } {
  return { tzOffsetMinutes: -new Date().getTimezoneOffset() };
}

export const runReport = (run: RunReport) =>
  http.post<ReportResult>("/reports/run", run, { query: tzQuery() });

export const fetchReportViews = () => http.get<ReportView[]>("/report-views");
export const fetchReportView = (id: string) => http.get<ReportView>(`/report-views/${id}`);
export const createReportView = (input: CreateReportView) =>
  http.post<ReportView>("/report-views", input);
export const updateReportView = (id: string, input: UpdateReportView) =>
  http.patch<ReportView>(`/report-views/${id}`, input);
export const deleteReportView = (id: string) => http.delete<void>(`/report-views/${id}`);
export const cloneReportView = (id: string, input: CloneReportView) =>
  http.post<ReportView>(`/report-views/${id}/clone`, input);

const EXPORT_QUERY = () => ({ query: tzQuery() });

/** Download the report as an Excel workbook. */
export const exportReportXlsx = (run: RunReport, filename: string) =>
  downloadPost("/reports/export.xlsx", filename, run, EXPORT_QUERY());

/** Download the report as a standalone, print-ready A4 HTML page. */
export const exportReportHtml = (run: RunReport, filename: string) =>
  downloadPost("/reports/export.html", filename, run, EXPORT_QUERY());

/** The groups a `groups`-access view can be shared with. Flat list for the picker. */
export const fetchGroupsForPicker = () =>
  http
    .get<{ data: { id: string; name: string }[] }>("/groups", {
      query: { pageSize: PICKER_PAGE_SIZE },
    })
    .then((r) => r.data);

/** A flat list of devices for the report's device filter. */
export const fetchDevicesForPicker = () =>
  http
    .get<{ data: { id: string; name: string; identifier: string | null }[] }>("/devices", {
      query: { pageSize: PICKER_PAGE_SIZE },
    })
    .then((r) => r.data);

/** The top people for the leaderboard page, for a financial year (or a month in it). */
export const fetchLeaderboard = (params: {
  departmentId?: string;
  fyStart: number;
  month?: number;
  limit: number;
}) =>
  http.get<LeaderboardResult>("/reports/leaderboard", {
    query: {
      departmentId: params.departmentId || undefined,
      fyStart: params.fyStart,
      month: params.month,
      limit: params.limit,
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    },
  });
