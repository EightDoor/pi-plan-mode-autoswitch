import assert from "node:assert/strict";
import { test } from "vitest";
import planMode from "../src/plan-mode.js";
import { createMockContext, createMockPi } from "./support.js";

function sessionManagerFor(mock: ReturnType<typeof createMockPi>) {
  const branch = () =>
    mock.entries.map((entry) => ({ type: "custom", customType: entry.customType, data: entry.data }));
  return {
    getSessionId: () => "test-session",
    getSessionName: () => undefined,
    getBranch: branch,
    getEntries: branch,
  };
}

async function completePlan(mock: ReturnType<typeof createMockPi>, ctx: unknown, plan: string) {
  const execute = mock.tools.find((candidate) => candidate.name === "plan_mode_complete")?.execute as
    | ((...args: unknown[]) => Promise<unknown>)
    | undefined;
  assert.ok(execute);
  await execute("complete", { plan }, undefined, undefined, ctx);
}

test("/plan diff rejects print and JSON modes", async () => {
  const mock = createMockPi({ activeTools: ["read"] });
  planMode(mock.pi, { readSettings: async () => ({ kind: "missing" as const }) });
  const planCommand = mock.commands.get("plan");
  assert.ok(planCommand);

  for (const mode of ["print", "json"] as const) {
    const context = createMockContext({ mode, hasUI: false });
    await assert.rejects(async () => planCommand.handler("diff", context.ctx), /requires TUI or RPC/u);
  }
});

test("/plan diff opens a read-only diff view for the revised plan", async () => {
  const mock = createMockPi({ activeTools: ["read"] });
  const views: Record<string, unknown>[] = [];
  planMode(mock.pi, {
    readSettings: async () => ({ kind: "missing" as const }),
    loadInteractiveUi: async () =>
      ({
        showPlanChangesView: async (_ctx: unknown, options: Record<string, unknown>) => {
          views.push(options);
        },
      }) as never,
  });
  const context = createMockContext({ mode: "rpc", hasUI: true, sessionManager: sessionManagerFor(mock) });
  const planCommand = mock.commands.get("plan");
  assert.ok(planCommand);

  await planCommand.handler("start", context.ctx);
  await completePlan(mock, context.ctx, "# Plan A\nstep one");
  await mock.events.get("before_agent_start")?.[0]?.({}, context.ctx);
  await completePlan(mock, context.ctx, "# Plan A\nstep one revised");

  const entriesBefore = mock.entries.length;
  const messagesBefore = mock.sentMessages.length;
  const userMessagesBefore = mock.sentUserMessages.length;
  await planCommand.handler("diff", context.ctx);

  assert.equal(views.length, 1);
  assert.equal(views[0]?.summary, "Changes vs the previous version: +1 / -1 lines.");
  assert.equal(views[0]?.content, "@@ -1,2 +1,2 @@\n # Plan A\n-step one\n+step one revised");
  assert.equal(mock.entries.length, entriesBefore, "the diff view must not write session state");
  assert.equal(mock.sentMessages.length, messagesBefore, "the diff view must not add model context");
  assert.equal(mock.sentUserMessages.length, userMessagesBefore, "the diff view must not start a model turn");
});

test("/plan diff reports when no plan or no earlier version is available", async () => {
  const mock = createMockPi({ activeTools: ["read"] });
  planMode(mock.pi, { readSettings: async () => ({ kind: "missing" as const }) });
  const context = createMockContext({ mode: "rpc", hasUI: true, sessionManager: sessionManagerFor(mock) });
  const planCommand = mock.commands.get("plan");
  assert.ok(planCommand);

  await planCommand.handler("diff", context.ctx);
  assert.match(context.notifications.at(-1)?.message ?? "", /No completed plan/u);

  await planCommand.handler("start", context.ctx);
  await completePlan(mock, context.ctx, "# Plan A\nstep one");
  await planCommand.handler("diff", context.ctx);
  assert.match(context.notifications.at(-1)?.message ?? "", /No earlier plan version/u);
});

test("/plan diff compares the saved plan with its previous version", async () => {
  const mock = createMockPi({ activeTools: ["read"] });
  const views: Record<string, unknown>[] = [];
  planMode(mock.pi, {
    readSettings: async () => ({ kind: "missing" as const }),
    loadInteractiveUi: async () =>
      ({
        showPlanChangesView: async (_ctx: unknown, options: Record<string, unknown>) => {
          views.push(options);
        },
      }) as never,
  });
  const context = createMockContext({ mode: "rpc", hasUI: true, sessionManager: sessionManagerFor(mock) });
  const planCommand = mock.commands.get("plan");
  assert.ok(planCommand);

  await planCommand.handler("start", context.ctx);
  await completePlan(mock, context.ctx, "# Plan A\nstep one");
  await mock.events.get("before_agent_start")?.[0]?.({}, context.ctx);
  await completePlan(mock, context.ctx, "# Plan A\nstep one revised");
  await planCommand.handler("save", context.ctx);
  await planCommand.handler("diff", context.ctx);

  assert.equal(views.length, 1);
  assert.equal(views[0]?.summary, "Changes vs the previous version: +1 / -1 lines.");
});

test("a workflow started after a failed restore does not compare against the earlier plan", async () => {
  const mock = createMockPi({ activeTools: ["read"] });
  mock.rawPi.setActiveTools(["read"]);
  const views: Record<string, unknown>[] = [];
  planMode(mock.pi, {
    readSettings: async () => ({ kind: "missing" as const }),
    loadInteractiveUi: async () =>
      ({
        showPlanChangesView: async (_ctx: unknown, options: Record<string, unknown>) => {
          views.push(options);
        },
      }) as never,
  });
  const restored = {
    type: "custom",
    customType: "plan-mode-state",
    data: { enabled: true, awaitingAction: true, latestPlan: "# Plan A", latestPlanSource: "plan_mode_complete" },
  };
  const branch = () => [
    restored,
    ...mock.entries.map((entry) => ({ type: "custom", customType: entry.customType, data: entry.data })),
  ];
  const context = createMockContext({
    mode: "rpc",
    hasUI: true,
    sessionManager: { getBranch: branch, getEntries: branch },
  });
  const planCommand = mock.commands.get("plan");
  assert.ok(planCommand);

  await mock.events.get("session_start")?.[0]?.({ reason: "resume" }, context.ctx);
  assert.match(context.notifications.at(-1)?.message ?? "", /helper tools are unavailable/i);

  mock.rawPi.setActiveTools(["read", "plan_mode_question", "plan_mode_complete"]);
  await planCommand.handler("start", context.ctx);
  await completePlan(mock, context.ctx, "# Plan B");
  await planCommand.handler("diff", context.ctx);

  assert.equal(views.length, 0, "the new workflow has no earlier version to compare");
  assert.match(context.notifications.at(-1)?.message ?? "", /No earlier plan version/u);
});

test("the ready menu and the status widget summarize the revised plan", async () => {
  const mock = createMockPi({ activeTools: ["read"] });
  const readyMenus: Record<string, unknown>[] = [];
  planMode(mock.pi, {
    readSettings: async () => ({ kind: "missing" as const }),
    loadInteractiveUi: async () =>
      ({
        showReadyPlanMenu: async (_ctx: unknown, options: Record<string, unknown>) => {
          readyMenus.push(options);
        },
      }) as never,
  });
  const context = createMockContext({ mode: "rpc", hasUI: true, sessionManager: sessionManagerFor(mock) });
  const planCommand = mock.commands.get("plan");
  assert.ok(planCommand);

  await planCommand.handler("start", context.ctx);
  await completePlan(mock, context.ctx, "# Plan A\nstep one");
  await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);
  assert.equal(readyMenus.length, 1);
  assert.equal(readyMenus[0]?.changes, undefined, "the first version has no earlier version to compare");

  await mock.events.get("before_agent_start")?.[0]?.({}, context.ctx);
  await completePlan(mock, context.ctx, "# Plan A\nstep one revised");
  await mock.events.get("agent_settled")?.[0]?.({}, context.ctx);

  assert.equal(readyMenus.length, 2);
  assert.deepEqual(readyMenus[1]?.changes, {
    summary: "Changes vs the previous version: +1 / -1 lines.",
    content: "@@ -1,2 +1,2 @@\n # Plan A\n-step one\n+step one revised",
  });
  const widget = context.widgets.get("plan-mode-plan");
  assert.ok(Array.isArray(widget));
  assert.ok(widget.includes("Changes vs the previous version: +1 / -1 lines."));
});
