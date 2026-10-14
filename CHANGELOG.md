# pi-plan-mode-autoswitch

## Unreleased

### Minor Changes

- Add runtime model fallback while Plan mode is active. When the selected `planModel` candidate ends its turn with a deterministic quota or usage-limit error — matched against the same terminal vocabulary Pi treats as non-retryable (ChatGPT usage limit, `GoUsageLimitError`, `FreeUsageLimitError`, `insufficient_quota`, out of budget, available balance, quota exceeded, billing, `subscription_sharing_usage_limit_exceeded`) — the extension switches to the next candidate later in the chain, omits that failed assistant response from the remaining model context, and requests one continuation so the same request continues on the fallback. The chain used at runtime is snapshotted when Plan mode becomes active and persisted with the workflow, so editing settings during an active workflow does not change it until Plan mode is exited and re-entered. A fallback that also exhausts its quota advances further down the chain, so the chain length bounds the retries. At the chain tail, or when every remaining candidate cannot be applied, the original error is kept, the context is left untouched, and no continuation is requested, with at most one warning. Fallback is skipped when the session model is no longer the candidate that failed, when omitting the failure would leave no runnable context, and for transient rate limits, overloads, network errors, context overflow, or aborted runs, which keep Pi's existing retry and compaction behavior. Runtime fallback covers only the Plan stage; implementation keeps the boundary fallback.
- Constrain `planModel` and `normalModel` to a non-empty array of model objects. Single-object configurations are no longer accepted; wrap the model in an array to migrate. Each array entry accepts an optional `thinkingLevel` (`off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max`) that the next Plan-boundary or fresh-implementation switch applies after the candidate succeeds; a fallback candidate uses its own level, the current planning level is preserved when no candidate carries one, and Pi's level clamp is reported as a single bounded warning. The Settings screen picks one model per direction, then asks for a bound thinking level on the same save, and writes a single-element array; ordered fallbacks and per-candidate levels remain configured through `pi-plan-mode.json`.
- Allow `planModel` and `normalModel` to be an ordered, non-empty array

## 0.1.0

### Minor Changes

- Forked from [`@narumitw/pi-plan-mode`](https://www.npmjs.com/package/@narumitw/pi-plan-mode) v0.59.2 and republished as a standalone package under the name `pi-plan-mode-autoswitch`.
- Adds the auto model switch feature on top of the upstream codebase. The feature optionally swaps the session model to a configured target when Plan mode starts, and restores a configured model when Plan mode ends or a ready plan is saved. Concurrent transitions are serialized, the current thinking level is preserved across the switch, and notifications are sanitized against terminal control characters. New settings: `autoSwitchModel` (master toggle), `planModel`, and `normalModel`. See the Settings screen of Plan mode for the configuration UI.

  See [the upstream changelog](https://github.com/narumiruna/pi-extensions/blob/main/packages/pi-plan-mode/CHANGELOG.md) for prior versions.

## 0.59.2

### Patch Changes

- 2708319: Require Pi TUI Kit's published questionnaire custom-editor fix so existing lockfiles cannot retain a Kit release that bypasses the configured editor factory or mishandles editor submissions and key-release cycles.

## 0.59.1

### Patch Changes

- 000bd50: Use Pi's publicly configured custom editor factory for TUI questionnaire answers and notes. Custom editors own editing and submission keys, while Ctrl+C remains hard cancellation and the main prompt editor stays untouched. Preserve raw expanded drafts, fragmented paste safety, default-editor and non-TUI behavior, and release questionnaire-owned editor instances when the interaction ends.
  
  Honor custom editor submission values without replacing intentional normalization with the original draft, and retain editor-owned key-release cycles across answer and note transitions.
- Updated dependencies [000bd50]
  - @narumitw/pi-tui-kit@0.65.2

## 0.59.0

### Minor Changes

- 51d8c21: Restrict `safeSubcommands` trust to individual parsed Bash and PowerShell segments. A matching prefix no longer exempts trailing commands or bypasses the shell parser: every segment must pass its own policy, and unsupported syntax such as redirects and multiline input remains blocked.
  
  This is a compatibility change from full-command trust. Simple configured commands and trusted arguments remain supported, but chains require each additional segment to be independently permitted. Run workflows requiring parser-unsupported syntax outside Plan mode after review. The settings schema is unchanged, and explicitly trusted commands and their arguments can still mutate data or execute code; this setting is not a read-only guarantee or sandbox.

## 0.58.4

### Patch Changes

- 9621cda: Distinguish inactive Pi tools from Plan-policy blocks in Settings and the pre-start picker, and explain how to enable built-in search tools through Pi settings without changing tool activation or execution policy.
- dbc6e8e: Allow explicit selection of native MCP and orchestration tools in Plan Mode. Honor registered callable exposure without direct activation while preserving automatic core defaults, frozen workflow policies, and per-call nested safety checks.
- acb3aaf: Allow case-insensitive inspection flags such as `rg -i` and `grep -i` in the Plan mode shell policy.

## 0.58.3

### Patch Changes

- 26e8801: Make Plan-mode shortcut changes explicitly take effect after `/reload` or restarting Pi. Keep startup shortcut registrations stable, remove ineffective live rebinding, and show the configured and startup-loaded values with reload guidance in Settings. Other settings retain their existing reload behavior.
- Updated dependencies [e6db042]
  - @narumitw/pi-tui-kit@0.65.1

## 0.58.2

### Patch Changes

- 8abd5b7: Keep generated extension runtime graphs inside Pi's Jiti-loaded TypeScript path to avoid duplicate peer-runtime evaluation during startup. Add measured generated runtimes for Context Management, Herdr, and TypeSafe Search.

## 0.58.1

### Patch Changes

- 67a3049: Adapt provider, transcript, usage, deferred-tool, and telemetry behavior to Pi's current runtime contracts, including accurate cache-warming accounting and exclusion from ordinary generation traces.

## 0.58.0

### Minor Changes

- b745330: Add persistent fresh implementation model and thinking defaults with a same-as-plan fallback.
- 0ef037d: Add one-shot model and thinking selection before fresh ready-plan implementation.

### Patch Changes

- 7c9a062: Defer automatic ready-plan fresh session handoffs until lifecycle dispatch and prompt cleanup finish.
- Updated dependencies [4485b49]
- Updated dependencies [6b1e009]
  - @narumitw/pi-tui-kit@0.62.0

## 0.57.1

### Patch Changes

- 31b3dde: Remove the implementation model and thinking selectors, restoring Plan implementation handoffs to the current model and normal thinking behavior.

## 0.57.0

### Minor Changes

- e2af16b: Add optional implementation model and thinking defaults plus per-menu implementation options for same-session and fresh-session handoffs. Apply choices only at implementation start without changing Pi defaults or automatically restoring the planner's model after a run ends.

### Patch Changes

- Updated dependencies [317f7bd]
  - @narumitw/pi-tui-kit@0.61.0

## 0.56.0

### Minor Changes

- e230348: Allow narrowly validated local `hostname`, `tasklist`, `Get-Process`, and `Get-Service` inspections in Plan mode by default.
- 708cc2e: Let users add arbitrary `safeSubcommands` entries and treat every configured command-subcommand prefix as fully trusted for Plan-mode Bash and PowerShell calls.

## 0.55.3

### Patch Changes

- 14068d2: Allow reviewed Git inspections to use current-working-directory `git -C <path>` forms, and report actionable reasons when Plan mode denies an unavailable, inactive, frozen, blocked, or unselected tool.

## 0.55.2

### Patch Changes

- Updated dependencies [40182e5]
  - @narumitw/pi-tui-kit@0.59.0

## 0.55.1

### Patch Changes

- b99b3db: Resolve explicitly selected tools registered before the first Plan request without mutating Pi's active tool schemas.

## 0.55.0

### Minor Changes

- b59cdbc: Remove the `toolVisibility` setting and keep Plan helper schemas stable from startup.
  Retired settings keys are ignored and preserved, while globally visible helper metadata now distinguishes `/plan` from ordinary planning workflows.

## 0.54.0

### Minor Changes

- ab467e0: Allow Pi's active native PowerShell tool to run reviewed read-only file, directory, Git, and GitHub inspections in Plan mode while blocking mutation and unsupported dynamic syntax.

## 0.53.1

### Patch Changes

- 02878f5: Add an editor-style divider above the Plan mode widget.
- 3346683: Publish generated lazy chunks at the JavaScript paths referenced by each extension runtime so deferred menus and implementations load correctly through Pi's Jiti loader.
- Updated dependencies [b9eba3a]
  - @narumitw/pi-tui-kit@0.58.0

## 0.53.0

### Minor Changes

- c194597: Make conversation-history-only implementation the default, use Codex-style kickoff prompts without active-plan injection, and clarify Plan reinjection controls.
- e74ee84: Add configurable Plan helper visibility and default to revealing the helper tools on the first successful Plan activation.
- 67eb77b: Remove the `--plan` startup flag. Start Plan mode after launch with `/plan start` or begin with a prompt through `/plan <prompt>`.
- da265a0: Keep Plan and Normal requests on one append-only conversation with stable tool schemas, versioned mode contracts, and a runtime Plan tool allowlist that no longer activates inactive tools.

### Patch Changes

- df584db: Keep unused resumed sessions free of mode contracts and reject `/tree` navigation to internal transition markers.
- 5be9aa2: Prevent active agent runs from mixing Plan and Normal tool contracts, and retry explicit structured finalization once after settlement when the model responds with prose only.

## 0.52.0

### Minor Changes

- 85d13c8: Coordinate Plan-mode activation through Workflow Mutex Protocol v1 so cooperating agent workflows cannot start in the same Pi session.

## 0.51.1

### Patch Changes

- 8540d0f: Simplify single-question TUI questionnaires with a plain header and immediate answer submission while retaining tabbed Review for multiple questions.
- 5785cb4: Reuse Pi TUI Kit's questionnaire runner while preserving Plan mode answer and lifecycle behavior.
- Updated dependencies [8540d0f]
  - @narumitw/pi-tui-kit@0.57.1

## 0.51.0

### Minor Changes

- 416da47: Add tabbed TUI Plan questions with answer notes and final review.

## 0.50.1

### Patch Changes

- 30bc076: Load each extension from a generated TypeScript runtime to reduce Jiti package startup work while preserving existing first-use boundaries.

## 0.50.0

### Minor Changes

- 160f2fc: Add an optional `toggleShortcut` setting and a **Plan mode shortcut** Settings row so the global Plan-mode keybinding can be chosen, and keep it disabled while the setting is omitted. Reload the settings file automatically when it changes and rebind the configured shortcut immediately after a Settings save.
