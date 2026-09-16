[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-z0-9-]+$')]
    [string]$JobId,

    [Parameter(Mandatory = $true)]
    [string]$TaskFile,

    [Parameter(Mandatory = $true)]
    [string]$ResultPath,

    [Parameter(Mandatory = $true)]
    [string]$LifecyclePath,

    [Parameter(Mandatory = $true)]
    [string]$WorkerRoot,

    [Parameter(Mandatory = $true)]
    [string]$RepoUrl,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^(feature|fix)/[A-Za-z0-9._/-]+$')]
    [string]$BranchName,

    [Parameter(Mandatory = $true)]
    [string]$HandoffScriptPath,

    [Parameter(Mandatory = $true)]
    [string]$SourceRepoPath,

    [string]$RoutingConfigPath = '',
    [switch]$DryRun,
    [switch]$AllowAstra,
    [AllowEmptyString()][string]$ReportDirectory = '',
    [AllowEmptyString()][string]$GitHubCommandPath = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Write-WorkerJsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $directory = Split-Path -Parent $fullPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $temporaryPath = $fullPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    try {
        [System.IO.File]::WriteAllText($temporaryPath, ($Value | ConvertTo-Json -Depth 20), $utf8WithoutBom)
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
}

function Write-WorkerLifecycle {
    param(
        [Parameter(Mandatory = $true)][string]$Phase,
        [AllowEmptyString()][string]$Workspace = '',
        [AllowEmptyString()][string]$Branch = '',
        [AllowEmptyString()][string]$Message = ''
    )

    Write-WorkerJsonAtomic -Path $LifecyclePath -Value ([pscustomobject]@{
        JobId = $JobId
        Phase = $Phase
        TimestampUtc = (Get-Date).ToUniversalTime().ToString('o')
        ProcessId = $PID
        Workspace = $Workspace
        Branch = $Branch
        Message = $Message
    })
}

function Assert-WorkerChildPath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Child
    )

    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    $childFull = [System.IO.Path]::GetFullPath($Child)
    if (-not $childFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Worker path is outside the scheduler-owned root."
    }
}

function Get-WorkerProperty {
    param([AllowNull()][object]$Object, [Parameter(Mandatory = $true)][string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function ConvertTo-BoundedWorkerDiagnostic {
    param(
        [AllowNull()]
        [object]$Value,

        [int]$MaximumLength = 2000
    )

    if ($null -eq $Value) {
        return ''
    }

    $text = ([string]$Value).Trim()
    if ($text.Length -le $MaximumLength) {
        return $text
    }

    return $text.Substring(0, $MaximumLength) + ' ... [truncated]'
}

function ConvertTo-SafeWorkerHandoff {
    param([Parameter(Mandatory = $true)][object]$RawHandoff)

    $task = Get-WorkerProperty -Object $RawHandoff -Name 'Task'
    $route = Get-WorkerProperty -Object $RawHandoff -Name 'Route'
    $launch = Get-WorkerProperty -Object $RawHandoff -Name 'Launch'
    return [pscustomobject]@{
        Status = [string](Get-WorkerProperty -Object $RawHandoff -Name 'Status')
        Mode = [string](Get-WorkerProperty -Object $RawHandoff -Name 'Mode')
        Source = [string](Get-WorkerProperty -Object $RawHandoff -Name 'Source')
        Reason = [string](Get-WorkerProperty -Object $RawHandoff -Name 'Reason')
        PiStatus = [string](Get-WorkerProperty -Object $RawHandoff -Name 'PiStatus')
        Forwarded = [bool](Get-WorkerProperty -Object $RawHandoff -Name 'Forwarded')
        Launched = [bool](Get-WorkerProperty -Object $RawHandoff -Name 'Launched')
        Task = if ($null -eq $task) { $null } else { [pscustomobject]@{
            Marker = [string](Get-WorkerProperty -Object $task -Name 'Marker')
            ProtocolVersion = [string](Get-WorkerProperty -Object $task -Name 'ProtocolVersion')
            Project = [string](Get-WorkerProperty -Object $task -Name 'Project')
            Ticket = [string](Get-WorkerProperty -Object $task -Name 'Ticket')
            Type = [string](Get-WorkerProperty -Object $task -Name 'Type')
            Scope = [string](Get-WorkerProperty -Object $task -Name 'Scope')
            Risk = [string](Get-WorkerProperty -Object $task -Name 'Risk')
            RequestedModel = [string](Get-WorkerProperty -Object $task -Name 'RequestedModel')
        } }
        Route = if ($null -eq $route) { $null } else { [pscustomobject]@{
            Status = [string](Get-WorkerProperty -Object $route -Name 'Status')
            Reason = [string](Get-WorkerProperty -Object $route -Name 'Reason')
            RequestedModel = [string](Get-WorkerProperty -Object $route -Name 'RequestedModel')
            ModelKey = [string](Get-WorkerProperty -Object $route -Name 'ModelKey')
            ModelName = [string](Get-WorkerProperty -Object $route -Name 'ModelName')
            Provider = [string](Get-WorkerProperty -Object $route -Name 'Provider')
            LauncherTarget = [string](Get-WorkerProperty -Object $route -Name 'LauncherTarget')
            Thinking = [string](Get-WorkerProperty -Object $route -Name 'Thinking')
            Skills = @(Get-WorkerProperty -Object $route -Name 'Skills')
            SessionId = [string](Get-WorkerProperty -Object $route -Name 'SessionId')
            Automatic = [bool](Get-WorkerProperty -Object $route -Name 'Automatic')
        } }
        Launch = if ($null -eq $launch) { $null } else { [pscustomobject]@{
            Status = [string](Get-WorkerProperty -Object $launch -Name 'Status')
            PiStatus = [string](Get-WorkerProperty -Object $launch -Name 'PiStatus')
            Reason = [string](Get-WorkerProperty -Object $launch -Name 'Reason')
            Started = [bool](Get-WorkerProperty -Object $launch -Name 'Started')
            ExitCode = Get-WorkerProperty -Object $launch -Name 'ExitCode'
             Response = [string](Get-WorkerProperty -Object $launch -Name 'Response')
             UsageSummary = Get-WorkerProperty -Object $launch -Name 'UsageSummary'
             PiSessionId = [string](Get-WorkerProperty -Object $launch -Name 'PiSessionId')
             JsonEventCount = Get-WorkerProperty -Object $launch -Name 'JsonEventCount'
             OutputParseWarning = [string](Get-WorkerProperty -Object $launch -Name 'OutputParseWarning')
             TerminalCompletionEvidence = [bool](Get-WorkerProperty -Object $launch -Name 'TerminalCompletionEvidence')
             TerminalEventType = [string](Get-WorkerProperty -Object $launch -Name 'TerminalEventType')
             ObservedEventTypes = @(Get-WorkerProperty -Object $launch -Name 'ObservedEventTypes')
             FailureReason = [string](Get-WorkerProperty -Object $launch -Name 'FailureReason')
             LauncherError = ConvertTo-BoundedWorkerDiagnostic -Value (Get-WorkerProperty -Object $launch -Name 'StandardError')
         } }
        Report = Get-WorkerProperty -Object $RawHandoff -Name 'Report'
    }
}

$workspace = ''
$handoff = $null
$workerStatus = 'FAILED'
$workerExitCode = 1

try {
    $resolvedTaskFile = (Resolve-Path -LiteralPath $TaskFile).Path
    $resolvedHandoff = (Resolve-Path -LiteralPath $HandoffScriptPath).Path
    $resolvedSourceRepo = (Resolve-Path -LiteralPath $SourceRepoPath).Path
    $workerRootFull = [System.IO.Path]::GetFullPath($WorkerRoot)
    New-Item -ItemType Directory -Force -Path $workerRootFull | Out-Null

    if ($DryRun) {
        $workspace = $resolvedSourceRepo
        Write-WorkerLifecycle -Phase 'RUNNING' -Workspace $workspace -Branch '(dry-run)'
    } else {
        $workspace = Join-Path $workerRootFull $JobId
        Assert-WorkerChildPath -Root $workerRootFull -Child $workspace
        if (Test-Path -LiteralPath $workspace) {
            throw "Scheduler-owned worker path already exists; refusing blind reuse."
        }

        $devRefOutput = @(& git ls-remote --exit-code --heads -- $RepoUrl dev 2>&1)
        if ($LASTEXITCODE -ne 0 -or @($devRefOutput).Count -eq 0) {
            throw "origin/dev is unavailable in '$RepoUrl'; live Wishlist worker launch is blocked without remote bootstrap."
        }

        Write-WorkerLifecycle -Phase 'PREPARING' -Workspace $workspace -Branch $BranchName -Message 'Creating isolated normal clone from origin/dev.'
        $cloneOutput = @(& git -c core.longpaths=true clone --quiet --branch dev --single-branch --no-tags -- $RepoUrl $workspace 2>&1)
        if ($LASTEXITCODE -ne 0) {
            throw "git clone failed with exit code $LASTEXITCODE."
        }
        if (-not (Test-Path -LiteralPath (Join-Path $workspace '.git') -PathType Container)) {
            throw 'Clone completed without a normal .git directory.'
        }

        $longPathOutput = @(& git -C $workspace config core.longpaths true 2>&1)
        if ($LASTEXITCODE -ne 0) {
            throw 'Unable to enable Git long-path support in the worker clone.'
        }

        $switchOutput = @(& git -C $workspace switch --quiet -c $BranchName 2>&1)
        if ($LASTEXITCODE -ne 0) {
            throw "git switch failed with exit code $LASTEXITCODE."
        }
        $actualBranch = (@(& git -C $workspace branch --show-current 2>&1) -join '').Trim()
        if ($LASTEXITCODE -ne 0 -or $actualBranch -ne $BranchName) {
            throw 'Worker branch verification failed.'
        }
        Write-WorkerLifecycle -Phase 'RUNNING' -Workspace $workspace -Branch $actualBranch
    }

    $handoffArguments = @{
        TaskFile = $resolvedTaskFile
        RepoPath = $workspace
        Json = $true
        NoProcessExit = $true
        LifecyclePath = $LifecyclePath
    }
    if (-not [string]::IsNullOrWhiteSpace($RoutingConfigPath)) {
        $handoffArguments['RoutingConfigPath'] = $RoutingConfigPath
    }
    if (-not [string]::IsNullOrWhiteSpace($ReportDirectory)) {
        $handoffArguments['ReportDirectory'] = $ReportDirectory
    }
    if (-not [string]::IsNullOrWhiteSpace($GitHubCommandPath)) {
        $handoffArguments['GitHubCommandPath'] = $GitHubCommandPath
    }
    if ($AllowAstra) {
        $handoffArguments['AllowAstra'] = $true
    }
    if ($DryRun) {
        # Invoke-WishlistTask is preview-only unless -Apply is present.
    } else {
        $handoffArguments['Apply'] = $true
    }

    $handoffOutput = @(& $resolvedHandoff @handoffArguments 2>&1 | ForEach-Object { [string]$_ })
    $handoffText = ($handoffOutput -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($handoffText)) {
        throw 'Handoff returned no JSON result.'
    }
    try {
        $rawHandoff = $handoffText | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw 'Handoff returned non-JSON output.'
    }

    switch ([string]$rawHandoff.Status) {
        'PASS' { $workerStatus = 'COMPLETE'; $workerExitCode = 0 }
        'BLOCKED' { $workerStatus = 'BLOCKED'; $workerExitCode = 2 }
        'FAIL' { $workerStatus = 'FAILED'; $workerExitCode = 1 }
        default { $workerStatus = 'FAILED'; $workerExitCode = 3 }
    }
    $handoff = ConvertTo-SafeWorkerHandoff -RawHandoff $rawHandoff
} catch {
    $handoff = [pscustomobject]@{
        Status = 'INFRA'
        Reason = $_.Exception.Message
        Task = $null
        Route = $null
        Launch = $null
        Report = $null
    }
    $workerStatus = 'FAILED'
    $workerExitCode = 3
} finally {
    $result = [pscustomobject]@{
        SchemaVersion = 1
        JobId = $JobId
        Status = $workerStatus
        ExitCode = $workerExitCode
        Workspace = $workspace
        Branch = if ($DryRun) { '(dry-run)' } else { $BranchName }
        CompletedUtc = (Get-Date).ToUniversalTime().ToString('o')
        Handoff = $handoff
    }
    Write-WorkerJsonAtomic -Path $ResultPath -Value $result
    Write-WorkerLifecycle -Phase $workerStatus -Workspace $workspace -Branch $result.Branch
}

exit $workerExitCode
