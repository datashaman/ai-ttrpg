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

test("Natural Language Play confirms an evidenced action before it enters the ledger", async ({ page }) => {
  const evidence = {
    id: "rule:micro-ruleset.check@1.0.0",
    sourceKind: "authority-rule",
    sourceReference: "rule-package:micro-ruleset@1.0.0:checksum",
    content: "Roll 2d6 and add the relevant Trait.",
    inclusionReason: "This exact approved rule governs the interpreted Check.",
    citation: "micro-ruleset@1.0.0#checks.procedure",
  };
  let projection = {
    id: "locked-manor",
    title: "The Locked Manor",
    playerCharacter: {
      name: "Mara Vey",
      pronouns: "she/her",
      motivation: "Find her missing sister",
      traits: { Might: 0, Wits: 2, Presence: 1 },
      health: 3,
      resolve: 3,
      inventory: [],
    },
    activeScene: { id: "arrival", title: "Arrival" },
    conditions: [],
    clocks: [],
    relationships: [],
    availableActions: [
      { id: "force-side-door", label: "Force the side door", kind: "Check" },
    ],
    pendingCheckProposal: null,
    pendingChoice: null,
    oracleConfirmation: null,
    ledger: [] as Record<string, unknown>[],
    inputMode: "structured",
    naturalLanguage: {
      available: true,
      pendingProposal: null as Record<string, unknown> | null,
      response: null,
    },
  };
  await page.route("**/api/player/adventures/locked-manor**", async (route) => {
    const request = route.request();
    if (request.url().endsWith("/presentations")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (request.method() === "GET") {
      await route.fulfill({ json: projection });
      return;
    }
    const command = request.postDataJSON() as { type: string; mode?: string; proposalId?: string };
    if (command.type === "set-input-mode") {
      projection = { ...projection, inputMode: command.mode ?? "structured" };
    }
    if (command.type === "submit-natural-language") {
      projection = {
        ...projection,
        inputMode: "natural-language",
        naturalLanguage: {
          ...projection.naturalLanguage,
          pendingProposal: {
            id: "proposal:1",
            utterance: "I force the side door.",
            actionLabel: "Force the side door",
            command: { type: "choose-action", actionId: "force-side-door" },
            modelCallIds: ["model-call:1"],
            evidenceBundleIds: ["evidence:1"],
            bundleItemIds: [evidence.id],
            citedEvidenceItemIds: [evidence.id],
            ruleIds: [evidence.id],
            evidence: [evidence],
          },
        },
      };
    }
    if (command.type === "confirm-natural-language-command") {
      projection = {
        ...projection,
        naturalLanguage: { ...projection.naturalLanguage, pendingProposal: null },
        ledger: [{
          id: "event:1",
          status: "Committed",
          action: "Force the side door",
          presentation: "Deterministic summary",
          narrationStatus: "Unavailable",
          inputMode: "Natural Language Play",
          interpretation: {
            modelCallIds: ["model-call:1"],
            evidenceBundleIds: ["evidence:1"],
            bundleItemIds: [evidence.id],
            citedEvidenceItemIds: [evidence.id],
            ruleIds: [evidence.id],
            evidence: [evidence],
          },
          summary: "The side door gives way.",
          mechanic: {
            ruleReference: "micro-ruleset.check@1.0.0",
            calculation: "3 + 4 + Might 0 = 7",
            evidenceBundle: { id: "evidence:1", references: [evidence.sourceReference] },
          },
        }],
      };
    }
    await route.fulfill({
      json: {
        status: "accepted",
        message: "Accepted.",
        projection,
        canonicalCommand: null,
        canonicalEventTypes: [],
        canonicalEvents: [],
      },
    });
  });

  await page.goto("/player/adventures/locked-manor");
  await page.getByRole("button", { name: "Natural Language Play" }).click();
  await expect(page.getByRole("region", { name: "Scene ledger" })).toContainText(
    "Your committed outcomes will gather here.",
  );
  await page.getByLabel("Describe an action or ask a rules question").fill(
    "I force the side door.",
  );
  await page.getByRole("button", { name: "Interpret input" }).click();

  const confirmation = page.getByRole("region", { name: "Confirm interpreted action" });
  await expect(confirmation).toContainText("No Adventure event has been committed yet.");
  await confirmation.getByText("Inspect interpretation evidence").click();
  await expect(confirmation).toContainText("micro-ruleset@1.0.0#checks.procedure");
  await expect(confirmation).toContainText("model-call:1");
  await confirmation.getByRole("button", { name: "Confirm interpreted action" }).click();

  const ledger = page.getByRole("region", { name: "Scene ledger" });
  await expect(ledger).toContainText("The side door gives way.");
  await expect(ledger).toContainText("Chosen through Natural Language Play");
});

test("interrupted Narration preserves the committed outcome and can be retried", async ({ page }) => {
  let streamFails = true;
  let streamRequests = 0;
  const entry = {
    id: "event:survey",
    status: "Committed",
    action: "Survey the manor grounds",
    presentation: "Deterministic summary",
    narrationStatus: "Unavailable",
    inputMode: "Structured Play",
    interpretation: null,
    summary: "Fresh footprints lead from the manor gate toward the side door.",
    mechanic: {
      ruleReference: null,
      calculation: null,
      evidenceBundle: { id: "evidence:survey", references: [] },
    },
  };
  let retainedPresentations: Record<string, unknown>[] = [];
  let projection = {
    id: "locked-manor",
    title: "The Locked Manor",
    playerCharacter: {
      name: "Mara Vey",
      pronouns: "she/her",
      motivation: "Find her missing sister",
      traits: { Might: 0, Wits: 2, Presence: 1 },
      health: 3,
      resolve: 3,
      inventory: [],
    },
    activeScene: { id: "arrival", title: "Arrival" },
    conditions: [],
    clocks: [],
    relationships: [],
    availableActions: [
      { id: "survey-manor", label: "Survey the manor grounds", kind: "Free Action" },
    ],
    pendingCheckProposal: null,
    pendingChoice: null,
    oracleConfirmation: null,
    ledger: [] as (typeof entry)[],
    inputMode: "structured",
    naturalLanguage: { available: false, pendingProposal: null, response: null },
  };
  await page.route("**/api/player/adventures/locked-manor**", async (route) => {
    const request = route.request();
    if (request.url().includes("/presentations/")) {
      streamRequests += 1;
      if (streamFails) {
        await route.abort("failed");
        return;
      }
      const narration = {
        id: "event:survey:narration",
        outcomeEventId: entry.id,
        source: "Narrator",
        status: "Retained",
        text: "Rain silvering the gate reveals fresh tracks toward the side door.",
        modelCallIds: ["model-call:survey"],
      };
      retainedPresentations = [narration];
      const event = {
        type: "completed",
        streamId: "stream:retry",
        correlationId: entry.id,
        sequence: 0,
        presentation: narration,
      };
      await route.fulfill({
        contentType: "text/event-stream",
        body: `event: completed\ndata: ${JSON.stringify(event)}\n\n`,
      });
      return;
    }
    if (request.url().endsWith("/presentations")) {
      await route.fulfill({ json: retainedPresentations });
      return;
    }
    if (request.method() === "POST") {
      projection = { ...projection, ledger: [entry] };
      await route.fulfill({
        json: {
          status: "accepted",
          message: "Accepted.",
          projection,
          canonicalCommand: { type: "choose-action", actionId: "survey-manor" },
          canonicalEventTypes: ["FreeActionCompleted"],
          canonicalEvents: [{ type: "FreeActionCompleted", payload: {} }],
        },
      });
      return;
    }
    await route.fulfill({ json: projection });
  });

  await page.goto("/player/adventures/locked-manor");
  await page.getByRole("button", { name: "Survey the manor grounds" }).click();

  const recovery = page.getByRole("alert");
  await expect(recovery).toBeFocused();
  await expect(recovery).toContainText("The committed outcome is safe");
  await expect(recovery).toContainText(entry.summary);
  await expect(page.getByRole("region", { name: "Scene ledger" })).toContainText("Committed");

  streamFails = false;
  await recovery.getByRole("button", { name: "Retry Narration" }).click();
  await expect(
    page.getByRole("region", { name: "Retained Narration for Survey the manor grounds" }),
  ).toContainText("Rain silvering the gate reveals fresh tracks");
  const completion = page.getByText("Narration complete and retained.");
  await expect(completion).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Scene ledger" })
      .getByRole("button", { name: "Regenerate Narration" }),
  ).toBeFocused();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )).toBe(false);
  await expect(page.locator("body")).not.toContainText("stream:retry");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Retained Narration for Survey the manor grounds" }),
  ).toContainText("Rain silvering the gate reveals fresh tracks");
  expect(streamRequests).toBe(2);
});
