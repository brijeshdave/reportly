// Author: Brijesh Dave <https://github.com/brijeshdave>
// A tag, rendered in its own colour.
//
// The colour is arbitrary — an admin may pick any hex — so the chip cannot rely on
// the theme's tokens for contrast. It paints a solid background in the tag's colour
// and picks the text colour from that colour's **luminance**, which means the label
// stays readable on a lemon-yellow tag and on a navy one, and identically in light
// and dark themes (the chip carries its own background, so the page behind it does
// not matter).
//
// The alternative — a tinted background with coloured text — looks better on a
// white page and fails in dark mode for every dark tag colour.

const DARK_TEXT = "#111827";
const LIGHT_TEXT = "#ffffff";

/**
 * Pick the text colour that contrasts better with a background, by WCAG 2.x
 * contrast ratio.
 *
 * It computes both ratios and takes the winner rather than comparing luminance to
 * a threshold. A threshold is where this goes wrong quietly: the obvious "is it
 * lighter than half?" test puts **white on lime** (#84cc16, luminance 0.48), a
 * contrast ratio of 1.97 against 10.6 for black — illegible, and exactly the kind
 * of thing that looks fine to whoever picked the colour on their own screen. The
 * real crossover sits near luminance 0.179, which is not a number anyone would
 * guess; deriving it is cheaper than remembering it.
 */
export function readableTextOn(hex: string): string {
  const parsed = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  // An unparseable colour must not throw in a render path — fall back to the
  // theme's own foreground so the chip looks plain rather than breaking the page.
  if (!parsed) return "inherit";

  const int = Number.parseInt(parsed[1]!, 16);
  const channels = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
    const s = c / 255;
    // sRGB → linear light. This is what makes the result perceptual: at equal
    // channel values green reads far brighter than blue, and a naive average of
    // the three would call both mid-grey and get one of them wrong.
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;

  // WCAG contrast ratio is (lighter + 0.05) / (darker + 0.05). White is 1.0;
  // #111827 is dark enough that treating it as 0 shifts nothing that matters here.
  const againstLight = 1.05 / (luminance + 0.05);
  const againstDark = (luminance + 0.05) / 0.05;

  return againstDark >= againstLight ? DARK_TEXT : LIGHT_TEXT;
}

export interface TagChipProps {
  name: string;
  color: string;
  /** Rendered smaller inside table rows, where several sit side by side. */
  size?: "sm" | "md";
  onRemove?: () => void;
}

export function TagChip({ name, color, size = "md", onRemove }: TagChipProps) {
  return (
    <span
      className={
        "inline-flex max-w-[12rem] items-center gap-1 rounded-full font-medium " +
        (size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-xs")
      }
      style={{ backgroundColor: color, color: readableTextOn(color) }}
      // A long tag is truncated in the chip; the full text stays available on hover
      // rather than stretching the row.
      title={name}
    >
      <span className="truncate">{name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="ml-0.5 shrink-0 opacity-70 hover:opacity-100"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

/** A row of chips, with a quiet fallback so an untagged record reads as untagged. */
export function TagList({
  tags,
  size = "md",
  empty = null,
}: {
  tags: { id: string; name: string; color: string }[];
  size?: "sm" | "md";
  empty?: React.ReactNode;
}) {
  if (tags.length === 0) return <>{empty}</>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <TagChip key={t.id} name={t.name} color={t.color} size={size} />
      ))}
    </span>
  );
}
