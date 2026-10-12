import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withImplementationModelAuthTimeout } from "./implementation-models.js";

export function savedPlanBlocksNewWorkflow(ctx: ExtensionContext, hasSavedPlan: boolean) {
  if (!hasSavedPlan) return false;
  const message = "A plan is saved for later. Implement or clear it before starting another Plan-mode workflow.";
  if (!ctx.hasUI) throw new Error(message);
  ctx.ui.notify(message, "warning");
  return true;
}

export async function preflightSavedPlanImplementation(ctx: ExtensionContext, isCurrent: () => boolean) {
  if (ctx.mode === "print" || ctx.mode === "json") {
    throw new Error("Saved plan implementation is unavailable in print/JSON mode. Use TUI or RPC.");
  }
  const model = ctx.model;
  if (!model) {
    ctx.ui.notify("Unable to implement saved plan: no model is selected.", "warning");
    return false;
  }
  let auth: Awaited<ReturnType<ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"]>>;
  try {
    // 认证有 2 秒上限：这里只有「通过」和「中止实施」两种结果，超时按失败处理并保留已保存方案。
    auth = await withImplementationModelAuthTimeout(() => ctx.modelRegistry.getApiKeyAndHeaders(model));
  } catch (error: unknown) {
    if (!isCurrent()) return false;
    const detail = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Unable to implement saved plan: ${detail}`, "error");
    return false;
  }
  if (!isCurrent()) return false;
  if (!auth.ok) {
    ctx.ui.notify(`Unable to implement saved plan: ${auth.error}`, "warning");
    return false;
  }
  return true;
}
