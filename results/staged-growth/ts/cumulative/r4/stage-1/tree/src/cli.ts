import { readFileSync } from "node:fs";

class Fatal extends Error {}

const GROUPS = ["day", "sku", "customer"] as const;
type Group = (typeof GROUPS)[number];

function parseArgs(argv: string[]): { input: string; group: Group } {
  let input: string | undefined;
  let group: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const opt = argv[i];
    if (opt !== "--input" && opt !== "--group-by") throw new Fatal(`unknown option: ${opt}`);
    const val = argv[i + 1];
    if (val === undefined) throw new Fatal(`missing value for ${opt}`);
    if (opt === "--input") input = val;
    else group = val;
  }
  if (input === undefined) throw new Fatal("missing option --input");
  if (group === undefined) throw new Fatal("missing option --group-by");
  if (!(GROUPS as readonly string[]).includes(group)) throw new Fatal(`invalid --group-by value: ${group}`);
  return { input, group: group as Group };
}

interface Rec {
  line: number;
  fields: string[];
  error?: string;
}

const isWs = (c: string | undefined) => c === " " || c === "\t";
const trimWs = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, "");

// RFC 4180 style parser; empty lines (outside quotes) are skipped.
function parseCsv(text: string): Rec[] {
  const recs: Rec[] = [];
  let i = 0;
  let line = 1;
  const n = text.length;
  while (i < n) {
    // skip completely empty lines
    if (text[i] === "\n") { i++; line++; continue; }
    if (text[i] === "\r" && text[i + 1] === "\n") { i += 2; line++; continue; }
    const startLine = line;
    const fields: string[] = [];
    let error: string | undefined;
    for (;;) {
      let j = i;
      while (isWs(text[j])) j++;
      let value = "";
      if (text[j] === '"') {
        j++;
        let closed = false;
        while (j < n) {
          const c = text[j];
          if (c === '"') {
            if (text[j + 1] === '"') { value += '"'; j += 2; continue; }
            j++; closed = true; break;
          }
          if (c === "\n") line++;
          value += c;
          j++;
        }
        if (!closed) {
          error ??= "unterminated quoted field";
        } else {
          while (isWs(text[j])) j++;
          if (j < n && text[j] !== "," && text[j] !== "\n" && !(text[j] === "\r" && text[j + 1] === "\n")) {
            error ??= "unexpected characters after closing quote";
            while (j < n && text[j] !== "," && text[j] !== "\n" && !(text[j] === "\r" && text[j + 1] === "\n")) j++;
          }
        }
        fields.push(trimWs(value));
      } else {
        j = i;
        while (j < n && text[j] !== "," && text[j] !== "\n" && !(text[j] === "\r" && text[j + 1] === "\n")) j++;
        fields.push(trimWs(text.slice(i, j)));
      }
      i = j;
      if (i < n && text[i] === ",") { i++; continue; }
      break;
    }
    if (i < n) {
      if (text[i] === "\r") i += 2; else i++;
      line++;
    }
    recs.push(error === undefined ? { line: startLine, fields } : { line: startLine, fields, error });
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

// "12", "12.5", "12.50" -> cents
function parseCents(s: string): bigint | undefined {
  const m = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(s);
  if (!m) return undefined;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
}

function cmp(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  const len = Math.min(x.length, y.length);
  for (let i = 0; i < len; i++) {
    const p = x[i]!.codePointAt(0)!, q = y[i]!.codePointAt(0)!;
    if (p !== q) return p < q ? -1 : 1;
  }
  return x.length - y.length;
}

function fmt(cents: bigint): string {
  const s = cents.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

function main(): { out: string; err: string } {
  const { input, group } = parseArgs(process.argv.slice(2));
  let text: string;
  try {
    text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(readFileSync(input));
  } catch (e) {
    throw new Fatal(`cannot read ${input}: ${(e as Error).message}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.length === 0) throw new Fatal("no header line");

  // header is always the first line
  const recs = parseCsv(text.replace(/^(?=\r?\n)/, " "));
  const head = recs[0];
  if (!head) throw new Fatal("no header line");
  const names = head.fields;
  const idx = new Map<string, number>();
  names.forEach((nm, k) => { if (!idx.has(nm)) idx.set(nm, k); });
  const required = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];
  for (const r of required) if (!idx.has(r)) throw new Fatal(`header missing column: ${r}`);
  const col = (r: string[], name: string) => {
    const k = idx.get(name);
    return k === undefined ? "" : (r[k] ?? "");
  };

  const seen = new Set<string>();
  const totals = new Map<string, bigint>();
  let err = "";
  for (const rec of recs.slice(1)) {
    const reason = check(rec);
    if (typeof reason === "string") {
      err += `${input}:${rec.line}: ${reason}\n`;
      continue;
    }
    seen.add(reason.dup);
    const key = group === "day" ? reason.date : group === "sku" ? reason.sku : reason.customer;
    totals.set(key, (totals.get(key) ?? 0n) + reason.rev);
  }

  function check(rec: Rec) {
    if (rec.error) return rec.error;
    const f = rec.fields;
    if (f.length < names.length) return "fewer fields than header";
    const orderId = col(f, "order_id"), customer = col(f, "customer_id"), date = col(f, "order_date");
    const sku = col(f, "sku"), qs = col(f, "quantity"), ps = col(f, "unit_price"), ds = col(f, "discount");
    if (orderId === "") return "empty order_id";
    if (customer === "") return "empty customer_id";
    if (!validDate(date)) return "invalid order_date";
    if (sku === "") return "empty sku";
    if (!/^[0-9]+$/.test(qs) || BigInt(qs) < 1n) return "invalid quantity";
    const price = parseCents(ps);
    if (price === undefined) return "invalid unit_price";
    let pct = 0n;
    if (ds !== "") {
      const d = parseCents(ds);
      if (d === undefined || d > 100n) return "invalid discount";
      pct = d;
    }
    const dup = JSON.stringify([orderId, sku]);
    if (seen.has(dup)) return "duplicate (order_id, sku)";
    const num = price * BigInt(qs) * (100n - pct);
    const rev = (num * 2n + 100n) / 200n;
    return { dup, date, sku, customer, rev };
  }

  let total = 0n;
  let out = `${group}\trevenue\n`;
  for (const k of [...totals.keys()].sort(cmp)) {
    const v = totals.get(k)!;
    total += v;
    out += `${k}\t${fmt(v)}\n`;
  }
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
