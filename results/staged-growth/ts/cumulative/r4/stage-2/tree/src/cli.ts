import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

class Fatal extends Error {}

const GROUPS = ["day", "sku", "customer"] as const;
type Group = (typeof GROUPS)[number];

const FORMATS = ["csv", "json", "jsonl", "yaml", "xlsx"] as const;
type Format = (typeof FORMATS)[number];
const EXT: Record<string, Format> = {
  csv: "csv", json: "json", jsonl: "jsonl", ndjson: "jsonl", yaml: "yaml", yml: "yaml", xlsx: "xlsx",
};

function parseArgs(argv: string[]): { input: string; group: Group; format: Format } {
  let input: string | undefined;
  let group: string | undefined;
  let format: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const opt = argv[i];
    if (opt !== "--input" && opt !== "--group-by" && opt !== "--format") throw new Fatal(`unknown option: ${opt}`);
    const val = argv[i + 1];
    if (val === undefined) throw new Fatal(`missing value for ${opt}`);
    if (opt === "--input") input = val;
    else if (opt === "--format") format = val;
    else group = val;
  }
  if (input === undefined) throw new Fatal("missing option --input");
  if (group === undefined) throw new Fatal("missing option --group-by");
  if (!(GROUPS as readonly string[]).includes(group)) throw new Fatal(`invalid --group-by value: ${group}`);
  if (format === undefined) {
    const base = input.slice(Math.max(input.lastIndexOf("/"), input.lastIndexOf("\\")) + 1);
    const dot = base.lastIndexOf(".");
    const ext = dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
    const f = Object.hasOwn(EXT, ext) ? EXT[ext] : undefined;
    if (f === undefined) throw new Fatal(`cannot determine format of ${input}`);
    format = f;
  } else if (!(FORMATS as readonly string[]).includes(format)) {
    throw new Fatal(`invalid --format value: ${format}`);
  }
  return { input, group: group as Group, format: format as Format };
}

interface Rec {
  line: number;
  fields: string[];
  error?: string;
}

const isWs = (c: string | undefined) => c === " " || c === "\t";
const trimWs = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, "");

// RFC 4180 style parser; empty lines (outside quotes) are skipped.
function parseCsv(text: string): Rec[] {
  const recs: Rec[] = [];
  let i = 0;
  let line = 1;
  const n = text.length;
  while (i < n) {
    // skip completely empty lines
    if (text[i] === "\n") { i++; line++; continue; }
    if (text[i] === "\r" && text[i + 1] === "\n") { i += 2; line++; continue; }
    const startLine = line;
    const fields: string[] = [];
    let error: string | undefined;
    for (;;) {
      let j = i;
      while (isWs(text[j])) j++;
      let value = "";
      if (text[j] === '"') {
        j++;
        let closed = false;
        while (j < n) {
          const c = text[j];
          if (c === '"') {
            if (text[j + 1] === '"') { value += '"'; j += 2; continue; }
            j++; closed = true; break;
          }
          if (c === "\n") line++;
          value += c;
          j++;
        }
        if (!closed) {
          error ??= "unterminated quoted field";
        } else {
          while (isWs(text[j])) j++;
          if (j < n && text[j] !== "," && text[j] !== "\n" && !(text[j] === "\r" && text[j + 1] === "\n")) {
            error ??= "unexpected characters after closing quote";
            while (j < n && text[j] !== "," && text[j] !== "\n" && !(text[j] === "\r" && text[j + 1] === "\n")) j++;
          }
        }
        fields.push(trimWs(value));
      } else {
        j = i;
        while (j < n && text[j] !== "," && text[j] !== "\n" && !(text[j] === "\r" && text[j + 1] === "\n")) j++;
        fields.push(trimWs(text.slice(i, j)));
      }
      i = j;
      if (i < n && text[i] === ",") { i++; continue; }
      break;
    }
    if (i < n) {
      if (text[i] === "\r") i += 2; else i++;
      line++;
    }
    recs.push(error === undefined ? { line: startLine, fields } : { line: startLine, fields, error });
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

// "12", "12.5", "12.50" -> cents
function parseCents(s: string): bigint | undefined {
  const m = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(s);
  if (!m) return undefined;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}

function cmp(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const p = x[i]!.codePointAt(0)!, q = y[i]!.codePointAt(0)!;
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length - y.length;
}

function fmt(cents: bigint): string {
  const s = cents.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

// ---- typed-format support ----

class DateOnly {
  constructor(readonly text: string) {}
}

// A source row after normalisation: each field is a string, or null if its value is of an unusable type.
interface Row {
  loc: string;
  error?: string;
  get(name: string): string | null;
}

type Kind = "text" | "date" | "num";

function toDecimal(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  if (Object.is(n, -0)) return "-0";
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const digits = m[2]! + (m[3] ?? "");
  const point = m[2]!.length + Number(m[4]);
  let r: string;
  if (point <= 0) r = "0." + "0".repeat(-point) + digits;
  else if (point >= digits.length) r = digits + "0".repeat(point - digits.length);
  else r = digits.slice(0, point) + "." + digits.slice(point);
  return m[1]! + r;
}

function conv(v: unknown, kind: Kind): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return trimWs(v);
  if (typeof v === "number") return toDecimal(v);
  if (v instanceof DateOnly) return kind === "date" ? v.text : null;
  return null;
}

const FIELD_KIND: Record<string, Kind> = { order_date: "date" };

function objectRow(loc: string, o: unknown): Row {
  if (typeof o !== "object" || o === null || Array.isArray(o) || o instanceof DateOnly || o instanceof Map) {
    return { loc, error: "record is not an object", get: () => "" };
  }
  const rec = o as Record<string, unknown>;
  return {
    loc,
    get: (name) => conv(Object.hasOwn(rec, name) ? rec[name] : undefined, FIELD_KIND[name] ?? "text"),
  };
}

function decodeUtf8(buf: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(buf);
  } catch {
    throw new Fatal("input is not valid UTF-8");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function jsonRows(text: string): Row[] {
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new Fatal("invalid JSON"); }
  if (!Array.isArray(v)) throw new Fatal("top-level JSON value is not an array");
  return v.map((o, i) => objectRow(`#${i + 1}`, o));
}

function jsonlRows(text: string): Row[] {
  const rows: Row[] = [];
  text.split(/\r?\n/).forEach((ln, i) => {
    if (/^[ \t\r]*$/.test(ln)) return;
    let v: unknown;
    try { v = JSON.parse(ln); } catch {
      rows.push({ loc: String(i + 1), error: "invalid JSON", get: () => "" });
      return;
    }
    rows.push(objectRow(String(i + 1), v));
  });
  return rows;
}

function yamlRows(text: string): Row[] {
  let v: unknown;
  try {
    v = parseYaml(text, {
      schema: "core",
      customTags: [{
        tag: "tag:yaml.org,2002:timestamp",
        identify: (x: unknown) => x instanceof DateOnly,
        default: true,
        test: /^\d{4}-\d{2}-\d{2}$/,
        resolve: (s: string) => (validDate(s) ? new DateOnly(s) : s),
      }],
    });
  } catch { throw new Fatal("invalid YAML"); }
  if (!Array.isArray(v)) throw new Fatal("top-level YAML value is not a sequence");
  return v.map((o, i) => objectRow(`#${i + 1}`, o));
}

// ---- xlsx ----

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  isArray: (name) => ["si", "r", "t", "row", "c", "sheet", "xf", "numFmt", "Relationship"].includes(name),
});

const arr = (x: unknown): any[] => (x === undefined || x === null || x === "" ? [] : Array.isArray(x) ? x : [x]);
const unesc = (s: string) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

function textOf(t: unknown): string {
  if (typeof t === "string") return t;
  if (t && typeof t === "object") return String((t as any)["#text"] ?? "");
  return "";
}

// text of a <si> / <is> element: plain <t> plus rich-text runs (phonetic runs excluded)
function siText(si: any): string {
  if (typeof si === "string") return "";
  let s = "";
  for (const t of arr(si?.t)) s += textOf(t);
  for (const r of arr(si?.r)) for (const t of arr(r?.t)) s += textOf(t);
  return unesc(s);
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormat(code: string): boolean {
  const c = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/_./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\*./g, "");
  return /[dmyhs]/i.test(c);
}

function serialToDate(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  let days = Math.floor(serial);
  let epoch: number;
  if (date1904) epoch = Date.UTC(1904, 0, 1);
  else if (days < 60) epoch = Date.UTC(1899, 11, 31);
  else if (days === 60) return null;
  else epoch = Date.UTC(1899, 11, 30);
  const d = new Date(epoch + days * 86400000);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y > 9999) return null;
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(y, 4)}-${p(d.getUTCMonth() + 1, 2)}-${p(d.getUTCDate(), 2)}`;
}

function colIndex(ref: string | undefined): number | undefined {
  const m = /^([A-Za-z]+)/.exec(ref ?? "");
  if (!m) return undefined;
  let n = 0;
  for (const ch of m[1]!.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function xlsxRows(buf: Uint8Array): { header: string[]; rows: Row[] } {
  try {
    const files = unzipSync(buf);
    const dec = (p: string) => {
      const f = files[p];
      if (!f) return undefined;
      return new TextDecoder("utf-8").decode(f);
    };
    const wb = xml.parse(dec("xl/workbook.xml") ?? (() => { throw new Error("no workbook"); })());
    const sheet = arr(wb.workbook?.sheets?.sheet)[0];
    if (!sheet) throw new Error("no sheet");
    const date1904 = /^(1|true)$/i.test(String(wb.workbook?.workbookPr?.["@_date1904"] ?? ""));
    const rid = sheet["@_r:id"];
    const rels = xml.parse(dec("xl/_rels/workbook.xml.rels") ?? "");
    const rel = arr(rels.Relationships?.Relationship).find((r) => r["@_Id"] === rid);
    if (!rel) throw new Error("no relationship");
    let target = String(rel["@_Target"]);
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    const parts: string[] = [];
    for (const seg of target.split("/")) {
      if (seg === "..") parts.pop(); else if (seg !== "." && seg !== "") parts.push(seg);
    }
    const sheetXml = dec(parts.join("/"));
    if (sheetXml === undefined) throw new Error("no sheet part");

    const sstXml = dec("xl/sharedStrings.xml");
    const sst: string[] = sstXml ? arr(xml.parse(sstXml).sst?.si).map(siText) : [];

    const dateStyle: boolean[] = [];
    const stylesXml = dec("xl/styles.xml");
    if (stylesXml) {
      const st = xml.parse(stylesXml).styleSheet;
      const custom = new Map<number, string>();
      for (const nf of arr(st?.numFmts?.numFmt)) custom.set(Number(nf["@_numFmtId"]), String(nf["@_formatCode"] ?? ""));
      for (const xf of arr(st?.cellXfs?.xf)) {
        const id = Number(xf["@_numFmtId"] ?? 0);
        const code = custom.get(id);
        dateStyle.push(code !== undefined ? isDateFormat(code) : BUILTIN_DATE.has(id));
      }
    }

    // grid: row number -> (col -> value), value: string | number | DateOnly | null(invalid) | undefined
    type V = string | number | DateOnly | null | undefined;
    const grid = new Map<number, Map<number, V>>();
    const sd = xml.parse(sheetXml).worksheet?.sheetData;
    let rowNo = 0;
    for (const row of arr(sd?.row)) {
      rowNo = row["@_r"] !== undefined ? Number(row["@_r"]) : rowNo + 1;
      const cells = new Map<number, V>();
      let ci = -1;
      for (const c of arr(row?.c)) {
        ci = colIndex(c["@_r"]) ?? ci + 1;
        const t = c["@_t"] as string | undefined;
        const vraw = c.v === undefined ? undefined : textOf(c.v);
        let val: V;
        if (t === "inlineStr") val = siText(c.is);
        else if (vraw === undefined || vraw === "") val = undefined;
        else if (t === "s") val = sst[Number(vraw)] ?? null;
        else if (t === "str") val = unesc(vraw);
        else if (t === "b" || t === "e") val = null;
        else if (t === "d") {
          const m = /^(\d{4}-\d{2}-\d{2})/.exec(vraw.trim());
          val = m && validDate(m[1]!) ? new DateOnly(m[1]!) : null;
        } else {
          const n = Number(vraw.trim());
          if (Number.isNaN(n)) val = null;
          else if (dateStyle[Number(c["@_s"] ?? 0)]) {
            const d = serialToDate(n, date1904);
            val = d === null ? null : new DateOnly(d);
          } else val = n;
        }
        if (val === "") val = undefined;
        if (val !== undefined) cells.set(ci, val);
      }
      if (cells.size > 0) grid.set(rowNo, cells);
    }

    const hrow = grid.get(1);
    if (!hrow) throw new Fatal("no header row");
    const header: string[] = [];
    for (const [k, v] of hrow) {
      header[k] = v instanceof DateOnly ? v.text : v === null || v === undefined ? "" : trimWs(typeof v === "number" ? toDecimal(v) ?? "" : v);
    }
    const idx = new Map<string, number>();
    header.forEach((nm, k) => { if (nm !== undefined && !idx.has(nm)) idx.set(nm, k); });
    const rows: Row[] = [];
    for (const rn of [...grid.keys()].filter((k) => k > 1).sort((a, b) => a - b)) {
      const cells = grid.get(rn)!;
      rows.push({
        loc: String(rn),
        get: (name) => {
          const k = idx.get(name);
          return conv(k === undefined ? undefined : cells.get(k), FIELD_KIND[name] ?? "text");
        },
      });
    }
    return { header: header.map((h) => h ?? ""), rows };
  } catch (e) {
    if (e instanceof Fatal) throw e;
    throw new Fatal("cannot open xlsx workbook");
  }
}

const REQUIRED = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];

function csvRows(text: string): Row[] {
  if (text.length === 0) throw new Fatal("no header line");
  // header is always the first line
  const recs = parseCsv(text.replace(/^(?=\r?\n)/, " "));
  const head = recs[0];
  if (!head) throw new Fatal("no header line");
  const names = head.fields;
  const idx = new Map<string, number>();
  names.forEach((nm, k) => { if (!idx.has(nm)) idx.set(nm, k); });
  for (const r of REQUIRED) if (!idx.has(r)) throw new Fatal(`header missing column: ${r}`);
  return recs.slice(1).map((rec): Row => {
    const loc = String(rec.line);
    if (rec.error) return { loc, error: rec.error, get: () => "" };
    if (rec.fields.length < names.length) return { loc, error: "fewer fields than header", get: () => "" };
    return {
      loc,
      get: (name) => {
        const k = idx.get(name);
        return k === undefined ? "" : (rec.fields[k] ?? "");
      },
    };
  });
}

function main(): { out: string; err: string } {
  const { input, group, format } = parseArgs(process.argv.slice(2));
  let buf: Uint8Array;
  try {
    buf = readFileSync(input);
  } catch (e) {
    throw new Fatal(`cannot read ${input}: ${(e as Error).message}`);
  }
  let rows: Row[];
  if (format === "xlsx") {
    const x = xlsxRows(buf);
    for (const r of REQUIRED) if (!x.header.includes(r)) throw new Fatal(`header missing column: ${r}`);
    rows = x.rows;
  } else {
    const text = decodeUtf8(buf);
    if (format === "csv") rows = csvRows(text);
    else if (format === "json") { rows = jsonRows(text); }
    else if (format === "jsonl") rows = jsonlRows(text);
    else rows = yamlRows(text);
  }

  const seen = new Set<string>();
  const totals = new Map<string, bigint>();
  let err = "";
  for (const rec of rows) {
    const reason = check(rec);
    if (typeof reason === "string") {
      err += `${input}:${rec.loc}: ${reason}\n`;
      continue;
    }
    seen.add(reason.dup);
    const key = group === "day" ? reason.date : group === "sku" ? reason.sku : reason.customer;
    totals.set(key, (totals.get(key) ?? 0n) + reason.rev);
  }

  function check(rec: Row) {
    if (rec.error) return rec.error;
    const bad = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price", "discount", "notes"]
      .find((n) => rec.get(n) === null);
    if (bad !== undefined) return `invalid ${bad}`;
    const g = (n: string) => rec.get(n)!;
    const orderId = g("order_id"), customer = g("customer_id"), date = g("order_date");
    const sku = g("sku"), qs = g("quantity"), ps = g("unit_price"), ds = g("discount");
    if (orderId === "") return "empty order_id";
    if (customer === "") return "empty customer_id";
    if (!validDate(date)) return "invalid order_date";
    if (sku === "") return "empty sku";
    if (!/^[0-9]+$/.test(qs) || BigInt(qs) < 1n) return "invalid quantity";
    const price = parseCents(ps);
    if (price === undefined) return "invalid unit_price";
    let pct = 0n;
    if (ds !== "") {
      const d = parseCents(ds);
      if (d === undefined || d > 100n) return "invalid discount";
      pct = d;
    }
    const dup = JSON.stringify([orderId, sku]);
    if (seen.has(dup)) return "duplicate (order_id, sku)";
    const num = price * BigInt(qs) * (100n - pct);
    const rev = (num * 2n + 100n) / 200n;
    return { dup, date, sku, customer, rev };
  }

  let total = 0n;
  let out = `${group}\trevenue\n`;
  for (const k of [...totals.keys()].sort(cmp)) {
    const v = totals.get(k)!;
    total += v;
    out += `${k}\t${fmt(v)}\n`;
  }
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
