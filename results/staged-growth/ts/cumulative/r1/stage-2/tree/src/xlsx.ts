import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

export type Cell = { kind: "text"; v: string } | { kind: "num"; v: number } | { kind: "date"; v: string } | { kind: "bad" };
export interface Row {
  row: number;
  cells: Map<number, Cell>;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  isArray: (name) => ["row", "c", "si", "r", "sheet", "xf", "numFmt", "Relationship"].includes(name),
});

type X = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const arr = (v: X): X[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const textOf = (t: X): string => {
  if (t === undefined || t === null) return "";
  if (typeof t === "string") return t;
  if (typeof t === "object") return typeof t["#text"] === "string" ? t["#text"] : "";
  return String(t);
};

function parseXml(files: Record<string, Uint8Array>, name: string): X | undefined {
  const f = files[name];
  if (!f) return undefined;
  return parser.parse(strFromU8(f));
}

function siText(si: X): string {
  if (si === undefined || si === null || typeof si === "string") return si ?? "";
  let s = textOf(si.t);
  for (const r of arr(si.r)) s += textOf(r.t);
  return s;
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormat(code: string): boolean {
  const c = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "").replace(/_./g, "");
  return /[ymdhs]/i.test(c.replace(/General/gi, ""));
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else break;
  }
  return n - 1;
}

function serialToDate(serial: number, date1904: boolean): string | undefined {
  if (!Number.isFinite(serial)) return undefined;
  let days = Math.floor(serial);
  let ms: number;
  if (date1904) ms = Date.UTC(1904, 0, 1) + days * 86400000;
  else {
    if (days < 1) return undefined;
    if (days === 60) return "1900-02-29";
    ms = Date.UTC(1899, 11, 30) + (days > 60 ? days : days + 1) * 86400000;
  }
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (y < 0 || y > 9999) return undefined;
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(y, 4)}-${p(d.getUTCMonth() + 1, 2)}-${p(d.getUTCDate(), 2)}`;
}

/** Returns rows of the first worksheet, or throws Error with a message when unreadable. */
export function readXlsx(data: Uint8Array): Row[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new Error("cannot open workbook");
  }
  const wb = parseXml(files, "xl/workbook.xml");
  if (!wb?.workbook) throw new Error("cannot open workbook");
  const sheet = arr(wb.workbook.sheets?.sheet)[0];
  if (!sheet) throw new Error("workbook has no worksheet");
  const rid = sheet["@_r:id"] ?? Object.entries(sheet).find(([k]) => k.endsWith(":id"))?.[1];
  const rels = parseXml(files, "xl/_rels/workbook.xml.rels");
  const rel = arr(rels?.Relationships?.Relationship).find((r) => r["@_Id"] === rid);
  if (!rel) throw new Error("cannot find worksheet");
  let target = String(rel["@_Target"]);
  target = target.startsWith("/") ? target.slice(1) : "xl/" + target;
  const parts: string[] = [];
  for (const p of target.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== "." && p !== "") parts.push(p);
  }
  const ws = parseXml(files, parts.join("/"));
  if (!ws?.worksheet) throw new Error("cannot open worksheet");

  const date1904 = ["1", "true"].includes(String(wb.workbook.workbookPr?.["@_date1904"] ?? ""));
  const shared = arr(parseXml(files, "xl/sharedStrings.xml")?.sst?.si).map(siText);

  const styles = parseXml(files, "xl/styles.xml")?.styleSheet;
  const custom = new Map<number, string>();
  for (const nf of arr(styles?.numFmts?.numFmt)) custom.set(Number(nf["@_numFmtId"]), String(nf["@_formatCode"]));
  const dateStyle: boolean[] = arr(styles?.cellXfs?.xf).map((xf) => {
    const id = Number(xf["@_numFmtId"] ?? 0);
    const code = custom.get(id);
    return code !== undefined ? isDateFormat(code) : BUILTIN_DATE.has(id);
  });

  const rows: Row[] = [];
  let seq = 0;
  for (const r of arr(ws.worksheet.sheetData?.row)) {
    seq = r["@_r"] !== undefined ? Number(r["@_r"]) : seq + 1;
    const cells = new Map<number, Cell>();
    let ci = -1;
    for (const c of arr(r.c)) {
      ci = c["@_r"] !== undefined ? colIndex(String(c["@_r"])) : ci + 1;
      const t = c["@_t"] as string | undefined;
      const raw = c.v === undefined ? undefined : textOf(c.v);
      let cell: Cell | undefined;
      if (t === "inlineStr") cell = { kind: "text", v: siText(c.is) };
      else if (raw === undefined) continue;
      else if (t === "s") cell = { kind: "text", v: shared[Number(raw)] ?? "" };
      else if (t === "str") cell = { kind: "text", v: raw };
      else if (t === "b" || t === "e") cell = { kind: "bad" };
      else if (t === "d") cell = { kind: "date", v: raw.trim().slice(0, 10) };
      else {
        const n = Number(raw);
        if (raw.trim() === "" || Number.isNaN(n)) cell = { kind: "bad" };
        else if (dateStyle[Number(c["@_s"] ?? 0)]) {
          const d = serialToDate(n, date1904);
          cell = d === undefined ? { kind: "bad" } : { kind: "date", v: d };
        } else cell = { kind: "num", v: n };
      }
      if (cell.kind === "text" && cell.v === "") continue;
      cells.set(ci, cell);
    }
    rows.push({ row: seq, cells });
  }
  return rows;
}
