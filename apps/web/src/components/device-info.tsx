// Author: Brijesh Dave <https://github.com/brijeshdave>
// Rendering a captured device: a one-line summary for a table cell, and the full
// breakdown for a detail drawer. Both tolerate a mostly-empty device, since a
// background job or an old client fills in little.
import type { DeviceInfo } from "@reportly/shared";
import { Monitor, Smartphone, Tablet } from "lucide-react";

import { DetailRow } from "@/components/detail-drawer.js";

function DeviceIcon({ type }: { type?: DeviceInfo["deviceType"] }) {
  const className = "h-3.5 w-3.5 text-muted-foreground";
  if (type === "mobile") return <Smartphone className={className} />;
  if (type === "tablet") return <Tablet className={className} />;
  return <Monitor className={className} />;
}

/** `Chrome 126 · Windows 11` — the compact form for a table column. */
export function DeviceSummary({ device }: { device: DeviceInfo | null }) {
  if (!device) return <span className="text-muted-foreground">—</span>;
  const parts = [device.browser, device.os].filter(Boolean);
  if (parts.length === 0 && device.deviceType) parts.push(device.deviceType);
  if (parts.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <DeviceIcon type={device.deviceType} />
      <span className="truncate">{parts.join(" · ")}</span>
    </span>
  );
}

function geoLine(geo: NonNullable<DeviceInfo["geo"]>): string {
  return [geo.city, geo.region, geo.country].filter(Boolean).join(", ");
}

/** The full device, as labelled rows for a detail drawer. */
export function DeviceDetails({ device }: { device: DeviceInfo }) {
  return (
    <div>
      {device.browser ? <DetailRow label="Browser">{device.browser}</DetailRow> : null}
      {device.os ? <DetailRow label="OS">{device.os}</DetailRow> : null}
      {device.deviceType ? <DetailRow label="Type">{device.deviceType}</DetailRow> : null}
      {device.geo && geoLine(device.geo) ? (
        <DetailRow label="Location">{geoLine(device.geo)}</DetailRow>
      ) : null}
      {device.forwardedFor ? (
        <DetailRow label="Proxy chain">
          <span className="break-all text-xs">{device.forwardedFor}</span>
        </DetailRow>
      ) : null}
      {device.timezone ? <DetailRow label="Timezone">{device.timezone}</DetailRow> : null}
      {device.languages && device.languages.length > 0 ? (
        <DetailRow label="Languages">{device.languages.join(", ")}</DetailRow>
      ) : null}
      {device.screen ? <DetailRow label="Screen">{device.screen}</DetailRow> : null}
      {device.viewport ? <DetailRow label="Viewport">{device.viewport}</DetailRow> : null}
      {device.platform ? <DetailRow label="Platform">{device.platform}</DetailRow> : null}
      {device.gpu ? <DetailRow label="GPU">{device.gpu}</DetailRow> : null}
      {device.cores ? <DetailRow label="CPU cores">{device.cores}</DetailRow> : null}
      {device.memory ? <DetailRow label="Memory">{device.memory} GB</DetailRow> : null}
      {device.fingerprint ? (
        <DetailRow label="Fingerprint">
          <code className="text-xs">{device.fingerprint}</code>
        </DetailRow>
      ) : null}
      {device.userAgent ? (
        <DetailRow label="User-Agent">
          <span className="break-all text-xs text-muted-foreground">{device.userAgent}</span>
        </DetailRow>
      ) : null}
    </div>
  );
}
