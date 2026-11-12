/** One server-sent event (https://html.spec.whatwg.org/multipage/server-sent-events.html). */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Splits buffered stream text into complete events. Returns the unfinished
 * tail, to be prefixed to the next chunk. Comment lines (": ping") are skipped.
 */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const blocks = buffer.replace(/\r\n?/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    let hasField = false;
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") {
        event = value;
        hasField = true;
      } else if (field === "data") {
        data.push(value);
        hasField = true;
      }
    }
    if (hasField) events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}
