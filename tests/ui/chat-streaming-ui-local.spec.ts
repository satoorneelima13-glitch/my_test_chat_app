import { test, expect } from "@playwright/test";

// Drives the REAL chat UI (real <select>, real Send button, real
// handleSubmit/setMessageContent React state updates) against the local
// synthetic-stream fixture in route.ts -- no page.route interception of
// /api/chat, no page.evaluate(fetch(...)) bypassing React, and no call to
// Gemini. /api/feedback is still mocked since it's unrelated to this test
// and we don't want a real write to feedback.csv.
//
// The "Test: synthetic stream (dev only)" <option> only exists in the model
// dropdown when NODE_ENV !== "production" (see Chat.tsx and
// app/lib/streamTestFixture.ts), so this test only works against a dev
// server, and is compiled out of / inert in a production build.
//
// This is the test that actually answers "does partial text show up in the
// DOM before the full response does" -- chat-streaming-local.spec.ts proved
// the server relay is genuinely progressive over the network; this proves
// that progressiveness is visible through the real component tree.

const TEST_SYNTHETIC_STREAM_MODEL = "test-synthetic-stream";
const FULL_TEXT = "Hello, this is a synthetic streamed response.";

test.describe("Real chat UI streaming (local synthetic fixture, no Gemini call)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/feedback", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ saved: true }),
      });
    });
  });

  test("partial text is visible in the DOM before the full response completes", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel("Select Gemini model").selectOption(TEST_SYNTHETIC_STREAM_MODEL);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Stream responses").check();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByPlaceholder("Message Gemini").fill("hi");
    await page.getByRole("button", { name: "Send" }).click();

    // The first fragment ("Hello") should render well before the full
    // sentence does -- proving the DOM updates progressively, not in one
    // shot once the whole answer is ready.
    const messageText = page.getByText(/^Hello/);
    await expect(messageText).toBeVisible({ timeout: 2000 });
    await expect(messageText).not.toHaveText(FULL_TEXT);

    // Eventually the full response does complete.
    await expect(page.getByText(FULL_TEXT)).toBeVisible({ timeout: 3000 });
  });

  test("Stop mid-stream, through the real button, preserves partial text", async ({ page }) => {
    await page.goto("/");

    await page.getByLabel("Select Gemini model").selectOption(TEST_SYNTHETIC_STREAM_MODEL);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Stream responses").check();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByPlaceholder("Message Gemini").fill("hi");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(/^Hello/)).toBeVisible({ timeout: 2000 });
    await page.getByRole("button", { name: "Stop" }).click();

    await expect(page.getByText("Generation stopped.")).toBeVisible();
    await expect(page.getByText(FULL_TEXT)).not.toBeVisible();

    // Whatever text had already streamed in stays -- not wiped, not
    // replaced with a generic error message.
    await expect(page.getByText(/^Hello/)).toBeVisible();
  });
});
