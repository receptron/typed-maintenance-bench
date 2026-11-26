import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

const fatal = (msg) => {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
};

const parseArgs = (argv) => {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    if (name !== "--input" && name !== "--group-by" && name !== "--format") fatal(`unknown option: ${name}`);
    if (i + 1 >= argv.length) fatal(`missing value for ${name}`);
    opts[name] = argv[i + 1];
  }
  if (opts["--input"] === undefined) fatal("missing --input");
  if (opts["--group-by"] === undefined) fatal("missing --group-by");
  if (!["day", "sku", "customer"].includes(opts["--group-by"])) fatal(`invalid --group-by: ${opts["--group-by"]}`);
  const formats = ["csv", "json", "jsonl", "yaml", "xlsx"];
  let format = opts["--format"];
  if (format === undefined) {
    const base = opts["--input"].split(/[\\/]/).pop();
    const dot = base.lastIndexOf(".");
    const ext = dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
    format = { csv: "csv", json: "json", jsonl: "jsonl", ndjson: "jsonl", yaml: "yaml", yml: "yaml", xlsx: "xlsx" }[ext];
    if (format === undefined) fatal(`cannot determine format of ${opts["--input"]}; use --format`);
  } else if (!formats.includes(format)) fatal(`invalid --format: ${format}`);
  return { input: opts["--input"], groupBy: opts["--group-by"], format };
};

// RFC 4180 parser; yields { line, fields, blank }
const parseCsv = (text) => {
  const records = [];
  let i = 0;
  let line = 1;
  const n = text.length;
  while (i < n) {
    const startLine = line;
    const fields = [];
    let field = "";
    let sawQuote = false;
    let inQuotes = false;
    let blank = true;
    for (;;) {
      if (i >= n) { fields.push(field); break; }
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        if (c === "\n") line++;
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; sawQuote = true; blank = false; i++; continue; }
      if (c === ",") { fields.push(field); field = ""; blank = false; i++; continue; }
      if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
        i += c === "\r" ? 2 : 1; line++;
        fields.push(field); break;
      }
      field += c; blank = false; i++;
    }
    records.push({ line: startLine, fields: fields.map((f) => f.replace(/^[ \t]+|[ \t]+$/g, "")), blank: blank && !sawQuote });
  }
  return records;
};

const validDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= dim;
};

const cents = (s) => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
};

const cmp = (a, b) => {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
};


const FIELDS = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price", "discount", "notes"];
const REQUIRED = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];
const trimST = (s) => s.replace(/^[ \t]+|[ \t]+$/g, "");

// shortest decimal form of a finite number, never in exponent notation
const numToDecimal = (n) => {
  if (!Number.isFinite(n)) return null;
  if (Object.is(n, -0)) return "0";
  let s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const [, sign, ip, fp = "", ex] = m;
  const digits = ip + fp;
  const pos = ip.length + Number(ex);
  if (pos <= 0) s = "0." + "0".repeat(-pos) + digits;
  else if (pos >= digits.length) s = digits + "0".repeat(pos - digits.length);
  else s = digits.slice(0, pos) + "." + digits.slice(pos);
  return sign + s;
};

class DateValue {
  constructor(text) { this.text = text; }
}

// Convert a typed value to the string the CSV rules operate on; null = invalid type.
const typedToString = (v, field) => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return trimST(v);
  if (typeof v === "number") return numToDecimal(v);
  if (v instanceof DateValue) return field === "order_date" ? v.text : (v.alt ?? v.text);
  return null;
};

const typedRecord = (loc, obj) => {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return { loc, pre: "invalid record" };
  const vals = {};
  for (const f of FIELDS) {
    const raw = Object.prototype.hasOwnProperty.call(obj, f) ? obj[f] : undefined;
    const s = typedToString(raw, f);
    if (s === null) return { loc, pre: `invalid ${f}` };
    vals[f] = s;
  }
  return { loc, get: (name) => vals[name] };
};

const decodeUtf8 = (buf) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    fatal("input is not valid UTF-8");
  }
};

const readCsv = (buf) => {
  const text = decodeUtf8(buf);
  const records = parseCsv(text);
  if (records.length === 0) fatal("no header line");
  const header = records[0].fields;
  const idx = {};
  header.forEach((h, k) => { if (!(h in idx)) idx[h] = k; });
  for (const r of REQUIRED) if (!(r in idx)) fatal(`header missing column: ${r}`);
  return records.slice(1).filter((r) => !r.blank).map((rec) => {
    if (rec.fields.length < header.length) return { loc: rec.line, pre: "too few fields" };
    return { loc: rec.line, get: (name) => (name in idx ? rec.fields[idx[name]] : undefined) };
  });
};

const readJson = (buf) => {
  let data;
  try { data = JSON.parse(decodeUtf8(buf)); } catch { fatal("invalid JSON"); }
  if (!Array.isArray(data)) fatal("JSON top-level value is not an array");
  return data.map((o, i) => typedRecord(`#${i + 1}`, o));
};

const readJsonl = (buf) => {
  const out = [];
  decodeUtf8(buf).split("\n").forEach((line, i) => {
    if (line.trim() === "") return;
    let o;
    try { o = JSON.parse(line); } catch { out.push({ loc: i + 1, pre: "invalid JSON" }); return; }
    out.push(typedRecord(i + 1, o));
  });
  return out;
};

const readYaml = (buf) => {
  let data;
  try {
    const doc = parseDocument(decodeUtf8(buf), { schema: "core", version: "1.2" });
    if (doc.errors.length) throw new Error("bad yaml");
    data = doc.toJS();
  } catch { fatal("invalid YAML"); }
  if (!Array.isArray(data)) fatal("YAML top-level value is not a sequence");
  return data.map((o, i) => typedRecord(`#${i + 1}`, o));
};

// ---- xlsx ----
const arr = (x) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const decodeXlsxText = (s) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const textOf = (t) => (typeof t === "string" ? t : t && typeof t === "object" ? String(t["#text"] ?? "") : "");
const richText = (si) => {
  if (si === undefined || si === null || typeof si !== "object") return "";
  let s = textOf(si.t);
  for (const r of arr(si.r)) s += textOf(r.t);
  return decodeXlsxText(s);
};

const colIndex = (ref) => {
  const m = /^([A-Za-z]+)/.exec(ref ?? "");
  if (!m) return null;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

const isDateFormat = (id, code) => {
  if (code === undefined) return (id >= 14 && id <= 17) || id === 22 || (id >= 27 && id <= 31) || (id >= 34 && id <= 36) || (id >= 50 && id <= 58);
  const c = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "").replace(/_./g, "");
  return /[ydYD]/.test(c);
};

const serialToDate = (n, epoch1904) => {
  if (!Number.isFinite(n) || n < 0) return null;
  const days = Math.floor(n);
  let ms;
  if (epoch1904) ms = Date.UTC(1904, 0, 1) + days * 86400000;
  else if (days === 60) return null;
  else ms = days < 60 ? Date.UTC(1899, 11, 31) + days * 86400000 : Date.UTC(1899, 11, 30) + days * 86400000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (y < 0 || y > 9999) return null;
  return `${String(y).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

const readXlsx = (buf) => {
  let files;
  const xp = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false, parseAttributeValue: false,
    trimValues: false, processEntities: true, htmlEntities: true,
  });
  let wbDoc, sheetDoc, sst = [], xfs = [], numFmts = {}, epoch1904 = false;
  try {
    files = unzipSync(new Uint8Array(buf));
    const get = (p) => {
      const f = files[p.replace(/^\//, "")];
      return f === undefined ? undefined : xp.parse(Buffer.from(f).toString("utf8"));
    };
    wbDoc = get("xl/workbook.xml");
    const rels = get("xl/_rels/workbook.xml.rels");
    const first = arr(wbDoc.workbook.sheets.sheet)[0];
    const rid = first["@_r:id"];
    const rel = arr(rels.Relationships.Relationship).find((r) => r["@_Id"] === rid);
    let target = rel["@_Target"];
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    const parts = [];
    for (const p of target.split("/")) { if (p === "..") parts.pop(); else if (p !== ".") parts.push(p); }
    sheetDoc = get(parts.join("/"));
    if (!sheetDoc || !sheetDoc.worksheet) throw new Error("no sheet");
    epoch1904 = ["1", "true"].includes(String(wbDoc.workbook.workbookPr?.["@_date1904"]));
    const sd = get("xl/sharedStrings.xml");
    if (sd?.sst) sst = arr(sd.sst.si).map(richText);
    const st = get("xl/styles.xml");
    if (st?.styleSheet) {
      for (const nf of arr(st.styleSheet.numFmts?.numFmt)) numFmts[nf["@_numFmtId"]] = nf["@_formatCode"];
      xfs = arr(st.styleSheet.cellXfs?.xf).map((x) => {
        const id = Number(x["@_numFmtId"] ?? 0);
        return isDateFormat(id, numFmts[id]);
      });
    }
  } catch { fatal("cannot open xlsx workbook"); }

  // rows: Map rowNumber -> Map col -> value (string | number | DateValue | {bad})
  const BAD = Symbol("bad");
  const rows = [];
  let prevRow = 0;
  for (const row of arr(sheetDoc.worksheet.sheetData?.row)) {
    const rn = row["@_r"] !== undefined ? Number(row["@_r"]) : prevRow + 1;
    prevRow = rn;
    const cells = new Map();
    let prevCol = -1;
    for (const c of arr(row.c)) {
      let ci = colIndex(c["@_r"]);
      if (ci === null) ci = prevCol + 1;
      prevCol = ci;
      const t = c["@_t"] ?? "n";
      let val;
      const vtext = c.v === undefined ? undefined : textOf(c.v);
      if (t === "inlineStr") val = richText(c.is);
      else if (vtext === undefined) val = undefined;
      else if (t === "s") val = sst[Number(vtext)] ?? BAD;
      else if (t === "str") val = decodeXlsxText(vtext);
      else if (t === "b" || t === "e") val = BAD;
      else if (t === "d") {
        const m = /^(\d{4}-\d{2}-\d{2})/.exec(vtext.trim());
        val = m ? new DateValue(m[1]) : BAD;
      } else {
        const trimmed = vtext.trim();
        if (trimmed === "") val = undefined;
        else {
          const n = Number(trimmed);
          if (!Number.isFinite(n)) val = BAD;
          else if (xfs[Number(c["@_s"] ?? 0)]) {
            const d = serialToDate(n, epoch1904);
            const dv = new DateValue(d ?? "");
            dv.alt = numToDecimal(n);
            val = dv;
          } else val = n;
        }
      }
      if (val !== undefined) cells.set(ci, val);
    }
    const hasValue = [...cells.values()].some((v) => v !== "");
    if (hasValue) rows.push({ rn, cells });
  }
  const headerRow = rows.find((r) => r.rn === 1);
  if (!headerRow) fatal("no header row");
  const idx = {};
  const hname = (v) => (typeof v === "string" ? trimST(v) : typeof v === "number" ? numToDecimal(v) : v instanceof DateValue ? v.alt ?? v.text : null);
  for (const [ci, v] of [...headerRow.cells].sort((a, b) => a[0] - b[0])) {
    const h = hname(v);
    if (h !== null && !(h in idx)) idx[h] = ci;
  }
  for (const r of REQUIRED) if (!(r in idx)) fatal(`header missing column: ${r}`);
  return rows.filter((r) => r.rn !== 1 && r.rn > 1).sort((a, b) => a.rn - b.rn).map(({ rn, cells }) => {
    const obj = {};
    for (const f of FIELDS) {
      if (!(f in idx) || !cells.has(idx[f])) continue;
      const v = cells.get(idx[f]);
      obj[f] = v === BAD ? {} : v;
    }
    return typedRecord(rn, obj);
  });
};

const main = () => {
  const { input, groupBy, format } = parseArgs(process.argv.slice(2));
  let buf;
  try {
    buf = readFileSync(input);
  } catch (e) {
    fatal(`cannot read ${input}: ${e.message}`);
  }
  const records = { csv: readCsv, json: readJson, jsonl: readJsonl, yaml: readYaml, xlsx: readXlsx }[format](buf);

  const seen = new Set();
  const totals = new Map();
  const errs = [];
  for (const rec of records) {
    const get = rec.get;
    const reason = (() => {
      if (rec.pre) return rec.pre;
      for (const c of ["order_id", "customer_id", "sku"]) if (get(c) === "") return `empty ${c}`;
      if (!validDate(get("order_date"))) return "invalid order_date";
      if (!/^\d+$/.test(get("quantity")) || /^0+$/.test(get("quantity"))) return "invalid quantity";
      const price = cents(get("unit_price"));
      if (price === null) return "invalid unit_price";
      let pct = 0n;
      const disc = get("discount") ?? "";
      if (disc !== "") {
        const m = /^(\d)(?:\.(\d{1,2}))?$/.exec(disc);
        if (!m) return "invalid discount";
        pct = BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
        if (pct > 100n) return "invalid discount";
      }
      const key = JSON.stringify([get("order_id"), get("sku")]);
      if (seen.has(key)) return "duplicate order_id and sku";
      seen.add(key);
      const rev = (price * BigInt(get("quantity")) * (100n - pct) + 50n) / 100n;
      const k = groupBy === "day" ? get("order_date") : groupBy === "sku" ? get("sku") : get("customer_id");
      totals.set(k, (totals.get(k) ?? 0n) + rev);
      return null;
    })();
    if (reason) errs.push(`${input}:${rec.loc}: ${reason}\n`);
  }
  const fmt = (c) => `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
  let out = `${groupBy}\trevenue\n`;
  let total = 0n;
  for (const k of [...totals.keys()].sort(cmp)) {
    out += `${k}\t${fmt(totals.get(k))}\n`;
    total += totals.get(k);
  }
  out += `TOTAL\t${fmt(total)}\n`;
  process.stderr.write(errs.join(""));
  process.stdout.write(out);
};

main();
