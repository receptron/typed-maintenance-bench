import type { Aggregate } from "./aggregate.js";
import { formatCents } from "./values.js";

export const OUTPUTS = ["text", "markdown", "html", "json"] as const;
export type Output = (typeof OUTPUTS)[number];

type Table = { header: string[]; body: string[][]; footer: string[] };

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

const table = (result: Aggregate, escapeKey: (key: string) => string): Table => ({
  header: [...result.groupBy, "revenue"],
  body: result.rows.map((row) => [...row.key.map(escapeKey), formatCents(row.revenueCents)]),
  footer: ["TOTAL", ...result.groupBy.slice(1).map(() => ""), formatCents(result.totalCents)],
});

const lines = (parts: string[]): string => [...parts, ""].join("\n");

const renderText = (result: Aggregate): string => {
  const { header, body, footer } = table(result, (key) => key);
  return lines([header, ...body, footer].map((cells) => cells.join("\t")));
};

const markdownLine = (cells: string[]): string => `| ${cells.join(" | ")} |`;

const renderMarkdown = (result: Aggregate): string => {
  const { header, body, footer } = table(result, (key) => key.replaceAll("|", "\\|"));
  const separator = `|${[...result.groupBy.map(() => "---"), "---:"].join("|")}|`;
  return lines([markdownLine(header), separator, ...body.map(markdownLine), markdownLine(footer)]);
};

const htmlRow = (tag: string, cells: string[]): string =>
  `<tr>${cells.map((cell) => `<${tag}>${cell}</${tag}>`).join("")}</tr>`;

const renderHtml = (result: Aggregate): string => {
  const { header, body, footer } = table(result, (key) =>
    key.replace(/[&<>"']/g, (match) => HTML_ESCAPES[match] ?? match),
  );
  const tbody = ["<tbody>", ...body.map((cells) => htmlRow("td", cells)), "</tbody>"];
  const tfoot = ["<tfoot>", htmlRow("td", footer), "</tfoot>"];
  return lines(["<table>", "<thead>", htmlRow("th", header), "</thead>", ...tbody, ...tfoot, "</table>"]);
};

const renderJson = (result: Aggregate): string =>
  lines([
    JSON.stringify({
      groupBy: result.groupBy,
      rows: result.rows.map((row) => ({ key: row.key, revenue: formatCents(row.revenueCents) })),
      total: formatCents(result.totalCents),
    }),
  ]);

const RENDERERS: Record<Output, (result: Aggregate) => string> = {
  text: renderText,
  markdown: renderMarkdown,
  html: renderHtml,
  json: renderJson,
};

export const render = (result: Aggregate, output: Output): string => RENDERERS[output](result);
