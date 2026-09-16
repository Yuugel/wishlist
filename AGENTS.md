# Wishlist project rules

Wishlist is the local home for the project-specific Pi_Task handoff workflow. The application stack is not defined yet; do not invent application build, test, Unity, or release commands here.

## Git safety

- Repository: `Yuugel/wishlist`.
- `main` is the protected release branch; `dev` is the integration branch.
- Worker work starts from `origin/dev` on a normal clone and uses a unique `feature/*` or `fix/*` branch.
- Do not use worktrees for parallel writing jobs. Keep worker clones for review; do not delete them automatically.
- Do not merge, rebase, force-push, hard-reset, stash, or discard unrelated local changes. Automatic merges and recovery are not part of the workflow.
- Run the check-only `Tools/Agent/integration-gate.ps1` before any explicitly authorized integration. Never mutate a remote as part of this local workflow.

## Pi_Task workflow

- The project-local chain lives under `Tools/Agent/Handoff/`; the root launcher is `Start-WishlistPiTask.ps1`.
- Runtime state is outside the repository at `%LOCALAPPDATA%\Wishlist\AgentHost\`; fallback reports use `%LOCALAPPDATA%\Wishlist\AgentReports\`.
- Default scheduler capacity is two workers. Ticket locking and `depends-on` semantics are preserved.
- Automatic routing uses Luna for bounded work and Sol for high-risk, architecture-sensitive, review, and investigation work. Terra is explicit-only; Astra requires its guard flag.
- The default Wishlist hotkey is `Ctrl+Alt+W`. No Startup shortcut or other persistence is installed unless the user explicitly runs the installer.
- A live worker requires the remote `dev` branch. If `origin/dev` is absent, report the blocker and do not bootstrap, commit, push, or create a remote branch.

Use the exact `@@PI_TASK` envelope and keep `project: Wishlist` in Wishlist task examples.
