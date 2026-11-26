const DAYS_PER_WEEK = 7;
const THURSDAY = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEK_DIGITS = 2;

// ISO 8601: weeks start on Monday, and week 1 is the one holding the year's first Thursday.
export const isoWeek = (date: string): string => {
  const [year, month, day] = date.split("-").map(Number);
  const time = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  const weekday = new Date(time).getUTCDay() || DAYS_PER_WEEK;
  const thursday = new Date(time + (THURSDAY - weekday) * MS_PER_DAY);
  const weekYear = thursday.getUTCFullYear();
  const dayOfYear = (thursday.getTime() - Date.UTC(weekYear, 0, 1)) / MS_PER_DAY;
  const week = Math.floor(dayOfYear / DAYS_PER_WEEK) + 1;
  return `${weekYear}-W${String(week).padStart(WEEK_DIGITS, "0")}`;
};
