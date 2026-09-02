// Wire format used between the streaming branch of /api/chat and the
// browser: newline-delimited JSON (NDJSON). One StreamEvent per line.
//
// Why not just relay Gemini's own SSE chunks verbatim? So the client only
// ever has to understand one small, versioned shape we control, regardless
// of what the underlying SDK/API does — and so we have a place to put our
// own "done" and "error" events, which the raw SDK stream doesn't provide
// (its async generator either yields chunks or throws; it has no explicit
// "successfully finished" marker for a consumer reading raw bytes).

export type StreamEvent =
  | { type: "chunk"; text: string }
  | { type: "done"; model: string }
  | { type: "error"; message: string };

export function encodeStreamEvent(event: StreamEvent): string {
  return JSON.stringify(event) + "\n";
}

export function isStreamEvent(value: unknown): value is StreamEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.type === "chunk") return typeof v.text === "string";
  if (v.type === "done") return typeof v.model === "string";
  if (v.type === "error") return typeof v.message === "string";
  return false;
}

export interface DrainResult {
  events: StreamEvent[];
  remainder: string;
  /** The raw text of the first line that failed to parse/validate, if any. */
  malformedLine: string | null;
}

/**
 * Pure function: splits a growing text buffer into complete NDJSON lines,
 * parsing each into a StreamEvent. Does not mutate its input. The final,
 * possibly-incomplete line is returned as `remainder` for the caller to
 * prepend to the next chunk of decoded text — this is what makes a logical
 * event correctly reassemble even when the network delivers its bytes (and
 * therefore its line breaks) split across multiple reads.
 *
 * Stops at the first line that isn't valid JSON or doesn't match a known
 * StreamEvent shape: events found before it are still returned, but
 * `malformedLine` is set so the caller treats this as a fatal protocol
 * error rather than silently skipping bad data.
 */
export function drainStreamLines(buffer: string): DrainResult {
  const lines = buffer.split("\n");
  const remainder = lines.pop() ?? "";
  const events: StreamEvent[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { events, remainder, malformedLine: trimmed };
    }

    if (!isStreamEvent(parsed)) {
      return { events, remainder, malformedLine: trimmed };
    }

    events.push(parsed);
  }

  return { events, remainder, malformedLine: null };
}

/**
 * Thrown by the client's stream reader (not by drainStreamLines itself) when
 * the protocol is violated: a malformed line, or the connection closing
 * before a "done" event ever arrived. Carries whatever text had already
 * accumulated so the caller can keep it instead of discarding it.
 */
export class StreamProtocolError extends Error {
  partialText: string;

  constructor(message: string, partialText: string) {
    super(message);
    this.name = "StreamProtocolError";
    this.partialText = partialText;
  }
}
