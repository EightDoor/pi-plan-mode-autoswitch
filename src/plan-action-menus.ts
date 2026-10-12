import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineMenu, runMenu, sanitizeTerminalText } from "@narumitw/pi-tui-kit";
import {
  type AvailableImplementationModel,
  findAvailableImplementationModel,
  type ImplementationModelOverride,
  snapshotAvailableImplementationModels,
} from "./implementation-models.js";
import { type PlanExportDestinationProvider, planExportInputScreen } from "./plan-export-screen.js";
import { IMPLEMENTATION_THINKING_LEVELS, type PlanModeFixedThinkingLevel } from "./settings.js";
import type { ImplementationRuntimeSelection } from "./state.js";

interface MenuLifecycle {
  signal: AbortSignal;
  isCurrent(): boolean;
}

const IMPLEMENTATION_CONTEXT_LINES = [
  "Implement here keeps this planning conversation.",
  "Start fresh transfers only the approved plan to a new session.",
] as const;

const THINKING_LEVEL_DESCRIPTIONS: Record<PlanModeFixedThinkingLevel, string> = {
  off: "No reasoning",
  minimal: "Very brief reasoning (~1k tokens)",
  low: "Light reasoning (~2k tokens)",
  medium: "Moderate reasoning (~8k tokens)",
  high: "Deep reasoning (~16k tokens)",
  xhigh: "Extra-high reasoning (~32k tokens)",
  max: "Maximum reasoning",
};

interface PlanMenuOptions extends MenuLifecycle {
  statusText: string;
  planThinkingLevel: PlanModeFixedThinkingLevel | undefined;
  implementationDefaults?: ImplementationRuntimeSelection;
  hasReadyPlan: boolean;
  implementationOutcome(): string;
  getExportDestination: PlanExportDestinationProvider;
  show(): void;
  finalize(): void;
  implementHere(): void | Promise<void>;
  implementFresh(runtime: ImplementationRuntimeSelection, signal: AbortSignal): void | Promise<void>;
  exportPlan(path: string, signal: AbortSignal): Promise<boolean>;
  save(): void | Promise<void>;
  stay(): void;
  exit(): void | Promise<void>;
}

export async function showPlanModeMenu(ctx: ExtensionContext, options: PlanMenuOptions) {
  type Screen = "main" | "fresh" | "models" | "thinking" | "export";
  type Action =
    | "show"
    | "finalize"
    | "implement-here"
    | "select-model"
    | "select-thinking"
    | "start-fresh"
    | "export"
    | "save"
    | "stay"
    | "exit";
  const freshFlow = createFreshImplementationFlow(
    ctx,
    options.planThinkingLevel,
    options.implementationDefaults,
    options.implementFresh,
  );
  const menu = defineMenu<undefined, Screen, Action, ExtensionContext>({
    start: "main",
    screens: {
      main: () => ({
        kind: "actions",
        title: "Plan mode",
        lines: [
          options.statusText,
          ...(options.hasReadyPlan ? [...IMPLEMENTATION_CONTEXT_LINES, options.implementationOutcome()] : []),
        ],
        items: options.hasReadyPlan
          ? [
              { id: "show", label: "Show latest proposed plan", action: "show" },
              {
                id: "implement-here",
                label: "Implement here",
                description: "Continue in this session with the planning conversation.",
                action: "implement-here",
              },
              {
                id: "implement-fresh",
                label: "Start fresh and implement",
                description: "Configure one-shot model and thinking choices first.",
                to: "fresh",
              },
              { id: "export", label: "Export plan…", to: "export" },
              { id: "save", label: "Save for later", action: "save" },
              { id: "stay", label: "Stay in Plan mode", action: "stay" },
              { id: "exit", label: "Discard plan and exit", action: "exit" },
            ]
          : [
              { id: "finalize", label: "Request final plan", action: "finalize" },
              { id: "stay", label: "Stay in Plan mode", action: "stay" },
              { id: "exit", label: "Exit Plan mode", action: "exit" },
            ],
        hint: "close",
      }),
      fresh: freshFlow.settingsScreen,
      models: freshFlow.modelScreen,
      thinking: freshFlow.thinkingScreen,
      export: () => planExportInputScreen(options.getExportDestination),
    },
    actions: {
      show: async () => {
        options.show();
        return { kind: "close" };
      },
      finalize: async () => {
        options.finalize();
        return { kind: "close" };
      },
      "implement-here": async () => {
        await options.implementHere();
        return { kind: "close" };
      },
      "select-model": async ({ itemId }) => {
        freshFlow.selectModel(itemId);
        return { kind: "back" };
      },
      "select-thinking": async ({ itemId }) => {
        freshFlow.selectThinking(itemId);
        return { kind: "back" };
      },
      "start-fresh": async ({ signal }) => {
        await freshFlow.start(signal);
        return { kind: "close" };
      },
      export: async ({ value, signal }) =>
        (await options.exportPlan(value ?? "", signal)) ? { kind: "close" } : { kind: "rejected" },
      save: async () => {
        await options.save();
        return { kind: "close" };
      },
      stay: async () => {
        options.stay();
        return { kind: "close" };
      },
      exit: async () => {
        await options.exit();
        return { kind: "close" };
      },
    },
  });
  await runMenu(ctx, menu, {
    getState: () => undefined,
    signal: options.signal,
    isCurrent: options.isCurrent,
  });
}

interface ReadyPlanMenuOptions extends MenuLifecycle {
  planThinkingLevel: PlanModeFixedThinkingLevel | undefined;
  implementationDefaults?: ImplementationRuntimeSelection;
  implementationOutcome(): string;
  getExportDestination: PlanExportDestinationProvider;
  implementHere(): void | Promise<void>;
  implementFresh(runtime: ImplementationRuntimeSelection, signal: AbortSignal): void | Promise<void>;
  exportPlan(path: string, signal: AbortSignal): Promise<boolean>;
  save(): void | Promise<void>;
  stay(): void;
  exit(): void | Promise<void>;
}

export async function showReadyPlanMenu(ctx: ExtensionContext, options: ReadyPlanMenuOptions) {
  type Screen = "ready" | "fresh" | "models" | "thinking" | "export";
  type Action =
    | "implement-here"
    | "select-model"
    | "select-thinking"
    | "start-fresh"
    | "export"
    | "save"
    | "stay"
    | "exit";
  const freshFlow = createFreshImplementationFlow(
    ctx,
    options.planThinkingLevel,
    options.implementationDefaults,
    options.implementFresh,
  );
  const menu = defineMenu<undefined, Screen, Action, ExtensionContext>({
    start: "ready",
    screens: {
      ready: () => ({
        kind: "actions",
        title: "Proposed plan ready. What next?",
        lines: [...IMPLEMENTATION_CONTEXT_LINES, options.implementationOutcome()],
        items: [
          {
            id: "implement-here",
            label: "Implement here",
            description: "Continue in this session with the planning conversation.",
            action: "implement-here",
          },
          {
            id: "implement-fresh",
            label: "Start fresh and implement",
            description: "Configure one-shot model and thinking choices first.",
            to: "fresh",
          },
          { id: "export", label: "Export plan…", to: "export" },
          { id: "save", label: "Save for later", action: "save" },
          { id: "stay", label: "Stay in Plan mode", action: "stay" },
          { id: "exit", label: "Discard plan and exit", action: "exit" },
        ],
        hint: "close",
      }),
      fresh: freshFlow.settingsScreen,
      models: freshFlow.modelScreen,
      thinking: freshFlow.thinkingScreen,
      export: () => planExportInputScreen(options.getExportDestination),
    },
    actions: {
      "implement-here": async () => {
        await options.implementHere();
        return { kind: "close" };
      },
      "select-model": async ({ itemId }) => {
        freshFlow.selectModel(itemId);
        return { kind: "back" };
      },
      "select-thinking": async ({ itemId }) => {
        freshFlow.selectThinking(itemId);
        return { kind: "back" };
      },
      "start-fresh": async ({ signal }) => {
        await freshFlow.start(signal);
        return { kind: "close" };
      },
      export: async ({ value, signal }) =>
        (await options.exportPlan(value ?? "", signal)) ? { kind: "close" } : { kind: "rejected" },
      save: async () => {
        await options.save();
        return { kind: "close" };
      },
      stay: async () => {
        options.stay();
        return { kind: "close" };
      },
      exit: async () => {
        await options.exit();
        return { kind: "close" };
      },
    },
  });
  await runMenu(ctx, menu, {
    getState: () => undefined,
    signal: options.signal,
    isCurrent: options.isCurrent,
  });
}

interface ModelChoice {
  itemId: string;
  model: ImplementationModelOverride;
  modelInfo: AvailableImplementationModel;
  label: string;
  summary: string;
  details?: readonly string[];
  searchText: string;
  isPlanModel: boolean;
}

function createFreshImplementationFlow(
  ctx: ExtensionContext,
  planThinkingLevel: PlanModeFixedThinkingLevel | undefined,
  implementationDefaults: ImplementationRuntimeSelection | undefined,
  implementFresh: (runtime: ImplementationRuntimeSelection, signal: AbortSignal) => void | Promise<void>,
) {
  const models = snapshotAvailableModels(ctx);
  const planModel = ctx.model ? { provider: ctx.model.provider, modelId: ctx.model.id } : undefined;
  const planModelSummary = ctx.model
    ? `${safeModelMetadata(ctx.model.id, "unknown model")} [${safeModelMetadata(ctx.model.provider, "unknown provider")}]`
    : undefined;
  // 配置的有序候选链：界面高亮首个可用项，未手工改选时把整条链交给实施流程。
  const configuredChain = [
    ...(implementationDefaults?.model ? [implementationDefaults.model] : []),
    ...(implementationDefaults?.fallbackModels ?? []),
  ];
  const availableModelInfos = models.map((choice) => choice.modelInfo);
  const configuredAvailableIndex = configuredChain.findIndex((candidate) =>
    findAvailableImplementationModel(availableModelInfos, candidate),
  );
  const configuredModel = configuredChain[0];
  const configuredAvailableModel =
    configuredAvailableIndex < 0
      ? undefined
      : findAvailableImplementationModel(availableModelInfos, configuredChain[configuredAvailableIndex]);
  let unavailableDefaultActive = configuredChain.length > 0 && !configuredAvailableModel;
  let selectedModel = configuredAvailableModel
    ? models.find((choice) => choice.modelInfo === configuredAvailableModel)
    : undefined;
  let selectedModelUsesDefault = selectedModel !== undefined;
  // 未手工改选时整条链按顺序交给实施流程：首个可用候选作主模型，其余作后备。
  let selectedChain = configuredAvailableIndex < 0 ? [] : configuredChain.slice(configuredAvailableIndex);
  // 一次性 thinking 选择：undefined 表示「未显式改选」，让 apply 路径回退到候选绑定等级。
  // 显示用的「默认 level」（候选绑定或规划等级）由 selectedThinkingLevelForDisplay 单独计算。
  // 一次性 thinking 选择：仅当 controller 判定整条链无绑定等级时才会从 runtime 默认继承规划等级；
  // 链上任一候选绑定了等级时这里是 undefined，让 apply 路径用实际成功候选的等级。
  let selectedThinkingLevel = implementationDefaults?.thinkingLevel;
  // 当前生效的模型候选（未手工改选 = 重解析后仍可用的首选；改选过 = 用户选中的模型）。
  const activeConfiguredModel = (): ImplementationModelOverride | undefined =>
    selectedModelUsesDefault
      ? configuredChain[configuredAvailableIndex < 0 ? 0 : configuredAvailableIndex]
      : selectedModel?.model;
  return {
    settingsScreen: () => ({
      kind: "actions" as const,
      title: "Fresh implementation settings",
      lines: [
        "These choices apply once to the new implementation session.",
        ...(unavailableDefaultActive && configuredModel
          ? [`Configured default ${safeModelReference(configuredModel)} is unavailable; using same as plan.`]
          : []),
      ],
      items: [
        {
          id: "start-fresh",
          label: "Start fresh implementation",
          description: "Create the linked session and begin implementation.",
          action: "start-fresh" as const,
          busyLabel: "Starting fresh implementation session…",
        },
        {
          id: "implementation-model",
          label: "Model",
          description:
            selectedModel?.summary ?? (planModelSummary ? `${planModelSummary} · same as plan` : "Same as plan"),
          to: "models" as const,
        },
        {
          id: "implementation-thinking",
          label: "Thinking level",
          description:
            selectedThinkingLevel ??
            activeConfiguredModel()?.thinkingLevel ??
            (planThinkingLevel ? `${planThinkingLevel} · same as plan` : "Same as plan"),
          to: "thinking" as const,
        },
      ],
    }),
    modelScreen: () => ({
      kind: "choice" as const,
      title: "Implementation model",
      items: [
        {
          id: "same-as-plan",
          label: "Same as plan",
          ...(planModelSummary ? { description: planModelSummary } : {}),
        },
        ...models.map((choice) => ({
          id: choice.itemId,
          label: choice.label,
          details: choice.details,
          searchText: choice.searchText,
        })),
      ],
      action: "select-model" as const,
      initialItemId: selectedModel?.itemId ?? "same-as-plan",
      enableSearch: true,
      viewportSize: 10,
    }),
    thinkingScreen: () => ({
      kind: "choice" as const,
      title: "Implementation thinking level",
      items: [
        {
          id: "same-as-plan",
          label: "Same as plan",
        },
        ...IMPLEMENTATION_THINKING_LEVELS.map((level) => ({
          id: level,
          label: `${level === planThinkingLevel ? "✓ " : ""}${level}`,
          description: THINKING_LEVEL_DESCRIPTIONS[level],
        })),
      ],
      action: "select-thinking" as const,
      initialItemId: selectedThinkingLevel ?? activeConfiguredModel()?.thinkingLevel ?? "same-as-plan",
      viewportSize: IMPLEMENTATION_THINKING_LEVELS.length + 1,
    }),
    selectModel(itemId: string) {
      const choice = models.find((candidate) => candidate.itemId === itemId);
      selectedModel = itemId === "same-as-plan" || choice?.isPlanModel ? undefined : choice;
      // 手工选择只应用一个模型，不再拼接 JSON 配置的回退链。
      selectedChain = selectedModel ? [selectedModel.model] : [];
      selectedModelUsesDefault = false;
      unavailableDefaultActive = false;
    },
    selectThinking(itemId: string) {
      selectedThinkingLevel = IMPLEMENTATION_THINKING_LEVELS.find((level) => level === itemId);
    },
    start(signal: AbortSignal) {
      if (selectedModelUsesDefault) {
        // 菜单打开期间模型目录可能变化：按剩余候选链重新解析，首个可用候选作主模型，其余仍作后备。
        const available = snapshotAvailableImplementationModels(ctx);
        const usable = selectedChain.filter((candidate) => findAvailableImplementationModel(available, candidate));
        const displayed = selectedChain[0];
        if (usable.length === 0) {
          selectedModel = undefined;
          selectedChain = [];
          selectedModelUsesDefault = false;
          unavailableDefaultActive = true;
          ctx.ui.notify(
            `Configured default ${safeModelReference(configuredModel)} is unavailable; using same as plan.`,
            "warning",
          );
        } else {
          const [model] = usable;
          if (displayed && (displayed.provider !== model.provider || displayed.modelId !== model.modelId)) {
            ctx.ui.notify(
              `Configured default ${safeModelReference(displayed)} is unavailable; using ${safeModelReference(model)}.`,
              "warning",
            );
          }
          selectedChain = usable;
          selectedModel = models.find(
            (choice) => choice.modelInfo.provider === model.provider && choice.modelInfo.id === model.modelId,
          );
        }
      }
      // 手工选择只用一个模型；未改选时用整条链；两者都没有才回到规划模型。
      let chain: ImplementationModelOverride[] = [];
      if (selectedModelUsesDefault) chain = selectedChain;
      else if (selectedModel) chain = [selectedModel.model];
      else if (planModel) chain = [planModel];
      const [model, ...fallbackModels] = chain;
      // 一次性 thinking 仅由用户显式改选产生；继承的规划等级走 inheritedThinkingLevel（最低优先级），
      // 候选绑定等级在 apply 路径按「一次性 > 候选 > 继承」参与裁决，不会被规划等级压掉。
      const inheritedThinkingLevel = implementationDefaults?.inheritedThinkingLevel ?? planThinkingLevel;
      const thinkingLevel = selectedThinkingLevel;
      return implementFresh(
        {
          ...(model ? { model: { ...model } } : {}),
          ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
          ...(inheritedThinkingLevel ? { inheritedThinkingLevel } : {}),
        },
        signal,
      );
    },
  };
}

function snapshotAvailableModels(ctx: ExtensionContext): ModelChoice[] {
  return snapshotAvailableImplementationModels(ctx)
    .map((model, index) => {
      const provider = safeModelMetadata(model.provider, "unknown provider");
      const modelId = safeModelMetadata(model.id, "unknown model");
      const name = safeModelMetadata(model.name, "");
      const isPlanModel = ctx.model?.provider === model.provider && ctx.model.id === model.id;
      const summary = `${modelId} [${provider}]`;
      return {
        itemId: `model-${index}`,
        model: { provider: model.provider, modelId: model.id },
        modelInfo: model,
        label: `${isPlanModel ? "✓ " : ""}${summary}${isPlanModel ? " · default" : ""}`,
        summary,
        ...(name ? { details: [`Model Name: ${name}`] } : {}),
        searchText: [provider, modelId, name].filter(Boolean).join(" "),
        isPlanModel,
      };
    })
    .sort((left, right) => Number(right.isPlanModel) - Number(left.isPlanModel));
}

function safeModelReference(model: ImplementationModelOverride | undefined) {
  if (!model) return "configured model";
  return `${safeModelMetadata(model.modelId, "unknown model")} [${safeModelMetadata(model.provider, "unknown provider")}]`;
}

function safeModelMetadata(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const safe = sanitizeTerminalText(value).trim() || fallback;
  return [...safe].slice(0, 512).join("");
}
