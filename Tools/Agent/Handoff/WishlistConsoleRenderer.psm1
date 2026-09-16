Set-StrictMode -Version 2.0

$script:WishlistEscape = [string][char]27

function Enable-WishlistVirtualTerminalOutput {
    if ($env:OS -ne 'Windows_NT') { return $false }
    try {
        if ([Console]::IsOutputRedirected) { return $false }

        if ($null -eq ('Wishlist.AgentHost.NativeConsole' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Wishlist.AgentHost {
    public static class NativeConsole {
        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr GetStdHandle(int handleId);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetConsoleMode(IntPtr handle, out uint mode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetConsoleMode(IntPtr handle, uint mode);
    }
}
'@ -ErrorAction Stop
        }

        $outputHandle = [Wishlist.AgentHost.NativeConsole]::GetStdHandle(-11)
        if ($outputHandle -eq [IntPtr]::Zero -or $outputHandle -eq [IntPtr](-1)) { return $false }

        [uint32]$mode = 0
        if (-not [Wishlist.AgentHost.NativeConsole]::GetConsoleMode($outputHandle, [ref]$mode)) { return $false }
        $virtualTerminalMode = $mode -bor [uint32]0x0004
        if ($virtualTerminalMode -ne $mode -and -not [Wishlist.AgentHost.NativeConsole]::SetConsoleMode($outputHandle, $virtualTerminalMode)) { return $false }
        return $true
    } catch {
        return $false
    }
}

function New-WishlistConsoleSurface {
    $interactive = Enable-WishlistVirtualTerminalOutput
    return [pscustomobject]@{
        IsInteractive = $interactive
        GetWidth = {
            try { return [Math]::Max(20, [int][Console]::WindowWidth - 1) }
            catch { return 79 }
        }
        GetHeight = {
            try { return [Math]::Max(4, [int][Console]::WindowHeight - 1) }
            catch { return 24 }
        }
        Write = {
            param([AllowEmptyString()][string]$Text)
            [Console]::Write($Text)
        }
    }
}

function New-WishlistConsoleRenderer {
    param([AllowNull()][object]$Surface = $null)

    if ($null -eq $Surface) { $Surface = New-WishlistConsoleSurface }
    return [pscustomobject]@{
        Surface = $Surface
        IsInteractive = [bool]$Surface.IsInteractive
        PreviousFrameHeight = 0
        PreviousWidth = 0
        PreviousHeight = 0
        HasRendered = $false
        VisibleLines = @()
        LastPayload = ''
    }
}

function Get-WishlistConsoleDimension {
    param(
        [Parameter(Mandatory = $true)][object]$Surface,
        [Parameter(Mandatory = $true)][ValidateSet('GetWidth', 'GetHeight')][string]$Name,
        [Parameter(Mandatory = $true)][int]$Fallback,
        [Parameter(Mandatory = $true)][int]$Minimum
    )

    try {
        $getter = $Surface.PSObject.Properties[$Name].Value
        return [Math]::Max($Minimum, [int](& $getter))
    } catch {
        return $Fallback
    }
}

function Get-WishlistConsoleFrameLines {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Lines,
        [Parameter(Mandatory = $true)][int]$Width,
        [Parameter(Mandatory = $true)][int]$Height
    )

    $normalized = New-Object 'System.Collections.Generic.List[string]'
    foreach ($line in @($Lines)) {
        $text = if ($null -eq $line) { '' } else { [string]$line }
        $text = $text.Replace($script:WishlistEscape, '').Replace("`r", ' ').Replace("`n", ' ')
        if ($text.Length -gt $Width) { $text = $text.Substring(0, $Width) }
        $normalized.Add($text) | Out-Null
    }

    if ($normalized.Count -le $Height) { return [string[]]$normalized.ToArray() }

    $bounded = New-Object 'System.Collections.Generic.List[string]'
    $contentCount = [Math]::Max(1, $Height - 2)
    for ($index = 0; $index -lt $contentCount; $index++) { $bounded.Add($normalized[$index]) | Out-Null }
    $notice = ' ... dashboard truncated for terminal height ...'
    if ($notice.Length -gt $Width) { $notice = $notice.Substring(0, $Width) }
    $bounded.Add($notice) | Out-Null
    $bounded.Add($normalized[$normalized.Count - 1]) | Out-Null
    return [string[]]$bounded.ToArray()
}

function Write-WishlistConsoleFrame {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][object]$Renderer,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Lines
    )

    if (-not [bool]$Renderer.IsInteractive) { return $false }

    $surface = $Renderer.Surface
    $width = Get-WishlistConsoleDimension -Surface $surface -Name GetWidth -Fallback 79 -Minimum 20
    $height = Get-WishlistConsoleDimension -Surface $surface -Name GetHeight -Fallback 24 -Minimum 4
    $frameLines = @(Get-WishlistConsoleFrameLines -Lines $Lines -Width $width -Height $height)
    $oldHeight = [int]$Renderer.PreviousFrameHeight
    $dimensionsChanged = ($Renderer.HasRendered -and ($width -ne [int]$Renderer.PreviousWidth -or $height -ne [int]$Renderer.PreviousHeight))

    $builder = New-Object System.Text.StringBuilder
    $null = $builder.Append($script:WishlistEscape + '[?25l')
    if ($dimensionsChanged) {
        $null = $builder.Append($script:WishlistEscape + '[2J' + $script:WishlistEscape + '[H')
        $oldHeight = 0
    } elseif ($oldHeight -gt 0) {
        $null = $builder.Append($script:WishlistEscape + '[' + $oldHeight + 'A' + $script:WishlistEscape + '[1G')
    }

    $rowsToWrite = [Math]::Max($oldHeight, $frameLines.Count)
    for ($index = 0; $index -lt $rowsToWrite; $index++) {
        $null = $builder.Append($script:WishlistEscape + '[2K' + $script:WishlistEscape + '[1G')
        if ($index -lt $frameLines.Count) { $null = $builder.Append($frameLines[$index]) }
        $null = $builder.Append("`r`n")
    }
    if ($oldHeight -gt $frameLines.Count) {
        $null = $builder.Append($script:WishlistEscape + '[' + ($oldHeight - $frameLines.Count) + 'A' + $script:WishlistEscape + '[1G')
    }
    $null = $builder.Append($script:WishlistEscape + '[?25h')

    $payload = $builder.ToString()
    $writer = $surface.PSObject.Properties['Write'].Value
    & $writer $payload

    $Renderer.PreviousFrameHeight = $frameLines.Count
    $Renderer.PreviousWidth = $width
    $Renderer.PreviousHeight = $height
    $Renderer.HasRendered = $true
    $Renderer.VisibleLines = [string[]]$frameLines
    $Renderer.LastPayload = $payload
    return $true
}

function Clear-WishlistConsoleFrame {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][object]$Renderer)

    if (-not [bool]$Renderer.IsInteractive -or [int]$Renderer.PreviousFrameHeight -le 0) { return $false }

    $height = [int]$Renderer.PreviousFrameHeight
    $builder = New-Object System.Text.StringBuilder
    $null = $builder.Append($script:WishlistEscape + '[?25l')
    $null = $builder.Append($script:WishlistEscape + '[' + $height + 'A' + $script:WishlistEscape + '[1G')
    for ($index = 0; $index -lt $height; $index++) {
        $null = $builder.Append($script:WishlistEscape + '[2K' + $script:WishlistEscape + '[1G' + "`r`n")
    }
    $null = $builder.Append($script:WishlistEscape + '[' + $height + 'A' + $script:WishlistEscape + '[1G')
    $null = $builder.Append($script:WishlistEscape + '[?25h')

    $payload = $builder.ToString()
    $writer = $Renderer.Surface.PSObject.Properties['Write'].Value
    & $writer $payload
    $Renderer.PreviousFrameHeight = 0
    $Renderer.VisibleLines = @()
    $Renderer.LastPayload = $payload
    return $true
}

Export-ModuleMember -Function New-WishlistConsoleSurface, New-WishlistConsoleRenderer, Write-WishlistConsoleFrame, Clear-WishlistConsoleFrame
