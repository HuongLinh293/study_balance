const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD (no timezone shift). */
export const toISODate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = (now = new Date()) => toISODate(now);
export const parseISODate = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (date: string, days: number) => {
  const d = parseISODate(date);
  d.setDate(d.getDate() + days);
  return toISODate(d);
};
/** Monday of the week containing `date`. */
export const startOfWeek = (date: string) =>
  addDays(date, -((parseISODate(date).getDay() + 6) % 7));
export const minutesOfDay = (now = new Date()) =>
  now.getHours() * 60 + now.getMinutes();
export const isValidISODate = (date: unknown): date is string =>
  typeof date === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  toISODate(parseISODate(date)) === date;

const weekdays = [
  "Chủ Nhật",
  "Thứ Hai",
  "Thứ Ba",
  "Thứ Tư",
  "Thứ Năm",
  "Thứ Sáu",
  "Thứ Bảy",
];
export const weekdayName = (date: string) =>
  weekdays[parseISODate(date).getDay()];
/** "24/10" */
export const shortDate = (date: string) =>
  `${date.slice(8)}/${date.slice(5, 7)}`;
/** "24/10/2026" */
export const fullDate = (date: string) => date.split("-").reverse().join("/");
/** "Thứ Bảy, 24 tháng 10" */
export const longDate = (date: string) => {
  const d = parseISODate(date);
  return `${weekdayName(date)}, ${d.getDate()} tháng ${d.getMonth() + 1}`;
};
