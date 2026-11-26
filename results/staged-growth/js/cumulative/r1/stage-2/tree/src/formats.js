import { parseDocument } from "yaml";
import { readXlsx, XlsxError } from "./xlsx.js";

export const BAD = Symbol("bad");

const trim = (s) => s.replace(/^[ \t]+|[ \t]+$/g, "");

// Shortest decimal form of a finite number, without exponent.
const numStr = (n) => {
  if (!Number.isFinite(n)) return BAD;
  let s = String(n);
  if (!/e/i.test(s)) return s === "-0" ? "0" : s;
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return BAD;
  const digits = m[2] + (m[3] ?? "");
  const pos = m[2].length + Number(m[4]);
  let r;
  if (pos <= 0) r = "0." + "0".repeat(-pos) + digits;
  else if (pos >= digits.length) r = digits + "0".repeat(pos - digits.length);
  else r = digits.slice(0, pos) + "." + digits.slice(pos);
  return m[1] + r;
};

// Convert a typed value into a string (or BAD).
export const toText = (v, isDate = false) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return trim(v);
  if (typeof v === "number") return numStr(v);
  if (typeof v === "object" && typeof v.date === "string") return isDate ? v.date : BAD;
  return BAD;
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const objGetter = (o) => (name) => (Object.hasOwn(o, name) ? o[name] : null);

const utf8 = (buf) => {
  let t = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t;
};

// Each reader returns { records: [{ loc, get(name) | invalid: true }], header?: string[] }
export const readTyped = (format, buf) => {
  if (format === "json") {
    const v = JSON.parse(utf8(buf));
    if (!Array.isArray(v)) throw new Error("top-level value is not an array");
    return { records: v.map((e, i) => ({ loc: `#${i + 1}`, ...(isObj(e) ? { get: objGetter(e) } : { invalid: true }) })) };
  }
  if (format === "jsonl") {
    const records = [];
    utf8(buf).split("\n").forEach((ln, i) => {
      if (trim(ln.replace(/\r/g, "")) === "") return;
      let v;
      try { v = JSON.parse(ln); } catch { v = undefined; }
      records.push({ loc: String(i + 1), ...(isObj(v) ? { get: objGetter(v) } : { invalid: true }) });
    });
    return { records };
  }
  if (format === "yaml") {
    const doc = parseDocument(utf8(buf), { uniqueKeys: false });
    if (doc.errors.length) throw new Error(doc.errors[0].message);
    const v = doc.toJS({ maxAliasCount: -1 });
    if (!Array.isArray(v)) throw new Error("top-level value is not a sequence");
    return { records: v.map((e, i) => ({ loc: `#${i + 1}`, ...(isObj(e) && !(e instanceof Map) ? { get: objGetter(e) } : { invalid: true }) })) };
  }
  // xlsx
  let rows;
  try { rows = readXlsx(buf); } catch (e) {
    if (e instanceof XlsxError) throw e;
    throw new XlsxError(`cannot open workbook: ${e.message}`);
  }
  if (rows.length === 0 || rows[0].line !== 1) throw new XlsxError("no header row");
  const header = new Map();
  for (const [ci, v] of rows[0].cells) {
    const t = toText(v);
    if (t !== BAD && t !== "" && !header.has(t)) header.set(t, ci);
  }
  const records = rows.slice(1).map((r) => ({
    loc: String(r.line),
    get: (name) => (header.has(name) ? r.cells.get(header.get(name)) ?? null : null),
  }));
  return { records, header };
};
