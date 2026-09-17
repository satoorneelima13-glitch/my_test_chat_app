import { test, expect } from "@playwright/test";

// Exercises the REAL /api/chat streaming relay over a real local network
// connection -- no page.route interception here, and no Gemini call: the
// request uses the reserved TEST_SYNTHETIC_STREAM_MODEL sentinel (see
// app/lib/streamTestFixture.ts), which app/api/chat/route.ts only serves
// when NODE_ENV !== "production" (always true for `next dev`, always false
// for a production build/start, regardless of what a client sends). This is
// what proves genuine progressive (chunk-by-chunk, time-separated) delivery
// and real mid-stream cancellation/resource cleanup -- a fixed-body
// page.route mock (see chat-streaming.spec.ts) cannot prove either, since it
// always delivers its whole body in one piece.
//
// This drives fetch() directly in the page context rather than through the
// chat UI, because the UI's model selector intentionally only offers the
// three real Gemini models -- the sentinel is not selectable there by
// design (see app/lib/models.ts), so there is no user-facing path that
// could ever hit it by accident. Chat-UI-level wiring (the toggle, Stop
// button, status text, partial-text rendering) is covered separately in
// chat-streaming.spec.ts.

const TEST_SYNTHETIC_STREAM_MODEL = "test-synthetic-stream";
const FULL_TEXT = "Hello, this is a synthetic streamed response.";

test.describe("Real streaming relay (local synthetic fixture, no Gemini call)", () => {
  test("delivers chunks progressively over time, not as one fixed body", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async (model) => {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hi" }],
          model,
          stream: true,
        }),
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const readTimestamps: number[] = [];
      let text = "";
      let buffer = "";
      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        readTimestamps.push(Date.now());
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "chunk") text += event.text;
          if (event.type === "done") done = true;
        }
      }
      return { text, readCount: readTimestamps.length, readTimestamps };
    }, TEST_SYNTHETIC_STREAM_MODEL);

    expect(result.text).toBe(FULL_TEXT);
    // Several distinct network reads, not one -- proves the bytes actually
    // arrived over multiple separate deliveries rather than a single body.
    expect(result.readCount).toBeGreaterThanOrEqual(4);
    const gaps = result.readTimestamps.slice(1).map((t, i) => t - result.readTimestamps[i]);
    expect(gaps.some((gap) => gap > 50)).toBe(true);
  });

  test("aborting mid-stream stops delivery and keeps only the partial text received so far", async ({
    page,
  }) => {
    await page.goto("/");

    const result = await page.evaluate(async (model) => {
      const controller = new AbortController();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "hi" }],
          model,
          stream: true,
        }),
        signal: controller.signal,
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      let buffer = "";
      let chunkCount = 0;
      let aborted = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === "chunk") {
              text += event.text;
              chunkCount += 1;
              if (chunkCount === 3) controller.abort();
            }
          }
        }
      } catch (error) {
        aborted = error instanceof DOMException && error.name === "AbortError";
      }
      return { text, chunkCount, aborted };
    }, TEST_SYNTHETIC_STREAM_MODEL);

    expect(result.aborted).toBe(true);
    expect(result.chunkCount).toBe(3);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text.length).toBeLessThan(FULL_TEXT.length);
    expect(FULL_TEXT.startsWith(result.text)).toBe(true);
  });
});

// Note on the NODE_ENV production guard: route.ts checks
// `process.env.NODE_ENV !== "production"` fresh on every request before
// looking at the sentinel model id at all. That can't be exercised here
// without rebuilding/restarting the dev server as a production build, which
// is out of scope for this local test run -- it's a static code guarantee
// (visible in app/api/chat/route.ts), not something this suite re-verifies.
