import { parse as parseYaml } from "yaml";
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

export class DateVal {
  constructor(s) { this.s = s; }
}
export const BAD = Symbol("bad");

export class FormatError extends Error {}

// Each reader returns {header?: string[], records: [{loc, obj}]} where obj is a
// plain object (column -> raw value) or null for an invalid (non-object) record.

export const readJson = (text) => {
  let data;
  try {
    data = JSON.parse(text, (k, v, ctx) =>
      typeof v === "number" && ctx?.source && /^-?[0-9]+$/.test(ctx.source) && !Number.isSafeInteger(v)
        ? BigInt(ctx.source)
        : v);
  } catch (e) {
    throw new FormatError(`invalid JSON: ${e.message}`);
  }
  if (!Array.isArray(data)) throw new FormatError("JSON top-level value is not an array");
  return data.map((el, i) => ({ loc: `#${i + 1}`, obj: isObj(el) ? el : null }));
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof DateVal);

export const readJsonl = (text) => {
  const out = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (line === "" || line === "\r") return;
    let v;
    try {
      v = JSON.parse(line, (k, val, ctx) =>
        typeof val === "number" && ctx?.source && /^-?[0-9]+$/.test(ctx.source) && !Number.isSafeInteger(val)
          ? BigInt(ctx.source)
          : val);
    } catch {
      v = null;
    }
    out.push({ loc: String(i + 1), obj: isObj(v) ? v : null });
  });
  return out;
};

const dateTag = {
  tag: "tag:yaml.org,2002:timestamp",
  default: true,
  test: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  resolve: (str) => new DateVal(str),
};

export const readYaml = (text) => {
  let data;
  try {
    data = parseYaml(text, { schema: "core", customTags: [dateTag], intAsBigInt: true });
  } catch (e) {
    throw new FormatError(`invalid YAML: ${e.message}`);
  }
  if (!Array.isArray(data)) throw new FormatError("YAML top-level value is not a sequence");
  return data.map((el, i) => ({ loc: `#${i + 1}`, obj: isObj(el) ? el : null }));
};

// ---------- XLSX ----------

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  removeNSPrefix: false,
  isArray: (name) => ["c", "row", "si", "t", "r", "xf", "numFmt", "sheet", "Relationship", "is"].includes(name),
});

const arr = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const unescapeX = (s) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const textOf = (t) => (t === undefined || t === null ? "" : typeof t === "object" ? String(t["#text"] ?? "") : String(t));

// concatenated text of an <si> / <is> element, ignoring phonetic runs
const richText = (el) => {
  if (el === undefined || el === null || typeof el !== "object") return "";
  let s = "";
  for (const t of arr(el.t)) s += textOf(t);
  for (const r of arr(el.r)) for (const t of arr(r.t)) s += textOf(t);
  return unescapeX(s);
};

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

const isDateFormat = (code) => {
  let s = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/_./g, "").replace(/\*./g, "");
  const parts = s.split(";");
  s = parts[0];
  s = s.replace(/\[(?![hms]+\])[^\]]*\]/gi, "");
  return /[dmyhs]/i.test(s.replace(/\[|\]/g, "")) && !/^general$/i.test(s.trim());
};

const colIndex = (ref) => {
  const m = /^([A-Za-z]+)/.exec(ref);
  if (!m) return -1;
  let n = 0;
  for (const c of m[1].toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
};

const serialToDate = (serial, is1904) => {
  const days = Math.floor(serial);
  let ms;
  if (is1904) {
    if (days < 0) return "";
    ms = Date.UTC(1904, 0, 1) + days * 86400000;
  } else {
    if (days < 1 || days === 60) return "";
    ms = Date.UTC(1899, 11, 30) + (days < 60 ? days + 1 : days) * 86400000;
    if (days < 60) ms = Date.UTC(1899, 11, 31) + (days - 1) * 86400000;
  }
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
};

const resolvePath = (base, target) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
};

export const readXlsx = (buf) => {
  let files;
  try {
    files = unzipSync(new Uint8Array(buf));
  } catch (e) {
    throw new FormatError(`cannot open workbook: ${e.message}`);
  }
  const get = (p) => {
    const f = files[p];
    if (!f) return null;
    return xml.parse(strFromU8(f));
  };
  let wb, rels;
  try {
    wb = get("xl/workbook.xml");
    rels = get("xl/_rels/workbook.xml.rels");
  } catch (e) {
    throw new FormatError(`cannot open workbook: ${e.message}`);
  }
  if (!wb?.workbook) throw new FormatError("cannot open workbook: no workbook part");
  const sheets = arr(wb.workbook.sheets?.sheet);
  if (!sheets.length) throw new FormatError("workbook has no worksheet");
  const rid = sheets[0]["@_r:id"];
  const rel = arr(rels?.Relationships?.Relationship).find((r) => r["@_Id"] === rid);
  if (!rel) throw new FormatError("cannot locate first worksheet");
  const sheetPath = resolvePath("xl/workbook.xml", rel["@_Target"]);
  let sheet, sst, styles;
  try {
    sheet = get(sheetPath);
    sst = get("xl/sharedStrings.xml");
    styles = get("xl/styles.xml");
  } catch (e) {
    throw new FormatError(`cannot open workbook: ${e.message}`);
  }
  if (!sheet?.worksheet) throw new FormatError("cannot open first worksheet");
  const is1904 = ["1", "true"].includes(String(wb.workbook.workbookPr?.["@_date1904"] ?? ""));

  const strings = arr(sst?.sst?.si).map(richText);

  const customFmt = new Map();
  for (const nf of arr(styles?.styleSheet?.numFmts?.numFmt)) customFmt.set(Number(nf["@_numFmtId"]), nf["@_formatCode"] ?? "");
  const xfDate = arr(styles?.styleSheet?.cellXfs?.xf).map((xf) => {
    const id = Number(xf["@_numFmtId"] ?? 0);
    return customFmt.has(id) ? isDateFormat(customFmt.get(id)) : BUILTIN_DATE.has(id);
  });

  const rows = [];
  let rowNo = 0;
  for (const row of arr(sheet.worksheet.sheetData?.row)) {
    rowNo = row["@_r"] ? Number(row["@_r"]) : rowNo + 1;
    const cells = new Map();
    let col = -1;
    for (const c of arr(row.c)) {
      col = c["@_r"] ? colIndex(c["@_r"]) : col + 1;
      if (col < 0) continue;
      const t = c["@_t"];
      const vRaw = c.v === undefined || c.v === null ? undefined : textOf(c.v);
      let val;
      if (t === "inlineStr") {
        val = richText(arr(c.is)[0]);
      } else if (vRaw === undefined) {
        continue;
      } else if (t === "s") {
        val = strings[Number(vRaw)];
        if (val === undefined) val = BAD;
      } else if (t === "str") {
        val = unescapeX(vRaw);
      } else if (t === "b" || t === "e") {
        val = BAD;
      } else if (t === "d") {
        val = new DateVal(vRaw.trim().slice(0, 10));
      } else {
        const n = Number(vRaw.trim());
        if (vRaw.trim() === "" || !Number.isFinite(n)) {
          val = BAD;
        } else if (xfDate[Number(c["@_s"] ?? 0)]) {
          val = new DateVal(serialToDate(n, is1904));
        } else {
          val = n;
        }
      }
      if (val === "") continue;
      cells.set(col, val);
    }
    if (cells.size) rows.push({ row: rowNo, cells });
  }
  if (!rows.length) throw new FormatError("worksheet has no header row");
  return rows;
};
