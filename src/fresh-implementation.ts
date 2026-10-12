import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type ImplementationModelOverride,
  implementationModelFailureSummary,
  withImplementationModelAuthTimeout,
} from "./implementation-models.js";
import { PLAN_HISTORY_IMPLEMENTATION_PROMPT } from "./message-transform.js";
import { createModeContractMessage } from "./mode-contract.js";
import type { ImplementationPlanRetention } from "./settings.js";
import {
  type ImplementationRuntimeSelection,
  isPendingImplementationModelIdentifier,
  MAX_PENDING_IMPLEMENTATION_MODEL_IDENTIFIER_LENGTH,
  type PendingImplementationRuntime,
  type PlanCompletionSource,
  type PlanModeState,
  restorePlanModeState,
} from "./state.js";

type NewSessionOptions = Exclude<Parameters<ExtensionCommandContext["newSession"]>[0], undefined>;
type ReplacementContext = Parameters<NonNullable<NewSessionOptions["withSession"]>>[0];

export interface FreshImplementationRequest {
  plan: string;
  source: PlanCompletionSource;
  retention: ImplementationPlanRetention;
  stateEntryType: string;
  runtime?: ImplementationRuntimeSelection;
  isCurrent(): boolean;
}

interface FreshImplementationFromStateOptions {
  getState(): PlanModeState;
  menuIsCurrent(): boolean;
  retention: ImplementationPlanRetention;
  stateEntryType: string;
  runtime?: ImplementationRuntimeSelection;
}

export type FreshImplementationResult =
  | { kind: "started" }
  | { kind: "cancelled" }
  | { kind: "partial" }
  | { kind: "rejected" }
  | { kind: "stale" };

export function formatImplementationHandoff(plan: string) {
  return `Plan mode is now disabled. Full tool access is restored. Implement this proposed plan now:\n\n${plan}`;
}

export function formatHistoryImplementationPrompt() {
  return PLAN_HISTORY_IMPLEMENTATION_PROMPT;
}

export function formatTransferredPlanPrompt(plan: string, fresh: boolean) {
  const destination = fresh ? " in a fresh context" : "";
  return `A previous agent produced the plan below to accomplish the user's task. Implement the plan${destination}. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.\n\n${plan}`;
}

export async function startFreshImplementationFromState(
  ctx: ExtensionContext,
  options: FreshImplementationFromStateOptions,
) {
  if (!isCommandContext(ctx)) {
    ctx.ui.notify(
      "Fresh implementation requires the interactive /plan command. Reopen /plan and try again.",
      "warning",
    );
    return { kind: "rejected" } as const;
  }
  const initialState = options.getState();
  const savedPlan = initialState.enabled ? undefined : initialState.savedPlan;
  const plan = (initialState.enabled ? initialState.latestPlan : savedPlan?.plan)?.trim();
  const source = initialState.enabled ? initialState.latestPlanSource : savedPlan?.source;
  if (!plan || !source) {
    ctx.ui.notify("No completed plan is available to implement.", "warning");
    return { kind: "rejected" } as const;
  }
  const wasEnabled = initialState.enabled;
  const isCurrent = () => {
    const current = options.getState();
    return (
      options.menuIsCurrent() &&
      current.enabled === wasEnabled &&
      (wasEnabled
        ? current.latestPlan === plan && current.latestPlanSource === source
        : current.savedPlan === savedPlan)
    );
  };
  return startFreshImplementationSession(ctx, {
    plan,
    source,
    retention: options.retention,
    stateEntryType: options.stateEntryType,
    runtime: options.runtime,
    isCurrent,
  });
}

export async function startFreshImplementationSession(
  ctx: ExtensionCommandContext,
  request: FreshImplementationRequest,
): Promise<FreshImplementationResult> {
  if (ctx.mode === "print" || ctx.mode === "json") {
    throw new Error("Fresh plan implementation is unavailable in print/JSON mode. Use TUI or RPC.");
  }

  await ctx.waitForIdle();
  if (!request.isCurrent()) return { kind: "stale" };
  const preflight = await preflightModel(ctx, request);
  if (!preflight) return { kind: "rejected" };
  if (!request.isCurrent()) return { kind: "stale" };

  const usesConversationHistory = request.retention === "clear-on-start";
  const pendingImplementationRuntime = pendingRuntimeIntent(resolvedRuntimeSelection(request.runtime, preflight));
  const activeImplementation = usesConversationHistory
    ? undefined
    : {
        id: randomUUID(),
        plan: request.plan,
        source: request.source,
        startedAt: Date.now(),
        retention: request.retention,
      };
  const destinationState: PlanModeState | undefined =
    activeImplementation || pendingImplementationRuntime
      ? {
          enabled: false,
          awaitingAction: false,
          ...(activeImplementation ? { activeImplementation } : {}),
          ...(pendingImplementationRuntime ? { pendingImplementationRuntime } : {}),
        }
      : undefined;
  const handoff = usesConversationHistory
    ? formatTransferredPlanPrompt(request.plan, true)
    : formatImplementationHandoff(request.plan);
  const parentSession = ctx.sessionManager.getSessionFile();
  let setupError: string | undefined;
  let kickoffError: string | undefined;

  if (ctx.mode === "rpc") safeNotify(ctx, "Starting fresh implementation session…", "info");

  let result: Awaited<ReturnType<ExtensionCommandContext["newSession"]>>;
  try {
    result = await ctx.newSession({
      ...(parentSession ? { parentSession } : {}),
      setup: async (sessionManager) => {
        try {
          const contract = createModeContractMessage("normal");
          sessionManager.appendCustomMessageEntry(
            contract.customType,
            contract.content,
            contract.display,
            contract.details,
          );
          if (destinationState) {
            sessionManager.appendCustomEntry(request.stateEntryType, destinationState);
          }
        } catch (error: unknown) {
          setupError = safeErrorDetail(error);
        }
      },
      withSession: async (replacementCtx) => {
        if (setupError) {
          recoverSetupFailure(replacementCtx, handoff, setupError);
          return;
        }
        const reportKickoffFailure = (detail: string) => {
          kickoffError = detail;
          const recoveredInEditor = usesConversationHistory && safeSetEditorText(replacementCtx, handoff);
          safeNotify(
            replacementCtx,
            usesConversationHistory
              ? recoveredInEditor
                ? `Fresh session created, but implementation did not start: ${detail}. The implementation request is in the editor; submit it or resume the parent planning session.`
                : `Fresh session created, but implementation did not start: ${detail}. The implementation request could not be restored to the editor; resume the parent planning session.`
              : `Fresh session created, but implementation did not start: ${detail}. Send a message to continue, use /plan exit to clear the active plan, or resume the parent planning session.`,
            "error",
          );
        };
        try {
          await replacementCtx.sendUserMessage(handoff);
        } catch (error: unknown) {
          reportKickoffFailure(safeErrorDetail(error));
          return;
        }
        if (pendingImplementationRuntime) {
          const runtimeStatus = destinationRuntimeConsumptionStatus(replacementCtx, request.stateEntryType);
          if (runtimeStatus !== "consumed") {
            reportKickoffFailure(
              runtimeStatus === "pending"
                ? "fresh implementation settings could not be consumed"
                : "fresh implementation settings could not be verified as consumed",
            );
            return;
          }
        }
        safeNotify(
          replacementCtx,
          "Fresh implementation session started. Only the approved plan was transferred.",
          "info",
        );
      },
    });
  } catch (error: unknown) {
    safeNotify(
      ctx,
      `Unable to start a fresh implementation session: ${safeErrorDetail(error)}. The source plan remains available; retry or resume the planning session.`,
      "error",
    );
    return { kind: "rejected" };
  }

  if (result.cancelled) {
    safeNotify(ctx, "Fresh implementation cancelled. The plan remains available.", "info");
    return { kind: "cancelled" };
  }
  return setupError || kickoffError ? { kind: "partial" } : { kind: "started" };
}

interface FreshModelPreflight {
  model?: ImplementationModelOverride;
  fallbackModels: ImplementationModelOverride[];
}

/**
 * 源会话先行解析并认证候选链，返回首个通过的候选与其余后备项。
 * 预检失败不替换源会话；解析、认证任一步失败都继续尝试下一个候选。
 */
async function preflightModel(
  ctx: ExtensionCommandContext,
  request: FreshImplementationRequest,
): Promise<FreshModelPreflight | undefined> {
  const requestedModels = [
    ...(request.runtime?.model ? [request.runtime.model] : []),
    ...(request.runtime?.fallbackModels ?? []),
  ];
  for (const candidate of requestedModels) {
    if (
      !isPendingImplementationModelIdentifier(candidate.provider) ||
      !isPendingImplementationModelIdentifier(candidate.modelId)
    ) {
      notifyCurrent(
        ctx,
        request,
        `Unable to implement the plan: implementation model provider and ID must each contain 1-${MAX_PENDING_IMPLEMENTATION_MODEL_IDENTIFIER_LENGTH} characters. Choose another model and retry.`,
        "warning",
      );
      return undefined;
    }
  }
  if (requestedModels.length === 0) {
    const model = ctx.model;
    if (!model) {
      notifyCurrent(ctx, request, "Unable to implement the plan: no model is selected.", "warning");
      return undefined;
    }
    const failures: string[] = [];
    if (await authorizeModel(ctx, model, safeModelReference(model), failures)) return { fallbackModels: [] };
    if (!request.isCurrent()) return undefined;
    notifyCurrent(
      ctx,
      request,
      `Unable to implement the plan: ${implementationModelFailureSummary(failures)}.`,
      "warning",
    );
    return undefined;
  }

  const failures: string[] = [];
  for (let index = 0; index < requestedModels.length; index += 1) {
    const candidate = requestedModels[index];
    const reference = safeModelReference(candidate);
    const isCurrentModel = ctx.model?.provider === candidate.provider && ctx.model.id === candidate.modelId;
    let model = isCurrentModel ? ctx.model : undefined;
    if (!model) {
      try {
        model = ctx.modelRegistry.find(candidate.provider, candidate.modelId);
      } catch (error: unknown) {
        failures.push(`${reference}: ${safeErrorDetail(error)}`);
        continue;
      }
    }
    if (!model) {
      failures.push(`implementation model ${reference} is no longer available`);
      continue;
    }
    const authorized = await authorizeModel(ctx, model, reference, failures);
    if (!request.isCurrent()) return undefined;
    if (!authorized) continue;
    return {
      model: { provider: candidate.provider, modelId: candidate.modelId },
      fallbackModels: requestedModels.slice(index + 1),
    };
  }
  notifyCurrent(
    ctx,
    request,
    `Unable to implement the plan: ${implementationModelFailureSummary(failures)}. Choose another model or configure authentication, then retry.`,
    "warning",
  );
  return undefined;
}

/** 认证单个候选；失败原因记入 failures。解析异常、认证失败与认证超时同样视为该候选不可用。 */
async function authorizeModel(
  ctx: ExtensionCommandContext,
  model: NonNullable<ExtensionCommandContext["model"]>,
  reference: string,
  failures: string[],
): Promise<boolean> {
  let auth: Awaited<ReturnType<ExtensionCommandContext["modelRegistry"]["getApiKeyAndHeaders"]>>;
  try {
    // 认证有 2 秒上限：首选卡住时应继续认证下一候选，而不是无限等待。
    auth = await withImplementationModelAuthTimeout(() => ctx.modelRegistry.getApiKeyAndHeaders(model));
  } catch (error: unknown) {
    failures.push(`${reference}: ${safeErrorDetail(error)}`);
    return false;
  }
  if (auth.ok) return true;
  failures.push(`implementation model ${reference} could not be authenticated: ${safeErrorDetail(auth.error)}`);
  return false;
}

function notifyCurrent(
  ctx: Pick<ExtensionContext, "ui">,
  request: FreshImplementationRequest,
  message: string,
  level: "info" | "warning" | "error",
) {
  if (request.isCurrent()) safeNotify(ctx, message, level);
}

/** 源预检解析后的运行时选择：沿用已解析的候选链与原有思考等级。 */
function resolvedRuntimeSelection(
  selection: ImplementationRuntimeSelection | undefined,
  preflight: FreshModelPreflight,
): ImplementationRuntimeSelection | undefined {
  const thinkingLevel = selection?.thinkingLevel;
  if (!preflight.model && !thinkingLevel) return undefined;
  return {
    ...(preflight.model ? { model: preflight.model } : {}),
    ...(preflight.fallbackModels.length > 0 ? { fallbackModels: preflight.fallbackModels } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  };
}

function pendingRuntimeIntent(
  selection: ImplementationRuntimeSelection | undefined,
): PendingImplementationRuntime | undefined {
  if (!selection?.model && !selection?.thinkingLevel) return undefined;
  const fallbackModels = selection.fallbackModels ?? [];
  return {
    version: fallbackModels.length > 0 ? 2 : 1,
    ...(selection.model ? { model: { provider: selection.model.provider, modelId: selection.model.modelId } } : {}),
    ...(fallbackModels.length > 0
      ? {
          fallbackModels: fallbackModels.map((model) => ({ provider: model.provider, modelId: model.modelId })),
        }
      : {}),
    ...(selection.thinkingLevel ? { thinkingLevel: selection.thinkingLevel } : {}),
  };
}

function safeModelReference(model: { provider: string; id?: string; modelId?: string }) {
  return safeErrorDetail(`${model.provider}/${model.modelId ?? model.id ?? "unknown"}`);
}

function destinationRuntimeConsumptionStatus(
  ctx: ReplacementContext,
  stateEntryType: string,
): "consumed" | "pending" | "unavailable" {
  try {
    return restorePlanModeState(ctx.sessionManager.getBranch(), stateEntryType).pendingImplementationRuntime
      ? "pending"
      : "consumed";
  } catch {
    return "unavailable";
  }
}

function recoverSetupFailure(ctx: ReplacementContext, handoff: string, setupError: string) {
  const recoveredInEditor = safeSetEditorText(ctx, handoff);
  safeNotify(
    ctx,
    recoveredInEditor
      ? `Fresh session created, but the active plan could not be saved: ${setupError}. The implementation request is in the editor; submit it to continue or resume the parent planning session.`
      : `Fresh session created, but the active plan could not be saved: ${setupError}. The implementation request could not be restored to the editor; resume the parent planning session.`,
    "error",
  );
}

function safeSetEditorText(ctx: Pick<ExtensionContext, "ui">, text: string) {
  try {
    ctx.ui.setEditorText(text);
    return true;
  } catch {
    // A replacement context can become stale while Pi reports a partial handoff.
    return false;
  }
}

function safeNotify(ctx: Pick<ExtensionContext, "ui">, message: string, level: "info" | "warning" | "error") {
  try {
    ctx.ui.notify(message, level);
  } catch {
    // A source or replacement context can become stale during session replacement.
  }
}

function isCommandContext(ctx: ExtensionContext): ctx is ExtensionCommandContext {
  return typeof (ctx as Partial<ExtensionCommandContext>).newSession === "function";
}

function safeErrorDetail(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  const normalized =
    [...stripVTControlCharacters(detail)]
      .map((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f ||
          (codePoint >= 0x7f && codePoint <= 0x9f) ||
          (codePoint >= 0x202a && codePoint <= 0x202e) ||
          (codePoint >= 0x2066 && codePoint <= 0x2069)
          ? " "
          : character;
      })
      .join("")
      .replace(/\s+/gu, " ")
      .trim() || "unknown error";
  const characters = [...normalized];
  return characters.length > 500 ? `${characters.slice(0, 499).join("")}…` : normalized;
}
