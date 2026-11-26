import { unzipSync } from "fflate";
import { decimalOf, type Val } from "./values.js";

type El = { name: string; attrs: Map<string, string>; kids: El[]; text: string };

const decodeEntities = (s: string): string =>
  s
    .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e: string) => {
      if (e === "amp") return "&";
      if (e === "lt") return "<";
      if (e === "gt") return ">";
      if (e === "quot") return '"';
      if (e === "apos") return "'";
      const cp = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));

const localName = (n: string): string => {
  const i = n.indexOf(":");
  return i < 0 ? n : n.slice(i + 1);
};

const parseXml = (xml: string): El => {
  const root: El = { name: "#root", attrs: new Map(), kids: [], text: "" };
  const stack: El[] = [root];
  const top = (): El => stack[stack.length - 1] ?? root;
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      top().text += decodeEntities(xml.slice(i));
      break;
    }
    if (lt > i) top().text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) {
      const e = xml.indexOf("-->", lt + 4);
      if (e < 0) throw new Error("bad xml");
      i = e + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const e = xml.indexOf("]]>", lt + 9);
      if (e < 0) throw new Error("bad xml");
      top().text += xml.slice(lt + 9, e);
      i = e + 3;
    } else if (xml.startsWith("<?", lt)) {
      const e = xml.indexOf("?>", lt + 2);
      if (e < 0) throw new Error("bad xml");
      i = e + 2;
    } else if (xml.startsWith("<!", lt)) {
      const e = xml.indexOf(">", lt + 2);
      if (e < 0) throw new Error("bad xml");
      i = e + 1;
    } else if (xml.startsWith("</", lt)) {
      const e = xml.indexOf(">", lt + 2);
      if (e < 0 || stack.length < 2) throw new Error("bad xml");
      stack.pop();
      i = e + 1;
    } else {
      let j = lt + 1;
      let quote = "";
      while (j < n) {
        const c = xml.charAt(j);
        if (quote !== "") {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        j++;
      }
      if (j >= n) throw new Error("bad xml");
      let inner = xml.slice(lt + 1, j);
      const selfClose = inner.endsWith("/");
      if (selfClose) inner = inner.slice(0, -1);
      const m = /^([^\s/>]+)([\s\S]*)$/.exec(inner);
      if (!m) throw new Error("bad xml");
      const el: El = { name: localName(m[1] ?? ""), attrs: new Map(), kids: [], text: "" };
      const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      for (let a = re.exec(m[2] ?? ""); a; a = re.exec(m[2] ?? "")) {
        el.attrs.set(localName(a[1] ?? ""), decodeEntities(a[2] ?? a[3] ?? ""));
      }
      top().kids.push(el);
      if (!selfClose) stack.push(el);
      i = j + 1;
    }
  }
  if (stack.length !== 1) throw new Error("bad xml");
  return root;
};

const child = (e: El, name: string): El | undefined => e.kids.find((k) => k.name === name);
const children = (e: El, name: string): El[] => e.kids.filter((k) => k.name === name);

// text of a string item: <t> and rich-text <r><t>, skipping phonetic runs
const itemText = (e: El): string => {
  let s = "";
  for (const k of e.kids) {
    if (k.name === "t") s += k.text;
    else if (k.name === "r") s += itemText(k);
  }
  return s;
};

const decoder = new TextDecoder("utf-8");

const normPath = (p: string): string => {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
};

const BUILTIN_DATE_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

const isDateFormat = (code: string): boolean => {
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "")
    .replace(/_./g, "")
    .replace(/\*./g, "");
  return /[ymdhs]/i.test(stripped) && !/^general$/i.test(stripped.trim());
};

const colIndex = (ref: string): number => {
  const m = /^([A-Za-z]+)/.exec(ref);
  let n = 0;
  for (const ch of (m?.[1] ?? "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const serialToDate = (serial: number, is1904: boolean): string | undefined => {
  if (!Number.isFinite(serial) || serial < 0) return undefined;
  let day = Math.floor(serial);
  let ms: number;
  if (is1904) ms = Date.UTC(1904, 0, 1) + day * 86400000;
  else {
    if (day === 60) return undefined;
    if (day < 60) day += 1;
    ms = Date.UTC(1899, 11, 30) + day * 86400000;
  }
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
};

export type Sheet = { rows: Map<number, Map<number, Val>> };

export const readXlsx = (data: Uint8Array): Sheet => {
  const files = unzipSync(data);
  const getXml = (path: string): El | undefined => {
    const want = normPath(path);
    for (const [name, bytes] of Object.entries(files)) {
      if (normPath(name) === want) return parseXml(decoder.decode(bytes));
    }
    return undefined;
  };
  const wb = getXml("xl/workbook.xml");
  if (!wb) throw new Error("no workbook");
  const wbEl = child(wb, "workbook");
  if (!wbEl) throw new Error("no workbook");
  const sheetEl = child(child(wbEl, "sheets") ?? wbEl, "sheet");
  if (!sheetEl) throw new Error("no worksheet");
  const rid = sheetEl.attrs.get("id");
  let target: string | undefined;
  const rels = getXml("xl/_rels/workbook.xml.rels");
  const relRoot = rels ? child(rels, "Relationships") : undefined;
  if (relRoot) {
    const rel = children(relRoot, "Relationship").find((r) => r.attrs.get("Id") === rid);
    const t = rel?.attrs.get("Target");
    if (t !== undefined) target = t.startsWith("/") ? t : `xl/${t}`;
  }
  if (target === undefined) throw new Error("no worksheet");
  const ws = getXml(target);
  const wsEl = ws ? child(ws, "worksheet") : undefined;
  if (!wsEl) throw new Error("no worksheet");
  const is1904 = /^(1|true)$/i.test(child(wbEl, "workbookPr")?.attrs.get("date1904") ?? "");

  const shared: string[] = [];
  const sst = getXml("xl/sharedStrings.xml");
  const sstEl = sst ? child(sst, "sst") : undefined;
  if (sstEl) for (const si of children(sstEl, "si")) shared.push(itemText(si));

  const dateStyle: boolean[] = [];
  const st = getXml("xl/styles.xml");
  const stEl = st ? child(st, "styleSheet") : undefined;
  if (stEl) {
    const custom = new Map<number, string>();
    const nf = child(stEl, "numFmts");
    if (nf) for (const f of children(nf, "numFmt")) custom.set(Number(f.attrs.get("numFmtId")), f.attrs.get("formatCode") ?? "");
    const xfs = child(stEl, "cellXfs");
    if (xfs) {
      for (const xf of children(xfs, "xf")) {
        const id = Number(xf.attrs.get("numFmtId") ?? "0");
        const code = custom.get(id);
        dateStyle.push(code !== undefined ? isDateFormat(code) : BUILTIN_DATE_IDS.has(id));
      }
    }
  }

  const rows = new Map<number, Map<number, Val>>();
  const sd = child(wsEl, "sheetData");
  let rowSeq = 0;
  for (const row of sd ? children(sd, "row") : []) {
    rowSeq++;
    const rAttr = row.attrs.get("r");
    const rn = rAttr !== undefined && /^\d+$/.test(rAttr) ? Number(rAttr) : rowSeq;
    rowSeq = rn;
    const cells = new Map<number, Val>();
    let colSeq = -1;
    for (const c of children(row, "c")) {
      const ref = c.attrs.get("r");
      const ci = ref !== undefined ? colIndex(ref) : colSeq + 1;
      colSeq = ci;
      const t = c.attrs.get("t") ?? "n";
      const v = child(c, "v");
      const vt = v ? v.text : "";
      let val: Val = { t: "empty" };
      if (t === "s") {
        const idx = Number(vt.trim());
        const s = vt.trim() === "" ? undefined : shared[idx];
        val = s === undefined ? { t: "bad" } : { t: "str", s };
      } else if (t === "inlineStr") {
        const is = child(c, "is");
        val = is ? { t: "str", s: itemText(is) } : { t: "empty" };
      } else if (t === "str") {
        val = v ? { t: "str", s: vt } : { t: "empty" };
      } else if (t === "b" || t === "e") {
        val = v ? { t: "bad" } : { t: "empty" };
      } else if (t === "d") {
        const m = /^(\d{4}-\d{2}-\d{2})/.exec(vt.trim());
        val = m?.[1] !== undefined ? { t: "date", s: m[1] } : { t: "bad" };
      } else if (vt.trim() !== "") {
        const num = Number(vt.trim());
        if (!Number.isFinite(num)) val = { t: "bad" };
        else if (dateStyle[Number(c.attrs.get("s") ?? "0")] === true) {
          const d = serialToDate(num, is1904);
          val = d === undefined ? { t: "bad" } : { t: "date", s: d };
        } else {
          const s = decimalOf(num);
          val = s === undefined ? { t: "bad" } : { t: "num", s };
        }
      }
      if (val.t !== "empty" && !(val.t === "str" && val.s === "")) cells.set(ci, val);
    }
    if (cells.size > 0) rows.set(rn, cells);
  }
  return { rows };
};
