export class Fatal extends Error {}

export type Val =
  | { k: "empty" }
  | { k: "text"; s: string }
  | { k: "num"; s: string; date: string | null }
  | { k: "date"; s: string }
  | { k: "bad" };

export interface Rec {
  loc: string;
  error: string | null;
  get: (name: string) => Val;
}

export const EMPTY: Val = { k: "empty" };
export const BAD: Val = { k: "bad" };

export function trimBlank(s: string): string {
  return s.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Shortest decimal form of a finite number, never in exponent notation. */
export function numStr(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  const ei = s.indexOf("e");
  if (ei < 0) return s;
  let mant = s.slice(0, ei);
  const exp = Number(s.slice(ei + 1));
  let sign = "";
  if (mant.startsWith("-")) {
    sign = "-";
    mant = mant.slice(1);
  }
  const dot = mant.indexOf(".");
  const digits = mant.replace(".", "");
  const point = (dot < 0 ? mant.length : dot) + exp;
  let out: string;
  if (point <= 0) out = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) out = digits + "0".repeat(point - digits.length);
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return sign + out;
}

export function dateFromUtc(ms: number): string | null {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 0 || y > 9999) return null;
  const p = (n: number, w: number): string => String(n).padStart(w, "0");
  return `${p(y, 4)}-${p(d.getUTCMonth() + 1, 2)}-${p(d.getUTCDate(), 2)}`;
}

/** Converts a parsed JSON/YAML value into a Val. */
export function fromParsed(v: unknown): Val {
  if (v === undefined || v === null) return EMPTY;
  if (typeof v === "string") return { k: "text", s: trimBlank(v) };
  if (typeof v === "number") {
    const s = numStr(v);
    return s === null ? BAD : { k: "num", s, date: null };
  }
  if (v instanceof Date) {
    const s = dateFromUtc(v.getTime());
    return s === null ? BAD : { k: "date", s };
  }
  return BAD;
}

export function recFromObject(loc: string, v: unknown): Rec {
  if (!isRecord(v)) return { loc, error: "invalid record", get: () => EMPTY };
  return {
    loc,
    error: null,
    get: (name) => (Object.hasOwn(v, name) ? fromParsed(v[name]) : EMPTY),
  };
}
