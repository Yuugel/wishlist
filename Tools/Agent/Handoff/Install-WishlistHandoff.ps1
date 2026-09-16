[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$RepoPath = '',

    [string]$StartupDirectory = '',

    [string]$ShortcutName = 'Wishlist Handoff Hotkey.lnk',

    [string]$PowerShellPath = '',

    [ValidateSet('Ctrl+Shift+P', 'Ctrl+Alt+P', 'Ctrl+Alt+H', 'Ctrl+Alt+W')]
    [string]$Hotkey = 'Ctrl+Alt+W',

    [switch]$Force,

    [switch]$Json
)

Set-StrictMode -Version 2.0

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($RepoPath)) {
    $RepoPath = (Resolve-Path (Join-Path $scriptRoot '..\..\..')).Path
} else {
    $RepoPath = (Resolve-Path -LiteralPath $RepoPath -ErrorAction Stop).Path
}

$hotkeyScriptPath = Join-Path $scriptRoot 'Start-WishlistHandoffHotkey.ps1'
if (-not (Test-Path -LiteralPath $hotkeyScriptPath -PathType Leaf)) {
    throw "Hotkey host '$hotkeyScriptPath' does not exist."
}

if ([string]::IsNullOrWhiteSpace($StartupDirectory)) {
    $StartupDirectory = [Environment]::GetFolderPath('Startup')
}
if ([string]::IsNullOrWhiteSpace($StartupDirectory) -or -not (Test-Path -LiteralPath $StartupDirectory -PathType Container)) {
    throw "Startup directory '$StartupDirectory' does not exist. Pass -StartupDirectory explicitly when testing or using a non-standard profile."
}
$StartupDirectory = (Resolve-Path -LiteralPath $StartupDirectory -ErrorAction Stop).Path

if ([string]::IsNullOrWhiteSpace($ShortcutName) -or [IO.Path]::GetFileName($ShortcutName) -ne $ShortcutName) {
    throw "ShortcutName must be a single file name, not a path."
}

if ([string]::IsNullOrWhiteSpace($PowerShellPath)) {
    $engine = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($null -eq $engine) {
        $engine = Get-Command pwsh -ErrorAction SilentlyContinue
    }
    if ($null -eq $engine) {
        throw 'No PowerShell engine was found for the startup shortcut.'
    }
    $PowerShellPath = if (-not [string]::IsNullOrWhiteSpace([string]$engine.Source)) { [string]$engine.Source } else { [string]$engine.Definition }
} else {
    $PowerShellPath = (Resolve-Path -LiteralPath $PowerShellPath -ErrorAction Stop).Path
}

function ConvertTo-WishlistShortcutArgument {
    param([Parameter(Mandatory = $true)][string]$Value)

    return '"' + $Value.Replace('"', '\"') + '"'
}

function Write-WishlistInstallerResult {
    param(
        [Parameter(Mandatory = $true)][object]$Result,
        [switch]$AsJson
    )

    if ($AsJson) {
        Write-Output ($Result | ConvertTo-Json -Depth 8)
    } else {
        Write-Output "STATUS: $($Result.Status)"
        Write-Output "Shortcut: $($Result.ShortcutPath)"
        Write-Output "Target: $($Result.TargetPath)"
        Write-Output "Arguments: $($Result.Arguments)"
        Write-Output "Admin required: $($Result.AdminRequired)"
        Write-Output "Reversible with: $($Result.ReversibleWith)"
    }
}

$shortcutPath = Join-Path $StartupDirectory $ShortcutName
$arguments = '-NoProfile -ExecutionPolicy Bypass -File ' + (ConvertTo-WishlistShortcutArgument -Value $hotkeyScriptPath) + ' -RepoPath ' + (ConvertTo-WishlistShortcutArgument -Value $RepoPath) + ' -Hotkey ' + (ConvertTo-WishlistShortcutArgument -Value $Hotkey)
$result = [ordered]@{
    Status = 'PREVIEW'
    ShortcutPath = $shortcutPath
    StartupDirectory = $StartupDirectory
    TargetPath = $PowerShellPath
    Arguments = $arguments
    AdminRequired = $false
    Autostart = $true
    ReversibleWith = 'Uninstall-WishlistHandoff.ps1'
    Hotkey = $Hotkey
}

if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
    if (-not $Force) {
        throw "Startup shortcut '$shortcutPath' already exists. Use -Force only to replace this exact workflow shortcut after reviewing it."
    }

    $existing = New-Object -ComObject WScript.Shell
    $existingShortcut = $null
    $existingTarget = ''
    $existingArguments = ''
    try {
        $existingShortcut = $existing.CreateShortcut($shortcutPath)
        $existingTarget = [string]$existingShortcut.TargetPath
        $existingArguments = [string]$existingShortcut.Arguments
    } finally {
        if ($null -ne $existingShortcut) {
            [Runtime.InteropServices.Marshal]::ReleaseComObject($existingShortcut) | Out-Null
        }
        if ($null -ne $existing) {
            [Runtime.InteropServices.Marshal]::ReleaseComObject($existing) | Out-Null
        }
    }

    if ($existingTarget -ne $PowerShellPath -or $existingArguments -notlike ('*' + $hotkeyScriptPath + '*')) {
        throw "Refusing to replace unrelated startup shortcut '$shortcutPath'."
    }
}

if ($PSCmdlet.ShouldProcess($shortcutPath, 'Create the user-scoped Wishlist handoff startup shortcut')) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $null
    try {
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $PowerShellPath
        $shortcut.Arguments = $arguments
        $shortcut.WorkingDirectory = $RepoPath
        $shortcut.Description = "Wishlist Agent Workflow V1 global $Hotkey handoff host"
        $shortcut.WindowStyle = 1
        $shortcut.Save()
    } finally {
        if ($null -ne $shortcut) {
            [Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) | Out-Null
        }
        if ($null -ne $shell) {
            [Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
        }
    }
    $result.Status = 'INSTALLED'
}

Write-WishlistInstallerResult -Result ([pscustomobject]$result) -AsJson:$Json
