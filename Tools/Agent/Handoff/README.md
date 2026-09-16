# Task handoff boundary

The V1 handoff is intentionally explicit:

```text
clipboard or -Text -> marker check/parser -> TaskDefinition -> router -> PiLauncher -> terminal report -> GitHub/local
```

`TaskParser.psm1` knows only the `@@PI_TASK` protocol and returns normalized data. `TaskRouter.psm1` knows routing configuration, skills, and the deterministic project/ticket session identifier. `PiLauncher.psm1` knows only the normalized task, route, and a verified launcher configuration. `WishlistReporting.psm1` is the terminal reporting boundary: it receives only the normalized task identity, route, final Pi response, and structured usage, never the raw clipboard envelope. None of these layers scrape ChatGPT or watch the clipboard continuously.

Use `Invoke-WishlistTask.ps1` with no `-Apply` for a preview. Preview resolves the executable and expanded invocation shape but starts neither Pi nor a help probe. `-Apply` is the only live-launch request. Invalid/unmarked input and blocked routes never reach the launcher.

The verified local contract is Pi 0.85.1 via the Windows `pi.cmd` entry point. `routing.json` passes the configured OpenAI Codex provider and real model ID with Pi's documented `--print`, `--mode json`, `--thinking`, `--session-id`, and `--approve` options. The task context is written to stdin because Pi's print mode explicitly merges piped stdin into the initial prompt. A live Apply re-probes `pi.cmd --help` before starting the process. JSON event output is parsed only according to Pi's documented event shape: the final assistant text is returned, and the latest provider-reported token/cost usage is shown when present. A JSON Apply is successful only when a valid session event and terminal `agent_end` event are observed; empty, malformed, truncated, or otherwise incomplete streams remain non-success even with process exit code 0. Missing or zero usage is diagnostic data, not a success gate, and no usage scraping or estimation is performed.

## Daily hotkey

`Start-WishlistHandoffHotkey.ps1` is a small native Windows host. It registers the selected global combination with Win32 `RegisterHotKey`, reads the clipboard only after that key press, and invokes the same `Invoke-WishlistTask.ps1 -FromClipboard -Apply` boundary. The default is `Ctrl+Alt+W`; the established `Ctrl+Shift+P`, `Ctrl+Alt+P`, and `Ctrl+Alt+H` combinations remain supported as explicit options. It is not a clipboard watcher and it does not use AutoHotkey, a browser, DOM access, or administrator privileges. The console reports `BLOCKED` before forwarding invalid/unmarked/empty input, then shows `ROUTE`, `TASK ACCEPTED / STARTED`, `RESPONSE`, optional `USAGE`, `COMPLETE`, `FAILED`, or explicit `CANCELLED` feedback.

The optional user-scoped Startup shortcut is deliberately created only when the user runs the installer. Reviewable setup and teardown are:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Tools\Agent\Handoff\Install-WishlistHandoff.ps1 -RepoPath (Get-Location).Path -Hotkey Ctrl+Alt+W
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Tools\Agent\Handoff\Uninstall-WishlistHandoff.ps1
```

Installation changes only the named shortcut under the current user's Startup folder; it does not create a service, scheduled task, registry run key, or hidden persistence. Use `-WhatIf` or pass a disposable `-StartupDirectory` to inspect the setup flow first. Without installation, run the host manually:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Tools\Agent\Handoff\Start-WishlistHandoffHotkey.ps1 -RepoPath (Get-Location).Path -Hotkey Ctrl+Alt+W
```

`-TestLifecycle` is an internal deterministic regression seam: it posts one synthetic `WM_HOTKEY` after registration so the host's wait-and-cleanup lifecycle can be tested without relying on physical key injection. It is not part of the normal user flow.

The logical model mapping is data-driven: `luna` -> `openai-codex/gpt-5.6-luna` with `max` thinking; `sol` -> `openai-codex/gpt-5.6-sol` with `high`; and guarded `astra` -> `openai-codex/gpt-6-astra` with `high`. Terra maps to `openai-codex/gpt-5.6-terra` for an explicit request only and is absent from automatic routes. Automatic routing defaults to Luna and sends high-risk, architecture-sensitive, review, and investigation tasks to Sol. Astra additionally requires `-AllowAstra`.

Pi's native `AGENTS.md` and `.agents/skills/` discovery remains enabled; the launcher does not pass `--no-context-files` or `--no-skills`. `--approve` makes the project-local resources available to the non-interactive run, while `WorkingDirectory` is the repository root so project discovery is anchored correctly.

The stdin prompt is a normalized task envelope only: protocol version, Project, Ticket, Type, Scope, Risk, configured optional metadata, and Task body. Provider/model/thinking/session/routing data stays in the launcher invocation and is not duplicated into the task prompt; historical/raw clipboard text is not forwarded.

## Local queue and scheduler

`Start-WishlistHandoffHotkey.ps1` remains the stable startup entry point and now delegates to `Start-WishlistAgentHost.ps1`. The native hotkey thread captures the Unicode clipboard text when the hotkey message is received. The host validates that immutable snapshot, routes it once, enqueues it, and immediately resumes accepting hotkeys. Workers never read the global clipboard.

`WishlistScheduler.psm1` is the producer-independent boundary. A future CLI or Sol coordinator can call `Add-WishlistSchedulerJob` with a normalized task plus its exact marked payload; it does not need to emulate a clipboard. Task decomposition, general workflow planning, autonomous review, and recursive agents are intentionally not implemented.

Task dependencies are the small scheduler-only exception to that last boundary. Use the canonical header forms `depends-on: -`, `depends-on: 103`, or `depends-on: 103, 104`. An omitted or empty `depends-on` field is also dependency-free. Dependencies are normalized to a unique positive integer list in `TaskDefinition` and the JSON/state contracts. They mean that a successful scheduler job with `COMPLETE` must already exist for every listed ticket; GitHub issue state is never queried. `FAILED`, `BLOCKED`, and `CANCELLED` do not satisfy a dependency, so the dependent remains `WAITING_DEPENDENCY` with an explicit reason. A later retry that reaches `COMPLETE` can automatically release the waiting job, while self-dependencies and known ticket cycles are blocked with `SELF_DEPENDENCY` or `DEPENDENCY_CYCLE`.

Runtime state defaults to `%LOCALAPPDATA%\Wishlist\AgentHost\` and is never written to the repository. `state.json` contains job/route/runtime metadata, while active payloads are separate `.task` files. Both use same-volume atomic replacement. Terminal jobs discard their payload; jobs found in `PREPARING`, `RUNNING`, or `REPORTING` after restart become `BLOCKED` with `STALE_AFTER_RESTART` and are never restarted automatically. Queued jobs remain queued.

The scheduler defaults to `-MaxWorkers 2`. Luna is capped at two concurrent jobs, Sol at one, and guarded Astra at one. Terra remains explicit-only through the existing router. Capacity never changes a job's recorded route. Numeric ticket IDs are normalized for locking, so follow-ups for the same ticket run sequentially. Explicit `type: integration` jobs run exclusively and are never converted into automatic feature-to-`dev` integration.

Every applying job starts `Start-WishlistWorker.ps1`, which creates a scheduler-owned normal clone from the current remote `dev`, switches to a unique `feature/*` or `fix/*` branch, and then calls the existing handoff/reporting boundary with `-TaskFile`. No worktree is used. The source checkout and protected/integration checkouts are not switched or mutated. Successful and failed worker clones are retained and registered by exact job ID/path; this scheduler performs no automatic clone cleanup, merge, rebase, or conflict recovery.

Ctrl+C stops admission, unregisters the hotkey, terminates each tracked worker process tree, marks active jobs `CANCELLED`, retains queued and `WAITING_DEPENDENCY` jobs, and never deletes worker clones. Interactive output redraws a small queue/worker summary; redirected output emits ordinary deterministic event lines without cursor control. Waiting entries show their dependency ticket and current local state, and `Pi alive` is shown only when the exact Pi PID reported by the launcher still resolves to a live local process.

`Invoke-WishlistTask.ps1` still supports `-FromClipboard` and `-Text`; `-TaskFile` is the additive safe worker transport. `-Json` remains a single clean JSON document. Human-readable token labels and totals are presentation-only in the host and do not alter the JSON contract. Reporting remains job-correlated and secondary: a GitHub/local reporting warning never changes a successful implementation job into `FAILED`.

Hermetic scheduler coverage lives in `Tools/Agent/Tests/Run-WishlistSchedulerTests.ps1`. It uses fakes and temporary local Git repositories only; it never starts a real provider or posts a GitHub comment. A real parallel provider check remains manual.

## Terminal reports

After a live Pi process exits, the handoff creates one compact report with the marker `<!-- wishlist-agent-report:v1 -->`. A positive decimal `ticket` is posted once as a comment to `Yuugel/wishlist` with `gh issue comment <ticket> --repo Yuugel/wishlist --body-file <temporary-file>`. The body file is passed through a non-shell `ProcessStartInfo` boundary and contains only run status, ticket, model/ModelKey, thinking level, Pi session, bounded completion diagnostics, provider-reported usage, and the final assistant response. The task body, raw clipboard, prompt, unbounded command output, and credentials are not included.

For an unticketed or invalid-ticket run, or when `gh` is missing, unauthenticated, unreachable, or returns an error, the report is saved outside the repository under `%LOCALAPPDATA%\Wishlist\AgentReports\` as a UTF-8 JSON file. GitHub delivery is secondary: a delivery warning and local path are reported without changing the Pi task status. The handoff's existing JSON envelope is preserved and gains only an additive top-level `Report` delivery object. The host then prints `READY: Waiting for next task.`. Preview/dry-run and `-TestLifecycle` do not invoke the reporting write path. `-ReportDirectory` and `-GitHubCommandPath` are explicit test seams; normal users should leave them unset.

## Sessions and compaction

V1 uses one native Pi session per task ticket. The ID is deterministic for the same project and ticket, includes the project namespace, and differs for different projects or tickets. Unticketed/adhoc prompts use a readable UTC timestamp plus a body hash and nonce; `session: <name>` adds an explicit project-namespaced ID, while `session: new` intentionally creates a fresh native ID. IDs are validated against Pi's actual `--session-id` rule before launch. There is no session database or semantic router.

Pi owns session persistence and compaction. Use the native `/compact [instructions]` command in an interactive session, or let Pi's native auto-compaction handle a long run. The workflow does not implement a second summary/compaction system.

Routing and skills are additive configuration boundaries: optional task metadata is preserved, model definitions/routes live in `routing.json`, and future skills are new folders under `.agents/skills/`.
