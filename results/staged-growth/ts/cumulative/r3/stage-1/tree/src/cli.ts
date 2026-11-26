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
  if (input === undefined || input === "") throw new Fatal("missing --input");
  if (groupBy === undefined) throw new Fatal("missing --group-by");
  if (groupBy !== "day" && groupBy !== "sku" && groupBy !== "customer") {
    throw new Fatal(`invalid --group-by value: ${groupBy}`);
  }
  return { input, groupBy };
}

interface Rec {
  line: number;
  fields: string[];
}

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
    for (;;) {
      let f = "";
      if (text[i] === '"') {
        i++;
        for (;;) {
          if (i >= n) break;
          const c = text[i]!;
          if (c === '"') {
            if (text[i + 1] === '"') { f += '"'; i += 2; continue; }
            i++;
            break;
          }
          if (c === "\n") line++;
          f += c;
          i++;
        }
        // stray characters after closing quote, up to delimiter
        while (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) {
          f += text[i];
          i++;
        }
      } else {
        while (i < n && text[i] !== "," && text[i] !== "\n" && !(text[i] === "\r" && text[i + 1] === "\n")) {
          f += text[i];
          i++;
        }
      }
      fields.push(f.replace(/^[ \t]+|[ \t]+$/g, ""));
      if (text[i] === ",") { i++; continue; }
      break;
    }
    if (i < n) {
      if (text[i] === "\r") i++;
      i++; // newline
      line++;
    }
    recs.push({ line: startLine, fields });
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

function cents(s: string): bigint {
  const [w, f = ""] = s.split(".");
  return BigInt(w!) * 100n + BigInt(f.padEnd(2, "0") || "0");
}

function fmt(c: bigint): string {
  const w = c / 100n;
  const f = (c % 100n).toString().padStart(2, "0");
  return `${w}.${f}`;
}

function cmp(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const p = x[i]!.codePointAt(0)!, q = y[i]!.codePointAt(0)!;
    if (p !== q) return p - q;
  }
  return x.length - y.length;
}

function main(): { out: string; err: string } {
  const { input, groupBy } = parseArgs(process.argv.slice(2));
  let text: string;
  try {
    text = readFileSync(input, { encoding: "utf8" });
  } catch (e) {
    throw new Fatal(`cannot read ${input}: ${(e as Error).message}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const recs = parseCsv(text);
  if (recs.length === 0) throw new Fatal("no header line");
  const header = recs[0]!.fields;
  const idx = new Map<string, number>();
  header.forEach((h, k) => { if (!idx.has(h)) idx.set(h, k); });
  const required = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];
  for (const r of required) if (!idx.has(r)) throw new Fatal(`header missing column: ${r}`);
  const col = (name: string) => idx.get(name)!;

  let err = "";
  const seen = new Set<string>();
  const sums = new Map<string, bigint>();
  let total = 0n;

  for (const rec of recs.slice(1)) {
    const f = rec.fields;
    const reason = (): string | null => {
      if (f.length < header.length) return "too few fields";
      const get = (n: string) => f[col(n)]!;
      if (get("order_id") === "") return "empty order_id";
      if (get("customer_id") === "") return "empty customer_id";
      if (!validDate(get("order_date"))) return "invalid order_date";
      if (get("sku") === "") return "empty sku";
      if (!/^[0-9]+$/.test(get("quantity")) || BigInt(get("quantity")) < 1n) return "invalid quantity";
      if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(get("unit_price"))) return "invalid unit_price";
      if (idx.has("discount")) {
        const d = get("discount");
        if (d !== "") {
          if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(d) || cents(d) > 100n) return "invalid discount";
        }
      }
      if (seen.has(JSON.stringify([get("order_id"), get("sku")]))) return "duplicate order_id and sku";
      return null;
    };
    const bad = reason();
    if (bad !== null) {
      err += `${input}:${rec.line}: ${bad}\n`;
      continue;
    }
    const get = (n: string) => f[col(n)]!;
    seen.add(JSON.stringify([get("order_id"), get("sku")]));
    const d = idx.has("discount") && get("discount") !== "" ? cents(get("discount")) : 0n;
    const num = cents(get("unit_price")) * BigInt(get("quantity")) * (100n - d);
    const rev = (num + 50n) / 100n;
    const key = groupBy === "day" ? get("order_date") : groupBy === "sku" ? get("sku") : get("customer_id");
    sums.set(key, (sums.get(key) ?? 0n) + rev);
    total += rev;
  }

  let out = `${groupBy}\trevenue\n`;
  for (const k of [...sums.keys()].sort(cmp)) out += `${k}\t${fmt(sums.get(k)!)}\n`;
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
