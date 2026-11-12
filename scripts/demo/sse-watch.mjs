// Chapter 4: listen on the notification stream as the demo user; a task due
// tomorrow is created after a few seconds (or create one in the UI yourself).
import { randomUUID } from 'node:crypto';
import { BASE, addDays, demoLogin, dim, green, ok, today } from './lib.mjs';

const seconds = Number(process.argv[2] ?? 20);
const token = await demoLogin();
const controller = new AbortController();
setTimeout(() => controller.abort(), seconds * 1000);
const res = await fetch(`${BASE}/api/notification/notifications/stream`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
console.log(dim(`HTTP ${res.status} ${res.headers.get('content-type')} — nghe trong ${seconds} s`));
let createdAt = 0;
setTimeout(async () => {
  createdAt = Date.now();
  await ok('POST', '/api/task/tasks', { token, body: { id: randomUUID(), title: `Nộp bài demo SSE ${new Date().toLocaleTimeString('vi-VN')}`, dueDate: addDays(today(), 1), remainingMinutes: 30 } });
  console.log(dim(`→ ${new Date().toLocaleTimeString('vi-VN')} đã tạo công việc hạn ngày mai qua API`));
}, 3000);
try {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const line of value.split('\n').filter(Boolean)) {
      const extra = line === 'event: notifications' && createdAt ? green(`  ← ${Date.now() - createdAt} ms sau khi tạo`) : '';
      console.log(`${dim(new Date().toLocaleTimeString('vi-VN'))}  ${line}${extra}`);
    }
  }
} catch (error) {
  if (error.name !== 'AbortError') throw error;
}
