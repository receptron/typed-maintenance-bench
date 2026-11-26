export type Val =
  | { t: "empty" }
  | { t: "str"; s: string }
  | { t: "num"; s: string }
  | { t: "date"; s: string }
  | { t: "bad" };

// shortest decimal form of a finite number, never in exponent notation
export const decimalOf = (n: number): string | undefined => {
  if (!Number.isFinite(n)) return undefined;
  if (n === 0) return "0";
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(n.toExponential());
  if (!m) return undefined;
  const sign = m[1] ?? "";
  const digits = `${m[2] ?? ""}${m[3] ?? ""}`;
  const exp = Number(m[4]);
  const pointPos = 1 + exp;
  let body: string;
  if (pointPos <= 0) body = `0.${"0".repeat(-pointPos)}${digits}`;
  else if (pointPos >= digits.length) body = digits + "0".repeat(pointPos - digits.length);
  else body = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
  return sign + body;
};
