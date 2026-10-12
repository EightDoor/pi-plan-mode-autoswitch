import assert from "node:assert/strict";
import { test } from "vitest";
import { createPlanActionController } from "../src/plan-action-controller.js";
import { createMockContext } from "./support.js";

test("stale Plan actions do not load interactive UI", async () => {
  let interactiveLoads = 0;
  const controller = createPlanActionController({
    loadInteractiveUi: async () => {
      interactiveLoads += 1;
      return {} as never;
    },
    getState: () => ({ enabled: false, awaitingAction: false }),
    captureLifecycle: () => ({
      signal: new AbortController().signal,
      isCurrent: () => false,
    }),
    statusText: () => "off",
    getThinkingLevel: () => "medium",
    getSettings: () => ({ thinkingLevel: "inherit" }),
    implementationOutcome: () => "",
    getExportDestination: () => ({ configuredPath: "plan.md", resolvedPath: "/tmp/plan.md" }),
    show: () => undefined,
    finalize: () => undefined,
    implementHere: () => undefined,
    implementFresh: () => undefined,
    exportPlan: async () => false,
    settings: async () => false,
    save: () => undefined,
    stay: () => undefined,
    exitReady: () => undefined,
    clearSaved: () => undefined,
  });
  const context = createMockContext({ hasUI: true });

  await controller.showSaved(context.ctx);
  await controller.showCurrent(context.ctx);
  await controller.showReady(context.ctx);

  assert.equal(interactiveLoads, 0);
});

test("only ready-plan fresh actions survive normal menu disposal for deferred handoff", async () => {
  const timings: string[] = [];
  const currents: Array<() => boolean> = [];
  const invokeFresh = async (menuOptions: Record<string, unknown>, kind: "saved" | "current" | "ready") => {
    const controller = new AbortController();
    if (kind === "saved") {
      await (menuOptions.implementFresh as (signal: AbortSignal) => Promise<void>)(controller.signal);
    } else {
      await (menuOptions.implementFresh as (runtime: Record<string, never>, signal: AbortSignal) => Promise<void>)(
        {},
        controller.signal,
      );
    }
    controller.abort(new DOMException("Menu closed", "AbortError"));
  };
  const controller = createPlanActionController({
    loadInteractiveUi: async () =>
      ({
        showSavedPlanMenu: (_ctx: unknown, options: Record<string, unknown>) => invokeFresh(options, "saved"),
        showPlanModeMenu: (_ctx: unknown, options: Record<string, unknown>) => invokeFresh(options, "current"),
        showReadyPlanMenu: (_ctx: unknown, options: Record<string, unknown>) => invokeFresh(options, "ready"),
      }) as never,
    getState: () => ({
      enabled: true,
      awaitingAction: true,
      latestPlan: "# Plan",
      latestPlanSource: "plan_mode_complete",
    }),
    captureLifecycle: () => ({
      signal: new AbortController().signal,
      isCurrent: () => true,
    }),
    statusText: () => "ready",
    getThinkingLevel: () => "medium",
    getSettings: () => ({ thinkingLevel: "inherit" }),
    implementationOutcome: () => "",
    getExportDestination: () => ({ configuredPath: "plan.md", resolvedPath: "/tmp/plan.md" }),
    show: () => undefined,
    finalize: () => undefined,
    implementHere: () => undefined,
    implementFresh: (_ctx, isCurrent, _runtime, timing) => {
      timings.push(timing);
      currents.push(isCurrent);
    },
    exportPlan: async () => false,
    settings: async () => false,
    save: () => undefined,
    stay: () => undefined,
    exitReady: () => undefined,
    clearSaved: () => undefined,
  });
  const context = createMockContext({
    hasUI: true,
    model: { provider: "planning-provider", id: "planning-model" },
    modelRegistry: { getAvailable: () => [] },
  });

  await controller.showSaved(context.ctx);
  await controller.showCurrent(context.ctx);
  await controller.showReady(context.ctx);

  assert.deepEqual(timings, ["immediate", "immediate", "after-settled"]);
  assert.deepEqual(
    currents.map((isCurrent) => isCurrent()),
    [false, false, true],
  );
});

test("saved-plan fresh actions use persistent defaults and fall back from missing models", async () => {
  const target = { provider: "target-provider", id: "target-model" };
  const scenarios = [
    { name: "available", availableModels: [target], scopedModels: undefined, usesTarget: true },
    { name: "missing", availableModels: [], scopedModels: undefined, usesTarget: false },
    {
      name: "stale scoped model",
      availableModels: [],
      scopedModels: [{ model: target }],
      usesTarget: false,
    },
  ];
  for (const scenario of scenarios) {
    let selectedRuntime: unknown;
    const controller = createPlanActionController({
      loadInteractiveUi: async () =>
        ({
          showSavedPlanMenu: async (_ctx: unknown, menuOptions: Record<string, unknown>) => {
            await (menuOptions.implementFresh as (signal: AbortSignal) => Promise<void>)(new AbortController().signal);
          },
        }) as never,
      getState: () => ({
        enabled: false,
        awaitingAction: false,
        savedPlan: { plan: "# Plan", source: "plan_mode_complete" },
      }),
      captureLifecycle: () => ({
        signal: new AbortController().signal,
        isCurrent: () => true,
      }),
      statusText: () => "saved",
      getThinkingLevel: () => "medium",
      getSettings: () => ({
        thinkingLevel: "inherit",
        autoSwitchModel: true,
        normalModel: [
          {
            provider: target.provider,
            modelId: target.id,
          },
        ],
      }),
      implementationOutcome: () => "",
      getExportDestination: () => ({ configuredPath: "plan.md", resolvedPath: "/tmp/plan.md" }),
      show: () => undefined,
      finalize: () => undefined,
      implementHere: () => undefined,
      implementFresh: (_ctx, _isCurrent, runtime) => {
        selectedRuntime = runtime;
      },
      exportPlan: async () => false,
      settings: async () => false,
      save: () => undefined,
      stay: () => undefined,
      exitReady: () => undefined,
      clearSaved: () => undefined,
    });
    const context = createMockContext({
      hasUI: true,
      model: { provider: "planning-provider", id: "planning-model" },
      ...(scenario.scopedModels ? { scopedModels: scenario.scopedModels } : {}),
      modelRegistry: { getAvailable: () => scenario.availableModels },
    });

    await controller.showSaved(context.ctx);

    assert.deepEqual(
      selectedRuntime,
      {
        model: scenario.usesTarget
          ? { provider: target.provider, modelId: target.id }
          : { provider: "planning-provider", modelId: "planning-model" },
        inheritedThinkingLevel: "medium",
      },
      scenario.name,
    );
    assert.equal(
      context.notifications.some((notice) => /unavailable/u.test(notice.message)),
      !scenario.usesTarget,
      scenario.name,
    );
  }
});

const CHAIN_PRIMARY = { provider: "provider-one", id: "model-one" };
const CHAIN_FALLBACK = { provider: "provider-two", id: "model-two" };

test("saved-plan fresh actions resolve the configured chain to its usable candidates", async () => {
  const scenarios = [
    {
      name: "both candidates available",
      availableModels: [CHAIN_PRIMARY, CHAIN_FALLBACK],
      runtime: {
        model: { provider: CHAIN_PRIMARY.provider, modelId: CHAIN_PRIMARY.id },
        fallbackModels: [{ provider: CHAIN_FALLBACK.provider, modelId: CHAIN_FALLBACK.id }],
        inheritedThinkingLevel: "medium",
      },
      warns: false,
    },
    {
      name: "primary unavailable",
      availableModels: [CHAIN_FALLBACK],
      runtime: {
        model: { provider: CHAIN_FALLBACK.provider, modelId: CHAIN_FALLBACK.id },
        inheritedThinkingLevel: "medium",
      },
      warns: false,
    },
    {
      name: "whole chain unavailable",
      availableModels: [],
      runtime: {
        model: { provider: "planning-provider", modelId: "planning-model" },
        inheritedThinkingLevel: "medium",
      },
      warns: true,
    },
  ];
  for (const scenario of scenarios) {
    let selectedRuntime: unknown;
    const controller = createPlanActionController({
      loadInteractiveUi: async () =>
        ({
          showSavedPlanMenu: async (_ctx: unknown, menuOptions: Record<string, unknown>) => {
            await (menuOptions.implementFresh as (signal: AbortSignal) => Promise<void>)(new AbortController().signal);
          },
        }) as never,
      getState: () => ({
        enabled: false,
        awaitingAction: false,
        savedPlan: { plan: "# Plan", source: "plan_mode_complete" },
      }),
      captureLifecycle: () => ({
        signal: new AbortController().signal,
        isCurrent: () => true,
      }),
      statusText: () => "saved",
      getThinkingLevel: () => "medium",
      getSettings: () => ({
        thinkingLevel: "inherit",
        autoSwitchModel: true,
        normalModel: [
          { provider: CHAIN_PRIMARY.provider, modelId: CHAIN_PRIMARY.id },
          { provider: CHAIN_FALLBACK.provider, modelId: CHAIN_FALLBACK.id },
        ],
      }),
      implementationOutcome: () => "",
      getExportDestination: () => ({ configuredPath: "plan.md", resolvedPath: "/tmp/plan.md" }),
      show: () => undefined,
      finalize: () => undefined,
      implementHere: () => undefined,
      implementFresh: (_ctx, _isCurrent, runtime) => {
        selectedRuntime = runtime;
      },
      exportPlan: async () => false,
      settings: async () => false,
      save: () => undefined,
      stay: () => undefined,
      exitReady: () => undefined,
      clearSaved: () => undefined,
    });
    const context = createMockContext({
      hasUI: true,
      model: { provider: "planning-provider", id: "planning-model" },
      modelRegistry: { getAvailable: () => scenario.availableModels },
    });

    await controller.showSaved(context.ctx);

    assert.deepEqual(selectedRuntime, scenario.runtime, scenario.name);
    assert.equal(
      context.notifications.some((notice) => /unavailable/u.test(notice.message)),
      scenario.warns,
      scenario.name,
    );
  }
});
