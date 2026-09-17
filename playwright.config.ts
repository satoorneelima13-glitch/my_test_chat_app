import { defineConfig, devices } from "@playwright/test";

// UI suite: exercises the real app in a real browser. Most specs mock
// /api/chat and /api/feedback client-side via page.route, so those requests
// never reach the real route handlers and no real Gemini call or feedback
// write happens. chat-streaming-local.spec.ts is the one exception: it hits
// the real /api/chat with a reserved sentinel model that route.ts serves
// from a local synthetic fixture (never Gemini) — see that file's header
// comment for why a fixed-body mock can't substitute for it.
export default defineConfig({
  testDir: "./tests/ui",
  reporter: "list",
  // Fresh folder for this run (real-UI progressive-rendering test added) —
  // keeps "./test-results" (missing-browser failure), "./test-results-chrome"
  // (prior passing run), and "./test-results-streaming" (prior streaming
  // run) evidence untouched.
  outputDir: "./test-results-streaming-uilocal",
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    // A dev server for this project is commonly already running on 3000;
    // Next.js refuses to start a second instance for the same project dir
    // even on a different port, so we target 3000 and reuse it if present.
    command: "npm run dev -- --hostname 127.0.0.1",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    // Uses the system-installed Chrome via its CDP channel instead of a
    // Playwright-managed browser binary, so no download/install is needed.
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  ],
});
