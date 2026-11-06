import type { PlanModeState } from "./state.js";

/** 差异视图保留的上下文行数。 */
const PLAN_DIFF_CONTEXT_LINES = 3;
/** LCS 矩阵上限：超过后退化为整块替换，避免在终端里做超大计算。 */
const PLAN_DIFF_MAX_CELLS = 1_000_000;
/** 差异结果缓存条目数：一次规划只会用到相邻的几个版本。 */
const PLAN_DIFF_CACHE_LIMIT = 8;

export interface PlanVersion {
  /** 该版本完成时的方案文本。 */
  plan: string;
  /** 该版本所属的规划轮次；跨轮次不共享基线。 */
  workflow: string;
}

export interface PlanChanges {
  /** 上一个不同的已完成方案。 */
  baseline: string;
  /** 当前方案。 */
  current: string;
  /** 新增行数。 */
  added: number;
  /** 删除行数。 */
  removed: number;
  /** 是否因为规模超限而退化成整块替换。 */
  simplified: boolean;
  /** 只读展示文本：统一 diff 片段。 */
  content: string;
}

export type PlanDiffResolution =
  | { kind: "ready"; changes: PlanChanges }
  /** 当前没有可对比的方案。 */
  | { kind: "no-plan" }
  /** 有当前方案，但没有可靠的上一个版本可比。 */
  | { kind: "no-baseline" };

type DiffOpKind = "equal" | "delete" | "insert";

interface DiffOp {
  kind: DiffOpKind;
  text: string;
}

interface DiffRow {
  kind: DiffOpKind;
  text: string;
  oldLine?: number;
  newLine?: number;
}

/**
 * 从会话分支里取出已完成方案的版本历史。
 * 只读取当前分支上的 Plan 状态条目：状态里的流程标识划分规划轮次，
 * 旧会话没有该标识时退回 Plan 启用/退出的边界。
 */
export function planVersionHistory(entries: readonly unknown[], stateEntryType: string): PlanVersion[] {
  const versions: PlanVersion[] = [];
  let legacyWorkflow = -1;
  let enabled = false;
  for (const entry of entries) {
    if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== stateEntryType) continue;
    const data = entry.data;
    if (!isRecord(data)) continue;
    const nextEnabled = data.enabled === true;
    if (nextEnabled && !enabled) legacyWorkflow += 1;
    enabled = nextEnabled;
    const plan = data.latestPlan;
    if (!nextEnabled || typeof plan !== "string" || plan.trim().length === 0) continue;
    pushVersion(versions, plan, workflowKey(data.workflowId, legacyWorkflow));
  }
  return versions;
}

/** 有流程标识就用标识分组；旧会话按启用翻转序号分组。 */
function workflowKey(workflowId: unknown, legacyWorkflow: number): string {
  // 与恢复路径一致地 trim：否则手工写入的带空白标识会把同一轮拆成两轮。
  const normalized = typeof workflowId === "string" ? workflowId.trim() : "";
  if (normalized.length > 0) return `round:${normalized}`;
  return `legacy:${legacyWorkflow}`;
}

function pushVersion(versions: PlanVersion[], plan: string, workflow: string) {
  if (plan.trim().length === 0) return;
  const last = versions[versions.length - 1];
  // 同一份内容可能被重复记录；只去掉连续重复快照，保留最新的轮次归属。
  if (last && last.plan === plan) {
    last.workflow = workflow;
    return;
  }
  versions.push({ plan, workflow });
}

/**
 * 取当前方案在同一 Plan 流程内的上一个不同版本。
 * 同内容重复提交不算新版本，A → B → A 仍然以 B 作为基线。
 */
export function selectPlanBaseline(versions: readonly PlanVersion[], currentPlan: string): string | undefined {
  if (versions.length === 0) return undefined;
  const last = versions[versions.length - 1];
  if (!last || last.plan !== currentPlan) return undefined;
  for (let index = versions.length - 2; index >= 0; index -= 1) {
    const version = versions[index];
    if (!version || version.workflow !== last.workflow) break;
    if (version.plan !== currentPlan) return version.plan;
  }
  return undefined;
}

/** 当前可对比的方案文本：就绪方案、已保存方案、仍在保障中的实施方案。 */
export function currentPlanForDiff(state: PlanModeState): string | undefined {
  if (state.enabled && state.latestPlan) return state.latestPlan;
  if (state.savedPlan?.plan) return state.savedPlan.plan;
  if (state.activeImplementation?.plan) return state.activeImplementation.plan;
  return undefined;
}

/** 行级差异：裁剪公共前后缀后对中间部分运行 LCS，超限时退化为整块替换。 */
export function diffPlanVersions(baseline: string, current: string): PlanChanges {
  const oldLines = splitLines(baseline);
  const newLines = splitLines(current);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  const simplified = (oldMiddle.length + 1) * (newMiddle.length + 1) > PLAN_DIFF_MAX_CELLS;
  const operations = simplified
    ? [
        ...oldMiddle.map((text): DiffOp => ({ kind: "delete", text })),
        ...newMiddle.map((text): DiffOp => ({ kind: "insert", text })),
      ]
    : lcsOperations(oldMiddle, newMiddle);
  const rows = buildRows(oldLines, prefix, suffix, operations);
  return {
    baseline,
    current,
    added: operations.filter((operation) => operation.kind === "insert").length,
    removed: operations.filter((operation) => operation.kind === "delete").length,
    simplified,
    content: renderUnifiedDiff(rows),
  };
}

/** 差异摘要，用于就绪菜单和状态组件。 */
export function planChangesSummary(changes: PlanChanges): string {
  const suffix = changes.simplified ? " (simplified)" : "";
  return `Changes vs the previous version: +${changes.added} / -${changes.removed} lines${suffix}.`;
}

export interface PlanDiffCache {
  resolve(state: PlanModeState, entries: readonly unknown[], stateEntryType: string): PlanDiffResolution;
}

/**
 * 按内容缓存差异结果：同一对方案文本的差异永远相同，
 * 版本、流程或分支变化会换掉内容键，缓存随之失效。
 */
export function createPlanDiffCache(): PlanDiffCache {
  const cache = new Map<string, PlanChanges>();
  return {
    resolve(state, entries, stateEntryType) {
      const current = currentPlanForDiff(state);
      if (!current) return { kind: "no-plan" };
      const baseline = selectPlanBaseline(planVersionHistory(entries, stateEntryType), current);
      if (!baseline) return { kind: "no-baseline" };
      const key = `${baseline.length}:${baseline}${current.length}:${current}`;
      const cached = cache.get(key);
      if (cached) return { kind: "ready", changes: cached };
      const changes = diffPlanVersions(baseline, current);
      if (cache.size >= PLAN_DIFF_CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, changes);
      return { kind: "ready", changes };
    },
  };
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n?/g, "\n").split("\n");
}

function lcsOperations(oldLines: readonly string[], newLines: readonly string[]): DiffOp[] {
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const width = newCount + 1;
  const table = new Int32Array((oldCount + 1) * width);
  for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newCount - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex * width + newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? table[(oldIndex + 1) * width + newIndex + 1] + 1
          : Math.max(table[(oldIndex + 1) * width + newIndex], table[oldIndex * width + newIndex + 1]);
    }
  }
  const operations: DiffOp[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldCount && newIndex < newCount) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      operations.push({ kind: "equal", text: oldLines[oldIndex] as string });
      oldIndex += 1;
      newIndex += 1;
    } else if (table[(oldIndex + 1) * width + newIndex] >= table[oldIndex * width + newIndex + 1]) {
      operations.push({ kind: "delete", text: oldLines[oldIndex] as string });
      oldIndex += 1;
    } else {
      operations.push({ kind: "insert", text: newLines[newIndex] as string });
      newIndex += 1;
    }
  }
  while (oldIndex < oldCount) {
    operations.push({ kind: "delete", text: oldLines[oldIndex] as string });
    oldIndex += 1;
  }
  while (newIndex < newCount) {
    operations.push({ kind: "insert", text: newLines[newIndex] as string });
    newIndex += 1;
  }
  return operations;
}

function buildRows(
  oldLines: readonly string[],
  prefix: number,
  suffix: number,
  operations: readonly DiffOp[],
): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (let index = 0; index < prefix; index += 1) {
    rows.push({ kind: "equal", text: oldLines[index] as string, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }
  for (const operation of operations) {
    if (operation.kind === "equal") {
      rows.push({ kind: "equal", text: operation.text, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    } else if (operation.kind === "delete") {
      rows.push({ kind: "delete", text: operation.text, oldLine });
      oldLine += 1;
    } else {
      rows.push({ kind: "insert", text: operation.text, newLine });
      newLine += 1;
    }
  }
  for (let index = 0; index < suffix; index += 1) {
    rows.push({ kind: "equal", text: oldLines[oldLines.length - suffix + index] as string, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }
  return rows;
}

/** 生成统一 diff 片段：hunk 头带行号，正文带增删标记与上下文。 */
function renderUnifiedDiff(rows: readonly DiffRow[]): string {
  const changed = rows.map((row, index) => (row.kind === "equal" ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) return "";
  const groups: Array<{ first: number; last: number }> = [];
  let first = changed[0] as number;
  let last = first;
  for (let position = 1; position < changed.length; position += 1) {
    const index = changed[position] as number;
    if (index - last <= PLAN_DIFF_CONTEXT_LINES * 2 + 1) {
      last = index;
      continue;
    }
    groups.push({ first, last });
    first = index;
    last = index;
  }
  groups.push({ first, last });
  const lines: string[] = [];
  for (const group of groups) {
    const start = Math.max(0, group.first - PLAN_DIFF_CONTEXT_LINES);
    const end = Math.min(rows.length - 1, group.last + PLAN_DIFF_CONTEXT_LINES);
    const hunkRows = rows.slice(start, end + 1);
    const oldCount = hunkRows.filter((row) => row.oldLine !== undefined).length;
    const newCount = hunkRows.filter((row) => row.newLine !== undefined).length;
    const oldStart = hunkRows.find((row) => row.oldLine !== undefined)?.oldLine ?? previousOldLine(rows, start);
    const newStart = hunkRows.find((row) => row.newLine !== undefined)?.newLine ?? previousNewLine(rows, start);
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const row of hunkRows) {
      if (row.kind === "equal") lines.push(` ${row.text}`);
      else if (row.kind === "delete") lines.push(`-${row.text}`);
      else lines.push(`+${row.text}`);
    }
  }
  return lines.join("\n");
}

function previousOldLine(rows: readonly DiffRow[], start: number): number {
  for (let index = start - 1; index >= 0; index -= 1) {
    const oldLine = rows[index]?.oldLine;
    if (oldLine !== undefined) return oldLine;
  }
  return 0;
}

function previousNewLine(rows: readonly DiffRow[], start: number): number {
  for (let index = start - 1; index >= 0; index -= 1) {
    const newLine = rows[index]?.newLine;
    if (newLine !== undefined) return newLine;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
