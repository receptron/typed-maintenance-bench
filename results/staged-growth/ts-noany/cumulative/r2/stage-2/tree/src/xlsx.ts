import { unzipSync } from "fflate";
import { BAD, EMPTY, Fatal, type Rec, type Val, dateFromUtc, numStr, trimBlank } from "./values.js";

function decodeEntities(s: string): string {
  return s
    .replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(lt|gt|amp|quot|apos));/g, (m, hex, dec, name) => {
      if (typeof name === "string") {
        return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[name] ?? m;
      }
      const cp = typeof hex === "string" ? parseInt(hex, 16) : Number(dec);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function attrs(s: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = m[1];
    if (name !== undefined && !out.has(name)) out.set(name, decodeEntities(m[2] ?? m[3] ?? ""));
  }
  return out;
}

function textOf(xml: string): string {
  const cleaned = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
  let out = "";
  for (const m of cleaned.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) {
    out += decodeEntities(m[1] ?? "");
  }
  return out;
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) {
    out.push(textOf(m[1] ?? ""));
  }
  return out;
}

const BUILTIN_DATE_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53,
  54, 55, 56, 57, 58,
]);

function isDateCode(code: string): boolean {
  const c = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "")
    .replace(/[_*]./g, "");
  return /[dmyhs]/i.test(c);
}

/** For each cell style index, whether it formats numbers as dates. */
function dateStyles(xml: string): boolean[] {
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<(?:\w+:)?numFmt\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1] ?? "");
    const id = Number(a.get("numFmtId"));
    const code = a.get("formatCode");
    if (Number.isInteger(id) && code !== undefined) custom.set(id, code);
  }
  const block = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(xml)?.[1] ?? "";
  const out: boolean[] = [];
  for (const m of block.matchAll(/<(?:\w+:)?xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/(?:\w+:)?xf>)/g)) {
    const id = Number(attrs(m[1] ?? "").get("numFmtId"));
    const code = custom.get(id);
    out.push(code !== undefined ? isDateCode(code) : BUILTIN_DATE_IDS.has(id));
  }
  return out;
}

function serialToDate(serial: number, base1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  const day = Math.floor(serial);
  const DAY = 86400000;
  if (base1904) return dateFromUtc(Date.UTC(1904, 0, 1) + day * DAY);
  if (day === 60) return "1900-02-29";
  const base = day < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return dateFromUtc(base + day * DAY);
}

function colIndex(ref: string): number | null {
  const m = /^([A-Za-z]+)/.exec(ref);
  if (m === null || m[1] === undefined) return null;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = ["xl"];
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

export function loadXlsx(bytes: Uint8Array): { recs: Rec[] } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Fatal("cannot open workbook");
  }
  const read = (name: string): string | null => {
    const f = Object.hasOwn(files, name) ? files[name] : undefined;
    return f === undefined ? null : new TextDecoder("utf-8").decode(f);
  };
  const workbook = read("xl/workbook.xml");
  if (workbook === null) throw new Fatal("cannot open workbook");
  const rels = new Map<string, { target: string; type: string }>();
  for (const m of (read("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1] ?? "");
    const id = a.get("Id");
    const target = a.get("Target");
    if (id !== undefined && target !== undefined) rels.set(id, { target, type: a.get("Type") ?? "" });
  }
  const sheetTag = /<(?:\w+:)?sheet\b([^>]*?)\/?>/.exec(workbook);
  if (sheetTag === null) throw new Fatal("workbook has no worksheet");
  let rid: string | undefined;
  for (const [k, v] of attrs(sheetTag[1] ?? "")) if (k === "id" || k.endsWith(":id")) rid = v;
  const rel = rid === undefined ? undefined : rels.get(rid);
  if (rel === undefined) throw new Fatal("workbook has no worksheet");
  const sheet = read(resolveTarget(rel.target));
  if (sheet === null) throw new Fatal("worksheet missing");

  let sstPath = "xl/sharedStrings.xml";
  let stylesPath = "xl/styles.xml";
  for (const r of rels.values()) {
    if (r.type.endsWith("/sharedStrings")) sstPath = resolveTarget(r.target);
    else if (r.type.endsWith("/styles")) stylesPath = resolveTarget(r.target);
  }
  const strings = sharedStrings(read(sstPath) ?? "");
  const dateStyle = dateStyles(read(stylesPath) ?? "");
  const wbPr = /<(?:\w+:)?workbookPr\b([^>]*?)\/?>/.exec(workbook);
  const d1904 = wbPr === null ? "" : (attrs(wbPr[1] ?? "").get("date1904") ?? "");
  const base1904 = d1904 === "1" || d1904.toLowerCase() === "true";

  const toVal = (cellAttrs: Map<string, string>, inner: string): Val => {
    const t = cellAttrs.get("t") ?? "n";
    const vm = /<(?:\w+:)?v\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?v>)/.exec(inner);
    const raw = vm === null ? null : decodeEntities(vm[1] ?? "");
    const text = (s: string): Val => (s === "" ? EMPTY : { k: "text", s: trimBlank(s) });
    if (t === "inlineStr") {
      const im = /<(?:\w+:)?is\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?is>)/.exec(inner);
      return im === null ? EMPTY : text(textOf(im[1] ?? ""));
    }
    if (raw === null) return EMPTY;
    if (t === "s") {
      const s = strings[Number(raw)];
      return s === undefined ? BAD : text(s);
    }
    if (t === "str") return text(raw);
    if (t === "b" || t === "e") return BAD;
    if (t === "d") {
      const m = /^\s*(\d{4}-\d{2}-\d{2})/.exec(raw);
      return m === null || m[1] === undefined ? BAD : { k: "date", s: m[1] };
    }
    if (raw.trim() === "") return EMPTY;
    const n = Number(raw);
    const s = numStr(n);
    if (s === null) return BAD;
    const style = Number(cellAttrs.get("s") ?? "0");
    return { k: "num", s, date: dateStyle[style] === true ? serialToDate(n, base1904) ?? "" : null };
  };

  const rows: { row: number; cells: Map<number, Val> }[] = [];
  let prevRow = 0;
  for (const rm of sheet.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const ra = attrs(rm[1] ?? "");
    const rn = Number(ra.get("r"));
    const row = Number.isInteger(rn) && rn > 0 ? rn : prevRow + 1;
    prevRow = row;
    const cells = new Map<number, Val>();
    let prevCol = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ca = attrs(cm[1] ?? "");
      const col = colIndex(ca.get("r") ?? "") ?? prevCol + 1;
      prevCol = col;
      const v = toVal(ca, cm[2] ?? "");
      if (v.k !== "empty") cells.set(col, v);
    }
    if (cells.size > 0) rows.push({ row, cells });
  }

  const first = rows[0];
  if (first === undefined || first.row !== 1) throw new Fatal("no header row");
  const colOf = new Map<string, number>();
  for (const [idx, v] of first.cells) {
    const name = v.k === "text" || v.k === "num" ? v.s : v.k === "date" ? v.s : "";
    if (!colOf.has(name)) colOf.set(name, idx);
  }
  for (const name of ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"]) {
    if (!colOf.has(name)) throw new Fatal(`header missing column: ${name}`);
  }
  const recs: Rec[] = rows.slice(1).map(({ row, cells }) => ({
    loc: String(row),
    error: null,
    get: (name) => {
      const idx = colOf.get(name);
      return idx === undefined ? EMPTY : (cells.get(idx) ?? EMPTY);
    },
  }));
  return { recs };
}
