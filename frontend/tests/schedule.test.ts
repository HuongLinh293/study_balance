import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_NAME, dueLabel, type AppState } from "../src/data/state";
import { closedRanges, firstFreeStart, remainingToSchedule, validateTimebox, viewHours } from "../src/data/schedule";

// Fixed clock: Saturday 24/10/2026, 09:00 local time.
const NOW = new Date(2026, 9, 24, 9, 0);
const TODAY = "2026-10-24";
const TOMORROW = "2026-10-25";

function fixture(): AppState {
  const task = (id: string, due: string, minutes: number, done = false) => ({
    id, title: id, subject: "", due, minutes, priority: "normal" as const, done, note: "", steps: [], version: 1,
  });
  const session = (id: string, taskId: string, date: string, start: number, minutes: number, done = false) => ({
    id, taskId, date, start, minutes, done, version: 1,
  });
  return {
    email: "a@example.com",
    profileVersion: 1,
    availability: {
      version: 1,
      windows: Array.from({ length: 7 }, (_, weekday) => [
        { weekday, startMinute: 480, endMinute: 720 },
        { weekday, startMinute: 790, endMinute: 1080 },
      ]).flat(),
      busy: [{ id: "b", date: TODAY, startMinute: 1020, endMinute: 1080, label: "Họp nhóm" }],
    },
    subjects: [],
    tasks: [task("t1", "2026-10-26", 120), task("t2", "2026-10-27", 60), task("t5", TODAY, 30, true)],
    sessions: [
      session("s0", "t5", TODAY, 480, 30, true),
      session("s1", "t1", TODAY, 540, 50),
      session("s3", "t2", TODAY, 840, 50),
      session("s4", "t1", TOMORROW, 540, 50),
    ],
    preferences: { name: DEFAULT_NAME, session: 50, rest: 10, limit: 240, reminders: true },
    note: "",
  };
}

test("client-side precheck mirrors the planning rules", () => {
  const state = fixture();
  const task = { ...state.tasks[0], id: "new-task", minutes: 50 };
  state.tasks.push(task);
  assert.equal(remainingToSchedule(state, task), 50);
  assert.equal(validateTimebox(state, task, TODAY, 960, 50, NOW), null);
  assert.match(validateTimebox(state, task, TODAY, 550, 50, NOW)!, /trùng/);
  assert.match(validateTimebox(state, task, TODAY, 710, 50, NOW)!, /khung giờ học/);
  assert.match(validateTimebox(state, task, TODAY, 1030, 30, NOW)!, /lịch bận/);
  assert.match(validateTimebox(state, task, TODAY, 500, 30, NOW)!, /đã qua/);
  assert.match(validateTimebox(state, task, "2026-10-23", 900, 30, NOW)!, /ngày đã qua/);
  assert.match(validateTimebox(state, task, "2026-10-27", 900, 30, NOW)!, /deadline/);
});
test("calendar grid and first free slot follow the availability", () => {
  const state = fixture();
  assert.deepEqual(viewHours(state.availability), { from: 8, to: 18, hours: 10 });
  assert.deepEqual(closedRanges(state.availability, TODAY, 480, 1080), [[720, 790]]);
  // 09:00–09:50 is taken (+10 min rest), so the first 50-minute slot today starts at 10:00.
  assert.equal(firstFreeStart(state, TODAY, 50, NOW), 600);
  state.availability.windows.push({ weekday: 5, startMinute: 1140, endMinute: 1320 });
  assert.deepEqual(viewHours(state.availability), { from: 8, to: 22, hours: 14 });
});
test("due labels are relative to today", () => {
  assert.equal(dueLabel(TODAY, TODAY), "Hôm nay");
  assert.equal(dueLabel(TOMORROW, TODAY), "Ngày mai");
  assert.equal(dueLabel("2026-10-20", TODAY), "Quá hạn 20/10");
  assert.equal(dueLabel("2026-11-02", TODAY), "02/11");
});
