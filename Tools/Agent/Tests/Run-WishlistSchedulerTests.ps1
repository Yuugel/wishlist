[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$testRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentRoot = Split-Path -Parent $testRoot
$handoffRoot = Join-Path $agentRoot 'Handoff'
$fixtureRoot = Join-Path $testRoot 'fixtures'

Import-Module (Join-Path $handoffRoot 'WishlistScheduler.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $handoffRoot 'TaskParser.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $handoffRoot 'WishlistHotkeyPump.psm1') -Force
Import-Module (Join-Path $handoffRoot 'WishlistConsoleRenderer.psm1') -Force -DisableNameChecking

$script:Total = 0
$script:Passed = 0
$script:Failed = 0
$script:Failures = New-Object 'System.Collections.Generic.List[string]'
$script:DisposableRoot = Join-Path ([IO.Path]::GetTempPath()) ('wishlist-scheduler-tests-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $script:DisposableRoot | Out-Null

function Assert-True {
    param([Parameter(Mandatory = $true)][bool]$Condition, [Parameter(Mandatory = $true)][string]$Name)
    $script:Total++
    if ($Condition) { $script:Passed++; Write-Output "PASS: $Name" }
    else { $script:Failed++; $script:Failures.Add($Name) | Out-Null; Write-Output "FAIL: $Name" }
}

function Assert-Equal {
    param([AllowNull()][object]$Actual, [AllowNull()][object]$Expected, [Parameter(Mandatory = $true)][string]$Name)
    $same = if ($null -eq $Actual -and $null -eq $Expected) { $true } elseif ($null -eq $Actual -or $null -eq $Expected) { $false } else { [string]$Actual -eq [string]$Expected }
    Assert-True -Condition $same -Name ("{0} (expected '{1}', got '{2}')" -f $Name, $Expected, $Actual)
}

function Assert-Throws {
    param([Parameter(Mandatory = $true)][scriptblock]$Action, [Parameter(Mandatory = $true)][string]$Name)
    $threw = $false
    try { & $Action } catch { $threw = $true }
    Assert-True -Condition $threw -Name $Name
}

function New-TestConsoleSurface {
    param(
        [int]$Width = 80,
        [int]$Height = 25,
        [bool]$Interactive = $true
    )

    $state = [pscustomobject]@{
        Width = $Width
        Height = $Height
        Writes = New-Object 'System.Collections.Generic.List[string]'
        Rows = New-Object 'System.Collections.Generic.List[string]'
        CursorRow = 0
        CursorColumn = 0
    }
    $getWidth = { return $state.Width }.GetNewClosure()
    $getHeight = { return $state.Height }.GetNewClosure()
    $write = { param([string]$Text); $state.Writes.Add($Text) | Out-Null }.GetNewClosure()
    return [pscustomobject]@{
        IsInteractive = $Interactive
        GetWidth = $getWidth
        GetHeight = $getHeight
        Write = $write
        State = $state
    }
}

function Apply-TestConsolePayload {
    param(
        [Parameter(Mandatory = $true)][object]$State,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Payload
    )

    $index = 0
    while ($index -lt $Payload.Length) {
        if ([int][char]$Payload[$index] -eq 27) {
            $match = [regex]::Match($Payload.Substring($index), '^\x1b\[([0-9?;]*)([A-Za-z])')
            if ($match.Success) {
                $parameter = [string]$match.Groups[1].Value
                $operation = [string]$match.Groups[2].Value
                $number = 1
                if ($parameter -match '^\d+$') { $number = [int]$parameter }
                switch ($operation) {
                    'A' { $State.CursorRow = [Math]::Max(0, [int]$State.CursorRow - $number) }
                    'G' { $State.CursorColumn = [Math]::Max(0, $number - 1) }
                    'H' { $State.CursorRow = 0; $State.CursorColumn = 0 }
                    'J' {
                        if ($parameter -eq '2') {
                            $State.Rows.Clear()
                            $State.CursorRow = 0
                            $State.CursorColumn = 0
                        }
                    }
                    'K' {
                        if ($parameter -eq '2') {
                            while ($State.Rows.Count -le [int]$State.CursorRow) { $State.Rows.Add('') | Out-Null }
                            $State.Rows[[int]$State.CursorRow] = ''
                        }
                    }
                }
                $index += $match.Length
                continue
            }
        }

        $character = [string]$Payload[$index]
        if ($character -eq "`r") {
            $State.CursorColumn = 0
        } elseif ($character -eq "`n") {
            $State.CursorRow++
        } else {
            while ($State.Rows.Count -le [int]$State.CursorRow) { $State.Rows.Add('') | Out-Null }
            $line = [string]$State.Rows[[int]$State.CursorRow]
            if ($line.Length -lt [int]$State.CursorColumn) { $line = $line.PadRight([int]$State.CursorColumn) }
            if ([int]$State.CursorColumn -lt $line.Length) {
                $suffix = if (([int]$State.CursorColumn + 1) -lt $line.Length) { $line.Substring([int]$State.CursorColumn + 1) } else { '' }
                $line = $line.Substring(0, [int]$State.CursorColumn) + $character + $suffix
            } else {
                $line += $character
            }
            $State.Rows[[int]$State.CursorRow] = $line
            $State.CursorColumn++
        }
        $index++
    }
}

function Write-TestConsoleFrame {
    param(
        [Parameter(Mandatory = $true)][object]$Renderer,
        [Parameter(Mandatory = $true)][object]$Surface,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Lines
    )

    $before = $Surface.State.Writes.Count
    $null = Write-WishlistConsoleFrame -Renderer $Renderer -Lines $Lines
    if ($Surface.State.Writes.Count -gt $before) {
        Apply-TestConsolePayload -State $Surface.State -Payload $Surface.State.Writes[$Surface.State.Writes.Count - 1]
    }
}

function Get-TestConsoleText {
    param([Parameter(Mandatory = $true)][object]$Surface)
    return (@($Surface.State.Rows) -join "`n")
}

function New-TestTaskText {
    param(
        [string]$Ticket = '',
        [string]$Risk = 'medium',
        [string]$Type = 'implementation',
        [string]$Model = 'auto',
        [string]$Body = 'Bounded scheduler test.',
        [string]$DependsOn = '',
        [switch]$IncludeDependsOn
    )
    $ticketLine = if ([string]::IsNullOrWhiteSpace($Ticket)) { '' } else { "ticket: $Ticket`n" }
    $dependencyLine = if ($IncludeDependsOn) { "depends-on: $DependsOn`n" } else { '' }
    return "@@PI_TASK`nproject: Wishlist`n${ticketLine}type: $Type`nscope: workflow`nrisk: $Risk`nmodel: $Model`n${dependencyLine}`n$Body"
}

function Add-TestJob {
    param([object]$Scheduler, [string]$Text)
    $parsed = Parse-WishlistTask -Text $Text
    if (-not $parsed.IsValid) { throw ($parsed.Errors -join ' ') }
    return Add-WishlistSchedulerJob -Scheduler $Scheduler -TaskDefinition $parsed.Definition -PayloadText $Text -Source TEST
}

function New-FakeProcess {
    param([int]$Id)
    $process = [pscustomobject]@{ Id = $Id; HasExited = $false; ExitCode = 0; Disposed = $false; Stopped = $false }
    $process | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $this.Disposed = $true } | Out-Null
    $process | Add-Member -MemberType ScriptMethod -Name Kill -Value { $this.Stopped = $true; $this.HasExited = $true } | Out-Null
    $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param([int]$Milliseconds); return $true } | Out-Null
    return $process
}

function New-TestScheduler {
    param(
        [string]$Name,
        [int]$MaxWorkers = 2,
        [switch]$AllowAstra,
        [switch]$DryRun,
        [AllowNull()][scriptblock]$Starter = $null,
        [AllowNull()][scriptblock]$Stopper = $null
    )
    $stateRoot = Join-Path $script:DisposableRoot $Name
    if ($null -eq $Starter) {
        $Starter = { param($Job, $Arguments, $Scheduler); return New-FakeProcess -Id (1000 + [int]$Job.Sequence) }.GetNewClosure()
    }
    return New-WishlistScheduler `
        -StateRoot $stateRoot `
        -SourceRepoPath $agentRoot `
        -RepoUrl $agentRoot `
        -HandoffScriptPath (Join-Path $handoffRoot 'Invoke-WishlistTask.ps1') `
        -WorkerScriptPath (Join-Path $handoffRoot 'Start-WishlistWorker.ps1') `
        -MaxWorkers $MaxWorkers `
        -AllowAstra:$AllowAstra `
        -DryRun:$DryRun `
        -ProcessStarter $Starter `
        -ProcessStopper $Stopper
}

$script:HostMessages = New-Object 'System.Collections.Generic.List[string]'
function Write-WishlistHostLine {
    param([Parameter(Mandatory = $true)][string]$Message)
    $script:HostMessages.Add($Message) | Out-Null
    Write-Output $Message
}

function Get-TestHostEnqueueFunctionText {
    $hostScript = Join-Path $handoffRoot 'Start-WishlistAgentHost.ps1'
    $tokens = $null
    $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($hostScript, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0) { throw 'Unable to parse Start-WishlistAgentHost.ps1 for the host enqueue regression test.' }
    $functionAst = $ast.Find({
        param($node)
        return ($node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Add-WishlistHotkeySnapshot')
    }, $true)
    if ($null -eq $functionAst) { throw 'Add-WishlistHotkeySnapshot was not found in the host script.' }
    return $functionAst.Extent.Text
}

function Set-FakeWorkerResult {
    param(
        [object]$Scheduler,
        [object]$Job,
        [string]$Status = 'COMPLETE',
        [string]$HandoffStatus = 'PASS',
        [string]$Response = '',
        [bool]$TerminalCompletionEvidence = $true,
        [int]$JsonEventCount = 3,
        [string]$PiStatus = 'PI_EXECUTED',
        [string]$FailureReason = ''
    )
    $runtime = $Scheduler.Runtime[[string]$Job.JobId]
    $result = [pscustomobject]@{
        SchemaVersion = 1
        JobId = $Job.JobId
        Status = $Status
        ExitCode = if ($Status -eq 'COMPLETE') { 0 } else { 1 }
        Workspace = $Job.Workspace
        Branch = $Job.Branch
        Handoff = [pscustomobject]@{
            Status = $HandoffStatus
            Reason = "Result for $($Job.JobId)"
            Launch = [pscustomobject]@{
                 Status = $HandoffStatus
                 PiStatus = $PiStatus
                 ExitCode = if ($HandoffStatus -eq 'PASS') { 0 } else { 1 }
                 PiSessionId = "session-$($Job.Sequence)"
                 Response = $Response
                 JsonEventCount = $JsonEventCount
                 TerminalCompletionEvidence = $TerminalCompletionEvidence
                 TerminalEventType = if ($TerminalCompletionEvidence) { 'agent_end' } else { $null }
                 FailureReason = $FailureReason
                 UsageSummary = [pscustomobject]@{ InputTokens = $Job.Sequence; OutputTokens = 2; TotalTokens = $Job.Sequence + 2; Cost = 0 }
             }
            Report = [pscustomobject]@{ Status = 'WARNING'; Message = 'Secondary report warning.' }
        }
    }
    $result | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $runtime.ResultPath -Encoding UTF8
    $runtime.Process.HasExited = $true
}

function Set-TestCompletedJob {
    param(
        [Parameter(Mandatory = $true)][object]$Job,
        [ValidateSet('COMPLETE', 'FAILED', 'BLOCKED', 'CANCELLED')][string]$Status = 'COMPLETE',
        [Parameter(Mandatory = $true)][string]$EndTimeUtc,
        [AllowEmptyString()][string]$ReportStatus = 'POSTED',
        [AllowNull()][object]$Usage = $null,
        [AllowEmptyString()][string]$Response = '',
        [AllowEmptyString()][string]$FailureReason = ''
    )

    $Job.Status = $Status
    $Job.EndTimeUtc = $EndTimeUtc
    $Job.LastActivityUtc = $EndTimeUtc
    $Job.WorkerSlot = $null
    $Job.TerminalResult = [pscustomobject]@{
        Code = $Status
        Message = if ([string]::IsNullOrWhiteSpace($FailureReason)) { '' } else { $FailureReason }
        Launch = [pscustomobject]@{
            Response = $Response
            FailureReason = $FailureReason
        }
    }
    $Job.Usage = $Usage
    $Job.Report = if ([string]::IsNullOrWhiteSpace($ReportStatus)) {
        $null
    } else {
        [pscustomobject]@{
            Status = $ReportStatus
            LocalPath = if ($ReportStatus -in @('LOCAL', 'WARNING')) { Join-Path $script:DisposableRoot ($Job.JobId + '.json') } else { '' }
        }
    }
    return $Job
}

function Invoke-TestGit {
    param([string]$RepoPath, [string[]]$Arguments)
    $output = @(& git -C $RepoPath @Arguments 2>&1 | ForEach-Object { [string]$_ })
    if ($LASTEXITCODE -ne 0) { throw "git failed: $($output -join ' ')" }
    return ($output -join "`n").Trim()
}

function Get-TestTextSha256 {
    param([Parameter(Mandatory = $true)][string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text))) -replace '-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

try {
    $capacityState = New-TestScheduler -Name 'capacity-state' -MaxWorkers 3
    $capacityProperty = $capacityState.State.PSObject.Properties['MaxWorkers']
    Assert-True -Condition ($null -ne $capacityProperty) -Name 'scheduler state exposes configured MaxWorkers'
    Assert-Equal -Actual $(if ($null -eq $capacityProperty) { $null } else { [int]$capacityProperty.Value }) -Expected 3 -Name 'scheduler state uses configured MaxWorkers'
    $persistedCapacityState = Get-Content -LiteralPath $capacityState.StatePath -Raw | ConvertFrom-Json
    $persistedCapacityProperty = $persistedCapacityState.PSObject.Properties['MaxWorkers']
    Assert-True -Condition ($null -ne $persistedCapacityProperty) -Name 'scheduler persists configured MaxWorkers'
    Assert-Equal -Actual $(if ($null -eq $persistedCapacityProperty) { $null } else { [int]$persistedCapacityProperty.Value }) -Expected 3 -Name 'persisted MaxWorkers matches configured capacity'

    $legacyCapacity = New-TestScheduler -Name 'capacity-legacy' -MaxWorkers 2
    $legacyDocument = Get-Content -LiteralPath $legacyCapacity.StatePath -Raw | ConvertFrom-Json
    $legacyDocument.PSObject.Properties.Remove('MaxWorkers')
    $legacyDocument | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $legacyCapacity.StatePath -Encoding UTF8
    $reloadedCapacity = New-TestScheduler -Name 'capacity-legacy' -MaxWorkers 5
    $reloadedCapacityProperty = $reloadedCapacity.State.PSObject.Properties['MaxWorkers']
    Assert-True -Condition ($null -ne $reloadedCapacityProperty) -Name 'legacy state without MaxWorkers adopts runtime capacity'
    Assert-Equal -Actual $(if ($null -eq $reloadedCapacityProperty) { $null } else { [int]$reloadedCapacityProperty.Value }) -Expected 5 -Name 'legacy state upgrade uses runtime MaxWorkers'
    $reloadedDocument = Get-Content -LiteralPath $reloadedCapacity.StatePath -Raw | ConvertFrom-Json
    $reloadedDocumentProperty = $reloadedDocument.PSObject.Properties['MaxWorkers']
    Assert-True -Condition ($null -ne $reloadedDocumentProperty) -Name 'legacy state upgrade persists MaxWorkers'
    Assert-Equal -Actual $(if ($null -eq $reloadedDocumentProperty) { $null } else { [int]$reloadedDocumentProperty.Value }) -Expected 5 -Name 'legacy persisted MaxWorkers matches runtime capacity'

    Invoke-Expression (Get-TestHostEnqueueFunctionText)
    $hostScheduler = New-TestScheduler -Name 'hotkey-enqueue-boundary'
    $hostText = New-TestTaskText -Ticket 1101 -Body 'Hotkey enqueue return-boundary regression.'
    $script:HostMessages.Clear()
    $hostSnapshot = [pscustomobject]@{ Error = ''; Text = $hostText }
    $hostOutput = @(Add-WishlistHotkeySnapshot -Scheduler $hostScheduler -Snapshot $hostSnapshot)
    Assert-Equal -Actual $hostOutput.Count -Expected 1 -Name 'hotkey enqueue returns exactly one object on the success stream'
    $hostJobId = $null
    $hostJobIdError = $null
    try { $hostJobId = [string]$hostOutput[0].JobId } catch { $hostJobIdError = $_.Exception.Message }
    Assert-True -Condition ([string]::IsNullOrWhiteSpace($hostJobIdError)) -Name 'host can access JobId without a success-stream shape error'
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($hostJobId)) -Name 'host enqueue result exposes a JobId'
    $persistedHostJob = @($hostScheduler.State.Jobs | Where-Object { $_.JobId -eq $hostJobId })
    Assert-Equal -Actual $persistedHostJob.Count -Expected 1 -Name 'hotkey enqueue persists the returned job'
    $persistedPayloadPath = if ($persistedHostJob.Count -eq 1) { [string]$persistedHostJob[0].PayloadPath } else { '' }
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace($persistedPayloadPath) -and (Test-Path -LiteralPath $persistedPayloadPath -PathType Leaf)) -Name 'hotkey enqueue persists the immutable task payload'
    Assert-Equal -Actual @($hostScheduler.Events | Where-Object { $_.Type -eq 'ENQUEUED' }).Count -Expected 1 -Name 'hotkey enqueue retains its ENQUEUED scheduler event'
    Assert-True -Condition (@($script:HostMessages | Where-Object { $_ -like 'TASK ACCEPTED / QUEUED:*' }).Count -eq 1) -Name 'hotkey enqueue retains its host status display'

    $clipboardBefore = $null
    $clipboardPump = $null
    try {
        $clipboardBefore = Get-Clipboard -Raw -ErrorAction Stop
        Set-Clipboard -Value 'scheduler clipboard snapshot alpha'
        $clipboardPump = New-WishlistHotkeyMessagePump -HotkeyId (Get-Random -Minimum 20000 -Maximum 30000) -ModifierFlags ([uint32]0x4000) -VirtualKey ([uint32]0x87)
        $clipboardPump.Start()
        Assert-True -Condition ($clipboardPump.WaitForReady(5000) -and $clipboardPump.Status -eq 'READY') -Name 'snapshot test hotkey pump registers on its dedicated message thread'
        $null = $clipboardPump.PostTestHotkey()
        Assert-True -Condition ($clipboardPump.WaitForHotkey(5000)) -Name 'snapshot test hotkey event is delivered'
        Set-Clipboard -Value 'scheduler clipboard changed later'
        $capturedSnapshot = $clipboardPump.TryTakeHotkeySnapshot()
        Assert-Equal -Actual $capturedSnapshot.Text -Expected 'scheduler clipboard snapshot alpha' -Name 'hotkey pump captures clipboard before later clipboard changes'
    } finally {
        if ($null -ne $clipboardPump) { $clipboardPump.Dispose() }
        if ($null -ne $clipboardBefore) { Set-Clipboard -Value $clipboardBefore }
    }

    $noDependencyParse = Parse-WishlistTask -Text (New-TestTaskText -Ticket 1001)
    Assert-True -Condition $noDependencyParse.IsValid -Name 'task without depends-on remains valid'
    Assert-Equal -Actual @($noDependencyParse.Definition.Dependencies).Count -Expected 0 -Name 'omitted depends-on normalizes to an empty list'
    $dashDependencyParse = Parse-WishlistTask -Text (New-TestTaskText -Ticket 1002 -DependsOn '-' -IncludeDependsOn)
    Assert-True -Condition $dashDependencyParse.IsValid -Name 'depends-on dash remains valid'
    Assert-Equal -Actual @($dashDependencyParse.Definition.Dependencies).Count -Expected 0 -Name 'depends-on dash normalizes to an empty list'
    $emptyDependencyParse = Parse-WishlistTask -Text (New-TestTaskText -Ticket 1003 -DependsOn '' -IncludeDependsOn)
    Assert-True -Condition $emptyDependencyParse.IsValid -Name 'empty depends-on remains valid'
    Assert-Equal -Actual @($emptyDependencyParse.Definition.Dependencies).Count -Expected 0 -Name 'empty depends-on normalizes to an empty list'
    $singleDependencyParse = Parse-WishlistTask -Text (New-TestTaskText -Ticket 1004 -DependsOn '103' -IncludeDependsOn)
    Assert-Equal -Actual (@($singleDependencyParse.Definition.Dependencies) -join ',') -Expected '103' -Name 'single dependency is normalized to an integer list'
    $multipleDependencyParse = Parse-WishlistTask -Text (New-TestTaskText -Ticket 1005 -DependsOn ' 103, 98,103,098 ' -IncludeDependsOn)
    Assert-Equal -Actual (@($multipleDependencyParse.Definition.Dependencies) -join ',') -Expected '103,98' -Name 'multiple dependencies trim commas and deduplicate normalized IDs'
    $invalidDependencyParse = Parse-WishlistTask -Text (New-TestTaskText -Ticket 1006 -DependsOn '103, nope, 0, -4' -IncludeDependsOn)
    Assert-True -Condition (-not $invalidDependencyParse.IsValid -and (($invalidDependencyParse.Errors -join ' ') -like '*DEPENDENCY_INVALID*')) -Name 'invalid dependency values fail validation without provider work'
    $selfDependencyParse = Parse-WishlistTask -Text (New-TestTaskText -Ticket 1007 -DependsOn '1007' -IncludeDependsOn)
    Assert-True -Condition (-not $selfDependencyParse.IsValid -and (($selfDependencyParse.Errors -join ' ') -like '*SELF_DEPENDENCY*')) -Name 'self dependency is rejected during task validation'
    $dependencyJson = $multipleDependencyParse.Definition | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    Assert-Equal -Actual (@($dependencyJson.Dependencies) -join ',') -Expected '103,98' -Name 'normalized dependencies are structured JSON data'

    $started = New-Object 'System.Collections.Generic.List[object]'
    $starter = {
        param($Job, $Arguments, $Scheduler)
        $process = New-FakeProcess -Id (2000 + [int]$Job.Sequence)
        $started.Add([pscustomobject]@{ Job = $Job; Arguments = @($Arguments); Process = $process }) | Out-Null
        return $process
    }.GetNewClosure()
    $burst = New-TestScheduler -Name 'burst' -Starter $starter
    $textA = New-TestTaskText -Ticket 101 -Body 'Immutable snapshot alpha unique.'
    $textB = New-TestTaskText -Ticket 102 -Body 'Immutable snapshot beta unique.'
    $textC = New-TestTaskText -Ticket 103 -Body 'Immutable snapshot gamma unique.'
    $jobA = Add-TestJob -Scheduler $burst -Text $textA
    $jobB = Add-TestJob -Scheduler $burst -Text $textB
    $jobC = Add-TestJob -Scheduler $burst -Text $textC
    $textA = 'clipboard changed after enqueue'
    Assert-Equal -Actual $burst.State.Jobs.Count -Expected 3 -Name 'burst enqueue creates three distinct jobs'
    Assert-Equal -Actual ([System.IO.File]::ReadAllText($jobA.PayloadPath)) -Expected (New-TestTaskText -Ticket 101 -Body 'Immutable snapshot alpha unique.') -Name 'queued payload remains the original immutable snapshot'
    Assert-True -Condition ($jobA.JobId -ne $jobB.JobId -and $jobB.JobId -ne $jobC.JobId) -Name 'burst jobs receive unique job IDs'
    $stateText = Get-Content -LiteralPath $burst.StatePath -Raw
    Assert-True -Condition ($stateText -notlike '*Immutable snapshot alpha unique*') -Name 'task bodies are stored outside scheduler state metadata'
    $payloadCountBefore = @(Get-ChildItem -LiteralPath $burst.PayloadRoot -File).Count
    Assert-Throws -Name 'unmarked clipboard text is rejected by the enqueue boundary' -Action { Add-WishlistSchedulerJob -Scheduler $burst -TaskDefinition ([pscustomobject]@{}) -PayloadText 'ordinary clipboard content' -Source HOTKEY }
    Assert-Equal -Actual @(Get-ChildItem -LiteralPath $burst.PayloadRoot -File).Count -Expected $payloadCountBefore -Name 'unmarked clipboard content is never persisted'

    $null = Invoke-WishlistSchedulerTick -Scheduler $burst
    Assert-Equal -Actual @(($burst.State.Jobs | Where-Object { $_.Status -in @('PREPARING', 'RUNNING', 'REPORTING') })).Count -Expected 2 -Name 'maxWorkers defaults to two active jobs'
    Assert-Equal -Actual $jobC.Status -Expected 'QUEUED' -Name 'third burst job remains queued at capacity'
    Assert-Equal -Actual @($burst.State.Workers).Count -Expected 2 -Name 'started mutating jobs register two scheduler-owned workers'
    Assert-True -Condition ($burst.State.Workers[0].Path -ne $burst.State.Workers[1].Path) -Name 'parallel jobs receive separate clone paths'
    Assert-True -Condition ([bool]$burst.State.Workers[0].Owned -and [bool]$burst.State.Workers[0].Retain) -Name 'worker registry marks ownership and retention explicitly'

    Set-FakeWorkerResult -Scheduler $burst -Job $jobA -Status FAILED -HandoffStatus FAIL -Response 'A failed only.' -TerminalCompletionEvidence $false -JsonEventCount 0 -PiStatus 'PI_PROTOCOL_INCOMPLETE' -FailureReason 'No terminal agent_end completion event was observed.'
    Set-FakeWorkerResult -Scheduler $burst -Job $jobB -Status COMPLETE -HandoffStatus PASS -Response 'B completed only.'
    $null = Invoke-WishlistSchedulerTick -Scheduler $burst
    Assert-Equal -Actual $jobA.Status -Expected 'FAILED' -Name 'worker A failure remains assigned to worker A'
    Assert-Equal -Actual $jobB.Status -Expected 'COMPLETE' -Name 'worker B completes independently of worker A'
    Assert-Equal -Actual $jobB.TerminalResult.Launch.Response -Expected 'B completed only.' -Name 'worker result is correlated by job ID'
    Assert-True -Condition (-not (Test-Path -LiteralPath $jobA.PayloadPath)) -Name 'terminal failure discards the retained task payload'
    Assert-True -Condition (-not (Test-Path -LiteralPath $jobB.PayloadPath)) -Name 'terminal completion discards the retained task payload'
    Assert-Equal -Actual $jobA.TerminalResult.Launch.TerminalCompletionEvidence -Expected $false -Name 'suspicious Pi completion remains non-success in the scheduler result'
    Assert-Equal -Actual $jobA.TerminalResult.Launch.PiStatus -Expected 'PI_PROTOCOL_INCOMPLETE' -Name 'scheduler retains the protocol-incomplete Pi diagnosis'
    $retainedFailedWorker = @($burst.State.Workers | Where-Object { $_.JobId -eq $jobA.JobId })[0]
    Assert-True -Condition ($null -ne $retainedFailedWorker -and [bool]$retainedFailedWorker.Retain -and [string]$retainedFailedWorker.Path -eq [string]$jobA.Workspace) -Name 'suspicious worker workspace remains retained for recovery'
    Assert-True -Condition ($jobC.Status -in @('PREPARING', 'RUNNING')) -Name 'slot release automatically starts the next queued job'

    $dependencySlot = New-TestScheduler -Name 'dependency-slot' -MaxWorkers 1
    $missingDependencyJob = Add-TestJob -Scheduler $dependencySlot -Text (New-TestTaskText -Ticket 1101 -DependsOn '1100' -IncludeDependsOn -Body 'Wait for a missing ticket.')
    $independentSlotJob = Add-TestJob -Scheduler $dependencySlot -Text (New-TestTaskText -Ticket 1102 -Body 'Use the free worker slot.')
    Assert-Equal -Actual $missingDependencyJob.Status -Expected 'WAITING_DEPENDENCY' -Name 'missing dependency is visible as WAITING_DEPENDENCY'
    Assert-Equal -Actual $missingDependencyJob.DependencyReason -Expected 'DEPENDENCY_MISSING' -Name 'missing dependency records DEPENDENCY_MISSING'
    Assert-Equal -Actual $missingDependencyJob.DependencyDetails[0].Status -Expected 'MISSING' -Name 'missing dependency state is structured on the job'
    $null = Invoke-WishlistSchedulerTick -Scheduler $dependencySlot
    Assert-True -Condition ($independentSlotJob.Status -in @('PREPARING', 'RUNNING')) -Name 'waiting dependency does not consume the only worker slot'
    Assert-Equal -Actual $missingDependencyJob.Status -Expected 'WAITING_DEPENDENCY' -Name 'missing dependency remains waiting after a scheduling tick'
    $dependencySlotSummary = Get-WishlistSchedulerSummary -Scheduler $dependencySlot
    Assert-Equal -Actual @($dependencySlotSummary.Workers).Count -Expected 1 -Name 'waiting dependency is absent from active worker state'
    $dependencyDashboard = @(Format-WishlistSchedulerStatus -Scheduler $dependencySlot) -join "`n"
    Assert-True -Condition ($dependencyDashboard -like '*WAITING*' -and $dependencyDashboard -like '*missing #1100*') -Name 'queue view explains a missing dependency without log search'

    $dependencyLifecycle = New-TestScheduler -Name 'dependency-lifecycle' -MaxWorkers 1
    $dependencyQueued = Add-TestJob -Scheduler $dependencyLifecycle -Text (New-TestTaskText -Ticket 1200 -Body 'Dependency queued first.')
    $dependencyChild = Add-TestJob -Scheduler $dependencyLifecycle -Text (New-TestTaskText -Ticket 1201 -DependsOn '1200' -IncludeDependsOn -Body 'Wait for the queued dependency.')
    Assert-Equal -Actual $dependencyChild.Status -Expected 'WAITING_DEPENDENCY' -Name 'QUEUED dependency keeps the child waiting'
    Assert-Equal -Actual $dependencyChild.DependencyReason -Expected 'DEPENDENCY_PENDING' -Name 'queued dependency records DEPENDENCY_PENDING'
    $null = Invoke-WishlistSchedulerTick -Scheduler $dependencyLifecycle
    Assert-True -Condition ($dependencyChild.DependencyDetails[0].Status -in @('PREPARING', 'RUNNING')) -Name 'active dependency remains pending'
    Set-FakeWorkerResult -Scheduler $dependencyLifecycle -Job $dependencyQueued -Status COMPLETE -HandoffStatus PASS
    $null = Invoke-WishlistSchedulerTick -Scheduler $dependencyLifecycle
    Assert-True -Condition ($dependencyChild.Status -in @('PREPARING', 'RUNNING')) -Name 'COMPLETE dependency makes a child startable'

    $dependencyRetry = New-TestScheduler -Name 'dependency-retry' -MaxWorkers 1
    $failedDependency = Add-TestJob -Scheduler $dependencyRetry -Text (New-TestTaskText -Ticket 1300 -Body 'Initial dependency attempt.')
    $retryChild = Add-TestJob -Scheduler $dependencyRetry -Text (New-TestTaskText -Ticket 1301 -DependsOn '1300' -IncludeDependsOn -Body 'Retry can release this child.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $dependencyRetry
    Set-FakeWorkerResult -Scheduler $dependencyRetry -Job $failedDependency -Status FAILED -HandoffStatus FAIL
    $null = Invoke-WishlistSchedulerTick -Scheduler $dependencyRetry
    Assert-Equal -Actual $retryChild.Status -Expected 'WAITING_DEPENDENCY' -Name 'FAILED dependency never starts its child'
    Assert-Equal -Actual $retryChild.DependencyReason -Expected 'DEPENDENCY_FAILED' -Name 'FAILED dependency reason is explicit'
    $retryDependency = Add-TestJob -Scheduler $dependencyRetry -Text (New-TestTaskText -Ticket 1300 -Body 'Successful dependency retry.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $dependencyRetry
    Set-FakeWorkerResult -Scheduler $dependencyRetry -Job $retryDependency -Status COMPLETE -HandoffStatus PASS
    $null = Invoke-WishlistSchedulerTick -Scheduler $dependencyRetry
    Assert-True -Condition ($retryChild.Status -in @('PREPARING', 'RUNNING')) -Name 'later COMPLETE retry automatically releases a waiting child'

    foreach ($terminalDependencyCase in @(@('CANCELLED', 1310), @('BLOCKED', 1320))) {
        $terminalStatus = [string]$terminalDependencyCase[0]
        $terminalTicket = [string]$terminalDependencyCase[1]
        $terminalScheduler = New-TestScheduler -Name ('dependency-' + $terminalStatus.ToLowerInvariant()) -MaxWorkers 1
        $terminalDependency = Add-TestJob -Scheduler $terminalScheduler -Text (New-TestTaskText -Ticket $terminalTicket -Body "Dependency ending $terminalStatus.")
        $terminalChild = Add-TestJob -Scheduler $terminalScheduler -Text (New-TestTaskText -Ticket ([int]$terminalTicket + 1) -DependsOn $terminalTicket -IncludeDependsOn -Body "Child of $terminalStatus dependency.")
        $null = Invoke-WishlistSchedulerTick -Scheduler $terminalScheduler
        Set-FakeWorkerResult -Scheduler $terminalScheduler -Job $terminalDependency -Status $terminalStatus -HandoffStatus $terminalStatus
        $null = Invoke-WishlistSchedulerTick -Scheduler $terminalScheduler
        Assert-Equal -Actual $terminalChild.Status -Expected 'WAITING_DEPENDENCY' -Name "$terminalStatus dependency never starts its child"
        Assert-Equal -Actual $terminalChild.DependencyReason -Expected ('DEPENDENCY_' + $terminalStatus) -Name "$terminalStatus dependency reason is explicit"
    }

    $multipleDependencies = New-TestScheduler -Name 'dependency-all' -MaxWorkers 2
    $dependencyOne = Add-TestJob -Scheduler $multipleDependencies -Text (New-TestTaskText -Ticket 1401 -Body 'First dependency.')
    $dependencyTwo = Add-TestJob -Scheduler $multipleDependencies -Text (New-TestTaskText -Ticket 1402 -Body 'Second dependency.')
    $allDependenciesChild = Add-TestJob -Scheduler $multipleDependencies -Text (New-TestTaskText -Ticket 1403 -DependsOn '1401, 1402' -IncludeDependsOn -Body 'Wait for both dependencies.')
    Assert-Equal -Actual $allDependenciesChild.Status -Expected 'WAITING_DEPENDENCY' -Name 'multiple dependencies wait until all are complete'
    $null = Invoke-WishlistSchedulerTick -Scheduler $multipleDependencies
    Set-FakeWorkerResult -Scheduler $multipleDependencies -Job $dependencyOne -Status COMPLETE -HandoffStatus PASS
    $null = Invoke-WishlistSchedulerTick -Scheduler $multipleDependencies
    Assert-Equal -Actual $allDependenciesChild.Status -Expected 'WAITING_DEPENDENCY' -Name 'one COMPLETE dependency is not enough'
    Set-FakeWorkerResult -Scheduler $multipleDependencies -Job $dependencyTwo -Status COMPLETE -HandoffStatus PASS
    $null = Invoke-WishlistSchedulerTick -Scheduler $multipleDependencies
    Assert-True -Condition ($allDependenciesChild.Status -in @('PREPARING', 'RUNNING')) -Name 'all COMPLETE dependencies release the child'

    $completionHistory = New-TestScheduler -Name 'dependency-completion-history' -MaxWorkers 1
    $historicalComplete = Add-TestJob -Scheduler $completionHistory -Text (New-TestTaskText -Ticket 1501 -Body 'Historical successful dependency.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $completionHistory
    Set-FakeWorkerResult -Scheduler $completionHistory -Job $historicalComplete -Status COMPLETE -HandoffStatus PASS
    $null = Invoke-WishlistSchedulerTick -Scheduler $completionHistory
    $failedFollowUp = Add-TestJob -Scheduler $completionHistory -Text (New-TestTaskText -Ticket 1501 -Body 'Later failed follow-up.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $completionHistory
    Set-FakeWorkerResult -Scheduler $completionHistory -Job $failedFollowUp -Status FAILED -HandoffStatus FAIL
    $null = Invoke-WishlistSchedulerTick -Scheduler $completionHistory
    $historyChild = Add-TestJob -Scheduler $completionHistory -Text (New-TestTaskText -Ticket 1502 -DependsOn '1501' -IncludeDependsOn -Body 'Use the earlier successful completion.')
    Assert-Equal -Actual $historyChild.Status -Expected 'QUEUED' -Name 'earlier COMPLETE remains authoritative after a failed follow-up'
    $null = Invoke-WishlistSchedulerTick -Scheduler $completionHistory
    Assert-True -Condition ($historyChild.Status -in @('PREPARING', 'RUNNING')) -Name 'historical COMPLETE still permits a dependent job to start'

    $historicalCycleRetry = New-TestScheduler -Name 'dependency-cycle-historical-complete' -MaxWorkers 2
    $historicalCycleDependency = Add-TestJob -Scheduler $historicalCycleRetry -Text (New-TestTaskText -Ticket 1551 -Body 'Historical cycle anchor.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $historicalCycleRetry
    Set-FakeWorkerResult -Scheduler $historicalCycleRetry -Job $historicalCycleDependency -Status COMPLETE -HandoffStatus PASS
    $null = Invoke-WishlistSchedulerTick -Scheduler $historicalCycleRetry
    $historicalCycleChild = Add-TestJob -Scheduler $historicalCycleRetry -Text (New-TestTaskText -Ticket 1552 -DependsOn '1551' -IncludeDependsOn -Body 'Dependency edge is already satisfied.')
    $historicalCycleFollowUp = Add-TestJob -Scheduler $historicalCycleRetry -Text (New-TestTaskText -Ticket 1551 -DependsOn '1552' -IncludeDependsOn -Body 'Follow-up closes only a false cycle.')
    Assert-True -Condition ($historicalCycleChild.Status -ne 'BLOCKED' -and $historicalCycleFollowUp.Status -ne 'BLOCKED') -Name 'historical COMPLETE prevents a false dependency cycle'
    $null = Invoke-WishlistSchedulerTick -Scheduler $historicalCycleRetry
    Assert-True -Condition ($historicalCycleChild.Status -in @('PREPARING', 'RUNNING')) -Name 'historical cycle child can start from completed dependency'
    Set-FakeWorkerResult -Scheduler $historicalCycleRetry -Job $historicalCycleChild -Status COMPLETE -HandoffStatus PASS
    $null = Invoke-WishlistSchedulerTick -Scheduler $historicalCycleRetry
    Assert-True -Condition ($historicalCycleFollowUp.Status -in @('PREPARING', 'RUNNING')) -Name 'historical cycle follow-up releases after its dependency completes'

    $directCycle = New-TestScheduler -Name 'dependency-cycle-direct' -MaxWorkers 2
    $directCycleA = Add-TestJob -Scheduler $directCycle -Text (New-TestTaskText -Ticket 1601 -DependsOn '1602' -IncludeDependsOn -Body 'Direct cycle A.')
    $directCycleB = Add-TestJob -Scheduler $directCycle -Text (New-TestTaskText -Ticket 1602 -DependsOn '1601' -IncludeDependsOn -Body 'Direct cycle B.')
    Assert-Equal -Actual $directCycleA.Status -Expected 'BLOCKED' -Name 'direct dependency cycle blocks the first job'
    Assert-Equal -Actual $directCycleB.TerminalResult.Code -Expected 'DEPENDENCY_CYCLE' -Name 'direct dependency cycle records DEPENDENCY_CYCLE'
    $null = Invoke-WishlistSchedulerTick -Scheduler $directCycle
    $directCycleSummary = Get-WishlistSchedulerSummary -Scheduler $directCycle
    Assert-Equal -Actual @($directCycleSummary.Workers).Count -Expected 0 -Name 'direct cycle starts no workers'

    $threeCycle = New-TestScheduler -Name 'dependency-cycle-three' -MaxWorkers 3
    $threeCycleA = Add-TestJob -Scheduler $threeCycle -Text (New-TestTaskText -Ticket 1611 -DependsOn '1612' -IncludeDependsOn -Body 'Three-cycle A.')
    $threeCycleB = Add-TestJob -Scheduler $threeCycle -Text (New-TestTaskText -Ticket 1612 -DependsOn '1613' -IncludeDependsOn -Body 'Three-cycle B.')
    $threeCycleC = Add-TestJob -Scheduler $threeCycle -Text (New-TestTaskText -Ticket 1613 -DependsOn '1611' -IncludeDependsOn -Body 'Three-cycle C.')
    $threeCycleJobs = @($threeCycleA, $threeCycleB, $threeCycleC)
    Assert-True -Condition (@($threeCycleJobs | Where-Object { $_.Status -eq 'BLOCKED' }).Count -eq 3) -Name 'three-ticket dependency cycle blocks every involved job'
    Assert-True -Condition (@($threeCycle.State.Jobs | Where-Object { $_.TerminalResult.Code -eq 'DEPENDENCY_CYCLE' }).Count -eq 3) -Name 'three-ticket cycle has no silent waiting state'
    $null = Invoke-WishlistSchedulerTick -Scheduler $threeCycle
    $threeCycleSummary = Get-WishlistSchedulerSummary -Scheduler $threeCycle
    Assert-Equal -Actual @($threeCycleSummary.Workers).Count -Expected 0 -Name 'three-ticket cycle starts no workers'

    $dependencyRestart = New-TestScheduler -Name 'dependency-restart' -MaxWorkers 1
    $restoredWaiting = Add-TestJob -Scheduler $dependencyRestart -Text (New-TestTaskText -Ticket 1701 -DependsOn '1700' -IncludeDependsOn -Body 'Persistent waiting task.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $dependencyRestart
    $persistedDependencyState = Get-Content -LiteralPath $dependencyRestart.StatePath -Raw | ConvertFrom-Json
    $persistedJob = @($persistedDependencyState.Jobs | Where-Object { $_.JobId -eq $restoredWaiting.JobId })[0]
    Assert-Equal -Actual $persistedJob.Status -Expected 'WAITING_DEPENDENCY' -Name 'WAITING_DEPENDENCY persists across scheduler state writes'
    Assert-Equal -Actual (@($persistedJob.Task.Dependencies) -join ',') -Expected '1700' -Name 'dependencies persist in scheduler state JSON'
    $dependencyRestarted = New-TestScheduler -Name 'dependency-restart' -MaxWorkers 1
    $reloadedWaiting = @($dependencyRestarted.State.Jobs | Where-Object { $_.JobId -eq $restoredWaiting.JobId })[0]
    Assert-Equal -Actual $reloadedWaiting.Status -Expected 'WAITING_DEPENDENCY' -Name 'WAITING_DEPENDENCY survives host restart recovery'
    Assert-Equal -Actual $reloadedWaiting.DependencyReason -Expected 'DEPENDENCY_MISSING' -Name 'dependency reason is reconstructed after restart'
    $restartDependency = Add-TestJob -Scheduler $dependencyRestarted -Text (New-TestTaskText -Ticket 1700 -Body 'Restart dependency.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $dependencyRestarted
    Set-FakeWorkerResult -Scheduler $dependencyRestarted -Job $restartDependency -Status COMPLETE -HandoffStatus PASS
    $null = Invoke-WishlistSchedulerTick -Scheduler $dependencyRestarted
    Assert-True -Condition ($reloadedWaiting.Status -in @('PREPARING', 'RUNNING')) -Name 'restarted waiting job releases after a later dependency completion'

    $lockAndDependency = New-TestScheduler -Name 'dependency-ticket-lock' -MaxWorkers 2
    $lockDependency = Add-TestJob -Scheduler $lockAndDependency -Text (New-TestTaskText -Ticket 1800 -Body 'Dependency for ticket lock.')
    $sameTicketActive = Add-TestJob -Scheduler $lockAndDependency -Text (New-TestTaskText -Ticket 1801 -Body 'Existing same-ticket job.')
    $sameTicketWaiting = Add-TestJob -Scheduler $lockAndDependency -Text (New-TestTaskText -Ticket 1801 -DependsOn '1800' -IncludeDependsOn -Body 'Dependent same-ticket follow-up.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $lockAndDependency
    Set-FakeWorkerResult -Scheduler $lockAndDependency -Job $lockDependency -Status COMPLETE -HandoffStatus PASS
    $null = Invoke-WishlistSchedulerTick -Scheduler $lockAndDependency
    Assert-Equal -Actual $sameTicketWaiting.Status -Expected 'QUEUED' -Name 'dependency completion does not bypass the same-ticket lock'
    Set-FakeWorkerResult -Scheduler $lockAndDependency -Job $sameTicketActive -Status COMPLETE -HandoffStatus PASS
    $null = Invoke-WishlistSchedulerTick -Scheduler $lockAndDependency
    Assert-True -Condition ($sameTicketWaiting.Status -in @('PREPARING', 'RUNNING')) -Name 'same-ticket dependent starts after the active predecessor completes'

    $ticketScheduler = New-TestScheduler -Name 'ticket-lock'
    $ticketFirst = Add-TestJob -Scheduler $ticketScheduler -Text (New-TestTaskText -Ticket 104 -Body 'First ticket task.')
    $ticketSecond = Add-TestJob -Scheduler $ticketScheduler -Text (New-TestTaskText -Ticket 000104 -Body 'Follow-up ticket task.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $ticketScheduler
    Assert-True -Condition ($ticketFirst.Status -in @('PREPARING', 'RUNNING')) -Name 'first same-ticket job starts'
    Assert-Equal -Actual $ticketSecond.Status -Expected 'QUEUED' -Name 'normalized same-ticket follow-up remains queued'
    Set-FakeWorkerResult -Scheduler $ticketScheduler -Job $ticketFirst
    $null = Invoke-WishlistSchedulerTick -Scheduler $ticketScheduler
    Assert-True -Condition ($ticketSecond.Status -in @('PREPARING', 'RUNNING')) -Name 'same-ticket follow-up starts only after terminal predecessor'

    $modelScheduler = New-TestScheduler -Name 'model-caps' -MaxWorkers 3
    $solOne = Add-TestJob -Scheduler $modelScheduler -Text (New-TestTaskText -Ticket 201 -Risk high -Body 'Sol one.')
    $solTwo = Add-TestJob -Scheduler $modelScheduler -Text (New-TestTaskText -Ticket 202 -Risk architecture-sensitive -Body 'Sol two.')
    $lunaOne = Add-TestJob -Scheduler $modelScheduler -Text (New-TestTaskText -Ticket 203 -Risk low -Body 'Luna one.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $modelScheduler
    Assert-True -Condition ($solOne.Status -in @('PREPARING', 'RUNNING')) -Name 'first Sol job starts'
    Assert-Equal -Actual $solTwo.Status -Expected 'QUEUED' -Name 'Sol concurrency is capped at one'
    Assert-True -Condition ($lunaOne.Status -in @('PREPARING', 'RUNNING')) -Name 'free capacity does not reroute or block a Luna job'
    Assert-Equal -Actual $lunaOne.Route.ModelKey -Expected luna -Name 'worker capacity never changes the deterministic route'

    $astraBlocked = New-TestScheduler -Name 'astra-blocked'
    Assert-Throws -Name 'Astra remains guarded without the explicit allow flag' -Action { Add-TestJob -Scheduler $astraBlocked -Text (New-TestTaskText -Ticket 301 -Model astra -Body 'Guarded Astra.') }
    $astraAllowed = New-TestScheduler -Name 'astra-allowed' -MaxWorkers 3 -AllowAstra
    $astraOne = Add-TestJob -Scheduler $astraAllowed -Text (New-TestTaskText -Ticket 302 -Model astra -Body 'Astra one.')
    $astraTwo = Add-TestJob -Scheduler $astraAllowed -Text (New-TestTaskText -Ticket 303 -Model astra -Body 'Astra two.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $astraAllowed
    Assert-True -Condition ($astraOne.Status -in @('PREPARING', 'RUNNING')) -Name 'explicit allowed Astra job starts'
    Assert-Equal -Actual $astraTwo.Status -Expected QUEUED -Name 'Astra concurrency is capped at one'

    $integration = New-TestScheduler -Name 'integration-exclusive'
    $integrationJob = Add-TestJob -Scheduler $integration -Text (New-TestTaskText -Ticket 401 -Type integration -Risk high -Body 'Explicit integration task.')
    $normalAfter = Add-TestJob -Scheduler $integration -Text (New-TestTaskText -Ticket 402 -Risk low -Body 'Normal task after integration.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $integration
    Assert-True -Condition ($integrationJob.Status -in @('PREPARING', 'RUNNING')) -Name 'explicit integration job starts'
    Assert-Equal -Actual $normalAfter.Status -Expected QUEUED -Name 'integration job runs exclusively'

    $recoveryStarts = New-Object 'System.Collections.Generic.List[object]'
    $recoveryStarter = { param($Job, $Arguments, $Scheduler); $process = New-FakeProcess -Id 5001; $recoveryStarts.Add($process) | Out-Null; return $process }.GetNewClosure()
    $beforeCrash = New-TestScheduler -Name 'recovery' -Starter $recoveryStarter
    $staleJob = Add-TestJob -Scheduler $beforeCrash -Text (New-TestTaskText -Ticket 501 -Body 'Recoverable stale payload.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $beforeCrash
    $afterCrashStarts = New-Object 'System.Collections.Generic.List[object]'
    $afterCrashStarter = { param($Job, $Arguments, $Scheduler); $afterCrashStarts.Add($Job) | Out-Null; return New-FakeProcess -Id 5002 }.GetNewClosure()
    $afterCrash = New-TestScheduler -Name 'recovery' -Starter $afterCrashStarter
    $restoredStale = @($afterCrash.State.Jobs | Where-Object { $_.JobId -eq $staleJob.JobId })[0]
    Assert-Equal -Actual $restoredStale.Status -Expected BLOCKED -Name 'active job becomes stale/recoverable after host restart'
    Assert-True -Condition ([bool]$restoredStale.RecoveryRequired) -Name 'restart records explicit manual recovery requirement'
    $null = Invoke-WishlistSchedulerTick -Scheduler $afterCrash
    Assert-Equal -Actual $afterCrashStarts.Count -Expected 0 -Name 'stale job is never blindly executed twice'
    Assert-True -Condition (Test-Path -LiteralPath $restoredStale.PayloadPath -PathType Leaf) -Name 'recoverable stale job retains its payload'

    $stoppedProcesses = New-Object 'System.Collections.Generic.List[object]'
    $stopper = { param($Process, $Scheduler); $Process.Stopped = $true; $Process.HasExited = $true; $stoppedProcesses.Add($Process) | Out-Null }.GetNewClosure()
    $shutdown = New-TestScheduler -Name 'shutdown' -Stopper $stopper
    $shutdownActive = Add-TestJob -Scheduler $shutdown -Text (New-TestTaskText -Ticket 601 -Body 'Active at shutdown.')
    $shutdownQueued = Add-TestJob -Scheduler $shutdown -Text (New-TestTaskText -Ticket 601 -Body 'Queued at shutdown.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $shutdown
    Stop-WishlistScheduler -Scheduler $shutdown
    Assert-Equal -Actual $shutdownActive.Status -Expected CANCELLED -Name 'controlled shutdown marks active work cancelled'
    Assert-Equal -Actual $shutdownQueued.Status -Expected QUEUED -Name 'controlled shutdown retains queued work'
    Assert-Equal -Actual $stoppedProcesses.Count -Expected 1 -Name 'controlled shutdown terminates each active process tree through the seam'
    Assert-True -Condition (-not (Test-Path -LiteralPath $shutdownActive.PayloadPath)) -Name 'cancelled job payload is discarded'
    Assert-True -Condition (Test-Path -LiteralPath $shutdownQueued.PayloadPath -PathType Leaf) -Name 'queued job payload remains persistent'
    Assert-Equal -Actual $shutdown.State.ShutdownState -Expected STOPPED -Name 'shutdown state is persisted'
    $shutdownRestarted = New-TestScheduler -Name 'shutdown'
    $restoredQueued = @($shutdownRestarted.State.Jobs | Where-Object { $_.JobId -eq $shutdownQueued.JobId })[0]
    Assert-Equal -Actual $restoredQueued.Status -Expected QUEUED -Name 'queued job is restored after host restart'
    $null = Invoke-WishlistSchedulerTick -Scheduler $shutdownRestarted
    Assert-True -Condition ($restoredQueued.Status -in @('PREPARING', 'RUNNING')) -Name 'restored queued job is scheduled normally after restart'

    $dry = New-TestScheduler -Name 'dry-run' -DryRun
    $dryJob = Add-TestJob -Scheduler $dry -Text (New-TestTaskText -Ticket 701 -Body 'Dry run task.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $dry
    Assert-True -Condition ($dryJob.Status -in @('PREPARING', 'RUNNING')) -Name 'dry-run exercises scheduling without provider execution'
    Assert-Equal -Actual @($dry.State.Workers).Count -Expected 0 -Name 'dry-run creates no worker clone registry entry'

    $lunaOne.Status = 'RUNNING'
    $lunaOne.PiProcessId = $PID
    $dashboard = @(Format-WishlistSchedulerStatus -Scheduler $modelScheduler) -join "`n"
    Assert-True -Condition ($dashboard -like '*WISHLIST AGENT HOST*' -and $dashboard -like '*QUEUE*' -and $dashboard -like '*WORKERS*' -and $dashboard -like '*Capacity*') -Name 'deterministic status view exposes queue workers and capacity'
    Assert-True -Condition ($dashboard -like '*Pi alive*') -Name 'Pi alive is shown only for a live tracked process'
    Assert-True -Condition ($dashboard -notmatch ([char]27)) -Name 'status formatter emits no ANSI cursor bytes'
    $usageLines = @(Format-WishlistUsageLines -Usage ([pscustomobject]@{ InputTokens = 1209; CacheReadTokens = 189952; OutputTokens = 3223; ReasoningTokens = 2923; TotalTokens = 194384; Cost = 1.5 })) -join "`n"
    Assert-True -Condition ($usageLines -like '*Input*1,209*' -and $usageLines -like '*Cache Read*189,952*' -and $usageLines -like '*Total*194,384*') -Name 'human usage formatter uses readable labelled totals'

    $dashboardEmptyScheduler = New-TestScheduler -Name 'dashboard-empty'
    $dashboardEmpty = @(Format-WishlistSchedulerStatus -Scheduler $dashboardEmptyScheduler) -join "`n"
    Assert-True -Condition ($dashboardEmpty -like '*COMPLETED TASKS (latest 8)*' -and $dashboardEmpty -like '* (none)*') -Name 'dashboard renders an explicit empty completed-task history'

    $dashboardSingleScheduler = New-TestScheduler -Name 'dashboard-single'
    $dashboardSingleJob = Add-TestJob -Scheduler $dashboardSingleScheduler -Text (New-TestTaskText -Ticket 1701 -Body 'Dashboard card complete.')
    $dashboardUsage = [pscustomobject]@{ InputTokens = 10; CacheReadTokens = 20; CacheWriteTokens = 30; OutputTokens = 40; ReasoningTokens = 50; TotalTokens = 150; Cost = 0.15 }
    $null = Set-TestCompletedJob -Job $dashboardSingleJob -EndTimeUtc '2026-09-16T10:00:01.0000000Z' -Usage $dashboardUsage -Response 'Completed card response.'
    $dashboardSingle = @(Format-WishlistSchedulerStatus -Scheduler $dashboardSingleScheduler) -join "`n"
    Assert-True -Condition ($dashboardSingle -like '*#1701*' -and $dashboardSingle -like '*Model:*' -and $dashboardSingle -like '*Pi session:*' -and $dashboardSingle -like '*Branch:*' -and $dashboardSingle -like '*Completion: Completed: Completed card response.*' -and $dashboardSingle -like '*Report: POSTED*' -and $dashboardSingle -like '*Input=10*' -and $dashboardSingle -like '*Total=150*') -Name 'dashboard completed card shows identity completion report and usage'

    $dashboardHistoryScheduler = New-TestScheduler -Name 'dashboard-history'
    $dashboardOlder = Add-TestJob -Scheduler $dashboardHistoryScheduler -Text (New-TestTaskText -Ticket 1702 -Body 'Older completed card.')
    $dashboardNewer = Add-TestJob -Scheduler $dashboardHistoryScheduler -Text (New-TestTaskText -Ticket 1703 -Body 'Newer completed card.')
    $null = Set-TestCompletedJob -Job $dashboardOlder -EndTimeUtc '2026-09-16T10:00:02.0000000Z' -Response 'Older response.'
    $null = Set-TestCompletedJob -Job $dashboardNewer -EndTimeUtc '2026-09-16T10:00:03.0000000Z' -Response 'Newer response.'
    $dashboardHistory = @(Format-WishlistSchedulerStatus -Scheduler $dashboardHistoryScheduler) -join "`n"
    Assert-True -Condition ($dashboardHistory.IndexOf('#1703') -lt $dashboardHistory.IndexOf('#1702')) -Name 'dashboard completed history is newest-first'

    $dashboardBoundedScheduler = New-TestScheduler -Name 'dashboard-bounded'
    for ($index = 1; $index -le 10; $index++) {
        $boundedJob = Add-TestJob -Scheduler $dashboardBoundedScheduler -Text (New-TestTaskText -Ticket (1800 + $index) -Body "Bounded card $index.")
        $null = Set-TestCompletedJob -Job $boundedJob -EndTimeUtc ('2026-09-16T10:01:{0:00}.0000000Z' -f $index) -Response "Bounded response $index."
    }
    $dashboardBoundedLines = @(Format-WishlistSchedulerStatus -Scheduler $dashboardBoundedScheduler)
    $dashboardCardHeaders = @($dashboardBoundedLines | Where-Object { $_ -match '^ \| #\d+ / job-' })
    Assert-Equal -Actual $dashboardCardHeaders.Count -Expected 8 -Name 'dashboard bounds visible completed history to eight cards'
    Assert-True -Condition (($dashboardBoundedLines -join "`n") -like '*#1810*' -and ($dashboardBoundedLines -join "`n") -notlike '*#1801*') -Name 'dashboard bounded history keeps newest cards and hides older cards'

    $dashboardMixedScheduler = New-TestScheduler -Name 'dashboard-mixed'
    $dashboardFailed = Add-TestJob -Scheduler $dashboardMixedScheduler -Text (New-TestTaskText -Ticket 1901 -Body 'Failed dashboard card.')
    $dashboardBlocked = Add-TestJob -Scheduler $dashboardMixedScheduler -Text (New-TestTaskText -Ticket 1902 -Body 'Blocked dashboard card.')
    $dashboardCancelled = Add-TestJob -Scheduler $dashboardMixedScheduler -Text (New-TestTaskText -Ticket 1903 -Body 'Cancelled dashboard card.')
    $null = Set-TestCompletedJob -Job $dashboardFailed -Status FAILED -EndTimeUtc '2026-09-16T10:02:01.0000000Z' -ReportStatus 'WARNING' -FailureReason 'Pi protocol incomplete.'
    $null = Set-TestCompletedJob -Job $dashboardBlocked -Status BLOCKED -EndTimeUtc '2026-09-16T10:02:02.0000000Z' -ReportStatus 'LOCAL' -FailureReason 'Manual recovery required.'
    $null = Set-TestCompletedJob -Job $dashboardCancelled -Status CANCELLED -EndTimeUtc '2026-09-16T10:02:03.0000000Z' -ReportStatus ''
    $dashboardMixed = @(Format-WishlistSchedulerStatus -Scheduler $dashboardMixedScheduler) -join "`n"
    Assert-True -Condition ($dashboardMixed -like '*FAILED*' -and $dashboardMixed -like '*BLOCKED*' -and $dashboardMixed -like '*CANCELLED*' -and $dashboardMixed -like '*WARNING / local fallback*' -and $dashboardMixed -like '*Failure: Pi protocol incomplete.*') -Name 'dashboard explains failed blocked cancelled and report-warning cards'
    Assert-True -Condition ($dashboardMixed -like '*Report: local fallback*' -and $dashboardMixed -like '*Usage: not reported*') -Name 'dashboard shows local fallback and missing usage without raw output'

    $dashboardActiveJob = Add-TestJob -Scheduler $dashboardMixedScheduler -Text (New-TestTaskText -Ticket 1904 -Body 'Active beside completed cards.')
    $dashboardActiveJob.Status = 'RUNNING'
    $dashboardActiveJob.WorkerSlot = 0
    $dashboardActiveJob.StartTimeUtc = '2026-09-16T10:02:04.0000000Z'
    $dashboardActive = @(Format-WishlistSchedulerStatus -Scheduler $dashboardMixedScheduler) -join "`n"
    Assert-True -Condition ($dashboardActive -like '*#1904*' -and $dashboardActive -like '*Capacity 1/2*' -and $dashboardActive -like '*#1903*') -Name 'dashboard keeps active workers visible alongside completed history'

    $dashboardRepeatOne = @(Format-WishlistSchedulerStatus -Scheduler $dashboardMixedScheduler -StatusMessage 'COMPLETE: stable') -join "`n"
    $dashboardRepeatTwo = @(Format-WishlistSchedulerStatus -Scheduler $dashboardMixedScheduler -StatusMessage 'COMPLETE: stable') -join "`n"
    Assert-Equal -Actual $dashboardRepeatTwo -Expected $dashboardRepeatOne -Name 'repeated dashboard formatting is byte-stable and does not append content'

    $consoleSurface = New-TestConsoleSurface -Width 80 -Height 25
    $consoleRenderer = New-WishlistConsoleRenderer -Surface $consoleSurface
    $frameA = @('WISHLIST AGENT HOST', 'QUEUE (empty)', 'WORKERS (idle)')
    Write-TestConsoleFrame -Renderer $consoleRenderer -Surface $consoleSurface -Lines $frameA
    Write-TestConsoleFrame -Renderer $consoleRenderer -Surface $consoleSurface -Lines $frameA
    $repeatSurface = Get-TestConsoleText -Surface $consoleSurface
    $repeatPayload = $consoleSurface.State.Writes[$consoleSurface.State.Writes.Count - 1]
    Assert-True -Condition (([regex]::Matches($repeatSurface, 'WISHLIST AGENT HOST')).Count -eq 1 -and $repeatSurface -like '*QUEUE (empty)*' -and $repeatSurface -like '*WORKERS (idle)*') -Name 'interactive renderer keeps one visible dashboard after identical refreshes'
    Assert-True -Condition ($repeatPayload.Contains(([char]27).ToString() + '[3A') -and -not $repeatPayload.Contains(([char]27).ToString() + '[H')) -Name 'interactive refresh moves relative to frame end instead of stale absolute buffer coordinates'

    foreach ($frame in @(
        @('WISHLIST AGENT HOST', 'QUEUE #106 QUEUED', 'WORKERS (idle)'),
        @('WISHLIST AGENT HOST', 'QUEUE #106 RUNNING', 'WORKERS #106 RUNNING'),
        @('WISHLIST AGENT HOST', 'QUEUE (empty)', 'COMPLETED #106', 'REPORT POSTED'),
        @('WISHLIST AGENT HOST', 'QUEUE (empty)', 'WORKERS (idle)')
    )) {
        Write-TestConsoleFrame -Renderer $consoleRenderer -Surface $consoleSurface -Lines $frame
    }
    $lifecycleSurface = Get-TestConsoleText -Surface $consoleSurface
    Assert-True -Condition (([regex]::Matches($lifecycleSurface, 'WISHLIST AGENT HOST')).Count -eq 1 -and $lifecycleSurface -like '*QUEUE (empty)*' -and $lifecycleSurface -like '*WORKERS (idle)*' -and $lifecycleSurface -notlike '*RUNNING*' -and $lifecycleSurface -notlike '*REPORT POSTED*') -Name 'interactive lifecycle refreshes replace queued running complete and idle frames without append history'

    $longFrame = @('WISHLIST AGENT HOST', 'line two', 'line three', 'stale four', 'stale five')
    $shortFrame = @('WISHLIST AGENT HOST', 'current short')
    Write-TestConsoleFrame -Renderer $consoleRenderer -Surface $consoleSurface -Lines $longFrame
    Write-TestConsoleFrame -Renderer $consoleRenderer -Surface $consoleSurface -Lines $shortFrame
    $shortSurface = Get-TestConsoleText -Surface $consoleSurface
    $shortPayload = $consoleSurface.State.Writes[$consoleSurface.State.Writes.Count - 1]
    Assert-True -Condition ($shortSurface -like '*current short*' -and $shortSurface -notlike '*stale four*' -and $shortSurface -notlike '*stale five*' -and $consoleRenderer.PreviousFrameHeight -eq 2) -Name 'shorter interactive frame explicitly clears stale rows and shrinks tracked height'
    Assert-True -Condition (([regex]::Matches($shortPayload, ([regex]::Escape(([char]27).ToString() + '[2K')))).Count -eq 5) -Name 'shorter interactive frame clears every row occupied by the previous frame'

    Write-TestConsoleFrame -Renderer $consoleRenderer -Surface $consoleSurface -Lines @('WISHLIST AGENT HOST', 'STATUS REPORT WARNING')
    Write-TestConsoleFrame -Renderer $consoleRenderer -Surface $consoleSurface -Lines @('WISHLIST AGENT HOST', 'STATUS REPORT POSTED')
    $reportSurface = Get-TestConsoleText -Surface $consoleSurface
    Assert-True -Condition ($reportSurface -like '*REPORT POSTED*' -and $reportSurface -notlike '*REPORT WARNING*') -Name 'interactive status and report changes replace the previous status row'

    $consoleSurface.State.Width = 32
    $consoleSurface.State.Height = 6
    Write-TestConsoleFrame -Renderer $consoleRenderer -Surface $consoleSurface -Lines @('WISHLIST AGENT HOST WITH A VERY LONG TITLE', 'one', 'two', 'three', 'four', 'five', 'six', 'closing')
    $resizePayload = $consoleSurface.State.Writes[$consoleSurface.State.Writes.Count - 1]
    $resizeSurface = Get-TestConsoleText -Surface $consoleSurface
    $resizeLinesFit = @($consoleRenderer.VisibleLines | Where-Object { $_.Length -gt 32 }).Count -eq 0
    Assert-True -Condition ($resizePayload.Contains(([char]27).ToString() + '[2J' + ([char]27).ToString() + '[H') -and $consoleRenderer.VisibleLines.Count -le 6 -and $resizeLinesFit -and ([regex]::Matches($resizeSurface, 'WISHLIST AGENT HOST')).Count -eq 1) -Name 'interactive renderer resets safely and bounds the frame after terminal resize'

    $redirectedSurface = New-TestConsoleSurface -Interactive $false
    $redirectedRenderer = New-WishlistConsoleRenderer -Surface $redirectedSurface
    $redirectedResult = Write-WishlistConsoleFrame -Renderer $redirectedRenderer -Lines @('WISHLIST AGENT HOST')
    Assert-True -Condition (-not $redirectedResult -and $redirectedSurface.State.Writes.Count -eq 0) -Name 'redirected renderer emits no cursor or dashboard output'

    $hostDashboardText = Get-Content -LiteralPath (Join-Path $handoffRoot 'Start-WishlistAgentHost.ps1') -Raw
    $consoleRendererText = Get-Content -LiteralPath (Join-Path $handoffRoot 'WishlistConsoleRenderer.psm1') -Raw
    $hostDashboardTokens = $null
    $hostDashboardParseErrors = $null
    $hostDashboardAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $handoffRoot 'Start-WishlistAgentHost.ps1'), [ref]$hostDashboardTokens, [ref]$hostDashboardParseErrors)
    $hostLineFunction = $hostDashboardAst.Find({ param($node) return ($node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Write-WishlistHostLine') }, $true)
    $hostLineText = if ($null -eq $hostLineFunction) { '' } else { $hostLineFunction.Extent.Text }
    Assert-True -Condition ($hostDashboardText -like '*WishlistConsoleRenderer.psm1*' -and $hostDashboardText -like '*dashboardStatusMessage*' -and $hostDashboardText -notlike '*SetCursorPosition*' -and $consoleRendererText -like '*Console]::IsOutputRedirected*' -and $consoleRendererText -like '*SetConsoleMode*') -Name 'host separates capability-checked VT rendering from redirected status output'
    Assert-True -Condition ($hostLineText -notlike '*Clear-WishlistDashboard*' -and $hostLineText -like '*interactiveOutput*') -Name 'host status events no longer clear and relocate the dashboard on every refresh'

    $taskFile = Join-Path $script:DisposableRoot 'task-file-input.task'
    $fileText = New-TestTaskText -Ticket 801 -Body 'Exact file input payload.'
    [System.IO.File]::WriteAllText($taskFile, $fileText, (New-Object System.Text.UTF8Encoding($false)))
    $handoffScript = Join-Path $handoffRoot 'Invoke-WishlistTask.ps1'
    $fileOutput = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $handoffScript -TaskFile $taskFile -RepoPath $agentRoot -Json -NoProcessExit)
    $fileJson = ($fileOutput -join "`n") | ConvertFrom-Json -ErrorAction Stop
    Assert-Equal -Actual $fileJson.Source -Expected FILE -Name 'handoff accepts a safe task file transport'
    Assert-Equal -Actual $fileJson.Task.Body -Expected 'Exact file input payload.' -Name 'file transport forwards the exact persisted snapshot'
    $dependencyTask = New-TestTaskText -Ticket 802 -DependsOn '700, 701,700' -IncludeDependsOn -Body 'Structured dependency dry-run.'
    $dependencyHandoffOutput = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $handoffScript -Text $dependencyTask -RepoPath $agentRoot -Json -NoProcessExit)
    $dependencyHandoffJson = ($dependencyHandoffOutput -join "`n") | ConvertFrom-Json -ErrorAction Stop
    Assert-Equal -Actual $dependencyHandoffJson.Status -Expected PASS -Name 'dependency task dry-run does not call a provider'
    Assert-Equal -Actual (@($dependencyHandoffJson.Task.Dependencies) -join ',') -Expected '700,701' -Name 'handoff JSON exposes normalized dependencies structurally'

    $seed = Join-Path $script:DisposableRoot 'clone-seed'
    New-Item -ItemType Directory -Force -Path $seed | Out-Null
    $null = Invoke-TestGit -RepoPath $seed -Arguments @('init')
    $null = Invoke-TestGit -RepoPath $seed -Arguments @('config', 'user.email', 'scheduler@example.invalid')
    $null = Invoke-TestGit -RepoPath $seed -Arguments @('config', 'user.name', 'Scheduler Test')
    Set-Content -LiteralPath (Join-Path $seed 'README.md') -Value 'worker base' -Encoding UTF8
    $null = Invoke-TestGit -RepoPath $seed -Arguments @('add', 'README.md')
    $null = Invoke-TestGit -RepoPath $seed -Arguments @('commit', '-m', 'worker base')
    $null = Invoke-TestGit -RepoPath $seed -Arguments @('branch', '-M', 'dev')
    $seedHead = Invoke-TestGit -RepoPath $seed -Arguments @('rev-parse', 'HEAD')
    $seedStatus = Invoke-TestGit -RepoPath $seed -Arguments @('status', '--short')
    $remote = Join-Path $script:DisposableRoot 'clone-remote.git'
    $cloneBareOutput = @(& git clone --quiet --bare -- $seed $remote 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "bare clone failed: $($cloneBareOutput -join ' ')" }
    $workerRoot = Join-Path $script:DisposableRoot 'real-workers'
    $workerTask = Join-Path $script:DisposableRoot 'real-worker.task'
    [System.IO.File]::WriteAllText($workerTask, (New-TestTaskText -Ticket 901 -Body 'Hermetic clone worker.'), (New-Object System.Text.UTF8Encoding($false)))
    $workerResult = Join-Path $script:DisposableRoot 'real-worker-result.json'
    $workerLifecycle = Join-Path $script:DisposableRoot 'real-worker-lifecycle.json'
    $workerScript = Join-Path $handoffRoot 'Start-WishlistWorker.ps1'
    $fixtureHandoff = Join-Path $fixtureRoot 'fake-scheduler-handoff.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $workerScript -JobId job-hermetic-001 -TaskFile $workerTask -ResultPath $workerResult -LifecyclePath $workerLifecycle -WorkerRoot $workerRoot -RepoUrl $remote -BranchName feature/hermetic-worker -HandoffScriptPath $fixtureHandoff -SourceRepoPath $seed
    $workerExit = $LASTEXITCODE
    $realResult = Get-Content -LiteralPath $workerResult -Raw | ConvertFrom-Json
    if ($workerExit -ne 0) { Write-Output "WORKER DETAIL: $($realResult.Handoff.Reason)" }
    Assert-Equal -Actual $workerExit -Expected 0 -Name 'hermetic worker clone lifecycle exits successfully'
    Assert-Equal -Actual $realResult.Status -Expected COMPLETE -Name 'reporting warning remains secondary to successful implementation'
    $workerReportStatus = if ($null -ne $realResult.Handoff.PSObject.Properties['Report'] -and $null -ne $realResult.Handoff.Report) { [string]$realResult.Handoff.Report.Status } else { '' }
    Assert-Equal -Actual $workerReportStatus -Expected WARNING -Name 'worker preserves secondary reporting status'
    Assert-True -Condition (Test-Path -LiteralPath (Join-Path $realResult.Workspace '.git') -PathType Container) -Name 'worker isolation uses a normal Git clone, not a worktree'
    Assert-Equal -Actual (Invoke-TestGit -RepoPath $realResult.Workspace -Arguments @('branch', '--show-current')) -Expected feature/hermetic-worker -Name 'worker clone uses its own feature branch'
    Assert-Equal -Actual (Invoke-TestGit -RepoPath $realResult.Workspace -Arguments @('config', '--get', 'core.longpaths')) -Expected true -Name 'worker clone enables Git long-path support'
    Assert-Equal -Actual (Invoke-TestGit -RepoPath $realResult.Workspace -Arguments @('rev-parse', 'HEAD')) -Expected $seedHead -Name 'new worker starts from current remote dev'
    Assert-True -Condition (Test-Path -LiteralPath $realResult.Workspace -PathType Container) -Name 'successful worker clone is retained for review'
    Assert-Equal -Actual (Invoke-TestGit -RepoPath $seed -Arguments @('rev-parse', 'HEAD')) -Expected $seedHead -Name 'source clone HEAD remains unchanged'
    Assert-Equal -Actual (Invoke-TestGit -RepoPath $seed -Arguments @('status', '--short')) -Expected $seedStatus -Name 'source clone working tree remains unchanged'
    $workerPayloadText = New-TestTaskText -Ticket 901 -Body 'Hermetic clone worker.'
    Assert-Equal -Actual $realResult.Handoff.Launch.Response -Expected ("PAYLOAD_SHA256:" + (Get-TestTextSha256 -Text $workerPayloadText)) -Name 'worker response proves it received the saved snapshot rather than global clipboard state'
    Assert-True -Condition ((Get-Content -LiteralPath $workerResult -Raw) -notlike '*Hermetic clone worker.*') -Name 'terminal worker result does not retain the task body'

    $incompleteTask = Join-Path $script:DisposableRoot 'incomplete-worker.task'
    $incompleteTaskText = New-TestTaskText -Ticket 904 -Body 'Retain workspace after an unverified Pi completion.'
    [System.IO.File]::WriteAllText($incompleteTask, $incompleteTaskText, (New-Object System.Text.UTF8Encoding($false)))
    $incompleteResultPath = Join-Path $script:DisposableRoot 'incomplete-worker-result.json'
    $incompleteLifecyclePath = Join-Path $script:DisposableRoot 'incomplete-worker-lifecycle.json'
    $incompleteWorkerRoot = Join-Path $script:DisposableRoot 'incomplete-workers'
    $incompleteHandoff = Join-Path $fixtureRoot 'fake-scheduler-handoff-incomplete.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $workerScript `
        -JobId job-incomplete-terminal-001 `
        -TaskFile $incompleteTask `
        -ResultPath $incompleteResultPath `
        -LifecyclePath $incompleteLifecyclePath `
        -WorkerRoot $incompleteWorkerRoot `
        -RepoUrl $remote `
        -BranchName feature/incomplete-terminal `
        -HandoffScriptPath $incompleteHandoff `
        -SourceRepoPath $seed
    $incompleteWorkerExit = $LASTEXITCODE
    $incompleteResult = Get-Content -LiteralPath $incompleteResultPath -Raw | ConvertFrom-Json
    Assert-Equal -Actual $incompleteWorkerExit -Expected 1 -Name 'unverified terminal completion exits the worker as a failure'
    Assert-Equal -Actual $incompleteResult.Status -Expected FAILED -Name 'unverified terminal completion never becomes worker COMPLETE'
    Assert-Equal -Actual $incompleteResult.Handoff.Status -Expected FAIL -Name 'worker preserves the non-success handoff status'
    Assert-Equal -Actual $incompleteResult.Handoff.Launch.PiStatus -Expected PI_PROTOCOL_INCOMPLETE -Name 'worker preserves protocol-incomplete diagnostics'
    Assert-Equal -Actual $incompleteResult.Handoff.Launch.TerminalCompletionEvidence -Expected $false -Name 'worker result records missing terminal completion evidence'
    Assert-True -Condition (Test-Path -LiteralPath $incompleteResult.Workspace -PathType Container) -Name 'failed suspicious worker workspace remains available for recovery'
    Assert-Equal -Actual (Invoke-TestGit -RepoPath $incompleteResult.Workspace -Arguments @('branch', '--show-current')) -Expected feature/incomplete-terminal -Name 'failed suspicious worker keeps its isolated feature branch'
    Assert-True -Condition ((Get-Content -LiteralPath $incompleteResultPath -Raw) -notlike '*Retain workspace after an unverified Pi completion.*') -Name 'failed worker result does not persist the task body'

    $lifecycleConfig = Get-Content -LiteralPath (Join-Path $handoffRoot 'routing.json') -Raw | ConvertFrom-Json
    $lifecycleConfig.launcher.command = (Join-Path $fixtureRoot 'fake-pi-lifecycle.cmd')
    $lifecycleRouting = Join-Path $script:DisposableRoot 'lifecycle-routing.json'
    [System.IO.File]::WriteAllText($lifecycleRouting, ($lifecycleConfig | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
    $lifecycleTask = Join-Path $script:DisposableRoot 'lifecycle-worker.task'
    $lifecycleTaskText = New-TestTaskText -Ticket 903 -Body 'Observe the live Pi lifecycle.'
    [System.IO.File]::WriteAllText($lifecycleTask, $lifecycleTaskText, (New-Object System.Text.UTF8Encoding($false)))
    $lifecycleResultPath = Join-Path $script:DisposableRoot 'lifecycle-worker-result.json'
    $lifecyclePath = Join-Path $script:DisposableRoot 'lifecycle-worker.json'
    $lifecycleStdout = Join-Path $script:DisposableRoot 'lifecycle-worker.stdout'
    $lifecycleStderr = Join-Path $script:DisposableRoot 'lifecycle-worker.stderr'
    $lifecycleWorkerRoot = Join-Path $script:DisposableRoot 'lifecycle-workers'
    $lifecycleReportRoot = Join-Path $script:DisposableRoot 'lifecycle-reports'
    $lifecycleArguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $workerScript,
        '-JobId', 'job-lifecycle-pid-001',
        '-TaskFile', $lifecycleTask,
        '-ResultPath', $lifecycleResultPath,
        '-LifecyclePath', $lifecyclePath,
        '-WorkerRoot', $lifecycleWorkerRoot,
        '-RepoUrl', $remote,
        '-BranchName', 'feature/lifecycle-pid',
        '-HandoffScriptPath', $handoffScript,
        '-SourceRepoPath', $seed,
        '-RoutingConfigPath', $lifecycleRouting,
        '-ReportDirectory', $lifecycleReportRoot
    )
    $lifecycleProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $lifecycleArguments -RedirectStandardOutput $lifecycleStdout -RedirectStandardError $lifecycleStderr -PassThru
    $observedPiPid = $null
    $observedPiAlive = $false
    $lifecycleDeadline = (Get-Date).AddSeconds(20)
    try {
        while (-not $lifecycleProcess.HasExited -and (Get-Date) -lt $lifecycleDeadline) {
            if (Test-Path -LiteralPath $lifecyclePath -PathType Leaf) {
                try {
                    $lifecycleRecord = Get-Content -LiteralPath $lifecyclePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
                    $candidatePiPid = $lifecycleRecord.PiProcessId
                    if ($null -ne $candidatePiPid -and [string]$candidatePiPid -match '^\d+$') {
                        $observedPiPid = [int]$candidatePiPid
                        if ($null -ne (Get-Process -Id $observedPiPid -ErrorAction SilentlyContinue)) {
                            $observedPiAlive = $true
                        }
                    }
                } catch { }
            }
            Start-Sleep -Milliseconds 50
            $lifecycleProcess.Refresh()
        }
    } finally {
        if (-not $lifecycleProcess.HasExited) {
            try { $lifecycleProcess.Kill() } catch { }
        }
        try { $lifecycleProcess.WaitForExit() } catch { }
    }
    $lifecycleResult = Get-Content -LiteralPath $lifecycleResultPath -Raw | ConvertFrom-Json
    Assert-True -Condition $lifecycleProcess.HasExited -Name 'worker-boundary lifecycle probe exits successfully'
    Assert-Equal -Actual $lifecycleResult.Status -Expected COMPLETE -Name 'worker-boundary lifecycle probe completes'
    Assert-True -Condition ($null -ne $observedPiPid) -Name 'worker-boundary handoff publishes the Pi PID'
    Assert-True -Condition $observedPiAlive -Name 'worker-boundary Pi PID is live when observed'

    $asyncScheduler = New-WishlistScheduler `
        -StateRoot (Join-Path $script:DisposableRoot 'async-e2e') `
        -SourceRepoPath $seed `
        -RepoUrl $remote `
        -HandoffScriptPath $fixtureHandoff `
        -WorkerScriptPath $workerScript `
        -MaxWorkers 1
    $asyncJob = Add-TestJob -Scheduler $asyncScheduler -Text (New-TestTaskText -Ticket 902 -Body 'Asynchronous process-boundary worker.')
    $null = Invoke-WishlistSchedulerTick -Scheduler $asyncScheduler
    $asyncDeadline = (Get-Date).AddSeconds(20)
    while ($asyncJob.Status -notin @('COMPLETE', 'FAILED', 'BLOCKED', 'CANCELLED') -and (Get-Date) -lt $asyncDeadline) {
        Start-Sleep -Milliseconds 50
        $null = Invoke-WishlistSchedulerTick -Scheduler $asyncScheduler
    }
    Assert-Equal -Actual $asyncJob.Status -Expected COMPLETE -Name 'scheduler observes a real asynchronous worker process to completion'
    $asyncPayloadText = New-TestTaskText -Ticket 902 -Body 'Asynchronous process-boundary worker.'
    Assert-Equal -Actual $asyncJob.TerminalResult.Launch.Response -Expected ("PAYLOAD_SHA256:" + (Get-TestTextSha256 -Text $asyncPayloadText)) -Name 'asynchronous worker result is assigned to the originating job'
    Assert-True -Condition ((Get-Content -LiteralPath $asyncScheduler.StatePath -Raw) -notlike '*Asynchronous process-boundary worker.*') -Name 'terminal scheduler state does not retain the task body'
    Assert-True -Condition (Test-Path -LiteralPath $asyncJob.Workspace -PathType Container) -Name 'scheduler retains the asynchronous worker clone after completion'
    Assert-Equal -Actual @($asyncScheduler.State.Workers).Count -Expected 1 -Name 'asynchronous worker clone remains registered as scheduler-owned'

    Write-Output "TOTAL: $script:Total"
    Write-Output "PASSED: $script:Passed"
    Write-Output "FAILED: $script:Failed"
    if ($script:Failed -gt 0) {
        foreach ($failure in $script:Failures) { Write-Output "FAILED TEST: $failure" }
        exit 1
    }
    exit 0
} finally {
    $tempRoot = [System.IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    $resolvedDisposable = [System.IO.Path]::GetFullPath($script:DisposableRoot)
    if ($resolvedDisposable.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedDisposable) -like 'wishlist-scheduler-tests-*') {
        Remove-Item -LiteralPath $resolvedDisposable -Recurse -Force -ErrorAction SilentlyContinue
    }
}
