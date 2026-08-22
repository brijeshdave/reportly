// Author: Brijesh Dave <https://github.com/brijeshdave>
// A seeded random source, so a generated month can be reproduced exactly.
//
// `Math.random()` would make every run different, which is fine until a bug shows up
// in generated data and there is no way back to the data that showed it. mulberry32:
// thirty lines, no dependency, and good enough for fiction.
export interface Rng {
  /** 0 ≤ n < 1. */
  next(): number;
  /** An integer in [min, max]. */
  int(min: number, max: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  /** One item, or undefined for an empty list. */
  pick<T>(items: readonly T[]): T | undefined;
  /** `count` distinct items (fewer if the list is shorter). */
  sample<T>(items: readonly T[], count: number): T[];
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));

  return {
    next,
    int,
    chance: (probability) => next() < probability,
    pick: <T>(items: readonly T[]): T | undefined =>
      items.length === 0 ? undefined : items[int(0, items.length - 1)],
    sample: <T>(items: readonly T[], count: number): T[] => {
      const pool = [...items];
      const out: T[] = [];
      while (out.length < count && pool.length > 0)
        out.push(...pool.splice(int(0, pool.length - 1), 1));
      return out;
    },
  };
}

/** Every date from `from` to `to` inclusive, as YYYY-MM-DD. */
export function datesBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor.getTime() <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** A timestamp inside a given day, at a plausible hour of work. */
export function atHour(date: string, hour: number, rng: Rng): Date {
  return new Date(
    `${date}T${String(hour).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}:00.000Z`,
  );
}

export const isWeekend = (date: string): boolean => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};
