import { readFileSync } from "node:fs";
import { extname } from "node:path";
import ExcelJS from "exceljs";
import { parse as parseYaml, type ParseOptions, type DocumentOptions, type SchemaOptions } from "yaml";

class Fatal extends Error {}

interface Rec {
  line: number;
  fields: string[];
}

type Format = "csv" | "json" | "jsonl" | "yaml" | "xlsx";

class Bad {
  constructor(readonly shown: string) {}
}
class DateVal {
  constructor(readonly text: string) {}
}
type Val = string | Bad;

// A normalized record: either a ready-made error, or a field lookup.
interface Item {
  loc: string;
  error?: string;
  get?: (name: string) => Val;
}

const WS = /^[ \t]+|[ \t]+$/g;

function parseCsv(text: string): Rec[] {
  const recs: Rec[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const startLine = line;
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
    const fields: string[] = [];
    for (;;) {
      // parse one field
      let j = i;
      while (j < n && (text[j] === " " || text[j] === "\t")) j++;
      let value = "";
      if (text[j] === '"') {
        j++;
        for (;;) {
          if (j >= n) break;
          const c = text[j]!;
          if (c === '"') {
            if (text[j + 1] === '"') {
              value += '"';
              j += 2;
              continue;
            }
            j++;
            break;
          }
          if (c === "\n") line++;
          value += c;
          j++;
        }
        // anything between closing quote and delimiter is kept literally
        while (j < n && text[j] !== "," && text[j] !== "\n" && !(text[j] === "\r" && text[j + 1] === "\n")) {
          value += text[j];
          j++;
        }
      } else {
        j = i;
        while (j < n && text[j] !== "," && text[j] !== "\n" && !(text[j] === "\r" && text[j + 1] === "\n")) j++;
        value = text.slice(i, j);
      }
      fields.push(value.replace(WS, ""));
      if (j < n && text[j] === ",") {
        i = j + 1;
        continue;
      }
      // end of record
      if (j < n) {
        if (text[j] === "\r") j++;
        j++; // LF
        line++;
      }
      i = j;
      break;
    }
    recs.push({ line: startLine, fields });
  }
  return recs;
}

function parseArgs(argv: string[]): { input: string; groupBy: string; format: string | undefined } {
  const opts = new Map<string, string>();
  for (let k = 0; k < argv.length; k++) {
    let a = argv[k]!;
    let v: string | undefined;
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 0) {
      v = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    if (a !== "--input" && a !== "--group-by" && a !== "--format") throw new Fatal(`unknown option: ${a}`);
    if (v === undefined) {
      v = argv[++k];
      if (v === undefined) throw new Fatal(`missing value for ${a}`);
    }
    if (opts.has(a)) throw new Fatal(`duplicate option: ${a}`);
    opts.set(a, v);
  }
  const input = opts.get("--input");
  const groupBy = opts.get("--group-by");
  if (input === undefined || input === "") throw new Fatal("missing required option --input");
  if (groupBy === undefined) throw new Fatal("missing required option --group-by");
  if (groupBy !== "day" && groupBy !== "sku" && groupBy !== "customer") {
    throw new Fatal(`invalid --group-by value: ${groupBy}`);
  }
  const format = opts.get("--format");
  if (format !== undefined && !FORMATS.includes(format)) throw new Fatal(`invalid --format value: ${format}`);
  return { input, groupBy, format };
}

const FORMATS = ["csv", "json", "jsonl", "yaml", "xlsx"];

function detectFormat(input: string, format: string | undefined): Format {
  if (format !== undefined) return format as Format;
  switch (extname(input).toLowerCase()) {
    case ".csv": return "csv";
    case ".json": return "json";
    case ".jsonl":
    case ".ndjson": return "jsonl";
    case ".yaml":
    case ".yml": return "yaml";
    case ".xlsx": return "xlsx";
  }
  throw new Fatal(`cannot determine format of ${input}`);
}

function decimal(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  let s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (m) {
    const e = Number(m[4]);
    const digits = m[2]! + (m[3] ?? "");
    const point = m[2]!.length + e;
    if (point <= 0) s = `${m[1]}0.${"0".repeat(-point)}${digits}`;
    else if (point >= digits.length) s = `${m[1]}${digits}${"0".repeat(point - digits.length)}`;
    else s = `${m[1]}${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return s;
}

function ymd(d: Date): string {
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function norm(v: unknown): Val {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.replace(WS, "");
  if (typeof v === "number") {
    const d = decimal(v);
    return d === null ? new Bad(String(v)) : d;
  }
  if (typeof v === "bigint") return v.toString();
  if (v instanceof DateVal) return v.text;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? new Bad("invalid date") : ymd(v);
  let shown: string;
  try {
    shown = JSON.stringify(v) ?? String(v);
  } catch {
    shown = String(v);
  }
  return new Bad(shown);
}

function fromObject(loc: string, o: unknown): Item {
  if (typeof o !== "object" || o === null || Array.isArray(o) || o instanceof Date) {
    return { loc, error: "record is not an object" };
  }
  const obj = o as Record<string, unknown>;
  return { loc, get: (name) => norm(Object.hasOwn(obj, name) ? obj[name] : undefined) };
}

function decodeUtf8(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf).replace(/^\uFEFF/, "");
  } catch {
    throw new Fatal("input is not valid UTF-8");
  }
}

function csvItems(text: string): Item[] {
  const recs = parseCsv(text);
  if (recs.length === 0) throw new Fatal("no header line");
  const header = recs[0]!.fields;
  const idx = new Map<string, number>();
  header.forEach((h, k) => {
    if (!idx.has(h)) idx.set(h, k);
  });
  checkHeader(idx);
  return recs.slice(1).map((rec): Item => {
    if (rec.fields.length < header.length) return { loc: String(rec.line), error: "too few fields" };
    return {
      loc: String(rec.line),
      get: (name) => {
        const k = idx.get(name);
        return k === undefined ? "" : rec.fields[k]!;
      },
    };
  });
}

const REQUIRED = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];

function checkHeader(idx: Map<string, number>): void {
  for (const r of REQUIRED) if (!idx.has(r)) throw new Fatal(`header missing column: ${r}`);
}

function jsonItems(text: string): Item[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Fatal("invalid JSON");
  }
  if (!Array.isArray(v)) throw new Fatal("JSON top-level value is not an array");
  return v.map((o, i) => fromObject(`#${i + 1}`, o));
}

function jsonlItems(text: string): Item[] {
  const items: Item[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    if (/^[ \t\r\f\v]*$/.test(line)) return;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      items.push({ loc: String(i + 1), error: "invalid JSON" });
      return;
    }
    items.push(fromObject(String(i + 1), v));
  });
  return items;
}

function yamlItems(text: string): Item[] {
  let v: unknown;
  try {
    const opts: ParseOptions & DocumentOptions & SchemaOptions = {
      schema: "core",
      customTags: [
        {
          tag: "tag:yaml.org,2002:timestamp",
          identify: () => false,
          test: /^\d{4}-\d{2}-\d{2}$/,
          resolve: (str: string) => new DateVal(str),
        },
      ],
    };
    v = parseYaml(text, opts);
  } catch {
    throw new Fatal("invalid YAML");
  }
  if (!Array.isArray(v)) throw new Fatal("YAML top-level value is not a sequence");
  return v.map((o, i) => fromObject(`#${i + 1}`, o));
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    const o = v as unknown as Record<string, unknown>;
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("formula" in o || "sharedFormula" in o) return cellValue(o.result as ExcelJS.CellValue);
    if ("hyperlink" in o) return cellValue(o.text as ExcelJS.CellValue);
    if ("error" in o) return { error: o.error };
  }
  return v;
}

async function xlsxItems(buf: Buffer): Promise<Item[]> {
  const wb = new ExcelJS.Workbook();
  let ws: ExcelJS.Worksheet | undefined;
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    ws = wb.worksheets[0];
  } catch {
    throw new Fatal("cannot open workbook");
  }
  if (!ws) throw new Fatal("workbook has no worksheet");
  const hdr = ws.getRow(1);
  const idx = new Map<string, number>();
  let any = false;
  hdr.eachCell({ includeEmpty: false }, (cell, col) => {
    const v = cellValue(cell.value);
    if (v === null || v === "") return;
    any = true;
    const n = norm(v);
    const name = typeof n === "string" ? n : n.shown;
    if (!idx.has(name)) idx.set(name, col);
  });
  if (!any) throw new Fatal("no header row");
  checkHeader(idx);
  const items: Item[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    let has = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cellValue(cell.value);
      if (v !== null && v !== "") has = true;
    });
    if (!has) continue;
    items.push({
      loc: String(r),
      get: (name) => {
        const k = idx.get(name);
        return k === undefined ? "" : norm(cellValue(row.getCell(k).value));
      },
    });
  }
  return items;
}

function validDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  return d <= dim;
}

function cents(s: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}

function cmp(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const l = Math.min(x.length, y.length);
  for (let i = 0; i < l; i++) {
    const p = x[i]!.codePointAt(0)!;
    const q = y[i]!.codePointAt(0)!;
    if (p !== q) return p - q;
  }
  return x.length - y.length;
}

function fmt(c: bigint): string {
  const w = c / 100n;
  const f = c % 100n;
  return `${w}.${f.toString().padStart(2, "0")}`;
}

async function main(): Promise<{ out: string; err: string }> {
  const { input, groupBy, format: fmtArg } = parseArgs(process.argv.slice(2));
  const format = detectFormat(input, fmtArg);
  let buf: Buffer;
  try {
    buf = readFileSync(input);
  } catch (e) {
    throw new Fatal(`cannot read ${input}: ${(e as Error).message}`);
  }
  let items: Item[];
  if (format === "xlsx") items = await xlsxItems(buf);
  else {
    const text = decodeUtf8(buf);
    items = format === "csv" ? csvItems(text) : format === "json" ? jsonItems(text) : format === "jsonl" ? jsonlItems(text) : yamlItems(text);
  }

  const seen = new Set<string>();
  const sums = new Map<string, bigint>();
  let total = 0n;
  let err = "";

  for (const rec of items) {
    const bad = (reason: string) => {
      err += `${input}:${rec.loc}: ${reason}\n`;
    };
    if (rec.error !== undefined || !rec.get) {
      bad(rec.error ?? "invalid record");
      continue;
    }
    const get = rec.get;
    const str = (name: string): string | null => {
      const v = get(name);
      if (v instanceof Bad) {
        bad(`invalid ${name}: ${v.shown}`);
        return null;
      }
      return v;
    };
    const orderId = str("order_id");
    if (orderId === null) continue;
    if (orderId === "") { bad("empty order_id"); continue; }
    const customer = str("customer_id");
    if (customer === null) continue;
    if (customer === "") { bad("empty customer_id"); continue; }
    const date = str("order_date");
    if (date === null) continue;
    if (!validDate(date)) { bad(`invalid order_date: ${date}`); continue; }
    const sku = str("sku");
    if (sku === null) continue;
    if (sku === "") { bad("empty sku"); continue; }
    const qtyS = str("quantity");
    if (qtyS === null) continue;
    if (!/^\d+$/.test(qtyS) || BigInt(qtyS) < 1n) { bad(`invalid quantity: ${qtyS}`); continue; }
    const priceS = str("unit_price");
    if (priceS === null) continue;
    const price = cents(priceS);
    if (price === null) { bad(`invalid unit_price: ${priceS}`); continue; }
    const discS = str("discount");
    if (discS === null) continue;
    let disc = 0n;
    if (discS !== "") {
      const d = cents(discS);
      if (d === null || d > 100n) { bad(`invalid discount: ${discS}`); continue; }
      disc = d;
    }
    if (format !== "csv" && str("notes") === null) continue;
    const dk = JSON.stringify([orderId, sku]);
    if (seen.has(dk)) { bad(`duplicate (order_id, sku): ${orderId}, ${sku}`); continue; }
    seen.add(dk);
    const rev = (price * BigInt(qtyS) * (100n - disc) + 50n) / 100n;
    const key = groupBy === "day" ? date : groupBy === "sku" ? sku : customer;
    sums.set(key, (sums.get(key) ?? 0n) + rev);
    total += rev;
  }

  let out = `${groupBy}\trevenue\n`;
  for (const k of [...sums.keys()].sort(cmp)) out += `${k}\t${fmt(sums.get(k)!)}\n`;
  out += `TOTAL\t${fmt(total)}\n`;
  return { out, err };
}

try {
  const { out, err } = await main();
  if (err) process.stderr.write(err);
  process.stdout.write(out);
} catch (e) {
  if (e instanceof Fatal) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exitCode = 2;
  } else {
    throw e;
  }
}
