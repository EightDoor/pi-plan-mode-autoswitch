# 🧭 pi-plan-mode-autoswitch — Pi 改代码之前先出方案

**语言：中文 | [English](./README.en.md)**

[![npm](https://img.shields.io/npm/v/pi-plan-mode-autoswitch)](https://www.npmjs.com/package/pi-plan-mode-autoswitch) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

用类 Codex 的 `/plan` 模式探索代码库、澄清关键问题，并在 Pi 动手改文件之前批准一份可直接实施的方案。

> **Fork 说明**：本包是 [`@narumitw/pi-plan-mode`](https://www.npmjs.com/package/@narumitw/pi-plan-mode) v0.59.2 的独立 fork，新增了可选的 **Plan 边界自动切换模型** 与 **方案变更对比**。上游行为全部保留：自动切换模型默认关闭，方案变更对比在存在可比版本时自动提供。

## ✨ 功能

- 通过 `/plan`、`/plan start` 或 `/plan <prompt>` 启动并管理 Plan 模式。
- 规划阶段阻断编辑类工具与不安全的 shell 形式，同时保持辅助工具 schema 稳定。
- 用结构化问题澄清重要歧义，用 `plan_mode_complete` 产出可决策的完整方案。
- **方案变更对比**：方案修订后自动给出增删行摘要；`/plan diff` 或就绪菜单可查看逐行差异（只读，不改变方案、不进模型上下文）。
- 在当前会话或全新关联会话中实施已批准的方案；也可导出为 Markdown、保存到当前会话、继续规划或丢弃。
- 可选在 Plan 模式开始或结束时按候选链自动切换模型，并支持 Plan 阶段的额度降级。
- 跨 resume 与压缩恢复 Plan 状态和一份已保存方案。
- 可配置工具白名单、已审阅的 shell 子命令、导出路径、快捷键与思考深度。
- 向状态栏发布状态，并以匿名方式与 Workflow Mutex Protocol v1 参与者协作。

## 📦 安装

本版本要求 Pi 0.80.6 或更新；Windows 上的原生 PowerShell 工具支持要求 Pi 0.84.3 或更新。

```bash
pi install npm:pi-plan-mode-autoswitch
```

不想永久安装，可先试用：

```bash
pi -e npm:pi-plan-mode-autoswitch
```

在仓库根目录本地构建并试用：

```bash
npm install
npm run build
pi -e .
```

本包声明了 `dist/index.ts`，因此本地未构建的检出要先构建，Pi 才能加载包目录。只从你信任的来源安装，因为 Pi 扩展会以 Pi 的权限运行。

## 🚀 快速开始

运行 `/plan` 打开感知状态的菜单，然后启动 Plan 模式，让 agent 检查并设计这次改动。
如果第一次规划请求已经明确，直接用 `/plan <prompt>`。

## 🤖 自动模型切换（fork 新增）

默认关闭。开启 `autoSwitchModel` 后：

- `planModel` 是**进入** Plan 模式时的目标模型链；
- `normalModel` 是**退出** Plan 模式（退出、保存方案、任何实施入口）时的目标模型链；
- 两条链都按声明顺序回退，每个候选各有 2 秒认证预算，整条链都失败才保留当前模型；
- 每个候选可携带 `thinkingLevel`，切换成功后应用该等级，否则保留切换前的思考深度；
- Plan 阶段还有运行时额度降级：当前候选耗尽额度时切到链上的下一个候选并让同一请求继续一次。

```json
{
  "autoSwitchModel": true,
  "planModel": [
    { "provider": "<plan-provider>", "modelId": "<plan-model>", "thinkingLevel": "high" },
    { "provider": "<plan-fallback-provider>", "modelId": "<plan-fallback-model>" }
  ],
  "normalModel": [
    { "provider": "<normal-provider>", "modelId": "<normal-model>", "thinkingLevel": "xhigh" }
  ]
}
```

细节（认证预算、回退语义、额度降级、设置页行为）见 [设置参考](./docs/settings.md#auto-model-switch)。

## 💬 常用命令

| 命令 | 作用 |
| --- | --- |
| `/plan` | 启动或管理规划、审阅方案，或选择同会话/新会话实施。 |
| `/plan start` | 进入 Plan 模式，不发送模型消息。 |
| `/plan <prompt>` | 用提示开始规划，或在已激活时发送后续请求。 |
| `/plan tools` | 选择仅本会话生效的工具策略，然后启动；取消则不做任何更改。 |
| `/plan show` | 显示已存储的方案，不启动模型回合。 |
| `/plan diff` | 查看当前方案与上一版本的逐行差异（只读）。 |
| `/plan finalize` | 要求当前规划者收尾，或提出最后一个关键问题。 |
| `/plan implement` | 在本会话实施已完成或已保存的方案，不弹选择器。 |
| `/plan save` | 在本 Pi 会话中保存就绪方案并退出 Plan 模式。 |
| `/plan settings` | 打开与菜单中相同的 Plan 设置页。 |
| `/plan export [path]` | 把就绪、已保存或进行中的实施方案写成 Markdown。 |
| `/plan exit`（别名：`off`） | 退出 Plan 模式并丢弃其就绪方案，或清除已保存/进行中的方案。 |

所有路由同时支持 TUI 和 RPC。精确匹配子命令词会命中对应路由，其他文本都算规划提示，所以 `/plan start a migration` 会发送提示而不是拒绝尾部文本。

### 方案变更对比

同一轮规划里修订方案后，就绪菜单和状态组件会直接显示相对上一版本的增删行数；`/plan diff`（或就绪菜单里的 **查看方案变更**）打开只读的逐行差异。

- 基线只取当前会话分支里同一轮规划的上一份不同方案；重复提交同一份方案不算新版本。
- 退出 Plan 模式后重新开始、或恢复被拒绝后重新开始的轮次都没有可比版本。
- 没有可比的上一版本时不显示差异，只提示没有可比较的版本。
- 差异只读：不写文件、不发消息、不触发模型调用，也不会改变被批准、实施、导出或保存的方案。

更多细节见 [命令流程](./docs/command-workflows.md#compare-plan-versions)。

## ⚠️ 重要限制

- 打印模式和 JSON 模式没有交互界面，会在改变状态之前拒绝 `/plan` 菜单、`/plan tools`、`/plan settings` 和 `/plan diff`；这些模式请用 `/plan start`、`/plan <prompt>`、`/plan save`、`/plan export [path]`。纯文本打印模式只输出最后一条 assistant 消息，所以 `/plan show` 在那里看不到方案内容——要读方案请用 `/plan export`；JSON 模式会输出该事件。已保存方案的显示与实施需要 TUI 或 RPC。
- Plan 模式阻断 `edit`、`write`、`update_plan` 等修改类工具，并限制 `bash` / `powershell` 的可用形式。这是**策略**而不是操作系统沙箱，也不提供保密边界。
- 辅助工具可见不代表 Plan 模式已激活；只有最新的活动 Plan 契约才授权 `plan_mode_question` 与 `plan_mode_complete`。
- 未在 Pi 中激活的直接工具与隐藏工具在 Plan 模式里不可用；`model-only` 工具必须在 Pi 中激活才能被模型直接调用，但不能作为嵌套调用执行。显式放行某个工具等于信任它的实现。
- `safeSubcommands` 是仅 JSON、按命令段生效的信任覆盖，可以放行任意代码执行，只应为你完全信任的命令与仓库配置。
- 自动切换模型依赖当前会话的凭证；`pi.setModel()` 没有可取消的 API，认证通过后卡住的切换无法中断。
- 导出是显式的用户发起的文件写入；模型发起的写入在 Plan 模式里始终被阻断。
- 完整的安全模型、受限 shell 策略与信任边界见 [安全与隐私](./docs/security.md)。

## 📚 文档

- [命令流程](./docs/command-workflows.md)：`/plan` 各路由的完整行为、忙碌与恢复、实施交接、导出、方案变更对比。
- [设置参考](./docs/settings.md)：全部设置项、工具策略解析、再注入选择、自动模型切换、快捷键与安全子命令。
- [安全与隐私](./docs/security.md)：工具策略、受限 bash / PowerShell、信任边界与数据暴露。
- [进阶与实现细节](./docs/advanced.md)：缓存稳定的模式转换、流程共存、辅助工具契约、方案变更对比的实现方式与包结构。

## 🧩 Fork 与许可证

本包是 [`@narumitw/pi-plan-mode`](https://www.npmjs.com/package/@narumitw/pi-plan-mode) v0.59.2 的独立 fork：上游行为全部保留，自动切换模型默认关闭且由设置项控制，方案变更对比在有可比版本时自动提供。

许可证为 MIT，见 [`LICENSE`](./LICENSE)。

关键词：Pi extension, Pi coding agent, plan mode, Codex-like plan mode, AI coding workflow, read-only planning, implementation plan, automatic model switching, autoswitch, plan diff.
