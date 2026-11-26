import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseDocument } from "yaml";
import { readFirstSheet, type Cell } from "./xlsx.js";

class Fatal extends Error {}

type Format = "csv" | "json" | "jsonl" | "yaml" | "xlsx";
const FORMATS: Format[] = ["csv", "json", "jsonl", "yaml", "xlsx"];
const EXT: Record<string, Format> = {
  ".csv": "csv", ".json": "json", ".jsonl": "jsonl", ".ndjson": "jsonl",
  ".yaml": "yaml", ".yml": "yaml", ".xlsx": "xlsx",
};

function parseArgs(argv: string[]): { input: string; groupBy: "day" | "sku" | "customer"; format: Format } {
  let input: string | undefined;
  let groupBy: string | undefined;
  let formatArg: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const opt = argv[i];
    if (opt !== "--input" && opt !== "--group-by" && opt !== "--format") throw new Fatal(`unknown option: ${opt}`);
    const val = argv[i + 1];
    if (val === undefined) throw new Fatal(`missing value for ${opt}`);
    if (opt === "--input") input = val;
    else if (opt === "--format") formatArg = val;
    else groupBy = val;
  }
  if (input === undefined || input === "") throw new Fatal("missing --input");
  if (groupBy === undefined) throw new Fatal("missing --group-by");
  if (groupBy !== "day" && groupBy !== "sku" && groupBy !== "customer") {
    throw new Fatal(`invalid --group-by value: ${groupBy}`);
  }
  let format: Format;
  if (formatArg !== undefined) {
    if (!FORMATS.includes(formatArg as Format)) throw new Fatal(`unknown format: ${formatArg}`);
    format = formatArg as Format;
  } else {
    const f = EXT[extname(input).toLowerCase()];
    if (f === undefined) throw new Fatal(`cannot determine format of ${input}`);
    format = f;
  }
  return { input, groupBy, format };
}

interface Rec {
  line: number;
  fields: string[];
}

function parseCsv(text: string): Rec[] {
  const recs: Rec[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const startLine = line;
    // completely empty line
    if (text[i] === "\n") { i++; line++; continue; }
    if (text[i] === "\r" && text[i + 1] === "\n") { i += 2; line++; continue; }
    const fields: string[] = [];
    for (;;) {
      let f = "";
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= n) break;
          const c = text[i]!;
          if (c === '"') {
            if (text[i + 1] === '"') { f += '"'; i += 2; continue; }
            i++;
            break;
          }
          if (c === "\n") line++;
          f += c;
          i++;
        }
        // stray characters after closing quote, up to delimiter
        while (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) {
          f += text[i];
          i++;
        }
      } else {
        while (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) {
          f += text[i];
          i++;
        }
      }
      fields.push(f.replace(/^[ \t]+|[ \t]+$/g, ""));
      if (text[i] === ",") { i++; continue; }
      break;
    }
    if (i < n) {
      if (text[i] === "\r") i++;
      i++; // newline
      line++;
    }
    recs.push({ line: startLine, fields });
  }
  return recs;
}

function validDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  return d <= dim;
}

function cents(s: string): bigint {
  const [w, f = ""] = s.split(".");
  return BigInt(w!) * 100n + BigInt(f.padEnd(2, "0") || "0");
}

function fmt(c: bigint): string {
  const w = c / 100n;
  const f = (c % 100n).toString().padStart(2, "0");
  return `${w}.${f}`;
}

function cmp(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const p = x[i]!.codePointAt(0)!, q = y[i]!.codePointAt(0)!;
    if (p !== q) return p - q;
  }
  return x.length - y.length;
}

interface Row {
  loc: string;
  bad?: string;
  /** string value, or null when the value has an invalid type */
  get(name: string): string | null;
  hasDiscount: boolean;
  checkNotes: boolean;
}

const trimWs = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, "");

function numStr(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const digits = m[2]! + (m[3] ?? "");
  const pointPos = m[2]!.length + Number(m[4]);
  let body: string;
  if (pointPos <= 0) body = "0." + "0".repeat(-pointPos) + digits;
  else if (pointPos >= digits.length) body = digits + "0".repeat(pointPos - digits.length);
  else body = digits.slice(0, pointPos) + "." + digits.slice(pointPos);
  return m[1]! + body;
}

function decodeUtf8(buf: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    throw new Fatal("input is not valid UTF-8");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/** value from a JSON/YAML-style object */
function jsonValue(v: unknown): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return trimWs(v);
  if (typeof v === "number") return numStr(v);
  return null;
}

function objectRows(items: unknown[], locOf: (i: number) => string): Row[] {
  return items.map((item, i) => {
    const loc = locOf(i);
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { loc, bad: "invalid record", get: () => "", hasDiscount: true, checkNotes: true };
    }
    const o = item as Record<string, unknown>;
    return {
      loc,
      get: (name: string) => jsonValue(Object.hasOwn(o, name) ? o[name] : undefined),
      hasDiscount: true,
      checkNotes: true,
    };
  });
}

function csvRows(text: string): Row[] {
  const recs = parseCsv(text);
  if (recs.length === 0) throw new Fatal("no header line");
  const header = recs[0]!.fields;
  const idx = new Map<string, number>();
  header.forEach((h, k) => { if (!idx.has(h)) idx.set(h, k); });
  checkRequired(idx);
  return recs.slice(1).map((rec) => {
    const f = rec.fields;
    const row: Row = {
      loc: String(rec.line),
      get: (n) => f[idx.get(n)!]!,
      hasDiscount: idx.has("discount"),
      checkNotes: false,
    };
    if (f.length < header.length) row.bad = "too few fields";
    return row;
  });
}

function checkRequired(idx: Map<string, number>): void {
  for (const r of ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"]) {
    if (!idx.has(r)) throw new Fatal(`header missing column: ${r}`);
  }
}

function xlsxRows(buf: Buffer): Row[] {
  let sheet;
  try {
    sheet = readFirstSheet(buf);
  } catch (e) {
    throw new Fatal(`cannot open workbook: ${(e as Error).message}`);
  }
  const first = sheet.find((r) => r.row === 1);
  const cellText = (c: Cell | undefined): string | null => {
    if (c === undefined) return "";
    if (c.kind === "text") return trimWs(c.text);
    if (c.kind === "num") return numStr(c.num);
    return null;
  };
  if (first === undefined || first.cells.size === 0) throw new Fatal("no header row");
  const idx = new Map<string, number>();
  for (const [col, c] of [...first.cells].sort((a, b) => a[0] - b[0])) {
    const h = c.kind === "date" ? c.text : cellText(c);
    if (h !== null && !idx.has(h)) idx.set(h, col);
  }
  checkRequired(idx);
  const rows: Row[] = [];
  for (const r of sheet) {
    if (r.row === 1 || r.cells.size === 0) continue;
    rows.push({
      loc: String(r.row),
      get: (name) => {
        const col = idx.get(name);
        const c = col === undefined ? undefined : r.cells.get(col);
        if (c !== undefined && c.kind === "date") return name === "order_date" ? c.text : null;
        return cellText(c);
      },
      hasDiscount: true,
      checkNotes: true,
    });
  }
  return rows;
}

function loadRows(input: string, format: Format): Row[] {
  let buf: Buffer;
  try {
    buf = readFileSync(input);
  } catch (e) {
    throw new Fatal(`cannot read ${input}: ${(e as Error).message}`);
  }
  if (format === "xlsx") return xlsxRows(buf);
  const text = decodeUtf8(buf);
  switch (format) {
    case "csv":
      return csvRows(text);
    case "json": {
      let v: unknown;
      try { v = JSON.parse(text); } catch { throw new Fatal("invalid JSON"); }
      if (!Array.isArray(v)) throw new Fatal("top-level JSON value is not an array");
      return objectRows(v, (i) => `#${i + 1}`);
    }
    case "jsonl": {
      const rows: Row[] = [];
      text.split("\n").forEach((raw, i) => {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line === "") return;
        let v: unknown;
        try { v = JSON.parse(line); } catch { v = undefined; }
        const loc = String(i + 1);
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
          rows.push({ loc, bad: "invalid record", get: () => "", hasDiscount: true, checkNotes: true });
        } else {
          rows.push(...objectRows([v], () => loc));
        }
      });
      return rows;
    }
    case "yaml": {
      const doc = parseDocument(text);
      if (doc.errors.length > 0) throw new Fatal("invalid YAML");
      let v: unknown;
      try { v = doc.toJS(); } catch { throw new Fatal("invalid YAML"); }
      if (!Array.isArray(v)) throw new Fatal("top-level YAML value is not a sequence");
      return objectRows(v, (i) => `#${i + 1}`);
    }
    default:
      throw new Fatal("unsupported format");
  }
}

function main(): { out: string; err: string } {
  const { input, groupBy, format } = parseArgs(process.argv.slice(2));
  const rows = loadRows(input, format);

  let err = "";
  const seen = new Set<string>();
  const sums = new Map<string, bigint>();
  let total = 0n;

  for (const row of rows) {
    const reason = (): string | null => {
      if (row.bad !== undefined) return row.bad;
      const val = (n: string): string | null => row.get(n);
      const orderId = val("order_id");
      if (orderId === null) return "invalid order_id";
      if (orderId === "") return "empty order_id";
      const cust = val("customer_id");
      if (cust === null) return "invalid customer_id";
      if (cust === "") return "empty customer_id";
      const date = val("order_date");
      if (date === null || !validDate(date)) return "invalid order_date";
      const sku = val("sku");
      if (sku === null) return "invalid sku";
      if (sku === "") return "empty sku";
      const qty = val("quantity");
      if (qty === null || !/^[0-9]+$/.test(qty) || BigInt(qty) < 1n) return "invalid quantity";
      const price = val("unit_price");
      if (price === null || !/^[0-9]+(\.[0-9]{1,2})?$/.test(price)) return "invalid unit_price";
      if (row.hasDiscount) {
        const d = val("discount");
        if (d === null) return "invalid discount";
        if (d !== "") {
          if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(d) || cents(d) > 100n) return "invalid discount";
        }
      }
      if (row.checkNotes && val("notes") === null) return "invalid notes";
      if (seen.has(JSON.stringify([orderId, sku]))) return "duplicate order_id and sku";
      return null;
    };
    const bad = reason();
    if (bad !== null) {
      err += `${input}:${format === "json" || format === "yaml" ? "#" : ""}${row.loc.replace(/^#/, "")}: ${bad}\n`;
      continue;
    }
    const get = (n: string) => row.get(n)!;
    seen.add(JSON.stringify([get("order_id"), get("sku")]));
    const d = row.hasDiscount && get("discount") !== "" ? cents(get("discount")) : 0n;
    const num = cents(get("unit_price")) * BigInt(get("quantity")) * (100n - d);
    const rev = (num + 50n) / 100n;
    const key = groupBy === "day" ? get("order_date") : groupBy === "sku" ? get("sku") : get("customer_id");
    sums.set(key, (sums.get(key) ?? 0n) + rev);
    total += rev;
  }

  let out = `${groupBy}\trevenue\n`;
  for (const k of [...sums.keys()].sort(cmp)) out += `${k}\t${fmt(sums.get(k)!)}\n`;
  out += `TOTAL\t${fmt(total)}\n`;
  return { out, err };
}

try {
  const { out, err } = main();
  process.stderr.write(err);
  process.stdout.write(out);
} catch (e) {
  if (e instanceof Fatal) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exitCode = 2;
  } else throw e;
}
