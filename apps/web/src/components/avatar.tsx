// Author: Brijesh Dave <https://github.com/brijeshdave>
// A person's picture, or their initials when they have none.
//
// The fallback is not a grey silhouette: a wall of identical placeholders is worse
// than no pictures at all, because it makes people harder to tell apart rather than
// easier. Initials on a colour derived from the person's id give every face a
// distinct, stable look from the very first render, with no upload required.
import { useState } from "react";

/** Stable hue from a user id: the same person is always the same colour. */
function hueFor(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/**
 * The image URL for a stored picture. `version` is when it last changed, so a new
 * picture is a new URL — the browser cannot serve a stale face from its cache — and
 * an unchanged one is never fetched twice.
 */
export function avatarUrl(userId: string, version: number): string {
  return `/api/v1/users/${userId}/avatar?v=${version}`;
}

const SIZES = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-10 w-10 text-xs",
  lg: "h-16 w-16 text-lg",
  xl: "h-24 w-24 text-2xl",
} as const;

export function Avatar({
  userId,
  name,
  version,
  size = "md",
  className = "",
}: {
  userId: string;
  name: string;
  /** null when they have no picture — then initials are shown. */
  version?: number | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  // A picture that fails to load (deleted between render and fetch) falls back to
  // the initials rather than to a broken-image icon.
  const [failed, setFailed] = useState(false);
  const shape = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${SIZES[size]} ${className}`;

  if (version && !failed) {
    return (
      <img
        src={avatarUrl(userId, version)}
        alt=""
        aria-hidden
        onError={() => setFailed(true)}
        className={`${shape} bg-muted object-cover`}
      />
    );
  }

  const hue = hueFor(userId);
  return (
    <span
      aria-hidden
      className={shape}
      style={{
        backgroundColor: `hsl(${hue} 65% 88%)`,
        color: `hsl(${hue} 55% 28%)`,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
