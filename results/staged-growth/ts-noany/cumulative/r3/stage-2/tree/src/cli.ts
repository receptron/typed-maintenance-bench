import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { readXlsx } from "./xlsx.js";

interface Rec {
  line: number;
  fields: string[];
}

function fatal(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
}

type Format = "csv" | "json" | "jsonl" | "yaml" | "xlsx";
type Cell = { k: "empty" } | { k: "text"; s: string } | { k: "bad" };

interface Row {
  loc: string;
  bad?: string;
  get(name: string): Cell;
}

function toFormat(s: string): Format | undefined {
  return s === "csv" || s === "json" || s === "jsonl" || s === "yaml" || s === "xlsx" ? s : undefined;
}

function parseArgs(argv: string[]): { input: string; groupBy: "day" | "sku" | "customer"; format: Format } {
  let input: string | undefined;
  let groupBy: string | undefined;
  let formatArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== "--input" && a !== "--group-by" && a !== "--format") fatal(`unknown argument: ${a}`);
    const v = argv[i + 1];
    if (v === undefined) fatal(`missing value for ${a}`);
    i++;
    if (a === "--input") input = v;
    else if (a === "--format") formatArg = v;
    else groupBy = v;
  }
  if (input === undefined) fatal("missing --input");
  let format: Format | undefined;
  if (formatArg !== undefined) {
    format = toFormat(formatArg);
    if (format === undefined) return fatal(`unknown format: ${formatArg}`);
  } else {
    const base = input.slice(Math.max(input.lastIndexOf("/"), input.lastIndexOf("\\")) + 1);
    const dot = base.lastIndexOf(".");
    const ext = dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
    format = ext === "ndjson" ? "jsonl" : ext === "yml" ? "yaml" : toFormat(ext);
    if (format === undefined) return fatal(`cannot determine format of ${input}`);
  }
  if (groupBy === "day" || groupBy === "sku" || groupBy === "customer") {
    return { input, groupBy, format };
  }
  return fatal(groupBy === undefined ? "missing --group-by" : `invalid --group-by: ${groupBy}`);
}

const WS = new Set([" ", "\t"]);
function trimWs(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && WS.has(s.charAt(a))) a++;
  while (b > a && WS.has(s.charAt(b - 1))) b--;
  return s.slice(a, b);
}

function parseCsv(text: string): Rec[] {
  const recs: Rec[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    // skip completely empty lines
    if (text.charAt(i) === "\n") {
      i++;
      line++;
      continue;
    }
    if (text.charAt(i) === "\r" && text.charAt(i + 1) === "\n") {
      i += 2;
      line++;
      continue;
    }
    const startLine = line;
    const fields: string[] = [];
    let cur = "";
    let done = false;
    while (!done) {
      if (text.charAt(i) === '"' ) {
        i++;
        for (;;) {
          if (i >= n) break;
          const c = text.charAt(i);
          if (c === '"') {
            if (text.charAt(i + 1) === '"') {
              cur += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            if (c === "\n") line++;
            cur += c;
            i++;
          }
        }
      }
      // unquoted remainder (or text after closing quote)
      for (;;) {
        if (i >= n) {
          done = true;
          break;
        }
        const c = text.charAt(i);
        if (c === ",") {
          i++;
          break;
        }
        if (c === "\n") {
          i++;
          line++;
          done = true;
          break;
        }
        if (c === "\r" && text.charAt(i + 1) === "\n") {
          i += 2;
          line++;
          done = true;
          break;
        }
        cur += c;
        i++;
      }
      fields.push(trimWs(cur));
      cur = "";
      if (!done && i >= n) {
        // trailing comma at EOF: one more empty field
        fields.push("");
        done = true;
      }
    }
    recs.push({ line: startLine, fields });
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
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= (days[mo - 1] ?? 0);
}

function cents(s: string): bigint {
  const [w = "0", f = ""] = s.split(".");
  return BigInt(w) * 100n + BigInt(f.padEnd(2, "0"));
}

function cmp(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const p = (x[i] ?? "").codePointAt(0) ?? 0;
    const q = (y[i] ?? "").codePointAt(0) ?? 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length - y.length;
}

function fmt(c: bigint): string {
  const s = c.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

const REQUIRED = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];

function textCell(s: string): Cell {
  const t = trimWs(s);
  return t === "" ? { k: "empty" } : { k: "text", s: t };
}

function numText(n: number): string | undefined {
  if (!Number.isFinite(n)) return undefined;
  const str = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(str);
  if (!m) return str;
  const sign = m[1] ?? "";
  const ip = m[2] ?? "";
  const fp = m[3] ?? "";
  const e = Number(m[4]);
  const digits = ip + fp;
  const point = ip.length + e;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function isoDate(d: Date): string | undefined {
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getUTCFullYear();
  if (y < 0 || y > 9999) return undefined;
  return d.toISOString().slice(0, 10);
}

function valueCell(v: unknown): Cell {
  if (v === undefined || v === null) return { k: "empty" };
  if (typeof v === "string") return textCell(v);
  if (typeof v === "number") {
    const t = numText(v);
    return t === undefined ? { k: "bad" } : { k: "text", s: t };
  }
  if (v instanceof Date) {
    const t = isoDate(v);
    return t === undefined ? { k: "bad" } : { k: "text", s: t };
  }
  return { k: "bad" };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function objRow(loc: string, v: unknown): Row {
  if (!isObj(v)) return { loc, bad: "invalid record", get: () => ({ k: "empty" }) };
  return {
    loc,
    get: (name) => (Object.hasOwn(v, name) ? valueCell(v[name]) : { k: "empty" }),
  };
}

function decodeUtf8(buf: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(buf);
  } catch {
    return fatal("input is not valid UTF-8");
  }
  return text.charAt(0) === "\ufeff" ? text.slice(1) : text;
}

function csvTable(text: string): Row[] {
  const recs = parseCsv(text);
  const header = recs[0];
  if (header === undefined || header.line !== 1) return fatal("no header line");
  const names = header.fields;
  const idx = new Map<string, number>();
  names.forEach((nm, k) => {
    if (!idx.has(nm)) idx.set(nm, k);
  });
  for (const r of REQUIRED) {
    if (!idx.has(r)) return fatal(`header missing column: ${r}`);
  }
  return recs.slice(1).map((r): Row => {
    const loc = String(r.line);
    const get = (name: string): Cell => {
      const k = idx.get(name);
      return textCell(k === undefined ? "" : (r.fields[k] ?? ""));
    };
    return r.fields.length < names.length ? { loc, bad: "too few fields", get } : { loc, get };
  });
}

function jsonTable(text: string): Row[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return fatal("invalid JSON");
  }
  if (!Array.isArray(v)) return fatal("top-level JSON value is not an array");
  return v.map((e: unknown, i) => objRow(`#${i + 1}`, e));
}

function jsonlTable(text: string): Row[] {
  const rows: Row[] = [];
  text.split("\n").forEach((raw, i) => {
    const ln = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (ln === "") return;
    let v: unknown;
    try {
      v = JSON.parse(ln);
    } catch {
      v = undefined;
    }
    rows.push(objRow(String(i + 1), v));
  });
  return rows;
}

function yamlTable(text: string): Row[] {
  const doc = parseDocument(text, { schema: "core", customTags: ["timestamp"] });
  if (doc.errors.length > 0) return fatal("invalid YAML");
  const v: unknown = doc.toJS();
  if (!Array.isArray(v)) return fatal("top-level YAML value is not a sequence");
  return v.map((e: unknown, i) => objRow(`#${i + 1}`, e));
}

function xlsxTable(buf: Uint8Array): Row[] {
  let rows: ReturnType<typeof readXlsx>;
  try {
    rows = readXlsx(buf);
  } catch (e) {
    return fatal(`cannot open workbook: ${e instanceof Error ? e.message : String(e)}`);
  }
  const header = rows.find((r) => r.row === 1);
  if (header === undefined) return fatal("no header row");
  const idx = new Map<string, number>();
  for (const [ci, c] of [...header.cells.entries()].sort((a, b) => a[0] - b[0])) {
    let name: string | undefined;
    if (c.kind === "text") name = trimWs(c.s);
    else if (c.kind === "num") name = numText(c.n);
    if (name !== undefined && !idx.has(name)) idx.set(name, ci);
  }
  if (idx.size === 0) return fatal("no header row");
  for (const r of REQUIRED) {
    if (!idx.has(r)) return fatal(`header missing column: ${r}`);
  }
  const out: Row[] = [];
  for (const r of rows) {
    if (r.row === 1) continue;
    const hasValue = [...r.cells.values()].some((c) => c.kind !== "text" || c.s !== "");
    if (!hasValue) continue;
    out.push({
      loc: String(r.row),
      get: (name) => {
        const k = idx.get(name);
        const c = k === undefined ? undefined : r.cells.get(k);
        if (c === undefined) return { k: "empty" };
        if (c.kind === "bad") return { k: "bad" };
        if (c.kind === "text") return textCell(c.s);
        if (name === "order_date" && c.date !== undefined) return { k: "text", s: c.date };
        return valueCell(c.n);
      },
    });
  }
  return out;
}

function loadRows(input: string, format: Format): Row[] {
  let buf: Uint8Array;
  try {
    buf = readFileSync(input);
  } catch (e) {
    return fatal(`cannot read ${input}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (format === "xlsx") return xlsxTable(buf);
  const text = decodeUtf8(buf);
  if (format === "csv") return csvTable(text);
  if (format === "json") return jsonTable(text);
  if (format === "jsonl") return jsonlTable(text);
  return yamlTable(text);
}

function main(): void {
  const { input, groupBy, format } = parseArgs(process.argv.slice(2));
  const rows = loadRows(input, format);

  const seen = new Set<string>();
  const sums = new Map<string, bigint>();
  const errs: string[] = [];
  for (const r of rows) {
    const reason = ((): string | null => {
      if (r.bad !== undefined) return r.bad;
      const field = (name: string): string | null => {
        const c = r.get(name);
        if (c.k === "bad") return null;
        return c.k === "empty" ? "" : c.s;
      };
      const orderId = field("order_id");
      if (orderId === null) return "invalid order_id";
      if (orderId === "") return "empty order_id";
      const customer = field("customer_id");
      if (customer === null) return "invalid customer_id";
      if (customer === "") return "empty customer_id";
      const date = field("order_date");
      if (date === null || !validDate(date)) return "invalid order_date";
      const sku = field("sku");
      if (sku === null) return "invalid sku";
      if (sku === "") return "empty sku";
      const qty = field("quantity");
      if (qty === null || !/^\d+$/.test(qty) || BigInt(qty) < 1n) return "invalid quantity";
      const price = field("unit_price");
      if (price === null || !/^\d+(\.\d{1,2})?$/.test(price)) return "invalid unit_price";
      const disc = field("discount");
      let pct = 0n;
      if (disc === null) return "invalid discount";
      if (disc !== "") {
        if (!/^\d+(\.\d{1,2})?$/.test(disc)) return "invalid discount";
        pct = cents(disc);
        if (pct > 100n) return "invalid discount";
      }
      if (r.get("notes").k === "bad") return "invalid notes";
      const dk = JSON.stringify([orderId, sku]);
      if (seen.has(dk)) return "duplicate order_id/sku";
      seen.add(dk);
      const rev = (cents(price) * BigInt(qty) * (100n - pct) + 50n) / 100n;
      const key = groupBy === "day" ? date : groupBy === "sku" ? sku : customer;
      sums.set(key, (sums.get(key) ?? 0n) + rev);
      return null;
    })();
    if (reason !== null) errs.push(`${input}:${r.loc}: ${reason}\n`);
  }

  let out = `${groupBy}\trevenue\n`;
  let total = 0n;
  for (const k of [...sums.keys()].sort(cmp)) {
    const v = sums.get(k) ?? 0n;
    total += v;
    out += `${k}\t${fmt(v)}\n`;
  }
  out += `TOTAL\t${fmt(total)}\n`;
  process.stderr.write(errs.join(""));
  process.stdout.write(out);
}

main();
