import { test, expect } from "@playwright/test";

// All /api/chat and /api/feedback calls here are intercepted client-side via
// page.route, so nothing reaches the real route handlers, the real Gemini
// API, or the real feedback.csv file. These tests use FIXED response bodies
// -- fine for protocol-correctness cases (malformed event, missing "done",
// mid-stream error, toggle wiring) but NOT sufficient to prove progressive
// (chunk-by-chunk) delivery or mid-stream cancellation; see
// chat-streaming-local.spec.ts for that, which hits the real dev server's
// synthetic test-fixture stream instead of mocking the route.

const ndjson = (lines: object[]) => lines.map((line) => JSON.stringify(line)).join("\n") + "\n";

test.describe("Chat app streaming (mocked API)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/feedback", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ saved: true }),
      });
    });
  });

  test("streaming toggle is off by default and non-streaming mode is unaffected", async ({ page }) => {
    const requestBodies: Array<{ stream?: boolean }> = [];
    await page.route("**/api/chat", async (route) => {
      requestBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "non-streamed reply" }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByLabel("Stream responses")).not.toBeChecked();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("non-streamed reply")).toBeVisible();
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0].stream).toBe(false);
  });

  test("enabling streaming sends stream:true and renders the assembled text from chunk events", async ({
    page,
  }) => {
    const requestBodies: Array<{ stream?: boolean }> = [];
    await page.route("**/api/chat", async (route) => {
      requestBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "chunk", text: "Hel" },
          { type: "chunk", text: "lo" },
          { type: "done", model: "gemini-3.5-flash" },
        ]),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Stream responses").check();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Hello")).toBeVisible();
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0].stream).toBe(true);
  });

  test("a mid-stream error event preserves partial text and shows a clear status", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "chunk", text: "Partial" },
          { type: "error", message: "Streaming failed. Please try again." },
        ]),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Stream responses").check();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Partial")).toBeVisible();
    await expect(page.getByText("Streaming failed. Please try again.")).toBeVisible();
  });

  test("a stream that ends without a done event preserves partial text and reports the gap", async ({
    page,
  }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([{ type: "chunk", text: "Cut off" }]), // no "done"
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Stream responses").check();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Cut off")).toBeVisible();
    await expect(page.getByText("The response ended unexpectedly before completing.")).toBeVisible();
  });

  test("a malformed event line preserves partial text and shows a clear error", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: '{"type":"chunk","text":"Good"}\nnot valid json\n',
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Stream responses").check();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Good")).toBeVisible();
    await expect(page.getByText("Received a malformed response from the server.")).toBeVisible();
  });

  test("Stop cancels a slow non-streaming request without a fake apology message", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "too late" }),
      });
    });

    await page.goto("/");
    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();

    const stopButton = page.getByRole("button", { name: "Stop" });
    await expect(stopButton).toBeVisible();
    await stopButton.click();

    await expect(page.getByText("Generation stopped.")).toBeVisible();
    await expect(page.getByText("too late")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });

  test("regeneration with streaming enabled resends current settings and completes", async ({ page }) => {
    const bodies: Array<{ settings?: unknown; stream?: boolean }> = [];
    await page.route("**/api/chat", async (route) => {
      const body = route.request().postDataJSON();
      bodies.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "chunk", text: `reply ${bodies.length}` },
          { type: "done", model: "gemini-3.5-flash" },
        ]),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Stream responses").check();
    await page.getByLabel("Top P", { exact: true }).fill("0.6");
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("reply 1")).toBeVisible();

    await page.getByRole("button", { name: "Regenerate response" }).click();
    await expect(page.getByText("reply 2")).toBeVisible();

    expect(bodies).toHaveLength(2);
    expect(bodies[1].stream).toBe(true);
    expect(bodies[1].settings).toEqual({
      temperature: 0.5,
      topP: 0.6,
      frequencyPenalty: 0,
      presencePenalty: 0,
    });
  });

  test("feedback, copy, and edit still work after a streamed response completes", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: ndjson([
          { type: "chunk", text: "an answer" },
          { type: "done", model: "gemini-3.5-flash" },
        ]),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Stream responses").check();
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("an answer")).toBeVisible();

    await page.getByRole("button", { name: "Thumbs up" }).click();
    await expect(page.getByText("Thumbs-up feedback saved to CSV")).toBeVisible();

    await page.getByRole("button", { name: "Edit prompt" }).click();
    await expect(page.getByPlaceholder("Message Gemini")).toHaveValue("Hi");
  });
});
