import { expect, test } from "@playwright/test";

test("a new Player recovers from setup error and completes the arrival Scene", async ({
  page,
}) => {
  await page.goto("/player/adventures/locked-manor");

  await expect(
    page.getByRole("heading", { name: "Enter the locked manor" }),
  ).toBeFocused();
  await page.getByLabel("Player Character name").fill("Mara Vey");
  await page.getByLabel("Pronouns").fill("she/her");
  await page
    .getByLabel("Motivation")
    .fill("Find her missing sister");
  await page.getByLabel("Might +0").check();
  await page.getByLabel("Wits +0").check();
  await page.getByLabel("Presence +0").check();
  await page.getByRole("button", { name: "Create Player Character" }).click();

  const setupError = page.getByRole("alert");
  await expect(setupError).toBeFocused();
  await expect(setupError).toContainText(
    "Assign +0, +1, and +2 exactly once, then submit again.",
  );
  await expect(page.getByLabel("Player Character name")).toHaveValue("Mara Vey");

  await page.getByLabel("Wits +2").check();
  await page.getByLabel("Presence +1").check();
  await page.getByRole("button", { name: "Create Player Character" }).click();
  await page.getByRole("button", { name: "Begin Adventure" }).click();

  await expect(page.getByRole("heading", { name: "Arrival" })).toBeVisible();
  await page.getByRole("button", { name: "Survey the manor grounds" }).click();
  await expect(page.getByRole("region", { name: "Scene ledger" })).toContainText(
    "Fresh footprints lead from the manor gate",
  );

  await page
    .getByRole("button", { name: "Ask whether someone is inside the manor" })
    .click();
  await expect(page.getByRole("group", { name: "Confirm Likelihood" })).toBeFocused();
  await page.getByLabel("Likely — 75% Yes").check();
  await page.getByRole("button", { name: "Ask the Oracle" }).click();
  await expect(page.getByRole("region", { name: "Scene ledger" })).toContainText(
    "Yes (24 ≤ 75)",
  );

  await page.getByRole("button", { name: "Pick the side-door lock" }).click();
  await expect(page.getByRole("heading", { name: "Check Proposal" })).toBeVisible();
  await expect(page.getByText("The lock stays shut and the attempt alerts the manor."))
    .toBeVisible();
  await page.getByRole("button", { name: "Confirm and roll" }).click();

  await expect(page.getByRole("group", { name: "Resolve the Check" })).toBeFocused();
  await expect(page.getByText("3 + 4 + Wits 2 = 9")).toBeVisible();
  await page.getByRole("button", { name: "Decline Resolve" }).click();

  await expect(page.getByRole("heading", { name: "Discovery" })).toBeVisible();
  await expect(page.getByText("Committed", { exact: true }).last()).toBeVisible();
  await page.getByText("Inspect mechanic and evidence").last().click();
  await expect(page.getByText("micro-ruleset.check@1.0.0").last()).toBeVisible();
  await expect(page.getByText(/^Evidence Bundle: evidence:/).last()).toBeVisible();
  await expect(page.getByText("Health 3 of 3")).toBeVisible();
  await expect(page.getByText("Resolve 3 of 3")).toBeVisible();
  await expect(page.getByText("None active")).toBeVisible();
  await expect(page.getByText("None established")).toBeVisible();
  await expect(page.getByText("Deterministic summary").last()).toBeVisible();
  await expect(page.getByText("Narration unavailable").last()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("streamId");

  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByRole("heading", { name: "Discovery" })).toBeVisible();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
  const sceneTop = await page.locator(".scene-workspace").evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  const folioTop = await page.locator(".folio").evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(folioTop).toBeGreaterThan(sceneTop);
});

test("a local Player session never inherits another browser's Adventure", async ({
  browser,
}) => {
  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  await firstPage.goto("/player/adventures/locked-manor");
  await firstPage.getByLabel("Player Character name").fill("Mara Vey");
  await firstPage.getByLabel("Pronouns").fill("she/her");
  await firstPage.getByLabel("Motivation").fill("Find her missing sister");
  await firstPage.getByRole("button", { name: "Create Player Character" }).click();

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto("/player/adventures/locked-manor");
  await expect(
    secondPage.getByRole("heading", { name: "Enter the locked manor" }),
  ).toBeVisible();

  await firstContext.close();
  await secondContext.close();
});

test("an Adventure load failure offers an explicit retry", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/player/adventures/locked-manor", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto("/player/adventures/locked-manor");
  await expect(page.getByRole("alert")).toBeFocused();
  await page.getByRole("button", { name: "Retry opening Adventure" }).click();
  await expect(
    page.getByRole("heading", { name: "Enter the locked manor" }),
  ).toBeVisible();
});
