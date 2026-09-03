import { test, expect } from "@playwright/test";

// Regression coverage for the confirmed-upstream-503 fix: route.ts detects
// ApiError with status 503 and returns a fixed, sanitized message; the UI
// must show that message instead of overwriting it with its own generic
// text. All /api/chat and /api/feedback calls are mocked here -- nothing
// reaches the real route handlers, no Gemini call, no real feedback write.

test.describe("Chat app error handling (mocked API)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/feedback", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ saved: true }),
      });
    });
  });

  test("a sanitized 503 response replaces the send flow's old generic apology text", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "The selected model is temporarily busy. Please try again later.",
        }),
      });
    });

    await page.goto("/");
    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(
      page.getByText("The selected model is temporarily busy. Please try again later.")
    ).toBeVisible();
    await expect(page.getByText("Sorry, I encountered an error. Please try again.")).not.toBeVisible();
  });

  test("a sanitized 400 (provider-rejected setting) shows an actionable message, no raw payload", async ({
    page,
  }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "The selected model rejected one of the provided settings. Try adjusting or clearing a setting and sending again.",
        }),
      });
    });

    await page.goto("/");
    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(
      page.getByText(
        "The selected model rejected one of the provided settings. Try adjusting or clearing a setting and sending again."
      )
    ).toBeVisible();
    await expect(page.getByText("Sorry, I encountered an error. Please try again.")).not.toBeVisible();
  });

  test("a sanitized 503 response shows the same safe message during regeneration", async ({ page }) => {
    let attempt = 0;
    await page.route("**/api/chat", async (route) => {
      attempt += 1;
      if (attempt === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ text: "first answer" }),
        });
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "The selected model is temporarily busy. Please try again later.",
        }),
      });
    });

    await page.goto("/");
    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("first answer")).toBeVisible();

    await page.getByRole("button", { name: "Regenerate response" }).click();

    await expect(
      page.getByText("The selected model is temporarily busy. Please try again later.")
    ).toBeVisible();
    await expect(page.getByText("Response could not be regenerated")).not.toBeVisible();
  });

  test("an unhandled server error still shows a generic, non-raw message", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Failed to generate response" }),
      });
    });

    await page.goto("/");
    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Failed to generate response")).toBeVisible();
  });

  test("a response with no JSON body at all still falls back to a safe generic message", async ({
    page,
  }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({ status: 500, contentType: "text/plain", body: "" });
    });

    await page.goto("/");
    await page.getByPlaceholder("Message Gemini").fill("Hi");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Failed to fetch response")).toBeVisible();
  });
});
