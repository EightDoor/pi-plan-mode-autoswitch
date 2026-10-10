import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findAvailableImplementationModel, snapshotAvailableImplementationModels } from "./implementation-models.js";
import type { PlanExportDestination } from "./plan-export.js";
import {
  configuredAutoSwitchModel,
  configuredAutoSwitchModelTarget,
  type PlanModeFixedThinkingLevel,
  type PlanModeSettings,
} from "./settings.js";
import type { ImplementationRuntimeSelection, PlanModeState } from "./state.js";

type InteractiveUi = typeof import("./interactive-ui.js");

interface MenuLifecycle {
  signal: AbortSignal;
  isCurrent(): boolean;
}

export type FreshImplementationTiming = "immediate" | "after-settled";

interface PlanActionControllerOptions {
  loadInteractiveUi(): Promise<InteractiveUi>;
  getState(): PlanModeState;
  captureLifecycle(): MenuLifecycle;
  statusText(): string;
  getThinkingLevel(): PlanModeFixedThinkingLevel | undefined;
  getSettings(): PlanModeSettings;
  implementationOutcome(): string;
  getExportDestination(ctx: ExtensionContext): PlanExportDestination;
  show(ctx: ExtensionContext): void;
  finalize(ctx: ExtensionContext): void;
  implementHere(ctx: ExtensionContext): void | Promise<void>;
  implementFresh(
    ctx: ExtensionContext,
    isCurrent: () => boolean,
    runtime: ImplementationRuntimeSelection | undefined,
    timing: FreshImplementationTiming,
  ): void | Promise<void>;
  exportPlan(ctx: ExtensionContext, path: string, signal: AbortSignal, isCurrent: () => boolean): Promise<boolean>;
  settings(ctx: ExtensionContext, signal: AbortSignal, isCurrent: () => boolean): Promise<boolean>;
  save(ctx: ExtensionContext): void | Promise<void>;
  stay(ctx: ExtensionContext): void;
  exitReady(ctx: ExtensionContext): void | Promise<void>;
  clearSaved(ctx: ExtensionContext): void | Promise<void>;
}

export function createPlanActionController(options: PlanActionControllerOptions) {
  // 实施阶段的默认模型统一取 autoSwitchModel 开启时的 normalModel；thinking 继承当前等级。
  const configuredDefaults = (): ImplementationRuntimeSelection => {
    const settings = options.getSettings();
    const model = configuredAutoSwitchModel(settings) ? configuredAutoSwitchModelTarget(settings, "normal") : undefined;
    return {
      ...(model ? { model: { ...model } } : {}),
    };
  };
  const effectiveDefaults = (ctx: ExtensionContext): ImplementationRuntimeSelection => {
    const configured = configuredDefaults();
    const availableModel = findAvailableImplementationModel(
      snapshotAvailableImplementationModels(ctx),
      configured.model,
    );
    if (configured.model && !availableModel) {
      ctx.ui.notify("The configured Plan exit model is unavailable; using the current model.", "warning");
    }
    const currentModel = ctx.model ? { provider: ctx.model.provider, modelId: ctx.model.id } : undefined;
    const model = availableModel ? { provider: availableModel.provider, modelId: availableModel.id } : currentModel;
    // 目标会话 setModel 会重置思考等级，必须显式带上当前等级才能真正“继承”。
    const thinkingLevel = options.getThinkingLevel();
    return {
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    };
  };
  const freshAction = (
    ctx: ExtensionContext,
    lifecycle: MenuLifecycle,
    signal: AbortSignal,
    runtime: ImplementationRuntimeSelection | undefined,
    timing: FreshImplementationTiming,
  ) => {
    if (signal.aborted) return;
    const isCurrent = timing === "after-settled" ? lifecycle.isCurrent : () => lifecycle.isCurrent() && !signal.aborted;
    return options.implementFresh(ctx, isCurrent, runtime, timing);
  };

  return {
    async showSaved(ctx: ExtensionContext) {
      const lifecycle = options.captureLifecycle();
      if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
      const ui = await options.loadInteractiveUi();
      if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
      await ui.showSavedPlanMenu(ctx, {
        statusText: options.statusText(),
        implementationOutcome: options.implementationOutcome,
        getExportDestination: () => options.getExportDestination(ctx),
        signal: lifecycle.signal,
        isCurrent: lifecycle.isCurrent,
        show: () => options.show(ctx),
        implementHere: () => options.implementHere(ctx),
        implementFresh: (signal) => freshAction(ctx, lifecycle, signal, effectiveDefaults(ctx), "immediate"),
        exportPlan: (path, signal) => options.exportPlan(ctx, path, signal, lifecycle.isCurrent),
        settings: (signal) => options.settings(ctx, signal, lifecycle.isCurrent),
        clear: () => options.clearSaved(ctx),
      });
    },
    async showCurrent(ctx: ExtensionContext) {
      if (!ctx.hasUI) {
        ctx.ui.notify(options.statusText(), "info");
        return;
      }
      const lifecycle = options.captureLifecycle();
      if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
      const ui = await options.loadInteractiveUi();
      if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
      await ui.showPlanModeMenu(ctx, {
        statusText: options.statusText(),
        planThinkingLevel: options.getThinkingLevel(),
        implementationDefaults: configuredDefaults(),
        hasReadyPlan: options.getState().latestPlan !== undefined,
        implementationOutcome: options.implementationOutcome,
        getExportDestination: () => options.getExportDestination(ctx),
        ...lifecycle,
        show: () => options.show(ctx),
        finalize: () => options.finalize(ctx),
        implementHere: () => options.implementHere(ctx),
        implementFresh: (runtime, signal) => freshAction(ctx, lifecycle, signal, runtime, "immediate"),
        exportPlan: (path, signal) => options.exportPlan(ctx, path, signal, lifecycle.isCurrent),
        save: () => options.save(ctx),
        stay: () => options.stay(ctx),
        exit: () => options.exitReady(ctx),
      });
    },
    async showReady(ctx: ExtensionContext) {
      const lifecycle = options.captureLifecycle();
      if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
      const ui = await options.loadInteractiveUi();
      if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
      await ui.showReadyPlanMenu(ctx, {
        ...lifecycle,
        planThinkingLevel: options.getThinkingLevel(),
        implementationDefaults: configuredDefaults(),
        implementationOutcome: options.implementationOutcome,
        getExportDestination: () => options.getExportDestination(ctx),
        implementHere: () => options.implementHere(ctx),
        implementFresh: (runtime, signal) => freshAction(ctx, lifecycle, signal, runtime, "after-settled"),
        exportPlan: (path, signal) => options.exportPlan(ctx, path, signal, lifecycle.isCurrent),
        save: () => options.save(ctx),
        stay: () => undefined,
        exit: () => options.exitReady(ctx),
      });
    },
  };
}
