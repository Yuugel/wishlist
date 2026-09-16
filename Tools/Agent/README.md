# Wishlist agent workflow

This directory contains the project-local Pi_Task handoff, scheduler, and normal-clone worker boundary. It is independent of the future Wishlist application stack.

The normal entry point is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-WishlistPiTask.ps1 -DryRun -Once -TestLifecycle
```

The default hotkey is `Ctrl+Alt+W`. Runtime state is kept under `%LOCALAPPDATA%\Wishlist\AgentHost\`, reports under `%LOCALAPPDATA%\Wishlist\AgentReports\`, and the scheduler defaults to two workers. Applying a task requires a remote `dev` branch; workers clone `origin/dev` into retained normal clones and create `feature/*` or `fix/*` branches.

Worker changes start from `origin/dev` and stay isolated on a dedicated `feature/*` or `fix/*` branch.

Preview a task without starting Pi:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Tools\Agent\Handoff\Invoke-WishlistTask.ps1 -Text $task -RepoPath (Get-Location).Path -Json -NoProcessExit
```

Run the hermetic checks:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Tools\Agent\Tests\Run-WishlistHandoffTests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Tools\Agent\Tests\Run-WishlistSchedulerTests.ps1
```

`Tools/Agent/integration-gate.ps1` is check-only by default and protects `main`; use `-Apply` only with an explicit integration request. No installer or Startup shortcut is run by these tests.

No additional Pi_Task launcher was found outside the reference repository during the port audit; the supported Wishlist entry point is the project-local root launcher.
