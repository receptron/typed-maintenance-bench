import { unzipSync, strFromU8 } from "fflate";

export class XlsxError extends Error {}

const stripNs = (xml) => xml.replace(/<(\/?)[\w.-]+:(?=[\w.-])/g, "<$1");

const decodeXml = (s) =>
  s
    .replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, e) => {
      if (e === "amp") return "&";
      if (e === "lt") return "<";
      if (e === "gt") return ">";
      if (e === "quot") return '"';
      if (e === "apos") return "'";
      const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return ""; }
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));

const attrs = (s) => {
  const o = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[m[1]] = decodeXml(m[2] ?? m[3]);
  return o;
};

const textOf = (xml) => {
  const cleaned = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of cleaned.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += decodeXml(m[1] ?? "");
  return out;
};

const prep = (u8) => stripNs(strFromU8(u8).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (m, t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")));

const colIndex = (ref) => {
  const m = /^([A-Za-z]+)/.exec(ref ?? "");
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

const BUILTIN_DATE = (id) => (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58);

const customIsDate = (code) => {
  const c = code.split(";")[0].replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "").replace(/_./g, "");
  return /[ymdhs]/i.test(c);
};

const serialToDate = (serial, is1904) => {
  const days = Math.floor(serial);
  let ms;
  if (is1904) {
    if (days < 0) return null;
    ms = Date.UTC(1904, 0, 1) + days * 86400000;
  } else {
    if (days < 1 || days === 60) return null;
    ms = Date.UTC(1899, 11, days < 60 ? 31 : 30) + days * 86400000;
  }
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (y < 0 || y > 9999) return null;
  return `${String(y).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

// Returns { header: (string|null)[], rows: [{ line, cells: Map<colIdx, value> }] }
// value: null | string | number | { date: string } | { bad: true }
export const readXlsx = (buf) => {
  let files;
  try { files = unzipSync(new Uint8Array(buf)); } catch (e) { throw new XlsxError(`cannot open workbook: ${e.message}`); }
  const get = (name) => {
    const k = Object.keys(files).find((f) => f.replace(/^\//, "") === name);
    return k === undefined ? null : files[k];
  };
  const wbRaw = get("xl/workbook.xml");
  if (!wbRaw) throw new XlsxError("cannot open workbook: no workbook.xml");
  const wb = prep(wbRaw);
  const sm = /<sheet\b[^>]*?\/?>/.exec(wb);
  if (!sm) throw new XlsxError("workbook has no worksheet");
  const rid = attrs(sm[0])["id"] ?? attrs(sm[0])["r:id"];
  const is1904 = /<workbookPr\b[^>]*\bdate1904\s*=\s*["'](1|true)["']/i.test(wb);
  let target;
  const relsRaw = get("xl/_rels/workbook.xml.rels");
  if (relsRaw && rid !== undefined) {
    for (const m of prep(relsRaw).matchAll(/<Relationship\b[^>]*?\/?>/g)) {
      const a = attrs(m[0]);
      if (a.Id === rid) target = a.Target;
    }
  }
  if (target === undefined) throw new XlsxError("cannot locate first worksheet");
  const path = target.startsWith("/") ? target.slice(1) : "xl/" + target;
  const norm = [];
  for (const p of path.split("/")) { if (p === "..") norm.pop(); else if (p !== ".") norm.push(p); }
  const sheetRaw = get(norm.join("/"));
  if (!sheetRaw) throw new XlsxError("first worksheet missing");

  const shared = [];
  const ssRaw = get("xl/sharedStrings.xml");
  if (ssRaw) {
    for (const m of prep(ssRaw).matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(textOf(m[1] ?? ""));
  }

  const xfDate = [];
  const stRaw = get("xl/styles.xml");
  if (stRaw) {
    const st = prep(stRaw);
    const custom = new Map();
    for (const m of st.matchAll(/<numFmt\b[^>]*?\/?>/g)) {
      const a = attrs(m[0]);
      custom.set(Number(a.numFmtId), a.formatCode ?? "");
    }
    const blk = /<cellXfs\b[^>]*?>([\s\S]*?)<\/cellXfs>/.exec(st);
    if (blk) {
      for (const m of blk[1].matchAll(/<xf\b[^>]*?\/?>/g)) {
        const id = Number(attrs(m[0]).numFmtId ?? 0);
        xfDate.push(custom.has(id) ? customIsDate(custom.get(id)) : BUILTIN_DATE(id));
      }
    }
  }

  const sheet = prep(sheetRaw);
  const rows = [];
  let autoRow = 0;
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attrs(rm[1]);
    autoRow = ra.r !== undefined && /^[0-9]+$/.test(ra.r) ? Number(ra.r) : autoRow + 1;
    const cells = new Map();
    let auto = -1;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(cm[1]);
      const ci = ca.r !== undefined && colIndex(ca.r) >= 0 ? colIndex(ca.r) : auto + 1;
      auto = ci;
      const inner = cm[2] ?? "";
      const t = ca.t ?? "n";
      let val = null;
      const vm = /<v\b[^>]*?(?:\/>|>([\s\S]*?)<\/v>)/.exec(inner);
      const vtext = vm && vm[1] !== undefined ? decodeXml(vm[1]) : null;
      if (t === "inlineStr") {
        const im = /<is\b[^>]*?(?:\/>|>([\s\S]*?)<\/is>)/.exec(inner);
        val = im ? textOf(im[1] ?? "") : null;
      } else if (vtext === null) val = null;
      else if (t === "s") {
        const s = shared[Number(vtext.trim())];
        val = s === undefined ? { bad: true } : s;
      } else if (t === "str") val = vtext;
      else if (t === "b" || t === "e") val = { bad: true };
      else if (t === "d") val = /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(vtext.trim()) ? { date: vtext.trim().slice(0, 10) } : vtext;
      else {
        if (vtext.trim() === "") val = null;
        else {
          const n = Number(vtext.trim());
          if (!Number.isFinite(n)) val = { bad: true };
          else if (xfDate[Number(ca.s ?? 0)]) {
            const d = serialToDate(n, is1904);
            val = d === null ? { bad: true } : { date: d };
          } else val = n;
        }
      }
      if (val !== null) cells.set(ci, val);
    }
    const hasValue = [...cells.values()].some((v) => v !== "");
    if (hasValue) rows.push({ line: autoRow, cells });
  }
  return rows;
};
