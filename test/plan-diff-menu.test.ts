import assert from "node:assert/strict";
import { test } from "vitest";
import { showPlanModeMenu, showReadyPlanMenu } from "../src/plan-action-menus.js";
import { showPlanChangesView } from "../src/plan-diff-view.js";
import { createMockContext } from "./support.js";

const CHANGES = {
  summary: "Changes vs the previous version: +1 / -1 lines.",
  content: "@@ -1,2 +1,2 @@\n # Plan A\n-step one\n+step one revised",
};

function menuOptions(overrides: Record<string, unknown> = {}) {
  return {
    signal: new AbortController().signal,
    isCurrent: () => true,
    implementationOutcome: () => "The plan remains available until implementation ends.",
    planThinkingLevel: undefined,
    getExportDestination: () => ({ configuredPath: "PLAN.md", resolvedPath: "/tmp/PLAN.md" }),
    implementHere: () => undefined,
    implementFresh: () => undefined,
    exportPlan: async () => true,
    save: () => undefined,
    stay: () => undefined,
    exit: () => undefined,
    ...overrides,
  };
}

test("the ready menu opens a read-only diff screen for the previous plan version", async () => {
  const dialogs: Array<{ title: string; options: string[] }> = [];
  let readyVisits = 0;
  const context = createMockContext({
    mode: "rpc",
    hasUI: true,
    modelRegistry: { getAvailable: () => [] },
    select: async (title: string, options: string[]) => {
      dialogs.push({ title, options });
      if (title.startsWith("Proposed plan ready")) {
        readyVisits += 1;
        return readyVisits === 1 ? "View plan changes" : "Stay in Plan mode";
      }
      return "Back";
    },
  });

  await showReadyPlanMenu(context.ctx, menuOptions({ changes: CHANGES }));

  const ready = dialogs.find((dialog) => dialog.title.startsWith("Proposed plan ready"));
  assert.ok(ready);
  assert.ok(ready.options.some((option) => option.includes("View plan changes")));
  assert.ok(ready.title.includes(CHANGES.summary));

  const review = dialogs.find((dialog) => dialog.title.startsWith("Plan changes"));
  assert.ok(review);
  assert.ok(review.title.includes("-step one"));
  assert.ok(review.title.includes("+step one revised"));
  assert.ok(review.options.includes("Back"));
});

test("the plan changes view renders the diff read-only in TUI mode", async () => {
  const renders: string[][] = [];
  const context = createMockContext({
    mode: "tui",
    hasUI: true,
    custom: async (factory: unknown) => {
      const kitFactory = factory as (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: (value: unknown) => void,
      ) => Promise<{ render(width: number): string[] }>;
      const component = await kitFactory(
        { terminal: { rows: 24 }, requestRender() {} },
        { fg: (_role: string, text: string) => text, bold: (text: string) => text },
        { matches: () => false, getKeys: () => [] },
        () => undefined,
      );
      renders.push(component.render(90));
      return undefined;
    },
  });

  await showPlanChangesView(context.ctx, {
    title: "Plan changes",
    summary: CHANGES.summary,
    content: CHANGES.content,
    signal: new AbortController().signal,
    isCurrent: () => true,
  });

  const rendered = renders.flat().join("\n");
  assert.match(rendered, /Plan changes/u);
  assert.match(rendered, /-step one/u);
  assert.match(rendered, /\+step one revised/u);
});

test("the ready menu hides the diff entry when no earlier version exists", async () => {
  const dialogs: Array<{ title: string; options: string[] }> = [];
  const context = createMockContext({
    mode: "rpc",
    hasUI: true,
    modelRegistry: { getAvailable: () => [] },
    select: async (title: string, options: string[]) => {
      dialogs.push({ title, options });
      return undefined;
    },
  });

  await showReadyPlanMenu(context.ctx, menuOptions());

  const ready = dialogs.find((dialog) => dialog.title.startsWith("Proposed plan ready"));
  assert.ok(ready);
  assert.equal(
    ready.options.some((option) => option.includes("View plan changes")),
    false,
  );
});

test("the manually reopened plan menu also offers the plan changes", async () => {
  const dialogs: Array<{ title: string; options: string[] }> = [];
  let visits = 0;
  const context = createMockContext({
    mode: "rpc",
    hasUI: true,
    modelRegistry: { getAvailable: () => [] },
    select: async (title: string, options: string[]) => {
      dialogs.push({ title, options });
      if (title.startsWith("Plan mode")) {
        visits += 1;
        return visits === 1 ? "View plan changes" : "Stay in Plan mode";
      }
      return "Back";
    },
  });

  await showPlanModeMenu(context.ctx, {
    ...menuOptions({ changes: CHANGES }),
    statusText: "Plan mode is active and a proposed plan is ready.",
    hasReadyPlan: true,
  });

  const main = dialogs.find((dialog) => dialog.title.startsWith("Plan mode"));
  assert.ok(main);
  assert.ok(main.options.some((option) => option.includes("View plan changes")));
  assert.ok(main.title.includes(CHANGES.summary));

  const review = dialogs.find((dialog) => dialog.title.startsWith("Plan changes"));
  assert.ok(review);
  assert.ok(review.title.includes("-step one"));
  assert.ok(review.title.includes("+step one revised"));
});
