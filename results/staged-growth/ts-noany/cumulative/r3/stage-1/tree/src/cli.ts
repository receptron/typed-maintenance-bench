import { readFileSync } from "node:fs";

interface Rec {
  line: number;
  fields: string[];
}

function fatal(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv: string[]): { input: string; groupBy: "day" | "sku" | "customer" } {
  let input: string | undefined;
  let groupBy: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== "--input" && a !== "--group-by") fatal(`unknown argument: ${a}`);
    const v = argv[i + 1];
    if (v === undefined) fatal(`missing value for ${a}`);
    i++;
    if (a === "--input") input = v;
    else groupBy = v;
  }
  if (input === undefined) fatal("missing --input");
  if (groupBy === "day" || groupBy === "sku" || groupBy === "customer") {
    return { input, groupBy };
  }
  return fatal(groupBy === undefined ? "missing --group-by" : `invalid --group-by: ${groupBy}`);
}

const WS = new Set([" ", "\t"]);
function trimWs(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && WS.has(s.charAt(a))) a++;
  while (b > a && WS.has(s.charAt(b - 1))) b--;
  return s.slice(a, b);
}

function parseCsv(text: string): Rec[] {
  const recs: Rec[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    // skip completely empty lines
    if (text.charAt(i) === "\n") {
      i++;
      line++;
      continue;
    }
    if (text.charAt(i) === "\r" && text.charAt(i + 1) === "\n") {
      i += 2;
      line++;
      continue;
    }
    const startLine = line;
    const fields: string[] = [];
    let cur = "";
    let done = false;
    while (!done) {
      if (text.charAt(i) === '"' ) {
        i++;
        for (;;) {
          if (i >= n) break;
          const c = text.charAt(i);
          if (c === '"') {
            if (text.charAt(i + 1) === '"') {
              cur += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            if (c === "\n") line++;
            cur += c;
            i++;
          }
        }
      }
      // unquoted remainder (or text after closing quote)
      for (;;) {
        if (i >= n) {
          done = true;
          break;
        }
        const c = text.charAt(i);
        if (c === ",") {
          i++;
          break;
        }
        if (c === "\n") {
          i++;
          line++;
          done = true;
          break;
        }
        if (c === "\r" && text.charAt(i + 1) === "\n") {
          i += 2;
          line++;
          done = true;
          break;
        }
        cur += c;
        i++;
      }
      fields.push(trimWs(cur));
      cur = "";
      if (!done && i >= n) {
        // trailing comma at EOF: one more empty field
        fields.push("");
        done = true;
      }
    }
    recs.push({ line: startLine, fields });
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
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= (days[mo - 1] ?? 0);
}

function cents(s: string): bigint {
  const [w = "0", f = ""] = s.split(".");
  return BigInt(w) * 100n + BigInt(f.padEnd(2, "0"));
}

function cmp(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const p = (x[i] ?? "").codePointAt(0) ?? 0;
    const q = (y[i] ?? "").codePointAt(0) ?? 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length - y.length;
}

function fmt(c: bigint): string {
  const s = c.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

function main(): void {
  const { input, groupBy } = parseArgs(process.argv.slice(2));
  let text: string;
  try {
    text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(readFileSync(input));
  } catch (e) {
    return fatal(`cannot read ${input}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (text.charAt(0) === "﻿") text = text.slice(1);
  const recs = parseCsv(text);
  const header = recs[0];
  if (header === undefined || header.line !== 1) return fatal("no header line");
  const names = header.fields;
  const required = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];
  const idx = new Map<string, number>();
  names.forEach((nm, k) => {
    if (!idx.has(nm)) idx.set(nm, k);
  });
  for (const r of required) {
    if (!idx.has(r)) return fatal(`header missing column: ${r}`);
  }
  const col = (r: Rec, name: string): string => {
    const k = idx.get(name);
    return k === undefined ? "" : (r.fields[k] ?? "");
  };

  const seen = new Set<string>();
  const sums = new Map<string, bigint>();
  const errs: string[] = [];
  for (const r of recs.slice(1)) {
    const reason = ((): string | null => {
      if (r.fields.length < names.length) return "too few fields";
      const orderId = col(r, "order_id");
      const customer = col(r, "customer_id");
      const date = col(r, "order_date");
      const sku = col(r, "sku");
      const qty = col(r, "quantity");
      const price = col(r, "unit_price");
      const disc = col(r, "discount");
      if (orderId === "") return "empty order_id";
      if (customer === "") return "empty customer_id";
      if (!validDate(date)) return "invalid order_date";
      if (sku === "") return "empty sku";
      if (!/^\d+$/.test(qty) || BigInt(qty) < 1n) return "invalid quantity";
      if (!/^\d+(\.\d{1,2})?$/.test(price)) return "invalid unit_price";
      let pct = 0n;
      if (disc !== "") {
        if (!/^\d+(\.\d{1,2})?$/.test(disc)) return "invalid discount";
        pct = cents(disc);
        if (pct > 100n) return "invalid discount";
      }
      const dk = JSON.stringify([orderId, sku]);
      if (seen.has(dk)) return "duplicate order_id/sku";
      seen.add(dk);
      const rev = (cents(price) * BigInt(qty) * (100n - pct) + 50n) / 100n;
      const key = groupBy === "day" ? date : groupBy === "sku" ? sku : customer;
      sums.set(key, (sums.get(key) ?? 0n) + rev);
      return null;
    })();
    if (reason !== null) errs.push(`${input}:${r.line}: ${reason}\n`);
  }

  let out = `${groupBy}\trevenue\n`;
  let total = 0n;
  for (const k of [...sums.keys()].sort(cmp)) {
    const v = sums.get(k) ?? 0n;
    total += v;
    out += `${k}\t${fmt(v)}\n`;
  }
  out += `TOTAL\t${fmt(total)}\n`;
  process.stderr.write(errs.join(""));
  process.stdout.write(out);
}

main();
