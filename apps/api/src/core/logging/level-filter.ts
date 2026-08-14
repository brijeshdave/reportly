// Author: Brijesh Dave <https://github.com/brijeshdave>
// Per-feature log level filtering.
//
// `logging.levels.features` lets an operator say "email at debug, everything else
// at info" — the point of the setting is to turn up one noisy area in production
// without drowning in the rest. It was configurable in the settings UI, saved,
// and read by nothing: the only consumer was `featureLogger()`, which no feature
// ever called. Features log through the root logger with a `feature` field, so
// the level that applied was always the default.
//
// The filter therefore works on the `feature` field the log contract already
// guarantees, rather than requiring every call site to switch to a child logger.
// Two halves, and both are needed:
//
//   - `floorLevel` sets pino's own level to the most verbose level anyone asked
//     for. Without it a feature configured *below* the default never reaches a
//     sink at all — pino drops the record before serialization.
//   - `passesFeatureLevel` then drops what the floor let through but this
//     particular feature did not ask for.

/** pino's severity order. Higher is more severe. */
const RANK: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * Rank, or undefined for a label we do not know. Callers must decide what an
 * unknown label means rather than get a number that quietly sorts it last —
 * ranking it 0 would make every unrecognised line the least severe there is, and
 * so the first thing dropped.
 */
function rank(level: string | undefined): number | undefined {
  return level === undefined ? undefined : RANK[level];
}

export interface Levels {
  default: string;
  features: Record<string, string>;
}

/**
 * The most verbose level any feature asks for, which is what pino must be set to.
 * Anything stricter is applied per line by `passesFeatureLevel`.
 */
export function floorLevel(levels: Levels): string {
  let lowest = levels.default;
  let lowestRank = rank(levels.default) ?? RANK.info!;
  for (const level of Object.values(levels.features)) {
    const candidate = rank(level);
    if (candidate !== undefined && candidate < lowestRank) {
      lowest = level;
      lowestRank = candidate;
    }
  }
  return lowest;
}

/**
 * Whether a serialized log line survives its feature's configured level.
 *
 * Takes the already-serialized JSON because that is what a sink receives, and
 * because parsing once here is cheaper than every sink parsing for itself. A line
 * that cannot be parsed is emitted rather than dropped: losing a malformed log
 * line is worse than printing one.
 */
export function passesFeatureLevel(line: string, levels: Levels): boolean {
  let parsed: { level?: string; feature?: string };
  try {
    parsed = JSON.parse(line) as { level?: string; feature?: string };
  } catch {
    return true;
  }
  // No feature tag means the line is not attributable to one, so only the default
  // can apply — and pino has already enforced the floor, not the default.
  const configured = parsed.feature ? levels.features[parsed.feature] : undefined;
  const lineRank = rank(parsed.level);
  const threshold = rank(configured ?? levels.default);
  // An unrecognised level on either side is emitted rather than guessed at: a log
  // line lost is worse than a log line printed.
  if (lineRank === undefined || threshold === undefined) return true;
  return lineRank >= threshold;
}
