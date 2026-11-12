import assert from "node:assert/strict";
import { test } from "node:test";
import { minutesBySubject, noSubject, type Subject } from "../src/data/state";
import { sessionsWithTask } from "../src/lib/studyData";

test("sessions of deleted tasks are not handed to the views", () => {
  const tasks = [{ id: "a" }, { id: "b" }];
  const sessions = [
    { id: "1", taskId: "a" },
    { id: "2", taskId: "deleted" }, // finished session kept as history after its task was deleted
    { id: "3", taskId: "b" },
  ];
  assert.deepEqual(sessionsWithTask(sessions, tasks).map((s) => s.id), ["1", "3"]);
});

test("analytics merges deleted subjects into one 'Chưa phân môn' row, largest first", () => {
  const subjects = [{ ...noSubject, id: "hpt", name: "Hệ phân tán", short: "HPT" } as Subject];
  const rows = minutesBySubject(
    [
      { subjectId: "deleted-1", minutes: 60 },
      { subjectId: "hpt", minutes: 30 },
      { subjectId: "deleted-2", minutes: 40 },
      { subjectId: null, minutes: 10 },
    ],
    subjects,
  );
  assert.deepEqual(rows.map((r) => [r.subject.short, r.minutes]), [["Chung", 110], ["HPT", 30]]);
});
