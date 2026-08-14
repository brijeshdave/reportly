// Author: Brijesh Dave <https://github.com/brijeshdave>
// The client half of device capture. Collects the signals only the browser knows
// — timezone, screen, GPU, a canvas hash — and folds them into a fingerprint the
// server attaches to security events. Collected once and cached: it does not
// change within a session, and recomputing a canvas hash per request is wasteful.
//
// This is deliberately the moderate set. Font enumeration and audio fingerprinting
// add little for a self-hosted tool and a lot of fragility, so they are left out;
// the composite hash already distinguishes devices well enough to correlate.
import { deviceInfoSchema, type ClientDevice, type DeviceInfo } from "@reportly/shared";

/** FNV-1a, 32-bit, hex. Not cryptographic — just a stable id for grouping. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The WebGL renderer, which usually names the GPU. Empty when WebGL is blocked. */
function webglRenderer(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
    if (!gl || !("getExtension" in gl)) return "";
    const info = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
    if (!info) return "";
    return String(
      (gl as WebGLRenderingContext).getParameter(
        (info as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL,
      ),
    );
  } catch {
    return "";
  }
}

/** A hash of a rendered canvas — varies by GPU, drivers and anti-aliasing. */
function canvasHash(): string {
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(10, 1, 60, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("Reportly-fp-✨", 2, 15);
    return hash(canvas.toDataURL());
  } catch {
    return "";
  }
}

let cached: ClientDevice | null = null;

/** Collect the client device signals, once per session. */
export function collectClientDevice(): ClientDevice {
  if (cached) return cached;
  if (typeof window === "undefined") return {};

  const nav = window.navigator as Navigator & { deviceMemory?: number };
  const gpu = webglRenderer();
  const signals: ClientDevice = {
    timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    screen: safe(() => `${window.screen.width}x${window.screen.height}`),
    viewport: safe(() => `${window.innerWidth}x${window.innerHeight}`),
    languages: [...(nav.languages ?? [])].slice(0, 10),
    platform: safe(() => nav.platform),
    gpu: gpu || undefined,
    cores: nav.hardwareConcurrency,
    memory: nav.deviceMemory,
  };

  // The fingerprint folds in the canvas hash and the visible signals. Kept out of
  // the object above so the header stays small; the server does not need the raw
  // canvas, only that two devices differ.
  signals.fingerprint = hash(
    JSON.stringify(signals) + gpu + canvasHash() + (safe(() => nav.userAgent) ?? ""),
  );

  cached = signals;
  return signals;
}

/** The `X-Device-Info` header value: base64 JSON, or "" when nothing is available. */
export function deviceHeaderValue(): string {
  const device = collectClientDevice();
  if (Object.keys(device).length === 0) return "";
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(device))));
  } catch {
    return "";
  }
}

/** Pull a stored `DeviceInfo` out of an audit event's details jsonb, if present. */
export function deviceFromDetails(details: unknown): DeviceInfo | null {
  if (!details || typeof details !== "object") return null;
  const device = (details as { device?: unknown }).device;
  if (!device) return null;
  const parsed = deviceInfoSchema.safeParse(device);
  return parsed.success ? parsed.data : null;
}

function safe<T>(get: () => T): T | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}
