[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$StartupDirectory = '',

    [string]$ShortcutName = 'Wishlist Handoff Hotkey.lnk',

    [switch]$Json
)

Set-StrictMode -Version 2.0

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$hotkeyScriptPath = Join-Path $scriptRoot 'Start-WishlistHandoffHotkey.ps1'
$descriptionPrefix = 'Wishlist Agent Workflow V1 global '
$descriptionSuffix = ' handoff host'
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

function Write-WishlistUninstallerResult {
    param(
        [Parameter(Mandatory = $true)][object]$Result,
        [switch]$AsJson
    )

    if ($AsJson) {
        Write-Output ($Result | ConvertTo-Json -Depth 8)
    } else {
        Write-Output "STATUS: $($Result.Status)"
        Write-Output "Shortcut: $($Result.ShortcutPath)"
        Write-Output "Message: $($Result.Message)"
    }
}

$shortcutPath = Join-Path $StartupDirectory $ShortcutName
$result = [ordered]@{
    Status = 'NOT_INSTALLED'
    ShortcutPath = $shortcutPath
    Message = 'No workflow startup shortcut was present.'
    Recovered = $false
}

if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $null
    $target = ''
    $arguments = ''
    $description = ''
    try {
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $target = [string]$shortcut.TargetPath
        $arguments = [string]$shortcut.Arguments
        $description = [string]$shortcut.Description
    } finally {
        if ($null -ne $shortcut) {
            [Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) | Out-Null
        }
        if ($null -ne $shell) {
            [Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
        }
    }

    if ($description -notlike ($descriptionPrefix + '*' + $descriptionSuffix) -or $arguments -notlike ('*' + $hotkeyScriptPath + '*')) {
        throw "Refusing to remove unrelated startup shortcut '$shortcutPath'."
    }

    if ($PSCmdlet.ShouldProcess($shortcutPath, 'Remove the Wishlist handoff startup shortcut')) {
        Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction Stop
        $result.Status = 'UNINSTALLED'
        $result.Message = 'Workflow startup shortcut removed; no other startup items were changed.'
        $result.Recovered = $true
    } else {
        $result.Status = 'PREVIEW'
        $result.Message = 'WhatIf preview; no startup item was changed.'
    }
}

Write-WishlistUninstallerResult -Result ([pscustomobject]$result) -AsJson:$Json
