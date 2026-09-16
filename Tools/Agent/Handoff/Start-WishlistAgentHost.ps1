[CmdletBinding()]
param(
    [string]$RepoPath = '',
    [string]$HandoffScriptPath = '',
    [string]$WorkerScriptPath = '',
    [string]$RoutingConfigPath = '',
    [AllowEmptyString()][string]$StateRoot = '',
    [ValidateRange(1, 16)][int]$MaxWorkers = 2,
    [switch]$DryRun,
    [switch]$AllowAstra,
    [switch]$Once,
    [ValidateSet('Ctrl+Shift+P', 'Ctrl+Alt+P', 'Ctrl+Alt+H', 'Ctrl+Alt+W')][string]$Hotkey = 'Ctrl+Alt+W',
    [int]$HotkeyId = 0x5242,
    [switch]$TestLifecycle,
    [ValidateRange(50, 60000)][int]$TestHotkeyDelayMilliseconds = 1000,
    [AllowEmptyString()][string]$ReportDirectory = '',
    [AllowEmptyString()][string]$GitHubCommandPath = ''
)

Set-StrictMode -Version 2.0

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $scriptRoot 'WishlistHotkeyPump.psm1') -Force
Import-Module (Join-Path $scriptRoot 'WishlistScheduler.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $scriptRoot 'TaskParser.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $scriptRoot 'WishlistConsoleRenderer.psm1') -Force -DisableNameChecking

if ([string]::IsNullOrWhiteSpace($RepoPath)) { $RepoPath = (Resolve-Path (Join-Path $scriptRoot '..\..\..')).Path }
else { $RepoPath = (Resolve-Path -LiteralPath $RepoPath -ErrorAction Stop).Path }
if ([string]::IsNullOrWhiteSpace($HandoffScriptPath)) { $HandoffScriptPath = Join-Path $scriptRoot 'Invoke-WishlistTask.ps1' }
else { $HandoffScriptPath = (Resolve-Path -LiteralPath $HandoffScriptPath -ErrorAction Stop).Path }
if ([string]::IsNullOrWhiteSpace($WorkerScriptPath)) { $WorkerScriptPath = Join-Path $scriptRoot 'Start-WishlistWorker.ps1' }
else { $WorkerScriptPath = (Resolve-Path -LiteralPath $WorkerScriptPath -ErrorAction Stop).Path }
if (-not [string]::IsNullOrWhiteSpace($RoutingConfigPath)) { $RoutingConfigPath = (Resolve-Path -LiteralPath $RoutingConfigPath -ErrorAction Stop).Path }

function Get-WishlistHotkeyDefinition {
    switch ($Hotkey.ToLowerInvariant()) {
        'ctrl+shift+p' { return [pscustomobject]@{ Label = 'Ctrl+Shift+P'; ModifierFlags = [uint32](0x0002 -bor 0x0004 -bor 0x4000); VirtualKey = [uint32][char]'P' } }
        'ctrl+alt+p' { return [pscustomobject]@{ Label = 'Ctrl+Alt+P'; ModifierFlags = [uint32](0x0002 -bor 0x0001 -bor 0x4000); VirtualKey = [uint32][char]'P' } }
        'ctrl+alt+h' { return [pscustomobject]@{ Label = 'Ctrl+Alt+H'; ModifierFlags = [uint32](0x0002 -bor 0x0001 -bor 0x4000); VirtualKey = [uint32][char]'H' } }
        'ctrl+alt+w' { return [pscustomobject]@{ Label = 'Ctrl+Alt+W'; ModifierFlags = [uint32](0x0002 -bor 0x0001 -bor 0x4000); VirtualKey = [uint32][char]'W' } }
        default { throw "Unsupported hotkey '$Hotkey'." }
    }
}

$script:dashboardRenderer = New-WishlistConsoleRenderer
$script:interactiveOutput = [bool]$script:dashboardRenderer.IsInteractive
$script:dashboardStatusMessage = ''
$script:dashboardHasRendered = $false

function Clear-WishlistDashboard {
    if (-not $script:interactiveOutput) { return }
    try {
        $null = Clear-WishlistConsoleFrame -Renderer $script:dashboardRenderer
    } catch {
        $script:interactiveOutput = $false
        $script:dashboardRenderer.IsInteractive = $false
    }
}

function Write-WishlistDashboard {
    param([Parameter(Mandatory = $true)][object]$Scheduler)
    if (-not $script:interactiveOutput) { return }
    try {
        $lines = @(Format-WishlistSchedulerStatus -Scheduler $Scheduler -StatusMessage $script:dashboardStatusMessage)
        $script:dashboardHasRendered = [bool](Write-WishlistConsoleFrame -Renderer $script:dashboardRenderer -Lines $lines)
    } catch {
        $script:interactiveOutput = $false
        $script:dashboardRenderer.IsInteractive = $false
    }
}

function Write-WishlistHostLine {
    param([Parameter(Mandatory = $true)][string]$Message)
    if ($script:interactiveOutput) {
        $script:dashboardStatusMessage = $Message
        return
    }
    Write-Output $Message
}

function Write-WishlistTerminalDetails {
    param([Parameter(Mandatory = $true)][object]$Job)
    if ($script:interactiveOutput) { return }
    if ($null -ne $Job.Usage) {
        foreach ($line in @(Format-WishlistUsageLines -Usage $Job.Usage)) { Write-WishlistHostLine -Message ([string]$line) }
    }
    if ($null -ne $Job.Report) {
        $reportStatus = [string]$Job.Report.Status
        $reportMessage = if (-not [string]::IsNullOrWhiteSpace([string]$Job.Report.Message)) { [string]$Job.Report.Message } else { "Report status $reportStatus." }
        Write-WishlistHostLine -Message ("REPORT {0}: {1}" -f $reportStatus, $reportMessage)
    }
}

function Write-WishlistSchedulerEvents {
    param([Parameter(Mandatory = $true)][object]$Scheduler, [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Events)
    foreach ($event in @($Events)) {
        if ($script:interactiveOutput) {
            $script:dashboardStatusMessage = ('{0}: {1}' -f $event.Type, $event.Message)
            continue
        }
        Write-WishlistHostLine -Message ("{0}: {1}" -f $event.Type, $event.Message)
        if ($event.Type -in @('COMPLETE', 'FAILED', 'BLOCKED', 'CANCELLED')) {
            $job = @($Scheduler.State.Jobs | Where-Object { $_.JobId -eq $event.JobId } | Select-Object -First 1)
            if ($job.Count -gt 0) { Write-WishlistTerminalDetails -Job $job[0] }
        }
    }
}

function Add-WishlistHotkeySnapshot {
    param([Parameter(Mandatory = $true)][object]$Scheduler, [Parameter(Mandatory = $true)][object]$Snapshot)

    if (-not [string]::IsNullOrWhiteSpace([string]$Snapshot.Error)) { Write-WishlistHostLine -Message "BLOCKED: $($Snapshot.Error)" | Out-Host; return $null }
    $payload = [string]$Snapshot.Text
    if ([string]::IsNullOrWhiteSpace($payload)) { Write-WishlistHostLine -Message 'BLOCKED: Clipboard snapshot was empty; nothing was persisted.' | Out-Host; return $null }
    $parseResult = Parse-WishlistTask -Text $payload
    if (-not $parseResult.IsValid) { Write-WishlistHostLine -Message ("BLOCKED: {0}" -f ($parseResult.Errors -join ' ')) | Out-Host; return $null }
    try {
        $job = Add-WishlistSchedulerJob -Scheduler $Scheduler -TaskDefinition $parseResult.Definition -PayloadText $payload -Source 'HOTKEY'
        Write-WishlistHostLine -Message ("TASK ACCEPTED / QUEUED: {0}; {1} [{2}]; session {3}." -f $job.JobId, $job.Route.ModelName, $job.Route.ModelKey, $job.PiSession) | Out-Host
        return $job
    } catch { Write-WishlistHostLine -Message "BLOCKED: $($_.Exception.Message)" | Out-Host; return $null }
}

if ($env:OS -ne 'Windows_NT') { throw 'The global hotkey host requires Windows user32.dll.' }

$hotkeyDefinition = Get-WishlistHotkeyDefinition
$pump = New-WishlistHotkeyMessagePump -HotkeyId $HotkeyId -ModifierFlags $hotkeyDefinition.ModifierFlags -VirtualKey $hotkeyDefinition.VirtualKey
$scheduler = $null
$registered = $false
$cancelState = [pscustomobject]@{ Requested = $false }
$cancelHandler = $null
$lastExitCode = 0
$onceEventHandled = $false
$onceJobId = ''
$lastDashboardUtc = [DateTime]::MinValue

try {
    $scheduler = New-WishlistScheduler -StateRoot $StateRoot -SourceRepoPath $RepoPath -HandoffScriptPath $HandoffScriptPath -WorkerScriptPath $WorkerScriptPath -RoutingConfigPath $RoutingConfigPath -MaxWorkers $MaxWorkers -AllowAstra:$AllowAstra -DryRun:$DryRun -ReportDirectory $ReportDirectory -GitHubCommandPath $GitHubCommandPath
    $pump.Start()
    if (-not $pump.WaitForReady(10000)) { Write-WishlistHostLine -Message 'FAILED: Hotkey message pump did not become ready within 10 seconds.'; $lastExitCode = 3 }
    elseif ($pump.Status -ne 'READY') { Write-WishlistHostLine -Message "FAILED: RegisterHotKey for $($hotkeyDefinition.Label) failed with Win32 error $($pump.ErrorCode). The combination may already be registered by another application."; $lastExitCode = 3 }
    else {
        $registered = $true
        Write-WishlistHostLine -Message "READY: Global $($hotkeyDefinition.Label) is registered. Press Ctrl+C to stop the host."
        $modeName = if ($DryRun) { 'DRY_RUN' } else { 'APPLY' }
        Write-WishlistHostLine -Message ("MODE: {0}; max workers {1}; state {2}." -f $modeName, $MaxWorkers, $scheduler.StateRoot)
        if ($TestLifecycle) { $null = $pump.ScheduleTestHotkey($TestHotkeyDelayMilliseconds) }

        $cancelHandler = [ConsoleCancelEventHandler]{ param($sender, $eventArgs); $eventArgs.Cancel = $true; $cancelState.Requested = $true; if ($null -ne $pump) { $pump.Stop() } }
        [Console]::add_CancelKeyPress($cancelHandler)

        while (-not $cancelState.Requested) {
            try { $signaled = $pump.WaitForHotkey(250) }
            catch [System.Management.Automation.PipelineStoppedException] { $cancelState.Requested = $true; break }

            if ($signaled) {
                if ($TestLifecycle) {
                    if ($pump.TryTakeHotkey()) { Write-WishlistHostLine -Message 'TEST: Dedicated native message pump delivered a hotkey event.'; $onceEventHandled = $true }
                } else {
                    while ($true) {
                        $snapshot = $pump.TryTakeHotkeySnapshot()
                        if ($null -eq $snapshot) { break }
                        $onceEventHandled = $true
                        $job = Add-WishlistHotkeySnapshot -Scheduler $scheduler -Snapshot $snapshot
                        if ($null -ne $job -and [string]::IsNullOrWhiteSpace($onceJobId)) { $onceJobId = [string]$job.JobId }
                    }
                }
            } elseif ($pump.Status -notin @('READY', 'STOPPED')) { Write-WishlistHostLine -Message "FAILED: Hotkey message pump stopped with status '$($pump.Status)'."; $lastExitCode = 3; break }

            $tick = Invoke-WishlistSchedulerTick -Scheduler $scheduler
            Write-WishlistSchedulerEvents -Scheduler $scheduler -Events @($tick.Events)
            if ($script:interactiveOutput -and (([DateTime]::UtcNow - $lastDashboardUtc).TotalSeconds -ge 1 -or @($tick.Events).Count -gt 0)) { Write-WishlistDashboard -Scheduler $scheduler; $lastDashboardUtc = [DateTime]::UtcNow }

            if ($Once -and $onceEventHandled) {
                if ($TestLifecycle -or [string]::IsNullOrWhiteSpace($onceJobId)) { break }
                $onceJob = @($scheduler.State.Jobs | Where-Object { $_.JobId -eq $onceJobId } | Select-Object -First 1)
                if ($onceJob.Count -gt 0 -and [string]$onceJob[0].Status -in @('COMPLETE', 'FAILED', 'BLOCKED', 'CANCELLED')) {
                    if ([string]$onceJob[0].Status -eq 'COMPLETE') { $lastExitCode = 0 }
                    elseif ([string]$onceJob[0].Status -eq 'BLOCKED') { $lastExitCode = 2 }
                    else { $lastExitCode = 1 }
                    break
                }
            }
        }
        if ($cancelState.Requested) { Write-WishlistHostLine -Message 'CANCELLED: Hotkey host interrupted by Ctrl+C; active worker process trees will be terminated and queued jobs retained.'; $lastExitCode = 2 }
    }
} catch [System.Management.Automation.PipelineStoppedException] {
    $cancelState.Requested = $true; $lastExitCode = 2
    Write-WishlistHostLine -Message 'CANCELLED: Hotkey host interrupted by Ctrl+C; active worker process trees will be terminated and queued jobs retained.'
} catch {
    $lastExitCode = 1
    Write-WishlistHostLine -Message "FAILED: Hotkey host error: $($_.Exception.Message)"
} finally {
    Clear-WishlistDashboard
    if ($script:interactiveOutput -and -not $script:dashboardHasRendered -and -not [string]::IsNullOrWhiteSpace($script:dashboardStatusMessage)) {
        Write-Output $script:dashboardStatusMessage
    }
    if ($null -ne $cancelHandler) { [Console]::remove_CancelKeyPress($cancelHandler) }
    if ($null -ne $scheduler) {
        try { Stop-WishlistScheduler -Scheduler $scheduler; $shutdownTick = Invoke-WishlistSchedulerTick -Scheduler $scheduler; Write-WishlistSchedulerEvents -Scheduler $scheduler -Events @($shutdownTick.Events) }
        catch { Write-Output "FAILED: Scheduler shutdown error: $($_.Exception.Message)"; if ($lastExitCode -eq 0) { $lastExitCode = 1 } }
    }
    if ($null -ne $pump) { $pump.Dispose() }
    if ($registered) { Write-Output "STOPPED: Global $($hotkeyDefinition.Label) was unregistered." }
}

exit $lastExitCode
