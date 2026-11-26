import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { readXlsx, type XCell } from "./xlsx.js";

class Fatal extends Error {}

type Rec = { line: number; fields: string[] };

function parseCsv(text: string): Rec[] {
  const recs: Rec[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    // completely empty line
    if (text[i] === "\n") {
      i++;
      line++;
      continue;
    }
    if (text[i] === "\r" && text[i + 1] === "\n") {
      i += 2;
      line++;
      continue;
    }
    const startLine = line;
    const fields: string[] = [];
    let cur = "";
    let inQuotes = false;
    let fieldStart = true;
    for (;;) {
      if (i >= n) {
        fields.push(cur);
        break;
      }
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cur += '"';
            i += 2;
          } else {
            inQuotes = false;
            i++;
          }
        } else {
          if (c === "\n") line++;
          cur += c;
          i++;
        }
        continue;
      }
      if (c === '"' && fieldStart) {
        inQuotes = true;
        fieldStart = false;
        i++;
      } else if (c === ",") {
        fields.push(cur);
        cur = "";
        fieldStart = true;
        i++;
      } else if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
        fields.push(cur);
        i += c === "\n" ? 1 : 2;
        line++;
        break;
      } else {
        cur += c;
        fieldStart = false;
        i++;
      }
    }
    recs.push({ line: startLine, fields: fields.map((f) => f.replace(/^[ \t]+|[ \t]+$/g, "")) });
  }
  return recs;
}

function validDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= (dim[mo - 1] ?? 0);
}

function toCents(s: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1] ?? "0") * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

function fmt(c: bigint): string {
  const s = c.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

const REQUIRED = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];

type Format = "csv" | "json" | "jsonl" | "yaml" | "xlsx";

const EXT_FORMATS = new Map<string, Format>([
  [".csv", "csv"],
  [".json", "json"],
  [".jsonl", "jsonl"],
  [".ndjson", "jsonl"],
  [".yaml", "yaml"],
  [".yml", "yaml"],
  [".xlsx", "xlsx"],
]);

function toFormat(s: string): Format | undefined {
  return s === "csv" || s === "json" || s === "jsonl" || s === "yaml" || s === "xlsx" ? s : undefined;
}

function parseArgs(argv: string[]): { input: string; groupBy: string; format: Format } {
  let input: string | undefined;
  let groupBy: string | undefined;
  let formatArg: string | undefined;
  for (let k = 0; k < argv.length; k += 2) {
    const opt = argv[k];
    const val = argv[k + 1];
    if (opt !== "--input" && opt !== "--group-by" && opt !== "--format") throw new Fatal(`unknown option: ${opt}`);
    if (val === undefined) throw new Fatal(`missing value for ${opt}`);
    if (opt === "--input") {
      if (input !== undefined) throw new Fatal("duplicate --input");
      input = val;
    } else if (opt === "--format") {
      if (formatArg !== undefined) throw new Fatal("duplicate --format");
      formatArg = val;
    } else {
      if (groupBy !== undefined) throw new Fatal("duplicate --group-by");
      groupBy = val;
    }
  }
  if (input === undefined) throw new Fatal("missing option --input");
  if (groupBy === undefined) throw new Fatal("missing option --group-by");
  if (groupBy !== "day" && groupBy !== "sku" && groupBy !== "customer") {
    throw new Fatal(`invalid --group-by value: ${groupBy}`);
  }
  let format: Format | undefined;
  if (formatArg !== undefined) {
    format = toFormat(formatArg);
    if (format === undefined) throw new Fatal(`invalid --format value: ${formatArg}`);
  } else {
    format = EXT_FORMATS.get(extname(input).toLowerCase());
    if (format === undefined) throw new Fatal(`cannot determine format of ${input}`);
  }
  return { input, groupBy, format };
}

type Row = { loc: string; bad?: string; get: (name: string) => XCell };
type Source = { rows: Row[] };

const EMPTY: XCell = { k: "empty" };

function strCell(s: string): XCell {
  return { k: "str", v: s };
}

function decodeUtf8(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new Fatal("input is not valid UTF-8");
  }
}

function csvSource(buf: Buffer, input: string): Source {
  const recs = parseCsv(decodeUtf8(buf));
  const header = recs[0];
  if (!header || header.line !== 1) throw new Fatal("no header line");
  const idx = headerIndex(header.fields);
  const rows = recs.slice(1).map((r): Row => {
    const get = (name: string): XCell => {
      const k = idx.get(name);
      return k === undefined ? EMPTY : strCell(r.fields[k] ?? "");
    };
    const row: Row = { loc: `${input}:${r.line}`, get };
    if (r.fields.length < header.fields.length) row.bad = "too few fields";
    return row;
  });
  return { rows };
}

function headerIndex(names: string[]): Map<string, number> {
  const idx = new Map<string, number>();
  names.forEach((name, k) => {
    if (!idx.has(name)) idx.set(name, k);
  });
  for (const r of REQUIRED) if (!idx.has(r)) throw new Fatal(`header missing column: ${r}`);
  return idx;
}

function isObject(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function jsonCell(v: unknown): XCell {
  if (v === undefined || v === null) return EMPTY;
  if (typeof v === "string") return strCell(v);
  if (typeof v === "number") return Number.isFinite(v) ? { k: "num", v } : { k: "bad" };
  return { k: "bad" };
}

function objectRow(loc: string, v: unknown): Row {
  if (!isObject(v)) return { loc, bad: "invalid record", get: () => EMPTY };
  const fields = new Map<string, unknown>(Object.entries(v));
  return { loc, get: (name) => jsonCell(fields.get(name)) };
}

function jsonSource(buf: Buffer, input: string): Source {
  let data: unknown;
  try {
    data = JSON.parse(decodeUtf8(buf));
  } catch (e) {
    if (e instanceof Fatal) throw e;
    throw new Fatal("invalid JSON");
  }
  if (!Array.isArray(data)) throw new Fatal("top-level JSON value is not an array");
  const items: unknown[] = data;
  return { rows: items.map((v, k) => objectRow(`${input}:#${k + 1}`, v)) };
}

function jsonlSource(buf: Buffer, input: string): Source {
  const rows: Row[] = [];
  decodeUtf8(buf)
    .split("\n")
    .forEach((raw, k) => {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (line === "") return;
      const loc = `${input}:${k + 1}`;
      let v: unknown;
      try {
        v = JSON.parse(line);
      } catch {
        rows.push({ loc, bad: "invalid JSON", get: () => EMPTY });
        return;
      }
      rows.push(objectRow(loc, v));
    });
  return { rows };
}

function yamlSource(buf: Buffer, input: string): Source {
  let data: unknown;
  try {
    data = parseYaml(decodeUtf8(buf), { schema: "core", logLevel: "silent" });
  } catch (e) {
    if (e instanceof Fatal) throw e;
    throw new Fatal("invalid YAML");
  }
  if (!Array.isArray(data)) throw new Fatal("top-level YAML value is not a sequence");
  const items: unknown[] = data;
  return { rows: items.map((v, k) => objectRow(`${input}:#${k + 1}`, v)) };
}

function xlsxSource(buf: Buffer, input: string): Source {
  let xrows: ReturnType<typeof readXlsx>;
  try {
    xrows = readXlsx(buf);
  } catch (e) {
    throw new Fatal(`cannot open workbook: ${e instanceof Error ? e.message : String(e)}`);
  }
  const hasValue = (cells: Map<number, XCell>): boolean => [...cells.values()].some((c) => c.k !== "empty");
  const head = xrows.find((r) => r.row === 1);
  if (!head || !hasValue(head.cells)) throw new Fatal("no header row");
  const names: string[] = [];
  for (const [ci, c] of head.cells) {
    names[ci] = c.k === "str" ? trimWs(c.v) : c.k === "num" ? (decimal(c.v) ?? "") : c.k === "date" ? c.v : "";
  }
  const idx = headerIndex(Array.from(names, (n) => n ?? ""));
  const rows: Row[] = [];
  for (const r of xrows) {
    if (r.row === 1 || !hasValue(r.cells)) continue;
    rows.push({
      loc: `${input}:${r.row}`,
      get: (name) => {
        const k = idx.get(name);
        return (k === undefined ? undefined : r.cells.get(k)) ?? EMPTY;
      },
    });
  }
  return { rows };
}

function trimWs(s: string): string {
  return s.replace(/^[ \t]+|[ \t]+$/g, "");
}

// Shortest decimal form of a number, without exponent.
function decimal(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  const e = s.indexOf("e");
  if (e < 0) return s;
  const mant = s.slice(0, e);
  const exp = Number(s.slice(e + 1));
  const neg = mant.startsWith("-");
  const [ip = "", fp = ""] = (neg ? mant.slice(1) : mant).split(".");
  const digits = ip + fp;
  const point = ip.length + exp;
  let body: string;
  if (point <= 0) body = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) body = digits + "0".repeat(point - digits.length);
  else body = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return neg ? `-${body}` : body;
}

type Field = { ok: true; v: string } | { ok: false };

function field(c: XCell, allowDate = false): Field {
  switch (c.k) {
    case "empty":
      return { ok: true, v: "" };
    case "str":
      return { ok: true, v: trimWs(c.v) };
    case "num": {
      const d = decimal(c.v);
      return d === null ? { ok: false } : { ok: true, v: d };
    }
    case "date":
      return allowDate ? { ok: true, v: c.v } : { ok: false };
    case "bad":
      return { ok: false };
  }
}

function run(): { out: string; err: string[] } {
  const { input, groupBy, format } = parseArgs(process.argv.slice(2));
  let buf: Buffer;
  try {
    buf = readFileSync(input);
  } catch (e) {
    throw new Fatal(`cannot read ${input}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const source =
    format === "csv" ? csvSource(buf, input)
    : format === "json" ? jsonSource(buf, input)
    : format === "jsonl" ? jsonlSource(buf, input)
    : format === "yaml" ? yamlSource(buf, input)
    : xlsxSource(buf, input);

  const err: string[] = [];
  const seen = new Set<string>();
  const sums = new Map<string, bigint>();
  let total = 0n;

  for (const r of source.rows) {
    const bad = (reason: string): void => {
      err.push(`${r.loc}: ${reason}`);
    };
    if (r.bad !== undefined) {
      bad(r.bad);
      continue;
    }
    const text = (name: string, allowDate = false): string | null => {
      const f = field(r.get(name), allowDate);
      return f.ok ? f.v : null;
    };
    const orderId = text("order_id");
    if (orderId === null) { bad("invalid order_id"); continue; }
    if (orderId === "") { bad("empty order_id"); continue; }
    const customer = text("customer_id");
    if (customer === null) { bad("invalid customer_id"); continue; }
    if (customer === "") { bad("empty customer_id"); continue; }
    const date = text("order_date", true);
    if (date === null || !validDate(date)) { bad("invalid order_date"); continue; }
    const sku = text("sku");
    if (sku === null) { bad("invalid sku"); continue; }
    if (sku === "") { bad("empty sku"); continue; }
    const qty = text("quantity");
    if (qty === null || !/^\d+$/.test(qty) || BigInt(qty) < 1n) { bad("invalid quantity"); continue; }
    const price = text("unit_price");
    const priceCents = price === null ? null : toCents(price);
    if (priceCents === null) { bad("invalid unit_price"); continue; }
    const disc = text("discount");
    let pct = 0n;
    if (disc === null) { bad("invalid discount"); continue; }
    if (disc !== "") {
      const d = toCents(disc);
      if (d === null || d > 100n) { bad("invalid discount"); continue; }
      pct = d;
    }
    const key = JSON.stringify([orderId, sku]);
    if (seen.has(key)) { bad("duplicate (order_id, sku)"); continue; }
    seen.add(key);
    const rev = (priceCents * BigInt(qty) * (100n - pct) + 50n) / 100n;
    const gk = groupBy === "day" ? date : groupBy === "sku" ? sku : customer;
    sums.set(gk, (sums.get(gk) ?? 0n) + rev);
    total += rev;
  }

  const keys = [...sums.keys()].sort((a, b) => {
    const A = Array.from(a);
    const B = Array.from(b);
    for (let k = 0; k < Math.min(A.length, B.length); k++) {
      const x = A[k]?.codePointAt(0) ?? 0;
      const y = B[k]?.codePointAt(0) ?? 0;
      if (x !== y) return x - y;
    }
    return A.length - B.length;
  });
  let out = `${groupBy}\trevenue\n`;
  for (const k of keys) out += `${k}\t${fmt(sums.get(k) ?? 0n)}\n`;
  out += `TOTAL\t${fmt(total)}\n`;
  return { out, err };
}

try {
  const { out, err } = run();
  if (err.length > 0) process.stderr.write(err.join("\n") + "\n");
  process.stdout.write(out);
} catch (e) {
  process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 2;
}
