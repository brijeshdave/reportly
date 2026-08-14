// Author: Brijesh Dave <https://github.com/brijeshdave>
// Taking the organisation chart out of the app: as a standalone HTML file, as a
// PDF, or as rows for a spreadsheet.
//
// The HTML is genuinely standalone — styles inlined, pictures embedded as data
// URIs — because the obvious version, which links back to `/api/v1/users/…/avatar`,
// produces a file that renders only for someone already signed in to this Reportly.
// A chart you cannot send to the person who asked for it is not an export.
//
// The PDF is the browser's own print engine driven over that same HTML: it is
// vector, it paginates, and it needs no rasteriser dependency on our side.
import { formatDateTime } from "@reportly/shared";
import type { ChartNode } from "@/routes/organization/org-chart.js";

const RANK_LABEL: Record<string, string> = {
  hod: "Head of Department",
  lead: "Team leader",
  member: "Member",
};

/** Text going into HTML is escaped; a person's name is not markup. */
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------ CSV ----------------------------------- */

/**
 * The chart flattened to rows: one per person per department, with their depth and
 * their manager. The shape a spreadsheet can pivot, which a picture is not.
 */
export function orgToCsv(forest: ChartNode[]): string {
  const header = [
    "Name",
    "Email",
    "Designation",
    "Rank",
    "Department",
    "Reports to",
    "Depth",
    "Direct reports",
    "Total below",
  ];

  const rows: string[][] = [];
  const walk = (node: ChartNode, depth: number, manager: string) => {
    rows.push([
      node.name,
      node.email,
      node.designation ?? "",
      RANK_LABEL[node.rank] ?? node.rank,
      node.departmentName,
      manager,
      String(depth),
      String(node.children.length),
      String(node.descendants),
    ]);
    for (const child of node.children) walk(child, depth + 1, node.name);
  };
  for (const root of forest) walk(root, 1, "");

  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map(quote).join(",")).join("\n");
}

/* ----------------------------------- HTML ----------------------------------- */

/** Stable colour per person, matching the Avatar component's initials fallback. */
function hueFor(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/**
 * Fetch each picture and turn it into a data URI, so the exported file carries its
 * own faces. Failures are not fatal — a person without a picture simply falls back
 * to their initials, exactly as they do in the app.
 */
async function embedAvatars(forest: ChartNode[]): Promise<Map<string, string>> {
  const wanted = new Map<string, number>();
  const walk = (node: ChartNode) => {
    if (node.avatarVersion) wanted.set(node.userId, node.avatarVersion);
    node.children.forEach(walk);
  };
  forest.forEach(walk);

  const embedded = new Map<string, string>();
  await Promise.all(
    [...wanted].map(async ([userId, version]) => {
      try {
        const response = await fetch(`/api/v1/users/${userId}/avatar?v=${version}`, {
          credentials: "include",
        });
        if (!response.ok) return;
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("unreadable"));
          reader.readAsDataURL(blob);
        });
        embedded.set(userId, dataUrl);
      } catch {
        // Falls back to initials; an export must not fail over a missing picture.
      }
    }),
  );
  return embedded;
}

function nodeHtml(node: ChartNode, avatars: Map<string, string>): string {
  const picture = avatars.get(node.userId);
  const hue = hueFor(node.userId);
  const face = picture
    ? `<img class="face" src="${picture}" alt="" />`
    : `<span class="face initials" style="background:hsl(${hue} 65% 88%);color:hsl(${hue} 55% 28%)">${escape(
        initialsOf(node.name),
      )}</span>`;

  const children = node.children.length
    ? `<div class="row">${node.children
        .map(
          (child, index) => `
        <div class="cell${index === 0 ? " first" : ""}${
          index === node.children.length - 1 ? " last" : ""
        }">${nodeHtml(child, avatars)}</div>`,
        )
        .join("")}</div>`
    : "";

  return `
    <div class="node">
      <div class="card${node.rank === "hod" ? " hod" : ""}">
        ${face}
        <p class="name">${escape(node.name)}</p>
        ${node.designation ? `<p class="role">${escape(node.designation)}</p>` : ""}
        <p class="meta"><span class="rank">${escape(RANK_LABEL[node.rank] ?? node.rank)}</span> ${escape(
          node.departmentName,
        )}</p>
      </div>
      ${children}
    </div>`;
}

/**
 * A complete, self-contained document. The connectors use the same
 * half-rail-per-child trick as the app, so a wide branch does not make the line
 * overhang the outermost card.
 */
export async function orgToHtml(forest: ChartNode[], title: string): Promise<string> {
  const avatars = await embedAvatars(forest);
  const generated = formatDateTime(new Date());

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escape(title)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #111827; background: #fff;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #6b7280; font-size: 12px; margin: 0 0 28px; }
  .chart { display: flex; align-items: flex-start; gap: 40px; }

  .node { display: flex; flex-direction: column; align-items: center; }
  .card {
    width: 210px; padding: 12px; text-align: center;
    border: 1px solid #e5e7eb; border-radius: 14px; background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.04);
  }
  .card.hod { border-color: #f59e0b; }
  .face {
    display: inline-flex; align-items: center; justify-content: center;
    width: 56px; height: 56px; border-radius: 999px; object-fit: cover;
    font-weight: 600; font-size: 16px; margin-bottom: 6px;
  }
  .name { margin: 0; font-size: 13px; font-weight: 600; }
  .role { margin: 2px 0 0; font-size: 11px; color: #6b7280; }
  .meta { margin: 6px 0 0; font-size: 10px; color: #6b7280; }
  .rank {
    display: inline-block; padding: 1px 6px; margin-right: 4px;
    border-radius: 999px; background: #f3f4f6; font-weight: 600;
  }

  /* The stem from a node down to its children's rail. */
  .node > .row { position: relative; display: flex; align-items: flex-start; margin-top: 24px; }
  .node > .row::before {
    content: ""; position: absolute; left: 50%; top: -24px;
    width: 1px; height: 24px; background: #d1d5db;
  }
  /* Half a rail on each side of a child: the halves meet at each child's centre,
     whatever width that child turns out to be. */
  .cell { position: relative; display: flex; flex-direction: column; align-items: center;
          padding: 24px 12px 0; }
  .cell::before { content: ""; position: absolute; left: 0;  top: 0; width: 50%; height: 1px; background: #d1d5db; }
  .cell::after  { content: ""; position: absolute; right: 0; top: 0; width: 50%; height: 1px; background: #d1d5db; }
  .cell.first::before { display: none; }
  .cell.last::after   { display: none; }
  .cell > .node::before {
    content: ""; position: absolute; left: 50%; top: 0; width: 1px; height: 24px; background: #d1d5db;
  }
  .cell > .node { position: relative; }

  @media print {
    body { padding: 0; }
    @page { size: A3 landscape; margin: 12mm; }
  }
</style>
</head>
<body>
  <h1>${escape(title)}</h1>
  <p class="sub">Reporting line · generated ${escape(generated)}</p>
  <div class="chart">
    ${forest.map((root) => nodeHtml(root, avatars)).join("")}
  </div>
</body>
</html>`;
}

/* --------------------------------- delivery --------------------------------- */

export function downloadFile(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Print the chart, which is how a person saves it as a PDF.
 *
 * Rendered into a hidden iframe rather than the page itself: printing the app would
 * carry the sidebar, the filters and the zoom transform onto the paper. The frame is
 * torn down afterwards.
 */
export function printHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  // The images are data URIs, so they are decoded rather than fetched — but give
  // the frame a tick to lay out before the print dialog freezes it.
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // The dialog is modal to the tab; by the time it returns the frame has done
    // its job. A delay keeps it alive for browsers that print asynchronously.
    window.setTimeout(() => frame.remove(), 60_000);
  };
}
