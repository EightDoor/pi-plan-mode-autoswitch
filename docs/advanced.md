# Advanced behavior and internals

[Back to README](../README.en.md#-documentation)

- [Cache-stable mode transitions](#cache-stable-mode-transitions)
- [Workflow coexistence](#workflow-coexistence)
- [The helper tool contract](#the-helper-tool-contract)
- [Thinking level](#thinking-level)
- [Plan change comparison internals](#plan-change-comparison-internals)
- [Codex-like behavior](#codex-like-behavior)
- [Package layout](#package-layout)

## Cache-stable mode transitions

Plan and Normal requests share one append-only conversation.
The extension appends a hidden, model-visible, versioned Plan contract before the first Plan prompt, and a Normal contract before the first Normal or implementation prompt after it.
Ordinary linear turns neither rewrite nor duplicate those contracts.
The Plan contract explains on-demand native tool activation and per-call nested enforcement; that wording only affects future Plan transitions and never rewrites existing transition messages.
**Implement here** keeps the Plan conversation, structured questions, tool calls, completion evidence, and the `Implement the plan.` kickoff in order.
**Start fresh and implement** is the isolated path and transfers only the approved plan and the Normal contract into a linked session.

The `context` hook filters duplicated legacy `plan-mode-context` artifacts while keeping the current transition messages.
If compaction removed the effective transition, the hook inserts a canonical fallback at a deterministic retained-history boundary.
Repeated transforms keep that fallback in place instead of moving it to the latest turn.
Inactive legacy state entries never inject a Normal contract, so a session that never entered Plan mode keeps its ordinary context after a resume or reload.
Manual `/tree` navigation restores the branch-held Plan state and selects the matching contract without navigating or adding a branch summary.
Pi lists hidden transition messages in `/tree`; Plan mode rejects those internal targets, so select the adjacent conversation entry instead.

Stable schemas preserve a cacheable prefix but cannot guarantee a cache hit, because provider serialization, cache lifetime, minimum prefix length, implementation details, and session affinity stay outside this extension's control.

**Cache boundary.** The extension does not rewrite a prefix it has already shown a model in the flow it controls end to end: a fresh implementation session receives the approved plan once as an ordinary user message and keeps it, so the target model's later requests keep the same prefix. The remaining boundaries do change the prefix, by design: the guaranteed-plan policies add and remove their hidden plan block when their cleanup boundary is reached; a same-session implementation drops the superseded plan versions' completion calls and results so only the approved plan stays; an explicit `/plan exit` drops the active plan and its reinjection but leaves text already delivered as an ordinary message in the conversation history; and switching models, starting a new session, changing reasoning parameters, or compacting all replace the prefix. Reuse after such a boundary depends on the provider.

## Workflow coexistence

Plan mode can be installed on its own and keeps its standalone behavior when no other protocol participant exists.
On a characterized Pi `0.84.2` runtime it participates in the anonymous `workflow:mutex:v1` `agent-workflow` group.
It holds that group while planning is active, while a ready plan waits for review, and while modifications are in progress.
A saved plan and ordinary implementation after a Plan handoff do not hold the group.

Every start from an inactive state performs one final synchronous admission after the asynchronous preflight and before it changes Plan state, persistence, prompts, tools, thinking level, queues, or status.
If another participant is active, TUI and RPC show an anonymous warning that another workflow is running, and the direct routes in print and JSON modes raise the same anonymous error before changing anything.

The launch menu, the selected tools, the shortcut, **Start new plan** during implementation, and a restored activation all use that same admission boundary.
A rejected start with selected tools does not save its draft selection.

A restored active Plan state acquires the lock before it restores restricted tools, thinking level, status, or model hooks.
If the session is busy on restore, Plan mode stays inactive, leaves persisted history and active tools untouched, and asks you to reload or start again explicitly after the other workflow finishes.
When a restore fails because the Plan helper tools are unavailable, Plan mode stays inactive, releases the workflow lock it holds, restores the thinking level it applied, and clears the status, so the next start is not blocked by its own lock.
Cancelling the planning session during a fresh-session implementation preflight keeps the source Plan and its ownership.
A successful session replacement relies on the source session's shutdown to clean up and release; ordinary active implementation in the destination does not take the Plan mutex.

That coexistence guarantee is cooperative: it only holds when every competitor implements v1, runs on a characterized Pi runtime, and shares the same event bus and session manager identity.
Peers before v1, mixed versions, non-participants, forks, and other uncharacterized runtimes do not support the mutex.
Plan mode does not identify, inspect, configure, start, stop, or depend on other extensions.
Coexisting with Goal's guarantee requires a characterized Pi `0.84.2` runtime, `@narumitw/pi-goal` `0.53.0` or newer, and this package `0.52.0` or newer.

| Installation combination | Support |
| --- | --- |
| Plan mode without other workflow participants | Standalone behavior supported |
| Plan mode `>=0.52.0` with Goal `>=0.53.0` on Pi `0.84.2` | Workflow Mutex v1 coexistence guarantee |
| Either package below its floor, or another Pi runtime | Standalone behavior only; no mutex |

## The helper tool contract

Plan mode registers `plan_mode_question` and `plan_mode_complete` once and keeps their names and definitions stable across Normal, Plan, ready, implementation, and restore flows.
Helper tool visibility does not mean `/plan` is active, and their descriptions do not cover ordinary planning, the `writing-plans` skill, roadmaps, checklists, and plan-file work.
Only the latest effective Plan contract authorizes the two helper tools; an inactive or stale call fails and neither accepts a plan nor opens the question UI.
Plan mode does not relax the restricted active tool policy; a start or restore fails when the required helpers are unavailable.

## Thinking level

The default `thinkingLevel: "inherit"` avoids Plan-specific reasoning-parameter changes.
A fixed Plan thinking level is still supported, but changing reasoning parameters can prevent provider-side state reuse even when the prompt and tool schemas stay stable.

## Plan change comparison internals

The comparison is implemented in a dependency-free module that never touches the UI toolkit, so its algorithms stay deterministic and testable on their own.

- **Version history**: the module reads the `plan-mode-state` custom entries of the current session branch. Each entry that records a completed plan while Plan mode is enabled contributes one version, and the unique workflow id persisted with the Plan state splits the branch into planning rounds. Sessions created before that id existed fall back to the Plan enable/disable boundaries.
- **Baseline selection**: the baseline is the previous *different* version inside the current planning round. Resubmitting the same plan collapses into the existing version, so `A → B → A` compares the current `A` against `B`. A version from another round is never used, including a workflow that started after a failed restore, which leaves no persisted Plan-mode exit behind.
- **Line diff**: common leading and trailing lines are trimmed, the middle section is matched with a longest-common-subsequence pass, and the result is rendered as a unified diff with three context lines per hunk and hunk headers that carry the old and new line counts.
- **Bounded work**: the LCS matrix is capped at one million cells. A larger middle section falls back to replacing the whole block, and the summary marks that result as simplified.
- **Caching**: results are cached by the pair of plan texts, so the same comparison is not recomputed while the menu, the status widget, and the diff viewer ask for it.

The viewer itself reuses the toolkit's read-only document review: the ready-plan menu opens it as a review screen, and `/plan diff` opens it as a standalone document. Both paths sanitize terminal control characters, paginate long diffs, and keep the display read-only.

## Codex-like behavior

This extension maps Codex's `ModeKind::Plan` behavior onto Pi's extension API:

- Plan mode is conversational collaboration, not a todo or progress tracker.
- `/plan <prompt>` enters Plan mode first and then sends the prompt.
- The agent handles important preferences with `plan_mode_question` and finishes with an isolated `plan_mode_complete` call instead of prose inference.
- `update_plan` is blocked until an explicit implementation boundary restores Normal mode.
- The default `clear-on-start` policy uses conversation history; `clear-after-first-run` and `keep` add the exact-plan guarantee.
- The append-only Plan and Normal contracts keep the helper tool schemas stable, but Pi's tool policy is risk reduction rather than Codex's sandbox-grade enforcement.

## Package layout

```text
.
├── src/                               # policy, question, settings, and handoff modules
│   ├── index.ts                       # the slim Pi entry point
│   ├── plan-mode.ts                   # planning policy and implementation handoff
│   ├── plan-diff.ts                   # plan version history and the line diff
│   └── plan-diff-view.ts              # the read-only diff viewer
├── dist/                              # the generated Jiti runtime
├── scripts/
│   ├── build-runtime.mjs              # the runtime builder
│   └── runtime-builder.mjs            # the shared esbuild split-Jiti helper
├── docs/                              # the published reference documentation
└── test/                              # behavior and lifecycle coverage
```

The generated runtime is built from `src/index.ts` and never imports `src` backwards.
The runtime builder keeps the interactive UI in a lazy chunk: `@narumitw/pi-tui-kit` and the interactive modules are never part of the eager entry graph, so a session that never opens a menu never loads them.
