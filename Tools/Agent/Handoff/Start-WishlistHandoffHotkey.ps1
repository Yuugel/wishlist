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

# Preserve the established startup entry point while the scheduler host owns
# queueing, worker processes, persistence, and terminal presentation.
$agentHostScriptPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'Start-WishlistAgentHost.ps1'
& $agentHostScriptPath @PSBoundParameters
exit $LASTEXITCODE
