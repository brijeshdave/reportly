// Author: Brijesh Dave <https://github.com/brijeshdave>
// The device a security or important event came from. Assembled server-side from
// the request (IP, User-Agent, client hints, Accept-Language) and enriched with a
// small client payload (timezone, screen, a fingerprint hash) so events can be
// correlated and anomalies — a login from an unfamiliar device or place — spotted.
// Every field is optional: a background job has no device, an old client sends no
// hints.
import { z } from "zod";

export const geoInfoSchema = z.object({
  country: z.string().optional(),
  region: z.string().optional(),
  city: z.string().optional(),
  asn: z.string().optional(),
});

export const deviceInfoSchema = z.object({
  /** The resolved client IP (from the trusted proxy hop; see TRUST_PROXY). */
  ip: z.string().nullish(),
  /** The raw X-Forwarded-For chain, so every proxy hop is visible for analysis. */
  forwardedFor: z.string().nullish(),
  userAgent: z.string().nullish(),
  /** Parsed from the User-Agent / client hints, e.g. "Chrome 126". */
  browser: z.string().nullish(),
  /** e.g. "Windows 11", "macOS 14", "Android 14". */
  os: z.string().nullish(),
  deviceType: z.enum(["desktop", "mobile", "tablet", "bot", "unknown"]).nullish(),
  /** Preferred languages, from Accept-Language or navigator.languages. */
  languages: z.array(z.string()).nullish(),
  timezone: z.string().nullish(),
  /** `"1920x1080"`. */
  screen: z.string().nullish(),
  viewport: z.string().nullish(),
  platform: z.string().nullish(),
  /** The WebGL renderer string — a strong device signal. */
  gpu: z.string().nullish(),
  /** Logical cores and rough device memory (GB), when the browser exposes them. */
  cores: z.number().nullish(),
  memory: z.number().nullish(),
  /** Raw Sec-CH-UA-* client hints, as received. */
  clientHints: z.record(z.string(), z.string()).nullish(),
  /** A stable-ish composite hash of the client signals, for grouping. */
  fingerprint: z.string().nullish(),
  geo: geoInfoSchema.nullish(),
});

export type DeviceInfo = z.infer<typeof deviceInfoSchema>;
export type GeoInfo = z.infer<typeof geoInfoSchema>;

/**
 * The client-collected half, sent in a header on requests. Kept separate from the
 * full `DeviceInfo` because the server never trusts the client for IP, UA or geo —
 * it fills those itself.
 */
export const clientDeviceSchema = z.object({
  timezone: z.string().max(64).optional(),
  screen: z.string().max(24).optional(),
  viewport: z.string().max(24).optional(),
  languages: z.array(z.string().max(35)).max(10).optional(),
  platform: z.string().max(64).optional(),
  gpu: z.string().max(128).optional(),
  cores: z.number().optional(),
  memory: z.number().optional(),
  fingerprint: z.string().max(64).optional(),
});

export type ClientDevice = z.infer<typeof clientDeviceSchema>;
