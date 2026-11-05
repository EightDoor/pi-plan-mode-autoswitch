import assert from "node:assert/strict";
import { test } from "vitest";
import { isTerminalModelQuotaError } from "../src/implementation-models.js";
import planMode from "../src/plan-mode.js";
import type { PlanModeSettings } from "../src/settings.js";
import { restorePlanModeState } from "../src/state.js";
import { createMockContext, createMockPi } from "./support.js";

const STATE_ENTRY_TYPE = "plan-mode-state";

const MODEL_A = { provider: "p", modelId: "a" };
const MODEL_B = { provider: "q", modelId: "b" };
const MODEL_C = { provider: "r", modelId: "c" };

type ModelRef = { provider: string; modelId: string };

function chainSettings(
  planModel: Array<ModelRef & { thinkingLevel?: string }>,
  overrides: Partial<PlanModeSettings> = {},
): PlanModeSettings {
  return { thinkingLevel: "inherit", autoSwitchModel: true, planModel, ...overrides } as PlanModeSettings;
}

function createHarness(
  settings: PlanModeSettings,
  options: {
    resolveModels?: (provider: string, modelId: string) => { provider: string; id: string } | undefined;
  } = {},
) {
  const mock = createMockPi({ activeTools: ["read", "edit", "write"] });
  planMode(mock.pi, { readSettings: async () => ({ kind: "loaded" as const, settings }) });
  const context = createMockContext({
    model: { provider: "other", id: "previous-model" },
    modelRegistry: {
      find: (provider: string, modelId: string) =>
        options.resolveModels ? options.resolveModels(provider, modelId) : { provider, id: modelId },
      getAvailable: () => [],
      getAll: () => [],
      isUsingOAuth: () => false,
      getApiKeyAndHeaders: async () => ({ ok: true, headers: {} }),
    },
  });
  // 让 ctx.model 跟随 setModel，模拟 Pi 真正切换后的状态，便于连续降级。
  const originalSetModel = mock.rawPi.setModel.bind(mock.rawPi);
  mock.rawPi.setModel = async (model: unknown) => {
    const applied = await originalSetModel(model);
    if (applied) (context.ctx as { model?: unknown }).model = model;
    return applied;
  };
  return { mock, context };
}

async function activatePlan(mock: ReturnType<typeof createMockPi>, context: { ctx: unknown }) {
  await mock.events.get("session_start")?.[0]?.({ reason: "startup" }, context.ctx);
  await mock.commands.get("plan")?.handler("start", context.ctx);
  (context.ctx as { model?: unknown }).model = { provider: MODEL_A.provider, id: MODEL_A.modelId };
}

function quotaEvent(options: {
  failedModel: ModelRef;
  errorMessage?: string;
  withUserMessage?: boolean;
  outcome?: "error" | "completed";
}) {
  const user = { role: "user", content: [{ type: "text", text: "Plan this" }], timestamp: 1 };
  const failed = {
    role: "assistant",
    content: [],
    api: "openai-codex",
    provider: options.failedModel.provider,
    model: options.failedModel.modelId,
    usage: { input: 0, output: 0, totalTokens: 0 },
    stopReason: "error",
    errorMessage: options.errorMessage ?? "You have hit your ChatGPT usage limit. Try again in ~10 min.",
    timestamp: 2,
  };
  const entries: Array<{ sourceEntry: Record<string, unknown>; messages: unknown[] }> = [];
  if (options.withUserMessage !== false) {
    entries.push({
      sourceEntry: { type: "message", id: "user-1", parentId: null, timestamp: "1", message: user },
      messages: [user],
    });
  }
  entries.push({
    sourceEntry: { type: "message", id: "assistant-1", parentId: null, timestamp: "2", message: failed },
    messages: [failed],
  });
  return {
    type: "agent_before_settle",
    outcome: options.outcome ?? "error",
    entries: [],
    continue: false,
    context: {
      contextEntries: entries,
      contextMessages: entries.flatMap((entry) => entry.messages),
      llmMessages: entries.flatMap((entry) => entry.messages),
      pendingMessages: [],
      canContinue: options.withUserMessage !== false,
    },
  } as never;
}

function settle(mock: ReturnType<typeof createMockPi>, context: { ctx: unknown }, event: unknown) {
  return mock.events.get("agent_before_settle")?.[0]?.(event, context.ctx) as
    | { entries?: unknown[]; continue?: boolean }
    | undefined;
}

test("terminal quota errors are recognized while transient provider errors are not", () => {
  for (const message of [
    "You have hit your ChatGPT usage limit",
    "usage_limit_reached",
    "GoUsageLimitError",
    "FreeUsageLimitError",
    "Monthly usage limit reached",
    "please add available balance",
    "insufficient_quota",
    "out of budget",
    "quota exceeded",
    "billing error",
    "subscription_sharing_usage_limit_exceeded",
  ]) {
    assert.equal(isTerminalModelQuotaError(message), true, message);
  }
  for (const message of [
    "rate limit exceeded",
    "429 Too Many Requests",
    "529 overloaded",
    "server busy",
    "connection reset by peer",
    "context_length_exceeded",
    undefined,
  ]) {
    assert.equal(isTerminalModelQuotaError(message), false, String(message));
  }
});

test("a Plan quota failure falls back to the next candidate and requests one continuation", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B, MODEL_C]));
  await activatePlan(mock, context);
  const switchesBefore = mock.setModels.length;

  const result = await settle(mock, context, quotaEvent({ failedModel: MODEL_A }));

  assert.equal(mock.setModels.length, switchesBefore + 1);
  assert.deepEqual(mock.setModels.at(-1), { provider: MODEL_B.provider, id: MODEL_B.modelId });
  assert.deepEqual(result, {
    entries: [{ type: "context_edit", targetId: "assistant-1", replacement: null }],
    continue: true,
  });
  const fallbackNotifications = context.notifications.filter((entry) => /quota fallback/iu.test(entry.message));
  assert.equal(fallbackNotifications.length, 1);
});

test("a repeated quota failure keeps walking down the configured chain", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B, MODEL_C]));
  await activatePlan(mock, context);

  await settle(mock, context, quotaEvent({ failedModel: MODEL_A }));
  const result = await settle(mock, context, quotaEvent({ failedModel: MODEL_B }));

  assert.deepEqual(result?.continue, true);
  assert.deepEqual(mock.setModels.slice(-1), [{ provider: MODEL_C.provider, id: MODEL_C.modelId }]);
});

test("the last chain candidate keeps the original error and does not continue", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B, MODEL_C]));
  await activatePlan(mock, context);
  (context.ctx as { model?: unknown }).model = { provider: MODEL_C.provider, id: MODEL_C.modelId };
  const switchesBefore = mock.setModels.length;

  const result = await settle(mock, context, quotaEvent({ failedModel: MODEL_C }));

  assert.equal(result, undefined);
  assert.equal(mock.setModels.length, switchesBefore);
  assert.ok(context.notifications.some((entry) => /no candidate after/iu.test(entry.message)));
});

test("an unavailable middle candidate is skipped and the reason is reported once", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B, MODEL_C]), {
    resolveModels: (provider, modelId) => (provider === MODEL_B.provider ? undefined : { provider, id: modelId }),
  });
  await activatePlan(mock, context);

  const result = await settle(mock, context, quotaEvent({ failedModel: MODEL_A }));

  assert.deepEqual(mock.setModels.at(-1), { provider: MODEL_C.provider, id: MODEL_C.modelId });
  assert.equal(result?.continue, true);
  const fallbackNotifications = context.notifications.filter((entry) => /quota fallback/iu.test(entry.message));
  assert.equal(fallbackNotifications.length, 1);
  assert.match(fallbackNotifications[0]?.message ?? "", /unavailable/iu);
});

test("when every remaining candidate fails the current model is kept without continuing", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B]), {
    resolveModels: () => undefined,
  });
  await activatePlan(mock, context);
  (context.ctx as { model?: unknown }).model = { provider: MODEL_A.provider, id: MODEL_A.modelId };
  const switchesBefore = mock.setModels.length;

  const result = await settle(mock, context, quotaEvent({ failedModel: MODEL_A }));

  assert.equal(result, undefined);
  assert.equal(mock.setModels.length, switchesBefore);
  assert.ok(context.notifications.some((entry) => /kept the current model/iu.test(entry.message)));
});

test("transient provider errors never trigger the Plan quota fallback", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B]));
  await activatePlan(mock, context);
  const switchesBefore = mock.setModels.length;

  for (const errorMessage of [
    "rate limit exceeded",
    "529 overloaded",
    "connection reset by peer",
    "context_length_exceeded",
  ]) {
    const result = await settle(mock, context, quotaEvent({ failedModel: MODEL_A, errorMessage }));
    assert.equal(result, undefined, errorMessage);
  }

  assert.equal(mock.setModels.length, switchesBefore);
  assert.equal(context.notifications.filter((entry) => /quota fallback/iu.test(entry.message)).length, 0);
});

test("a successful run and a chain-external model are left untouched", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B]));
  await activatePlan(mock, context);
  const switchesBefore = mock.setModels.length;

  assert.equal(await settle(mock, context, quotaEvent({ failedModel: MODEL_A, outcome: "completed" })), undefined);

  (context.ctx as { model?: unknown }).model = { provider: "manual", id: "chosen" };
  assert.equal(await settle(mock, context, quotaEvent({ failedModel: MODEL_A })), undefined);

  assert.equal(mock.setModels.length, switchesBefore);
});

test("a context that cannot continue after omitting the failure is left alone", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B]));
  await activatePlan(mock, context);
  const switchesBefore = mock.setModels.length;

  const result = await settle(mock, context, quotaEvent({ failedModel: MODEL_A, withUserMessage: false }));

  assert.equal(result, undefined);
  assert.equal(mock.setModels.length, switchesBefore);
});

test("the fallback applies the bound thinking level of the candidate that succeeds", async () => {
  const { mock, context } = createHarness(
    chainSettings([MODEL_A, { ...MODEL_B, thinkingLevel: "high" } as ModelRef & { thinkingLevel: string }]),
  );
  await activatePlan(mock, context);

  await settle(mock, context, quotaEvent({ failedModel: MODEL_A }));

  assert.equal(mock.thinkingLevel, "high");
});

test("inactive Plan mode never falls back", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B]));
  await mock.events.get("session_start")?.[0]?.({ reason: "startup" }, context.ctx);
  (context.ctx as { model?: unknown }).model = { provider: MODEL_A.provider, id: MODEL_A.modelId };
  const switchesBefore = mock.setModels.length;

  const result = await settle(mock, context, quotaEvent({ failedModel: MODEL_A }));

  assert.equal(result, undefined);
  assert.equal(mock.setModels.length, switchesBefore);
});

test("a model switched while the authentication probe runs is not overridden", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B]));
  await activatePlan(mock, context);
  const switchesBefore = mock.setModels.length;
  const modelRegistry = (context.ctx as { modelRegistry: Record<string, unknown> }).modelRegistry;
  modelRegistry.getApiKeyAndHeaders = async () => {
    // 模拟认证等待期间用户执行 /model 切到链外模型。
    (context.ctx as { model?: unknown }).model = { provider: "manual", id: "chosen" };
    return { ok: true, headers: {} };
  };

  const result = await settle(mock, context, quotaEvent({ failedModel: MODEL_A }));

  assert.equal(result, undefined);
  assert.equal(mock.setModels.length, switchesBefore);
});

test("a model switched right after the fallback switch does not continue", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B]));
  await activatePlan(mock, context);
  const originalSetModel = mock.rawPi.setModel.bind(mock.rawPi);
  mock.rawPi.setModel = async (model: unknown) => {
    const applied = await originalSetModel(model);
    // 模拟切换落地后用户立刻 /model。
    (context.ctx as { model?: unknown }).model = { provider: "manual", id: "chosen" };
    return applied;
  };
  const thinkingBefore = mock.thinkingLevel;

  const result = await settle(mock, context, quotaEvent({ failedModel: MODEL_A }));

  assert.equal(result, undefined);
  assert.equal(mock.thinkingLevel, thinkingBefore);
});

test("activating Plan snapshots the candidate chain and clearing Plan drops it", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B]));
  await startSessionAndStartPlan(mock, context);
  const enabled = mock.entries.at(-1)?.data as { activePlanModelCandidates?: unknown };

  assert.deepEqual(enabled.activePlanModelCandidates, [MODEL_A, MODEL_B]);

  await mock.commands.get("plan")?.handler("exit", context.ctx);
  const disabled = mock.entries.at(-1)?.data as { activePlanModelCandidates?: unknown };
  assert.equal(disabled.activePlanModelCandidates, undefined);
});

test("a resumed active Plan workflow recovers the snapshot from current settings", async () => {
  const { mock, context } = createHarness(chainSettings([MODEL_A, MODEL_B]));
  const sessionManager = (context.ctx as { sessionManager: Record<string, unknown> }).sessionManager;
  (context.ctx as { sessionManager?: unknown }).sessionManager = {
    ...sessionManager,
    getBranch: () => [{ type: "custom", customType: STATE_ENTRY_TYPE, data: { enabled: true, awaitingAction: false } }],
  };
  await mock.events.get("session_start")?.[0]?.({ reason: "resume" }, context.ctx);
  (context.ctx as { model?: unknown }).model = { provider: MODEL_A.provider, id: MODEL_A.modelId };

  const result = await settle(mock, context, quotaEvent({ failedModel: MODEL_A }));

  assert.equal(result?.continue, true);
  assert.deepEqual(mock.setModels.at(-1), { provider: MODEL_B.provider, id: MODEL_B.modelId });
});

async function startSessionAndStartPlan(mock: ReturnType<typeof createMockPi>, context: { ctx: unknown }) {
  await mock.events.get("session_start")?.[0]?.({ reason: "startup" }, context.ctx);
  await mock.commands.get("plan")?.handler("start", context.ctx);
}

function stateEntry(data: Record<string, unknown>) {
  return { type: "custom", customType: STATE_ENTRY_TYPE, data };
}

test("restored Plan state validates and deduplicates the snapshot chain", () => {
  const enabled = restorePlanModeState(
    [
      stateEntry({
        enabled: true,
        awaitingAction: false,
        activePlanModelCandidates: [MODEL_A, MODEL_B, { provider: MODEL_A.provider, modelId: MODEL_A.modelId }],
      }),
    ],
    STATE_ENTRY_TYPE,
  );
  assert.deepEqual(enabled.activePlanModelCandidates, [MODEL_A, MODEL_B]);

  const disabled = restorePlanModeState(
    [
      stateEntry({
        enabled: false,
        awaitingAction: false,
        activePlanModelCandidates: [MODEL_A, MODEL_B],
      }),
    ],
    STATE_ENTRY_TYPE,
  );
  assert.equal(disabled.activePlanModelCandidates, undefined);

  for (const activePlanModelCandidates of [[], [MODEL_A, { provider: "", modelId: "b" }], [MODEL_A, 42]]) {
    const restored = restorePlanModeState(
      [stateEntry({ enabled: true, awaitingAction: false, activePlanModelCandidates })],
      STATE_ENTRY_TYPE,
    );
    assert.equal(restored.activePlanModelCandidates, undefined);
  }
});
