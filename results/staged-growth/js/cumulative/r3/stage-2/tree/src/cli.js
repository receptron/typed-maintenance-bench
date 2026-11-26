import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { parseDocument } from "yaml";

const fatal = (msg) => {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
};

const parseArgs = (argv) => {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== "--input" && a !== "--group-by" && a !== "--format") fatal(`unknown argument: ${a}`);
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) fatal(`missing value for ${a}`);
    opts[a] = v;
  }
  if (opts["--input"] === undefined) fatal("missing option --input");
  if (opts["--group-by"] === undefined) fatal("missing option --group-by");
  if (!["day", "sku", "customer"].includes(opts["--group-by"]))
    fatal(`invalid --group-by value: ${opts["--group-by"]}`);
  const FORMATS = ["csv", "json", "jsonl", "yaml", "xlsx"];
  let format = opts["--format"];
  if (format !== undefined) {
    if (!FORMATS.includes(format)) fatal(`unknown format: ${format}`);
  } else {
    const base = opts["--input"].split(/[\\/]/).pop();
    const dot = base.lastIndexOf(".");
    const ext = dot >= 0 ? base.slice(dot).toLowerCase() : "";
    format = { ".csv": "csv", ".json": "json", ".jsonl": "jsonl", ".ndjson": "jsonl", ".yaml": "yaml", ".yml": "yaml", ".xlsx": "xlsx" }[ext];
    if (!format) fatal(`cannot determine format of ${opts["--input"]}`);
  }
  return { input: opts["--input"], groupBy: opts["--group-by"], format };
};

const isWs = (c) => c === " " || c === "\t";
const trim = (s) => {
  let a = 0, b = s.length;
  while (a < b && isWs(s[a])) a++;
  while (b > a && isWs(s[b - 1])) b--;
  return s.slice(a, b);
};

// Returns records: {line, fields|null, error?}. Completely empty lines are skipped.
const parseCsv = (text) => {
  const records = [];
  let pos = 0, line = 1;
  const n = text.length;
  while (pos < n) {
    const startLine = line;
    if (text[pos] === "\n") { pos++; line++; continue; }
    if (text[pos] === "\r" && text[pos + 1] === "\n") { pos += 2; line++; continue; }
    const fields = [];
    let error = null;
    for (;;) {
      let p = pos;
      while (p < n && isWs(text[p])) p++;
      if (text[p] === '"') {
        p++;
        let val = "", closed = false;
        while (p < n) {
          const c = text[p];
          if (c === '"') {
            if (text[p + 1] === '"') { val += '"'; p += 2; continue; }
            p++; closed = true; break;
          }
          if (c === "\n") line++;
          val += c; p++;
        }
        if (!closed) { error = "unterminated quoted field"; pos = n; break; }
        while (p < n && isWs(text[p])) p++;
        fields.push(trim(val));
        if (p < n && text[p] !== "," && text[p] !== "\n" && !(text[p] === "\r" && text[p + 1] === "\n")) {
          error = "unexpected characters after closing quote";
          // skip to end of record
          while (p < n && text[p] !== "\n") p++;
        }
        pos = p;
      } else {
        let q = pos;
        while (q < n && text[q] !== "," && text[q] !== "\n" && !(text[q] === "\r" && text[q + 1] === "\n")) q++;
        fields.push(trim(text.slice(pos, q)));
        pos = q;
      }
      if (error) {
        // consume the line terminator
        if (text[pos] === "\n") { pos++; line++; }
        break;
      }
      if (pos >= n) break;
      if (text[pos] === ",") { pos++; if (pos >= n) { fields.push(""); break; } continue; }
      if (text[pos] === "\r") pos++;
      pos++; line++;
      break;
    }
    records.push({ line: startLine, fields, error });
  }
  return records;
};

const FIELDS = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price", "discount", "notes"];
const REQUIRED = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];

class YDate { constructor(s) { this.s = s; } }

const numText = (n) => {
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  const ei = s.indexOf("e");
  if (ei < 0) return s;
  const exp = Number(s.slice(ei + 1));
  let m = s.slice(0, ei);
  const neg = m[0] === "-";
  if (neg) m = m.slice(1);
  const dot = m.indexOf(".");
  const digits = m.replace(".", "");
  const point = (dot < 0 ? m.length : dot) + exp;
  let r;
  if (point <= 0) r = "0." + "0".repeat(-point) + digits;
  else if (point >= digits.length) r = digits + "0".repeat(point - digits.length);
  else r = digits.slice(0, point) + "." + digits.slice(point);
  return (neg ? "-" : "") + r;
};

// Converts a typed value to trimmed text; null means invalid.
const typedText = (v) => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return trim(v);
  if (typeof v === "number") return numText(v);
  if (v instanceof YDate) return v.s;
  return null;
};

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof YDate) && !(v instanceof Map);

const fromObject = (loc, o) => {
  if (!isObj(o)) return { loc, error: "record is not an object" };
  const vals = {};
  for (const f of FIELDS) vals[f] = Object.hasOwn(o, f) ? typedText(o[f]) : "";
  return { loc, vals };
};

const decodeUtf8 = (buf) => {
  try {
    let t = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf);
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    return t;
  } catch {
    return fatal("input is not valid UTF-8");
  }
};

const readCsv = (buf) => {
  const records = parseCsv(decodeUtf8(buf));
  if (records.length === 0 || records[0].line !== 1) fatal("no header line");
  const header = records[0];
  if (header.error) fatal("malformed header");
  const idx = {};
  header.fields.forEach((h, i) => { if (!(h in idx)) idx[h] = i; });
  for (const c of REQUIRED) if (!(c in idx)) fatal(`header missing column: ${c}`);
  return records.slice(1).map((rec) => {
    const loc = String(rec.line);
    if (rec.error) return { loc, error: rec.error };
    if (rec.fields.length < header.fields.length) return { loc, error: "fewer fields than header" };
    const vals = {};
    for (const f of FIELDS) vals[f] = f in idx ? rec.fields[idx[f]] : "";
    return { loc, vals };
  });
};

const readJson = (buf) => {
  let data;
  try { data = JSON.parse(decodeUtf8(buf)); } catch { fatal("invalid JSON"); }
  if (!Array.isArray(data)) fatal("top-level JSON value is not an array");
  return data.map((o, i) => fromObject(`#${i + 1}`, o));
};

const readJsonl = (buf) => {
  const out = [];
  decodeUtf8(buf).split("\n").forEach((ln, i) => {
    if (ln === "" || ln === "\r") return;
    const loc = String(i + 1);
    let o;
    try { o = JSON.parse(ln); } catch { out.push({ loc, error: "invalid JSON" }); return; }
    out.push(fromObject(loc, o));
  });
  return out;
};

const dateTag = {
  tag: "tag:yaml.org,2002:timestamp",
  identify: (v) => v instanceof YDate,
  default: true,
  test: /^\d{4}-\d{2}-\d{2}$/,
  resolve: (s) => new YDate(s),
  stringify: (item) => item.value.s,
};

const readYaml = (buf) => {
  let data;
  try {
    const doc = parseDocument(decodeUtf8(buf), { customTags: [dateTag], uniqueKeys: true });
    if (doc.errors.length) throw doc.errors[0];
    data = doc.toJS({ mapAsMap: false, maxAliasCount: 1000 });
  } catch { fatal("invalid YAML"); }
  if (!Array.isArray(data)) fatal("top-level YAML value is not a sequence");
  return data.map((o, i) => fromObject(`#${i + 1}`, o));
};

const xmlDecode = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return ""; }
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e];
  }).replace(/_x([0-9a-fA-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const attrs = (s) => {
  const o = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[m[1].replace(/^.*:/, "")] = xmlDecode(m[2] ?? m[3]);
  return o;
};

// Concatenated text of all <t> elements, ignoring phonetic runs.
const textOf = (xml) => {
  xml = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
  let r = "";
  for (const m of xml.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) r += xmlDecode(m[1] ?? "");
  return r;
};

const colIndex = (ref) => {
  const m = /^([A-Za-z]+)/.exec(ref ?? "");
  if (!m) return -1;
  let n = 0;
  for (const c of m[1].toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
};

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateFormat = (code) => {
  const c = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "").replace(/_.|\*./g, "");
  return /[ymdhs]/i.test(c) && !/^(general|[#0?.,%e+\-\s]*)$/i.test(c);
};

const serialToDate = (n, date1904) => {
  const days = Math.floor(n);
  let epoch;
  if (date1904) epoch = Date.UTC(1904, 0, 1);
  else if (days < 60) epoch = Date.UTC(1899, 11, 31);
  else if (days === 60) return "1900-02-29";
  else epoch = Date.UTC(1899, 11, 30);
  const d = new Date(epoch + days * 86400000);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 0 || y > 9999) return null;
  return `${String(y).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

const readXlsx = (buf) => {
  let files;
  const get = (name) => {
    const f = files[name];
    return f ? new TextDecoder("utf-8").decode(f) : null;
  };
  try { files = unzipSync(new Uint8Array(buf)); } catch { fatal("cannot open workbook"); }
  const wb = get("xl/workbook.xml");
  if (wb === null) fatal("cannot open workbook");
  const date1904 = /<(?:\w+:)?workbookPr\b[^>]*date1904\s*=\s*["'](1|true)["']/i.test(wb);
  let sheetPath = null;
  const sm = /<(?:\w+:)?sheet\b([^>]*?)\/?>/.exec(wb);
  if (sm) {
    const rid = attrs(sm[1]).id;
    const rels = get("xl/_rels/workbook.xml.rels") ?? "";
    for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
      const a = attrs(m[1]);
      if (a.Id === rid && a.Target) {
        sheetPath = a.Target.startsWith("/") ? a.Target.slice(1) : "xl/" + a.Target;
        break;
      }
    }
  }
  let sheet = sheetPath ? get(sheetPath) : null;
  if (sheet === null) sheet = get("xl/worksheets/sheet1.xml");
  if (sheet === null) fatal("cannot open workbook");

  const shared = [];
  const ss = get("xl/sharedStrings.xml");
  if (ss) for (const m of ss.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) shared.push(textOf(m[1] ?? ""));

  const dateXf = [];
  const styles = get("xl/styles.xml");
  if (styles) {
    const fmts = {};
    for (const m of styles.matchAll(/<(?:\w+:)?numFmt\b([^>]*?)\/?>/g)) {
      const a = attrs(m[1]);
      fmts[a.numFmtId] = a.formatCode ?? "";
    }
    const cx = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(styles);
    if (cx) for (const m of cx[1].matchAll(/<(?:\w+:)?xf\b([^>]*?)\/?>/g)) {
      const id = Number(attrs(m[1]).numFmtId ?? 0);
      dateXf.push(id in fmts ? isDateFormat(fmts[id]) : BUILTIN_DATE_FMTS.has(id));
    }
  }

  // rows: Map rowNumber -> array of cell values
  // cell value: undefined (none) | {t:"s",v} | {t:"n",v,date} | {t:"d",v} | {t:"bad"}
  const rows = [];
  let seq = 0;
  for (const rm of sheet.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const ra = attrs(rm[1]);
    seq = ra.r && /^\d+$/.test(ra.r) ? Number(ra.r) : seq + 1;
    const cells = [];
    let cseq = -1;
    for (const cm of (rm[2] ?? "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ca = attrs(cm[1]);
      const ci = ca.r ? colIndex(ca.r) : cseq + 1;
      cseq = ci < 0 ? cseq + 1 : ci;
      const body = cm[2] ?? "";
      const vm = /<(?:\w+:)?v\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?v>)/.exec(body);
      const v = vm ? xmlDecode(vm[1] ?? "") : null;
      const t = ca.t ?? "n";
      let cell;
      if (t === "inlineStr") {
        const im = /<(?:\w+:)?is\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?is>)/.exec(body);
        const str = im ? textOf(im[1] ?? "") : "";
        cell = str === "" ? undefined : { t: "s", v: str };
      } else if (v === null || (v === "" && t !== "str")) cell = undefined;
      else if (t === "s") {
        const str = shared[Number(v)];
        cell = str === undefined ? { t: "bad" } : str === "" ? undefined : { t: "s", v: str };
      } else if (t === "str") cell = v === "" ? undefined : { t: "s", v };
      else if (t === "b" || t === "e") cell = { t: "bad" };
      else if (t === "d") cell = { t: "d", v: v.trim() };
      else {
        const n = Number(v);
        cell = Number.isFinite(n) && v.trim() !== "" ? { t: "n", v: n, date: !!dateXf[Number(ca.s ?? 0)] } : { t: "bad" };
      }
      if (cseq >= 0) cells[cseq] = cell;
    }
    rows.push({ n: seq, cells });
  }

  const hasValue = (r) => r.cells.some((c) => c !== undefined);
  const hdr = rows.find((r) => r.n === 1);
  if (!hdr || !hasValue(hdr)) fatal("no header row");
  const plain = (c) => (c === undefined ? "" : c.t === "s" ? trim(c.v) : c.t === "n" ? numText(c.v) ?? "" : c.t === "d" ? c.v : "");
  const idx = {};
  for (let i = 0; i < hdr.cells.length; i++) {
    const h = plain(hdr.cells[i]);
    if (hdr.cells[i] !== undefined && !(h in idx)) idx[h] = i;
  }
  for (const c of REQUIRED) if (!(c in idx)) fatal(`header missing column: ${c}`);

  const out = [];
  for (const r of rows) {
    if (r.n <= 1 || !hasValue(r)) continue;
    const vals = {};
    for (const f of FIELDS) {
      const c = f in idx ? r.cells[idx[f]] : undefined;
      if (c === undefined) vals[f] = "";
      else if (c.t === "s") vals[f] = trim(c.v);
      else if (c.t === "d") {
        const m = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(c.v);
        vals[f] = m ? m[1] : c.v;
      } else if (c.t === "n") {
        if (c.date && f === "order_date") vals[f] = serialToDate(c.v, date1904) ?? "";
        else vals[f] = numText(c.v);
      } else vals[f] = null;
    }
    out.push({ loc: String(r.n), vals });
  }
  return out;
};

const READERS = { csv: readCsv, json: readJson, jsonl: readJsonl, yaml: readYaml, xlsx: readXlsx };

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const validDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dim = [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= dim;
};

const cents = (s) => {
  const [i, f = ""] = s.split(".");
  return BigInt(i) * 100n + BigInt(f.padEnd(2, "0"));
};

const cmp = (a, b) => {
  const x = Array.from(a, (c) => c.codePointAt(0));
  const y = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};

const fmt = (c) => `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;

const main = () => {
  const { input, groupBy, format } = parseArgs(process.argv.slice(2));
  let buf;
  try {
    buf = readFileSync(input);
  } catch (e) {
    fatal(`cannot read ${input}: ${e.message}`);
  }
  const records = READERS[format](buf);

  const seen = new Set();
  const totals = new Map();
  const errs = [];
  for (const rec of records) {
    const reason = (() => {
      if (rec.error) return rec.error;
      const get = (c) => rec.vals[c];
      for (const c of ["order_id", "customer_id", "sku"]) if (get(c) === null || get(c) === "") return `empty ${c}`;
      if (get("order_date") === null || !validDate(get("order_date"))) return "invalid order_date";
      if (get("quantity") === null || !/^[0-9]+$/.test(get("quantity")) || BigInt(get("quantity")) < 1n) return "invalid quantity";
      if (get("unit_price") === null || !/^[0-9]+(\.[0-9]{1,2})?$/.test(get("unit_price"))) return "invalid unit_price";
      const disc = get("discount");
      let dp = 0n;
      if (disc === null) return "invalid discount";
      if (disc !== "") {
        if (!/^(0|1)(\.[0-9]{1,2})?$/.test(disc)) return "invalid discount";
        dp = cents(disc);
        if (dp > 100n) return "invalid discount";
      }
      if (get("notes") === null) return "invalid notes";
      const dk = JSON.stringify([get("order_id"), get("sku")]);
      if (seen.has(dk)) return "duplicate order_id/sku";
      seen.add(dk);
      const num = cents(get("unit_price")) * BigInt(get("quantity")) * (100n - dp);
      const rev = (num + 50n) / 100n;
      const key = groupBy === "day" ? get("order_date") : groupBy === "sku" ? get("sku") : get("customer_id");
      totals.set(key, (totals.get(key) ?? 0n) + rev);
      return null;
    })();
    if (reason) errs.push(`${input}:${rec.loc}: ${reason}\n`);
  }
  if (errs.length) process.stderr.write(errs.join(""));
  let out = `${groupBy}\trevenue\n`;
  let total = 0n;
  for (const k of [...totals.keys()].sort(cmp)) {
    out += `${k}\t${fmt(totals.get(k))}\n`;
    total += totals.get(k);
  }
  out += `TOTAL\t${fmt(total)}\n`;
  process.stdout.write(out);
};

main();
