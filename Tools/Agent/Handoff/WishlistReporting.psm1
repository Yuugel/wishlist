Set-StrictMode -Version 2.0

$script:WishlistGitHubRepository = 'Yuugel/wishlist'
$script:WishlistReportMarker = '<!-- wishlist-agent-report:v1 -->'

function Get-WishlistReportingProperty {
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

function Get-WishlistStableUniqueStrings {
    [CmdletBinding()]
    param(
        [AllowNull()]
        [object[]]$Values
    )

    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    $ordered = New-Object 'System.Collections.Generic.List[string]'
    foreach ($value in @($Values)) {
        if ($null -eq $value) { continue }
        $text = ([string]$value).Trim()
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        if ($seen.Add($text)) {
            $ordered.Add($text) | Out-Null
        }
    }
    return [string[]]$ordered.ToArray()
}

function ConvertTo-BoundedWishlistDiagnostic {
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

function Get-WishlistReportDirectory {
    [CmdletBinding()]
    param(
        [AllowEmptyString()]
        [string]$ReportDirectory = ''
    )

    if (-not [string]::IsNullOrWhiteSpace($ReportDirectory)) {
        return [System.IO.Path]::GetFullPath($ReportDirectory)
    }

    $localAppData = [Environment]::GetEnvironmentVariable('LOCALAPPDATA')
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    }

    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        $home = [Environment]::GetEnvironmentVariable('USERPROFILE')
        if ([string]::IsNullOrWhiteSpace($home)) {
            $home = [Environment]::GetEnvironmentVariable('HOME')
        }
        if ([string]::IsNullOrWhiteSpace($home)) {
            $home = [System.IO.Path]::GetTempPath()
        }
        $localAppData = Join-Path $home '.local'
        $localAppData = Join-Path $localAppData 'share'
    }

    $applicationDirectory = Join-Path $localAppData 'Wishlist'
    return (Join-Path $applicationDirectory 'AgentReports')
}

function Test-WishlistPositiveTicketNumber {
    [CmdletBinding()]
    param(
        [AllowNull()]
        [object]$Ticket
    )

    if ($null -eq $Ticket) {
        return $false
    }

    $value = [string]$Ticket
    # GitHub issue numbers are decimal identifiers. Keep the accepted shape
    # deliberately narrow and bounded before it can become a process argument.
    return ($value -match '^[1-9][0-9]{0,19}$')
}

function Get-WishlistReportSessionId {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Route,

        [Parameter(Mandatory = $true)]
        [object]$LaunchResult
    )

    $observed = [string](Get-WishlistReportingProperty -Object $LaunchResult -Name 'PiSessionId')
    if (-not [string]::IsNullOrWhiteSpace($observed)) {
        return $observed
    }

    $selected = [string](Get-WishlistReportingProperty -Object $Route -Name 'SessionId')
    if (-not [string]::IsNullOrWhiteSpace($selected)) {
        return $selected
    }

    return $null
}

function Get-WishlistReportUsage {
    param(
        [Parameter(Mandatory = $true)]
        [object]$LaunchResult
    )

    $source = Get-WishlistReportingProperty -Object $LaunchResult -Name 'UsageSummary'
    if ($null -eq $source) {
        return $null
    }

    $usage = [ordered]@{}
    foreach ($name in @(
        'InputTokens',
        'OutputTokens',
        'CacheReadTokens',
        'CacheWriteTokens',
        'ReasoningTokens',
        'TotalTokens',
        'Cost'
    )) {
        $value = Get-WishlistReportingProperty -Object $source -Name $name
        if ($null -ne $value) {
            $usage[$name] = $value
        }
    }

    if ($usage.Count -eq 0) {
        return $null
    }

    return [pscustomobject]$usage
}

function New-WishlistAgentReportRecord {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TaskDefinition,

        [Parameter(Mandatory = $true)]
        [object]$Route,

        [Parameter(Mandatory = $true)]
        [object]$LaunchResult,

        [AllowEmptyString()]
        [string]$RunStatus = '',

        [AllowEmptyString()]
        [string]$TimestampUtc = '',

        [AllowEmptyString()]
        [string]$ReportId = ''
    )

    if ([string]::IsNullOrWhiteSpace($RunStatus)) {
        $RunStatus = [string](Get-WishlistReportingProperty -Object $LaunchResult -Name 'Status')
    }
    if ([string]::IsNullOrWhiteSpace($RunStatus)) {
        $RunStatus = 'UNKNOWN'
    }
    if ([string]::IsNullOrWhiteSpace($TimestampUtc)) {
        $TimestampUtc = (Get-Date).ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture)
    }
    if ([string]::IsNullOrWhiteSpace($ReportId)) {
        $ReportId = [Guid]::NewGuid().ToString('N')
    }

    $ticket = [string](Get-WishlistReportingProperty -Object $TaskDefinition -Name 'Ticket')
    $modelName = [string](Get-WishlistReportingProperty -Object $Route -Name 'ModelName')
    $modelKey = [string](Get-WishlistReportingProperty -Object $Route -Name 'ModelKey')
    $provider = [string](Get-WishlistReportingProperty -Object $Route -Name 'Provider')
    $thinking = [string](Get-WishlistReportingProperty -Object $Route -Name 'Thinking')
    $response = [string](Get-WishlistReportingProperty -Object $LaunchResult -Name 'Response')
    $launcherError = Get-WishlistReportingProperty -Object $LaunchResult -Name 'LauncherError'
    if ([string]::IsNullOrWhiteSpace([string]$launcherError)) {
        $launcherError = Get-WishlistReportingProperty -Object $LaunchResult -Name 'StandardError'
    }
    $observedEventTypes = Get-WishlistStableUniqueStrings -Values @(
        Get-WishlistReportingProperty -Object $LaunchResult -Name 'ObservedEventTypes'
    )
    $dependencies = Get-WishlistReportingProperty -Object $TaskDefinition -Name 'Dependencies'
    $dependencyArray = [int64[]]@()
    if ($null -ne $dependencies) {
        $dependencyValues = @($dependencies)
        if ($dependencyValues.Count -gt 0) { $dependencyArray = [int64[]]$dependencyValues }
    }

    return [pscustomobject][ordered]@{
        SchemaVersion = 1
        Marker = $script:WishlistReportMarker
        ReportId = $ReportId
        Repository = $script:WishlistGitHubRepository
        Status = $RunStatus
        RunStatus = $RunStatus
        Ticket = if ([string]::IsNullOrWhiteSpace($ticket)) { $null } else { $ticket }
        Dependencies = $dependencyArray
        ModelName = if ([string]::IsNullOrWhiteSpace($modelName)) { $null } else { $modelName }
        ModelKey = if ([string]::IsNullOrWhiteSpace($modelKey)) { $null } else { $modelKey }
        Provider = if ([string]::IsNullOrWhiteSpace($provider)) { $null } else { $provider }
        ThinkingLevel = if ([string]::IsNullOrWhiteSpace($thinking)) { $null } else { $thinking }
        Thinking = if ([string]::IsNullOrWhiteSpace($thinking)) { $null } else { $thinking }
        PiSessionId = Get-WishlistReportSessionId -Route $Route -LaunchResult $LaunchResult
        TimestampUtc = $TimestampUtc
        GeneratedAtUtc = $TimestampUtc
        Usage = Get-WishlistReportUsage -LaunchResult $LaunchResult
        PiStatus = [string](Get-WishlistReportingProperty -Object $LaunchResult -Name 'PiStatus')
        ProcessExitCode = Get-WishlistReportingProperty -Object $LaunchResult -Name 'ExitCode'
        JsonEventCount = Get-WishlistReportingProperty -Object $LaunchResult -Name 'JsonEventCount'
        OutputParseWarning = [string](Get-WishlistReportingProperty -Object $LaunchResult -Name 'OutputParseWarning')
        ObservedSessionId = [string](Get-WishlistReportingProperty -Object $LaunchResult -Name 'PiSessionId')
        TerminalCompletionEvidence = [bool](Get-WishlistReportingProperty -Object $LaunchResult -Name 'TerminalCompletionEvidence')
        TerminalEventType = [string](Get-WishlistReportingProperty -Object $LaunchResult -Name 'TerminalEventType')
        ObservedEventTypes = $observedEventTypes
        FailureReason = [string](Get-WishlistReportingProperty -Object $LaunchResult -Name 'FailureReason')
        LauncherError = ConvertTo-BoundedWishlistDiagnostic -Value $launcherError
        Response = if ($null -eq $response) { '' } else { $response }
    }
}

function ConvertTo-WishlistReportValueText {
    param(
        [AllowNull()]
        [object]$Value
    )

    if ($null -eq $Value) {
        return ''
    }

    if ($Value -is [System.IFormattable]) {
        return $Value.ToString($null, [Globalization.CultureInfo]::InvariantCulture)
    }

    return [string]$Value
}

function Get-WishlistReportUsageText {
    param(
        [AllowNull()]
        [object]$Usage
    )

    if ($null -eq $Usage) {
        return 'not reported'
    }

    $parts = New-Object 'System.Collections.Generic.List[string]'
    foreach ($name in @(
        'InputTokens',
        'OutputTokens',
        'CacheReadTokens',
        'CacheWriteTokens',
        'ReasoningTokens',
        'TotalTokens',
        'Cost'
    )) {
        $value = Get-WishlistReportingProperty -Object $Usage -Name $name
        if ($null -ne $value) {
            $parts.Add(('{0}={1}' -f $name, (ConvertTo-WishlistReportValueText -Value $value))) | Out-Null
        }
    }

    if ($parts.Count -eq 0) {
        return 'not reported'
    }

    return ($parts -join '; ')
}

function Get-WishlistMarkdownFence {
    param(
        [AllowNull()]
        [string]$Text
    )

    $longestRun = 0
    if ($null -ne $Text) {
        foreach ($match in [regex]::Matches($Text, '`+')) {
            if ($match.Length -gt $longestRun) {
                $longestRun = $match.Length
            }
        }
    }

    $fenceLength = [Math]::Max(3, $longestRun + 1)
    $builder = New-Object System.Text.StringBuilder
    for ($index = 0; $index -lt $fenceLength; $index++) {
        $null = $builder.Append('`')
    }
    return $builder.ToString()
}

function Format-WishlistGitHubReport {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Report
    )

    $lines = New-Object 'System.Collections.Generic.List[string]'
    $lines.Add($script:WishlistReportMarker) | Out-Null
    $lines.Add('## Wishlist agent report') | Out-Null
    $lines.Add(('- **Run status:** `{0}`' -f [string](Get-WishlistReportingProperty -Object $Report -Name 'RunStatus'))) | Out-Null
    $lines.Add(('- **Ticket:** `#{0}`' -f [string](Get-WishlistReportingProperty -Object $Report -Name 'Ticket'))) | Out-Null
    $lines.Add(('- **Model:** `{0}` (`{1}`)' -f [string](Get-WishlistReportingProperty -Object $Report -Name 'ModelName'), [string](Get-WishlistReportingProperty -Object $Report -Name 'ModelKey'))) | Out-Null
    $lines.Add(('- **Provider:** `{0}`' -f [string](Get-WishlistReportingProperty -Object $Report -Name 'Provider'))) | Out-Null
    $lines.Add(('- **Thinking level:** `{0}`' -f [string](Get-WishlistReportingProperty -Object $Report -Name 'ThinkingLevel'))) | Out-Null
    $lines.Add(('- **Pi session:** `{0}`' -f [string](Get-WishlistReportingProperty -Object $Report -Name 'PiSessionId'))) | Out-Null
    $lines.Add(('- **Observed session:** `{0}`' -f [string](Get-WishlistReportingProperty -Object $Report -Name 'ObservedSessionId'))) | Out-Null
    $lines.Add(('- **UTC:** `{0}`' -f [string](Get-WishlistReportingProperty -Object $Report -Name 'TimestampUtc'))) | Out-Null
    $lines.Add(('- **Usage:** `{0}`' -f (Get-WishlistReportUsageText -Usage (Get-WishlistReportingProperty -Object $Report -Name 'Usage')))) | Out-Null
    $lines.Add('') | Out-Null
    $lines.Add('### Pi completion diagnostics') | Out-Null
    $lines.Add(('- **Pi status:** `{0}`' -f [string](Get-WishlistReportingProperty -Object $Report -Name 'PiStatus'))) | Out-Null
    $lines.Add(('- **Process exit code:** `{0}`' -f (ConvertTo-WishlistReportValueText -Value (Get-WishlistReportingProperty -Object $Report -Name 'ProcessExitCode')))) | Out-Null
    $lines.Add(('- **JSON event count:** `{0}`' -f (ConvertTo-WishlistReportValueText -Value (Get-WishlistReportingProperty -Object $Report -Name 'JsonEventCount')))) | Out-Null
    $lines.Add(('- **Terminal completion evidence:** `{0}`' -f ([bool](Get-WishlistReportingProperty -Object $Report -Name 'TerminalCompletionEvidence')))) | Out-Null
    $lines.Add(('- **Terminal event:** `{0}`' -f [string](Get-WishlistReportingProperty -Object $Report -Name 'TerminalEventType'))) | Out-Null

    $eventTypes = @(Get-WishlistStableUniqueStrings -Values @(
        Get-WishlistReportingProperty -Object $Report -Name 'ObservedEventTypes'
    ))
    if ($eventTypes.Count -gt 0) {
        $lines.Add(('- **Observed event types:** `{0}`' -f ($eventTypes -join ', '))) | Out-Null
    }

    $parseWarning = [string](Get-WishlistReportingProperty -Object $Report -Name 'OutputParseWarning')
    if (-not [string]::IsNullOrWhiteSpace($parseWarning)) {
        $lines.Add(('- **Output parse warning:** `{0}`' -f $parseWarning)) | Out-Null
    }

    $failureReason = [string](Get-WishlistReportingProperty -Object $Report -Name 'FailureReason')
    if (-not [string]::IsNullOrWhiteSpace($failureReason)) {
        $lines.Add(('- **Failure reason:** `{0}`' -f $failureReason)) | Out-Null
    }

    $launcherError = [string](Get-WishlistReportingProperty -Object $Report -Name 'LauncherError')
    if (-not [string]::IsNullOrWhiteSpace($launcherError)) {
        $lines.Add('') | Out-Null
        $lines.Add('### Launcher stderr (bounded)') | Out-Null
        $stderrFence = Get-WishlistMarkdownFence -Text $launcherError
        $lines.Add($stderrFence) | Out-Null
        $lines.Add($launcherError) | Out-Null
        $lines.Add($stderrFence) | Out-Null
    }

    $lines.Add('') | Out-Null
    $lines.Add('### Final Pi/Agent response') | Out-Null

    $response = [string](Get-WishlistReportingProperty -Object $Report -Name 'Response')
    $fence = Get-WishlistMarkdownFence -Text $response
    $lines.Add($fence) | Out-Null
    if ([string]::IsNullOrWhiteSpace($response)) {
        $lines.Add('(Pi returned no final assistant response.)') | Out-Null
    } else {
        # Keep arbitrary assistant Markdown and quotes as data inside a fence.
        # The fence length is chosen above the longest backtick run in the text.
        $lines.Add($response) | Out-Null
    }
    $lines.Add($fence) | Out-Null

    return (($lines -join "`n") + "`n")
}

function Save-WishlistAgentReport {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$Report,

        [AllowEmptyString()]
        [string]$ReportDirectory = ''
    )

    $directory = Get-WishlistReportDirectory -ReportDirectory $ReportDirectory
    $temporaryPath = $null
    try {
        New-Item -ItemType Directory -Force -Path $directory -ErrorAction Stop | Out-Null
        $timestamp = [string](Get-WishlistReportingProperty -Object $Report -Name 'TimestampUtc')
        if ([string]::IsNullOrWhiteSpace($timestamp)) {
            $timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
        } else {
            $timestamp = (Get-Date $timestamp).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
        }
        $ticket = [string](Get-WishlistReportingProperty -Object $Report -Name 'Ticket')
        $ticketPart = if (Test-WishlistPositiveTicketNumber -Ticket $ticket) { $ticket } else { 'unticketed' }
        $reportId = [string](Get-WishlistReportingProperty -Object $Report -Name 'ReportId')
        if ([string]::IsNullOrWhiteSpace($reportId)) {
            $reportId = [Guid]::NewGuid().ToString('N')
        }
        $fileId = $reportId -replace '[^A-Za-z0-9-]', '-'
        if ([string]::IsNullOrWhiteSpace($fileId)) {
            $fileId = [Guid]::NewGuid().ToString('N')
        }

        $fileName = 'wishlist-agent-report-{0}-{1}-{2}.json' -f $timestamp, $ticketPart, $fileId
        $path = Join-Path $directory $fileName
        $temporaryPath = $path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
        $json = $Report | ConvertTo-Json -Depth 12
        $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($temporaryPath, $json, $utf8WithoutBom)
        Move-Item -LiteralPath $temporaryPath -Destination $path -Force -ErrorAction Stop | Out-Null
        $temporaryPath = $null
        return $path
    } catch {
        if (-not [string]::IsNullOrWhiteSpace($temporaryPath)) {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
        throw "Unable to save the local agent report: $($_.Exception.Message)"
    }
}

function Get-WishlistGitHubUserInstallPath {
    $localAppData = [Environment]::GetEnvironmentVariable('LOCALAPPDATA')
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    }
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        return $null
    }

    $candidatePath = Join-Path $localAppData 'Programs\GitHub CLI\bin\gh.exe'
    if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
        return $null
    }

    return (Get-Item -LiteralPath $candidatePath -ErrorAction Stop).FullName
}

function Resolve-WishlistGitHubCommand {
    param(
        [AllowEmptyString()]
        [string]$CommandPath = ''
    )

    $commandName = if ([string]::IsNullOrWhiteSpace($CommandPath)) { 'gh' } else { $CommandPath }
    $command = $null
    try {
        $command = Get-Command -Name $commandName -ErrorAction Stop
    } catch {
        $command = $null
    }

    if ($null -ne $command -and $command.CommandType -eq 'Application') {
        $path = if (-not [string]::IsNullOrWhiteSpace([string]$command.Source)) {
            [string]$command.Source
        } else {
            [string]$command.Definition
        }
        if (-not [string]::IsNullOrWhiteSpace($path)) {
            return [pscustomobject]@{
                Name = $commandName
                Path = $path
            }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($CommandPath)) {
        return $null
    }

    $userInstallPath = Get-WishlistGitHubUserInstallPath
    if ([string]::IsNullOrWhiteSpace($userInstallPath)) {
        return $null
    }

    return [pscustomobject]@{
        Name = 'gh'
        Path = $userInstallPath
    }
}

function ConvertTo-WishlistReportingProcessArgument {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

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

function Invoke-WishlistReportingCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [AllowEmptyString()]
        [string]$WorkingDirectory = ''
    )

    $process = New-Object System.Diagnostics.Process
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = ((@($Arguments) | ForEach-Object {
        ConvertTo-WishlistReportingProcessArgument -Value ([string]$_)
    }) -join ' ')
    if (-not [string]::IsNullOrWhiteSpace($WorkingDirectory)) {
        $startInfo.WorkingDirectory = $WorkingDirectory
    }
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.EnvironmentVariables['GH_PROMPT_DISABLED'] = '1'
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process.StartInfo = $startInfo

    try {
        if (-not $process.Start()) {
            throw 'Process.Start returned false.'
        }
        $standardOutputTask = $process.StandardOutput.ReadToEndAsync()
        $standardErrorTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) {
            try {
                $process.Kill()
            } catch {
                # The process may have exited between the timeout and Kill.
            }
            throw 'GitHub CLI timed out after 30 seconds.'
        }
        $process.WaitForExit()
        return [pscustomobject]@{
            ExitCode = [int]$process.ExitCode
            StandardOutput = $standardOutputTask.GetAwaiter().GetResult()
            StandardError = $standardErrorTask.GetAwaiter().GetResult()
        }
    } catch {
        throw "GitHub CLI could not be started: $($_.Exception.Message)"
    } finally {
        $process.Dispose()
    }
}

function New-WishlistReportDeliveryResult {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Status,

        [Parameter(Mandatory = $true)]
        [string]$Delivery,

        [Parameter(Mandatory = $true)]
        [object]$Report,

        [AllowNull()]
        [string]$LocalPath,

        [AllowNull()]
        [string]$Message,

        [AllowNull()]
        [string]$Warning
    )

    return [pscustomobject]@{
        Status = $Status
        Delivery = $Delivery
        DeliveryStatus = $Status
        Repository = [string](Get-WishlistReportingProperty -Object $Report -Name 'Repository')
        IssueNumber = [string](Get-WishlistReportingProperty -Object $Report -Name 'Ticket')
        Ticket = [string](Get-WishlistReportingProperty -Object $Report -Name 'Ticket')
        ReportId = [string](Get-WishlistReportingProperty -Object $Report -Name 'ReportId')
        TimestampUtc = [string](Get-WishlistReportingProperty -Object $Report -Name 'TimestampUtc')
        LocalPath = $LocalPath
        Message = $Message
        Warning = $Warning
    }
}

function Save-WishlistFallbackReport {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Report,

        [AllowEmptyString()]
        [string]$ReportDirectory = '',

        [Parameter(Mandatory = $true)]
        [string]$Status,

        [Parameter(Mandatory = $true)]
        [string]$Message,

        [AllowNull()]
        [string]$Warning
    )

    try {
        $localData = [ordered]@{}
        foreach ($property in @($Report.PSObject.Properties)) {
            $localData[$property.Name] = $property.Value
        }
        $localData['DeliveryStatus'] = $Status
        $localData['DeliveryMessage'] = $Message
        $localData['DeliveryWarning'] = $Warning
        $localReport = [pscustomobject]$localData
        $localPath = Save-WishlistAgentReport -Report $localReport -ReportDirectory $ReportDirectory
        return New-WishlistReportDeliveryResult `
            -Status $Status `
            -Delivery 'LOCAL' `
            -Report $Report `
            -LocalPath $localPath `
            -Message $Message `
            -Warning $Warning
    } catch {
        $saveWarning = if ([string]::IsNullOrWhiteSpace($Warning)) {
            $_.Exception.Message
        } else {
            '{0} Local fallback also failed: {1}' -f $Warning, $_.Exception.Message
        }
        return New-WishlistReportDeliveryResult `
            -Status 'WARNING' `
            -Delivery 'NONE' `
            -Report $Report `
            -LocalPath $null `
            -Message 'The agent run completed, but no report destination succeeded.' `
            -Warning $saveWarning
    }
}

function Publish-WishlistAgentReport {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TaskDefinition,

        [Parameter(Mandatory = $true)]
        [object]$Route,

        [Parameter(Mandatory = $true)]
        [object]$LaunchResult,

        [AllowEmptyString()]
        [string]$RunStatus = '',

        [AllowEmptyString()]
        [string]$ReportDirectory = '',

        [AllowEmptyString()]
        [string]$GitHubCommandPath = '',

        # Tests can replace the process boundary with a result-producing
        # scriptblock. Production uses the non-shell ProcessStartInfo path.
        [AllowNull()]
        [scriptblock]$CommandRunner = $null
    )

    $report = New-WishlistAgentReportRecord `
        -TaskDefinition $TaskDefinition `
        -Route $Route `
        -LaunchResult $LaunchResult `
        -RunStatus $RunStatus

    $ticket = [string](Get-WishlistReportingProperty -Object $report -Name 'Ticket')
    if (-not (Test-WishlistPositiveTicketNumber -Ticket $ticket)) {
        return Save-WishlistFallbackReport `
            -Report $report `
            -ReportDirectory $ReportDirectory `
            -Status 'LOCAL' `
            -Message 'No valid positive numeric ticket was available; report was saved locally.' `
            -Warning $null
    }

    $command = $null
    if ($null -eq $CommandRunner) {
        $command = Resolve-WishlistGitHubCommand -CommandPath $GitHubCommandPath
        if ($null -eq $command) {
            return Save-WishlistFallbackReport `
                -Report $report `
                -ReportDirectory $ReportDirectory `
                -Status 'WARNING' `
                -Message 'GitHub delivery was unavailable; report was saved locally.' `
                -Warning 'GitHub CLI gh is not installed or is not a directly launchable application.'
        }
    } else {
        $command = [pscustomobject]@{
            Name = if ([string]::IsNullOrWhiteSpace($GitHubCommandPath)) { 'gh' } else { $GitHubCommandPath }
            Path = if ([string]::IsNullOrWhiteSpace($GitHubCommandPath)) { 'gh' } else { $GitHubCommandPath }
        }
    }

    $bodyPath = $null
    try {
        $directory = Get-WishlistReportDirectory -ReportDirectory $ReportDirectory
        New-Item -ItemType Directory -Force -Path $directory -ErrorAction Stop | Out-Null
        $bodyPath = Join-Path $directory ('.wishlist-agent-report-' + [Guid]::NewGuid().ToString('N') + '.md')
        $body = Format-WishlistGitHubReport -Report $report
        $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($bodyPath, $body, $utf8WithoutBom)

        $arguments = @(
            'issue',
            'comment',
            $ticket,
            '--repo',
            $script:WishlistGitHubRepository,
            '--body-file',
            $bodyPath
        )

        if ($null -eq $CommandRunner) {
            $commandResult = Invoke-WishlistReportingCommand `
                -FilePath $command.Path `
                -Arguments $arguments `
                -WorkingDirectory $directory
        } else {
            $runnerOutput = @(& $CommandRunner `
                -FilePath $command.Path `
                -Arguments $arguments `
                -WorkingDirectory $directory)
            if ($runnerOutput.Count -eq 0) {
                throw 'The GitHub reporting test seam returned no command result.'
            }
            $commandResult = $runnerOutput[$runnerOutput.Count - 1]
        }

        $exitCodeValue = Get-WishlistReportingProperty -Object $commandResult -Name 'ExitCode'
        if ($null -eq $exitCodeValue) {
            throw 'GitHub reporting command returned no exit code.'
        }
        $exitCode = [int]$exitCodeValue
        if ($exitCode -ne 0) {
            throw ('GitHub CLI returned exit code {0}.' -f $exitCode)
        }

        return New-WishlistReportDeliveryResult `
            -Status 'POSTED' `
            -Delivery 'GITHUB' `
            -Report $report `
            -LocalPath $null `
            -Message ('Posted to GitHub issue #{0}.' -f $ticket) `
            -Warning $null
    } catch {
        $warning = 'GitHub delivery failed: ' + $_.Exception.Message
        return Save-WishlistFallbackReport `
            -Report $report `
            -ReportDirectory $ReportDirectory `
            -Status 'WARNING' `
            -Message 'GitHub delivery failed; report was saved locally.' `
            -Warning $warning
    } finally {
        if (-not [string]::IsNullOrWhiteSpace($bodyPath)) {
            Remove-Item -LiteralPath $bodyPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function New-WishlistSkippedReport {
    [CmdletBinding()]
    param(
        [AllowEmptyString()]
        [string]$Reason = 'No terminal Pi run was available; no report was delivered.'
    )

    return [pscustomobject]@{
        Status = 'SKIPPED'
        Delivery = 'NONE'
        DeliveryStatus = 'SKIPPED'
        Repository = $script:WishlistGitHubRepository
        IssueNumber = $null
        Ticket = $null
        ReportId = $null
        TimestampUtc = $null
        LocalPath = $null
        Message = $Reason
        Warning = $null
    }
}

Export-ModuleMember -Function Get-WishlistReportDirectory, Test-WishlistPositiveTicketNumber, New-WishlistAgentReportRecord, Format-WishlistGitHubReport, Save-WishlistAgentReport, Publish-WishlistAgentReport, New-WishlistSkippedReport
