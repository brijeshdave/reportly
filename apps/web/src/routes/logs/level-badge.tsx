// Author: Brijesh Dave <https://github.com/brijeshdave>
// A log level as a coloured pill. Each level gets its own colour so severity reads
// at a glance in a table full of info lines. Shared by the log table and detail.
import { levelPillClass } from "@/lib/log-format.js";

export function LevelBadge({ level }: { level: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase ${levelPillClass(
        level,
      )}`}
    >
      {level}
    </span>
  );
}
