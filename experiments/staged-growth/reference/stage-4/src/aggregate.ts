import type { GroupKey, Query } from "./query.js";
import type { OrderLine } from "./record.js";
import { lineRevenueCents } from "./values.js";

export type Row = { key: string[]; revenueCents: number };
export type Aggregate = { groupBy: GroupKey[]; rows: Row[]; totalCents: number };

const keyValue = (line: OrderLine, key: GroupKey): string => {
  if (key === "day") return line.orderDate;
  return key === "sku" ? line.sku : line.customerId;
};

const passes = (line: OrderLine, query: Query): boolean =>
  (query.from === null || line.orderDate >= query.from) &&
  (query.to === null || line.orderDate <= query.to) &&
  line.sku.startsWith(query.skuPrefix);

const codePoints = (text: string): number[] => Array.from(text, (character) => character.codePointAt(0) ?? 0);

export const compareCodePoints = (left: string, right: string): number => {
  const [leftPoints, rightPoints] = [codePoints(left), codePoints(right)];
  const differing = leftPoints.findIndex((point, index) => point !== rightPoints[index]);
  if (differing === -1) return leftPoints.length - rightPoints.length;
  return differing >= rightPoints.length ? 1 : (leftPoints[differing] ?? 0) - (rightPoints[differing] ?? 0);
};

const compareKeys = (left: string[], right: string[]): number =>
  left.reduce((order, part, index) => (order !== 0 ? order : compareCodePoints(part, right[index] ?? "")), 0);

export const aggregate = (lines: readonly OrderLine[], query: Query): Aggregate => {
  const rows = new Map<string, Row>();
  lines
    .filter((line) => passes(line, query))
    .forEach((line) => {
      const key = query.groupBy.map((groupKey) => keyValue(line, groupKey));
      const row = rows.get(JSON.stringify(key)) ?? { key, revenueCents: 0 };
      row.revenueCents += lineRevenueCents(line.unitPriceCents, line.quantity, line.discountPercent);
      rows.set(JSON.stringify(key), row);
    });
  const sorted = [...rows.values()].sort((left, right) => compareKeys(left.key, right.key));
  return {
    groupBy: [...query.groupBy],
    rows: sorted,
    totalCents: sorted.reduce((sum, row) => sum + row.revenueCents, 0),
  };
};
