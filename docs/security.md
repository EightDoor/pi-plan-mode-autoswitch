# Security and privacy

[Back to README](../README.en.md#-important-limitations)

- [What Plan mode blocks](#what-plan-mode-blocks)
- [The tool policy](#the-tool-policy)
- [Restricted bash](#restricted-bash)
- [Restricted PowerShell](#restricted-powershell)
- [Trust overrides](#trust-overrides)
- [Helper tools and activation](#helper-tools-and-activation)
- [Data exposure](#data-exposure)

## What Plan mode blocks

While Plan mode is active the policy blocks the built-in editing tools and asks the agent not to edit files or implement changes.
It should explore first and raise a structured question when a preference or trade-off would materially change the plan.
Configure persistent defaults or a one-shot tool override before activation; activation and the ready state lock those controls.

The names `edit`, `write`, and `update_plan` stay blocked, and tools that were not selected are blocked even when their schema is still visible.
`update_plan` is blocked because it tracks execution progress rather than conversational planning.

This is a **policy**, not an operating-system sandbox, and it is not a confidentiality boundary.
Tests and builds may still write ignored caches or build artifacts, and they may run project-defined hooks; enable or invoke them only in a repository you trust.
Both restricted shell policies reduce risk but provide no sandbox and no secrecy boundary.

## The tool policy

Tools outside the reviewed core policy — including native MCP tools, native orchestration, extensions, and custom tools — are rejected by default; allow their names explicitly before starting a workflow when you accept the risk.
Server annotations such as `readOnlyHint` are unverified hints, not permission or a security guarantee.
For example, `/plan tools` or `defaultPlanTools` can allow `mcp__docs__read`, `mcp__firecrawl__firecrawl_scrape`, or `lsp_diagnostics` for the next workflow.

Direct and `model-only` tools must be active in Pi; a `model-only` tool cannot be called by another tool.
Registered `codemode` and `deferred` tools can be selected without direct activation and run through Pi's nested tool pipeline.
MCP's `codemode-deferred` follows its public `deferred` exposure.
Select an orchestrator such as `codemode` or `tool_search` separately when you need it: allowing it does not authorize its callees, and selecting an MCP tool does not enable its orchestrator.
Pi's `tool_search` can declare tools on its own, but a declaration does not add an unselected name to the frozen Plan policy.
Every nested call remains controlled on its own, including the editing and restricted-shell limits.
Hidden tools stay unavailable even when selected or listed as active; unsupported exposure and unavailable policy metadata fail closed.

Pi resolves tools by name.
The pre-start selector stores the accepted session policy names and shows each effective tool's origin and availability from Pi metadata, including native built-ins and extension registrations.
A selected name can run in Plan mode only when the effective tool is registered, available through its exposure, and allowed by the policy in the context where the workflow first binds the provider.
That allowlist is frozen at that boundary and accepts no new names after a reload, a resume, or tree navigation.
A tool that registers or becomes available later waits for the next Plan workflow; an already admitted callable tool keeps its admission even if it is only declared to the model later.
If an extension overrides a built-in name with the same name, Pi exposes the effective tool and the selector shows its origin.

Tools that were admitted before being disabled can be reactivated and reused inside the current workflow without a restart.
After they become visible, the Plan helper tools stay visible in Normal mode, but their handler and `tool_call` policy reject calls unless Plan mode owns the current active workflow.
Registered but inactive direct tools, unregistered tools, blocked core tools, and unselected tools each report their own distinct refusal reason.

## Restricted bash

Restricted `bash` uses a fail-closed Bash policy, and it stays in effect even when an extension overrides the canonical `bash` tool name.
It accepts common inspection commands, read-only Git and npm queries, pipelines and command lists built entirely from accepted commands, and selected checks such as `npm test`, `npm run typecheck`, and `cargo test`.
Inspection commands such as `rg`, `grep`, and `git grep` allow a case-insensitive `-i`, while commands where `-i` means in-place editing, such as `sed`, stay blocked.
It also accepts `hostname` without arguments and local Windows `tasklist` queries with reviewed display, filter, module, and service arguments.
Reviewed Git inspection may put `--no-pager` before the accepted subcommand.
It may also place one or more complete `-C <path>` argument pairs before the accepted subcommand, provided every path is `.` or Pi's current working directory itself.
Other targets are rejected so that `git -C` cannot introduce another repository's executable configuration, hooks, filters, signers, or lazily fetched remotes.
It rejects output and input redirection, shell expansion, command substitution, subshells, background tasks, incomplete or directory-changing `-C` argument pairs, other Git global options, Git config overrides, mutating flags, dependency changes, editors, and unknown commands.

## Restricted PowerShell

Restricted `powershell` uses a separate fail-closed PowerShell policy, and it stays in effect even when an extension overrides the canonical `powershell` tool name.
It accepts canonical inspection cmdlets such as `Get-ChildItem`, `Get-Content`, `Get-Item`, `Get-Location`, `Resolve-Path`, `Select-String`, `Test-Path`, `Measure-Object`, `Sort-Object`, `Format-List`, `Format-Table`, `Out-String`, and `Write-Output`.
It accepts local `Get-Process` and `Get-Service` queries with reviewed static selectors, while rejecting remote arguments and object input arguments.
It also accepts the same reviewed `git` and configured `gh` queries as restricted Bash, including pipelines and semicolon-separated command lists built entirely from accepted commands.
It rejects redirection, variables, command substitution, script blocks, call operators, type or method expressions, stop-parsing tokens, multiline input, non-ASCII quotes, aliases, mutating cmdlets, and unknown commands.
Use canonical cmdlet names, because PowerShell aliases are deliberately excluded from the reviewed policy.

A rejected parsed command list or pipeline names the first blocked command segment; malformed syntax or unsupported shell syntax echoes the complete submission.

## Trust overrides

The configured `safeSubcommands` mapping trusts only the command segments and arguments it parses itself; adjacent segments must each pass the policy, and syntax the parser does not support stays blocked.
A trusted command can still modify data or execute code with Pi's permissions.
See [Safe shell subcommands](./settings.md#safe-shell-subcommands) for the matching rules, the migration notes, and the trust boundary.

## Helper tools and activation

Plan mode registers `plan_mode_question` and `plan_mode_complete` when the extension loads, and it never changes their activation state itself.
If another active tool policy hides them, Plan mode's start or restore fails instead of relaxing that policy.
By default the Plan policy allows already-active safe built-ins such as `read`, restricted `bash`, restricted `powershell`, `grep`, `find`, and `ls`.
The optional native `powershell` tool must be active when an automatic Plan policy starts — for example through Pi's Windows `defaultTools` setting — unless its name is explicitly preserved for the first request resolution.

Helper tool schemas are stable from extension registration onward, and Plan mode does not call `setActiveTools()`.
Tool visibility alone is not Plan activation.
Only the latest effective active Plan contract authorizes the two helper tools; an inactive or stale call fails and neither accepts a plan nor opens the question UI.
Plan mode does not relax the restricted active tool policy; when the required helpers are unavailable, starting or restoring fails.

## Data exposure

Read-only does not mean private.
Git inspection can expose repository history and tracked secrets, and configured commands can expose or modify any data available to Pi's process.
Restricted inspection keeps Git inside Pi's current working directory for a built-in-policy `git -C <path>` call.
The default policy reduces accidental mutation and cross-repository executable configuration; configured `safeSubcommands` bypass command and argument protection only within matching segments.

Plan mode keeps the approved plan in the current session, and the plan change comparison reads the session branch's Plan state snapshots to find the earlier version.
The comparison is read-only: it writes no file, sends no message, and adds nothing to the model context.
