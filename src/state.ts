import {
  normalizePlanModeCompletion,
  PLAN_MODE_COMPLETE_TOOL_NAME,
  planFromCompletionDetails,
} from "./completion-tool.js";
import { type ImplementationModelOverride, isPendingImplementationModelIdentifier } from "./implementation-models.js";
import {
  IMPLEMENTATION_PLAN_RETENTIONS,
  type ImplementationPlanRetention,
  PLAN_MODE_THINKING_LEVELS,
  type PlanModeFixedThinkingLevel,
} from "./settings.js";

export type { ImplementationModelOverride } from "./implementation-models.js";
export {
  isPendingImplementationModelIdentifier,
  MAX_PENDING_IMPLEMENTATION_MODEL_IDENTIFIER_LENGTH,
} from "./implementation-models.js";

export type PlanCompletionSource = typeof PLAN_MODE_COMPLETE_TOOL_NAME | "legacy_proposed_plan";

export interface ActiveImplementationPlan {
  id: string;
  plan: string;
  source: PlanCompletionSource;
  startedAt: number;
  retention?: ImplementationPlanRetention;
}

export interface SavedPlan {
  plan: string;
  source: PlanCompletionSource;
}

export interface ImplementationRuntimeSelection {
  model?: ImplementationModelOverride;
  /** 在 model 失败后按声明顺序尝试的后备模型。 */
  fallbackModels?: ImplementationModelOverride[];
  /** 一次性显式选择：最高优先级，覆盖候选绑定等级。 */
  thinkingLevel?: PlanModeFixedThinkingLevel;
  /** 继承的规划等级：最低优先级，候选无绑定等级时兜底。 */
  inheritedThinkingLevel?: PlanModeFixedThinkingLevel;
}

export interface PendingImplementationRuntime extends ImplementationRuntimeSelection {
  version: 1 | 2;
}

/** 把有序候选链转成运行时选择：首个为主模型，其余为后备。 */
export function implementationRuntimeModelSelection(
  models: readonly ImplementationModelOverride[],
): ImplementationRuntimeSelection {
  const [model, ...fallbackModels] = models;
  if (!model) return {};
  return fallbackModels.length > 0 ? { model, fallbackModels } : { model };
}

export interface PlanModeWorkflowToolPolicy {
  kind: "automatic" | "explicit";
  desiredNames?: string[];
  allowedNames: string[];
  resolved: boolean;
}

export interface PlanModeState {
  enabled: boolean;
  latestPlan?: string;
  latestPlanSource?: PlanCompletionSource;
  awaitingAction: boolean;
  savedPlan?: SavedPlan;
  activeImplementation?: ActiveImplementationPlan;
  pendingImplementationRuntime?: PendingImplementationRuntime;
  /** 活动 Plan 工作流快照的 planModel 候选链，用于请求期间的额度降级。 */
  activePlanModelCandidates?: ImplementationModelOverride[];
  selectedToolNames?: string[];
  selectedToolKeys?: string[];
  workflowToolPolicy?: PlanModeWorkflowToolPolicy;
  previousThinkingLevel?: PlanModeFixedThinkingLevel;
  appliedThinkingLevel?: PlanModeFixedThinkingLevel;
  manualThinkingLevel?: PlanModeFixedThinkingLevel;
}

type SessionEntry = {
  type?: string;
  customType?: string;
  data?: unknown;
  message?: {
    role?: string;
    toolName?: string;
    details?: unknown;
  };
};

export function restorePlanModeState(entries: unknown[], stateEntryType: string): PlanModeState {
  const branch = entries as SessionEntry[];
  let stateEntryIndex = -1;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const candidate = branch[index];
    if (candidate?.type === "custom" && candidate.customType === stateEntryType) {
      stateEntryIndex = index;
      break;
    }
  }
  const entry = branch[stateEntryIndex];
  if (!isRecord(entry?.data)) return { enabled: false, awaitingAction: false };

  const enabled = entry.data.enabled === true;
  const persistedSource = enabled ? planCompletionSource(entry.data.latestPlanSource) : undefined;
  const persistedPlan = enabled ? normalizePersistedPlan(entry.data.latestPlan) : undefined;
  const recoveredPlan = enabled && !persistedPlan ? latestCompletionPlan(branch.slice(stateEntryIndex + 1)) : undefined;
  const latestPlan = persistedPlan ?? recoveredPlan;
  const activeImplementation = enabled ? undefined : normalizeActiveImplementation(entry.data.activeImplementation);
  const savedPlan = enabled || activeImplementation ? undefined : normalizeSavedPlan(entry.data.savedPlan);
  const pendingImplementationRuntime = enabled
    ? undefined
    : normalizePendingImplementationRuntime(entry.data.pendingImplementationRuntime);
  return {
    enabled,
    latestPlan,
    latestPlanSource: enabled
      ? ((persistedPlan ? persistedSource : undefined) ?? (recoveredPlan ? PLAN_MODE_COMPLETE_TOOL_NAME : undefined))
      : undefined,
    awaitingAction: enabled && latestPlan !== undefined,
    savedPlan,
    activeImplementation,
    pendingImplementationRuntime,
    activePlanModelCandidates: enabled
      ? normalizeActivePlanModelCandidates(entry.data.activePlanModelCandidates)
      : undefined,
    selectedToolNames: stringArray(entry.data.selectedToolNames),
    selectedToolKeys: stringArray(entry.data.selectedToolKeys),
    workflowToolPolicy: enabled ? normalizeWorkflowToolPolicy(entry.data.workflowToolPolicy) : undefined,
    previousThinkingLevel: enabled ? fixedThinkingLevel(entry.data.previousThinkingLevel) : undefined,
    appliedThinkingLevel: enabled ? fixedThinkingLevel(entry.data.appliedThinkingLevel) : undefined,
    manualThinkingLevel: enabled ? fixedThinkingLevel(entry.data.manualThinkingLevel) : undefined,
  };
}

function normalizeWorkflowToolPolicy(value: unknown): PlanModeWorkflowToolPolicy | undefined {
  if (value === undefined) return undefined;
  const denied: PlanModeWorkflowToolPolicy = {
    kind: "automatic",
    allowedNames: [],
    resolved: true,
  };
  if (!isRecord(value)) return denied;
  const kind = value.kind === "automatic" || value.kind === "explicit" ? value.kind : undefined;
  const allowedNames = stringArray(value.allowedNames);
  if (!kind || !allowedNames || typeof value.resolved !== "boolean") return denied;
  if (kind === "automatic") {
    return { kind, allowedNames, resolved: value.resolved };
  }
  const desiredNames = stringArray(value.desiredNames);
  if (!desiredNames) return denied;
  return { kind, desiredNames, allowedNames, resolved: value.resolved };
}

function normalizeSavedPlan(value: unknown): SavedPlan | undefined {
  if (!isRecord(value)) return undefined;
  const source = planCompletionSource(value.source);
  const normalized = normalizePlanModeCompletion({ plan: value.plan });
  if (!source || !normalized.ok) return undefined;
  return { plan: normalized.plan, source };
}

function normalizePendingImplementationRuntime(value: unknown): PendingImplementationRuntime | undefined {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) return undefined;
  const version = value.version;
  const allowedKeys =
    version === 2
      ? ["version", "model", "fallbackModels", "thinkingLevel", "inheritedThinkingLevel"]
      : ["version", "model", "thinkingLevel", "inheritedThinkingLevel"];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) return undefined;
  const model = value.model === undefined ? undefined : normalizePendingModel(value.model);
  if (value.model !== undefined && !model) return undefined;
  const fallbackModels = normalizePendingFallbackModels(value.fallbackModels, model, version);
  if (value.fallbackModels !== undefined && !fallbackModels) return undefined;
  const thinkingLevel = value.thinkingLevel === undefined ? undefined : fixedThinkingLevel(value.thinkingLevel);
  if (value.thinkingLevel !== undefined && !thinkingLevel) return undefined;
  const inheritedThinkingLevel =
    value.inheritedThinkingLevel === undefined ? undefined : fixedThinkingLevel(value.inheritedThinkingLevel);
  if (value.inheritedThinkingLevel !== undefined && !inheritedThinkingLevel) return undefined;
  if (!model && !thinkingLevel && !inheritedThinkingLevel) return undefined;
  return {
    version: fallbackModels && fallbackModels.length > 0 ? 2 : 1,
    ...(model ? { model } : {}),
    ...(fallbackModels && fallbackModels.length > 0 ? { fallbackModels } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(inheritedThinkingLevel ? { inheritedThinkingLevel } : {}),
  };
}

function normalizePendingModel(value: unknown): ImplementationModelOverride | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== "provider" && key !== "modelId" && key !== "thinkingLevel")
  ) {
    return undefined;
  }
  if (
    !isPendingImplementationModelIdentifier(value.provider) ||
    !isPendingImplementationModelIdentifier(value.modelId)
  ) {
    return undefined;
  }
  const model: ImplementationModelOverride = { provider: value.provider, modelId: value.modelId };
  if (value.thinkingLevel !== undefined) {
    const thinkingLevel = fixedThinkingLevel(value.thinkingLevel);
    if (!thinkingLevel) return undefined;
    model.thinkingLevel = thinkingLevel;
  }
  return model;
}

/** 活动 Plan 的候选链：只在 Plan 激活时保存，任一项非法则整条链作废，避免降级用到错误目标。 */
function normalizeActivePlanModelCandidates(value: unknown): ImplementationModelOverride[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const seen = new Set<string>();
  const candidates: ImplementationModelOverride[] = [];
  for (const item of value) {
    const candidate = normalizePendingModel(item);
    if (!candidate) return undefined;
    const key = JSON.stringify([candidate.provider, candidate.modelId]);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates.length > 0 ? candidates : undefined;
}

/** v1 一次性状态没有后备链；v2 的后备链必须先有主模型，且去重后非空。 */
function normalizePendingFallbackModels(
  value: unknown,
  model: ImplementationModelOverride | undefined,
  version: 1 | 2,
): ImplementationModelOverride[] | undefined {
  if (value === undefined) return [];
  if (version !== 2 || !model || !Array.isArray(value) || value.length === 0) return undefined;
  const seen = new Set([JSON.stringify([model.provider, model.modelId])]);
  const fallbackModels: ImplementationModelOverride[] = [];
  for (const item of value) {
    const candidate = normalizePendingModel(item);
    if (!candidate) return undefined;
    const key = JSON.stringify([candidate.provider, candidate.modelId]);
    if (seen.has(key)) continue;
    seen.add(key);
    fallbackModels.push(candidate);
  }
  return fallbackModels;
}

function normalizeActiveImplementation(value: unknown): ActiveImplementationPlan | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(value.id) ? value.id : undefined;
  const source = planCompletionSource(value.source);
  const normalized = normalizePlanModeCompletion({ plan: value.plan });
  const startedAt =
    typeof value.startedAt === "number" && Number.isSafeInteger(value.startedAt) && value.startedAt >= 0
      ? value.startedAt
      : undefined;
  if (!id || !source || !normalized.ok || startedAt === undefined) return undefined;
  const retention = IMPLEMENTATION_PLAN_RETENTIONS.includes(value.retention as ImplementationPlanRetention)
    ? (value.retention as ImplementationPlanRetention)
    : "keep";
  return { id, plan: normalized.plan, source, startedAt, retention };
}

function normalizePersistedPlan(value: unknown) {
  const normalized = normalizePlanModeCompletion({ plan: value });
  return normalized.ok ? normalized.plan : undefined;
}

function latestCompletionPlan(entries: SessionEntry[]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = entries[index]?.message;
    if (message?.role !== "toolResult" || message.toolName !== PLAN_MODE_COMPLETE_TOOL_NAME) {
      continue;
    }
    const plan = planFromCompletionDetails(message.details);
    if (plan) return plan;
  }
  return undefined;
}

function planCompletionSource(value: unknown): PlanCompletionSource | undefined {
  return value === PLAN_MODE_COMPLETE_TOOL_NAME || value === "legacy_proposed_plan" ? value : undefined;
}

function fixedThinkingLevel(value: unknown): PlanModeFixedThinkingLevel | undefined {
  return typeof value === "string" &&
    value !== "inherit" &&
    PLAN_MODE_THINKING_LEVELS.includes(value as (typeof PLAN_MODE_THINKING_LEVELS)[number])
    ? (value as PlanModeFixedThinkingLevel)
    : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
    ? Array.from(new Set(value))
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
