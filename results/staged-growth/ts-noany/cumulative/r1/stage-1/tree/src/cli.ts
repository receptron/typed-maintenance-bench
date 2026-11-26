import { readFileSync } from "node:fs";

class Fatal extends Error {}

type Rec = { line: number; fields: string[] };

function parseCsv(text: string): Rec[] {
  const recs: Rec[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    // completely empty line
    if (text[i] === "\n") {
      i++;
      line++;
      continue;
    }
    if (text[i] === "\r" && text[i + 1] === "\n") {
      i += 2;
      line++;
      continue;
    }
    const startLine = line;
    const fields: string[] = [];
    let cur = "";
    let inQuotes = false;
    let fieldStart = true;
    for (;;) {
      if (i >= n) {
        fields.push(cur);
        break;
      }
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cur += '"';
            i += 2;
          } else {
            inQuotes = false;
            i++;
          }
        } else {
          if (c === "\n") line++;
          cur += c;
          i++;
        }
        continue;
      }
      if (c === '"' && fieldStart) {
        inQuotes = true;
        fieldStart = false;
        i++;
      } else if (c === ",") {
        fields.push(cur);
        cur = "";
        fieldStart = true;
        i++;
      } else if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
        fields.push(cur);
        i += c === "\n" ? 1 : 2;
        line++;
        break;
      } else {
        cur += c;
        fieldStart = false;
        i++;
      }
    }
    recs.push({ line: startLine, fields: fields.map((f) => f.replace(/^[ \t]+|[ \t]+$/g, "")) });
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
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= (dim[mo - 1] ?? 0);
}

function toCents(s: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1] ?? "0") * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

function fmt(c: bigint): string {
  const s = c.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

const REQUIRED = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];

function parseArgs(argv: string[]): { input: string; groupBy: string } {
  let input: string | undefined;
  let groupBy: string | undefined;
  for (let k = 0; k < argv.length; k += 2) {
    const opt = argv[k];
    const val = argv[k + 1];
    if (opt !== "--input" && opt !== "--group-by") throw new Fatal(`unknown option: ${opt}`);
    if (val === undefined) throw new Fatal(`missing value for ${opt}`);
    if (opt === "--input") {
      if (input !== undefined) throw new Fatal("duplicate --input");
      input = val;
    } else {
      if (groupBy !== undefined) throw new Fatal("duplicate --group-by");
      groupBy = val;
    }
  }
  if (input === undefined) throw new Fatal("missing option --input");
  if (groupBy === undefined) throw new Fatal("missing option --group-by");
  if (groupBy !== "day" && groupBy !== "sku" && groupBy !== "customer") {
    throw new Fatal(`invalid --group-by value: ${groupBy}`);
  }
  return { input, groupBy };
}

function run(): { out: string; err: string[] } {
  const { input, groupBy } = parseArgs(process.argv.slice(2));
  let text: string;
  try {
    text = readFileSync(input, "utf8");
  } catch (e) {
    throw new Fatal(`cannot read ${input}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const recs = parseCsv(text);
  const header = recs[0];
  if (!header || header.line !== 1) throw new Fatal("no header line");
  const idx = new Map<string, number>();
  header.fields.forEach((name, k) => {
    if (!idx.has(name)) idx.set(name, k);
  });
  for (const r of REQUIRED) if (!idx.has(r)) throw new Fatal(`header missing column: ${r}`);
  const col = (r: Rec, name: string): string => {
    const k = idx.get(name);
    return k === undefined ? "" : (r.fields[k] ?? "");
  };

  const err: string[] = [];
  const seen = new Set<string>();
  const sums = new Map<string, bigint>();
  let total = 0n;

  for (const r of recs.slice(1)) {
    const bad = (reason: string): void => {
      err.push(`${input}:${r.line}: ${reason}`);
    };
    if (r.fields.length < header.fields.length) {
      bad("too few fields");
      continue;
    }
    const orderId = col(r, "order_id");
    const customer = col(r, "customer_id");
    const date = col(r, "order_date");
    const sku = col(r, "sku");
    const qty = col(r, "quantity");
    const price = col(r, "unit_price");
    const disc = idx.has("discount") ? col(r, "discount") : "";
    if (orderId === "") { bad("empty order_id"); continue; }
    if (customer === "") { bad("empty customer_id"); continue; }
    if (!validDate(date)) { bad("invalid order_date"); continue; }
    if (sku === "") { bad("empty sku"); continue; }
    if (!/^\d+$/.test(qty) || BigInt(qty) < 1n) { bad("invalid quantity"); continue; }
    const priceCents = toCents(price);
    if (priceCents === null) { bad("invalid unit_price"); continue; }
    let pct = 0n;
    if (disc !== "") {
      const d = toCents(disc);
      if (d === null || d > 100n) { bad("invalid discount"); continue; }
      pct = d;
    }
    const key = JSON.stringify([orderId, sku]);
    if (seen.has(key)) { bad("duplicate (order_id, sku)"); continue; }
    seen.add(key);
    const rev = (priceCents * BigInt(qty) * (100n - pct) + 50n) / 100n;
    const gk = groupBy === "day" ? date : groupBy === "sku" ? sku : customer;
    sums.set(gk, (sums.get(gk) ?? 0n) + rev);
    total += rev;
  }

  const keys = [...sums.keys()].sort((a, b) => {
    const A = Array.from(a);
    const B = Array.from(b);
    for (let k = 0; k < Math.min(A.length, B.length); k++) {
      const x = A[k]?.codePointAt(0) ?? 0;
      const y = B[k]?.codePointAt(0) ?? 0;
      if (x !== y) return x - y;
    }
    return A.length - B.length;
  });
  let out = `${groupBy}\trevenue\n`;
  for (const k of keys) out += `${k}\t${fmt(sums.get(k) ?? 0n)}\n`;
  out += `TOTAL\t${fmt(total)}\n`;
  return { out, err };
}

try {
  const { out, err } = run();
  if (err.length > 0) process.stderr.write(err.join("\n") + "\n");
  process.stdout.write(out);
} catch (e) {
  process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 2;
}
