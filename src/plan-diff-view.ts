import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runDocumentReview } from "@narumitw/pi-tui-kit";

export interface PlanChangesViewOptions {
  title: string;
  summary: string;
  content: string;
  signal: AbortSignal;
  isCurrent(): boolean;
}

/**
 * 只读展示方案差异：Kit 的 review 界面只渲染文本，不发消息、不写文件，也不进模型上下文。
 */
export async function showPlanChangesView(ctx: ExtensionContext, options: PlanChangesViewOptions) {
  await runDocumentReview(ctx, {
    title: options.title,
    lines: [options.summary],
    content: options.content,
    format: { kind: "diff" },
    hint: "close",
    signal: options.signal,
    isCurrent: options.isCurrent,
  });
}
