import type { GroupKey, Query } from "./query.js";
import type { OrderLine } from "./record.js";
import { dayIn } from "./time.js";
import { lineRevenueCents } from "./values.js";

export type Row = { key: string[]; currency: string; revenueCents: number };
export type Total = { currency: string; cents: number };
export type Aggregate = { groupBy: GroupKey[]; rows: Row[]; totals: Total[] };

const keyValue = (line: OrderLine, key: GroupKey, timeZone: string): string => {
  if (key === "day") return dayIn(line.orderDate, timeZone);
  return key === "sku" ? line.sku : line.customerId;
};

const passes = (line: OrderLine, query: Query): boolean => {
  const day = dayIn(line.orderDate, query.timeZone);
  return (
    (query.from === null || day >= query.from) &&
    (query.to === null || day <= query.to) &&
    line.sku.startsWith(query.skuPrefix)
  );
};

const codePoints = (text: string): number[] => Array.from(text, (character) => character.codePointAt(0) ?? 0);

export const compareCodePoints = (left: string, right: string): number => {
  const [leftPoints, rightPoints] = [codePoints(left), codePoints(right)];
  const differing = leftPoints.findIndex((point, index) => point !== rightPoints[index]);
  if (differing === -1) return leftPoints.length - rightPoints.length;
  return differing >= rightPoints.length ? 1 : (leftPoints[differing] ?? 0) - (rightPoints[differing] ?? 0);
};

const compareKeys = (left: string[], right: string[]): number =>
  left.reduce((order, part, index) => (order !== 0 ? order : compareCodePoints(part, right[index] ?? "")), 0);

const compareRows = (left: Row, right: Row): number =>
  compareKeys(left.key, right.key) || compareCodePoints(left.currency, right.currency);

const totalsOf = (rows: Row[]): Total[] => {
  const totals = new Map<string, number>();
  rows.forEach((row) => totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.revenueCents));
  return [...totals.entries()]
    .map(([currency, cents]) => ({ currency, cents }))
    .sort((left, right) => compareCodePoints(left.currency, right.currency));
};

// Amounts in different currencies are never added: a row is a key and a currency.
export const aggregate = (lines: readonly OrderLine[], query: Query): Aggregate => {
  const rows = new Map<string, Row>();
  lines
    .filter((line) => passes(line, query))
    .forEach((line) => {
      const key = query.groupBy.map((groupKey) => keyValue(line, groupKey, query.timeZone));
      const { currency } = line.unitPrice;
      const identity = JSON.stringify([...key, currency]);
      const row = rows.get(identity) ?? { key, currency, revenueCents: 0 };
      row.revenueCents += lineRevenueCents(line.unitPrice.cents, line.quantity, line.discountPercent);
      rows.set(identity, row);
    });
  const sorted = [...rows.values()].sort(compareRows);
  return { groupBy: [...query.groupBy], rows: sorted, totals: totalsOf(sorted) };
};
