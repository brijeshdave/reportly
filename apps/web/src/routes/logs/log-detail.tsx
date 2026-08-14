// Author: Brijesh Dave <https://github.com/brijeshdave>
// One log line, opened up. A row in the table is a summary; this is everything the
// line carries, segmented into what an operator actually looks for — when, what,
// which request, who — with the raw context last for when the rest is not enough.
import { formatDateTime } from "@reportly/shared";
import type { LogEntry } from "@reportly/shared";

import { DetailDrawer, DetailJson, DetailRow, DetailSection } from "@/components/detail-drawer.js";
import { UserRef } from "@/components/user-ref.js";
import { extraContext, formatRequestSummary, requestSummary } from "@/lib/log-format.js";
import { LevelBadge } from "@/routes/logs/level-badge.js";

export function LogDetail({ entry, onClose }: { entry: LogEntry; onClose: () => void }) {
  const summary = requestSummary(entry);
  const extra = extraContext(entry);

  return (
    <DetailDrawer
      label="Log details"
      onClose={onClose}
      header={
        <div className="flex items-center gap-2">
          <LevelBadge level={entry.level} />
          <span className="text-sm font-medium">{entry.feature}</span>
        </div>
      }
    >
      <DetailSection title="Message">
        <p className="text-sm">{entry.msg}</p>
      </DetailSection>

      {summary ? (
        <DetailSection title="Request">
          <p className="font-mono text-sm">{formatRequestSummary(summary)}</p>
          <div className="mt-2">
            {summary.method ? <DetailRow label="Method">{summary.method}</DetailRow> : null}
            {summary.url ? <DetailRow label="URL">{summary.url}</DetailRow> : null}
            {summary.status !== undefined ? (
              <DetailRow label="Status">{summary.status}</DetailRow>
            ) : null}
            {summary.durationMs !== undefined ? (
              <DetailRow label="Duration">{summary.durationMs} ms</DetailRow>
            ) : null}
          </div>
        </DetailSection>
      ) : null}

      <DetailSection title="When">
        <DetailRow label="Timestamp">{formatDateTime(entry.ts)}</DetailRow>
        <DetailRow label="ISO">
          <code className="text-xs">{entry.ts}</code>
        </DetailRow>
      </DetailSection>

      <DetailSection title="Trace">
        <DetailRow label="Request ID">
          {entry.requestId ? <code className="text-xs">{entry.requestId}</code> : "—"}
        </DetailRow>
        <DetailRow label="User">{entry.userId ? <UserRef userId={entry.userId} /> : "—"}</DetailRow>
        <DetailRow label="Company ID">
          {entry.companyId ? <code className="text-xs">{entry.companyId}</code> : "—"}
        </DetailRow>
      </DetailSection>

      {extra ? (
        <DetailSection title="Context">
          <DetailJson value={extra} />
        </DetailSection>
      ) : null}
    </DetailDrawer>
  );
}
