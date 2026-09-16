[CmdletBinding(DefaultParameterSetName = 'File')]
param(
    [Parameter(ParameterSetName = 'File', Mandatory = $true)][string]$TaskFile,
    [string]$RepoPath = '',
    [switch]$Json,
    [switch]$NoProcessExit,
    [string]$LifecyclePath = '',
    [string]$RoutingConfigPath = '',
    [string]$ReportDirectory = '',
    [string]$GitHubCommandPath = '',
    [switch]$AllowAstra,
    [switch]$Apply
)

$result = [pscustomobject]@{
    Status = 'FAIL'
    Mode = if ($Apply) { 'APPLY' } else { 'DRY_RUN' }
    Source = 'FILE'
    Reason = 'Pi exited with code 0 but no terminal agent_end completion evidence was observed.'
    PiStatus = 'PI_PROTOCOL_INCOMPLETE'
    Forwarded = [bool]$Apply
    Launched = [bool]$Apply
    Launch = [pscustomobject]@{
        Status = 'FAIL'
        PiStatus = 'PI_PROTOCOL_INCOMPLETE'
        Reason = 'Pi JSON output was empty; no terminal agent_end completion event was observed.'
        Started = [bool]$Apply
        ExitCode = 0
        PiSessionId = ''
        JsonEventCount = 0
        OutputParseWarning = 'Pi JSON output was empty; no structured response or usage summary was available.'
        TerminalCompletionEvidence = $false
        TerminalEventType = $null
        ObservedEventTypes = @()
        FailureReason = 'Pi JSON output was empty; no terminal agent_end completion event was observed.'
        Response = ''
        UsageSummary = $null
        StandardError = ''
    }
    Report = [pscustomobject]@{
        Status = 'WARNING'
        Message = 'Suspicious Pi run retained as a non-success result.'
        Warning = 'No GitHub request was made.'
    }
}

if ($Json) {
    $result | ConvertTo-Json -Depth 12
} else {
    Write-Output 'SCHEDULER_FIXTURE_INCOMPLETE'
}
