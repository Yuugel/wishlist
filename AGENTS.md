# Wishlist repository instructions

General user-level Codex rules come from `$CODEX_HOME/AGENTS.md` and are intentionally not repeated here.

## Project and branches

- Repository: `Yuugel/wishlist`.
- Wishlist is currently the project-specific home for its Pi_Task handoff workflow; the application stack itself is not defined.
- Do not invent application build, test, Unity, package or release commands before the product stack is explicitly chosen.
- `main` is the release branch; `dev` is the active integration branch.
- Worker work starts from `origin/dev` in a normal clone and uses a unique `feature/*` or `fix/*` branch.
- Parallel writing workers use separate normal clones. Keep worker clones available for review/integration rather than deleting them immediately after commit/push.
- Run the check-only `Tools/Agent/integration-gate.ps1` before an explicitly authorized integration.

## Pi_Task workflow

- Project-local handoff code lives under `Tools/Agent/Handoff/`; the root launcher is `Start-WishlistPiTask.ps1`.
- Runtime state lives outside the repository at `%LOCALAPPDATA%\Wishlist\AgentHost\`; fallback reports use `%LOCALAPPDATA%\Wishlist\AgentReports\`.
- Default scheduler capacity is two workers. Ticket locking and `depends-on` semantics remain authoritative.
- Automatic routing uses Luna for bounded work and Sol for high-risk, architecture-sensitive, review and investigation work. Terra is explicit-only; Astra requires its guard flag.
- The default Wishlist hotkey is `Ctrl+Alt+W`. No Startup shortcut or persistence is installed unless the user explicitly runs the installer.
- A live worker requires the remote `dev` branch. If `origin/dev` is absent, report the blocker instead of bootstrapping or creating it implicitly.
- Use the exact `@@PI_TASK` envelope and keep `project: Wishlist` in Wishlist task examples.
