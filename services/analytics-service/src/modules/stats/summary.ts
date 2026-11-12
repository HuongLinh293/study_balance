import { addDays, weekdayIndex } from '@studybalance/service-kit';

export type Period = 'week' | 'month';

/** Date range covered by a period containing `date` (week = Monday–Sunday). */
export function periodRange(period: Period, date: string) {
  if (period === 'week') {
    const from = addDays(date, -weekdayIndex(date));
    return { from, to: addDays(from, 6) };
  }
  const from = `${date.slice(0, 8)}01`;
  return { from, to: addDays(addDays(from, 32).slice(0, 8) + '01', -1) };
}
/** Chart buckets: 7 weekdays, or month split into days 1–7, 8–14, … */
export function chart(period: Period, date: string, byDate: Map<string, number>) {
  const { from, to } = periodRange(period, date);
  if (period === 'week') {
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    return {
      labels: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'],
      values: days.map((d) => byDate.get(d) ?? 0),
      current: weekdayIndex(date),
    };
  }
  const daysInMonth = Number(to.slice(8));
  const values = Array.from({ length: Math.ceil(daysInMonth / 7) }, () => 0);
  for (let day = 1; day <= daysInMonth; day++) {
    values[Math.floor((day - 1) / 7)] += byDate.get(`${from.slice(0, 8)}${String(day).padStart(2, '0')}`) ?? 0;
  }
  return { labels: values.map((_, i) => `Tuần ${i + 1}`), values, current: Math.floor((Number(date.slice(8)) - 1) / 7) };
}
/** How much longer (ratio > 1) or shorter than planned sessions actually took; null without data. */
export function estimateRatio(plannedMinutes: number, actualMinutes: number) {
  return plannedMinutes > 0 ? Math.round((actualMinutes / plannedMinutes) * 100) / 100 : null;
}
/** Days of history read to count the streak. */
export const STREAK_LOOKBACK_DAYS = 400;
/** Consecutive study days ending today, or yesterday when today has no study yet. */
export function streak(today: string, studied: Set<string>) {
  let day = studied.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (studied.has(day)) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}
