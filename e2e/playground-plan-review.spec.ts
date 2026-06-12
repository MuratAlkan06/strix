/**
 * playground-plan-review.spec.ts — `verify:ui` extension for the draft-plan
 * review/edit surface (phase-1-golden-path "Draft-plan review/edit UI"),
 * added by issue #46 (restore focus to trigger on inline-editor dismiss).
 *
 * Target: /playground/plan-review — the deterministic fixture route (fixed
 * plan, onSave a local no-op) rendering the REAL <PlanReview />.
 *
 * Scope: INLINE EDITOR INTERACTION only — an open editor replaces the row
 * (and its Edit trigger), so focus must move BOTH ways:
 *   - OPEN moves focus inside the editor, onto its first field (the Title
 *     input — the documented landing control). This is asserted before any
 *     test touches a field, and Escape is exercised IMMEDIATELY after open
 *     (the real keyboard path): with focus stranded on <body> the editor's
 *     Escape handler would never fire.
 *   - Escape cancels without committing and refocuses the Edit trigger;
 *   - Done (the confirming dismiss) refocuses the Edit trigger;
 *   - Remove unmounts the row, so focus falls back to the section's Add
 *     button (the documented successor — the nearest stable control);
 *   - a create opened from an Add button focuses the new item's Title field
 *     and a dismiss returns focus to that Add button.
 * No screenshots here: the surface's pixels are unchanged by issue #46 (no
 * captured state holds an open editor), and its visual baselines stay owned
 * by the design-review harness flow.
 */
import { test, expect } from "@playwright/test";

const ROUTE = "/playground/plan-review";

test.describe("/playground/plan-review — inline editor dismiss restores focus (issue #46)", () => {
  test("focus lands in the editor on open; Escape — immediate or mid-edit — cancels and refocuses the Edit trigger", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    const trigger = page.getByRole("button", {
      name: "Edit Morning mobility work",
    });
    const title = page.getByLabel("Title", { exact: true });

    // Open: focus moves INTO the editor (its first field) — never strands
    // on <body> while the trigger is unmounted.
    await trigger.click();
    await expect(title).toBeFocused();

    // Escape IMMEDIATELY — the test focuses no field first, so this only
    // passes if focus-on-open made the editor's Escape handler reachable.
    await page.keyboard.press("Escape");
    await expect(title).toBeHidden();
    await expect(trigger).toBeFocused();

    // Reopen, draft a title, Escape mid-edit: cancels WITHOUT committing.
    await trigger.click();
    await title.fill("Discarded draft title");
    await page.keyboard.press("Escape");
    await expect(title).toBeHidden();
    await expect(page.getByText("Morning mobility work")).toBeVisible();
    await expect(page.getByText("Discarded draft title")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("Done commits the edit and refocuses the Edit trigger", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    const trigger = page.getByRole("button", {
      name: "Edit Log yesterday's training",
    });
    await trigger.click();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(trigger).toBeFocused();
  });

  test("Remove unmounts the row — focus falls back to the section's Add button", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Edit Log yesterday's training" })
      .click();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Log yesterday's training")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add a habit" }),
    ).toBeFocused();
  });

  test("a create opened from an Add button focuses its Title field, and Done returns focus to that Add button", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    const add = page.getByRole("button", { name: "Add a milestone" });
    await add.click();
    // The new item opens directly in its edit form, Title field focused.
    await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(add).toBeFocused();
  });
});
