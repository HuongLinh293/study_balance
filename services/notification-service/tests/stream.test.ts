import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import { NotificationHub } from '../src/modules/notifications/stream.js';

/** Real HTTP server with one stream route per test; userId comes from the query. */
async function serve(hub: NotificationHub, lifetimeMs = 60_000) {
  const app = express();
  app.get('/stream', (req, res) => hub.open(String(req.query.user), res, Date.now() + lifetimeMs));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}
async function reader(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal });
  const r = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  return {
    res,
    /** Read until `marker` has appeared `times` times in total. */
    async until(marker: string, times = 1) {
      while (text.split(marker).length - 1 < times) {
        const { value, done } = await r.read();
        if (done) throw new Error(`stream ended; got: ${text}`);
        text += value;
      }
      return text;
    },
  };
}
const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(check());
};

test('stream: headers, ready event, publish reaches only that user', async () => {
  const hub = new NotificationHub();
  const srv = await serve(hub);
  const ac = new AbortController();
  try {
    const alice = await reader(`${srv.base}/stream?user=alice`, ac.signal);
    const bob = await reader(`${srv.base}/stream?user=bob`, ac.signal);
    assert.equal(alice.res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    assert.equal(alice.res.headers.get('x-accel-buffering'), 'no');
    await alice.until('event: ready');
    await bob.until('event: ready');
    hub.publish('alice');
    assert.match(await alice.until('event: notifications'), /event: notifications\ndata: \{\}\n\n/);
    hub.publish('bob');
    const bobText = await bob.until('event: notifications');
    assert.equal(bobText.split('event: notifications').length - 1, 1, 'bob only got his own event');
  } finally {
    ac.abort();
    await srv.close();
  }
});

test('stream: heartbeat, closes at token expiry, cleans up connections', async () => {
  const hub = new NotificationHub(20);
  const srv = await serve(hub, 150);
  try {
    const s = await reader(`${srv.base}/stream?user=u`, new AbortController().signal);
    await s.until(': ping', 2);
    assert.equal(hub.connections('u'), 1);
    await assert.rejects(s.until('never-sent'), /stream ended/);
    await waitFor(() => hub.connections('u') === 0);
  } finally {
    await srv.close();
  }
});

test('stream: keeps at most N streams per user (oldest closed)', async () => {
  const hub = new NotificationHub(25_000, 2);
  const srv = await serve(hub);
  const ac = new AbortController();
  try {
    const first = await reader(`${srv.base}/stream?user=u`, ac.signal);
    await first.until('event: ready');
    for (let i = 0; i < 2; i++) await (await reader(`${srv.base}/stream?user=u`, ac.signal)).until('event: ready');
    await assert.rejects(first.until('never-sent'), /stream ended/);
    await waitFor(() => hub.connections('u') === 2);
  } finally {
    ac.abort();
    await srv.close();
  }
});
