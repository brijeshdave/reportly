// Author: Brijesh Dave <https://github.com/brijeshdave>
// The three chart forms this app needs, and nothing else.
//
// Form follows the data's job, not preference:
//   - change over time  -> line (two series share ONE axis; both are entry counts)
//   - magnitude by name -> horizontal bar, sorted, because category names are
//                          words and words read badly rotated under a vertical axis
//   - part of a whole   -> stacked single bar, never a pie: a pie asks the reader
//                          to compare angles, which people are measurably bad at
//
// Every chart gets a hover layer, because an HTML chart IS interactive and a
// reader who cannot interrogate a mark is being asked to estimate from pixels.
// Text wears text tokens throughout; the coloured mark carries identity.
import type { ChartPoint, ChartTrendPoint } from "@reportly/shared";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ink, isDark, seriesColor } from "@/components/charts/palette.js";

/** Shared axis/grid styling — recessive, so the data is the loudest thing. */
function axisProps(dark: boolean) {
  return {
    stroke: ink("axis", dark),
    tick: { fill: ink("label", dark), fontSize: 11 },
    tickLine: false,
    axisLine: { stroke: ink("grid", dark) },
  };
}

/** A tooltip that looks like the app rather than like Recharts. */
function tooltipProps(dark: boolean) {
  return {
    cursor: { fill: ink("grid", dark), fillOpacity: 0.35 },
    contentStyle: {
      background: ink("surface", dark),
      border: `1px solid ${ink("grid", dark)}`,
      borderRadius: 12,
      fontSize: 12,
      color: ink("label", dark),
    },
    labelStyle: { color: ink("label", dark), fontWeight: 600 },
  };
}

/**
 * Legend styling, so the key reads as a key rather than as Recharts.
 *
 * Two corrections to the default, both of which the file's own rule already
 * asked for. The label is drawn in the text token instead of the series colour —
 * left alone, Recharts paints the words themselves blue and orange, which turns a
 * quiet key into two competing pieces of coloured text. And the mark is a plain
 * rule rather than the default line-through-a-dot, which at legend size renders
 * as a dash-circle-dash and reads like a typo beside the words.
 */
function legendProps() {
  return {
    verticalAlign: "top" as const,
    align: "left" as const,
    height: 28,
    iconSize: 12,
    // Indented to clear the card's edge and line up with the title above it,
    // rather than starting hard against the border.
    wrapperStyle: { fontSize: 12, paddingLeft: 16 },
    // The gap between one entry and the next is ours to set. Recharts puts the
    // items in an inline list with a mark, a hair of space, and the label — so
    // two entries run together as "IssuesWork logs" unless the label carries its
    // own trailing space. `mr` on the span, not the list item, because the list
    // item's style is written inline by the library and would win.
    formatter: (value: unknown) => (
      <span className="mr-5 pl-1 align-middle text-muted-foreground">{String(value)}</span>
    ),
  };
}

/** Dates arrive as YYYY-MM-DD; show DD-MM, which is what the rest of the app uses. */
function shortDate(iso: unknown): string {
  const text = String(iso ?? "");
  const [, m, d] = text.split("-");
  return d && m ? `${d}-${m}` : text;
}

/**
 * Two counts over time.
 *
 * Deliberately one y-axis for both series. A second scale would let the two lines
 * cross wherever the axes were chosen to make them cross — the single most
 * common way a chart tells a lie — and here it would be gratuitous, because
 * issues and work logs are both counts of journal entries.
 */
export function TrendChart({ data }: { data: ChartTrendPoint[] }) {
  const dark = isDark();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid stroke={ink("grid", dark)} vertical={false} />
        <XAxis dataKey="label" tickFormatter={shortDate} {...axisProps(dark)} minTickGap={24} />
        <YAxis allowDecimals={false} {...axisProps(dark)} />
        <Tooltip {...tooltipProps(dark)} labelFormatter={shortDate} />
        {/* Two series, so a legend is always present — identity is never colour alone. */}
        <Legend {...legendProps()} iconType="plainline" />
        <Line
          type="monotone"
          dataKey="issues"
          name="Issues"
          stroke={seriesColor(0, dark)}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="work"
          name="Work logs"
          stroke={seriesColor(1, dark)}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * Magnitude by name, sorted, horizontal.
 *
 * Horizontal because the labels are names — "Hydraulic press losing pressure" is
 * unreadable rotated 45° under a vertical axis, and truncating it to fit loses
 * the thing the reader came for.
 *
 * One hue, not one per bar: these bars are the same KIND of thing at different
 * sizes, which is a sequential job. Painting each a different colour would imply
 * a categorical difference that is not there — the classic rainbow bar chart.
 */
export function RankedBarChart({
  data,
  unit,
  colorIndex = 0,
}: {
  data: ChartPoint[];
  unit?: string;
  colorIndex?: number;
}) {
  const dark = isDark();
  const color = seriesColor(colorIndex, dark);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
        barCategoryGap={6}
      >
        <CartesianGrid stroke={ink("grid", dark)} horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...axisProps(dark)} />
        <YAxis
          type="category"
          dataKey="label"
          width={140}
          {...axisProps(dark)}
          tick={{ fill: ink("label", dark), fontSize: 11 }}
        />
        <Tooltip
          {...tooltipProps(dark)}
          formatter={(value) => [`${Number(value).toLocaleString()}${unit ? ` ${unit}` : ""}`, ""]}
        />
        {/* One series: no legend box — the chart's title already names it. */}
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Parts of a whole, as one stacked bar.
 *
 * Not a pie. Comparing angles is something people are reliably poor at, and a
 * stacked bar puts every segment on a common baseline where lengths can actually
 * be judged. The 2px gap between segments is the surface showing through, so
 * adjacent fills never appear to merge into one.
 */
export function CompositionChart({ data }: { data: ChartPoint[] }) {
  const dark = isDark();
  const row = Object.fromEntries(data.map((d) => [d.label, d.value]));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={[{ name: "total", ...row }]}
        layout="vertical"
        margin={{ top: 30, right: 12, bottom: 0, left: 12 }}
      >
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" hide />
        <Tooltip {...tooltipProps(dark)} />
        {/* Squares here: these segments are areas, not lines, so the mark should
            look like the thing it stands for. */}
        <Legend {...legendProps()} iconType="square" />
        {data.map((d, i) => (
          <Bar
            key={d.label}
            dataKey={d.label}
            stackId="a"
            fill={seriesColor(i, dark)}
            stroke={ink("surface", dark)}
            strokeWidth={2}
            maxBarSize={44}
          >
            <Cell />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
