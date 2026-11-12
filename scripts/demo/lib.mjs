// Shared helpers for the demo scripts (run through scripts/demo/demo.sh).
export const BASE = process.env.DEMO_BASE_URL ?? 'https://localhost:8443';
export const MGMT = process.env.RABBITMQ_MGMT_URL ?? 'http://localhost:15672';
export const MGMT_AUTH = Buffer.from(
  `${process.env.RABBITMQ_DEFAULT_USER ?? 'studybalance'}:${process.env.RABBITMQ_DEFAULT_PASS ?? 'local_broker_change_me'}`,
).toString('base64');
export const DEMO = {
  email: process.env.DEMO_EMAIL ?? 'demo@studybalance.dev',
  password: process.env.DEMO_PASSWORD ?? 'StudyBalance2026',
  name: 'Sinh viên Demo',
};
const TZ = 'Asia/Ho_Chi_Minh';
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, body: data, headers: res.headers };
}
export async function ok(method, path, opts) {
  const res = await call(method, path, opts);
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
/** Retries while planning has not received the task events yet. */
export async function okSynced(method, path, opts) {
  for (let i = 0; ; i++) {
    const res = await call(method, path, opts);
    if (res.status === 409 && res.body?.error?.code === 'TASK_NOT_SYNCED' && i < 30) { await sleep(300); continue; }
    if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }
}
export async function demoLogin() {
  const res = await call('POST', '/api/user/auth/login', { body: { email: DEMO.email, password: DEMO.password } });
  if (res.status !== 200) throw new Error(`Không đăng nhập được tài khoản demo (${res.status}); chạy: npm run demo -- seed`);
  return res.body.accessToken;
}
/** A fresh account for experiments that must not touch the demo data. */
export async function throwaway(label) {
  const res = await ok('POST', '/api/user/auth/register', {
    body: { email: `${label}-${Date.now()}@example.test`, password: 'password123', name: label },
  });
  return { token: res.accessToken, userId: res.user.id };
}

const paint = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
export const green = paint('32');
export const red = paint('31');
export const dim = paint('2');
export const bold = paint('1');
export const show = (label, value) => console.log(`  ${dim(label.padEnd(26))} ${value}`);
