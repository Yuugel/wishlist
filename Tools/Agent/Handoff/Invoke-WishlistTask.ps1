[CmdletBinding(DefaultParameterSetName = 'Text')]
param(
    [Parameter(ParameterSetName = 'Clipboard', Mandatory = $true)]
    [switch]$FromClipboard,

    [Parameter(ParameterSetName = 'Text', Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Text,

    [Parameter(ParameterSetName = 'File', Mandatory = $true)]
    [string]$TaskFile,

    [string]$RoutingConfigPath = '',
    [string]$RepoPath = '',
    [switch]$AllowAstra,
    [switch]$Apply,
    [switch]$Json,
    [switch]$NoProcessExit,
    [AllowEmptyString()]
    [string]$ReportDirectory = '',
    [AllowEmptyString()]
    [string]$GitHubCommandPath = '',

    [AllowEmptyString()]
    [string]$LifecyclePath = ''
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $scriptRoot 'TaskParser.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $scriptRoot 'TaskRouter.psm1') -Force
Import-Module (Join-Path $scriptRoot 'PiLauncher.psm1') -Force
Import-Module (Join-Path $scriptRoot 'WishlistReporting.psm1') -Force

$writeWishlistHandoffLifecycle = {
    param(
        [Parameter(Mandatory = $true)][string]$Phase,
        [AllowNull()][Nullable[int]]$PiProcessId = $null
    )

    if ([string]::IsNullOrWhiteSpace($LifecyclePath)) {
        return
    }

    $fullPath = [System.IO.Path]::GetFullPath($LifecyclePath)
    $directory = Split-Path -Parent $fullPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $directory -ErrorAction Stop | Out-Null
    }
    $record = [pscustomobject]@{
        Phase = $Phase
        TimestampUtc = (Get-Date).ToUniversalTime().ToString('o')
        ProcessId = $PID
        PiProcessId = $PiProcessId
    }
    $temporaryPath = $fullPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    try {
        [System.IO.File]::WriteAllText($temporaryPath, ($record | ConvertTo-Json -Compress), $utf8WithoutBom)
        if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            $backupPath = $fullPath + '.replace-backup'
            [System.IO.File]::Replace($temporaryPath, $fullPath, $backupPath)
            Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
        } else {
            [System.IO.File]::Move($temporaryPath, $fullPath)
        }
    } finally {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
}.GetNewClosure()

if ([string]::IsNullOrWhiteSpace($RepoPath)) {
    $RepoPath = (Resolve-Path (Join-Path $scriptRoot '..\..\..')).Path
} else {
    $RepoPath = (Resolve-Path -LiteralPath $RepoPath -ErrorAction Stop).Path
}

function Write-HandoffReport {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Report,
        [switch]$AsJson
    )

    if ($AsJson) {
        Write-Output ($Report | ConvertTo-Json -Depth 12)
        return
    }

    Write-Output "STATUS: $($Report.Status)"
    Write-Output "Mode: $($Report.Mode)"
    Write-Output "Source: $($Report.Source)"
    Write-Output "Reason: $($Report.Reason)"
    if ($null -ne $Report.Task) {
        Write-Output "Task: $($Report.Task.Project) / ticket $($Report.Task.Ticket) / $($Report.Task.Scope) / risk $($Report.Task.Risk)"
        if ($null -ne $Report.Task.Dependencies -and @($Report.Task.Dependencies).Count -gt 0) {
            Write-Output "Depends on: $(@($Report.Task.Dependencies) -join ', ')"
        }
        Write-Output "Route: $($Report.Route.ModelName) [$($Report.Route.ModelKey)]"
        Write-Output "Provider target: $($Report.Route.Provider) / $($Report.Route.LauncherTarget)"
        Write-Output "Thinking: $($Report.Route.Thinking)"
        Write-Output "Session: $($Report.Route.SessionId)"
        Write-Output "Skills: $(@($Report.Route.Skills) -join ', ')"
        Write-Output "Body preview: $($Report.Task.Body)"
    }
    if ($null -ne $Report.Invocation) {
        Write-Output "Pi command: $($Report.Invocation.Command)"
        Write-Output "Working directory: $($Report.Invocation.WorkingDirectory)"
        Write-Output "Help probe: $($Report.Invocation.ProbeHelp)"
        Write-Output "Output mode: $($Report.Invocation.OutputMode)"
    }
    if ($null -ne $Report.Launch -and $null -ne $Report.Launch.PiSessionId -and -not [string]::IsNullOrWhiteSpace([string]$Report.Launch.PiSessionId)) {
        Write-Output "Pi session: $($Report.Launch.PiSessionId)"
    }
    if ($null -ne $Report.Launch -and $null -ne $Report.Launch.Response -and -not [string]::IsNullOrWhiteSpace([string]$Report.Launch.Response)) {
        Write-Output "Response: $($Report.Launch.Response)"
    }
    if ($null -ne $Report.Launch -and $null -ne $Report.Launch.UsageSummary) {
        Write-Output "Task-Usage-Summary: $($Report.Launch.UsageSummary | ConvertTo-Json -Compress -Depth 4)"
    }
    if ($null -ne $Report.Launch -and -not [string]::IsNullOrWhiteSpace([string]$Report.Launch.OutputParseWarning)) {
        Write-Output "Output warning: $($Report.Launch.OutputParseWarning)"
    }
    if ($null -ne $Report.Launch) {
        Write-Output "Terminal completion evidence: $([bool]$Report.Launch.TerminalCompletionEvidence)"
        if (-not [string]::IsNullOrWhiteSpace([string]$Report.Launch.FailureReason)) {
            Write-Output "Completion failure reason: $($Report.Launch.FailureReason)"
        }
    }
    if ($null -ne $Report.Report) {
        switch ([string]$Report.Report.Status) {
            'POSTED' {
                Write-Output "REPORT: Posted to GitHub issue #$($Report.Report.IssueNumber)."
            }
            'LOCAL' {
                Write-Output "REPORT: Saved locally to $($Report.Report.LocalPath)."
            }
            'WARNING' {
                if (-not [string]::IsNullOrWhiteSpace([string]$Report.Report.LocalPath)) {
                    Write-Output "REPORT WARNING: GitHub delivery failed; local fallback saved to $($Report.Report.LocalPath)."
                } else {
                    Write-Output "REPORT WARNING: $($Report.Report.Warning)"
                }
            }
            'SKIPPED' {
                Write-Output "REPORT: $($Report.Report.Message)"
            }
            default {
                Write-Output "REPORT WARNING: Report ended with status '$($Report.Report.Status)'."
            }
        }
    }
    Write-Output "Pi: $($Report.PiStatus)"
    Write-Output "Forwarded: $($Report.Forwarded)"
}

if ([string]::IsNullOrWhiteSpace($RoutingConfigPath)) {
    $RoutingConfigPath = Join-Path $scriptRoot 'routing.json'
}

$inputText = $Text
$inputSource = 'TEXT'
if ($FromClipboard) {
    $inputSource = 'CLIPBOARD'
    try {
        $inputText = Get-Clipboard -Raw -ErrorAction Stop
    } catch {
        $clipboardReport = [pscustomobject]@{
            Status = 'INFRA'
            Mode = if ($Apply) { 'APPLY' } else { 'DRY_RUN' }
            Source = $inputSource
            Reason = "Clipboard could not be read: $($_.Exception.Message)"
            Task = $null
            Route = $null
            PiStatus = 'PI_NOT_CONFIGURED'
            Forwarded = $false
            Launched = $false
            Invocation = $null
            Launch = $null
            Report = $null
        }
        Write-HandoffReport -Report $clipboardReport -AsJson:$Json
        if (-not $NoProcessExit) { exit 3 }
        return
    }

    if ([string]::IsNullOrWhiteSpace([string]$inputText)) {
        $emptyClipboardReport = [pscustomobject]@{
            Status = 'BLOCKED'
            Mode = if ($Apply) { 'APPLY' } else { 'DRY_RUN' }
            Source = $inputSource
            Reason = 'Clipboard is empty; no task was forwarded.'
            Task = $null
            Route = $null
            PiStatus = 'NOT_LAUNCHED'
            Forwarded = $false
            Launched = $false
            Invocation = $null
            Launch = $null
            Report = $null
        }
        Write-HandoffReport -Report $emptyClipboardReport -AsJson:$Json
        if (-not $NoProcessExit) { exit 2 }
        return
    }
}
if ($PSCmdlet.ParameterSetName -eq 'File') {
    $inputSource = 'FILE'
    try {
        $resolvedTaskFile = (Resolve-Path -LiteralPath $TaskFile -ErrorAction Stop).Path
        if (-not (Test-Path -LiteralPath $resolvedTaskFile -PathType Leaf)) {
            throw "Task file is not a regular file: $resolvedTaskFile"
        }
        $inputText = [System.IO.File]::ReadAllText($resolvedTaskFile)
    } catch {
        $fileReport = [pscustomobject]@{
            Status = 'INFRA'
            Mode = if ($Apply) { 'APPLY' } else { 'DRY_RUN' }
            Source = $inputSource
            Reason = "Task file could not be read: $($_.Exception.Message)"
            Task = $null
            Route = $null
            PiStatus = 'NOT_LAUNCHED'
            Forwarded = $false
            Launched = $false
            Invocation = $null
            Launch = $null
            Report = $null
        }
        Write-HandoffReport -Report $fileReport -AsJson:$Json
        if (-not $NoProcessExit) { exit 3 }
        return
    }
}

$parseResult = Parse-WishlistTask -Text $inputText
if (-not $parseResult.IsValid) {
    $reason = ($parseResult.Errors -join ' ')
    $blockedReport = [pscustomobject]@{
        Status = 'BLOCKED'
        Mode = if ($Apply) { 'APPLY' } else { 'DRY_RUN' }
        Source = $inputSource
        Reason = $reason
        Task = $null
        Route = $null
        Parser = $parseResult
        PiStatus = 'NOT_LAUNCHED'
        Forwarded = $false
        Launched = $false
        Invocation = $null
        Launch = $null
        Report = $null
    }
    Write-HandoffReport -Report $blockedReport -AsJson:$Json
    if (-not $NoProcessExit) { exit 2 }
    return
}

$config = $null
try {
    $config = Get-WishlistRoutingConfig -Path $RoutingConfigPath
} catch {
    $configReport = [pscustomobject]@{
        Status = 'INFRA'
        Mode = if ($Apply) { 'APPLY' } else { 'DRY_RUN' }
        Source = $inputSource
        Reason = $_.Exception.Message
        Task = $parseResult.Definition
        Route = $null
        Parser = $parseResult
        PiStatus = 'NOT_LAUNCHED'
        Forwarded = $false
        Launched = $false
        Invocation = $null
        Launch = $null
        Report = $null
    }
    Write-HandoffReport -Report $configReport -AsJson:$Json
    if (-not $NoProcessExit) { exit 3 }
    return
}

$route = Resolve-WishlistRoute -TaskDefinition $parseResult.Definition -Config $config -AllowAstra:$AllowAstra
if ($route.Status -ne 'PASS') {
    $routeReport = [pscustomobject]@{
        Status = 'BLOCKED'
        Mode = if ($Apply) { 'APPLY' } else { 'DRY_RUN' }
        Source = $inputSource
        Reason = $route.Reason
        Task = $parseResult.Definition
        Route = $route
        Parser = $parseResult
        PiStatus = 'NOT_LAUNCHED'
        Forwarded = $false
        Launched = $false
        Invocation = $null
        Launch = $null
        Report = $null
    }
    Write-HandoffReport -Report $routeReport -AsJson:$Json
    if (-not $NoProcessExit) { exit 2 }
    return
}

$launchResult = if ($Apply) {
    $piStartedCallback = {
        param([int]$ProcessId)
        & $writeWishlistHandoffLifecycle -Phase 'RUNNING' -PiProcessId $ProcessId
    }.GetNewClosure()
    Invoke-WishlistPi -TaskDefinition $parseResult.Definition -Route $route -Config $config -WorkingDirectory $RepoPath -ProcessStartedCallback $piStartedCallback
} else {
    Invoke-WishlistPi -TaskDefinition $parseResult.Definition -Route $route -Config $config -WorkingDirectory $RepoPath -DryRun
}

$handoffStatus = if ($Apply) { [string]$launchResult.Status } else { 'PASS' }
$handoffReason = if ($Apply) { [string]$launchResult.Reason } else { 'Valid marked task parsed and routed; dry-run did not start Pi.' }
$deliveryReason = 'No terminal Pi run was available; no report was delivered.'
if (-not $Apply) {
    $deliveryReason = 'Dry-run only; no agent report was generated or delivered.'
}
$deliveryReport = New-WishlistSkippedReport -Reason $deliveryReason
if ($Apply -and [bool]$launchResult.Started) {
    try {
        & $writeWishlistHandoffLifecycle -Phase 'REPORTING'
        $deliveryReport = Publish-WishlistAgentReport `
            -TaskDefinition $parseResult.Definition `
            -Route $route `
            -LaunchResult $launchResult `
            -RunStatus $handoffStatus `
            -ReportDirectory $ReportDirectory `
            -GitHubCommandPath $GitHubCommandPath
    } catch {
        # Reporting is secondary to the task result. Never convert a Pi
        # completion into a handoff failure because report creation failed.
        $deliveryReport = [pscustomobject]@{
            Status = 'WARNING'
            Delivery = 'NONE'
            DeliveryStatus = 'WARNING'
            Repository = 'Yuugel/wishlist'
            IssueNumber = $null
            Ticket = $null
            ReportId = $null
            TimestampUtc = $null
            LocalPath = $null
            Message = 'The agent run ended, but report creation failed.'
            Warning = 'Report creation failed without changing the task result.'
        }
    }
}
$report = [pscustomobject]@{
    Status = $handoffStatus
    Mode = if ($Apply) { 'APPLY' } else { 'DRY_RUN' }
    Source = $inputSource
    Reason = $handoffReason
    Task = [pscustomobject]@{
        Marker = $parseResult.Definition.Marker
        ProtocolVersion = $parseResult.Definition.ProtocolVersion
        Project = $parseResult.Definition.Project
        Ticket = $parseResult.Definition.Ticket
        Type = $parseResult.Definition.Type
        Scope = $parseResult.Definition.Scope
        Risk = $parseResult.Definition.Risk
        RequestedModel = $parseResult.Definition.RequestedModel
        Dependencies = [int64[]]$parseResult.Definition.Dependencies
        Body = $parseResult.Definition.Body
        Metadata = $parseResult.Definition.Metadata
        Warnings = @($parseResult.Warnings)
    }
    Route = $route
    Parser = $parseResult
    PiStatus = if ($Apply) { $launchResult.PiStatus } else { $launchResult.PiStatus }
    Invocation = $launchResult.Invocation
    Forwarded = [bool]$launchResult.Started
    Launched = [bool]$launchResult.Started
    Launch = $launchResult
    Report = $deliveryReport
}

Write-HandoffReport -Report $report -AsJson:$Json
if (-not $NoProcessExit) {
    if ($report.Status -eq 'PASS') { exit 0 }
    if ($report.Status -eq 'BLOCKED') { exit 2 }
    if ($report.Status -eq 'FAIL') { exit 1 }
    exit 3
}
