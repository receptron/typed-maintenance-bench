import { isCalendarDate } from "./values.js";

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;
export const DEFAULT_TIME_ZONE = "UTC";

const within = (text: string | undefined, max: number): boolean => text === undefined || Number(text) <= max;

// Milliseconds since the epoch, or null when the text is not a timestamp with Z or an offset.
export const parseTimestamp = (text: string): number | null => {
  const match = TIMESTAMP.exec(text);
  if (match === null) return null;
  const [, date = "", hour, minute, second, sign, offsetHour, offsetMinute] = match;
  if (!isCalendarDate(date) || ![hour, offsetHour].every((part) => within(part, MAX_HOUR))) return null;
  if (![minute, second, offsetMinute].every((part) => within(part, MAX_MINUTE))) return null;
  const local = Date.parse(`${date}T${hour}:${minute}:${second ?? "00"}Z`);
  const offsetMinutes = Number(offsetHour ?? 0) * MINUTES_PER_HOUR + Number(offsetMinute ?? 0);
  return local - (sign === "-" ? -1 : 1) * offsetMinutes * MS_PER_MINUTE;
};

export const isOrderDate = (text: string): boolean => isCalendarDate(text) || parseTimestamp(text) !== null;

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  formatters.set(timeZone, created);
  return created;
};

export const isTimeZone = (name: string): boolean => {
  try {
    formatterFor(name);
    return true;
  } catch {
    return false;
  }
};

const partOf = (parts: Intl.DateTimeFormatPart[], type: string): string =>
  parts.find((part) => part.type === type)?.value ?? "";

// A plain date is its own day in every zone; a timestamp's day is its calendar date in timeZone.
export const dayIn = (orderDate: string, timeZone: string): string => {
  const instant = parseTimestamp(orderDate);
  if (instant === null) return orderDate;
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  return `${partOf(parts, "year")}-${partOf(parts, "month")}-${partOf(parts, "day")}`;
};
