import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { readXlsx } from "./xlsx.js";
import { decimalOf, type Val } from "./values.js";

type Rec = { line: number; fields: string[]; error?: string };

type Row = { loc: string; vals?: Map<string, Val>; error?: string };

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

type Format = "csv" | "json" | "jsonl" | "yaml" | "xlsx";

const isFormat = (s: string): s is Format => s === "csv" || s === "json" || s === "jsonl" || s === "yaml" || s === "xlsx";

const formatFromName = (name: string): Format | undefined => {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot < 0) return undefined;
  const ext = base.slice(dot + 1).toLowerCase();
  if (ext === "csv" || ext === "json" || ext === "jsonl" || ext === "xlsx") return ext;
  if (ext === "ndjson") return "jsonl";
  if (ext === "yaml" || ext === "yml") return "yaml";
  return undefined;
};

const parseArgs = (argv: string[]): { input: string; groupBy: string; format: Format } => {
  let input: string | undefined;
  let groupBy: string | undefined;
  let fmtArg: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const opt = argv[i];
    const val = argv[i + 1];
    if (opt !== "--input" && opt !== "--group-by" && opt !== "--format") return fail(`unknown option: ${opt ?? ""}`);
    if (val === undefined) return fail(`missing value for ${opt}`);
    if (opt === "--input") {
      if (input !== undefined) return fail("duplicate --input");
      input = val;
    } else if (opt === "--format") {
      if (fmtArg !== undefined) return fail("duplicate --format");
      fmtArg = val;
    } else {
      if (groupBy !== undefined) return fail("duplicate --group-by");
      groupBy = val;
    }
  }
  if (input === undefined) return fail("missing --input");
  if (groupBy === undefined) return fail("missing --group-by");
  if (groupBy !== "day" && groupBy !== "sku" && groupBy !== "customer") return fail(`invalid --group-by: ${groupBy}`);
  let format: Format | undefined;
  if (fmtArg !== undefined) {
    if (!isFormat(fmtArg)) return fail(`invalid --format: ${fmtArg}`);
    format = fmtArg;
  } else {
    format = formatFromName(input);
    if (format === undefined) return fail(`cannot determine format of ${input}`);
  }
  return { input, groupBy, format };
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

const REQUIRED = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];
const FIELDS = [...REQUIRED, "discount", "notes"];

const decodeUtf8 = (buf: Buffer): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return fail("input is not valid UTF-8");
  }
};

const toVal = (v: unknown): Val => {
  if (v === undefined || v === null) return { t: "empty" };
  if (typeof v === "string") {
    const s = trim(v);
    return s === "" ? { t: "empty" } : { t: "str", s };
  }
  if (typeof v === "number") {
    const s = decimalOf(v);
    return s === undefined ? { t: "bad" } : { t: "num", s };
  }
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? { t: "bad" } : { t: "date", s: v.toISOString().slice(0, 10) };
  }
  return { t: "bad" };
};

const isObject = (v: unknown): v is object => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

const objectRow = (loc: string, v: unknown): Row => {
  if (!isObject(v)) return { loc, error: "record is not an object" };
  const vals = new Map<string, Val>();
  for (const [k, x] of Object.entries(v)) vals.set(k, toVal(x));
  return { loc, vals };
};

const csvRows = (text: string): Row[] => {
  const recs = parseCsv(text);
  const header = recs[0];
  if (!header) return fail("no header line");
  const col = new Map<string, number>();
  header.fields.forEach((name, idx) => {
    if (!col.has(name)) col.set(name, idx);
  });
  for (const r of REQUIRED) if (!col.has(r)) return fail(`header missing column: ${r}`);
  return recs.slice(1).map((rec): Row => {
    const loc = String(rec.line);
    if (rec.error !== undefined) return { loc, error: rec.error };
    if (rec.fields.length < header.fields.length) return { loc, error: "too few fields" };
    const vals = new Map<string, Val>();
    for (const name of FIELDS) {
      const idx = col.get(name);
      const s = idx === undefined ? "" : (rec.fields[idx] ?? "");
      vals.set(name, s === "" ? { t: "empty" } : { t: "str", s });
    }
    return { loc, vals };
  });
};

const jsonRows = (text: string): Row[] => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail("invalid JSON");
  }
  if (!Array.isArray(data)) return fail("top-level JSON value is not an array");
  return data.map((v: unknown, i): Row => objectRow(`#${i + 1}`, v));
};

const jsonlRows = (text: string): Row[] => {
  const out: Row[] = [];
  text.split("\n").forEach((line, i) => {
    if (trim(line.replace(/\r$/, "")) === "") return;
    const loc = String(i + 1);
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      out.push({ loc, error: "invalid JSON" });
      return;
    }
    out.push(objectRow(loc, v));
  });
  return out;
};

const yamlRows = (text: string): Row[] => {
  let data: unknown;
  try {
    data = parseYaml(text, { customTags: ["timestamp"] });
  } catch {
    return fail("invalid YAML");
  }
  if (!Array.isArray(data)) return fail("top-level YAML value is not a sequence");
  return data.map((v: unknown, i): Row => objectRow(`#${i + 1}`, v));
};

const cellName = (v: Val | undefined): string | undefined => (v && (v.t === "str" || v.t === "num") ? trim(v.s) : undefined);

const xlsxRows = (buf: Buffer): Row[] => {
  let sheet: ReturnType<typeof readXlsx>;
  try {
    sheet = readXlsx(new Uint8Array(buf));
  } catch {
    return fail("cannot open workbook");
  }
  const head = sheet.rows.get(1);
  if (!head) return fail("no header row");
  const col = new Map<string, number>();
  for (const [ci, v] of head) {
    const name = cellName(v);
    if (name !== undefined && !col.has(name)) col.set(name, ci);
  }
  for (const r of REQUIRED) if (!col.has(r)) return fail(`header missing column: ${r}`);
  const out: Row[] = [];
  for (const rn of [...sheet.rows.keys()].filter((k) => k > 1).sort((a, b) => a - b)) {
    const cells = sheet.rows.get(rn);
    if (!cells) continue;
    const vals = new Map<string, Val>();
    for (const name of FIELDS) {
      const idx = col.get(name);
      const v = idx === undefined ? undefined : cells.get(idx);
      if (v === undefined) vals.set(name, { t: "empty" });
      else if (v.t === "str") {
        const s = trim(v.s);
        vals.set(name, s === "" ? { t: "empty" } : { t: "str", s });
      } else vals.set(name, v);
    }
    out.push({ loc: String(rn), vals });
  }
  return out;
};

const main = (): void => {
  const { input, groupBy, format } = parseArgs(process.argv.slice(2));
  let buf: Buffer;
  try {
    buf = readFileSync(input);
  } catch (e) {
    return fail(`cannot read ${input}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let rows: Row[];
  if (format === "xlsx") rows = xlsxRows(buf);
  else {
    let text = decodeUtf8(buf);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    rows = format === "csv" ? csvRows(text) : format === "json" ? jsonRows(text) : format === "jsonl" ? jsonlRows(text) : yamlRows(text);
  }

  const seen = new Set<string>();
  const totals = new Map<string, bigint>();
  let total = 0n;
  const keyCol = groupBy === "day" ? "order_date" : groupBy === "sku" ? "sku" : "customer_id";

  for (const rec of rows) {
    const reject = (reason: string): void => {
      process.stderr.write(`${input}:${rec.loc}: ${reason}\n`);
    };
    if (rec.error !== undefined || rec.vals === undefined) {
      reject(rec.error ?? "invalid record");
      continue;
    }
    const vals = rec.vals;
    // text of a field; undefined when the value's type is not allowed
    const text = (name: string): string | undefined => {
      const v = vals.get(name);
      if (v === undefined || v.t === "empty") return "";
      return v.t === "str" || v.t === "num" ? v.s : undefined;
    };
    const orderId = text("order_id");
    if (orderId === undefined || orderId === "") { reject("empty order_id"); continue; }
    const customer = text("customer_id");
    if (customer === undefined || customer === "") { reject("empty customer_id"); continue; }
    const dv = vals.get("order_date");
    const date = dv === undefined ? "" : dv.t === "str" || dv.t === "date" ? dv.s : "";
    if (!validDate(date)) { reject("invalid order_date"); continue; }
    const sku = text("sku");
    if (sku === undefined || sku === "") { reject("empty sku"); continue; }
    const qs = text("quantity");
    if (qs === undefined || !/^\d+$/.test(qs) || BigInt(qs) < 1n) { reject("invalid quantity"); continue; }
    const price = parseHundredths(text("unit_price") ?? "");
    if (price === undefined) { reject("invalid unit_price"); continue; }
    const ds = text("discount");
    let pct = 0n;
    if (ds === undefined) { reject("invalid discount"); continue; }
    if (ds !== "") {
      const d = parseHundredths(ds);
      if (d === undefined || d > 100n) { reject("invalid discount"); continue; }
      pct = d;
    }
    if (text("notes") === undefined) { reject("invalid notes"); continue; }
    const dupKey = JSON.stringify([orderId, sku]);
    if (seen.has(dupKey)) { reject("duplicate (order_id, sku)"); continue; }
    seen.add(dupKey);
    const rev = (price * BigInt(qs) * (100n - pct) + 50n) / 100n;
    const key = keyCol === "order_date" ? date : keyCol === "sku" ? sku : customer;
    totals.set(key, (totals.get(key) ?? 0n) + rev);
    total += rev;
  }

  const lines = [`${groupBy}\trevenue`];
  for (const k of [...totals.keys()].sort(cmp)) lines.push(`${k}\t${fmt(totals.get(k) ?? 0n)}`);
  lines.push(`TOTAL\t${fmt(total)}`);
  process.stdout.write(`${lines.join("\n")}\n`);
};

main();
