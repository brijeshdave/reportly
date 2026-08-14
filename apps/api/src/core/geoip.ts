// Author: Brijesh Dave <https://github.com/brijeshdave>
// IP geolocation, as an optional lookup. It stays a no-op unless a local GeoIP
// database is configured, because geolocating an address requires a data file
// (e.g. MaxMind GeoLite2) that we do not ship — its licence and size make it the
// operator's to provide, not the image's. This is the single seam to wire it into:
// point `GEOIP_DB` at a `.mmdb`, add a reader (`@maxmind/geoip2-node`), and fill in
// `lookupGeo`. Until then every event simply records no location, and nothing else
// changes.
import type { GeoInfo } from "@reportly/shared";

import { env } from "@/core/env.js";

/**
 * Geolocate a client IP. Returns null when no database is configured, or for a
 * private/loopback address, or on any failure — a missing location must never
 * fail the event it decorates.
 */
export async function lookupGeo(ip: string | null | undefined): Promise<GeoInfo | null> {
  if (!env.GEOIP_DB || !ip || isPrivate(ip)) return null;

  // Extension point: with GEOIP_DB set, open the reader once (module scope) and
  // return { country, region, city, asn }. Left unimplemented so the feature ships
  // without bundling a licensed database.
  return null;
}

function isPrivate(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith("fe80:") ||
    ip.startsWith("fc") ||
    ip.startsWith("fd")
  );
}
