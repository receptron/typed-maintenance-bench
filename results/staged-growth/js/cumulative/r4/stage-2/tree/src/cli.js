import { readFileSync } from "node:fs";
import { BAD, DateVal, FormatError, readJson, readJsonl, readYaml, readXlsx } from "./typed.js";

const fatal = (msg) => {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
};

const FORMATS = new Set(["csv", "json", "jsonl", "yaml", "xlsx"]);
const EXT = { csv: "csv", json: "json", jsonl: "jsonl", ndjson: "jsonl", yaml: "yaml", yml: "yaml", xlsx: "xlsx" };
const GROUPS = new Set(["day", "sku", "customer"]);

const parseArgs = (argv) => {
  const opts = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    if (name !== "--input" && name !== "--group-by" && name !== "--format") fatal(`unknown option: ${name}`);
    if (i + 1 >= argv.length) fatal(`missing value for ${name}`);
    opts.set(name, argv[i + 1]);
  }
  if (!opts.has("--input")) fatal("missing option --input");
  if (!opts.has("--group-by")) fatal("missing option --group-by");
  const input = opts.get("--input");
  const groupBy = opts.get("--group-by");
  if (input === "") fatal("empty value for --input");
  if (!GROUPS.has(groupBy)) fatal(`unknown --group-by value: ${groupBy}`);
  let format;
  if (opts.has("--format")) {
    format = opts.get("--format");
    if (!FORMATS.has(format)) fatal(`unknown --format value: ${format}`);
  } else {
    const m = /\.([^./\\]*)$/.exec(input);
    format = m ? EXT[m[1].toLowerCase()] : undefined;
    if (!format) fatal(`cannot determine format of ${input}`);
  }
  return { input, groupBy, format };
};

// RFC 4180 parser; returns [{line, fields, blank}]
const parseCsv = (text) => {
  const records = [];
  let i = 0;
  let line = 1;
  const n = text.length;
  while (i < n) {
    const startLine = line;
    const startIdx = i;
    const fields = [];
    for (;;) {
      let value = "";
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= n) break;
          const c = text[i];
          if (c === '"') {
            if (text[i + 1] === '"') { value += '"'; i += 2; continue; }
            i++;
            break;
          }
          if (c === "\n") line++;
          value += c;
          i++;
        }
        // stray text after closing quote: keep literally
        while (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) {
          value += text[i++];
        }
      } else {
        while (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) {
          value += text[i++];
        }
      }
      fields.push(value.replace(/^[ \t]+|[ \t]+$/g, ""));
      if (text[i] === ",") { i++; continue; }
      break;
    }
    const blank = i === startIdx || (fields.length === 1 && text.slice(startIdx, i) === "");
    // consume line terminator
    if (text[i] === "\r") i += 2;
    else if (text[i] === "\n") i++;
    line++;
    records.push({ line: startLine, fields, blank });
  }
  return records;
};

const DIGITS = /^[0-9]+$/;
const DECIMAL = /^([0-9]+)(?:\.([0-9]{1,2}))?$/;

const toCents = (s) => {
  const m = DECIMAL.exec(s);
  if (!m) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
};

const validDate = (s) => {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= dim;
};

const cmp = (a, b) => {
  const x = Array.from(a, (c) => c.codePointAt(0));
  const y = Array.from(b, (c) => c.codePointAt(0));
  const l = Math.min(x.length, y.length);
  for (let i = 0; i < l; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};

const fmt = (cents) => `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;

const COLS = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price", "discount", "notes"];
const trimWs = (s) => s.replace(/^[ \t]+|[ \t]+$/g, "");

// typed value -> trimmed string, "" when empty, BAD when unusable
const toStr = (v, allowDate) => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return trimWs(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : BAD;
  if (typeof v === "bigint") return String(v);
  if (v instanceof DateVal) return allowDate ? v.s : BAD;
  return BAD;
};

const decode = (buf) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    fatal("input is not valid UTF-8");
  }
};

// returns [{loc, fields: {col: string|BAD} | null, reason?}]
const loadRecords = (format, buf) => {
  if (format === "csv") {
    const records = parseCsv(decode(buf));
    const hi = records.findIndex((r) => !r.blank);
    if (hi < 0) fatal("no header line");
    const header = records[hi].fields;
    const idx = {};
    for (const col of COLS.slice(0, 6)) {
      const k = header.indexOf(col);
      if (k < 0) fatal(`header missing required column: ${col}`);
      idx[col] = k;
    }
    idx.discount = header.indexOf("discount");
    return records.slice(hi + 1).filter((r) => !r.blank).map((rec) => {
      const f = rec.fields;
      if (f.length < header.length) return { loc: String(rec.line), fields: null, reason: "too few fields" };
      const fields = {};
      for (const c of COLS.slice(0, 7)) fields[c] = idx[c] >= 0 ? f[idx[c]] : "";
      return { loc: String(rec.line), fields };
    });
  }
  let raw;
  try {
    if (format === "json") raw = readJson(decode(buf));
    else if (format === "jsonl") raw = readJsonl(decode(buf));
    else if (format === "yaml") raw = readYaml(decode(buf));
    else {
      const rows = readXlsx(buf);
      const header = new Map();
      for (const [c, v] of rows[0].cells) {
        const s = toStr(v, false);
        if (typeof s === "string" && s !== "" && !header.has(s)) header.set(s, c);
      }
      for (const col of COLS.slice(0, 6)) if (!header.has(col)) fatal(`header missing required column: ${col}`);
      raw = rows.slice(1).map((r) => {
        const obj = {};
        for (const c of COLS) if (header.has(c) && r.cells.has(header.get(c))) obj[c] = r.cells.get(header.get(c));
        return { loc: String(r.row), obj };
      });
    }
  } catch (e) {
    if (e instanceof FormatError) fatal(e.message);
    throw e;
  }
  return raw.map(({ loc, obj }) => {
    if (!obj) return { loc, fields: null, reason: "invalid record" };
    const fields = {};
    for (const c of COLS) fields[c] = toStr(Object.hasOwn(obj, c) ? obj[c] : undefined, c === "order_date");
    return { loc, fields };
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
  const records = loadRecords(format, buf);
  const typed = format !== "csv";
  const locOf = (loc) => loc;

  const totals = new Map();
  const seen = new Set();
  const errors = [];
  let total = 0n;

  for (const rec of records) {
    const bad = (reason) => errors.push(`${input}:${locOf(rec.loc)}: ${reason}`);
    if (!rec.fields) { bad(rec.reason); continue; }
    const f = rec.fields;
    const orderId = f.order_id, cust = f.customer_id, date = f.order_date;
    const sku = f.sku, qtyS = f.quantity, priceS = f.unit_price, discS = f.discount;
    const chk = (col) => f[col] === BAD && (bad(`invalid ${col}`), true);
    if (chk("order_id")) continue;
    if (orderId === "") { bad("empty order_id"); continue; }
    if (chk("customer_id")) continue;
    if (cust === "") { bad("empty customer_id"); continue; }
    if (chk("order_date")) continue;
    if (!validDate(date)) { bad("invalid order_date"); continue; }
    if (chk("sku")) continue;
    if (sku === "") { bad("empty sku"); continue; }
    if (chk("quantity")) continue;
    if (!DIGITS.test(qtyS) || BigInt(qtyS) < 1n) { bad("invalid quantity"); continue; }
    if (chk("unit_price")) continue;
    const price = toCents(priceS);
    if (price === null) { bad("invalid unit_price"); continue; }
    if (chk("discount")) continue;
    let pct = 0n;
    if (discS !== "") {
      const d = toCents(discS);
      if (d === null || d > 100n) { bad("invalid discount"); continue; }
      pct = d;
    }
    if (typed && chk("notes")) continue;
    const key = JSON.stringify([orderId, sku]);
    if (seen.has(key)) { bad("duplicate (order_id, sku)"); continue; }
    seen.add(key);
    const num = price * BigInt(qtyS) * (100n - pct);
    const rev = (2n * num + 100n) / 200n;
    const k = groupBy === "day" ? date : groupBy === "sku" ? sku : cust;
    totals.set(k, (totals.get(k) ?? 0n) + rev);
    total += rev;
  }

  if (errors.length) process.stderr.write(errors.join("\n") + "\n");
  const keys = [...totals.keys()].sort(cmp);
  let out = `${groupBy}\trevenue\n`;
  for (const k of keys) out += `${k}\t${fmt(totals.get(k))}\n`;
  out += `TOTAL\t${fmt(total)}\n`;
  process.stdout.write(out);
};

main();
