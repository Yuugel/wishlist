[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$testRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentRoot = Split-Path -Parent $testRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $agentRoot)
$adapterPath = Join-Path $repoRoot 'Tools\Validate-PiTask.ps1'

function Assert-True {
    param([bool]$Condition,[string]$Message)
    if (-not $Condition) { throw "ASSERT TRUE FAILED: $Message" }
}

function Assert-Equal {
    param($Actual,$Expected,[string]$Message)
    if ([string]$Actual -cne [string]$Expected) {
        throw "ASSERT EQUAL FAILED: $Message. Expected '$Expected', got '$Actual'."
    }
}

function Invoke-Adapter {
    param([string[]]$Arguments)

    $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $adapterPath @Arguments 2>&1)
    Assert-Equal -Actual $LASTEXITCODE -Expected 0 -Message 'validation adapter exits successfully'
    $text = $output -join [Environment]::NewLine
    try {
        return ($text | ConvertFrom-Json -ErrorAction Stop)
    } catch {
        throw "Validation adapter returned invalid JSON: $text"
    }
}

Assert-True -Condition (Test-Path -LiteralPath $adapterPath -PathType Leaf) -Message 'Wishlist validation adapter exists'

$validate = Invoke-Adapter -Arguments @(
    '-Action','validate',
    '-ProjectId','wishlist',
    '-RepoPath',$repoRoot,
    '-Json'
)
Assert-Equal -Actual $validate.schemaVersion -Expected 1 -Message 'adapter schema version'
Assert-Equal -Actual $validate.projectId -Expected 'wishlist' -Message 'adapter project identity'
Assert-Equal -Actual $validate.action -Expected 'validate' -Message 'validate action preserved'
Assert-Equal -Actual $validate.status -Expected 'NOT_DISCOVERED' -Message 'unsupported validate action is explicit'
Assert-Equal -Actual $validate.code -Expected 'WISHLIST_VALIDATE_NOT_DISCOVERED' -Message 'validate action code'

$integration = Invoke-Adapter -Arguments @(
    '-Action','integration',
    '-ProjectId','wishlist',
    '-RepoPath',$repoRoot,
    '-Json',
    '-DryRun'
)
Assert-Equal -Actual $integration.status -Expected 'NOT_DISCOVERED' -Message 'unsupported integration check is explicit'
Assert-Equal -Actual $integration.code -Expected 'WISHLIST_INTEGRATION_NOT_DISCOVERED' -Message 'integration action code'

$wrongProject = Invoke-Adapter -Arguments @(
    '-Action','test',
    '-ProjectId','not-wishlist',
    '-RepoPath',$repoRoot,
    '-Json'
)
Assert-Equal -Actual $wrongProject.status -Expected 'INFRA' -Message 'wrong project identity fails closed'
Assert-Equal -Actual $wrongProject.code -Expected 'WISHLIST_PROJECT_MISMATCH' -Message 'wrong project identity code'

$test = Invoke-Adapter -Arguments @(
    '-Action','test',
    '-ProjectId','wishlist',
    '-RepoPath',$repoRoot,
    '-Json'
)
Assert-Equal -Actual $test.status -Expected 'PASS' -Message 'Wishlist deterministic regression suites pass through adapter'
Assert-Equal -Actual $test.code -Expected 'WISHLIST_TESTS_PASS' -Message 'Wishlist test action code'
Assert-True -Condition ([int]$test.total -gt 0) -Message 'Wishlist adapter reports discovered assertions'
Assert-Equal -Actual ([int]$test.failed) -Expected 0 -Message 'Wishlist adapter reports zero failed assertions'
Assert-Equal -Actual ([int]$test.passed) -Expected ([int]$test.total) -Message 'Wishlist adapter reports all assertions passed'

Write-Output 'Wishlist validation adapter tests: PASS'
