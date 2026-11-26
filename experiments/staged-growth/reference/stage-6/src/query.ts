import { isCalendarDate } from "./values.js";

export const GROUP_KEYS = ["day", "sku", "customer"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];
export type Query = {
  groupBy: GroupKey[];
  from: string | null;
  to: string | null;
  skuPrefix: string;
  timeZone: string;
};

const MAX_GROUP_KEYS = 3;

export const isGroupKey = (value: unknown): value is GroupKey => GROUP_KEYS.some((key) => key === value);

export const groupByProblem = (keys: readonly unknown[]): string | null => {
  if (keys.length === 0 || keys.length > MAX_GROUP_KEYS) return "group-by needs one to three keys";
  if (!keys.every(isGroupKey)) return "group-by keys must be day, sku or customer";
  return new Set(keys).size === keys.length ? null : "group-by keys must be distinct";
};

export const dateProblem = (name: string, value: string | null): string | null =>
  value === null || isCalendarDate(value) ? null : `${name} ${value} is not a calendar date`;

// YYYY-MM-DD strings compare in calendar order.
export const rangeProblem = (from: string | null, to: string | null): string | null =>
  dateProblem("from", from) ??
  dateProblem("to", to) ??
  (from !== null && to !== null && from > to ? "from is later than to" : null);
