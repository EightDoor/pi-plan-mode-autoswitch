import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const MAX_PENDING_IMPLEMENTATION_MODEL_IDENTIFIER_LENGTH = 512;

export interface ImplementationModelOverride {
  provider: string;
  modelId: string;
}

/** 单个模型，或按优先级排列的候选列表；数组顺序即该方向的回退顺序。 */
export type ImplementationModelCandidates = ImplementationModelOverride | ImplementationModelOverride[];

/** 展开候选配置为有序列表；未配置时为空数组。 */
export function implementationModelCandidateList(
  value: ImplementationModelCandidates | undefined,
): ImplementationModelOverride[] {
  if (!value) return [];
  return Array.isArray(value) ? [...value] : [value];
}

/** 汇总候选失败原因；单条通知必须有界，所以按码点截断。 */
export function implementationModelFailureSummary(failures: readonly string[]): string {
  const summary = failures.join("; ");
  const characters = [...summary];
  return characters.length > 300 ? `${characters.slice(0, 299).join("")}…` : summary;
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
