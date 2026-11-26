import { checkRecord, type OrderLine, type RawRecord } from "./record.js";
import { formatCents, lineRevenueCents } from "./values.js";

export type GroupBy = "day" | "sku" | "customer";
export type Aggregation = { totals: Map<string, number>; warnings: string[] };

const keyOf = (line: OrderLine, groupBy: GroupBy): string => {
  if (groupBy === "day") return line.orderDate;
  return groupBy === "sku" ? line.sku : line.customerId;
};

const acceptRecord = (record: RawRecord, seen: Set<string>): OrderLine | string => {
  if (record.kind === "problem") return record.problem;
  const checked = checkRecord(record.values);
  if (!checked.ok) return checked.reason;
  const identity = JSON.stringify([checked.line.orderId, checked.line.sku]);
  if (seen.has(identity)) return "duplicate order_id and sku";
  seen.add(identity);
  return checked.line;
};

export const aggregate = (records: RawRecord[], groupBy: GroupBy, input: string): Aggregation => {
  const totals = new Map<string, number>();
  const warnings: string[] = [];
  const seen = new Set<string>();
  records.forEach((record) => {
    const accepted = acceptRecord(record, seen);
    if (typeof accepted === "string") {
      warnings.push(`${input}:${record.location}: ${accepted}`);
      return;
    }
    const key = keyOf(accepted, groupBy);
    const revenue = lineRevenueCents(accepted.unitPriceCents, accepted.quantity, accepted.discountPercent);
    totals.set(key, (totals.get(key) ?? 0) + revenue);
  });
  return { totals, warnings };
};

const codePoints = (text: string): number[] => Array.from(text, (character) => character.codePointAt(0) ?? 0);

export const compareCodePoints = (left: string, right: string): number => {
  const [leftPoints, rightPoints] = [codePoints(left), codePoints(right)];
  const differing = leftPoints.findIndex((point, index) => point !== rightPoints[index]);
  if (differing === -1) return leftPoints.length - rightPoints.length;
  return differing >= rightPoints.length ? 1 : (leftPoints[differing] ?? 0) - (rightPoints[differing] ?? 0);
};

export const render = (totals: Map<string, number>, groupBy: GroupBy): string => {
  const keys = [...totals.keys()].sort(compareCodePoints);
  const grandTotal = [...totals.values()].reduce((sum, cents) => sum + cents, 0);
  const lines = [`${groupBy}\trevenue`, ...keys.map((key) => `${key}\t${formatCents(totals.get(key) ?? 0)}`)];
  lines.push(`TOTAL\t${formatCents(grandTotal)}`, "");
  return lines.join("\n");
};
