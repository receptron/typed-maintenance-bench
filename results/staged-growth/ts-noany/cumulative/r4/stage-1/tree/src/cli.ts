import { readFileSync } from "node:fs";

type Rec = { line: number; fields: string[]; error?: string };

const isBlank = (c: string): boolean => c === " " || c === "\t";

const trim = (s: string): string => {
  let a = 0;
  let b = s.length;
  while (a < b && isBlank(s.charAt(a))) a++;
  while (b > a && isBlank(s.charAt(b - 1))) b--;
  return s.slice(a, b);
};

const parseCsv = (text: string): Rec[] => {
  const out: Rec[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const startLine = line;
    const fields: string[] = [];
    let error: string | undefined;
    let empty = true;
    for (;;) {
      // parse one field
      let j = i;
      while (j < n && isBlank(text.charAt(j))) j++;
      let value = "";
      if (text.charAt(j) === '"') {
        empty = false;
        j++;
        let closed = false;
        while (j < n) {
          const c = text.charAt(j);
          if (c === '"') {
            if (text.charAt(j + 1) === '"') {
              value += '"';
              j += 2;
              continue;
            }
            closed = true;
            j++;
            break;
          }
          if (c === "\n") line++;
          value += c;
          j++;
        }
        if (!closed) error = "unterminated quoted field";
        // trailing characters up to delimiter
        let extra = "";
        while (j < n && text.charAt(j) !== "," && text.charAt(j) !== "\n") {
          extra += text.charAt(j);
          j++;
        }
        if (extra.endsWith("\r") && (j >= n || text.charAt(j) === "\n")) extra = extra.slice(0, -1);
        if (trim(extra) !== "") error = error ?? "unexpected characters after closing quote";
      } else {
        let k = i;
        while (k < n && text.charAt(k) !== "," && text.charAt(k) !== "\n") k++;
        let raw = text.slice(i, k);
        if (k >= n || text.charAt(k) === "\n") {
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        }
        if (raw !== "") empty = false;
        value = raw;
        j = k;
      }
      fields.push(trim(value));
      i = j;
      if (i < n && text.charAt(i) === ",") {
        empty = false;
        i++;
        continue;
      }
      if (i < n && text.charAt(i) === "\n") {
        i++;
        line++;
      }
      break;
    }
    if (empty && fields.length === 1 && error === undefined) continue;
    out.push(error === undefined ? { line: startLine, fields } : { line: startLine, fields, error });
  }
  return out;
};

const fail = (msg: string): never => {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
};

const parseArgs = (argv: string[]): { input: string; groupBy: string } => {
  let input: string | undefined;
  let groupBy: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const opt = argv[i];
    const val = argv[i + 1];
    if (opt !== "--input" && opt !== "--group-by") return fail(`unknown option: ${opt ?? ""}`);
    if (val === undefined) return fail(`missing value for ${opt}`);
    if (opt === "--input") {
      if (input !== undefined) return fail("duplicate --input");
      input = val;
    } else {
      if (groupBy !== undefined) return fail("duplicate --group-by");
      groupBy = val;
    }
  }
  if (input === undefined) return fail("missing --input");
  if (groupBy === undefined) return fail("missing --group-by");
  if (groupBy !== "day" && groupBy !== "sku" && groupBy !== "customer") return fail(`invalid --group-by: ${groupBy}`);
  return { input, groupBy };
};

const validDate = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= (days[mo - 1] ?? 0);
};

// parses decimal with <=2 fraction digits into hundredths
const parseHundredths = (s: string): bigint | undefined => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return undefined;
  return BigInt(m[1] ?? "0") * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
};

const fmt = (c: bigint): string => {
  const whole = c / 100n;
  const frac = (c % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}`;
};

const cmp = (a: string, b: string): number => {
  const x = Array.from(a);
  const y = Array.from(b);
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const p = (x[i] ?? "").codePointAt(0) ?? 0;
    const q = (y[i] ?? "").codePointAt(0) ?? 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length - y.length;
};

const main = (): void => {
  const { input, groupBy } = parseArgs(process.argv.slice(2));
  let text: string;
  try {
    text = readFileSync(input).toString("utf8");
  } catch (e) {
    return fail(`cannot read ${input}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const recs = parseCsv(text);
  const header = recs[0];
  if (!header) return fail("no header line");
  const col = new Map<string, number>();
  header.fields.forEach((name, idx) => {
    if (!col.has(name)) col.set(name, idx);
  });
  const required = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];
  for (const r of required) if (!col.has(r)) return fail(`header missing column: ${r}`);
  const get = (f: string[], name: string): string => {
    const idx = col.get(name);
    return idx === undefined ? "" : (f[idx] ?? "");
  };

  const seen = new Set<string>();
  const totals = new Map<string, bigint>();
  let total = 0n;
  const keyCol = groupBy === "day" ? "order_date" : groupBy === "sku" ? "sku" : "customer_id";

  for (const rec of recs.slice(1)) {
    const reject = (reason: string): void => {
      process.stderr.write(`${input}:${rec.line}: ${reason}\n`);
    };
    if (rec.error !== undefined) {
      reject(rec.error);
      continue;
    }
    const f = rec.fields;
    if (f.length < header.fields.length) {
      reject("too few fields");
      continue;
    }
    const orderId = get(f, "order_id");
    const sku = get(f, "sku");
    if (orderId === "") { reject("empty order_id"); continue; }
    if (get(f, "customer_id") === "") { reject("empty customer_id"); continue; }
    if (!validDate(get(f, "order_date"))) { reject("invalid order_date"); continue; }
    if (sku === "") { reject("empty sku"); continue; }
    const qs = get(f, "quantity");
    if (!/^\d+$/.test(qs) || BigInt(qs) < 1n) { reject("invalid quantity"); continue; }
    const price = parseHundredths(get(f, "unit_price"));
    if (price === undefined) { reject("invalid unit_price"); continue; }
    const ds = get(f, "discount");
    let pct = 0n;
    if (ds !== "") {
      const d = parseHundredths(ds);
      if (d === undefined || d > 100n) { reject("invalid discount"); continue; }
      pct = d;
    }
    const dupKey = JSON.stringify([orderId, sku]);
    if (seen.has(dupKey)) { reject("duplicate (order_id, sku)"); continue; }
    seen.add(dupKey);
    const rev = (price * BigInt(qs) * (100n - pct) + 50n) / 100n;
    const key = get(f, keyCol);
    totals.set(key, (totals.get(key) ?? 0n) + rev);
    total += rev;
  }

  const lines = [`${groupBy}\trevenue`];
  for (const k of [...totals.keys()].sort(cmp)) lines.push(`${k}\t${fmt(totals.get(k) ?? 0n)}`);
  lines.push(`TOTAL\t${fmt(total)}`);
  process.stdout.write(`${lines.join("\n")}\n`);
};

main();
