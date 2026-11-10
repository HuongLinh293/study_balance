import test from "node:test";
import assert from "node:assert/strict";
import { applyAndSaveBusy, createSaveLock } from "../src/lib/saveFlow";

test("repeated submit is rejected immediately; completion permits retry", async () => {
  const lock = createSaveLock();
  let calls = 0;
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const submit = async () => {
    if (!lock.acquire()) return;
    try { calls++; await pending; } finally { lock.release(); }
  };
  const first = submit();
  await submit();
  assert.equal(calls, 1);
  assert.equal(lock.locked, true);
  finish();
  await first;
  await submit();
  assert.equal(calls, 2);
  assert.equal(lock.locked, false);
});

test("busy save failure reports partial success after applying exactly once", async () => {
  const calls: string[] = [];
  const complete = await applyAndSaveBusy(
    async () => { calls.push("apply"); },
    async () => { calls.push("busy"); return false; },
  );
  assert.equal(complete, false);
  assert.deepEqual(calls, ["apply", "busy"]);
});

test("a thrown busy save error still reports partial success", async () => {
  assert.equal(await applyAndSaveBusy(async () => {}, async () => {
    throw new Error("offline");
  }), false);
});

test("failed plan application never saves busy or reports partial success", async () => {
  let savedBusy = false;
  await assert.rejects(applyAndSaveBusy(
    async () => { throw new Error("stale plan"); },
    async () => { savedBusy = true; return true; },
  ), /stale plan/);
  assert.equal(savedBusy, false);
});

test("successful or unrequested busy persistence completes the operation", async () => {
  assert.equal(await applyAndSaveBusy(async () => {}, async () => true), true);
  assert.equal(await applyAndSaveBusy(async () => {}), true);
});
