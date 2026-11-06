import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createPlanDiffCache,
  diffPlanVersions,
  planChangesSummary,
  planVersionHistory,
  selectPlanBaseline,
} from "../src/plan-diff.js";
import type { PlanModeState } from "../src/state.js";

const STATE_ENTRY_TYPE = "plan-mode-state";

function stateEntry(data: Record<string, unknown>) {
  return { type: "custom", customType: STATE_ENTRY_TYPE, data };
}

function planState(latestPlan?: string): PlanModeState {
  return { enabled: true, awaitingAction: latestPlan !== undefined, latestPlan };
}

test("plan version history reads only Plan state entries of the current branch", () => {
  const versions = planVersionHistory(
    [
      { type: "message", role: "user" },
      stateEntry({ enabled: true, latestPlan: "plan A" }),
      stateEntry({ enabled: true, latestPlan: "plan A" }),
      stateEntry({ enabled: false, latestPlan: undefined }),
      { type: "custom", customType: "other-extension", data: { enabled: true, latestPlan: "ignored" } },
    ],
    STATE_ENTRY_TYPE,
  );

  assert.deepEqual(versions, [{ plan: "plan A", workflow: "legacy:0" }]);
});

test("plan version history separates workflows by Plan enable boundaries", () => {
  const versions = planVersionHistory(
    [
      stateEntry({ enabled: true, latestPlan: "plan A" }),
      stateEntry({ enabled: false }),
      stateEntry({ enabled: true, latestPlan: "plan B" }),
    ],
    STATE_ENTRY_TYPE,
  );

  assert.deepEqual(versions, [
    { plan: "plan A", workflow: "legacy:0" },
    { plan: "plan B", workflow: "legacy:1" },
  ]);
});

test("baseline selection keeps A → B → A meaningful and never crosses workflows", () => {
  assert.equal(
    selectPlanBaseline(
      [
        { plan: "A", workflow: "w1" },
        { plan: "B", workflow: "w1" },
        { plan: "A", workflow: "w1" },
      ],
      "A",
    ),
    "B",
  );
  assert.equal(selectPlanBaseline([{ plan: "A", workflow: "w1" }], "A"), undefined);
  assert.equal(
    selectPlanBaseline(
      [
        { plan: "A", workflow: "w1" },
        { plan: "B", workflow: "w2" },
      ],
      "B",
    ),
    undefined,
  );
  assert.equal(selectPlanBaseline([{ plan: "A", workflow: "w1" }], "B"), undefined);
});
test("plan version history groups versions by the persisted workflow id", () => {
  const versions = planVersionHistory(
    [
      stateEntry({ enabled: true, latestPlan: "plan A", workflowId: "round-1" }),
      stateEntry({ enabled: true, latestPlan: "plan B", workflowId: "round-1" }),
      stateEntry({ enabled: true, latestPlan: "plan C", workflowId: "round-2" }),
    ],
    STATE_ENTRY_TYPE,
  );

  assert.deepEqual(versions, [
    { plan: "plan A", workflow: "round:round-1" },
    { plan: "plan B", workflow: "round:round-1" },
    { plan: "plan C", workflow: "round:round-2" },
  ]);
  assert.equal(selectPlanBaseline(versions, "plan B"), undefined);
  assert.equal(selectPlanBaseline(versions, "plan C"), undefined);
  assert.equal(
    selectPlanBaseline(
      [
        { plan: "plan A", workflow: "round:round-1" },
        { plan: "plan B", workflow: "round:round-1" },
      ],
      "plan B",
    ),
    "plan A",
  );
});

test("a workflow id with surrounding whitespace groups like its restored form", () => {
  // 恢复路径会 trim；历史分组必须一致，否则同一轮会被拆成两轮。
  const versions = planVersionHistory(
    [
      stateEntry({ enabled: true, latestPlan: "plan A", workflowId: "  round-1  " }),
      stateEntry({ enabled: true, latestPlan: "plan B", workflowId: "round-1" }),
    ],
    STATE_ENTRY_TYPE,
  );

  assert.deepEqual(
    versions.map((version) => version.workflow),
    ["round:round-1", "round:round-1"],
  );
  assert.equal(selectPlanBaseline(versions, "plan B"), "plan A");
});

test("two rounds started within the same millisecond stay separate", () => {
  const versions = planVersionHistory(
    [
      stateEntry({ enabled: true, latestPlan: "plan A", workflowId: "f47ac10b-58cc" }),
      stateEntry({ enabled: false }),
      stateEntry({ enabled: true, latestPlan: "plan B", workflowId: "1b9d6bcd-bbfd" }),
    ],
    STATE_ENTRY_TYPE,
  );

  assert.deepEqual(
    versions.map((version) => version.workflow),
    ["round:f47ac10b-58cc", "round:1b9d6bcd-bbfd"],
  );
  assert.equal(selectPlanBaseline(versions, "plan B"), undefined);
});

test("a workflow started after a failed restore never inherits the earlier workflow's plan", () => {
  // 恢复失败不会持久化 enabled=false，旧方案与新轮次在分支上都显示为 enabled。
  const versions = planVersionHistory(
    [
      stateEntry({ enabled: true, latestPlan: "plan A" }),
      stateEntry({ enabled: true, latestPlan: undefined, workflowId: "round-2" }),
      stateEntry({ enabled: true, latestPlan: "plan B", workflowId: "round-2" }),
    ],
    STATE_ENTRY_TYPE,
  );

  assert.equal(selectPlanBaseline(versions, "plan B"), undefined);
});

test("line diff reports added and removed lines as a unified diff", () => {
  const changes = diffPlanVersions("alpha\nbeta\ngamma", "alpha\nbeta revised\ngamma\ndelta");

  assert.equal(changes.added, 2);
  assert.equal(changes.removed, 1);
  assert.equal(changes.simplified, false);
  assert.equal(changes.content, "@@ -1,3 +1,4 @@\n alpha\n-beta\n+beta revised\n gamma\n+delta");
  assert.equal(planChangesSummary(changes), "Changes vs the previous version: +2 / -1 lines.");
});

test("line diff normalizes line endings and keeps identical plans empty", () => {
  const changes = diffPlanVersions("alpha\r\nbeta", "alpha\nbeta");

  assert.equal(changes.added, 0);
  assert.equal(changes.removed, 0);
  assert.equal(changes.content, "");
});

test("oversized middles fall back to a simplified whole-block replacement", () => {
  const baseline = Array.from({ length: 1200 }, (_, index) => `old ${index}`).join("\n");
  const current = Array.from({ length: 1200 }, (_, index) => `new ${index}`).join("\n");

  const changes = diffPlanVersions(baseline, current);

  assert.equal(changes.simplified, true);
  assert.equal(changes.added, 1200);
  assert.equal(changes.removed, 1200);
  assert.match(planChangesSummary(changes), /simplified/u);
});

test("the diff cache reuses results for the same plan pair and reports missing baselines", () => {
  const cache = createPlanDiffCache();
  const entries = [stateEntry({ enabled: true, latestPlan: "A" }), stateEntry({ enabled: true, latestPlan: "B" })];

  const first = cache.resolve(planState("B"), entries, STATE_ENTRY_TYPE);
  const second = cache.resolve(planState("B"), entries, STATE_ENTRY_TYPE);

  assert.equal(first.kind, "ready");
  assert.equal(second.kind, "ready");
  assert.equal(first.kind === "ready" && first.changes, second.kind === "ready" && second.changes);
  assert.equal(cache.resolve(planState("A"), entries, STATE_ENTRY_TYPE).kind, "no-baseline");
  assert.equal(cache.resolve(planState(), entries, STATE_ENTRY_TYPE).kind, "no-plan");
});
