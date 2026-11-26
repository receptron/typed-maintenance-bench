import { posix } from "node:path";
import { readZip } from "./zip.js";
import { child, children, parseXml, type XNode } from "./xml.js";

export type XCell =
  | { k: "empty" }
  | { k: "str"; v: string }
  | { k: "num"; v: number }
  | { k: "date"; v: string }
  | { k: "bad" };

export type XRow = { row: number; cells: Map<number, XCell> };

function colIndex(ref: string): number | undefined {
  const m = /^([A-Za-z]+)/.exec(ref);
  if (!m) return undefined;
  let n = 0;
  for (const ch of (m[1] ?? "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function unescapeXl(s: string): string {
  return s.replace(/_x([0-9a-fA-F]{4})_/g, (_w, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function richText(si: XNode): string {
  let out = "";
  const walk = (n: XNode): void => {
    for (const c of n.children) {
      if (c.name === "t") out += c.text;
      else if (c.name === "r") walk(c);
      // phonetic runs (rPh) are not part of the value
    }
  };
  walk(si);
  return unescapeXl(out);
}

function isDateFormat(code: string): boolean {
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "")
    .replace(/_./g, "");
  if (/^general$/i.test(stripped.trim())) return false;
  return /[ymdhs]/i.test(stripped);
}

function serialToDate(serial: number, date1904: boolean): string | undefined {
  if (!Number.isFinite(serial)) return undefined;
  const days = Math.floor(serial);
  let ms: number;
  if (date1904) {
    ms = Date.UTC(1904, 0, 1) + days * 86400000;
  } else if (days < 1) {
    return undefined;
  } else if (days === 60) {
    return "1900-02-29";
  } else if (days < 60) {
    ms = Date.UTC(1899, 11, 31) + days * 86400000;
  } else {
    ms = Date.UTC(1899, 11, 30) + days * 86400000;
  }
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getUTCFullYear();
  if (y < 0 || y > 9999) return undefined;
  const p = (x: number, w: number): string => String(x).padStart(w, "0");
  return `${p(y, 4)}-${p(d.getUTCMonth() + 1, 2)}-${p(d.getUTCDate(), 2)}`;
}

function text(files: Map<string, Buffer>, name: string): string | undefined {
  return files.get(name)?.toString("utf8");
}

function relTargets(files: Map<string, Buffer>, relsPath: string, base: string): Map<string, { type: string; target: string }> {
  const out = new Map<string, { type: string; target: string }>();
  const src = text(files, relsPath);
  if (src === undefined) return out;
  for (const r of children(parseXml(src), "Relationships").flatMap((x) => children(x, "Relationship"))) {
    const id = r.attrs.get("Id");
    const target = r.attrs.get("Target");
    if (id === undefined || target === undefined) continue;
    const full = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(base, target));
    out.set(id, { type: r.attrs.get("Type") ?? "", target: full });
  }
  return out;
}

export function readXlsx(buf: Buffer): XRow[] {
  const files = readZip(buf);
  let wbPath = "xl/workbook.xml";
  for (const r of relTargets(files, "_rels/.rels", "").values()) {
    if (r.type.endsWith("/officeDocument")) wbPath = r.target;
  }
  const wbSrc = text(files, wbPath);
  if (wbSrc === undefined) throw new Error("no workbook");
  const wb = parseXml(wbSrc);
  const book = child(wb, "workbook");
  if (!book) throw new Error("no workbook");
  const wbDir = posix.dirname(wbPath);
  const rels = relTargets(files, posix.join(wbDir, "_rels", `${posix.basename(wbPath)}.rels`), wbDir);
  const sheets = child(book, "sheets");
  const first = sheets ? children(sheets, "sheet")[0] : undefined;
  if (!first) throw new Error("no worksheet");
  const rid = [...first.attrs].find(([k]) => k === "id" || k.endsWith(":id"))?.[1];
  const sheetPath = rid === undefined ? undefined : rels.get(rid)?.target;
  const sheetSrc = sheetPath === undefined ? undefined : text(files, sheetPath);
  if (sheetSrc === undefined) throw new Error("no worksheet");

  const date1904 = /^(1|true)$/i.test(child(book, "workbookPr")?.attrs.get("date1904") ?? "");

  const shared: string[] = [];
  const sstPath = [...rels.values()].find((r) => r.type.endsWith("/sharedStrings"))?.target;
  const sstSrc = sstPath === undefined ? undefined : text(files, sstPath);
  if (sstSrc !== undefined) {
    const sst = child(parseXml(sstSrc), "sst");
    if (sst) for (const si of children(sst, "si")) shared.push(richText(si));
  }

  const dateStyles = new Set<number>();
  const stylesPath = [...rels.values()].find((r) => r.type.endsWith("/styles"))?.target;
  const stylesSrc = stylesPath === undefined ? undefined : text(files, stylesPath);
  if (stylesSrc !== undefined) {
    const ss = child(parseXml(stylesSrc), "styleSheet");
    if (ss) {
      const custom = new Map<number, string>();
      const nf = child(ss, "numFmts");
      if (nf) {
        for (const f of children(nf, "numFmt")) {
          custom.set(Number(f.attrs.get("numFmtId")), f.attrs.get("formatCode") ?? "");
        }
      }
      const xfs = child(ss, "cellXfs");
      if (xfs) {
        children(xfs, "xf").forEach((xf, k) => {
          const id = Number(xf.attrs.get("numFmtId") ?? "0");
          const code = custom.get(id);
          const builtin = (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);
          if (code === undefined ? builtin : isDateFormat(code)) dateStyles.add(k);
        });
      }
    }
  }

  const ws = child(parseXml(sheetSrc), "worksheet");
  const data = ws ? child(ws, "sheetData") : undefined;
  if (!data) throw new Error("no sheet data");

  const rows: XRow[] = [];
  let prevRow = 0;
  for (const r of children(data, "row")) {
    const rn = r.attrs.has("r") ? parseInt(r.attrs.get("r") ?? "", 10) : prevRow + 1;
    if (!Number.isInteger(rn) || rn < 1) throw new Error("bad row number");
    prevRow = rn;
    const cells = new Map<number, XCell>();
    let prevCol = -1;
    for (const c of children(r, "c")) {
      const ref = c.attrs.get("r");
      const ci = (ref === undefined ? undefined : colIndex(ref)) ?? prevCol + 1;
      prevCol = ci;
      const t = c.attrs.get("t") ?? "n";
      const vNode = child(c, "v");
      const v = vNode ? vNode.text : "";
      let cell: XCell;
      if (t === "s") {
        const s = v.trim() === "" ? undefined : shared[Number(v)];
        cell = v.trim() === "" ? { k: "empty" } : s === undefined ? { k: "bad" } : { k: "str", v: s };
      } else if (t === "str") {
        cell = { k: "str", v: unescapeXl(v) };
      } else if (t === "inlineStr") {
        const is = child(c, "is");
        cell = { k: "str", v: is ? richText(is) : "" };
      } else if (t === "b" || t === "e") {
        cell = vNode ? { k: "bad" } : { k: "empty" };
      } else if (t === "d") {
        const m = /^\d{4}-\d{2}-\d{2}/.exec(v.trim());
        cell = m ? { k: "date", v: m[0] } : v.trim() === "" ? { k: "empty" } : { k: "str", v: v.trim() };
      } else if (v.trim() === "") {
        cell = { k: "empty" };
      } else {
        const num = Number(v);
        if (!Number.isFinite(num)) cell = { k: "bad" };
        else {
          const style = Number(c.attrs.get("s") ?? "0");
          if (dateStyles.has(style)) {
            const d = serialToDate(num, date1904);
            cell = d === undefined ? { k: "bad" } : { k: "date", v: d };
          } else cell = { k: "num", v: num };
        }
      }
      if (cell.k === "str" && cell.v === "") cell = { k: "empty" };
      cells.set(ci, cell);
    }
    rows.push({ row: rn, cells });
  }
  rows.sort((a, b) => a.row - b.row);
  return rows;
}
