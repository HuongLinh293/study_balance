import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSse } from "../src/lib/sse";

test("parses complete events and keeps the unfinished tail", () => {
  const { events, rest } = parseSse("retry: 5000\n\nevent: ready\ndata: {}\n\nevent: notif");
  assert.deepEqual(events, [{ event: "ready", data: "{}" }]);
  assert.equal(rest, "event: notif");
});

test("an event split across chunks is parsed once complete", () => {
  let buffer = "";
  const seen: string[] = [];
  for (const chunk of ["event: notifi", "cations\ndata: {", "}\n", "\n"]) {
    const parsed = parseSse(buffer + chunk);
    buffer = parsed.rest;
    seen.push(...parsed.events.map((e) => `${e.event}:${e.data}`));
  }
  assert.deepEqual(seen, ["notifications:{}"]);
});

test("skips heartbeat comments, joins multi-line data, accepts CRLF", () => {
  const { events } = parseSse(": ping\n\ndata: a\r\ndata: b\r\n\r\n");
  assert.deepEqual(events, [{ event: "message", data: "a\nb" }]);
});
