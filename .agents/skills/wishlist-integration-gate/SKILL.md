---
name: wishlist-integration-gate
description: Verify a safe feature-to-dev fast-forward for Wishlist without changing repository state by default.
---

# Wishlist integration gate

Use `Tools/Agent/integration-gate.ps1` as the deterministic check-only gate. It protects `main`, verifies a normal clone, clean state, branch refs, and fast-forward ancestry.

- `dev` is the only integration target; `main` is release/protected.
- Use `-Apply` only when an explicit integration request authorizes the local fast-forward.
- Never push, force-push, rebase, hard-reset, create worktrees, or delete worker clones as part of the gate.
- Verify the post-apply local state separately; a local fast-forward is not a remote update.
