import type { AvailabilityWindow } from '@studybalance/event-contracts';

/** 08:00–12:00 and 13:10–18:00 every day: the plan the app used before availability was configurable. */
export const DEFAULT_WINDOWS: AvailabilityWindow[] = Array.from({ length: 7 }, (_, weekday) => [
  { weekday, startMinute: 8 * 60, endMinute: 12 * 60 },
  { weekday, startMinute: 13 * 60 + 10, endMinute: 18 * 60 },
]).flat();
