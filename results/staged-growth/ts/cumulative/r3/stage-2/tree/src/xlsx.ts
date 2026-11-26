import { unzipSync, strFromU8 } from "fflate";

export type Cell =
  | { kind: "text"; text: string }
  | { kind: "num"; num: number }
  | { kind: "date"; text: string }
  | { kind: "bad" };

export interface SheetRow {
  row: number;
  cells: Map<number, Cell>;
}

const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(cp); } catch { return m; }
  });

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)(?:\\w+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : undefined;
};

/** concatenated text of all <t> elements, ignoring phonetic runs */
const textOf = (xml: string): string => {
  const cleaned = xml.replace(/<(\w+:)?rPh\b[\s\S]*?<\/(\w+:)?rPh>/g, "");
  let out = "";
  const re = /<(?:\w+:)?t\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) out += decodeEntities(m[2] ?? "");
  return out;
};

const colIndex = (ref: string): number => {
  const m = /^([A-Za-z]+)/.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]!.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const builtinDate = (id: number): boolean =>
  (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);

const customIsDate = (code: string): boolean => {
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "")
    .replace(/_./g, "")
    .replace(/\*./g, "");
  const section = stripped.split(";")[0]!;
  return /[ymdhs]/i.test(section.replace(/General/gi, ""));
};

const serialToDate = (serial: number, is1904: boolean): string => {
  const days = Math.floor(serial);
  if (!Number.isFinite(days) || days < 0) return "invalid";
  let ms: number;
  if (is1904) ms = Date.UTC(1904, 0, 1) + days * 86400000;
  else if (days === 60) return "1900-02-29";
  else if (days < 60) ms = Date.UTC(1899, 11, 31) + days * 86400000;
  else ms = Date.UTC(1899, 11, 30) + days * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "invalid";
  const y = d.getUTCFullYear();
  if (y > 9999) return "invalid";
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(y, 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

export function readFirstSheet(data: Uint8Array): SheetRow[] {
  const files = unzipSync(data);
  const get = (name: string): string | undefined => {
    const f = files[name.replace(/^\//, "")];
    return f ? strFromU8(f) : undefined;
  };
  const wb = get("xl/workbook.xml");
  if (wb === undefined) throw new Error("no workbook");
  const sheetTag = /<(?:\w+:)?sheet\b[^>]*>/.exec(wb);
  if (!sheetTag) throw new Error("no worksheet");
  const rid = attr(sheetTag[0], "id");
  const rels = get("xl/_rels/workbook.xml.rels") ?? "";
  let target: string | undefined;
  for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    if (attr(m[0], "Id") === rid) { target = attr(m[0], "Target"); break; }
  }
  if (target === undefined) throw new Error("worksheet relationship missing");
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheet = get(path);
  if (sheet === undefined) throw new Error("worksheet missing");

  const is1904 = /<(?:\w+:)?workbookPr\b[^>]*date1904\s*=\s*["'](1|true)["']/i.test(wb);

  const shared: string[] = [];
  const sst = get("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) shared.push(textOf(m[1] ?? ""));

  // styles: which cellXfs indexes are date formats
  const dateStyle: boolean[] = [];
  const styles = get("xl/styles.xml");
  if (styles) {
    const custom = new Map<number, string>();
    for (const m of styles.matchAll(/<(?:\w+:)?numFmt\b[^>]*>/g)) {
      const id = Number(attr(m[0], "numFmtId"));
      custom.set(id, attr(m[0], "formatCode") ?? "");
    }
    const xfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(styles);
    if (xfs) {
      for (const m of xfs[1]!.matchAll(/<(?:\w+:)?xf\b[^>]*>/g)) {
        const id = Number(attr(m[0], "numFmtId") ?? "0");
        const code = custom.get(id);
        dateStyle.push(code !== undefined ? customIsDate(code) : builtinDate(id));
      }
    }
  }

  const rows: SheetRow[] = [];
  let lastRow = 0;
  for (const rm of sheet.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    const rAttr = attr(rm[1]!, "r");
    const rowNo = rAttr !== undefined && /^\d+$/.test(rAttr) ? Number(rAttr) : lastRow + 1;
    lastRow = rowNo;
    const cells = new Map<number, Cell>();
    let nextCol = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const a = cm[1]!;
      const body = cm[2] ?? "";
      const ref = attr(a, "r");
      let col = ref ? colIndex(ref) : -1;
      if (col < 0) col = nextCol;
      nextCol = col + 1;
      const t = attr(a, "t") ?? "n";
      const s = Number(attr(a, "s") ?? "0");
      const vm = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body);
      const v = vm ? decodeEntities(vm[1]!) : undefined;
      let cell: Cell | undefined;
      if (t === "inlineStr") {
        const im = /<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/.exec(body);
        const txt = im ? textOf(im[1]!) : "";
        if (txt !== "") cell = { kind: "text", text: txt };
      } else if (v === undefined || v === "") {
        cell = undefined;
      } else if (t === "s") {
        const txt = shared[Number(v)];
        if (txt === undefined) cell = { kind: "bad" };
        else if (txt !== "") cell = { kind: "text", text: txt };
      } else if (t === "str") {
        cell = { kind: "text", text: v };
      } else if (t === "b" || t === "e") {
        cell = { kind: "bad" };
      } else if (t === "d") {
        const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
        cell = m ? { kind: "date", text: m[1]! } : { kind: "text", text: v };
      } else {
        const num = Number(v.trim());
        if (Number.isNaN(num)) cell = { kind: "bad" };
        else if (dateStyle[s]) cell = { kind: "date", text: serialToDate(num, is1904) };
        else cell = { kind: "num", num };
      }
      if (cell) cells.set(col, cell);
    }
    rows.push({ row: rowNo, cells });
  }
  return rows;
}
