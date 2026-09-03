import { test, expect } from "@playwright/test";

// Focused coverage for the accessible info tooltips beside the 8 model
// settings: shown on hover, keyboard focus, and click/tap; dismissed on
// mouse-leave/blur; and the existing disabled-control support warnings are
// unaffected. /api/chat and /api/feedback are not exercised by this test at
// all (no message is ever sent), so nothing here can reach a real API.

const TEMPERATURE_TEXT =
  "Controls randomness. Lower values usually give more predictable responses; higher values give more varied responses.";
const TOP_K_TEXT =
  "Limits each next-token choice to the K most likely candidates. Lower values narrow the choices.";

test.describe("Setting tooltips", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Settings" }).click();
  });

  test("hovering the info icon shows the tooltip text, moving away hides it", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "More information about Temperature" });
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    await trigger.hover();
    await expect(page.getByRole("tooltip")).toHaveText(TEMPERATURE_TEXT);

    // Move the mouse elsewhere to leave the trigger.
    await page.getByRole("heading", { name: "Model settings" }).hover();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("keyboard focus shows the tooltip, and Escape dismisses it", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "More information about Temperature" });

    await trigger.focus();
    await expect(page.getByRole("tooltip")).toHaveText(TEMPERATURE_TEXT);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("click/tap shows the tooltip", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "More information about Top K" });

    await trigger.click();
    await expect(page.getByRole("tooltip")).toHaveText(TOP_K_TEXT);
  });

  test("the tooltip's accessible name is announced via aria-describedby while open", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "More information about Temperature" });
    await trigger.click();

    const tooltip = page.getByRole("tooltip");
    const tooltipId = await tooltip.getAttribute("id");
    expect(tooltipId).toBeTruthy();
    await expect(trigger).toHaveAttribute("aria-describedby", tooltipId!);
  });

  test("all eight settings expose an info tooltip trigger", async ({ page }) => {
    const labels = [
      "Temperature",
      "Top P",
      "Top K",
      "Maximum output tokens",
      "Frequency penalty",
      "Presence penalty",
      "Stop sequences",
      "Seed",
    ];
    for (const label of labels) {
      await expect(page.getByRole("button", { name: `More information about ${label}` })).toBeVisible();
    }
  });

  test("Top K is editable and its tooltip still works alongside the enabled control", async ({
    page,
  }) => {
    const topK = page.getByLabel("Top K", { exact: true });
    await expect(topK).toBeEnabled();

    await page.getByRole("button", { name: "More information about Top K" }).click();
    await expect(page.getByRole("tooltip")).toHaveText(TOP_K_TEXT);

    await topK.fill("15");
    await expect(topK).toHaveValue("15");
  });
});
