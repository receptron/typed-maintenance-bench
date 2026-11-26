import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { readXlsx } from "./xlsx.js";

class Fatal extends Error {}

const FORMATS = ["csv", "json", "jsonl", "yaml", "xlsx"] as const;
type Format = (typeof FORMATS)[number];
const EXT: Record<string, Format> = {
  ".csv": "csv", ".json": "json", ".jsonl": "jsonl", ".ndjson": "jsonl", ".yaml": "yaml", ".yml": "yaml", ".xlsx": "xlsx",
};

function parseArgs(argv: string[]): { input: string; groupBy: "day" | "sku" | "customer"; format: Format } {
  let input: string | undefined;
  let formatArg: string | undefined;
  let groupBy: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const opt = argv[i];
    if (opt !== "--input" && opt !== "--group-by" && opt !== "--format") throw new Fatal(`unknown option: ${opt}`);
    const val = argv[i + 1];
    if (val === undefined) throw new Fatal(`missing value for ${opt}`);
    if (opt === "--input") input = val;
    else if (opt === "--format") formatArg = val;
    else groupBy = val;
  }
  if (input === undefined) throw new Fatal("missing option --input");
  if (groupBy === undefined) throw new Fatal("missing option --group-by");
  if (groupBy !== "day" && groupBy !== "sku" && groupBy !== "customer")
    throw new Fatal(`invalid --group-by value: ${groupBy}`);
  let format: Format;
  if (formatArg !== undefined) {
    if (!(FORMATS as readonly string[]).includes(formatArg)) throw new Fatal(`invalid --format value: ${formatArg}`);
    format = formatArg as Format;
  } else {
    const m = /\.[^./\\]*$/.exec(input);
    const f = m ? EXT[m[0].toLowerCase()] : undefined;
    if (f === undefined) throw new Fatal(`cannot determine format of ${input}`);
    format = f;
  }
  return { input, groupBy, format };
}

interface Rec {
  line: number;
  fields: string[];
  error?: string;
}

const isWs = (c: string | undefined) => c === " " || c === "\t";

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
    let error: string | undefined;
    let done = false;
    while (!done) {
      let j = i;
      while (isWs(text[j])) j++;
      if (text[j] === '"') {
        j++;
        let val = "";
        let closed = false;
        while (j < n) {
          const c = text[j]!;
          if (c === '"') {
            if (text[j + 1] === '"') { val += '"'; j += 2; continue; }
            j++; closed = true; break;
          }
          if (c === "\n") line++;
          val += c;
          j++;
        }
        if (!closed) {
          error = "unterminated quoted field";
          fields.push(val);
          i = n;
          done = true;
          break;
        }
        while (isWs(text[j])) j++;
        const c = text[j];
        if (j < n && c !== "," && c !== "\n" && !(c === "\r" && text[j + 1] === "\n")) {
          error ??= "unexpected characters after closing quote";
          // skip to end of record
          while (j < n && text[j] !== "\n" && !(text[j] === "\r" && text[j + 1] === "\n")) j++;
        }
        fields.push(val.replace(/^[ \t]+|[ \t]+$/g, ""));
        i = j;
      } else {
        let k = i;
        while (k < n && text[k] !== "," && text[k] !== "\n" && !(text[k] === "\r" && text[k + 1] === "\n")) k++;
        fields.push(text.slice(i, k).replace(/^[ \t]+|[ \t]+$/g, ""));
        i = k;
      }
      if (i >= n) { done = true; }
      else if (text[i] === ",") { i++; if (i >= n) { fields.push(""); done = true; } }
      else {
        i += text[i] === "\r" ? 2 : 1;
        line++;
        done = true;
      }
    }
    recs.push(error !== undefined ? { line: startLine, fields, error } : { line: startLine, fields });
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

// parse decimal with <=2 decimals into hundredths
function hundredths(s: string): bigint | undefined {
  const m = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(s);
  if (!m) return undefined;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}

function cmp(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0)!);
  const y = Array.from(b, (c) => c.codePointAt(0)!);
  const l = Math.min(x.length, y.length);
  for (let i = 0; i < l; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return x.length - y.length;
}

function fmt(c: bigint): string {
  const s = c.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

const REQUIRED = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price", "discount"];
const COLS = [...REQUIRED, "notes"];

// A normalized record. get() returns the trimmed text of a field, "" if empty,
// or null if the value has an invalid type.
interface Item {
  loc: string;
  error?: string;
  short?: boolean;
  get: (k: string) => string | null;
}

const trim = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, "");

function numText(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const digits = m[2]! + (m[3] ?? "");
  const pointPos = 1 + Number(m[4]);
  let body: string;
  if (pointPos <= 0) body = "0." + "0".repeat(-pointPos) + digits;
  else if (pointPos >= digits.length) body = digits + "0".repeat(pointPos - digits.length);
  else body = digits.slice(0, pointPos) + "." + digits.slice(pointPos);
  return m[1]! + body;
}

function typedText(v: unknown): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return trim(v);
  if (typeof v === "number") return numText(v);
  return null;
}

function objectItems(vals: unknown[], locOf: (i: number) => string): Item[] {
  return vals.map((v, i) => {
    const loc = locOf(i);
    if (typeof v !== "object" || v === null || Array.isArray(v))
      return { loc, error: "record is not an object", get: () => "" };
    const o = v as Record<string, unknown>;
    return { loc, get: (k) => (Object.hasOwn(o, k) ? typedText(o[k]) : "") };
  });
}

function decodeUtf8(buf: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    throw new Fatal("input is not valid UTF-8");
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function load(input: string, format: Format): Item[] {
  let buf: Buffer;
  try {
    buf = readFileSync(input);
  } catch (e) {
    throw new Fatal(`cannot read ${input}: ${(e as Error).message}`);
  }
  if (format === "xlsx") {
    let rows;
    try {
      rows = readXlsx(buf);
    } catch (e) {
      throw new Fatal(`cannot open ${input}: ${(e as Error).message}`);
    }
    const hdr = rows.find((r) => r.row === 1);
    if (!hdr) throw new Fatal("no header row");
    const names = new Map<string, number>();
    for (const [ci, c] of hdr.cells) {
      const name = c.kind === "text" ? trim(c.v) : c.kind === "num" ? numText(c.v) : null;
      if (name !== null && !names.has(name)) names.set(name, ci);
      else if (name !== null && ci < names.get(name)!) names.set(name, ci);
    }
    for (const name of REQUIRED)
      if (name !== "discount" && !names.has(name)) throw new Fatal(`header missing required column: ${name}`);
    const items: Item[] = [];
    for (const r of rows) {
      if (r.row === 1 || r.cells.size === 0) continue;
      items.push({
        loc: String(r.row),
        get: (k) => {
          const ci = names.get(k);
          const c = ci === undefined ? undefined : r.cells.get(ci);
          if (c === undefined) return "";
          if (c.kind === "text") return trim(c.v);
          if (c.kind === "num") return numText(c.v);
          if (c.kind === "date") return k === "order_date" ? c.v : null;
          return null;
        },
      });
    }
    return items;
  }
  const text = decodeUtf8(buf);
  if (format === "json") {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Fatal("invalid JSON");
    }
    if (!Array.isArray(v)) throw new Fatal("top-level JSON value is not an array");
    return objectItems(v, (i) => `#${i + 1}`);
  }
  if (format === "yaml") {
    let v: unknown;
    try {
      v = parseYaml(text);
    } catch {
      throw new Fatal("invalid YAML");
    }
    if (!Array.isArray(v)) throw new Fatal("top-level YAML value is not a sequence");
    return objectItems(v, (i) => `#${i + 1}`);
  }
  if (format === "jsonl") {
    const items: Item[] = [];
    text.split("\n").forEach((ln, i) => {
      if (/^[ \t\r]*$/.test(ln)) return;
      let v: unknown;
      try {
        v = JSON.parse(ln);
      } catch {
        items.push({ loc: String(i + 1), error: "invalid JSON", get: () => "" });
        return;
      }
      items.push(...objectItems([v], () => String(i + 1)));
    });
    return items;
  }
  // csv
  if (text.length === 0) throw new Fatal("no header line");
  const recs = parseCsv(text);
  if (recs.length === 0) throw new Fatal("no header line");
  const header = recs[0]!.fields;
  const col: Record<string, number> = {};
  for (const name of REQUIRED) {
    const idx = header.indexOf(name);
    if (idx >= 0) col[name] = idx;
    else if (name !== "discount") throw new Fatal(`header missing required column: ${name}`);
  }
  return recs.slice(1).map((r) => {
    const it: Item = { loc: String(r.line), get: (k) => (col[k] === undefined ? "" : r.fields[col[k]!]!) };
    if (r.error) it.error = r.error;
    else if (r.fields.length < header.length) it.error = "too few fields";
    return it;
  });
}

function main(): { out: string; err: string } {
  const { input, groupBy, format } = parseArgs(process.argv.slice(2));
  const items = load(input, format);
  const seen = new Set<string>();
  const totals = new Map<string, bigint>();
  let err = "";
  for (const r of items) {
    const reason = (): string | undefined => {
      if (r.error) return r.error;
      const vals: Record<string, string> = {};
      for (const k of COLS) {
        const v = r.get(k);
        if (v === null) {
          if (k !== "notes") return k === "order_id" || k === "customer_id" || k === "sku" ? `empty ${k}` : `invalid ${k}`;
        } else vals[k] = v;
      }
      const f = (k: string) => vals[k] ?? "";
      for (const k of ["order_id", "customer_id", "sku"])
        if (f(k) === "") return `empty ${k}`;
      if (!validDate(f("order_date"))) return "invalid order_date";
      if (!/^[0-9]+$/.test(f("quantity")) || BigInt(f("quantity")) < 1n) return "invalid quantity";
      const price = hundredths(f("unit_price"));
      if (price === undefined) return "invalid unit_price";
      let disc = 0n;
      if (f("discount") !== "") {
        const d = hundredths(f("discount"));
        if (d === undefined || d > 100n) return "invalid discount";
        disc = d;
      }
      if (seen.has(JSON.stringify([f("order_id"), f("sku")]))) return "duplicate order_id and sku";
      seen.add(JSON.stringify([f("order_id"), f("sku")]));
      const num = price * BigInt(f("quantity")) * (100n - disc);
      const rev = (num * 2n + 100n) / 200n;
      const key = groupBy === "day" ? f("order_date") : groupBy === "sku" ? f("sku") : f("customer_id");
      totals.set(key, (totals.get(key) ?? 0n) + rev);
      return undefined;
    };
    const why = reason();
    if (why !== undefined) err += `${input}:${r.loc}: ${why}\n`;
  }
  let out = `${groupBy}\trevenue\n`;
  let sum = 0n;
  for (const k of [...totals.keys()].sort(cmp)) {
    const v = totals.get(k)!;
    sum += v;
    out += `${k}\t${fmt(v)}\n`;
  }
  out += `TOTAL\t${fmt(sum)}\n`;
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
