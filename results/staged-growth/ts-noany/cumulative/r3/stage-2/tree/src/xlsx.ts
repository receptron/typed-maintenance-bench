import { unzipSync } from "fflate";
import { type XNode, elems, firstElem, parseXml, textOf } from "./xml.js";

export type XCell = { kind: "text"; s: string } | { kind: "num"; n: number; date: string | undefined } | { kind: "bad" };

export interface XRow {
  row: number;
  cells: Map<number, XCell>;
}

const utf8 = new TextDecoder("utf-8", { ignoreBOM: false });

function readEntry(files: Record<string, Uint8Array>, path: string): string | undefined {
  const norm = path.replace(/^\/+/, "");
  const f = files[norm];
  return f === undefined ? undefined : utf8.decode(f);
}

function xmlOf(files: Record<string, Uint8Array>, path: string): XNode | undefined {
  const t = readEntry(files, path);
  return t === undefined ? undefined : parseXml(t);
}

function stringItem(si: XNode): string {
  let s = "";
  for (const c of elems(si)) {
    if (c.name === "t") s += textOf(c);
    else if (c.name === "r") {
      const t = firstElem(c, "t");
      if (t !== undefined) s += textOf(t);
    }
  }
  return s;
}

function colIndex(ref: string): number | undefined {
  const m = /^([A-Za-z]+)/.exec(ref);
  if (!m) return undefined;
  let n = 0;
  for (const ch of (m[1] ?? "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormat(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "")
    .replace(/_./g, "")
    .replace(/\*./g, "");
  const sec = stripped.split(";")[0] ?? "";
  return /[dmyhsDMYHS]/.test(sec) && !/^(general)$/i.test(sec.trim());
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = ["xl"];
  for (const p of target.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== "." && p !== "") parts.push(p);
  }
  return parts.join("/");
}

export function readXlsx(data: Uint8Array): XRow[] {
  const files = unzipSync(data);
  const wb = xmlOf(files, "xl/workbook.xml");
  if (wb === undefined) throw new Error("not a workbook");
  const wbRoot = firstElem(wb, "workbook");
  if (wbRoot === undefined) throw new Error("not a workbook");
  const date1904 = /^(1|true)$/i.test(firstElem(wbRoot, "workbookPr")?.attrs.get("date1904") ?? "");
  const sheets = firstElem(wbRoot, "sheets");
  const first = sheets === undefined ? undefined : elems(sheets, "sheet")[0];
  if (first === undefined) throw new Error("no worksheet");
  const rid = first.attrs.get("id");
  let path: string | undefined;
  const rels = xmlOf(files, "xl/_rels/workbook.xml.rels");
  const relRoot = rels === undefined ? undefined : firstElem(rels, "Relationships");
  if (relRoot !== undefined && rid !== undefined) {
    for (const r of elems(relRoot, "Relationship")) {
      if (r.attrs.get("Id") === rid) {
        const t = r.attrs.get("Target");
        if (t !== undefined) path = resolveTarget(t);
      }
    }
  }
  const sheetXml = path === undefined ? undefined : xmlOf(files, path);
  if (sheetXml === undefined) throw new Error("worksheet missing");
  const ws = firstElem(sheetXml, "worksheet");
  if (ws === undefined) throw new Error("bad worksheet");

  const shared: string[] = [];
  const sst = xmlOf(files, "xl/sharedStrings.xml");
  const sstRoot = sst === undefined ? undefined : firstElem(sst, "sst");
  if (sstRoot !== undefined) for (const si of elems(sstRoot, "si")) shared.push(stringItem(si));

  const dateXf: boolean[] = [];
  const styles = xmlOf(files, "xl/styles.xml");
  const ss = styles === undefined ? undefined : firstElem(styles, "styleSheet");
  if (ss !== undefined) {
    const custom = new Map<number, boolean>();
    const nf = firstElem(ss, "numFmts");
    if (nf !== undefined) {
      for (const f of elems(nf, "numFmt")) {
        custom.set(Number(f.attrs.get("numFmtId")), isDateFormat(f.attrs.get("formatCode") ?? ""));
      }
    }
    const xfs = firstElem(ss, "cellXfs");
    if (xfs !== undefined) {
      for (const xf of elems(xfs, "xf")) {
        const id = Number(xf.attrs.get("numFmtId") ?? "0");
        dateXf.push(custom.get(id) ?? BUILTIN_DATE.has(id));
      }
    }
  }

  const rows: XRow[] = [];
  const sd = firstElem(ws, "sheetData");
  let seq = 0;
  for (const r of sd === undefined ? [] : elems(sd, "row")) {
    seq++;
    const rn = Number(r.attrs.get("r") ?? "");
    const row = Number.isInteger(rn) && rn > 0 ? rn : seq;
    seq = row;
    const cells = new Map<number, XCell>();
    let nextCol = 0;
    for (const c of elems(r, "c")) {
      const ci = colIndex(c.attrs.get("r") ?? "") ?? nextCol;
      nextCol = ci + 1;
      const t = c.attrs.get("t") ?? "n";
      const v = firstElem(c, "v");
      const vt = v === undefined ? undefined : textOf(v);
      const style = Number(c.attrs.get("s") ?? "0");
      let cell: XCell | undefined;
      if (t === "inlineStr") {
        const is = firstElem(c, "is");
        cell = is === undefined ? undefined : { kind: "text", s: stringItem(is) };
      } else if (vt === undefined) {
        cell = undefined;
      } else if (t === "s") {
        const s = shared[Number(vt.trim())];
        cell = s === undefined ? { kind: "bad" } : { kind: "text", s };
      } else if (t === "str") {
        cell = { kind: "text", s: vt };
      } else if (t === "b" || t === "e") {
        cell = { kind: "bad" };
      } else if (t === "d") {
        cell = { kind: "text", s: vt.trim().slice(0, 10) };
      } else if (vt.trim() === "") {
        cell = undefined;
      } else {
        const n = Number(vt.trim());
        cell = Number.isFinite(n) ? { kind: "num", n, date: dateXf[style] === true ? serialToDate(n, date1904) : undefined } : { kind: "bad" };
      }
      if (cell !== undefined) cells.set(ci, cell);
    }
    rows.push({ row, cells });
  }
  rows.sort((a, b) => a.row - b.row);
  return rows;
}

export function serialToDate(serial: number, date1904: boolean): string | undefined {
  const days = Math.floor(serial);
  let ms: number;
  if (date1904) ms = Date.UTC(1904, 0, 1) + days * 86400000;
  else if (days >= 61) ms = Date.UTC(1899, 11, 30) + days * 86400000;
  else if (days >= 1 && days < 60) ms = Date.UTC(1899, 11, 31) + days * 86400000;
  else return undefined;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}
