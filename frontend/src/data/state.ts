import { addDays, shortDate, todayISO } from "./dates";

export type Page =
  | "today"
  | "tasks"
  | "calendar"
  | "subjects"
  | "simulation"
  | "analytics"
  | "settings";
export type Tone = "pink" | "blue" | "yellow" | "green";
export const tones: { id: Tone; label: string }[] = [
  { id: "pink", label: "Hồng" },
  { id: "blue", label: "Xanh lam" },
  { id: "yellow", label: "Vàng" },
  { id: "green", label: "Xanh lá" },
];
export interface Subject {
  id: string;
  name: string;
  short: string;
  color: Tone;
  teacher: string;
  credits: number;
}
export interface Task {
  id: string;
  title: string;
  /** Subject id, or "" when the task has no subject. */
  subject: string;
  due: string;
  minutes: number;
  priority: "high" | "normal";
  done: boolean;
  note: string;
  steps: string[];
  /** Same order as `steps`. */
  stepsDone: boolean[];
  version: number;
}
export interface Session {
  id: string;
  taskId: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  start: number;
  minutes: number;
  done: boolean;
  actualMinutes?: number;
  version: number;
}
export interface Preferences {
  name: string;
  session: number;
  rest: number;
  limit: number;
  reminders: boolean;
}
export interface StudyWindow {
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  startMinute: number;
  endMinute: number;
}
export interface BusyPeriod {
  source?: "google";
  id: string;
  date: string;
  startMinute: number;
  endMinute: number;
  label: string;
}
export interface Availability {
  version: number;
  windows: StudyWindow[];
  busy: BusyPeriod[];
}
export const WEEKDAYS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"];
/** Snapshot of the signed-in user's data, assembled from the service APIs. */
export interface AppState {
  email: string;
  profileVersion: number;
  availability: Availability;
  subjects: Subject[];
  tasks: Task[];
  sessions: Session[];
  preferences: Preferences;
  note: string;
}
export const DEFAULT_NAME = "bạn";
export const noSubject: Subject = {
  id: "",
  name: "Chưa phân môn",
  short: "Chung",
  color: "blue",
  teacher: "",
  credits: 0,
};
export const subjectFor = (subjects: Subject[], id: string) =>
  subjects.find((s) => s.id === id) ?? noSubject;
/**
 * Minutes per subject, largest first. Rows of deleted subjects resolve to
 * "Chưa phân môn" and are merged into one row instead of repeating it.
 */
export function minutesBySubject(rows: { subjectId: string | null; minutes: number }[], subjects: Subject[]) {
  const totals = new Map<string, { subject: Subject; minutes: number }>();
  for (const row of rows) {
    const subject = row.subjectId ? subjectFor(subjects, row.subjectId) : noSubject;
    const entry = totals.get(subject.id) ?? { subject, minutes: 0 };
    entry.minutes += row.minutes;
    totals.set(subject.id, entry);
  }
  return [...totals.values()].sort((a, b) => b.minutes - a.minutes);
}
export const time = (minutes: number) =>
  `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
export const duration = (minutes: number) =>
  minutes >= 60
    ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}p` : ""}`
    : `${minutes} phút`;
export const dueLabel = (date: string, today = todayISO()) =>
  date === today
    ? "Hôm nay"
    : date === addDays(today, 1)
      ? "Ngày mai"
      : date < today
        ? `Quá hạn ${shortDate(date)}`
        : shortDate(date);
