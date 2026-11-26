import { readFileSync } from "node:fs";

class Fatal extends Error {}

function parseArgs(argv: string[]): { input: string; groupBy: "day" | "sku" | "customer" } {
  let input: string | undefined;
  let groupBy: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const opt = argv[i];
    if (opt !== "--input" && opt !== "--group-by") throw new Fatal(`unknown option: ${opt}`);
    const val = argv[i + 1];
    if (val === undefined) throw new Fatal(`missing value for ${opt}`);
    if (opt === "--input") input = val;
    else groupBy = val;
  }
  if (input === undefined) throw new Fatal("missing option --input");
  if (groupBy === undefined) throw new Fatal("missing option --group-by");
  if (groupBy !== "day" && groupBy !== "sku" && groupBy !== "customer")
    throw new Fatal(`invalid --group-by value: ${groupBy}`);
  return { input, groupBy };
}

interface Rec {
  line: number;
  fields: string[];
  error?: string;
}

const isWs = (c: string | undefined) => c === " " || c === "\t";

function parseCsv(text: string): Rec[] {
  const recs: Rec[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const startLine = line;
    // completely empty line
    if (text[i] === "\n") { i++; line++; continue; }
    if (text[i] === "\r" && text[i + 1] === "\n") { i += 2; line++; continue; }
    const fields: string[] = [];
    let error: string | undefined;
    let done = false;
    while (!done) {
      let j = i;
      while (isWs(text[j])) j++;
      if (text[j] === '"') {
        j++;
        let val = "";
        let closed = false;
        while (j < n) {
          const c = text[j]!;
          if (c === '"') {
            if (text[j + 1] === '"') { val += '"'; j += 2; continue; }
            j++; closed = true; break;
          }
          if (c === "\n") line++;
          val += c;
          j++;
        }
        if (!closed) {
          error = "unterminated quoted field";
          fields.push(val);
          i = n;
          done = true;
          break;
        }
        while (isWs(text[j])) j++;
        const c = text[j];
        if (j < n && c !== "," && c !== "\n" && !(c === "\r" && text[j + 1] === "\n")) {
          error ??= "unexpected characters after closing quote";
          // skip to end of record
          while (j < n && text[j] !== "\n" && !(text[j] === "\r" && text[j + 1] === "\n")) j++;
        }
        fields.push(val.replace(/^[ \t]+|[ \t]+$/g, ""));
        i = j;
      } else {
        let k = i;
        while (k < n && text[k] !== "," && text[k] !== "\n" && !(text[k] === "\r" && text[k + 1] === "\n")) k++;
        fields.push(text.slice(i, k).replace(/^[ \t]+|[ \t]+$/g, ""));
        i = k;
      }
      if (i >= n) { done = true; }
      else if (text[i] === ",") { i++; if (i >= n) { fields.push(""); done = true; } }
      else {
        i += text[i] === "\r" ? 2 : 1;
        line++;
        done = true;
      }
    }
    recs.push(error !== undefined ? { line: startLine, fields, error } : { line: startLine, fields });
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

// parse decimal with <=2 decimals into hundredths
function hundredths(s: string): bigint | undefined {
  const m = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(s);
  if (!m) return undefined;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}

function cmp(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0)!);
  const y = Array.from(b, (c) => c.codePointAt(0)!);
  const l = Math.min(x.length, y.length);
  for (let i = 0; i < l; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return x.length - y.length;
}

function fmt(c: bigint): string {
  const s = c.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

function main(): { out: string; err: string } {
  const { input, groupBy } = parseArgs(process.argv.slice(2));
  let text: string;
  try {
    text = readFileSync(input, "utf8");
  } catch (e) {
    throw new Fatal(`cannot read ${input}: ${(e as Error).message}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.length === 0) throw new Fatal("no header line");
  const recs = parseCsv(text);
  if (recs.length === 0) throw new Fatal("no header line");
  const header = recs[0]!.fields;
  const col: Record<string, number> = {};
  for (const name of ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price", "discount"]) {
    const idx = header.indexOf(name);
    if (idx >= 0) col[name] = idx;
    else if (name !== "discount") throw new Fatal(`header missing required column: ${name}`);
  }
  const seen = new Set<string>();
  const totals = new Map<string, bigint>();
  let err = "";
  for (const r of recs.slice(1)) {
    const reason = (): string | undefined => {
      if (r.error) return r.error;
      if (r.fields.length < header.length) return "too few fields";
      const f = (k: string) => (col[k] === undefined ? "" : r.fields[col[k]!]!);
      for (const k of ["order_id", "customer_id", "sku"])
        if (f(k) === "") return `empty ${k}`;
      if (!validDate(f("order_date"))) return "invalid order_date";
      if (!/^[0-9]+$/.test(f("quantity")) || BigInt(f("quantity")) < 1n) return "invalid quantity";
      const price = hundredths(f("unit_price"));
      if (price === undefined) return "invalid unit_price";
      let disc = 0n;
      if (f("discount") !== "") {
        const d = hundredths(f("discount"));
        if (d === undefined || d > 100n) return "invalid discount";
        disc = d;
      }
      if (seen.has(JSON.stringify([f("order_id"), f("sku")]))) return "duplicate order_id and sku";
      seen.add(JSON.stringify([f("order_id"), f("sku")]));
      const num = price * BigInt(f("quantity")) * (100n - disc);
      const rev = (num * 2n + 100n) / 200n;
      const key = groupBy === "day" ? f("order_date") : groupBy === "sku" ? f("sku") : f("customer_id");
      totals.set(key, (totals.get(key) ?? 0n) + rev);
      return undefined;
    };
    const why = reason();
    if (why !== undefined) err += `${input}:${r.line}: ${why}\n`;
  }
  let out = `${groupBy}\trevenue\n`;
  let sum = 0n;
  for (const k of [...totals.keys()].sort(cmp)) {
    const v = totals.get(k)!;
    sum += v;
    out += `${k}\t${fmt(v)}\n`;
  }
  out += `TOTAL\t${fmt(sum)}\n`;
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
