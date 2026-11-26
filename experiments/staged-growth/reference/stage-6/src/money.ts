import { formatCents } from "./values.js";

export type Money = { cents: number; currency: string };

export const DEFAULT_CURRENCY = "USD";
const CURRENCY = /^[A-Z]{3}$/;

// An empty currency is USD; anything else must be three uppercase letters.
export const parseCurrency = (text: string): string | null => {
  if (text === "") return DEFAULT_CURRENCY;
  return CURRENCY.test(text) ? text : null;
};

// USD amounts are written as before, so the outputs of an all-USD input do not change.
export const formatMoney = (cents: number, currency: string): string =>
  currency === DEFAULT_CURRENCY ? formatCents(cents) : `${formatCents(cents)} ${currency}`;
