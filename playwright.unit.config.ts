import { defineConfig } from "@playwright/test";

// Pure-function tests only: no browser, no dev server. Kept in a separate
// config from playwright.config.ts (the browser-based UI suite) so running
// these never triggers a browser download check or a dev server start.
export default defineConfig({
  testDir: "./tests/unit",
  reporter: "list",
  // Fresh folder for this run (streamProtocol tests added) — keeps the
  // earlier "./test-results-unit" evidence from the settings/config tests
  // untouched, per instruction to preserve prior artifacts.
  outputDir: "./test-results-unit-streaming",
});
