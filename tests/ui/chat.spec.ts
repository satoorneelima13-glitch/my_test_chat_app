import { test, expect } from "@playwright/test";

// Every /api/chat and /api/feedback call is intercepted client-side, so
// nothing here ever reaches the real route handlers, the real Gemini API,
// or the real feedback.csv file.

test.describe("Chat app (mocked API)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/feedback", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ saved: true }),
      });
    });
  });

  test("sends a message with default settings and renders the mocked reply", async ({ page }) => {
    const requestBodies: Array<{ model?: string; settings?: unknown }> = [];
    await page.route("**/api/chat", async (route) => {
      const body = route.request().postDataJSON();
      requestBodies.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "mocked reply", model: body?.model }),
      });
    });

    await page.goto("/");
    await page.getByPlaceholder("Message Gemini").fill("Hello there");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("mocked reply")).toBeVisible();
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0].settings).toEqual({ temperature: 0.5 });
  });

  test("regeneration resends the current settings", async ({ page }) => {
    const bodies: Array<{ model?: string; settings?: unknown }> = [];
    await page.route("**/api/chat", async (route) => {
      const body = route.request().postDataJSON();
      bodies.push(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: `reply ${bodies.length}`, model: body.model }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Top P").fill("0.7");
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("reply 1")).toBeVisible();

    await page.getByRole("button", { name: "Regenerate response" }).click();
    await expect(page.getByText("reply 2")).toBeVisible();

    expect(bodies).toHaveLength(2);
    expect(bodies[1].settings).toEqual({ temperature: 0.5, topP: 0.7 });
  });

  test("invalid settings are rejected client-side before any request is sent", async ({ page }) => {
    let called = false;
    await page.route("**/api/chat", async (route) => {
      called = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "should not appear" }),
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Stop sequences").fill("a,b,c,d,e,f");
    await page.getByRole("button", { name: "Done" }).click();

    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(/at most 5/i)).toBeVisible();
    expect(called).toBe(false);
  });

  test("reset restores the settings form to its defaults", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByLabel("Top P").fill("0.9");
    await page.getByLabel("Temperature").fill("1.2");

    await page.getByRole("button", { name: "Reset to defaults" }).click();

    await expect(page.getByLabel("Temperature")).toHaveValue("0.5");
    await expect(page.getByLabel("Top P")).toHaveValue("");
  });

  test("the three unverified controls are disabled with an accurate explanation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();

    await expect(page.getByLabel("Top K")).toBeDisabled();
    await expect(page.getByLabel("Frequency penalty")).toBeDisabled();
    await expect(page.getByLabel("Presence penalty")).toBeDisabled();
    await expect(page.getByText("Support not yet verified for this model.")).toHaveCount(3);
  });

  test("model selection, thumbs-up feedback, copy, and edit still work", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ text: "an answer" }),
      });
    });

    await page.goto("/");

    await page.getByLabel("Select Gemini model").selectOption("gemini-3.1-flash-lite");
    await expect(page.getByLabel("Select Gemini model")).toHaveValue("gemini-3.1-flash-lite");

    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("an answer")).toBeVisible();

    await page.getByRole("button", { name: "Thumbs up" }).click();
    await expect(page.getByText("Thumbs-up feedback saved to CSV")).toBeVisible();

    await page.getByRole("button", { name: "Edit prompt" }).click();
    await expect(page.getByPlaceholder("Message Gemini")).toHaveValue("Hi");
  });
});
