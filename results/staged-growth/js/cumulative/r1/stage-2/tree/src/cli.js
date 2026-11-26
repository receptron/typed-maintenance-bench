import { readFileSync } from "node:fs";
import { BAD, readTyped, toText } from "./formats.js";

const fatal = (msg) => {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
};

const parseArgs = (argv) => {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (k !== "--input" && k !== "--group-by" && k !== "--format") fatal(`unknown option: ${k}`);
    if (i + 1 >= argv.length) fatal(`missing value for ${k}`);
    if (k in opts) fatal(`duplicate option: ${k}`);
    opts[k] = argv[i + 1];
  }
  if (opts["--input"] === undefined || opts["--input"] === "") fatal("missing --input");
  if (!["day", "sku", "customer"].includes(opts["--group-by"])) fatal("missing or invalid --group-by");
  const FORMATS = ["csv", "json", "jsonl", "yaml", "xlsx"];
  let format = opts["--format"];
  if (format === undefined) {
    const name = opts["--input"].toLowerCase();
    const byExt = [[".csv", "csv"], [".json", "json"], [".jsonl", "jsonl"], [".ndjson", "jsonl"], [".yaml", "yaml"], [".yml", "yaml"], [".xlsx", "xlsx"]];
    const hit = byExt.find(([e]) => name.endsWith(e));
    if (!hit) fatal("cannot determine format from extension; use --format");
    format = hit[1];
  } else if (!FORMATS.includes(format)) fatal(`unknown format: ${format}`);
  return { input: opts["--input"], groupBy: opts["--group-by"], format };
};

// Returns records: { line, fields }. Completely empty lines are skipped.
const parseCsv = (text) => {
  const records = [];
  let i = 0;
  const n = text.length;
  let line = 1;
  while (i < n) {
    const startLine = line;
    // completely empty line
    if (text[i] === "\n") { i++; line++; continue; }
    if (text[i] === "\r" && text[i + 1] === "\n") { i += 2; line++; continue; }
    const fields = [];
    let cur = "";
    let inQuotes = false;
    let done = false;
    while (!done) {
      if (i >= n) { fields.push(cur); break; }
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i += 2; }
          else { inQuotes = false; i++; }
        } else {
          if (c === "\n") line++;
          cur += c; i++;
        }
      } else if (c === '"' && cur.trim() === "" ) {
        // opening quote at field start (ignoring leading spaces/tabs)
        cur = ""; inQuotes = true; i++;
      } else if (c === ",") {
        fields.push(cur); cur = ""; i++;
      } else if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
        fields.push(cur);
        i += c === "\n" ? 1 : 2;
        line++;
        done = true;
      } else { cur += c; i++; }
    }
    records.push({ line: startLine, fields: fields.map((f) => f.replace(/^[ \t]+|[ \t]+$/g, "")) });
  }
  return records;
};

const isRealDate = (s) => {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= dim;
};

const toCents = (s) => {
  const m = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
};

const cmp = (a, b) => {
  const x = Array.from(a, (c) => c.codePointAt(0));
  const y = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};

const fmt = (c) => `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;

const REQUIRED = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];

// Returns { records: [{ loc, invalid?, get(name) }] } where get returns a string or BAD.
const load = (input, format) => {
  let buf;
  try { buf = readFileSync(input); } catch (e) { fatal(`cannot read ${input}: ${e.message}`); }
  if (format === "csv") {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buf); } catch { fatal("input is not valid UTF-8"); }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const records = parseCsv(text);
    if (records.length === 0) fatal("no header line");
    const header = records.shift().fields;
    const idx = {};
    for (const name of [...REQUIRED, "discount"]) {
      const p = header.indexOf(name);
      if (p >= 0) idx[name] = p;
    }
    for (const r of REQUIRED) if (!(r in idx)) fatal(`header missing column: ${r}`);
    return records.map(({ line, fields }) => ({
      loc: String(line),
      short: fields.length < header.length,
      get: (name) => (name in idx ? fields[idx[name]] : ""),
    }));
  }
  let res;
  try { res = readTyped(format, buf); } catch (e) { fatal(`cannot parse ${format}: ${e.message}`); }
  if (res.header) for (const r of REQUIRED) if (!res.header.has(r)) fatal(`header missing column: ${r}`);
  return res.records.map((r) => ({
    loc: r.loc,
    invalid: r.invalid,
    get: r.get && ((name) => toText(r.get(name), name === "order_date")),
  }));
};

const main = () => {
  const { input, groupBy, format } = parseArgs(process.argv.slice(2));
  const records = load(input, format);
  const seen = new Set();
  const sums = new Map();
  let total = 0n;
  const out = [];
  for (const rec of records) {
    const bad = (reason) => process.stderr.write(`${input}:${rec.loc}: ${reason}\n`);
    if (rec.short) { bad("too few fields"); continue; }
    if (rec.invalid) { bad("invalid record"); continue; }
    let badField = null;
    const g = (name) => {
      const v = rec.get(name);
      if (v === BAD && badField === null) badField = name;
      return v === BAD ? "" : v;
    };
    const orderId = g("order_id"), cust = g("customer_id"), date = g("order_date"), sku = g("sku");
    const qty = g("quantity"), priceS = g("unit_price"), discS = g("discount");
    if (badField !== null) { bad(`invalid ${badField}`); continue; }
    if (orderId === "") { bad("empty order_id"); continue; }
    if (cust === "") { bad("empty customer_id"); continue; }
    if (!isRealDate(date)) { bad("invalid order_date"); continue; }
    if (sku === "") { bad("empty sku"); continue; }
    if (!/^[0-9]+$/.test(qty) || BigInt(qty) < 1n) { bad("invalid quantity"); continue; }
    const price = toCents(priceS);
    if (price === null) { bad("invalid unit_price"); continue; }
    let disc = 0n;
    if (discS !== "") {
      const d = toCents(discS);
      if (d === null || d > 100n) { bad("invalid discount"); continue; }
      disc = d;
    }
    const key = JSON.stringify([orderId, sku]);
    if (seen.has(key)) { bad("duplicate (order_id, sku)"); continue; }
    seen.add(key);
    const rev = (price * BigInt(qty) * (100n - disc) + 50n) / 100n;
    const k = groupBy === "day" ? date : groupBy === "sku" ? sku : cust;
    sums.set(k, (sums.get(k) ?? 0n) + rev);
    total += rev;
  }
  out.push(`${groupBy}\trevenue`);
  for (const k of [...sums.keys()].sort(cmp)) out.push(`${k}\t${fmt(sums.get(k))}`);
  out.push(`TOTAL\t${fmt(total)}`);
  process.stdout.write(out.join("\n") + "\n");
};

main();
