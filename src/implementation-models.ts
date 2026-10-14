import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PlanModeFixedThinkingLevel } from "./settings.js";

export const MAX_PENDING_IMPLEMENTATION_MODEL_IDENTIFIER_LENGTH = 512;

export interface ImplementationModelOverride {
  provider: string;
  modelId: string;
  /** 该候选项独占的思考等级；缺省时沿用切换前等级。 */
  thinkingLevel?: PlanModeFixedThinkingLevel;
}

/** 按优先级排列的候选列表；数组顺序即该方向的回退顺序，单对象形态已废弃。 */
export type ImplementationModelCandidates = ImplementationModelOverride[];

/** 展开候选配置为有序列表；未配置时为空数组。 */
export function implementationModelCandidateList(
  value: ImplementationModelCandidates | undefined,
): ImplementationModelOverride[] {
  return value ? [...value] : [];
}

/** 汇总候选失败原因；单条通知必须有界，所以按码点截断。 */
export function implementationModelFailureSummary(failures: readonly string[]): string {
  const summary = failures.join("; ");
  const characters = [...summary];
  return characters.length > 300 ? `${characters.slice(0, 299).join("")}…` : summary;
}

/** 与 Pi 判定「不可重试」的额度词表对齐：这类错误重试无益，只有换模型才有意义。 */
const TERMINAL_MODEL_QUOTA_ERROR_PATTERN = new RegExp(
  [
    "usage[_ ]limit",
    "GoUsageLimitError",
    "FreeUsageLimitError",
    "insufficient_quota",
    "out of budget",
    "available balance",
    "quota exceeded",
    "billing",
    "subscription_sharing_usage_limit_exceeded",
  ].join("|"),
  "i",
);

/** 判断 provider 错误是否为确定性的额度/用量耗尽，而非可重试的瞬时限流或过载。 */
export function isTerminalModelQuotaError(errorMessage: string | undefined): boolean {
  return typeof errorMessage === "string" && TERMINAL_MODEL_QUOTA_ERROR_PATTERN.test(errorMessage);
}

/** 单个候选的认证等待上限；超时即视为该候选失败，继续尝试下一个。 */
export const IMPLEMENTATION_MODEL_AUTH_TIMEOUT_MS = 2_000;

/** 认证超时的专用错误：调用方据此区分「超时该跳过候选」与「解析失败应交给 Pi 判定」。 */
class ImplementationModelAuthTimeoutError extends Error {}

export function isImplementationModelAuthTimeoutError(error: unknown): boolean {
  return error instanceof ImplementationModelAuthTimeoutError;
}

/**
 * 给无副作用的模型认证加固定超时。
 * 超时只让调用方继续下一个候选，不取消底层认证；底层稍后返回的结果被丢弃，
 * 避免它把已经应用到后备模型的切换再抢占回去。
 */
export function withImplementationModelAuthTimeout<T>(operation: () => Promise<T>): Promise<T> {
  const pending = operation();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ImplementationModelAuthTimeoutError(
          `authentication timed out after ${IMPLEMENTATION_MODEL_AUTH_TIMEOUT_MS}ms`,
        ),
      );
    }, IMPLEMENTATION_MODEL_AUTH_TIMEOUT_MS);
    // 超时后底层仍会 settle，这里必须消费它，否则产生未处理 rejection。
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface AvailableImplementationModel {
  provider: string;
  id: string;
  name?: string;
}

export function isPendingImplementationModelIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_PENDING_IMPLEMENTATION_MODEL_IDENTIFIER_LENGTH
  );
}

export function snapshotAvailableImplementationModels(ctx: ExtensionContext): AvailableImplementationModel[] {
  const getAvailable = ctx.modelRegistry.getAvailable;
  const availableModels = typeof getAvailable === "function" ? getAvailable.call(ctx.modelRegistry) : [];
  const scopedModels = ctx.scopedModels ?? [];
  if (scopedModels.length === 0) return availableModels;
  return scopedModels.flatMap((entry) => {
    const availableModel = availableModels.find(
      (model) => model.provider === entry.model.provider && model.id === entry.model.id,
    );
    return availableModel ? [availableModel] : [];
  });
}

export function findAvailableImplementationModel(
  models: readonly AvailableImplementationModel[],
  configured: ImplementationModelOverride | undefined,
): AvailableImplementationModel | undefined {
  if (!configured) return undefined;
  return models.find((model) => model.provider === configured.provider && model.id === configured.modelId);
}
