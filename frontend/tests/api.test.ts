import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { ApiError, api, auth, messageFor, setSignedOutHandler } from "../src/lib/api";

type Call = { method: string; path: string; auth?: string };
let calls: Call[] = [];
let handler: (call: Call) => { status: number; body?: unknown };
const json = (status: number, body?: unknown) => ({ status, body });

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (path: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call = { method: init.method ?? "GET", path, auth: headers.authorization };
    calls.push(call);
    await new Promise((r) => setTimeout(r, 5));
    const { status, body } = handler(call);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
});
const session = (token: string) => json(200, { accessToken: token, user: {} });
const unauth = json(401, { error: { code: "UNAUTHENTICATED", message: "x" } });

test("expired access token is refreshed once and the request retried", async () => {
  let token = "old";
  await (handler = () => session(token), auth.login("a@b.c", "pw"));
  handler = (c) => {
    if (c.path.endsWith("/auth/refresh")) return session((token = "new"));
    return c.auth === "Bearer new" ? json(200, { ok: true }) : unauth;
  };
  const results = await Promise.all([api("GET", "/api/task/tasks"), api("GET", "/api/task/subjects")]);
  assert.deepEqual(results, [{ ok: true }, { ok: true }]);
  // Refresh tokens rotate on use, so concurrent 401s must share one refresh call.
  assert.equal(calls.filter((c) => c.path.endsWith("/auth/refresh")).length, 1);
});
test("failed refresh signs the user out", async () => {
  let signedOut = false;
  setSignedOutHandler(() => (signedOut = true));
  handler = () => unauth;
  await assert.rejects(api("GET", "/api/user/me"), (e: ApiError) => e.code === "UNAUTHENTICATED");
  assert.equal(signedOut, true);
});
test("TASK_NOT_SYNCED is retried until planning has the task", async () => {
  let attempts = 0;
  handler = () =>
    ++attempts < 3 ? json(409, { error: { code: "TASK_NOT_SYNCED", message: "x" } }) : json(201, { id: "s" });
  assert.deepEqual(await api("POST", "/api/planning/study-sessions", {}), { id: "s" });
  assert.equal(attempts, 3);
});
test("errors map to Vietnamese messages", async () => {
  handler = () => json(422, { error: { code: "OUTSIDE_AVAILABILITY", message: "x" } });
  const error = await api("POST", "/x", {}).catch((e) => e);
  assert.match(messageFor(error), /khung giờ học/);
  assert.match(messageFor(new Error("boom")), /Đã có lỗi/);
  globalThis.fetch = (async () => {
    throw new TypeError("offline");
  }) as typeof fetch;
  assert.match(messageFor(await api("GET", "/x").catch((e) => e)), /Không kết nối/);
});
