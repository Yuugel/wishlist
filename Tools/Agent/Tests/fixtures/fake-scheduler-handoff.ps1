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

$payload = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $TaskFile).Path)
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
    $payloadHash = ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($payload))) -replace '-', '').ToLowerInvariant()
} finally {
    $sha.Dispose()
}
$result = [pscustomobject]@{
    Status = 'PASS'
    Mode = if ($Apply) { 'APPLY' } else { 'DRY_RUN' }
    Source = 'FILE'
    Reason = 'Hermetic scheduler fixture completed.'
    Forwarded = [bool]$Apply
    Launch = [pscustomobject]@{
        Started = [bool]$Apply
        PiSessionId = 'fixture-scheduler-session'
        Response = "PAYLOAD_SHA256:$payloadHash"
        UsageSummary = [pscustomobject]@{
            InputTokens = 10
            CacheReadTokens = 20
            CacheWriteTokens = 0
            OutputTokens = 5
            ReasoningTokens = 2
            TotalTokens = 37
            Cost = 0.01
        }
    }
    Report = [pscustomobject]@{
        Status = 'WARNING'
        Message = 'Hermetic reporting failure remained secondary.'
        Warning = 'No GitHub request was made.'
    }
}

if ($Json) { $result | ConvertTo-Json -Depth 12 }
else { Write-Output 'SCHEDULER_FIXTURE_READY' }
