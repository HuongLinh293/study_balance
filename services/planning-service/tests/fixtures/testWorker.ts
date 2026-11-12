// Worker for pool tests: behaviour chosen by the input.
import { parentPort } from 'node:worker_threads';

parentPort!.on('message', ({ id, input }: { id: number; input: { value?: number; sleepMs?: number; hang?: boolean; crash?: boolean; fail?: string } }) => {
  if (input.crash) process.exit(3);
  if (input.hang) for (;;);
  if (input.sleepMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, input.sleepMs);
  if (input.fail) return parentPort!.postMessage({ id, ok: false, error: input.fail });
  parentPort!.postMessage({ id, ok: true, result: (input.value ?? 0) * 2 });
});
