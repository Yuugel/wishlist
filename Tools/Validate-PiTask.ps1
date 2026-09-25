[CmdletBinding()]
param(
    [ValidateSet('validate', 'build', 'test', 'integration')]
    [string]$Action = 'validate',
    [Parameter(Mandatory = $true)][string]$ProjectId,
    [Parameter(Mandatory = $true)][string]$RepoPath,
    [switch]$Json,
    [switch]$DryRun
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Write-ValidationResult {
    param(
        [string]$Status,
        [string]$Code,
        [string]$Message,
        [int]$Total = 0,
        [int]$Passed = 0,
        [int]$Failed = 0
    )

    [pscustomobject]@{
        schemaVersion = 1
        projectId = 'wishlist'
        action = $Action.ToLowerInvariant()
        status = $Status
        code = $Code
        message = $Message
        total = $Total
        passed = $Passed
        failed = $Failed
    } | ConvertTo-Json -Compress
}

function Get-SummaryValue {
    param(
        [string[]]$Lines,
        [string]$Name
    )

    foreach ($line in @($Lines)) {
        $match = [regex]::Match([string]$line, ('^' + [regex]::Escape($Name) + ':\s*(\d+)\s*$'))
        if ($match.Success) { return [int]$match.Groups[1].Value }
    }
    return $null
}

function Invoke-WishlistRegressionSuite {
    param([Parameter(Mandatory = $true)][string]$ScriptPath)

    if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) {
        return [pscustomobject]@{
            InfrastructureFailure = $true
            Message = "Validation suite '$ScriptPath' is missing."
            Total = 0
            Passed = 0
            Failed = 0
        }
    }

    $engine = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($null -eq $engine) {
        return [pscustomobject]@{
            InfrastructureFailure = $true
            Message = 'powershell.exe is unavailable.'
            Total = 0
            Passed = 0
            Failed = 0
        }
    }

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = @(& $engine.Source -NoProfile -ExecutionPolicy Bypass -File $ScriptPath 2>&1)
        $exitCode = $LASTEXITCODE
    } catch {
        return [pscustomobject]@{
            InfrastructureFailure = $true
            Message = 'Validation suite could not be launched.'
            Total = 0
            Passed = 0
            Failed = 0
        }
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    $lines = @($output | ForEach-Object { [string]$_ })
    $total = Get-SummaryValue -Lines $lines -Name 'TOTAL'
    $passed = Get-SummaryValue -Lines $lines -Name 'PASSED'
    $failed = Get-SummaryValue -Lines $lines -Name 'FAILED'

    if ($null -eq $total -or $null -eq $passed -or $null -eq $failed) {
        return [pscustomobject]@{
            InfrastructureFailure = $true
            Message = "Validation suite '$ScriptPath' did not emit a complete TOTAL/PASSED/FAILED summary."
            Total = 0
            Passed = 0
            Failed = 0
        }
    }

    if ($total -lt 0 -or $passed -lt 0 -or $failed -lt 0 -or ($passed + $failed) -ne $total) {
        return [pscustomobject]@{
            InfrastructureFailure = $true
            Message = "Validation suite '$ScriptPath' emitted inconsistent result counts."
            Total = 0
            Passed = 0
            Failed = 0
        }
    }

    if ($exitCode -ne 0 -and $failed -eq 0) {
        return [pscustomobject]@{
            InfrastructureFailure = $true
            Message = "Validation suite '$ScriptPath' exited with code $exitCode without reporting failed assertions."
            Total = $total
            Passed = $passed
            Failed = $failed
        }
    }

    return [pscustomobject]@{
        InfrastructureFailure = $false
        Message = ''
        Total = $total
        Passed = $passed
        Failed = $failed
    }
}

try {
    $resolvedRepo = (Resolve-Path -LiteralPath $RepoPath -ErrorAction Stop).Path
} catch {
    Write-ValidationResult -Status INFRA -Code 'WISHLIST_REPO_UNAVAILABLE' -Message 'Wishlist repository path is unavailable.'
    exit 0
}

if ($ProjectId.Trim().ToLowerInvariant() -cne 'wishlist') {
    Write-ValidationResult -Status INFRA -Code 'WISHLIST_PROJECT_MISMATCH' -Message 'Wishlist validation adapter received the wrong project identity.'
    exit 0
}

if ($Action -ne 'test') {
    $detail = if ($Action -eq 'integration' -and $DryRun) {
        'Wishlist has no dedicated integration validation yet; dry-run request was not mutated.'
    } else {
        "Wishlist does not currently declare a '$Action' validation action."
    }
    Write-ValidationResult -Status NOT_DISCOVERED -Code ('WISHLIST_' + $Action.ToUpperInvariant() + '_NOT_DISCOVERED') -Message $detail
    exit 0
}

$testRoot = Join-Path $resolvedRepo 'Tools\Agent\Tests'
$suites = @(
    Join-Path $testRoot 'Run-WishlistHandoffTests.ps1'
    Join-Path $testRoot 'Run-WishlistSchedulerTests.ps1'
)

$total = 0
$passed = 0
$failed = 0
foreach ($suite in $suites) {
    $result = Invoke-WishlistRegressionSuite -ScriptPath $suite
    if ([bool]$result.InfrastructureFailure) {
        Write-ValidationResult -Status INFRA -Code 'WISHLIST_TEST_INFRA' -Message ([string]$result.Message) -Total $total -Passed $passed -Failed $failed
        exit 0
    }
    $total += [int]$result.Total
    $passed += [int]$result.Passed
    $failed += [int]$result.Failed
}

if ($total -eq 0) {
    Write-ValidationResult -Status NOT_DISCOVERED -Code 'WISHLIST_TESTS_NOT_DISCOVERED' -Message 'Wishlist regression suites discovered zero assertions.'
    exit 0
}
if ($failed -gt 0) {
    Write-ValidationResult -Status FAIL -Code 'WISHLIST_TEST_FAILURE' -Message 'One or more Wishlist regression assertions failed.' -Total $total -Passed $passed -Failed $failed
    exit 0
}

Write-ValidationResult -Status PASS -Code 'WISHLIST_TESTS_PASS' -Message 'Wishlist handoff and scheduler regression suites passed.' -Total $total -Passed $passed -Failed 0
exit 0
