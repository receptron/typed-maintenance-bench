import type { Aggregate } from "./aggregate.js";
import { formatCents } from "./values.js";
import { isoWeek } from "./week.js";

export type CustomerReport = { fileName: string; content: string };

const KEPT = /^[A-Za-z0-9_-]$/;
const HEX_DIGITS = 2;

// Every UTF-8 byte outside A-Z a-z 0-9 - _ becomes %XX, so no id can name a path outside the directory.
export const fileNameFor = (customerId: string): string =>
  `${Array.from(customerId, (character) =>
    KEPT.test(character)
      ? character
      : Array.from(
          new TextEncoder().encode(character),
          (byte) => `%${byte.toString(16).toUpperCase().padStart(HEX_DIGITS, "0")}`,
        ).join(""),
  ).join("")}.txt`;

const weekTotals = (days: { day: string; cents: number }[]): Map<string, number> =>
  days.reduce(
    (weeks, { day, cents }) => weeks.set(isoWeek(day), (weeks.get(isoWeek(day)) ?? 0) + cents),
    new Map<string, number>(),
  );

const contentFor = (customerId: string, days: { day: string; cents: number }[]): string => {
  const weeks = [...weekTotals(days).entries()].sort(([left], [right]) => (left < right ? -1 : 1));
  const total = weeks.reduce((sum, [, cents]) => sum + cents, 0);
  const lines = [
    `customer\t${customerId}`,
    "week\trevenue",
    ...weeks.map(([week, cents]) => `${week}\t${formatCents(cents)}`),
  ];
  return [...lines, `TOTAL\t${formatCents(total)}`, ""].join("\n");
};

// Expects an aggregate grouped by customer, then day.
export const customerReports = (byCustomerDay: Aggregate): CustomerReport[] => {
  const customers = new Map<string, { day: string; cents: number }[]>();
  byCustomerDay.rows.forEach(({ key: [customer = "", day = ""], revenueCents }) =>
    customers.set(customer, [...(customers.get(customer) ?? []), { day, cents: revenueCents }]),
  );
  return [...customers.entries()].map(([customer, days]) => ({
    fileName: fileNameFor(customer),
    content: contentFor(customer, days),
  }));
};
