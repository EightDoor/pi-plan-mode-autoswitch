# 🧭 pi-plan-mode-autoswitch — plan before Pi touches your code

**Language: English | [中文](./README.md)**

[![npm](https://img.shields.io/npm/v/pi-plan-mode-autoswitch)](https://www.npmjs.com/package/pi-plan-mode-autoswitch) [![Pi extension](https://img.shields.io/badge/Pi-extension-blue)](https://pi.dev) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Explore a codebase with a Codex-like `/plan` mode, clarify the questions that matter, and approve an implementation-ready plan before Pi edits a single file.

> **Fork note**: this package is an independent fork of [`@narumitw/pi-plan-mode`](https://www.npmjs.com/package/@narumitw/pi-plan-mode) v0.59.2 that adds optional **automatic model switching at Plan boundaries** and a **plan change comparison**. Every upstream behavior is preserved: automatic model switching is off by default, and the plan change comparison appears whenever an earlier version is comparable.

## ✨ Features

- Start and manage Plan mode with `/plan`, `/plan start`, or `/plan <prompt>`.
- Block editing tools and unsafe shell forms while planning, and keep the helper tool schemas stable.
- Clarify important ambiguities with structured questions and finish with a decision-ready plan from `plan_mode_complete`.
- **Plan change comparison**: a revised plan reports its added and removed line counts automatically; `/plan diff` or the ready-plan menu opens the line-level diff (read-only, it never changes the plan or enters model context).
- Implement the approved plan in this session or in a fresh linked session; export it as Markdown, save it for later, keep planning, or discard it.
- Optionally switch the session model at Plan-mode boundaries through an ordered candidate chain, including runtime quota fallback during the Plan stage.
- Restore Plan state and one saved plan across resume and compaction.
- Configure the tool allowlist, reviewed shell subcommands, export destination, shortcut, and thinking level.
- Publish a status line and cooperate anonymously with other Workflow Mutex Protocol v1 participants.

## 📦 Install

This release requires Pi 0.80.6 or newer; native PowerShell tool support on Windows requires Pi 0.84.3 or newer.

```bash
pi install npm:pi-plan-mode-autoswitch
```

Try it without installing permanently:

```bash
pi -e npm:pi-plan-mode-autoswitch
```

Build and try the repository locally:

```bash
npm install
npm run build
pi -e .
```

The package declares `dist/index.ts`, so an unbuilt checkout must be built before Pi can load the package directory. Install only from sources you trust: Pi extensions run with Pi's permissions.

## 🚀 Quick start

Run `/plan` to open the state-aware menu, then start Plan mode and let the agent inspect and design the change.
When the first planning request is already clear, use `/plan <prompt>` directly.

## 🤖 Automatic model switching (fork addition)

Off by default. With `autoSwitchModel` enabled:

- `planModel` is the target chain when Plan mode **starts**;
- `normalModel` is the target chain when Plan mode **ends** (exit, plan save, or any implementation entry point);
- both chains fall back in declaration order, each candidate gets its own two-second authentication budget, and the current model is kept only when the whole chain fails;
- each candidate may carry a `thinkingLevel`, which is applied after a successful switch; without one, the pre-switch thinking level is preserved;
- the Plan stage also has runtime quota fallback: when the active candidate exhausts its quota, the extension switches to the next candidate in the chain and lets the same request continue once.

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

Details (authentication budget, fallback semantics, quota fallback, settings screen behavior) are in the [settings reference](./docs/settings.md#auto-model-switch).

## 💬 Common commands

| Command | Purpose |
| --- | --- |
| `/plan` | Start or manage planning, review the plan, or choose same-session vs. new-session implementation. |
| `/plan start` | Enter Plan mode without sending a model message. |
| `/plan <prompt>` | Start planning with a prompt, or send a follow-up while already active. |
| `/plan tools` | Choose a session-scoped tool policy, then start; cancelling changes nothing. |
| `/plan show` | Show the stored plan without starting a model turn. |
| `/plan diff` | Show the line-level diff between the current plan and the previous version (read-only). |
| `/plan finalize` | Ask the current planner to wrap up, or to raise one last important question. |
| `/plan implement` | Implement the completed or saved plan in this session, without a picker. |
| `/plan save` | Save the ready plan in this Pi session and leave Plan mode. |
| `/plan settings` | Open the same Plan settings page as the menu. |
| `/plan export [path]` | Write the ready, saved, or in-progress implementation plan to Markdown. |
| `/plan exit` (alias `off`) | Leave Plan mode and discard its ready plan, or clear the saved/in-progress plan. |

Every route works in TUI and RPC. Only an exact subcommand word selects a route; any other text is a planning prompt, so `/plan start a migration` sends a prompt instead of rejecting the trailing text.

### Plan change comparison

After you revise a plan within the same planning round, the ready-plan menu and the status widget report the added and removed line counts against the previous version. `/plan diff` (or **View plan changes** in the ready-plan menu) opens the read-only line-level diff.

- The baseline is the previous *different* plan of the same planning round on the current session branch; resubmitting the same plan does not create a new version.
- A round that starts after Plan mode was left and re-entered, or after a restore was refused, has no comparable earlier version.
- Without a comparable earlier version nothing is shown; the extension only reports that there is nothing to compare.
- The diff is read-only: it writes no file, sends no message, triggers no model call, and never changes the plan that gets approved, implemented, exported, or saved.

More detail is in [command workflows](./docs/command-workflows.md#compare-plan-versions).

## ⚠️ Important limitations

- Print and JSON modes have no interactive UI, so they reject the `/plan` menu, `/plan tools`, `/plan settings`, and `/plan diff` before changing any state; use `/plan start`, `/plan <prompt>`, `/plan save`, and `/plan export [path]` there instead. Plain-text print mode only outputs the last assistant message, so `/plan show` displays nothing visible there — read the plan with `/plan export`; JSON mode does emit the event. Showing and implementing a *saved* plan needs TUI or RPC.
- Plan mode blocks `edit`, `write`, `update_plan`, and similar mutating tools and restricts the accepted `bash` / `powershell` forms. That is a **policy**, not an operating-system sandbox, and it is not a confidentiality boundary.
- Helper tool visibility does not mean Plan mode is active; only the latest effective Plan contract authorizes `plan_mode_question` and `plan_mode_complete`.
- Direct tools that Pi has not activated and hidden tools stay unavailable in Plan mode; a `model-only` tool must be active in Pi to be called by the model, and it can never run as a nested call. Explicitly allowing a tool trusts its implementation.
- `safeSubcommands` is a JSON-only, per-command-segment trust override that can allow arbitrary code execution; configure it only for commands and repositories you fully trust.
- Automatic model switching relies on the session's credentials, and `pi.setModel()` has no cancellable API, so a switch that hangs after authentication cannot be interrupted.
- Exporting is an explicit, user-initiated file write; model-initiated writes stay blocked in Plan mode.
- The full security model, restricted shell policies, and trust boundaries are documented in [Security and privacy](./docs/security.md).

## 📚 Documentation

- [Command workflows](./docs/command-workflows.md): what every `/plan` route does, busy and recovery behavior, implementation handoff, export, and plan change comparison.
- [Settings reference](./docs/settings.md): every setting, tool policy resolution, plan reinjection choices, automatic model switching, the shortcut, and safe shell subcommands.
- [Security and privacy](./docs/security.md): the tool policy, restricted bash and PowerShell, trust boundaries, and data exposure.
- [Advanced and internals](./docs/advanced.md): cache-stable mode transitions, workflow coexistence, the helper tool contract, how plan change comparison is implemented, and the package layout.

## 🧩 Fork and license

This package is an independent fork of [`@narumitw/pi-plan-mode`](https://www.npmjs.com/package/@narumitw/pi-plan-mode) v0.59.2: every upstream behavior is preserved, automatic model switching is off by default and controlled by settings, and the plan change comparison appears whenever an earlier version is comparable.

Licensed under the MIT License; see [`LICENSE`](./LICENSE).

Keywords: Pi extension, Pi coding agent, plan mode, Codex-like plan mode, AI coding workflow, read-only planning, implementation plan, automatic model switching, autoswitch, plan diff.
