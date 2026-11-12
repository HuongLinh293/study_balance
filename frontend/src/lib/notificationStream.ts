import { useEffect, useRef, useState } from "react";
import { openStream } from "./api";
import { parseSse } from "./sse";

const STREAM_PATH = "/api/notification/notifications/stream";
const MAX_DELAY_MS = 30_000;

/**
 * Keeps a server-sent event stream to the notification service open and calls
 * `onChange` whenever the user's notifications change (and once per connect, to
 * catch up on anything missed while disconnected). Reconnects with backoff.
 * Returns whether the stream is currently connected, so polling can stop meanwhile.
 */
export function useNotificationStream(onChange: () => void): boolean {
  const [connected, setConnected] = useState(false);
  const callback = useRef(onChange);
  callback.current = onChange;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
      });

    void (async () => {
      let delay = 1000;
      while (!signal.aborted) {
        try {
          const res = await openStream(STREAM_PATH, signal);
          const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const parsed = parseSse(buffer + value);
            buffer = parsed.rest;
            for (const event of parsed.events) {
              if (event.event === "ready") {
                setConnected(true);
                delay = 1000;
                callback.current();
              } else if (event.event === "notifications") {
                callback.current();
              }
            }
          }
        } catch {
          // Network error, gateway restart, signed out or aborted: fall through to retry.
        }
        setConnected(false);
        if (signal.aborted) break;
        // The server also ends the stream when the access token expires; reconnecting
        // then goes through the normal refresh flow.
        await wait(delay + Math.random() * 500);
        delay = Math.min(delay * 2, MAX_DELAY_MS);
      }
    })();
    return () => controller.abort();
  }, []);

  return connected;
}
