// Author: Brijesh Dave <https://github.com/brijeshdave>
// Building a DeviceInfo from a request, for security and audit events. The server
// owns the parts the client must not be trusted for — IP, User-Agent, client hints
// and geo — and merges the small signed-nothing client payload (timezone, screen,
// fingerprint) that only the browser can know. Every field is best-effort: a
// background job has no request and no device.
import type { ClientDevice, DeviceInfo, GeoInfo } from "@reportly/shared";
import { clientDeviceSchema } from "@reportly/shared";
import type { FastifyRequest } from "fastify";

import { lookupGeo } from "@/core/geoip.js";

const DEVICE_HEADER = "x-device-info";

/** A minimal User-Agent parse — enough to name the browser, OS and form factor. */
function parseUserAgent(ua: string): Pick<DeviceInfo, "browser" | "os" | "deviceType"> {
  const browser = (() => {
    let m;
    if ((m = ua.match(/Edg(?:e|A|iOS)?\/(\d+)/))) return `Edge ${m[1]}`;
    if ((m = ua.match(/OPR\/(\d+)/)) || (m = ua.match(/Opera\/(\d+)/))) return `Opera ${m[1]}`;
    if ((m = ua.match(/SamsungBrowser\/(\d+)/))) return `Samsung Internet ${m[1]}`;
    if ((m = ua.match(/Firefox\/(\d+)/))) return `Firefox ${m[1]}`;
    if ((m = ua.match(/Chrome\/(\d+)/))) return `Chrome ${m[1]}`;
    if (/Safari\//.test(ua) && (m = ua.match(/Version\/(\d+)/))) return `Safari ${m[1]}`;
    if (/bot|crawler|spider|slurp/i.test(ua)) return "Bot";
    return null;
  })();

  const os = (() => {
    let m;
    if ((m = ua.match(/Windows NT (\d+\.\d+)/))) {
      const map: Record<string, string> = { "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7" };
      return `Windows ${map[m[1] ?? ""] ?? m[1]}`;
    }
    if ((m = ua.match(/Android (\d+)/))) return `Android ${m[1]}`;
    if (/iPhone|iPad|iPod/.test(ua)) {
      m = ua.match(/OS (\d+)_/);
      return `iOS${m ? " " + m[1] : ""}`;
    }
    if ((m = ua.match(/Mac OS X (\d+[._]\d+)/))) return `macOS ${(m[1] ?? "").replace("_", ".")}`;
    if (/CrOS/.test(ua)) return "ChromeOS";
    if (/Linux/.test(ua)) return "Linux";
    return null;
  })();

  const deviceType: DeviceInfo["deviceType"] = /bot|crawler|spider|slurp/i.test(ua)
    ? "bot"
    : /iPad|Tablet/.test(ua)
      ? "tablet"
      : /Mobi|Android|iPhone|iPod/.test(ua)
        ? "mobile"
        : ua
          ? "desktop"
          : "unknown";

  return { browser, os, deviceType };
}

/** Sec-CH-UA-* headers, kept raw for the record. */
function clientHints(request: FastifyRequest): Record<string, string> | null {
  const hints: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.startsWith("sec-ch-ua") && typeof value === "string") hints[key] = value;
  }
  return Object.keys(hints).length > 0 ? hints : null;
}

/** Accept-Language into a short ordered list of tags. */
function languages(request: FastifyRequest): string[] | null {
  const header = request.headers["accept-language"];
  if (typeof header !== "string") return null;
  const tags = header
    .split(",")
    .map((part) => part.split(";")[0]?.trim())
    .filter((tag): tag is string => Boolean(tag))
    .slice(0, 10);
  return tags.length > 0 ? tags : null;
}

/** Decode the base64 JSON client payload, validated; never throws. */
function clientPayload(request: FastifyRequest): ClientDevice {
  const raw = request.headers[DEVICE_HEADER];
  if (typeof raw !== "string" || raw === "") return {};
  try {
    const json = Buffer.from(raw, "base64").toString("utf8");
    const parsed = clientDeviceSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Assemble the full device record for a request. */
export async function deviceFromRequest(request: FastifyRequest): Promise<DeviceInfo> {
  const ua = typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : "";
  const client = clientPayload(request);
  const geo: GeoInfo | null = await lookupGeo(request.ip);

  // The raw forwarded chain, kept alongside the resolved ip. request.ip is the real
  // client only when TRUST_PROXY is set to match the deployment's proxy depth; this
  // header shows every hop regardless, which is what you want when there is more
  // than one proxy and the resolved ip looks like the proxy (e.g. 127.0.0.1).
  const forwarded = request.headers["x-forwarded-for"];
  const forwardedFor =
    (typeof forwarded === "string"
      ? forwarded
      : Array.isArray(forwarded)
        ? forwarded.join(", ")
        : null) ??
    (typeof request.headers["x-real-ip"] === "string" ? request.headers["x-real-ip"] : null);

  return {
    ip: request.ip,
    forwardedFor,
    userAgent: ua || null,
    ...parseUserAgent(ua),
    // The client knows its own languages best; fall back to Accept-Language.
    languages: client.languages ?? languages(request),
    timezone: client.timezone ?? null,
    screen: client.screen ?? null,
    viewport: client.viewport ?? null,
    platform: client.platform ?? null,
    gpu: client.gpu ?? null,
    cores: client.cores ?? null,
    memory: client.memory ?? null,
    clientHints: clientHints(request),
    fingerprint: client.fingerprint ?? null,
    geo,
  };
}
