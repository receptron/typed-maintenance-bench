import { isCalendarDate, parseCents, parseDiscountPercent, parseQuantity } from "./values.js";

export type OrderLine = {
  orderId: string;
  customerId: string;
  orderDate: string;
  sku: string;
  quantity: number;
  unitPriceCents: number;
  discountPercent: number;
};

export type RawRecord =
  | { kind: "values"; location: string; values: ReadonlyMap<string, unknown> }
  | { kind: "problem"; location: string; problem: string };

export type Checked = { ok: true; line: OrderLine } | { ok: false; reason: string };

export const REQUIRED_COLUMNS = ["order_id", "customer_id", "order_date", "sku", "quantity", "unit_price"];
const TRIMMED = /^[ \t]+|[ \t]+$/g;

const toText = (value: unknown): string | null => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.replace(TRIMMED, "");
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const toDateText = (value: unknown): string | null => {
  if (!(value instanceof Date)) return toText(value);
  return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, "YYYY-MM-DD".length);
};

const readTexts = (values: ReadonlyMap<string, unknown>): Map<string, string> | string => {
  const texts = new Map<string, string>();
  const columns = [...REQUIRED_COLUMNS, "discount", "notes"];
  const badColumn = columns.find((column) => {
    const text = column === "order_date" ? toDateText(values.get(column)) : toText(values.get(column));
    if (text !== null) texts.set(column, text);
    return text === null;
  });
  return badColumn === undefined ? texts : `${badColumn} has an unsupported type`;
};

const requireText = (texts: Map<string, string>, column: string): string => texts.get(column) ?? "";

const buildLine = (texts: Map<string, string>): Checked => {
  const emptyColumn = ["order_id", "customer_id", "sku"].find((column) => requireText(texts, column) === "");
  if (emptyColumn !== undefined) return { ok: false, reason: `${emptyColumn} is empty` };
  if (!isCalendarDate(requireText(texts, "order_date"))) return { ok: false, reason: "order_date is not a valid date" };
  const quantity = parseQuantity(requireText(texts, "quantity"));
  if (quantity === null) return { ok: false, reason: "quantity is not an integer of at least 1" };
  const unitPriceCents = parseCents(requireText(texts, "unit_price"));
  if (unitPriceCents === null) return { ok: false, reason: "unit_price is not a valid amount" };
  const discountPercent = parseDiscountPercent(requireText(texts, "discount"));
  if (discountPercent === null) return { ok: false, reason: "discount is not between 0 and 1" };
  return { ok: true, line: lineFrom(texts, quantity, unitPriceCents, discountPercent) };
};

const lineFrom = (
  texts: Map<string, string>,
  quantity: number,
  unitPriceCents: number,
  discountPercent: number,
): OrderLine => ({
  orderId: requireText(texts, "order_id"),
  customerId: requireText(texts, "customer_id"),
  orderDate: requireText(texts, "order_date"),
  sku: requireText(texts, "sku"),
  quantity,
  unitPriceCents,
  discountPercent,
});

export const checkRecord = (values: ReadonlyMap<string, unknown>): Checked => {
  const texts = readTexts(values);
  return typeof texts === "string" ? { ok: false, reason: texts } : buildLine(texts);
};
