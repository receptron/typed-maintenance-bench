import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseDocument } from "yaml";
import { loadXlsx } from "./xlsx.js";
import { Fatal, type Rec, type Val, recFromObject, trimBlank } from "./values.js";

interface RawRecord {
  line: number;
  fields: string[];
  error: string | null;
}

function parseCsv(text: string): RawRecord[] {
  const records: RawRecord[] = [];
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
    let error: string | null = null;
    let recordDone = false;
    while (!recordDone) {
      // parse one field
      let j = i;
      while (j < n && (text[j] === " " || text[j] === "\t")) j++;
      let value = "";
      if (text[j] === '"') {
        j++;
        let closed = false;
        while (j < n) {
          const c = text[j];
          if (c === '"') {
            if (text[j + 1] === '"') {
              value += '"';
              j += 2;
            } else {
              j++;
              closed = true;
              break;
            }
          } else {
            if (c === "\n") line++;
            value += c;
            j++;
          }
        }
        if (!closed) {
          error = "unterminated quoted field";
          i = n;
          fields.push(trimBlank(value));
          break;
        }
        while (j < n && (text[j] === " " || text[j] === "\t")) j++;
        if (j < n && text[j] !== "," && text[j] !== "\n" && !(text[j] === "\r" && text[j + 1] === "\n")) {
          if (error === null) error = "unexpected characters after closing quote";
          while (j < n && text[j] !== "," && text[j] !== "\n") j++;
        }
      } else {
        j = i;
        while (j < n && text[j] !== "," && text[j] !== "\n") j++;
        value = text.slice(i, j);
        if (value.endsWith("\r") && (j >= n || text[j] === "\n")) value = value.slice(0, -1);
        if (value.includes('"') && error === null) error = "stray quote in unquoted field";
      }
      fields.push(trimBlank(value));
      if (j >= n) {
        i = n;
        recordDone = true;
      } else if (text[j] === ",") {
        i = j + 1;
      } else {
        i = j + 1;
        line++;
        recordDone = true;
      }
    }
    records.push({ line: startLine, fields, error });
  }
  return records;
}

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m === null) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= (days[mo - 1] ?? 0);
}

function cents(s: string): bigint {
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
}

function cmp(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  const len = Math.min(x.length, y.length);
  for (let k = 0; k < len; k++) {
    const p = x[k] ?? 0;
    const q = y[k] ?? 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length - y.length;
}

function fmt(c: bigint): string {
  const s = c.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

type Format = "csv" | "json" | "jsonl" | "yaml" | "xlsx";

function toFormat(s: string): Format | null {
  return s === "csv" || s === "json" || s === "jsonl" || s === "yaml" || s === "xlsx" ? s : null;
}

const EXTENSIONS: Record<string, Format> = {
  ".csv": "csv",
  ".json": "json",
  ".jsonl": "jsonl",
  ".ndjson": "jsonl",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".xlsx": "xlsx",
};

function parseArgs(argv: string[]): { input: string; groupBy: "day" | "sku" | "customer"; format: Format } {
  let input: string | undefined;
  let groupBy: string | undefined;
  let formatArg: string | undefined;
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === "--input" || a === "--group-by" || a === "--format") {
      const v = argv[k + 1];
      if (v === undefined) throw new Fatal(`missing value for ${a}`);
      if (a === "--input") input = v;
      else if (a === "--group-by") groupBy = v;
      else formatArg = v;
      k++;
    } else {
      throw new Fatal(`unknown option: ${a}`);
    }
  }
  if (input === undefined) throw new Fatal("missing option --input");
  if (groupBy === undefined) throw new Fatal("missing option --group-by");
  if (groupBy !== "day" && groupBy !== "sku" && groupBy !== "customer") {
    throw new Fatal(`invalid --group-by value: ${groupBy}`);
  }
  let format: Format | null;
  if (formatArg !== undefined) {
    format = toFormat(formatArg);
    if (format === null) throw new Fatal(`invalid --format value: ${formatArg}`);
  } else {
    const ext = extname(input).toLowerCase();
    format = Object.hasOwn(EXTENSIONS, ext) ? (EXTENSIONS[ext] ?? null) : null;
    if (format === null) throw new Fatal(`cannot determine format of ${input}`);
  }
  return { input, groupBy, format };
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.startsWith("\uFEFF") ? text.slice(1) : text;
  } catch {
    throw new Fatal("input is not valid UTF-8");
  }
}

function loadCsv(text: string): Rec[] {
  const records = parseCsv(text);
  const header = records[0];
  if (header === undefined) throw new Fatal("no header line");
  const col = new Map<string, number>();
  header.fields.forEach((name, idx) => {
    if (!col.has(name)) col.set(name, idx);
  });
  const need = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];
  for (const name of need) {
    if (!col.has(name)) throw new Fatal(`header missing column: ${name}`);
  }
  return records.slice(1).map((rec) => ({
    loc: String(rec.line),
    error: rec.error ?? (rec.fields.length < header.fields.length ? "too few fields" : null),
    get: (name): Val => {
      const idx = col.get(name);
      return { k: "text", s: idx === undefined ? "" : (rec.fields[idx] ?? "") };
    },
  }));
}

function loadJson(text: string): Rec[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Fatal("invalid JSON");
  }
  if (!Array.isArray(v)) throw new Fatal("top-level JSON value is not an array");
  return v.map((el: unknown, i) => recFromObject(`#${i + 1}`, el));
}

function loadJsonl(text: string): Rec[] {
  const recs: Rec[] = [];
  text.split("\n").forEach((line, i) => {
    if (/^[ \t\r]*$/.test(line)) return;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      v = undefined;
    }
    recs.push(recFromObject(String(i + 1), v));
  });
  return recs;
}

function loadYaml(text: string): Rec[] {
  let v: unknown;
  try {
    const doc = parseDocument(text, { customTags: ["timestamp"] });
    if (doc.errors.length > 0) throw new Fatal("invalid YAML");
    v = doc.toJS();
  } catch {
    throw new Fatal("invalid YAML");
  }
  if (!Array.isArray(v)) throw new Fatal("top-level YAML value is not a sequence");
  return v.map((el: unknown, i) => recFromObject(`#${i + 1}`, el));
}

function asText(v: Val): string | null {
  return v.k === "empty" ? "" : v.k === "text" || v.k === "num" ? v.s : null;
}

function asDate(v: Val): string | null {
  return v.k === "num" ? (v.date ?? v.s) : v.k === "date" ? v.s : asText(v);
}

function run(): { out: string; err: string } {
  const { input, groupBy, format } = parseArgs(process.argv.slice(2));
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(input);
  } catch (e) {
    throw new Fatal(`cannot read ${input}`);
  }
  let records: Rec[];
  if (format === "xlsx") records = loadXlsx(bytes).recs;
  else {
    const text = decodeUtf8(bytes);
    if (format === "csv") records = loadCsv(text);
    else if (format === "json") records = loadJson(text);
    else if (format === "jsonl") records = loadJsonl(text);
    else records = loadYaml(text);
  }

  const seen = new Set<string>();
  const totals = new Map<string, bigint>();
  let err = "";
  let total = 0n;
  for (const rec of records) {
    const fail = (reason: string): void => {
      err += `${input}:${rec.loc}: ${reason}\n`;
    };
    if (rec.error !== null) {
      fail(rec.error);
      continue;
    }
    const orderId = asText(rec.get("order_id"));
    if (orderId === null) { fail("invalid order_id"); continue; }
    if (orderId === "") { fail("empty order_id"); continue; }
    const customer = asText(rec.get("customer_id"));
    if (customer === null) { fail("invalid customer_id"); continue; }
    if (customer === "") { fail("empty customer_id"); continue; }
    const date = asDate(rec.get("order_date"));
    if (date === null || !isRealDate(date)) { fail("invalid order_date"); continue; }
    const sku = asText(rec.get("sku"));
    if (sku === null) { fail("invalid sku"); continue; }
    if (sku === "") { fail("empty sku"); continue; }
    const qty = asText(rec.get("quantity"));
    if (qty === null || !/^[0-9]+$/.test(qty) || BigInt(qty) < 1n) { fail("invalid quantity"); continue; }
    const price = asText(rec.get("unit_price"));
    if (price === null || !/^[0-9]+(\.[0-9]{1,2})?$/.test(price)) { fail("invalid unit_price"); continue; }
    const disc = asText(rec.get("discount"));
    let discPct = 0n;
    if (disc === null) { fail("invalid discount"); continue; }
    if (disc !== "") {
      if (!/^[01](\.[0-9]{1,2})?$/.test(disc) || cents(disc) > 100n) { fail("invalid discount"); continue; }
      discPct = cents(disc);
    }
    if (asText(rec.get("notes")) === null) { fail("invalid notes"); continue; }
    const key = JSON.stringify([orderId, sku]);
    if (seen.has(key)) { fail("duplicate order_id and sku"); continue; }
    seen.add(key);
    const rev = (cents(price) * BigInt(qty) * (100n - discPct) + 50n) / 100n;
    const k = groupBy === "day" ? date : groupBy === "sku" ? sku : customer;
    totals.set(k, (totals.get(k) ?? 0n) + rev);
    total += rev;
  }
  let out = `${groupBy}\trevenue\n`;
  for (const k of [...totals.keys()].sort(cmp)) {
    out += `${k}\t${fmt(totals.get(k) ?? 0n)}\n`;
  }
  out += `TOTAL\t${fmt(total)}\n`;
  return { out, err };
}

try {
  const { out, err } = run();
  process.stderr.write(err);
  process.stdout.write(out);
} catch (e) {
  process.stderr.write(`error: ${e instanceof Error ? e.message : "unknown error"}\n`);
  process.exitCode = 2;
}
