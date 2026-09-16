Set-StrictMode -Version 2.0

Import-Module (Join-Path $PSScriptRoot 'TaskParser.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $PSScriptRoot 'TaskRouter.psm1') -Force

$script:SchedulerSchemaVersion = 1
$script:ActiveStatuses = @('PREPARING', 'RUNNING', 'REPORTING')
$script:TerminalStatuses = @('COMPLETE', 'FAILED', 'BLOCKED', 'CANCELLED')
$script:DependencyWaitingStatus = 'WAITING_DEPENDENCY'
$script:CompletedHistoryLimit = 8
$script:ModelCaps = @{
    luna = 2
    sol = 1
    astra = 1
}

function Get-WishlistSchedulerProperty {
    param(
        [AllowNull()][object]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-WishlistAgentHostStateRoot {
    [CmdletBinding()]
    param([AllowEmptyString()][string]$StateRoot = '')

    if (-not [string]::IsNullOrWhiteSpace($StateRoot)) {
        return [System.IO.Path]::GetFullPath($StateRoot)
    }
    $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        throw 'LOCALAPPDATA is unavailable; scheduler state cannot be stored safely.'
    }
    return Join-Path $localAppData 'Wishlist\AgentHost'
}

function Write-WishlistSchedulerJsonAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Value,
        [int]$Depth = 20
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $directory = Split-Path -Parent $fullPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $directory -ErrorAction Stop | Out-Null
    }
    $temporaryPath = $fullPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    try {
        [System.IO.File]::WriteAllText($temporaryPath, ($Value | ConvertTo-Json -Depth $Depth), $utf8WithoutBom)
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

function New-WishlistSchedulerState {
    return [pscustomobject]@{
        SchemaVersion = $script:SchedulerSchemaVersion
        UpdatedUtc = (Get-Date).ToUniversalTime().ToString('o')
        ShutdownState = 'RUNNING'
        NextSequence = 1
        Jobs = @()
        Workers = @()
    }
}

function Save-WishlistSchedulerState {
    param([Parameter(Mandatory = $true)][object]$Scheduler)

    $Scheduler.State.UpdatedUtc = (Get-Date).ToUniversalTime().ToString('o')
    Write-WishlistSchedulerJsonAtomic -Path $Scheduler.StatePath -Value $Scheduler.State
}

function Add-WishlistSchedulerEvent {
    param(
        [Parameter(Mandatory = $true)][object]$Scheduler,
        [Parameter(Mandatory = $true)][string]$Type,
        [AllowNull()][object]$Job,
        [Parameter(Mandatory = $true)][string]$Message
    )

    $Scheduler.Events.Add([pscustomobject]@{
        TimestampUtc = (Get-Date).ToUniversalTime().ToString('o')
        Type = $Type
        JobId = if ($null -eq $Job) { '' } else { [string]$Job.JobId }
        Message = $Message
    }) | Out-Null
}

function Get-WishlistSchedulerEngine {
    $engine = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($null -eq $engine) { $engine = Get-Command pwsh -ErrorAction SilentlyContinue }
    if ($null -eq $engine) { throw 'No PowerShell engine was found for scheduler workers.' }
    return [string]$engine.Source
}

function Get-WishlistSchedulerOriginUrl {
    param([Parameter(Mandatory = $true)][string]$RepoPath)

    $output = @(& git -C $RepoPath remote get-url origin 2>&1)
    if ($LASTEXITCODE -ne 0 -or $output.Count -eq 0) {
        throw "Unable to resolve the origin remote for '$RepoPath'."
    }
    return ([string]$output[0]).Trim()
}

function Get-WishlistTicketLockKey {
    param([AllowNull()][string]$Ticket)

    if ([string]::IsNullOrWhiteSpace($Ticket) -or $Ticket.Trim() -notmatch '^\d+$') {
        return ''
    }
    $normalized = $Ticket.Trim().TrimStart('0')
    if ($normalized.Length -eq 0) { return '0' }
    return $normalized
}

function Get-WishlistSchedulerDependencyList {
    param([AllowNull()][object]$Task)

    $rawDependencies = Get-WishlistSchedulerProperty -Object $Task -Name 'Dependencies'
    if ($null -eq $rawDependencies) { return @() }

    $dependencies = New-Object 'System.Collections.Generic.List[object]'
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($rawDependency in @($rawDependencies)) {
        $parts = if ($rawDependency -is [string] -and $rawDependency.Contains(',')) { $rawDependency.Split(',') } else { @($rawDependency) }
        foreach ($part in @($parts)) {
            $text = ([string]$part).Trim()
            if ($text -notmatch '^\d+$') { continue }
            try { $number = [int64]::Parse($text, [Globalization.CultureInfo]::InvariantCulture) } catch { continue }
            if ($number -le 0) { continue }
            $key = $number.ToString([Globalization.CultureInfo]::InvariantCulture)
            if ($seen.Add($key)) { $dependencies.Add($number) | Out-Null }
        }
    }
    return [int64[]]$dependencies.ToArray()
}

function Set-WishlistSchedulerNoteProperty {
    param(
        [Parameter(Mandatory = $true)][object]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][object]$Value
    )

    if ($null -eq $Object.PSObject.Properties[$Name]) {
        $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value | Out-Null
    } else {
        $Object.$Name = $Value
    }
}

function Ensure-WishlistSchedulerJobShape {
    param([Parameter(Mandatory = $true)][object]$Job)

    $task = Get-WishlistSchedulerProperty -Object $Job -Name 'Task'
    if ($null -ne $task) {
        $dependencies = @(Get-WishlistSchedulerDependencyList -Task $task)
        $dependencyArray = [int64[]]@()
        if ($dependencies.Count -gt 0) { $dependencyArray = [int64[]]$dependencies }
        Set-WishlistSchedulerNoteProperty -Object $task -Name 'Dependencies' -Value $dependencyArray
    }
    if ($null -eq $Job.PSObject.Properties['DependencyReason']) { $Job | Add-Member -MemberType NoteProperty -Name DependencyReason -Value '' | Out-Null }
    if ($null -eq $Job.PSObject.Properties['DependencyMessage']) { $Job | Add-Member -MemberType NoteProperty -Name DependencyMessage -Value '' | Out-Null }
    if ($null -eq $Job.PSObject.Properties['DependencyDetails'] -or $null -eq $Job.DependencyDetails) {
        Set-WishlistSchedulerNoteProperty -Object $Job -Name 'DependencyDetails' -Value @()
    }
    if ($null -eq $Job.PSObject.Properties['TicketLockKey']) {
        $ticket = [string](Get-WishlistSchedulerProperty -Object $task -Name 'Ticket')
        $Job | Add-Member -MemberType NoteProperty -Name TicketLockKey -Value (Get-WishlistTicketLockKey -Ticket $ticket) | Out-Null
    }
}

function Get-WishlistSchedulerDependencyEvaluation {
    param(
        [Parameter(Mandatory = $true)][object]$Scheduler,
        [Parameter(Mandatory = $true)][object]$Job
    )

    $details = New-Object 'System.Collections.Generic.List[object]'
    foreach ($dependency in @(Get-WishlistSchedulerDependencyList -Task $Job.Task)) {
        $dependencyKey = ([int64]$dependency).ToString([Globalization.CultureInfo]::InvariantCulture)
        $dependencyJobs = @($Scheduler.State.Jobs | Where-Object {
            $candidateTicket = [string](Get-WishlistSchedulerProperty -Object $_.Task -Name 'Ticket')
            (Get-WishlistTicketLockKey -Ticket $candidateTicket) -eq $dependencyKey
        })

        if ($dependencyJobs.Count -eq 0) {
            $details.Add([pscustomobject]@{ Ticket = [int64]$dependency; Status = 'MISSING'; Reason = 'DEPENDENCY_MISSING'; JobId = '' }) | Out-Null
            continue
        }

        $hasComplete = @($dependencyJobs | Where-Object { [string]$_.Status -eq 'COMPLETE' }).Count -gt 0
        if ($hasComplete) {
            $details.Add([pscustomobject]@{ Ticket = [int64]$dependency; Status = 'COMPLETE'; Reason = ''; JobId = '' }) | Out-Null
            continue
        }

        $latest = @($dependencyJobs | Sort-Object Sequence -Descending | Select-Object -First 1)[0]
        $dependencyStatus = [string]$latest.Status
        $reason = switch ($dependencyStatus) {
            'FAILED' { 'DEPENDENCY_FAILED'; break }
            'CANCELLED' { 'DEPENDENCY_CANCELLED'; break }
            'BLOCKED' { 'DEPENDENCY_BLOCKED'; break }
            default { 'DEPENDENCY_PENDING' }
        }
        $details.Add([pscustomobject]@{
            Ticket = [int64]$dependency
            Status = if ($dependencyStatus -in $script:TerminalStatuses) { $dependencyStatus } else { $dependencyStatus }
            Reason = $reason
            JobId = [string]$latest.JobId
        }) | Out-Null
    }

    $pendingDetails = @($details | Where-Object { [string]$_.Status -ne 'COMPLETE' })
    $reason = if ($pendingDetails.Count -eq 0) { '' } else { [string]$pendingDetails[0].Reason }
    $message = ''
    if ($pendingDetails.Count -gt 0) {
        $summary = @($pendingDetails | ForEach-Object {
            if ([string]$_.Status -eq 'MISSING') { 'missing #' + [string]$_.Ticket } else { '#' + [string]$_.Ticket + ' ' + [string]$_.Status }
        }) -join ', '
        $message = $reason + ': ' + $summary
    }
    return [pscustomobject]@{
        Ready = ($pendingDetails.Count -eq 0)
        Reason = $reason
        Message = $message
        Details = $details.ToArray()
    }
}

function Find-WishlistDependencyCycle {
    param(
        [Parameter(Mandatory = $true)][hashtable]$Graph,
        [Parameter(Mandatory = $true)][string]$Node,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.HashSet[string]]$Visited,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.HashSet[string]]$Visiting,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.ArrayList]$Stack,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.HashSet[string]]$CycleNodes
    )

    if ($Visiting.Contains($Node)) {
        $startIndex = $Stack.IndexOf($Node)
        if ($startIndex -ge 0) {
            for ($index = $startIndex; $index -lt $Stack.Count; $index++) { $CycleNodes.Add([string]$Stack[$index]) | Out-Null }
        }
        return
    }
    if ($Visited.Contains($Node)) { return }

    $Visiting.Add($Node) | Out-Null
    $Stack.Add($Node) | Out-Null
    $neighbors = if ($Graph.ContainsKey($Node)) { @($Graph[$Node] | Sort-Object) } else { @() }
    foreach ($neighbor in $neighbors) {
        Find-WishlistDependencyCycle -Graph $Graph -Node ([string]$neighbor) -Visited $Visited -Visiting $Visiting -Stack $Stack -CycleNodes $CycleNodes
    }
    $null = $Stack.RemoveAt($Stack.Count - 1)
    $Visiting.Remove($Node) | Out-Null
    $Visited.Add($Node) | Out-Null
}

function Get-WishlistSchedulerDependencyCycleTickets {
    param([Parameter(Mandatory = $true)][object]$Scheduler)

    $graph = @{}
    $completeTickets = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($completedJob in @($Scheduler.State.Jobs | Where-Object { [string]$_.Status -eq 'COMPLETE' })) {
        $completeTicket = [string]$completedJob.TicketLockKey
        if (-not [string]::IsNullOrWhiteSpace($completeTicket)) { $completeTickets.Add($completeTicket) | Out-Null }
    }
    foreach ($job in @($Scheduler.State.Jobs)) {
        if ([string]$job.Status -in $script:TerminalStatuses) { continue }
        $source = [string]$job.TicketLockKey
        if ([string]::IsNullOrWhiteSpace($source)) { continue }
        $dependencies = @(Get-WishlistSchedulerDependencyList -Task $job.Task)
        if ($dependencies.Count -eq 0) { continue }
        if (-not $graph.ContainsKey($source)) { $graph[$source] = New-Object 'System.Collections.Generic.HashSet[string]' }
        foreach ($dependency in $dependencies) {
            $dependencyKey = ([int64]$dependency).ToString([Globalization.CultureInfo]::InvariantCulture)
            if ($completeTickets.Contains($dependencyKey)) { continue }
            $graph[$source].Add($dependencyKey) | Out-Null
        }
    }

    $visited = New-Object 'System.Collections.Generic.HashSet[string]'
    $visiting = New-Object 'System.Collections.Generic.HashSet[string]'
    $stack = New-Object 'System.Collections.ArrayList'
    $cycleNodes = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($node in @($graph.Keys | Sort-Object)) {
        Find-WishlistDependencyCycle -Graph $graph -Node ([string]$node) -Visited $visited -Visiting $visiting -Stack $stack -CycleNodes $cycleNodes
    }
    return @($cycleNodes | Sort-Object)
}

function Update-WishlistSchedulerDependencyStates {
    param([Parameter(Mandatory = $true)][object]$Scheduler)

    $changed = $false
    $cycleTickets = @(Get-WishlistSchedulerDependencyCycleTickets -Scheduler $Scheduler)
    foreach ($job in @($Scheduler.State.Jobs)) {
        Ensure-WishlistSchedulerJobShape -Job $job
        if ([string]$job.Status -notin @('QUEUED', $script:DependencyWaitingStatus)) { continue }
        if ($cycleTickets -contains [string]$job.TicketLockKey -and @(Get-WishlistSchedulerDependencyList -Task $job.Task).Count -gt 0) {
            $ticketText = if ([string]::IsNullOrWhiteSpace([string]$job.Task.Ticket)) { [string]$job.JobId } else { '#' + [string]$job.Task.Ticket }
            $cycleMessage = 'DEPENDENCY_CYCLE: dependency cycle involves ' + $ticketText + '.'
            $job.Status = 'BLOCKED'
            $job.DependencyReason = 'DEPENDENCY_CYCLE'
            $job.DependencyMessage = $cycleMessage
            $job.DependencyDetails = @([pscustomobject]@{ Ticket = [int64]$job.TicketLockKey; Status = 'CYCLE'; Reason = 'DEPENDENCY_CYCLE'; JobId = [string]$job.JobId })
            $job.EndTimeUtc = (Get-Date).ToUniversalTime().ToString('o')
            $job.LastActivityUtc = $job.EndTimeUtc
            $job.TerminalResult = [pscustomobject]@{ Code = 'DEPENDENCY_CYCLE'; Message = $cycleMessage }
            Remove-WishlistTerminalPayload -Job $job
            Add-WishlistSchedulerEvent -Scheduler $Scheduler -Type 'BLOCKED' -Job $job -Message $cycleMessage
            $changed = $true
        }
    }

    foreach ($job in @($Scheduler.State.Jobs)) {
        if ([string]$job.Status -notin @('QUEUED', $script:DependencyWaitingStatus)) { continue }
        $evaluation = Get-WishlistSchedulerDependencyEvaluation -Scheduler $Scheduler -Job $job
        $hasDependencies = @(Get-WishlistSchedulerDependencyList -Task $job.Task).Count -gt 0
        if ($hasDependencies -and -not $evaluation.Ready) {
            if ([string]$job.Status -ne $script:DependencyWaitingStatus -or [string]$job.DependencyMessage -cne [string]$evaluation.Message) {
                $job.Status = $script:DependencyWaitingStatus
                $job.DependencyReason = [string]$evaluation.Reason
                $job.DependencyMessage = [string]$evaluation.Message
                $job.DependencyDetails = @($evaluation.Details)
                Add-WishlistSchedulerEvent -Scheduler $Scheduler -Type 'WAITING_DEPENDENCY' -Job $job -Message $evaluation.Message
                $changed = $true
            } else {
                $job.DependencyDetails = @($evaluation.Details)
            }
        } elseif ([string]$job.Status -eq $script:DependencyWaitingStatus) {
            $job.Status = 'QUEUED'
            $job.DependencyReason = ''
            $job.DependencyMessage = ''
            $job.DependencyDetails = @()
            Add-WishlistSchedulerEvent -Scheduler $Scheduler -Type 'QUEUED' -Job $job -Message "$($job.JobId) dependencies are complete; job is ready."
            $changed = $true
        }
    }
    if ($changed) { Save-WishlistSchedulerState -Scheduler $Scheduler }
    return $changed
}

function Get-WishlistWorkerBranchName {
    param(
        [Parameter(Mandatory = $true)][object]$TaskDefinition,
        [Parameter(Mandatory = $true)][string]$JobId
    )

    $prefix = if ([string]$TaskDefinition.Type -match '^(fix|bugfix)$') { 'fix' } else { 'feature' }
    $ticket = Get-WishlistTicketLockKey -Ticket ([string]$TaskDefinition.Ticket)
    $identity = if ([string]::IsNullOrWhiteSpace($ticket)) { $JobId.Substring([Math]::Max(0, $JobId.Length - 12)) } else { 'ticket-' + $ticket }
    $jobSuffix = $JobId.Substring([Math]::Max(0, $JobId.Length - 8))
    return "$prefix/agent-$identity-$jobSuffix"
}

function ConvertTo-WishlistSchedulerRouteRecord {
    param([Parameter(Mandatory = $true)][object]$Route)

    return [pscustomobject]@{
        Status = [string]$Route.Status
        Reason = [string]$Route.Reason
        RequestedModel = [string]$Route.RequestedModel
        ModelKey = [string]$Route.ModelKey
        ModelName = [string]$Route.ModelName
        Provider = [string]$Route.Provider
        LauncherTarget = [string]$Route.LauncherTarget
        Thinking = [string]$Route.Thinking
        Skills = @($Route.Skills)
        SessionId = [string]$Route.SessionId
        Automatic = [bool]$Route.Automatic
    }
}

function ConvertTo-WishlistSchedulerTaskRecord {
    param([Parameter(Mandatory = $true)][object]$TaskDefinition)

    $dependencies = @(Get-WishlistSchedulerDependencyList -Task $TaskDefinition)
    $dependencyArray = [int64[]]@()
    if ($dependencies.Count -gt 0) { $dependencyArray = [int64[]]$dependencies }

    return [pscustomobject]@{
        Marker = [string]$TaskDefinition.Marker
        ProtocolVersion = [string]$TaskDefinition.ProtocolVersion
        Project = [string]$TaskDefinition.Project
        Ticket = [string]$TaskDefinition.Ticket
        Type = [string]$TaskDefinition.Type
        Scope = [string]$TaskDefinition.Scope
        Risk = [string]$TaskDefinition.Risk
        RequestedModel = [string]$TaskDefinition.RequestedModel
        Dependencies = $dependencyArray
    }
}

function ConvertTo-WishlistSchedulerProcessArgument {
    param([AllowEmptyString()][string]$Value)

    if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }
    $builder = New-Object System.Text.StringBuilder
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') { $backslashes++; continue }
        if ($character -eq '"') {
            for ($index = 0; $index -lt (($backslashes * 2) + 1); $index++) { $null = $builder.Append('\') }
            $null = $builder.Append('"')
            $backslashes = 0
            continue
        }
        for ($index = 0; $index -lt $backslashes; $index++) { $null = $builder.Append('\') }
        $backslashes = 0
        $null = $builder.Append($character)
    }
    for ($index = 0; $index -lt ($backslashes * 2); $index++) { $null = $builder.Append('\') }
    return '"' + $builder.ToString() + '"'
}

function Start-WishlistSchedulerWorkerProcess {
    param(
        [Parameter(Mandatory = $true)][object]$Scheduler,
        [Parameter(Mandatory = $true)][object]$Job,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    if ($null -ne $Scheduler.ProcessStarter) {
        return & $Scheduler.ProcessStarter $Job $Arguments $Scheduler
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $Scheduler.EnginePath
    $startInfo.Arguments = ((@($Arguments) | ForEach-Object { ConvertTo-WishlistSchedulerProcessArgument -Value ([string]$_) }) -join ' ')
    $startInfo.WorkingDirectory = $Scheduler.SourceRepoPath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not $process.Start()) {
        $process.Dispose()
        throw 'Process.Start returned false for scheduler worker.'
    }
    return $process
}

function Stop-WishlistSchedulerWorkerProcess {
    param(
        [Parameter(Mandatory = $true)][object]$Scheduler,
        [Parameter(Mandatory = $true)][object]$Process
    )

    if ($null -ne $Scheduler.ProcessStopper) {
        & $Scheduler.ProcessStopper $Process $Scheduler
        return
    }
    if ([bool]$Process.HasExited) { return }

    $taskkill = Get-Command taskkill.exe -ErrorAction SilentlyContinue
    if ($null -ne $taskkill) {
        $killer = New-Object System.Diagnostics.Process
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = [string]$taskkill.Source
        $startInfo.Arguments = "/PID $([int]$Process.Id) /T /F"
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $killer.StartInfo = $startInfo
        try {
            if ($killer.Start()) { $null = $killer.WaitForExit(10000) }
        } finally {
            $killer.Dispose()
        }
    }
    if (-not [bool]$Process.HasExited) {
        $Process.Kill()
        $null = $Process.WaitForExit(5000)
    }
}

function New-WishlistScheduler {
    [CmdletBinding()]
    param(
        [AllowEmptyString()][string]$StateRoot = '',
        [Parameter(Mandatory = $true)][string]$SourceRepoPath,
        [AllowEmptyString()][string]$RepoUrl = '',
        [AllowEmptyString()][string]$HandoffScriptPath = '',
        [AllowEmptyString()][string]$WorkerScriptPath = '',
        [AllowEmptyString()][string]$RoutingConfigPath = '',
        [ValidateRange(1, 16)][int]$MaxWorkers = 2,
        [switch]$AllowAstra,
        [switch]$DryRun,
        [AllowEmptyString()][string]$ReportDirectory = '',
        [AllowEmptyString()][string]$GitHubCommandPath = '',
        [AllowEmptyString()][string]$EnginePath = '',
        [AllowNull()][scriptblock]$ProcessStarter = $null,
        [AllowNull()][scriptblock]$ProcessStopper = $null
    )

    $resolvedSourceRepo = (Resolve-Path -LiteralPath $SourceRepoPath -ErrorAction Stop).Path
    $resolvedStateRoot = Get-WishlistAgentHostStateRoot -StateRoot $StateRoot
    New-Item -ItemType Directory -Force -Path $resolvedStateRoot | Out-Null
    foreach ($name in @('Payloads', 'Results', 'Lifecycle', 'Workers')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $resolvedStateRoot $name) | Out-Null
    }

    if ([string]::IsNullOrWhiteSpace($HandoffScriptPath)) { $HandoffScriptPath = Join-Path $PSScriptRoot 'Invoke-WishlistTask.ps1' }
    if ([string]::IsNullOrWhiteSpace($WorkerScriptPath)) { $WorkerScriptPath = Join-Path $PSScriptRoot 'Start-WishlistWorker.ps1' }
    $HandoffScriptPath = (Resolve-Path -LiteralPath $HandoffScriptPath -ErrorAction Stop).Path
    $WorkerScriptPath = (Resolve-Path -LiteralPath $WorkerScriptPath -ErrorAction Stop).Path
    if (-not [string]::IsNullOrWhiteSpace($RoutingConfigPath)) { $RoutingConfigPath = (Resolve-Path -LiteralPath $RoutingConfigPath -ErrorAction Stop).Path }
    if ([string]::IsNullOrWhiteSpace($RepoUrl)) { $RepoUrl = Get-WishlistSchedulerOriginUrl -RepoPath $resolvedSourceRepo }
    if ([string]::IsNullOrWhiteSpace($EnginePath)) { $EnginePath = Get-WishlistSchedulerEngine }

    $statePath = Join-Path $resolvedStateRoot 'state.json'
    $state = New-WishlistSchedulerState
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        try {
            $state = Get-Content -LiteralPath $statePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
            if ([int]$state.SchemaVersion -ne $script:SchedulerSchemaVersion) {
                throw "Unsupported scheduler state schema '$($state.SchemaVersion)'."
            }
            $state.Jobs = @($state.Jobs)
            $state.Workers = @($state.Workers)
        } catch {
            throw "Scheduler state '$statePath' is unreadable: $($_.Exception.Message)"
        }
    }

    $scheduler = [pscustomobject]@{
        StateRoot = $resolvedStateRoot
        StatePath = $statePath
        PayloadRoot = Join-Path $resolvedStateRoot 'Payloads'
        ResultRoot = Join-Path $resolvedStateRoot 'Results'
        LifecycleRoot = Join-Path $resolvedStateRoot 'Lifecycle'
        WorkerRoot = Join-Path $resolvedStateRoot 'Workers'
        SourceRepoPath = $resolvedSourceRepo
        RepoUrl = $RepoUrl
        HandoffScriptPath = $HandoffScriptPath
        WorkerScriptPath = $WorkerScriptPath
        RoutingConfigPath = $RoutingConfigPath
        ReportDirectory = $ReportDirectory
        GitHubCommandPath = $GitHubCommandPath
        EnginePath = $EnginePath
        MaxWorkers = $MaxWorkers
        AllowAstra = [bool]$AllowAstra
        DryRun = [bool]$DryRun
        Accepting = $true
        State = $state
        Runtime = @{}
        Events = New-Object 'System.Collections.Generic.List[object]'
        ProcessStarter = $ProcessStarter
        ProcessStopper = $ProcessStopper
    }

    foreach ($job in @($scheduler.State.Jobs)) {
        Ensure-WishlistSchedulerJobShape -Job $job
        if ($script:ActiveStatuses -contains [string]$job.Status) {
            $job.Status = 'BLOCKED'
            $job.RecoveryRequired = $true
            $job.EndTimeUtc = (Get-Date).ToUniversalTime().ToString('o')
            $job.TerminalResult = [pscustomobject]@{
                Code = 'STALE_AFTER_RESTART'
                Message = 'The previous host ended while this job was active. It was not restarted automatically.'
            }
            Add-WishlistSchedulerEvent -Scheduler $scheduler -Type 'RECOVERY' -Job $job -Message "Blocked stale job $($job.JobId); manual recovery is required."
        }
    }
    $scheduler.State.ShutdownState = 'RUNNING'
    $null = Update-WishlistSchedulerDependencyStates -Scheduler $scheduler
    Save-WishlistSchedulerState -Scheduler $scheduler
    return $scheduler
}

function Add-WishlistSchedulerJob {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][object]$Scheduler,
        [Parameter(Mandatory = $true)][object]$TaskDefinition,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$PayloadText,
        [ValidateSet('HOTKEY', 'CLI', 'COORDINATOR', 'TEST', 'OTHER')][string]$Source = 'OTHER'
    )

    if (-not $Scheduler.Accepting) { throw 'Scheduler is shutting down and no longer accepts jobs.' }
    $parseResult = Parse-WishlistTask -Text $PayloadText
    if (-not $parseResult.IsValid) { throw ($parseResult.Errors -join ' ') }
    foreach ($name in @('Marker', 'ProtocolVersion', 'Project', 'Ticket', 'Type', 'Scope', 'Risk', 'RequestedModel', 'Body')) {
        if ([string](Get-WishlistSchedulerProperty -Object $TaskDefinition -Name $name) -cne [string](Get-WishlistSchedulerProperty -Object $parseResult.Definition -Name $name)) {
            throw "Normalized task and immutable payload differ at '$name'."
        }
    }
    $providedDependencies = @((Get-WishlistSchedulerDependencyList -Task $TaskDefinition) | ForEach-Object { [int64]$_ }) -join ','
    $payloadDependencies = @((Get-WishlistSchedulerDependencyList -Task $parseResult.Definition) | ForEach-Object { [int64]$_ }) -join ','
    if ($providedDependencies -cne $payloadDependencies) {
        throw 'Normalized task and immutable payload differ at ''Dependencies''.'
    }

    $config = if ([string]::IsNullOrWhiteSpace($Scheduler.RoutingConfigPath)) { Get-WishlistRoutingConfig } else { Get-WishlistRoutingConfig -Path $Scheduler.RoutingConfigPath }
    $route = Resolve-WishlistRoute -TaskDefinition $parseResult.Definition -Config $config -AllowAstra:$Scheduler.AllowAstra
    if ([string]$route.Status -ne 'PASS') { throw "Task routing was blocked: $($route.Reason)" }
    if ([string]$route.ModelKey -eq 'terra' -and [bool]$route.Automatic) { throw 'Terra cannot be selected automatically.' }

    $sequence = [int64]$Scheduler.State.NextSequence
    $Scheduler.State.NextSequence = $sequence + 1
    $jobId = 'job-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmssfff') + '-' + $sequence.ToString('000000') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $payloadPath = Join-Path $Scheduler.PayloadRoot ($jobId + '.task')
    $temporaryPayloadPath = $payloadPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    try {
        [System.IO.File]::WriteAllText($temporaryPayloadPath, $PayloadText, $utf8WithoutBom)
        [System.IO.File]::Move($temporaryPayloadPath, $payloadPath)
    } finally {
        Remove-Item -LiteralPath $temporaryPayloadPath -Force -ErrorAction SilentlyContinue
    }

    $job = [pscustomobject]@{
        JobId = $jobId
        Sequence = $sequence
        CreatedUtc = (Get-Date).ToUniversalTime().ToString('o')
        Source = $Source
        Status = 'QUEUED'
        Task = ConvertTo-WishlistSchedulerTaskRecord -TaskDefinition $parseResult.Definition
        TicketLockKey = Get-WishlistTicketLockKey -Ticket ([string]$parseResult.Definition.Ticket)
        PayloadPath = $payloadPath
        PayloadRetained = $true
        Route = ConvertTo-WishlistSchedulerRouteRecord -Route $route
        PiSession = [string]$route.SessionId
        WorkerSlot = $null
        Workspace = ''
        Branch = Get-WishlistWorkerBranchName -TaskDefinition $parseResult.Definition -JobId $jobId
        ProcessId = $null
        PiProcessId = $null
        StartTimeUtc = $null
        EndTimeUtc = $null
        LastActivityUtc = $null
        TerminalResult = $null
        Usage = $null
        Report = $null
        RecoveryRequired = $false
    }

    try {
        $Scheduler.State.Jobs = @($Scheduler.State.Jobs) + @($job)
        $null = Update-WishlistSchedulerDependencyStates -Scheduler $Scheduler
        Save-WishlistSchedulerState -Scheduler $Scheduler
    } catch {
        $Scheduler.State.Jobs = @($Scheduler.State.Jobs | Where-Object { $_.JobId -ne $jobId })
        Remove-Item -LiteralPath $payloadPath -Force -ErrorAction SilentlyContinue
        throw
    }
    $enqueueMessage = if ([string]$job.Status -eq $script:DependencyWaitingStatus) {
        "Queued $jobId for $($job.Route.ModelKey); $($job.DependencyMessage)"
    } else {
        "Queued $jobId for $($job.Route.ModelKey)."
    }
    Add-WishlistSchedulerEvent -Scheduler $Scheduler -Type 'ENQUEUED' -Job $job -Message $enqueueMessage
    return $job
}

function Get-WishlistSchedulerActiveJobs {
    param([Parameter(Mandatory = $true)][object]$Scheduler)
    return @($Scheduler.State.Jobs | Where-Object { $script:ActiveStatuses -contains [string]$_.Status })
}

function Test-WishlistSchedulerJobCanStart {
    param(
        [Parameter(Mandatory = $true)][object]$Scheduler,
        [Parameter(Mandatory = $true)][object]$Job
    )

    $dependencyEvaluation = Get-WishlistSchedulerDependencyEvaluation -Scheduler $Scheduler -Job $Job
    if (-not $dependencyEvaluation.Ready) { return $false }

    $active = @(Get-WishlistSchedulerActiveJobs -Scheduler $Scheduler)
    if ($active.Count -ge $Scheduler.MaxWorkers) { return $false }
    $activeIntegration = @($active | Where-Object { [string]$_.Task.Type -eq 'integration' })
    if ($activeIntegration.Count -gt 0) { return $false }
    if ([string]$Job.Task.Type -eq 'integration' -and $active.Count -gt 0) { return $false }

    $modelKey = ([string]$Job.Route.ModelKey).ToLowerInvariant()
    $cap = $Scheduler.MaxWorkers
    if ($script:ModelCaps.ContainsKey($modelKey)) { $cap = [int]$script:ModelCaps[$modelKey] }
    $modelActive = @($active | Where-Object { ([string]$_.Route.ModelKey).ToLowerInvariant() -eq $modelKey }).Count
    if ($modelActive -ge $cap) { return $false }

    if (-not [string]::IsNullOrWhiteSpace([string]$Job.TicketLockKey)) {
        if (@($active | Where-Object { [string]$_.TicketLockKey -eq [string]$Job.TicketLockKey }).Count -gt 0) { return $false }
    }
    return $true
}

function Get-WishlistSchedulerFreeSlot {
    param([Parameter(Mandatory = $true)][object]$Scheduler)
    $used = @(Get-WishlistSchedulerActiveJobs -Scheduler $Scheduler | ForEach-Object { [int]$_.WorkerSlot })
    for ($slot = 1; $slot -le $Scheduler.MaxWorkers; $slot++) {
        if ($used -notcontains $slot) { return $slot }
    }
    return $null
}

function Start-WishlistSchedulerJob {
    param(
        [Parameter(Mandatory = $true)][object]$Scheduler,
        [Parameter(Mandatory = $true)][object]$Job
    )

    $slot = Get-WishlistSchedulerFreeSlot -Scheduler $Scheduler
    if ($null -eq $slot) { return $false }
    $resultPath = Join-Path $Scheduler.ResultRoot ($Job.JobId + '.json')
    $lifecyclePath = Join-Path $Scheduler.LifecycleRoot ($Job.JobId + '.json')
    $workspace = if ($Scheduler.DryRun) { $Scheduler.SourceRepoPath } else { Join-Path $Scheduler.WorkerRoot $Job.JobId }

    $Job.Status = 'PREPARING'
    $Job.WorkerSlot = $slot
    $Job.Workspace = $workspace
    $Job.StartTimeUtc = (Get-Date).ToUniversalTime().ToString('o')
    $Job.LastActivityUtc = $Job.StartTimeUtc
    if (-not $Scheduler.DryRun) {
        $Scheduler.State.Workers = @($Scheduler.State.Workers) + @([pscustomobject]@{
            JobId = $Job.JobId
            Path = $workspace
            Branch = $Job.Branch
            CreatedUtc = $Job.StartTimeUtc
            Owned = $true
            Retain = $true
        })
    }
    Save-WishlistSchedulerState -Scheduler $Scheduler

    $arguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Scheduler.WorkerScriptPath,
        '-JobId', $Job.JobId,
        '-TaskFile', $Job.PayloadPath,
        '-ResultPath', $resultPath,
        '-LifecyclePath', $lifecyclePath,
        '-WorkerRoot', $Scheduler.WorkerRoot,
        '-RepoUrl', $Scheduler.RepoUrl,
        '-BranchName', $Job.Branch,
        '-HandoffScriptPath', $Scheduler.HandoffScriptPath,
        '-SourceRepoPath', $Scheduler.SourceRepoPath
    )
    if (-not [string]::IsNullOrWhiteSpace($Scheduler.RoutingConfigPath)) { $arguments += @('-RoutingConfigPath', $Scheduler.RoutingConfigPath) }
    if (-not [string]::IsNullOrWhiteSpace($Scheduler.ReportDirectory)) { $arguments += @('-ReportDirectory', $Scheduler.ReportDirectory) }
    if (-not [string]::IsNullOrWhiteSpace($Scheduler.GitHubCommandPath)) { $arguments += @('-GitHubCommandPath', $Scheduler.GitHubCommandPath) }
    if ($Scheduler.AllowAstra) { $arguments += '-AllowAstra' }
    if ($Scheduler.DryRun) { $arguments += '-DryRun' }

    try {
        $process = Start-WishlistSchedulerWorkerProcess -Scheduler $Scheduler -Job $Job -Arguments $arguments
        $Job.ProcessId = [int](Get-WishlistSchedulerProperty -Object $process -Name 'Id')
        $Scheduler.Runtime[$Job.JobId] = [pscustomobject]@{
            Process = $process
            ResultPath = $resultPath
            LifecyclePath = $lifecyclePath
        }
        Save-WishlistSchedulerState -Scheduler $Scheduler
        Add-WishlistSchedulerEvent -Scheduler $Scheduler -Type 'STARTED' -Job $Job -Message "Worker $slot started $($Job.JobId) as $($Job.Route.ModelKey)."
        return $true
    } catch {
        $Job.Status = 'FAILED'
        $Job.EndTimeUtc = (Get-Date).ToUniversalTime().ToString('o')
        $Job.TerminalResult = [pscustomobject]@{ Code = 'WORKER_START_FAILED'; Message = $_.Exception.Message }
        Remove-WishlistTerminalPayload -Job $Job
        Save-WishlistSchedulerState -Scheduler $Scheduler
        Add-WishlistSchedulerEvent -Scheduler $Scheduler -Type 'FAILED' -Job $Job -Message "Worker start failed for $($Job.JobId)."
        return $false
    }
}

function Remove-WishlistTerminalPayload {
    param([Parameter(Mandatory = $true)][object]$Job)
    if ([bool]$Job.PayloadRetained -and (Test-Path -LiteralPath $Job.PayloadPath -PathType Leaf)) {
        Remove-Item -LiteralPath $Job.PayloadPath -Force -ErrorAction SilentlyContinue
    }
    $Job.PayloadRetained = $false
}

function Complete-WishlistSchedulerJob {
    param(
        [Parameter(Mandatory = $true)][object]$Scheduler,
        [Parameter(Mandatory = $true)][object]$Job,
        [Parameter(Mandatory = $true)][object]$Runtime
    )

    $result = $null
    if (Test-Path -LiteralPath $Runtime.ResultPath -PathType Leaf) {
        try { $result = Get-Content -LiteralPath $Runtime.ResultPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { $result = $null }
    }
    if ($null -eq $result -or [string]$result.JobId -ne [string]$Job.JobId) {
        $Job.Status = 'FAILED'
        $Job.TerminalResult = [pscustomobject]@{ Code = 'WORKER_RESULT_MISSING'; Message = 'Worker exited without a valid job-matched result.' }
    } else {
        $resultStatus = [string]$result.Status
        if ($script:TerminalStatuses -notcontains $resultStatus) { $resultStatus = 'FAILED' }
        $Job.Status = $resultStatus
        $Job.Workspace = [string]$result.Workspace
        $Job.Branch = [string]$result.Branch
        $Job.TerminalResult = $result.Handoff
        if ($null -ne $result.Handoff) {
            $launch = Get-WishlistSchedulerProperty -Object $result.Handoff -Name 'Launch'
            $Job.Usage = Get-WishlistSchedulerProperty -Object $launch -Name 'UsageSummary'
            $Job.Report = Get-WishlistSchedulerProperty -Object $result.Handoff -Name 'Report'
            $piSession = [string](Get-WishlistSchedulerProperty -Object $launch -Name 'PiSessionId')
            if (-not [string]::IsNullOrWhiteSpace($piSession)) { $Job.PiSession = $piSession }
        }
    }
    $Job.EndTimeUtc = (Get-Date).ToUniversalTime().ToString('o')
    $Job.LastActivityUtc = $Job.EndTimeUtc
    $Job.ProcessId = $null
    Remove-WishlistTerminalPayload -Job $Job
    try { $Runtime.Process.Dispose() } catch { }
    $Scheduler.Runtime.Remove($Job.JobId)
    Save-WishlistSchedulerState -Scheduler $Scheduler
    Add-WishlistSchedulerEvent -Scheduler $Scheduler -Type $Job.Status -Job $Job -Message "$($Job.JobId) finished as $($Job.Status)."
}

function Update-WishlistSchedulerRuntime {
    param([Parameter(Mandatory = $true)][object]$Scheduler)

    $changed = $false
    foreach ($job in @(Get-WishlistSchedulerActiveJobs -Scheduler $Scheduler)) {
        if (-not $Scheduler.Runtime.ContainsKey([string]$job.JobId)) { continue }
        $runtime = $Scheduler.Runtime[[string]$job.JobId]
        if (Test-Path -LiteralPath $runtime.LifecyclePath -PathType Leaf) {
            try {
                $lifecycle = Get-Content -LiteralPath $runtime.LifecyclePath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
                $phase = [string]$lifecycle.Phase
                if ($script:ActiveStatuses -contains $phase -and [string]$job.Status -ne $phase) { $job.Status = $phase; $changed = $true }
                foreach ($pair in @(@('Workspace', 'Workspace'), @('Branch', 'Branch'), @('TimestampUtc', 'LastActivityUtc'))) {
                    $value = [string](Get-WishlistSchedulerProperty -Object $lifecycle -Name $pair[0])
                    if (-not [string]::IsNullOrWhiteSpace($value) -and [string](Get-WishlistSchedulerProperty -Object $job -Name $pair[1]) -ne $value) {
                        $job.($pair[1]) = $value
                        $changed = $true
                    }
                }
                $piProcessId = Get-WishlistSchedulerProperty -Object $lifecycle -Name 'PiProcessId'
                if ($null -ne $piProcessId -and [string]$piProcessId -match '^\d+$' -and [int]$job.PiProcessId -ne [int]$piProcessId) {
                    $job.PiProcessId = [int]$piProcessId
                    $changed = $true
                }
            } catch { }
        }
        if ([bool]$runtime.Process.HasExited) {
            Complete-WishlistSchedulerJob -Scheduler $Scheduler -Job $job -Runtime $runtime
        }
    }
    if ($changed) { Save-WishlistSchedulerState -Scheduler $Scheduler }
}

function Invoke-WishlistSchedulerTick {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][object]$Scheduler)

    Update-WishlistSchedulerRuntime -Scheduler $Scheduler
    $null = Update-WishlistSchedulerDependencyStates -Scheduler $Scheduler
    if ($Scheduler.Accepting -or $Scheduler.State.ShutdownState -eq 'DRAINING') {
        while (@(Get-WishlistSchedulerActiveJobs -Scheduler $Scheduler).Count -lt $Scheduler.MaxWorkers) {
            $queued = @($Scheduler.State.Jobs | Where-Object { [string]$_.Status -eq 'QUEUED' } | Sort-Object Sequence)
            if ($queued.Count -eq 0) { break }
            $active = @(Get-WishlistSchedulerActiveJobs -Scheduler $Scheduler)
            if ([string]$queued[0].Task.Type -eq 'integration' -and $active.Count -gt 0) { break }
            $candidate = $null
            foreach ($job in $queued) {
                if (Test-WishlistSchedulerJobCanStart -Scheduler $Scheduler -Job $job) { $candidate = $job; break }
                if ([string]$job.Task.Type -eq 'integration') { break }
            }
            if ($null -eq $candidate) { break }
            $null = Start-WishlistSchedulerJob -Scheduler $Scheduler -Job $candidate
        }
    }
    $null = Update-WishlistSchedulerDependencyStates -Scheduler $Scheduler

    $events = @($Scheduler.Events | ForEach-Object { $_ })
    $Scheduler.Events.Clear()
    return [pscustomobject]@{ Events = $events; State = $Scheduler.State }
}

function Stop-WishlistScheduler {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][object]$Scheduler)

    $Scheduler.Accepting = $false
    $Scheduler.State.ShutdownState = 'STOPPING'
    Save-WishlistSchedulerState -Scheduler $Scheduler
    foreach ($job in @(Get-WishlistSchedulerActiveJobs -Scheduler $Scheduler)) {
        if ($Scheduler.Runtime.ContainsKey([string]$job.JobId)) {
            $runtime = $Scheduler.Runtime[[string]$job.JobId]
            try { Stop-WishlistSchedulerWorkerProcess -Scheduler $Scheduler -Process $runtime.Process } catch { }
            try { $runtime.Process.Dispose() } catch { }
            $Scheduler.Runtime.Remove([string]$job.JobId)
        }
        $job.Status = 'CANCELLED'
        $job.EndTimeUtc = (Get-Date).ToUniversalTime().ToString('o')
        $job.LastActivityUtc = $job.EndTimeUtc
        $job.ProcessId = $null
        $job.TerminalResult = [pscustomobject]@{ Code = 'HOST_SHUTDOWN'; Message = 'Worker and its process tree were interrupted during controlled host shutdown.' }
        Remove-WishlistTerminalPayload -Job $job
        Add-WishlistSchedulerEvent -Scheduler $Scheduler -Type 'CANCELLED' -Job $job -Message "$($job.JobId) was cancelled during host shutdown."
    }
    $Scheduler.State.ShutdownState = 'STOPPED'
    Save-WishlistSchedulerState -Scheduler $Scheduler
}

function Test-WishlistSchedulerProcessAlive {
    param(
        [Parameter(Mandatory = $true)][object]$Scheduler,
        [Parameter(Mandatory = $true)][object]$Job
    )
    if (-not $Scheduler.Runtime.ContainsKey([string]$Job.JobId)) { return $false }
    try { return -not [bool]$Scheduler.Runtime[[string]$Job.JobId].Process.HasExited } catch { return $false }
}

function Test-WishlistPiProcessAlive {
    param([Parameter(Mandatory = $true)][object]$Job)
    $processId = Get-WishlistSchedulerProperty -Object $Job -Name 'PiProcessId'
    if ($null -eq $processId -or [string]$processId -notmatch '^\d+$') { return $false }
    return $null -ne (Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue)
}

function Format-WishlistDuration {
    param(
        [AllowNull()][string]$Start,
        [AllowNull()][string]$End
    )
    if ([string]::IsNullOrWhiteSpace($Start)) { return '00:00:00' }
    try {
        $startValue = [DateTimeOffset]::Parse($Start)
        $endValue = if ([string]::IsNullOrWhiteSpace($End)) { [DateTimeOffset]::UtcNow } else { [DateTimeOffset]::Parse($End) }
        $span = $endValue - $startValue
        return '{0:00}:{1:00}:{2:00}' -f [Math]::Floor($span.TotalHours), $span.Minutes, $span.Seconds
    } catch { return '00:00:00' }
}

function Format-WishlistUsageLines {
    [CmdletBinding()]
    param([AllowNull()][object]$Usage, [string]$Indent = '  ')

    if ($null -eq $Usage) { return @() }
    $mapping = @(
        @('Input', 'InputTokens'),
        @('Cache Read', 'CacheReadTokens'),
        @('Cache Write', 'CacheWriteTokens'),
        @('Output', 'OutputTokens'),
        @('Reasoning', 'ReasoningTokens'),
        @('Total', 'TotalTokens')
    )
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $lines.Add($Indent + 'USAGE') | Out-Null
    foreach ($item in $mapping) {
        $value = Get-WishlistSchedulerProperty -Object $Usage -Name $item[1]
        if ($null -ne $value) {
            $number = [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, '{0:N0}', [decimal]$value)
            $lines.Add(('{0}  {1,-11} {2,12}' -f $Indent, $item[0], $number)) | Out-Null
        }
    }
    $cost = Get-WishlistSchedulerProperty -Object $Usage -Name 'Cost'
    if ($null -ne $cost) { $lines.Add(('{0}  {1,-11} {2,12}' -f $Indent, 'Cost', [string]$cost)) | Out-Null }
    return @($lines)
}

function Format-WishlistSchedulerDependencySummary {
    param([Parameter(Mandatory = $true)][object]$Job)

    $details = @($Job.DependencyDetails)
    if ($details.Count -eq 0) {
        $dependencies = @(Get-WishlistSchedulerDependencyList -Task $Job.Task)
        if ($dependencies.Count -eq 0) { return '' }
        return 'depends on ' + (@($dependencies | ForEach-Object { '#' + [string]$_ }) -join ',')
    }
    $parts = @($details | ForEach-Object {
        if ([string]$_.Status -eq 'MISSING') { 'missing #' + [string]$_.Ticket } else { '#' + [string]$_.Ticket + ' ' + [string]$_.Status }
    })
    return 'depends on ' + ($parts -join ', ')
}

function ConvertTo-WishlistDashboardText {
    param(
        [AllowNull()][object]$Value,
        [int]$MaximumLength = 160
    )

    if ($null -eq $Value) { return '' }
    $text = ([string]$Value).Trim() -replace '\s+', ' '
    if ($text.Length -le $MaximumLength) { return $text }
    return $text.Substring(0, [Math]::Max(0, $MaximumLength - 4)).TrimEnd() + ' ...'
}

function Format-WishlistDashboardUsage {
    param([AllowNull()][object]$Usage)

    if ($null -eq $Usage) { return 'not reported' }
    $parts = New-Object 'System.Collections.Generic.List[string]'
    foreach ($item in @(
        @('Input', 'InputTokens'),
        @('Cache Read', 'CacheReadTokens'),
        @('Cache Write', 'CacheWriteTokens'),
        @('Output', 'OutputTokens'),
        @('Reasoning', 'ReasoningTokens'),
        @('Total', 'TotalTokens'),
        @('Cost', 'Cost')
    )) {
        $value = Get-WishlistSchedulerProperty -Object $Usage -Name $item[1]
        if ($null -eq $value) { continue }
        $formatted = if ($value -is [System.IFormattable]) {
            $value.ToString($null, [Globalization.CultureInfo]::InvariantCulture)
        } else {
            [string]$value
        }
        $parts.Add(('{0}={1}' -f $item[0], $formatted)) | Out-Null
    }
    if ($parts.Count -eq 0) { return 'not reported' }
    return ($parts -join ' | ')
}

function Get-WishlistDashboardCompletionText {
    param([Parameter(Mandatory = $true)][object]$Job)

    $terminalResult = Get-WishlistSchedulerProperty -Object $Job -Name 'TerminalResult'
    $launch = Get-WishlistSchedulerProperty -Object $terminalResult -Name 'Launch'
    $failureReason = [string](Get-WishlistSchedulerProperty -Object $launch -Name 'FailureReason')
    if ([string]::IsNullOrWhiteSpace($failureReason)) {
        $failureReason = [string](Get-WishlistSchedulerProperty -Object $terminalResult -Name 'Message')
    }
    if (-not [string]::IsNullOrWhiteSpace($failureReason)) {
        return ConvertTo-WishlistDashboardText -Value ('Failure: ' + $failureReason)
    }

    $status = [string](Get-WishlistSchedulerProperty -Object $Job -Name 'Status')
    $response = [string](Get-WishlistSchedulerProperty -Object $launch -Name 'Response')
    if ($status -eq 'COMPLETE') {
        if (-not [string]::IsNullOrWhiteSpace($response)) {
            return ConvertTo-WishlistDashboardText -Value ('Completed: ' + $response)
        }
        return 'Completed successfully.'
    }

    switch ($status) {
        'FAILED' { return 'Failed.' }
        'BLOCKED' { return 'Blocked; manual recovery may be required.' }
        'CANCELLED' { return 'Cancelled.' }
        default { return ConvertTo-WishlistDashboardText -Value $status }
    }
}

function Get-WishlistDashboardReportStatus {
    param([Parameter(Mandatory = $true)][object]$Job)

    $report = Get-WishlistSchedulerProperty -Object $Job -Name 'Report'
    if ($null -eq $report) { return 'not recorded' }
    $status = [string](Get-WishlistSchedulerProperty -Object $report -Name 'Status')
    $localPath = [string](Get-WishlistSchedulerProperty -Object $report -Name 'LocalPath')
    switch ($status) {
        'POSTED' { return 'POSTED' }
        'LOCAL' { return 'local fallback' }
        'WARNING' {
            if (-not [string]::IsNullOrWhiteSpace($localPath)) { return 'WARNING / local fallback' }
            return 'WARNING'
        }
        default {
            if ([string]::IsNullOrWhiteSpace($status)) { return 'not recorded' }
            return ConvertTo-WishlistDashboardText -Value $status -MaximumLength 80
        }
    }
}

function Format-WishlistSchedulerJobCard {
    param([Parameter(Mandatory = $true)][object]$Job)

    $task = Get-WishlistSchedulerProperty -Object $Job -Name 'Task'
    $route = Get-WishlistSchedulerProperty -Object $Job -Name 'Route'
    $ticket = [string](Get-WishlistSchedulerProperty -Object $task -Name 'Ticket')
    $jobId = [string](Get-WishlistSchedulerProperty -Object $Job -Name 'JobId')
    $identity = if ([string]::IsNullOrWhiteSpace($ticket)) { $jobId } else { '#{0} / {1}' -f $ticket, $jobId }
    $status = [string](Get-WishlistSchedulerProperty -Object $Job -Name 'Status')
    $modelName = [string](Get-WishlistSchedulerProperty -Object $route -Name 'ModelName')
    $modelKey = [string](Get-WishlistSchedulerProperty -Object $route -Name 'ModelKey')
    $model = if ([string]::IsNullOrWhiteSpace($modelName)) { $modelKey } elseif ([string]::IsNullOrWhiteSpace($modelKey)) { $modelName } else { '{0} [{1}]' -f $modelName, $modelKey }
    if ([string]::IsNullOrWhiteSpace($model)) { $model = '-' }
    $session = [string](Get-WishlistSchedulerProperty -Object $Job -Name 'PiSession')
    if ([string]::IsNullOrWhiteSpace($session)) { $session = '-' }
    $branch = [string](Get-WishlistSchedulerProperty -Object $Job -Name 'Branch')
    if ([string]::IsNullOrWhiteSpace($branch)) { $branch = '-' }

    $lines = New-Object 'System.Collections.Generic.List[string]'
    $lines.Add(' +------------------------------------------------------------') | Out-Null
    $lines.Add((' | {0} | {1}' -f (ConvertTo-WishlistDashboardText -Value $identity -MaximumLength 90), $status)) | Out-Null
    $lines.Add((' | Model: {0}' -f (ConvertTo-WishlistDashboardText -Value $model -MaximumLength 100))) | Out-Null
    $lines.Add((' | Pi session: {0}' -f (ConvertTo-WishlistDashboardText -Value $session -MaximumLength 100))) | Out-Null
    $lines.Add((' | Branch: {0}' -f (ConvertTo-WishlistDashboardText -Value $branch -MaximumLength 100))) | Out-Null
    $lines.Add((' | Completion: {0}' -f (Get-WishlistDashboardCompletionText -Job $Job))) | Out-Null
    $lines.Add((' | Report: {0}' -f (Get-WishlistDashboardReportStatus -Job $Job))) | Out-Null
    $lines.Add((' | Usage: {0}' -f (ConvertTo-WishlistDashboardText -Value (Format-WishlistDashboardUsage -Usage (Get-WishlistSchedulerProperty -Object $Job -Name 'Usage')) -MaximumLength 150))) | Out-Null
    $lines.Add(' +------------------------------------------------------------') | Out-Null
    return [string[]]$lines.ToArray()
}

function Get-WishlistSchedulerCompletedJobs {
    param([Parameter(Mandatory = $true)][object]$Scheduler)

    $records = New-Object 'System.Collections.Generic.List[object]'
    foreach ($job in @($Scheduler.State.Jobs)) {
        if ($script:TerminalStatuses -notcontains [string](Get-WishlistSchedulerProperty -Object $job -Name 'Status')) { continue }
        $end = [string](Get-WishlistSchedulerProperty -Object $job -Name 'EndTimeUtc')
        if ([string]::IsNullOrWhiteSpace($end)) { $end = [string](Get-WishlistSchedulerProperty -Object $job -Name 'LastActivityUtc') }
        if ([string]::IsNullOrWhiteSpace($end)) { $end = [string](Get-WishlistSchedulerProperty -Object $job -Name 'CreatedUtc') }
        $sequence = 0L
        try { $sequence = [int64](Get-WishlistSchedulerProperty -Object $job -Name 'Sequence') } catch { }
        $records.Add([pscustomobject]@{ Job = $job; EndTimeUtc = $end; Sequence = $sequence }) | Out-Null
    }
    return @(
        $records |
            Sort-Object @{ Expression = 'EndTimeUtc'; Descending = $true }, @{ Expression = 'Sequence'; Descending = $true } |
            Select-Object -First $script:CompletedHistoryLimit |
            ForEach-Object { $_.Job }
    )
}

function Format-WishlistSchedulerStatus {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][object]$Scheduler,
        [AllowEmptyString()][string]$StatusMessage = ''
    )

    $lines = New-Object 'System.Collections.Generic.List[string]'
    $lines.Add('+------------------------------------------------------------') | Out-Null
    $lines.Add('| WISHLIST AGENT HOST') | Out-Null
    $lines.Add('+------------------------------------------------------------') | Out-Null
    if (-not [string]::IsNullOrWhiteSpace($StatusMessage)) {
        $lines.Add((' STATUS  {0}' -f (ConvertTo-WishlistDashboardText -Value $StatusMessage))) | Out-Null
    }
    $lines.Add('') | Out-Null
    $lines.Add(' QUEUE') | Out-Null
    $visibleJobs = @($Scheduler.State.Jobs | Where-Object { [string]$_.Status -in @('QUEUED', $script:DependencyWaitingStatus) -or $script:ActiveStatuses -contains [string]$_.Status } | Sort-Object Sequence)
    if ($visibleJobs.Count -eq 0) { $lines.Add(' (empty)') | Out-Null }
    foreach ($job in $visibleJobs) {
        $identity = if ([string]::IsNullOrWhiteSpace([string]$job.Task.Ticket)) { [string]$job.JobId } else { '#' + [string]$job.Task.Ticket }
        $elapsed = if ($script:ActiveStatuses -contains [string]$job.Status) { '  ' + (Format-WishlistDuration -Start $job.StartTimeUtc -End '') } else { '' }
        $displayStatus = if ([string]$job.Status -eq $script:DependencyWaitingStatus) { 'WAITING' } else { [string]$job.Status }
        $dependencyText = if ([string]$job.Status -eq $script:DependencyWaitingStatus) { Format-WishlistSchedulerDependencySummary -Job $job } else { '' }
        $line = (' {0,-18} {1,-6} {2,-10}{3}' -f $identity, $job.Route.ModelKey, $displayStatus, $elapsed)
        if (-not [string]::IsNullOrWhiteSpace($dependencyText)) { $line += '  ' + $dependencyText }
        $lines.Add($line) | Out-Null
    }
    $lines.Add('') | Out-Null
    $lines.Add(' WORKERS') | Out-Null
    $active = @(Get-WishlistSchedulerActiveJobs -Scheduler $Scheduler | Sort-Object WorkerSlot)
    if ($active.Count -eq 0) { $lines.Add(' (idle)') | Out-Null }
    foreach ($job in $active) {
        $identity = if ([string]::IsNullOrWhiteSpace([string]$job.Task.Ticket)) { [string]$job.JobId } else { '#' + [string]$job.Task.Ticket }
        $workerAlive = Test-WishlistSchedulerProcessAlive -Scheduler $Scheduler -Job $job
        $alive = switch ([string]$job.Status) {
            'RUNNING' { if (Test-WishlistPiProcessAlive -Job $job) { 'Pi alive' } else { 'Pi process unavailable' } }
            'REPORTING' { if ($workerAlive) { 'reporter alive' } else { 'reporter unavailable' } }
            default { if ($workerAlive) { 'worker alive' } else { 'process unavailable' } }
        }
        $elapsed = Format-WishlistDuration -Start $job.StartTimeUtc -End ''
        $lines.Add((' [{0}] {1} | {2} | {3} | {4} | {5}' -f $job.WorkerSlot, $job.Route.ModelKey, $identity, $job.Status, $elapsed, $alive)) | Out-Null
        $lines.Add(('     thinking {0} | session {1}' -f $job.Route.Thinking, $job.PiSession)) | Out-Null
        $lines.Add(('     {0} | {1}' -f $job.Branch, $job.Workspace)) | Out-Null
    }
    $lines.Add('') | Out-Null
    $lines.Add((' Capacity {0}/{1}' -f $active.Count, $Scheduler.MaxWorkers)) | Out-Null
    $next = @($Scheduler.State.Jobs | Where-Object { [string]$_.Status -eq 'QUEUED' } | Sort-Object Sequence | Select-Object -First 1)
    if ($next.Count -gt 0) {
        $nextIdentity = if ([string]::IsNullOrWhiteSpace([string]$next[0].Task.Ticket)) { [string]$next[0].JobId } else { '#' + [string]$next[0].Task.Ticket }
        $lines.Add(" Next     $nextIdentity") | Out-Null
    } else { $lines.Add(' Next     -') | Out-Null }

    $completedJobs = @(Get-WishlistSchedulerCompletedJobs -Scheduler $Scheduler)
    $lines.Add('') | Out-Null
    $lines.Add((' COMPLETED TASKS (latest {0})' -f $script:CompletedHistoryLimit)) | Out-Null
    if ($completedJobs.Count -eq 0) {
        $lines.Add(' (none)') | Out-Null
    } else {
        foreach ($completedJob in $completedJobs) {
            foreach ($cardLine in @(Format-WishlistSchedulerJobCard -Job $completedJob)) {
                $lines.Add($cardLine) | Out-Null
            }
        }
    }
    $lines.Add('+------------------------------------------------------------') | Out-Null
    return @($lines)
}

function Get-WishlistSchedulerSummary {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][object]$Scheduler)

    $counts = [ordered]@{}
    foreach ($status in @('QUEUED', $script:DependencyWaitingStatus, 'PREPARING', 'RUNNING', 'REPORTING', 'COMPLETE', 'FAILED', 'BLOCKED', 'CANCELLED')) {
        $counts[$status] = @($Scheduler.State.Jobs | Where-Object { [string]$_.Status -eq $status }).Count
    }
    return [pscustomobject]@{
        StateRoot = $Scheduler.StateRoot
        MaxWorkers = $Scheduler.MaxWorkers
        Counts = [pscustomobject]$counts
        Jobs = @($Scheduler.State.Jobs)
        Workers = @($Scheduler.State.Workers)
    }
}

Export-ModuleMember -Function Get-WishlistAgentHostStateRoot, New-WishlistScheduler, Add-WishlistSchedulerJob, Invoke-WishlistSchedulerTick, Stop-WishlistScheduler, Format-WishlistSchedulerStatus, Format-WishlistUsageLines, Get-WishlistSchedulerSummary, Test-WishlistSchedulerJobCanStart
