// Chapter 3: heavy plan generations run in worker threads while other requests stay fast.
import { randomUUID } from 'node:crypto';
import { addDays, bold, call, green, ok, okSynced, show, throwaway, today } from './lib.mjs';

const TASKS = Number(process.argv[2] ?? 300);
const { token } = await throwaway('planner-load');
await ok('PATCH', '/api/user/me', { token, body: { preferences: { sessionMinutes: 25, restMinutes: 5, dailyLimitMinutes: 600, reminders: false, timezone: 'Asia/Ho_Chi_Minh' } } });
const d0 = today();
const ids = [];
for (let i = 0; i < TASKS; i += 25) {
  await Promise.all(Array.from({ length: Math.min(25, TASKS - i) }, (_, k) => {
    const id = randomUUID();
    ids.push(id);
    return ok('POST', '/api/task/tasks', { token, body: { id, title: `Việc ${i + k}`, dueDate: addDays(d0, 5 + ((i + k) % 55)), remainingMinutes: 120 + ((i + k) % 7) * 60 } });
  }));
}
await okSynced('POST', '/api/planning/plans/generate', { token, body: { taskIds: ids } });
console.log(green(`✔ Tài khoản thử có ${TASKS} công việc; planning đã nhận đủ qua sự kiện`));

let stop = false;
const latencies = [];
const probe = (async () => {
  while (!stop) {
    const t = performance.now();
    const r = await call('GET', `/api/planning/study-sessions?from=${d0}&to=${addDays(d0, 1)}`, { token });
    latencies.push([performance.now() - t, r.status]);
  }
})();
const t0 = performance.now();
const runs = await Promise.all(Array.from({ length: 4 }, () =>
  call('POST', '/api/planning/plans/generate', { token, body: {} }).then((r) => ({ status: r.status, ms: performance.now() - t0, slots: r.body?.proposed?.length, by: r.headers.get('x-served-by') }))));
stop = true;
await probe;
const sorted = latencies.map(([ms]) => ms).sort((a, b) => a - b);
console.log(bold('\n4 lần đề xuất kế hoạch chạy song song (mỗi lần trong một worker thread):'));
for (const r of runs) show(`  HTTP ${r.status} từ ${r.by}`, `${Math.round(r.ms)} ms, ${r.slots} phiên`);
console.log(bold('Các request khác tới planning-service trong lúc đó:'));
show('  số request', sorted.length);
show('  p50 / p95 / max', `${Math.round(sorted[sorted.length >> 1])} / ${Math.round(sorted[Math.floor(sorted.length * 0.95)])} / ${Math.round(sorted.at(-1))} ms`);
show('  lỗi', latencies.filter(([, s]) => s !== 200).length);
console.log('  (Nếu thuật toán chạy trên event loop, các request này phải chờ khoảng 1–1.6 s.)');
