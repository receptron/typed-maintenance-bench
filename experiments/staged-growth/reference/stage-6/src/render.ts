import type { Aggregate } from "./aggregate.js";
import { DEFAULT_CURRENCY, formatMoney } from "./money.js";
import { formatCents } from "./values.js";

export const OUTPUTS = ["text", "markdown", "html", "json"] as const;
export type Output = (typeof OUTPUTS)[number];

type Table = { header: string[]; body: string[][]; footer: string[][] };

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// With no rows there is still one TOTAL line, 0.00.
const totalLines = (result: Aggregate): string[][] => {
  const totals = result.totals.length > 0 ? result.totals : [{ currency: DEFAULT_CURRENCY, cents: 0 }];
  const padding = result.groupBy.slice(1).map(() => "");
  return totals.map((total) => ["TOTAL", ...padding, formatMoney(total.cents, total.currency)]);
};

const table = (result: Aggregate, escapeKey: (key: string) => string): Table => ({
  header: [...result.groupBy, "revenue"],
  body: result.rows.map((row) => [...row.key.map(escapeKey), formatMoney(row.revenueCents, row.currency)]),
  footer: totalLines(result),
});

const lines = (parts: string[]): string => [...parts, ""].join("\n");

const renderText = (result: Aggregate): string => {
  const { header, body, footer } = table(result, (key) => key);
  return lines([header, ...body, ...footer].map((cells) => cells.join("\t")));
};

const markdownLine = (cells: string[]): string => `| ${cells.join(" | ")} |`;

const renderMarkdown = (result: Aggregate): string => {
  const { header, body, footer } = table(result, (key) => key.replaceAll("|", "\\|"));
  const separator = `|${[...result.groupBy.map(() => "---"), "---:"].join("|")}|`;
  return lines([markdownLine(header), separator, ...body.map(markdownLine), ...footer.map(markdownLine)]);
};

const htmlRow = (tag: string, cells: string[]): string =>
  `<tr>${cells.map((cell) => `<${tag}>${cell}</${tag}>`).join("")}</tr>`;

const renderHtml = (result: Aggregate): string => {
  const { header, body, footer } = table(result, (key) =>
    key.replace(/[&<>"']/g, (match) => HTML_ESCAPES[match] ?? match),
  );
  const tbody = ["<tbody>", ...body.map((cells) => htmlRow("td", cells)), "</tbody>"];
  const tfoot = ["<tfoot>", ...footer.map((cells) => htmlRow("td", cells)), "</tfoot>"];
  return lines(["<table>", "<thead>", htmlRow("th", header), "</thead>", ...tbody, ...tfoot, "</table>"]);
};

// JSON is for programs, so it always states the currency.
const renderJson = (result: Aggregate): string =>
  lines([
    JSON.stringify({
      groupBy: result.groupBy,
      rows: result.rows.map((row) => ({
        key: row.key,
        currency: row.currency,
        revenue: formatCents(row.revenueCents),
      })),
      totals: result.totals.map((total) => ({ currency: total.currency, total: formatCents(total.cents) })),
    }),
  ]);

const RENDERERS: Record<Output, (result: Aggregate) => string> = {
  text: renderText,
  markdown: renderMarkdown,
  html: renderHtml,
  json: renderJson,
};

export const render = (result: Aggregate, output: Output): string => RENDERERS[output](result);
