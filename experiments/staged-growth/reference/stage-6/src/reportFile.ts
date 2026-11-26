import type { Aggregate } from "./aggregate.js";
import { compareCodePoints } from "./aggregate.js";
import { formatMoney } from "./money.js";
import { isoWeek } from "./week.js";

export type CustomerReport = { fileName: string; content: string };
type Amount = { week: string; currency: string; cents: number };

const KEPT = /^[A-Za-z0-9_-]$/;
const HEX_DIGITS = 2;

const percentEncoded = (character: string): string =>
  Array.from(
    new TextEncoder().encode(character),
    (byte) => `%${byte.toString(16).toUpperCase().padStart(HEX_DIGITS, "0")}`,
  ).join("");

// Every UTF-8 byte outside A-Z a-z 0-9 - _ becomes %XX, so no id can name a path outside the directory.
export const fileNameFor = (customerId: string): string =>
  `${Array.from(customerId, (character) => (KEPT.test(character) ? character : percentEncoded(character))).join("")}.txt`;

const sumBy = (amounts: Amount[], identity: (amount: Amount) => string): Amount[] => {
  const sums = new Map<string, Amount>();
  amounts.forEach((amount) => {
    const sum = sums.get(identity(amount)) ?? { ...amount, cents: 0 };
    sums.set(identity(amount), { ...sum, cents: sum.cents + amount.cents });
  });
  return [...sums.values()];
};

const byWeekThenCurrency = (left: Amount, right: Amount): number =>
  compareCodePoints(left.week, right.week) || compareCodePoints(left.currency, right.currency);

const contentFor = (customerId: string, amounts: Amount[]): string => {
  const weeks = sumBy(amounts, (amount) => JSON.stringify([amount.week, amount.currency])).sort(byWeekThenCurrency);
  const totals = sumBy(amounts, (amount) => amount.currency).sort((left, right) =>
    compareCodePoints(left.currency, right.currency),
  );
  return [
    `customer\t${customerId}`,
    "week\trevenue",
    ...weeks.map((amount) => `${amount.week}\t${formatMoney(amount.cents, amount.currency)}`),
    ...totals.map((total) => `TOTAL\t${formatMoney(total.cents, total.currency)}`),
    "",
  ].join("\n");
};

// Expects an aggregate grouped by customer, then day.
export const customerReports = (byCustomerDay: Aggregate): CustomerReport[] => {
  const customers = new Map<string, Amount[]>();
  byCustomerDay.rows.forEach(({ key: [customer = "", day = ""], currency, revenueCents }) =>
    customers.set(customer, [
      ...(customers.get(customer) ?? []),
      { week: isoWeek(day), currency, cents: revenueCents },
    ]),
  );
  return [...customers.entries()].map(([customer, amounts]) => ({
    fileName: fileNameFor(customer),
    content: contentFor(customer, amounts),
  }));
};
