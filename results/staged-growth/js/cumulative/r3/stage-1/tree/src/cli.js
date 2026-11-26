import { readFileSync } from "node:fs";

const fatal = (msg) => {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
};

const parseArgs = (argv) => {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== "--input" && a !== "--group-by") fatal(`unknown argument: ${a}`);
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) fatal(`missing value for ${a}`);
    opts[a] = v;
  }
  if (opts["--input"] === undefined) fatal("missing option --input");
  if (opts["--group-by"] === undefined) fatal("missing option --group-by");
  if (!["day", "sku", "customer"].includes(opts["--group-by"]))
    fatal(`invalid --group-by value: ${opts["--group-by"]}`);
  return { input: opts["--input"], groupBy: opts["--group-by"] };
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
  const { input, groupBy } = parseArgs(process.argv.slice(2));
  let text;
  try {
    text = readFileSync(input, "utf8");
  } catch (e) {
    fatal(`cannot read ${input}: ${e.message}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records = parseCsv(text);
  if (records.length === 0 || (records[0].line !== 1)) fatal("no header line");
  const header = records[0];
  if (header.error) fatal("malformed header");
  const idx = {};
  header.fields.forEach((h, i) => { if (!(h in idx)) idx[h] = i; });
  const required = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];
  for (const c of required) if (!(c in idx)) fatal(`header missing column: ${c}`);

  const seen = new Set();
  const totals = new Map();
  const errs = [];
  for (const rec of records.slice(1)) {
    const reason = (() => {
      if (rec.error) return rec.error;
      const f = rec.fields;
      if (f.length < header.fields.length) return "fewer fields than header";
      const get = (c) => f[idx[c]];
      for (const c of ["order_id", "customer_id", "sku"]) if (get(c) === "") return `empty ${c}`;
      if (!validDate(get("order_date"))) return "invalid order_date";
      if (!/^[0-9]+$/.test(get("quantity")) || BigInt(get("quantity")) < 1n) return "invalid quantity";
      if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(get("unit_price"))) return "invalid unit_price";
      const disc = "discount" in idx ? get("discount") : "";
      let dp = 0n;
      if (disc !== "") {
        if (!/^(0|1)(\.[0-9]{1,2})?$/.test(disc)) return "invalid discount";
        dp = cents(disc);
        if (dp > 100n) return "invalid discount";
      }
      const dk = JSON.stringify([get("order_id"), get("sku")]);
      if (seen.has(dk)) return "duplicate order_id/sku";
      seen.add(dk);
      const num = cents(get("unit_price")) * BigInt(get("quantity")) * (100n - dp);
      const rev = (num + 50n) / 100n;
      const key = groupBy === "day" ? get("order_date") : groupBy === "sku" ? get("sku") : get("customer_id");
      totals.set(key, (totals.get(key) ?? 0n) + rev);
      return null;
    })();
    if (reason) errs.push(`${input}:${rec.line}: ${reason}\n`);
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
