[CmdletBinding()]
param(
    [ValidateSet('Ctrl+Shift+P', 'Ctrl+Alt+P', 'Ctrl+Alt+H', 'Ctrl+Alt+W')]
    [string]$Hotkey = 'Ctrl+Alt+W',
    [string]$StateRoot = '',
    [ValidateRange(1, 16)][int]$MaxWorkers = 2,
    [switch]$DryRun,
    [switch]$AllowAstra,
    [switch]$Once,
    [int]$HotkeyId = 0x5757,
    [switch]$TestLifecycle,
    [ValidateRange(50, 60000)][int]$TestHotkeyDelayMilliseconds = 1000,
    [string]$ReportDirectory = '',
    [string]$GitHubCommandPath = ''
)

Set-StrictMode -Version 2.0

$repositoryRoot = (Resolve-Path -LiteralPath $PSScriptRoot -ErrorAction Stop).Path
$handoffHost = Join-Path $repositoryRoot 'Tools\Agent\Handoff\Start-WishlistHandoffHotkey.ps1'
if (-not (Test-Path -LiteralPath $handoffHost -PathType Leaf)) {
    throw "Wishlist-local handoff host '$handoffHost' does not exist."
}

$arguments = @{
    RepoPath = $repositoryRoot
    Hotkey = $Hotkey
    HotkeyId = $HotkeyId
    MaxWorkers = $MaxWorkers
}
if (-not [string]::IsNullOrWhiteSpace($StateRoot)) { $arguments.StateRoot = $StateRoot }
if (-not [string]::IsNullOrWhiteSpace($ReportDirectory)) { $arguments.ReportDirectory = $ReportDirectory }
if (-not [string]::IsNullOrWhiteSpace($GitHubCommandPath)) { $arguments.GitHubCommandPath = $GitHubCommandPath }
if ($DryRun) { $arguments.DryRun = $true }
if ($AllowAstra) { $arguments.AllowAstra = $true }
if ($Once) { $arguments.Once = $true }
if ($TestLifecycle) { $arguments.TestLifecycle = $true }
$arguments.TestHotkeyDelayMilliseconds = $TestHotkeyDelayMilliseconds

& $handoffHost @arguments
exit $LASTEXITCODE
