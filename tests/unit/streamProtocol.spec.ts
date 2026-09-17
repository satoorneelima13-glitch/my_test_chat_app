import { test, expect } from "@playwright/test";
import { drainStreamLines, encodeStreamEvent, isStreamEvent } from "../../app/lib/streamProtocol";

test.describe("encodeStreamEvent / isStreamEvent", () => {
  test("encodes each event type as one JSON line ending in a newline", () => {
    expect(encodeStreamEvent({ type: "chunk", text: "hi" })).toBe('{"type":"chunk","text":"hi"}\n');
    expect(encodeStreamEvent({ type: "done", model: "m" })).toBe('{"type":"done","model":"m"}\n');
    expect(encodeStreamEvent({ type: "error", message: "oops" })).toBe(
      '{"type":"error","message":"oops"}\n'
    );
  });

  test("round-trips unicode text without mangling it", () => {
    const event = { type: "chunk" as const, text: "héllo 🎉 — em dash" };
    const line = encodeStreamEvent(event);
    expect(JSON.parse(line.trim())).toEqual(event);
  });

  test("rejects shapes that are missing their required field or have the wrong type", () => {
    expect(isStreamEvent({ type: "chunk", text: "ok" })).toBe(true);
    expect(isStreamEvent({ type: "chunk" })).toBe(false);
    expect(isStreamEvent({ type: "chunk", text: 5 })).toBe(false);
    expect(isStreamEvent({ type: "done" })).toBe(false);
    expect(isStreamEvent({ type: "error" })).toBe(false);
    expect(isStreamEvent({ type: "unknown" })).toBe(false);
    expect(isStreamEvent(null)).toBe(false);
    expect(isStreamEvent("chunk")).toBe(false);
  });
});

test.describe("drainStreamLines", () => {
  test("parses multiple complete lines from one buffer", () => {
    const buffer =
      encodeStreamEvent({ type: "chunk", text: "Hel" }) +
      encodeStreamEvent({ type: "chunk", text: "lo" }) +
      encodeStreamEvent({ type: "done", model: "gemini-3.5-flash" });

    const result = drainStreamLines(buffer);
    expect(result.malformedLine).toBeNull();
    expect(result.remainder).toBe("");
    expect(result.events).toEqual([
      { type: "chunk", text: "Hel" },
      { type: "chunk", text: "lo" },
      { type: "done", model: "gemini-3.5-flash" },
    ]);
  });

  test("holds back an incomplete trailing line and completes it on the next call", () => {
    const first = drainStreamLines('{"type":"chunk","text":"Hel"}\n{"type":"chunk","te');
    expect(first.events).toEqual([{ type: "chunk", text: "Hel" }]);
    expect(first.malformedLine).toBeNull();
    expect(first.remainder).toBe('{"type":"chunk","te');

    const second = drainStreamLines(first.remainder + 'xt":"lo"}\n');
    expect(second.events).toEqual([{ type: "chunk", text: "lo" }]);
    expect(second.remainder).toBe("");
  });

  test("ignores blank lines", () => {
    const buffer = "\n\n" + encodeStreamEvent({ type: "chunk", text: "x" }) + "\n";
    const result = drainStreamLines(buffer);
    expect(result.events).toEqual([{ type: "chunk", text: "x" }]);
  });

  test("flags invalid JSON as a malformed line, keeping events found before it", () => {
    const buffer = encodeStreamEvent({ type: "chunk", text: "ok" }) + "not json\n" + '{"type":"done"';
    const result = drainStreamLines(buffer);
    expect(result.events).toEqual([{ type: "chunk", text: "ok" }]);
    expect(result.malformedLine).toBe("not json");
  });

  test("flags valid JSON that doesn't match a known event shape as malformed", () => {
    const buffer = '{"hello":"world"}\n';
    const result = drainStreamLines(buffer);
    expect(result.events).toEqual([]);
    expect(result.malformedLine).toBe('{"hello":"world"}');
  });
});
