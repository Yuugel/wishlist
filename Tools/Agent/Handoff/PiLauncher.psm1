Set-StrictMode -Version 2.0

function Get-WishlistPiProperty {
    param(
        [AllowNull()]
        [object]$Object,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }

    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) {
            return $Object[$Name]
        }
        return $null
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function Get-WishlistPiAvailability {
    [CmdletBinding()]
    param(
        [string]$CommandName = 'pi',

        [switch]$ProbeHelp
    )

    $candidateNames = @($CommandName)
    if ($CommandName -eq 'pi') {
        $candidateNames += 'pi.cmd'
    }

    $command = $null
    $resolvedCommandName = $CommandName
    $nonLaunchableCommand = $null
    foreach ($candidateName in $candidateNames) {
        if ([string]::IsNullOrWhiteSpace([string]$candidateName)) {
            continue
        }

        $candidate = Get-Command -Name ([string]$candidateName) -ErrorAction SilentlyContinue
        if ($null -eq $candidate) {
            continue
        }

        if ($candidate.CommandType -eq 'Application') {
            $command = $candidate
            $resolvedCommandName = [string]$candidate.Name
            break
        }

        if ($null -eq $nonLaunchableCommand) {
            $nonLaunchableCommand = $candidate
        }
    }

    if ($null -eq $command) {
        if ($null -ne $nonLaunchableCommand) {
            $nonLaunchablePath = if (-not [string]::IsNullOrWhiteSpace([string]$nonLaunchableCommand.Source)) {
                [string]$nonLaunchableCommand.Source
            } else {
                [string]$nonLaunchableCommand.Definition
            }
            return [pscustomobject]@{
                Status = 'PI_NOT_CONFIGURED'
                Command = $CommandName
                ResolvedCommandName = $nonLaunchableCommand.Name
                Path = $nonLaunchablePath
                HelpProbeSucceeded = $false
                HelpOutput = @()
                Reason = "'$CommandName' resolves to '$($nonLaunchableCommand.CommandType)', which is not directly launchable by the Pi boundary."
            }
        }

        return [pscustomobject]@{
            Status = 'PI_NOT_CONFIGURED'
            Command = $CommandName
            ResolvedCommandName = $null
            Path = $null
            HelpProbeSucceeded = $false
            HelpOutput = @()
            Reason = "'$CommandName' is not installed or not on PATH."
        }
    }

    $path = if (-not [string]::IsNullOrWhiteSpace([string]$command.Source)) {
        [string]$command.Source
    } else {
        [string]$command.Definition
    }
    $helpOutput = @()
    $helpSucceeded = $null
    if ($ProbeHelp) {
        $helpSucceeded = $false
        try {
            $helpOutput = @(& $path '--help' 2>&1 | ForEach-Object { [string]$_ })
            $helpSucceeded = ([int]$LASTEXITCODE -eq 0)
        } catch {
            $helpSucceeded = $false
            $helpOutput = @($_.Exception.Message)
        }
    }

    $reason = if (-not $ProbeHelp) {
        'pi executable found; help probe deferred until Apply.'
    } elseif ($helpSucceeded) {
        'pi executable found and its documented --help probe completed.'
    } else {
        'pi executable found, but its documented --help probe did not complete successfully.'
    }

    return [pscustomobject]@{
        Status = 'PI_AVAILABLE'
        Command = $CommandName
        ResolvedCommandName = $resolvedCommandName
        Path = $path
        HelpProbeSucceeded = $helpSucceeded
        HelpOutput = @($helpOutput | Select-Object -First 40)
        Reason = $reason
    }
}

function Add-WishlistPiContextLine {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.List[string]]$Lines,

        [Parameter(Mandatory = $true)]
        [string]$Label,

        [AllowNull()]
        [object]$Value
    )

    if ($null -eq $Value) {
        return
    }

    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) {
        return
    }

    $Lines.Add("${Label}: $text") | Out-Null
}

function New-WishlistPiTaskContext {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TaskDefinition,

        [Parameter(Mandatory = $true)]
        [object]$Route,

        [Parameter(Mandatory = $true)]
        [object]$Config
    )

    $lines = New-Object 'System.Collections.Generic.List[string]'
    $lines.Add('Wishlist task context') | Out-Null
    Add-WishlistPiContextLine -Lines $lines -Label 'Protocol version' -Value (Get-WishlistPiProperty -Object $TaskDefinition -Name 'ProtocolVersion')
    Add-WishlistPiContextLine -Lines $lines -Label 'Project' -Value (Get-WishlistPiProperty -Object $TaskDefinition -Name 'Project')
    Add-WishlistPiContextLine -Lines $lines -Label 'Ticket' -Value (Get-WishlistPiProperty -Object $TaskDefinition -Name 'Ticket')
    Add-WishlistPiContextLine -Lines $lines -Label 'Type' -Value (Get-WishlistPiProperty -Object $TaskDefinition -Name 'Type')
    Add-WishlistPiContextLine -Lines $lines -Label 'Scope' -Value (Get-WishlistPiProperty -Object $TaskDefinition -Name 'Scope')
    Add-WishlistPiContextLine -Lines $lines -Label 'Risk' -Value (Get-WishlistPiProperty -Object $TaskDefinition -Name 'Risk')

    $contextConfig = Get-WishlistPiProperty -Object $Config -Name 'context'
    $metadataNames = Get-WishlistPiProperty -Object $contextConfig -Name 'includeMetadata'
    $metadata = Get-WishlistPiProperty -Object $TaskDefinition -Name 'Metadata'
    foreach ($metadataName in @($metadataNames)) {
        if ([string]::IsNullOrWhiteSpace([string]$metadataName)) {
            continue
        }

        $metadataValue = Get-WishlistPiProperty -Object $metadata -Name ([string]$metadataName)
        if ($null -eq $metadataValue -or [string]::IsNullOrWhiteSpace([string]$metadataValue)) {
            continue
        }

        Add-WishlistPiContextLine -Lines $lines -Label ("Metadata " + [string]$metadataName) -Value $metadataValue
    }

    $lines.Add('') | Out-Null
    $lines.Add('Task:') | Out-Null
    $lines.Add([string](Get-WishlistPiProperty -Object $TaskDefinition -Name 'Body')) | Out-Null
    return ($lines -join "`n")
}

function Expand-WishlistPiArgument {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Argument,

        [Parameter(Mandatory = $true)]
        [object]$Route,

        [AllowNull()]
        [string]$TaskContext = '',

        [AllowNull()]
        [object]$TaskDefinition
    )

    $expanded = $Argument
    $sessionId = [string](Get-WishlistPiProperty -Object $Route -Name 'SessionId')
    $provider = [string](Get-WishlistPiProperty -Object $Route -Name 'Provider')
    $launcherTarget = [string](Get-WishlistPiProperty -Object $Route -Name 'LauncherTarget')
    $modelKey = [string](Get-WishlistPiProperty -Object $Route -Name 'ModelKey')
    $modelName = [string](Get-WishlistPiProperty -Object $Route -Name 'ModelName')
    $thinking = [string](Get-WishlistPiProperty -Object $Route -Name 'Thinking')
    $taskBody = if ($null -ne $TaskDefinition) {
        [string](Get-WishlistPiProperty -Object $TaskDefinition -Name 'Body')
    } else {
        ''
    }
    $taskInput = if ([string]::IsNullOrEmpty($TaskContext)) { $taskBody } else { $TaskContext }

    $expanded = $expanded.Replace('{sessionId}', $sessionId)
    $expanded = $expanded.Replace('{provider}', $provider)
    $expanded = $expanded.Replace('{launcherTarget}', $launcherTarget)
    $expanded = $expanded.Replace('{model}', $modelKey)
    $expanded = $expanded.Replace('{modelName}', $modelName)
    $expanded = $expanded.Replace('{thinking}', $thinking)
    $expanded = $expanded.Replace('{taskBody}', $taskInput)
    $expanded = $expanded.Replace('{taskContext}', $taskInput)
    $expanded = $expanded.Replace('{inputText}', $taskInput)
    return $expanded
}

function Get-WishlistPiMessageText {
    param(
        [AllowNull()]
        [object]$Message
    )

    if ($null -eq $Message) {
        return ''
    }

    $content = Get-WishlistPiProperty -Object $Message -Name 'content'
    if ($null -eq $content) {
        return ''
    }

    $parts = New-Object 'System.Collections.Generic.List[string]'
    foreach ($block in @($content)) {
        if ($null -eq $block) {
            continue
        }

        if ($block -is [string]) {
            $parts.Add([string]$block) | Out-Null
            continue
        }

        $blockType = [string](Get-WishlistPiProperty -Object $block -Name 'type')
        if ($blockType -ne 'text') {
            continue
        }

        $text = Get-WishlistPiProperty -Object $block -Name 'text'
        if ($null -ne $text) {
            $parts.Add([string]$text) | Out-Null
        }
    }

    return ($parts -join '')
}

function Get-WishlistPiUsageSummary {
    param(
        [AllowNull()]
        [object]$Usage
    )

    if ($null -eq $Usage) {
        return $null
    }

    $summary = [ordered]@{}
    $fields = @(
        @{ Source = 'input'; Target = 'InputTokens' },
        @{ Source = 'output'; Target = 'OutputTokens' },
        @{ Source = 'cacheRead'; Target = 'CacheReadTokens' },
        @{ Source = 'cacheWrite'; Target = 'CacheWriteTokens' },
        @{ Source = 'reasoning'; Target = 'ReasoningTokens' },
        @{ Source = 'totalTokens'; Target = 'TotalTokens' }
    )

    foreach ($field in $fields) {
        $value = Get-WishlistPiProperty -Object $Usage -Name $field.Source
        if ($null -ne $value) {
            $summary[$field.Target] = $value
        }
    }

    $cost = Get-WishlistPiProperty -Object $Usage -Name 'cost'
    if ($null -ne $cost) {
        $totalCost = Get-WishlistPiProperty -Object $cost -Name 'total'
        if ($null -ne $totalCost) {
            $summary['Cost'] = $totalCost
        }
    }

    if ($summary.Count -eq 0) {
        return $null
    }

    return [pscustomobject]$summary
}

function New-WishlistPiOutputDetailsRecord {
    [CmdletBinding()]
    param(
        [AllowNull()]
        [string]$Response = '',

        [AllowNull()]
        [object]$Usage = $null,

        [AllowNull()]
        [object]$UsageSummary = $null,

        [AllowNull()]
        [string]$SessionId = $null,

        [int]$JsonEventCount = 0,

        [AllowNull()]
        [string]$ParseWarning = $null,

        [bool]$TerminalCompletionEvidence = $false,

        [AllowNull()]
        [string]$TerminalEventType = $null,

        [AllowNull()]
        [object]$ObservedEventTypes = @(),

        [AllowNull()]
        [string]$FailureReason = $null
    )

    return [pscustomobject]@{
        Response                    = if ($null -eq $Response) { '' } else { $Response }
        Usage                       = $Usage
        UsageSummary                = $UsageSummary
        SessionId                   = $SessionId
        JsonEventCount              = $JsonEventCount
        ParseWarning                = $ParseWarning
        TerminalCompletionEvidence = $TerminalCompletionEvidence
        TerminalEventType           = $TerminalEventType
        ObservedEventTypes          = @($ObservedEventTypes)
        FailureReason               = $FailureReason
    }
}

function Get-WishlistPiOutputDetails {
    param(
        [AllowNull()]
        [string]$Output,

        [Parameter(Mandatory = $true)]
        [ValidateSet('text', 'json')]
        [string]$OutputMode
    )

    if ($OutputMode -eq 'text') {
        $textResponse = if ($null -eq $Output) { '' } else { $Output.Trim() }
        $hasTextCompletion = -not [string]::IsNullOrWhiteSpace($textResponse)
        $textFailureReason = if ($hasTextCompletion) {
            $null
        }
        else {
            'Pi text output was empty; no terminal completion evidence was observed.'
        }

        return New-WishlistPiOutputDetailsRecord `
            -Response $textResponse `
            -TerminalCompletionEvidence $hasTextCompletion `
            -TerminalEventType $(if ($hasTextCompletion) { 'text-output' } else { $null }) `
            -FailureReason $textFailureReason
    }

    $lines = @()
    if ($null -ne $Output) {
        $lines = @($Output -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    }
    if ($lines.Count -eq 0) {
        return New-WishlistPiOutputDetailsRecord `
            -ParseWarning 'Pi JSON output was empty; no structured response or usage summary was available.' `
            -FailureReason 'Pi JSON output was empty; no terminal agent_end completion event was observed.'
    }

    $events = New-Object 'System.Collections.Generic.List[object]'
    $observedEventTypes = New-Object 'System.Collections.Generic.List[string]'
    $observedEventTypeSet = New-Object 'System.Collections.Generic.HashSet[string]'
    $parseWarning = $null
    foreach ($line in $lines) {
        try {
            $event = $line | ConvertFrom-Json -ErrorAction Stop
        } catch {
            $parseWarning = 'Configured Pi JSON output contained malformed event data; terminal completion evidence is unavailable.'
            break
        }

        $eventType = [string](Get-WishlistPiProperty -Object $event -Name 'type')
        if ($null -eq $event -or [string]::IsNullOrWhiteSpace($eventType)) {
            $parseWarning = 'Configured Pi JSON output contained an event without a type; terminal completion evidence is unavailable.'
            break
        }

        $events.Add($event) | Out-Null
        if ($observedEventTypeSet.Add($eventType)) {
            $observedEventTypes.Add($eventType) | Out-Null
        }
    }

    $assistantTexts = New-Object 'System.Collections.Generic.List[string]'
    $latestDeltaText = New-Object 'System.Text.StringBuilder'
    $latestUsage = $null
    $sessionIds = New-Object 'System.Collections.Generic.List[string]'
    $sessionContextValid = $true
    $terminalEventCount = 0
    foreach ($event in $events) {
        $eventType = [string](Get-WishlistPiProperty -Object $event -Name 'type')
        if ($eventType -eq 'session') {
            $candidateSessionId = Get-WishlistPiProperty -Object $event -Name 'id'
            if ($null -eq $candidateSessionId -or [string]::IsNullOrWhiteSpace([string]$candidateSessionId)) {
                $sessionContextValid = $false
            }
            else {
                $candidateSessionId = [string]$candidateSessionId
                if ($sessionIds.Count -gt 0 -and -not $sessionIds.Contains($candidateSessionId)) {
                    $sessionContextValid = $false
                }

                if (-not $sessionIds.Contains($candidateSessionId)) {
                    $sessionIds.Add($candidateSessionId) | Out-Null
                }
            }
        }

        if ($eventType -eq 'agent_end') {
            $terminalEventCount++
        }

        $eventUsage = Get-WishlistPiProperty -Object $event -Name 'usage'
        if ($null -ne $eventUsage) {
            $latestUsage = $eventUsage
        }

        $message = Get-WishlistPiProperty -Object $event -Name 'message'
        if ($null -ne $message) {
            $role = [string](Get-WishlistPiProperty -Object $message -Name 'role')
            if ($role -eq 'assistant') {
                $messageText = Get-WishlistPiMessageText -Message $message
                if (-not [string]::IsNullOrWhiteSpace($messageText)) {
                    $assistantTexts.Add($messageText) | Out-Null
                }
            }

            $messageUsage = Get-WishlistPiProperty -Object $message -Name 'usage'
            if ($null -ne $messageUsage) {
                $latestUsage = $messageUsage
            }
        }

        if ($eventType -eq 'message_update') {
            $assistantMessageEvent = Get-WishlistPiProperty -Object $event -Name 'assistantMessageEvent'
            $assistantEventType = [string](Get-WishlistPiProperty -Object $assistantMessageEvent -Name 'type')
            if ($assistantEventType -eq 'text_delta') {
                $delta = Get-WishlistPiProperty -Object $assistantMessageEvent -Name 'delta'
                if ($null -ne $delta) {
                    $null = $latestDeltaText.Append([string]$delta)
                }
            }
        }

        if ($eventType -eq 'agent_end') {
            $messages = Get-WishlistPiProperty -Object $event -Name 'messages'
            foreach ($agentMessage in @($messages)) {
                $agentRole = [string](Get-WishlistPiProperty -Object $agentMessage -Name 'role')
                if ($agentRole -eq 'assistant') {
                    $agentText = Get-WishlistPiMessageText -Message $agentMessage
                    if (-not [string]::IsNullOrWhiteSpace($agentText)) {
                        $assistantTexts.Add($agentText) | Out-Null
                    }
                }
            }
        }
    }

    $response = if ($assistantTexts.Count -gt 0) {
        $assistantTexts[$assistantTexts.Count - 1]
    } elseif ($latestDeltaText.Length -gt 0) {
        $latestDeltaText.ToString()
    } else {
        ''
    }

    $terminalCompletionEvidence = (
        $null -eq $parseWarning -and
        $terminalEventCount -gt 0 -and
        $sessionIds.Count -eq 1 -and
        $sessionContextValid
    )

    $failureReason = $null
    if ($null -ne $parseWarning) {
        $failureReason = 'Pi JSON event stream could not be fully parsed; terminal completion evidence is unavailable.'
    }
    elseif ($terminalEventCount -eq 0) {
        $failureReason = "Pi JSON output contained $($events.Count) structured event(s) but no terminal agent_end completion event was observed."
    }
    elseif ($sessionIds.Count -eq 0) {
        $failureReason = 'Pi JSON output contained a terminal agent_end event but no valid session event.'
    }
    elseif (-not $sessionContextValid) {
        $failureReason = 'Pi JSON output contained conflicting or invalid session context; terminal completion evidence is not trustworthy.'
    }

    $semanticWarning = if ($terminalCompletionEvidence -or $null -ne $parseWarning) {
        $parseWarning
    }
    else {
        $failureReason
    }

    return New-WishlistPiOutputDetailsRecord `
        -Response $response.Trim() `
        -Usage $latestUsage `
        -UsageSummary (Get-WishlistPiUsageSummary -Usage $latestUsage) `
        -SessionId $(if ($sessionIds.Count -eq 1) { $sessionIds[0] } else { $null }) `
        -JsonEventCount $events.Count `
        -ParseWarning $semanticWarning `
        -TerminalCompletionEvidence $terminalCompletionEvidence `
        -TerminalEventType $(if ($terminalEventCount -gt 0) { 'agent_end' } else { $null }) `
        -ObservedEventTypes @($observedEventTypes) `
        -FailureReason $failureReason
}

function New-WishlistPiInvocation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TaskDefinition,

        [Parameter(Mandatory = $true)]
        [object]$Route,

        [Parameter(Mandatory = $true)]
        [object]$Config,

        [AllowEmptyString()]
        [string]$WorkingDirectory = '',

        [switch]$ProbeHelp
    )

    $launcherConfig = Get-WishlistPiProperty -Object $Config -Name 'launcher'
    $commandName = [string](Get-WishlistPiProperty -Object $launcherConfig -Name 'command')
    if ([string]::IsNullOrWhiteSpace($commandName)) {
        $commandName = 'pi'
    }

    $availability = Get-WishlistPiAvailability -CommandName $commandName -ProbeHelp:$ProbeHelp
    $configured = [bool](Get-WishlistPiProperty -Object $launcherConfig -Name 'configured')
    $inputMode = [string](Get-WishlistPiProperty -Object $launcherConfig -Name 'inputMode')
    if ([string]::IsNullOrWhiteSpace($inputMode)) {
        $inputMode = 'stdin'
    }
    $inputMode = $inputMode.Trim().ToLowerInvariant()
    $outputMode = [string](Get-WishlistPiProperty -Object $launcherConfig -Name 'outputMode')
    if ([string]::IsNullOrWhiteSpace($outputMode)) {
        $outputMode = 'text'
    }
    $outputMode = $outputMode.Trim().ToLowerInvariant()

    $taskContext = New-WishlistPiTaskContext -TaskDefinition $TaskDefinition -Route $Route -Config $Config
    $arguments = @()
    $configuredArguments = Get-WishlistPiProperty -Object $launcherConfig -Name 'arguments'
    if ($null -ne $configuredArguments) {
        foreach ($argument in @($configuredArguments)) {
            if ($null -eq $argument) {
                continue
            }
            $arguments += Expand-WishlistPiArgument -Argument ([string]$argument) -Route $Route -TaskContext $taskContext -TaskDefinition $TaskDefinition
        }
    }

    $base = [ordered]@{
        Status = 'READY'
        Command = $availability.Path
        CommandName = $commandName
        ResolvedCommandName = $availability.ResolvedCommandName
        Arguments = @($arguments)
        InputMode = $inputMode
        OutputMode = $outputMode
        InputText = $taskContext
        TaskContext = $taskContext
        WorkingDirectory = $WorkingDirectory
        SessionId = [string](Get-WishlistPiProperty -Object $Route -Name 'SessionId')
        ModelKey = [string](Get-WishlistPiProperty -Object $Route -Name 'ModelKey')
        ModelName = [string](Get-WishlistPiProperty -Object $Route -Name 'ModelName')
        Provider = [string](Get-WishlistPiProperty -Object $Route -Name 'Provider')
        LauncherTarget = [string](Get-WishlistPiProperty -Object $Route -Name 'LauncherTarget')
        Thinking = [string](Get-WishlistPiProperty -Object $Route -Name 'Thinking')
        ProbeHelp = [bool]$ProbeHelp
        Availability = $availability
        Reason = if ($ProbeHelp) { 'Verified Pi launcher invocation is ready.' } else { 'Pi launcher invocation shape is ready; live help probe is deferred until Apply.' }
    }

    if ($availability.Status -ne 'PI_AVAILABLE') {
        $base.Status = 'PI_NOT_CONFIGURED'
        $base.Reason = $availability.Reason
    } elseif (-not $configured) {
        $base.Status = 'PI_NOT_CONFIGURED'
        $base.Reason = 'Pi was found, but launcher.configured is false.'
    } elseif ($inputMode -notin @('stdin', 'argument')) {
        $base.Status = 'PI_NOT_CONFIGURED'
        $base.Reason = "Unsupported launcher.inputMode '$inputMode'; use 'stdin' or 'argument'."
    } elseif ($outputMode -notin @('text', 'json')) {
        $base.Status = 'PI_NOT_CONFIGURED'
        $base.Reason = "Unsupported launcher.outputMode '$outputMode'; use 'text' or 'json'."
    } elseif ($ProbeHelp -and $availability.HelpProbeSucceeded -ne $true) {
        $base.Status = 'PI_NOT_CONFIGURED'
        $base.Reason = 'Pi was found, but its documented --help probe failed; live invocation remains blocked.'
    }

    return [pscustomobject]$base
}

function ConvertTo-WishlistProcessArgument {
    param([Parameter(Mandatory = $true)][string]$Value)

    if ($Value.Length -eq 0) {
        return '""'
    }

    if ($Value -notmatch '[\s"]') {
        return $Value
    }

    $builder = New-Object System.Text.StringBuilder
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes++
            continue
        }

        if ($character -eq '"') {
            for ($index = 0; $index -lt (($backslashes * 2) + 1); $index++) {
                $null = $builder.Append('\')
            }
            $null = $builder.Append('"')
            $backslashes = 0
            continue
        }

        for ($index = 0; $index -lt $backslashes; $index++) {
            $null = $builder.Append('\')
        }
        $backslashes = 0
        $null = $builder.Append($character)
    }

    for ($index = 0; $index -lt ($backslashes * 2); $index++) {
        $null = $builder.Append('\')
    }

    return '"' + $builder.ToString() + '"'
}

function Invoke-WishlistPi {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TaskDefinition,

        [Parameter(Mandatory = $true)]
        [object]$Route,

        [Parameter(Mandatory = $true)]
        [object]$Config,

        [AllowEmptyString()]
        [string]$WorkingDirectory = '',

        [AllowNull()]
        [scriptblock]$ProcessStartedCallback = $null,

        [switch]$DryRun
    )

    $invocation = New-WishlistPiInvocation -TaskDefinition $TaskDefinition -Route $Route -Config $Config -WorkingDirectory $WorkingDirectory -ProbeHelp:(-not $DryRun)
    if ($DryRun) {
        return [pscustomobject]@{
            Status = 'PASS'
            PiStatus = if ($invocation.Status -eq 'READY') { 'DRY_RUN_READY' } else { $invocation.Status }
            Reason = 'Dry-run only; no Pi process or help probe was started.'
            Started = $false
            ExitCode = $null
            Invocation = $invocation
        }
    }

    if ($invocation.Status -ne 'READY') {
        return [pscustomobject]@{
            Status = 'INFRA'
            PiStatus = $invocation.Status
            Reason = $invocation.Reason
            Started = $false
            ExitCode = $null
            Invocation = $invocation
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($invocation.WorkingDirectory)) {
        if (-not (Test-Path -LiteralPath $invocation.WorkingDirectory -PathType Container)) {
            return [pscustomobject]@{
                Status = 'INFRA'
                PiStatus = 'PI_LAUNCH_FAILED'
                Reason = "Working directory '$($invocation.WorkingDirectory)' does not exist."
                Started = $false
                ExitCode = $null
                Invocation = $invocation
            }
        }
    }

    $process = New-Object System.Diagnostics.Process
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $invocation.Command
    $startInfo.Arguments = ((@($invocation.Arguments) | ForEach-Object { ConvertTo-WishlistProcessArgument -Value ([string]$_) }) -join ' ')
    if (-not [string]::IsNullOrWhiteSpace($invocation.WorkingDirectory)) {
        $startInfo.WorkingDirectory = $invocation.WorkingDirectory
    }
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process.StartInfo = $startInfo

    try {
        $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
        if (($null -eq $startInfo.PSObject.Properties['StandardOutputEncoding']) -or ($null -eq $startInfo.PSObject.Properties['StandardErrorEncoding'])) {
            throw 'The current .NET runtime does not expose explicit standard stream encoding.'
        }
        $startInfo.StandardOutputEncoding = $utf8WithoutBom
        $startInfo.StandardErrorEncoding = $utf8WithoutBom

        if (-not $process.Start()) {
            throw 'Process.Start returned false.'
        }
        if ($null -ne $ProcessStartedCallback) {
            try {
                & $ProcessStartedCallback ([int]$process.Id)
            } catch {
                # Lifecycle observability is secondary to the actual Pi run.
            }
        }

        if ($invocation.InputMode -eq 'argument') {
            $process.StandardInput.Close()
        } else {
            $process.StandardInput.Write($invocation.InputText)
            $process.StandardInput.Close()
        }

        $standardOutput = $process.StandardOutput.ReadToEnd()
        $standardError = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        $exitCode = [int]$process.ExitCode
        $outputDetails = Get-WishlistPiOutputDetails -Output $standardOutput -OutputMode $invocation.OutputMode
        $hasTerminalCompletion = [bool]$outputDetails.TerminalCompletionEvidence
        $status = if ($exitCode -ne 0) {
            'FAIL'
        }
        elseif (-not $hasTerminalCompletion) {
            'FAIL'
        }
        else {
            'PASS'
        }

        $piStatus = if ($exitCode -ne 0) {
            'PI_EXECUTED'
        }
        elseif (-not $hasTerminalCompletion) {
            'PI_PROTOCOL_INCOMPLETE'
        }
        else {
            'PI_EXECUTED'
        }

        $failureReason = if ($exitCode -ne 0) {
            'Pi process returned a non-zero exit code.'
        }
        elseif (-not $hasTerminalCompletion) {
            [string]$outputDetails.FailureReason
        }
        else {
            $null
        }

        $reason = if ($exitCode -ne 0) {
            'Pi process returned a non-zero exit code.'
        }
        elseif (-not $hasTerminalCompletion) {
            $failureReason
        }
        else {
            'Pi process completed successfully with terminal completion evidence.'
        }

        if ([string]::IsNullOrWhiteSpace($reason)) {
            $reason = 'Pi process did not provide verifiable terminal completion evidence.'
        }

        return [pscustomobject]@{
            Status = $status
            PiStatus = $piStatus
            Reason = $reason
            Started = $true
            ExitCode = $exitCode
            StandardOutput = $standardOutput
            StandardError = $standardError
            Response = $outputDetails.Response
            Usage = $outputDetails.Usage
            UsageSummary = $outputDetails.UsageSummary
            PiSessionId = $outputDetails.SessionId
            JsonEventCount = $outputDetails.JsonEventCount
            OutputParseWarning = $outputDetails.ParseWarning
            TerminalCompletionEvidence = $hasTerminalCompletion
            TerminalEventType = $outputDetails.TerminalEventType
            ObservedEventTypes = $outputDetails.ObservedEventTypes
            FailureReason = $failureReason
            Invocation = $invocation
        }
    } catch {
        return [pscustomobject]@{
            Status = 'INFRA'
            PiStatus = 'PI_LAUNCH_FAILED'
            Reason = $_.Exception.Message
            Started = $false
            ExitCode = $null
            Invocation = $invocation
        }
    } finally {
        $process.Dispose()
    }
}

Export-ModuleMember -Function Get-WishlistPiAvailability, New-WishlistPiInvocation, Invoke-WishlistPi
