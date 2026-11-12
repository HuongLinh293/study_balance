// Prints log lines of every container that contain a pattern, merged and sorted by time.
//   node scripts/demo/logs.mjs <pattern> [service…]
import { execFileSync } from 'node:child_process';
import { dim } from './lib.mjs';

const [pattern, ...services] = process.argv.slice(2);
const raw = execFileSync('docker', ['compose', 'logs', '--no-log-prefix', '--since', '30m', ...services], { encoding: 'utf8', maxBuffer: 64 << 20 });
const lines = raw.split('\n').filter((l) => l.includes(pattern)).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
lines.sort((a, b) => a.ts.localeCompare(b.ts));
for (const j of lines) {
  const what = j.eventType ?? `${j.method} ${j.path} → ${j.status}`;
  console.log(`  ${dim(j.ts.slice(11, 23))}  ${j.service.padEnd(22)} ${j.event.padEnd(24)} ${what}`);
}
if (!lines.length) console.log('  (không có dòng log nào)');
