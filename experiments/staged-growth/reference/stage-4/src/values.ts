const PRICE_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;
const QUANTITY_PATTERN = /^\d+$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CENTS_PER_UNIT = 100;
const FULL_PERCENT = 100;
const MONTHS_IN_YEAR = 12;

const fractionCents = (fraction: string | undefined): number => Number((fraction ?? "").padEnd(2, "0"));

export const parseCents = (text: string): number | null => {
  const match = PRICE_PATTERN.exec(text);
  if (match === null) return null;
  return Number(match[1]) * CENTS_PER_UNIT + fractionCents(match[2]);
};

export const parseDiscountPercent = (text: string): number | null => {
  if (text === "") return 0;
  const percent = parseCents(text);
  return percent !== null && percent <= FULL_PERCENT ? percent : null;
};

export const parseQuantity = (text: string): number | null => {
  if (!QUANTITY_PATTERN.test(text)) return null;
  const quantity = Number(text);
  return quantity >= 1 ? quantity : null;
};

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

export const isCalendarDate = (text: string): boolean => {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return month >= 1 && month <= MONTHS_IN_YEAR && day >= 1 && day <= daysInMonth(year, month);
};

export const lineRevenueCents = (unitPriceCents: number, quantity: number, discountPercent: number): number => {
  const scaled = unitPriceCents * quantity * (FULL_PERCENT - discountPercent);
  return Math.floor((scaled + FULL_PERCENT / 2) / FULL_PERCENT);
};

export const formatCents = (cents: number): string =>
  `${Math.floor(cents / CENTS_PER_UNIT)}.${String(cents % CENTS_PER_UNIT).padStart(2, "0")}`;
