import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setAccessToken, type Profile } from "./api";
import { useNotificationStream } from "./notificationStream";
import { useBrowserNotifications } from "./browserNotifications";
import { addDays, todayISO } from "../data/dates";
import type {
  AppState,
  Availability,
  BusyPeriod,
  Preferences,
  StudyWindow,
  Session,
  Subject,
  Task,
} from "../data/state";

/* Wire formats of the services (see docs/api/README.md). */
interface ApiTask {
  id: string;
  title: string;
  subjectId: string | null;
  dueDate: string;
  remainingMinutes: number;
  priority: "high" | "normal";
  done: boolean;
  note: string;
  steps: string[];
  stepsDone?: boolean[];
  version: number;
}
export interface ApiSession {
  id: string;
  taskId: string;
  date: string;
  startMinute: number;
  minutes: number;
  status: "planned" | "done";
  actualMinutes: number | null;
  version: number;
}
export interface Notification {
  id: string;
  kind: "deadline" | "plan" | "session";
  taskId: string | null;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}
export interface Simulation {
  id: string;
  status: "preview" | "applied" | "stale";
  busy: { date: string; startMinute: number; endMinute: number; label: string };
  changed: ApiSession[];
  moved: ApiSession[];
  unscheduled: (ApiSession & { reason: "deadline" | "no_time" })[];
  feasible: boolean;
}
export interface PlanProposal {
  id: string;
  status: "preview" | "applied" | "stale";
  today: string;
  proposed: ApiSession[];
  shortfalls: { taskId: string; dueDate: string; neededMinutes: number; missingMinutes: number }[];
  neededMinutes: number;
  placedMinutes: number;
}
export interface Summary {
  labels: string[];
  values: number[];
  current: number;
  totalMinutes: number;
  streak: number;
  completedTasks: number;
  totalTasks: number;
  bySubject: { subjectId: string | null; minutes: number }[];
  /** Planned vs actual minutes of sessions finished in the period; ratio null without data. */
  estimate: { sessions: number; plannedMinutes: number; actualMinutes: number; ratio: number | null };
  /** Finished tasks (all time) done by their deadline, and open tasks already past it. */
  deadlines: { finished: number; onTime: number; overdue: number };
}

const toTask = (t: ApiTask): Task => ({
  id: t.id,
  title: t.title,
  subject: t.subjectId ?? "",
  due: t.dueDate,
  minutes: t.remainingMinutes,
  priority: t.priority,
  done: t.done,
  note: t.note,
  steps: t.steps,
  stepsDone: t.steps.map((_, i) => t.stepsDone?.[i] ?? false),
  version: t.version,
});
/**
 * Finished sessions are kept as history when their task is deleted, and a session
 * can arrive before the task list refetches. Views look every session's task up,
 * so only sessions whose task is loaded are shown (statistics come from the server).
 */
export const sessionsWithTask = <S extends { taskId: string }>(sessions: S[], tasks: { id: string }[]) => {
  const known = new Set(tasks.map((t) => t.id));
  return sessions.filter((s) => known.has(s.taskId));
};
const toSession = (s: ApiSession): Session => ({
  id: s.id,
  taskId: s.taskId,
  date: s.date,
  start: s.startMinute,
  minutes: s.minutes,
  done: s.status === "done",
  actualMinutes: s.actualMinutes ?? undefined,
  version: s.version,
});
const toPreferences = (p: Profile): Preferences => ({
  name: p.name,
  session: p.preferences.sessionMinutes,
  rest: p.preferences.restMinutes,
  limit: p.preferences.dailyLimitMinutes,
  reminders: p.preferences.reminders,
});

/** Sessions loaded around today: 5 weeks back for history, ~8 weeks ahead for planning. */
const sessionRange = () => {
  const today = todayISO();
  return { from: addDays(today, -35), to: addDays(today, 57) };
};
async function allTasks() {
  const items: ApiTask[] = [];
  for (let offset: number | null = 0; offset !== null; ) {
    const page: { items: ApiTask[]; nextOffset: number | null } = await api(
      "GET",
      `/api/task/tasks?status=all&limit=500&offset=${offset}`,
    );
    items.push(...page.items);
    offset = page.nextOffset;
  }
  return items;
}

export const keys = {
  me: ["me"],
  availability: ["availability"],
  subjects: ["subjects"],
  tasks: ["tasks"],
  sessions: ["sessions"],
  notifications: ["notifications"],
  summary: (period: string) => ["summary", period],
};

export function useStudyData() {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: keys.me,
    queryFn: () => api<Profile>("GET", "/api/user/me"),
  });
  const availability = useQuery({
    queryKey: keys.availability,
    refetchInterval: 60_000,
    queryFn: () => api<Availability>("GET", "/api/user/me/availability"),
  });
  const subjects = useQuery({
    queryKey: keys.subjects,
    queryFn: async () =>
      (await api<{ items: Subject[] }>("GET", "/api/task/subjects")).items,
  });
  const tasks = useQuery({ queryKey: keys.tasks, queryFn: allTasks });
  const sessions = useQuery({
    queryKey: keys.sessions,
    queryFn: async () => {
      const { from, to } = sessionRange();
      return (
        await api<{ items: ApiSession[] }>(
          "GET",
          `/api/planning/study-sessions?from=${from}&to=${to}`,
        )
      ).items;
    },
  });
  // Pushed by the notification service; polling is only the fallback while the stream is down.
  const streaming = useNotificationStream(
    () => void client.invalidateQueries({ queryKey: keys.notifications }),
  );
  const notifications = useQuery({
    queryKey: keys.notifications,
    queryFn: () =>
      api<{ items: Notification[]; unreadCount: number }>(
        "GET",
        "/api/notification/notifications",
      ),
    refetchInterval: streaming ? false : 60_000,
  });
  useBrowserNotifications(notifications.data?.items, me.data?.preferences.reminders ?? true);

  const state = useMemo<AppState | null>(() => {
    if (!me.data || !availability.data || !subjects.data || !tasks.data || !sessions.data)
      return null;
    return {
      email: me.data.email,
      profileVersion: me.data.version,
      availability: availability.data,
      subjects: subjects.data,
      tasks: tasks.data.map(toTask),
      sessions: sessionsWithTask(sessions.data, tasks.data).map(toSession),
      preferences: toPreferences(me.data),
      note: me.data.note,
    };
  }, [me.data, availability.data, subjects.data, tasks.data, sessions.data]);
  const error = me.error ?? availability.error ?? subjects.error ?? tasks.error ?? sessions.error;

  /** Events reach other services asynchronously; refetch derived views shortly after writes. */
  const refresh = (...queryKeys: string[][]) => {
    for (const key of queryKeys) void client.invalidateQueries({ queryKey: key });
    setTimeout(() => {
      void client.invalidateQueries({ queryKey: keys.notifications });
      void client.invalidateQueries({ queryKey: ["summary"] });
    }, 800);
  };
  const taskBody = (t: Task) => ({
    title: t.title,
    subjectId: t.subject || null,
    dueDate: t.due,
    remainingMinutes: t.minutes,
    priority: t.priority,
    note: t.note,
    steps: t.steps,
  });

  const actions = {
    async saveTask(task: Task, existing?: Task) {
      if (existing)
        await api("PATCH", `/api/task/tasks/${task.id}`, {
          version: existing.version,
          ...taskBody(task),
        });
      else
        await api("POST", "/api/task/tasks", { id: task.id, ...taskBody(task) });
      refresh(keys.tasks);
    },
    async setTaskDone(task: Task, done: boolean) {
      await api("PATCH", `/api/task/tasks/${task.id}`, {
        version: task.version,
        done,
      });
      refresh(keys.tasks);
    },
    async deleteTask(id: string) {
      await api("DELETE", `/api/task/tasks/${id}`);
      refresh(keys.tasks);
      // Planning cancels the task's planned sessions after TaskDeleted arrives.
      setTimeout(
        () => void client.invalidateQueries({ queryKey: keys.sessions }),
        800,
      );
    },
    async toggleStep(task: Task, index: number, done: boolean) {
      await api("PATCH", `/api/task/tasks/${task.id}/steps/${index}`, {
        version: task.version,
        done,
      });
      refresh(keys.tasks);
    },
    async saveSubject(subject: Subject, isNew: boolean) {
      const body = {
        name: subject.name,
        short: subject.short,
        color: subject.color,
        teacher: subject.teacher,
        credits: subject.credits,
      };
      if (isNew)
        await api("POST", "/api/task/subjects", { id: subject.id, ...body });
      else await api("PATCH", `/api/task/subjects/${subject.id}`, body);
      refresh(keys.subjects);
    },
    async deleteSubject(id: string) {
      await api("DELETE", `/api/task/subjects/${id}`);
      refresh(keys.subjects, keys.tasks);
    },
    async saveSession(session: Session, existing?: Session) {
      if (existing)
        await api("PATCH", `/api/planning/study-sessions/${session.id}`, {
          version: existing.version,
          date: session.date,
          startMinute: session.start,
          minutes: session.minutes,
        });
      else
        await api("POST", "/api/planning/study-sessions", {
          id: session.id,
          taskId: session.taskId,
          date: session.date,
          startMinute: session.start,
          minutes: session.minutes,
        });
      refresh(keys.sessions);
    },
    async removeSession(id: string) {
      await api("DELETE", `/api/planning/study-sessions/${id}`);
      refresh(keys.sessions);
    },
    /**
     * Two explicit steps (spec §9): Planning records the time, then Task
     * reduces the remaining minutes. Both are idempotent per session, so the
     * second step is retried; if it still fails the recorded time is kept.
     */
    async finishSession(session: Session, minutes: number) {
      await api("POST", `/api/planning/study-sessions/${session.id}/finish`, {
        actualMinutes: minutes,
      });
      refresh(keys.sessions);
      for (let attempt = 1; ; attempt++) {
        try {
          await api("PATCH", `/api/task/tasks/${session.taskId}/progress`, {
            minutes,
            sessionId: session.id,
          });
          break;
        } catch (error) {
          if (attempt >= 3) throw new ProgressNotSavedError();
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      refresh(keys.tasks, ["progress", session.taskId]);
    },
    async saveProfile(input: {
      name?: string;
      note?: string;
      preferences?: Preferences;
    }) {
      const p = input.preferences;
      await api("PATCH", "/api/user/me", {
        name: input.name,
        note: input.note,
        preferences: p && {
          sessionMinutes: p.session,
          restMinutes: p.rest,
          dailyLimitMinutes: p.limit,
          reminders: p.reminders,
        },
      });
      refresh(keys.me);
    },
    async saveWindows(windows: StudyWindow[], version: number) {
      await api("PUT", "/api/user/me/availability", { version, windows });
      refresh(keys.availability);
    },
    async addBusy(busy: Omit<BusyPeriod, "id">) {
      await api("POST", "/api/user/me/busy-periods", { id: crypto.randomUUID(), ...busy });
      refresh(keys.availability);
    },
    async removeBusy(id: string) {
      await api("DELETE", `/api/user/me/busy-periods/${id}`);
      refresh(keys.availability);
    },
    async changePassword(currentPassword: string, newPassword: string) {
      // Other devices are signed out; this browser receives a fresh session.
      const data = await api<{ accessToken: string }>("POST", "/api/user/auth/change-password", {
        currentPassword,
        newPassword,
      });
      setAccessToken(data.accessToken);
    },
    /** Applies the time of a finished session that has not reduced the task yet. */
    async applyProgress(session: Session) {
      await api("PATCH", `/api/task/tasks/${session.taskId}/progress`, {
        minutes: session.actualMinutes ?? session.minutes,
        sessionId: session.id,
      });
      refresh(keys.tasks, ["progress", session.taskId]);
    },
    async readAllNotifications() {
      await api("POST", "/api/notification/notifications/read-all");
      void client.invalidateQueries({ queryKey: keys.notifications });
    },
    /** After a conflict: drop local copies and load the latest data. */
    reload() {
      void client.invalidateQueries();
    },
  };
  return { state, error, notifications: notifications.data, actions };
}
export class ProgressNotSavedError extends Error {}

export const simulationsApi = {
  preview: (
    input:
      | { scenario: "afternoon" | "whole" }
      | { date: string; startMinute: number; endMinute: number; label: string },
  ) => api<Simulation>("POST", "/api/planning/simulations", input),
  apply: (id: string, dropUnscheduled = false) =>
    api<Simulation>("POST", `/api/planning/simulations/${id}/apply`, { dropUnscheduled }),
};
export const plansApi = {
  generate: (taskIds: string[]) => api<PlanProposal>("POST", "/api/planning/plans/generate", { taskIds }),
  apply: (id: string) => api<PlanProposal>("POST", `/api/planning/plans/${id}/apply`),
};
export const fetchProgress = (taskId: string) =>
  api<{ items: { sessionId: string | null; minutes: number }[] }>("GET", `/api/task/tasks/${taskId}/progress`);
export const fetchSummary = (period: "week" | "month") =>
  api<Summary>("GET", `/api/analytics/analytics/summary?period=${period}`);
