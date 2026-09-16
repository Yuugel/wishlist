---
name: wishlist-feature-delivery
description: Deliver a focused Wishlist feature or fix while preserving the project-local Pi_Task and Git safety rules.
---

# Wishlist feature delivery

Use this skill for bounded Wishlist implementation or fix work.

- Read the root `AGENTS.md` and inspect branch, HEAD, remotes, and working-tree state before editing.
- Work from `dev` on a dedicated `feature/*` or `fix/*` branch. Parallel writing jobs use separate normal clones; never use a worktree.
- Preserve unrelated local changes. Never reset, rebase, force-push, stash, discard, or automatically merge.
- Run only validation appropriate to the actual Wishlist stack. Until that stack exists, use the project-local handoff and scheduler tests; do not invent an application build command.
- Keep worker clones available for review and report the exact branch, files, checks, and remaining blockers.
