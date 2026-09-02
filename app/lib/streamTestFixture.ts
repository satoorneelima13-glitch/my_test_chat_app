// A synthetic chunk source used ONLY by the local streaming test suite, so
// progressive delivery and mid-stream cancellation can be exercised over a
// real local network connection without ever calling Gemini.
//
// Safety: the route handler only reaches this file when the request's model
// is exactly TEST_SYNTHETIC_STREAM_MODEL *and* process.env.NODE_ENV is not
// "production" (checked in app/api/chat/route.ts, not here). A production
// build (`next build && next start`) always has NODE_ENV === "production",
// so this can never activate there regardless of what a client sends. This
// model id is never added to app/lib/models.ts (the real model list); the
// one place the UI exposes it at all is a dev-only <option> in Chat.tsx,
// itself gated by the same NODE_ENV check and compiled out of production
// builds. This file has no server-only imports, so it's safe for Chat.tsx
// (a client component) to import directly.

export const TEST_SYNTHETIC_STREAM_MODEL = "test-synthetic-stream";

const DEFAULT_PARTS = [
  "Hello",
  ", ",
  "this ",
  "is ",
  "a ",
  "synthetic ",
  "streamed ",
  "response.",
];

/**
 * Yields a handful of short text fragments with a real delay between each,
 * so a test can observe the response growing over several distinct reads
 * instead of arriving as one fixed body.
 */
export async function* createSyntheticStream(
  delayMs = 150
): AsyncGenerator<{ text: string }> {
  for (const part of DEFAULT_PARTS) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield { text: part };
  }
}
