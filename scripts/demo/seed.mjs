// Creates (or resets) the demo account with subjects, tasks, a generated plan
// and one finished session, so every screen has something to show.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DEMO, addDays, call, green, ok, okSynced, show, today } from './lib.mjs';

let token;
const reg = await call('POST', '/api/user/auth/register', { body: DEMO });
if (reg.status === 201) {
  token = reg.body.accessToken;
  console.log(green('✔ Đã tạo tài khoản demo'));
} else {
  const login = await ok('POST', '/api/user/auth/login', { body: { email: DEMO.email, password: DEMO.password } });
  token = login.accessToken;
  // Reset straight in the databases (development only). Deleting tasks through the API
  // would keep finished sessions as history, and every reset would pile up orphan
  // sessions and statistics. The account, preferences and availability stay.
  const id = login.user.id;
  const wipe = [
    'task_db.tasks', 'task_db.subjects',
    'planning_db.study_sessions', 'planning_db.task_projection', 'planning_db.plan_proposals', 'planning_db.simulations',
    'notification_db.notifications', 'notification_db.task_projection', 'notification_db.session_projection',
    'analytics_db.session_facts', 'analytics_db.task_facts', 'user_db.busy_periods',
  ].map((table) => `DELETE FROM ${table} WHERE user_id = '${id}';`).join(' ');
  execFileSync('docker', ['compose', 'exec', '-T', 'mysql', 'sh', '-c', `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "${wipe}"`], { stdio: 'inherit' });
  console.log(green('✔ Đã xóa sạch dữ liệu demo cũ ở 5 database'));
}

// A realistic student week: weekday evenings, weekend mornings, at most 150 min/day.
// The large project then does not fit before its deadline → the plan reports a shortfall.
await ok('PATCH', '/api/user/me', {
  token,
  body: { preferences: { sessionMinutes: 50, restMinutes: 10, dailyLimitMinutes: 150, reminders: true, timezone: 'Asia/Ho_Chi_Minh' } },
});
const windows = [];
for (let weekday = 0; weekday < 7; weekday++) {
  windows.push(weekday < 5 ? { weekday, startMinute: 18 * 60 + 30, endMinute: 21 * 60 + 30 } : { weekday, startMinute: 8 * 60, endMinute: 11 * 60 + 30 });
}
await ok('PUT', '/api/user/me/availability', { token, body: { windows } });
console.log(green('✔ Lịch rảnh: tối T2–T6 18:30–21:30, sáng T7–CN 08:00–11:30; tối đa 150 phút/ngày'));
// Planning learns about these through PreferencesUpdated / AvailabilityUpdated.
await new Promise((r) => setTimeout(r, 1500));

const d0 = today();
const subjects = [
  { id: randomUUID(), name: 'Hệ phân tán', short: 'HPT', color: 'pink', teacher: 'TS. Nguyễn Văn A', credits: 3 },
  { id: randomUUID(), name: 'Cơ sở dữ liệu', short: 'CSDL', color: 'yellow', teacher: 'ThS. Trần Thị B', credits: 3 },
  { id: randomUUID(), name: 'Mạng máy tính', short: 'MMT', color: 'blue', teacher: 'TS. Lê Văn C', credits: 3 },
];
for (const s of subjects) await ok('POST', '/api/task/subjects', { token, body: s });
const [hpt, csdl, mmt] = subjects.map((s) => s.id);
const tasks = [
  { subjectId: mmt, title: 'Bài tập chia subnet', due: 1, minutes: 120, priority: 'high', steps: ['Đọc lại CIDR', 'Làm 10 câu', 'Nộp trên LMS'] },
  { subjectId: hpt, title: 'Đọc chương 6: Đồng bộ hóa', due: 2, minutes: 60 },
  { subjectId: csdl, title: 'Báo cáo chuẩn hóa 3NF', due: 3, minutes: 240, priority: 'high', steps: ['Vẽ ERD', 'Tách bảng', 'Viết báo cáo'] },
  { subjectId: hpt, title: 'Bài tập đồng hồ Lamport', due: 4, minutes: 90 },
  { subjectId: csdl, title: 'Ôn thi giữa kỳ CSDL', due: 5, minutes: 180 },
  { subjectId: mmt, title: 'Lab Wireshark', due: 6, minutes: 90 },
  { subjectId: hpt, title: 'Đồ án microservice', due: 12, minutes: 1500, priority: 'high', steps: ['Thiết kế kiến trúc', 'Cài đặt service', 'Kiểm thử chịu lỗi', 'Viết báo cáo'] },
];
const ids = [];
for (const t of tasks) {
  const id = randomUUID();
  ids.push(id);
  await ok('POST', '/api/task/tasks', {
    token,
    body: { id, subjectId: t.subjectId, title: t.title, dueDate: addDays(d0, t.due), remainingMinutes: t.minutes, priority: t.priority ?? 'normal', steps: t.steps ?? [] },
  });
}
console.log(green(`✔ ${subjects.length} môn, ${tasks.length} công việc`));

const proposal = await okSynced('POST', '/api/planning/plans/generate', { token, body: { taskIds: ids } });
await ok('POST', `/api/planning/plans/${proposal.id}/apply`, { token });
console.log(green(`✔ Đã xếp ${proposal.proposed.length} phiên học (${proposal.placedMinutes}/${proposal.neededMinutes} phút)`));
for (const s of proposal.shortfalls) show('  thiếu thời gian', `${tasks[ids.indexOf(s.taskId)].title}: thiếu ${s.missingMinutes} phút`);

// One finished session so "Nhìn lại" has data (finish, then record progress like the UI does).
const first = proposal.proposed[0];
if (first) {
  await ok('POST', `/api/planning/study-sessions/${first.id}/finish`, { token, body: { actualMinutes: first.minutes + 10 } });
  await ok('PATCH', `/api/task/tasks/${first.taskId}/progress`, { token, body: { minutes: first.minutes + 10, sessionId: first.id } });
  console.log(green('✔ Đã ghi 1 phiên học thực tế (dài hơn dự kiến 10 phút)'));
}
// One session last evening that was never studied, so "Cứu kế hoạch" on the Today page has
// something to rescue. The API refuses past dates, so it is moved in the database (development only).
const missed = proposal.proposed.filter((s) => s.taskId === ids[4]).sort((a, b) => b.minutes - a.minutes)[0];
if (missed) {
  const sql = `UPDATE planning_db.study_sessions SET date = '${addDays(d0, -1)}', start_minute = ${19 * 60 + 30} WHERE id = '${missed.id}';`;
  execFileSync('docker', ['compose', 'exec', '-T', 'mysql', 'sh', '-c', `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "${sql}"`], { stdio: 'inherit' });
  console.log(green(`✔ 1 phiên tối qua bị lỡ (${tasks[4].title}, ${missed.minutes} phút) cho phần Cứu kế hoạch`));
}
show('Đăng nhập', `${DEMO.email} / ${DEMO.password}`);
