import { expect, test } from "@playwright/test";

test("Game Master identifies and intervenes in review work from a retained Narration trace", async ({ page }) => {
  await page.goto("/gm/campaigns/locked-manor/work");
  await expect(page.getByRole("alert")).toBeFocused();
  await page.getByRole("link", { name: "Select Game Master scope" }).click();
  await expect(page.getByRole("heading", { name: "Game Master workspace" })).toBeFocused();
  await page.getByRole("button", { name: "Select Game Master scope" }).click();

  await expect(page.getByRole("heading", { name: "Game Master work" })).toBeFocused();
  const queue = page.getByRole("region", { name: "Intervention queue" });
  await expect(queue.getByRole("heading", { name: "Ambiguous intent" })).toBeVisible();
  await expect(queue.getByRole("heading", { name: "Invalid proposal" })).toBeVisible();
  await expect(queue.getByRole("heading", { name: "Rule conflict" })).toBeVisible();
  await expect(queue.getByRole("heading", { name: "Ingestion review" })).toBeVisible();
  await expect(queue).toContainText("Mara Vey");
  await expect(queue).toContainText("The Locked Manor");
  await expect(queue).toContainText("12 minutes old");
  await expect(queue).toContainText("evidence:side-door");
  await expect(queue).toContainText("Two supplied rules could govern");
  await expect(page.getByLabel("Command for Rule conflict")).toHaveValue("survey-manor");
  await expect(page.getByLabel("Command for Invalid proposal").locator("option")).not.toHaveCount(0);

  const narration = page.getByRole("region", { name: "Recent retained Narration" });
  await narration.getByRole("link", { name: "Trace outcome" }).click();
  await expect(page.getByRole("heading", { name: "Why this outcome occurred" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Retained Narration" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evidence Bundle" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approved rule and source passages" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Model Call Record" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Actor-authorized command" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Canonical events and random trace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Authoritative projection" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("rawProviderPayload");
  await expect(page.locator("body")).not.toContainText("forbidden private ledger");

  await page.getByRole("link", { name: "Back to intervention queue" }).click();
  await queue.getByRole("button", { name: "Approve Rule conflict" }).click();
  await expect(page.getByRole("status")).toContainText("validated Game Master command was accepted");
  await expect(queue.getByRole("heading", { name: "Rule conflict" }).locator("../..")).toContainText("Committed");

  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false);
});
