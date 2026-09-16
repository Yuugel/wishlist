[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$testRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentRoot = Split-Path -Parent $testRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $agentRoot)
$handoffRoot = Join-Path $agentRoot 'Handoff'
$fixtureRoot = Join-Path $testRoot 'fixtures'

Import-Module (Join-Path $handoffRoot 'TaskParser.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $handoffRoot 'TaskRouter.psm1') -Force
Import-Module (Join-Path $handoffRoot 'PiLauncher.psm1') -Force
Import-Module (Join-Path $handoffRoot 'WishlistReporting.psm1') -Force

$script:Total = 0
$script:Passed = 0
$script:Failed = 0
$script:Failures = New-Object 'System.Collections.Generic.List[string]'
$script:DisposableRoot = Join-Path ([IO.Path]::GetTempPath()) ('wishlist-handoff-tests-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $script:DisposableRoot | Out-Null

function Assert-True {
    param([Parameter(Mandatory = $true)][bool]$Condition, [Parameter(Mandatory = $true)][string]$Name)
    $script:Total++
    if ($Condition) { $script:Passed++; Write-Output "PASS: $Name" }
    else { $script:Failed++; $script:Failures.Add($Name); Write-Output "FAIL: $Name" }
}

function Assert-Equal {
    param([AllowNull()][object]$Actual, [AllowNull()][object]$Expected, [Parameter(Mandatory = $true)][string]$Name)
    $same = if ($null -eq $Actual -and $null -eq $Expected) { $true } elseif ($null -eq $Actual -or $null -eq $Expected) { $false } else { [string]$Actual -eq [string]$Expected }
    Assert-True -Condition $same -Name ("{0} (expected '{1}', got '{2}')" -f $Name, $Expected, $Actual)
}

function Read-Fixture {
    param([Parameter(Mandatory = $true)][string]$Name)
    return [IO.File]::ReadAllText((Join-Path $fixtureRoot $Name))
}

function Write-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][object]$Value)
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 20), $utf8WithoutBom)
}

function Invoke-JsonScript {
    param([Parameter(Mandatory = $true)][string]$ScriptPath, [Parameter(Mandatory = $true)][string[]]$Arguments)
    $engine = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($null -eq $engine) { $engine = Get-Command pwsh -ErrorAction SilentlyContinue }
    if ($null -eq $engine) { throw 'No PowerShell engine was available for a child script.' }
    $output = @(& $engine.Source -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments)
    $text = ($output -join "`n")
    try { return ($text | ConvertFrom-Json -ErrorAction Stop) }
    catch { throw "Child script returned invalid JSON: $text" }
}

try {
    $validText = Read-Fixture -Name 'valid-task.txt'
    $validParse = Parse-WishlistTask -Text $validText
    Assert-Equal -Actual $validParse.Status -Expected 'PASS' -Name 'parser accepts a marked Wishlist task'
    Assert-Equal -Actual $validParse.Definition.Project -Expected 'Wishlist' -Name 'parser preserves Wishlist project identity'
    Assert-Equal -Actual $validParse.Definition.Body -Expected 'Implement the bounded inventory task.' -Name 'parser preserves task body'
    Assert-Equal -Actual (Parse-WishlistTask -Text (Read-Fixture -Name 'unmarked.txt')).Status -Expected 'BLOCKED' -Name 'parser blocks unmarked input'
    Assert-Equal -Actual (Parse-WishlistTask -Text (Read-Fixture -Name 'body-missing.txt')).Status -Expected 'BLOCKED' -Name 'parser blocks missing body'

    $configPath = Join-Path $handoffRoot 'routing.json'
    $routingConfig = Get-WishlistRoutingConfig -Path $configPath
    $route = Resolve-WishlistRoute -TaskDefinition $validParse.Definition -Config $routingConfig
    Assert-Equal -Actual $route.ModelKey -Expected 'luna' -Name 'auto-routing selects Luna for bounded work'
    Assert-Equal -Actual $route.Provider -Expected 'openai-codex' -Name 'Luna keeps the configured provider'
    Assert-Equal -Actual $route.Thinking -Expected 'max' -Name 'Luna keeps max thinking'
    Assert-Equal -Actual (New-WishlistSessionId -Project 'Wishlist' -Ticket '1' -Scope 'setup') -Expected 'wishlist-1' -Name 'session namespace uses Wishlist'
    $highTask = (Parse-WishlistTask -Text "@@PI_TASK`nproject: Wishlist`nrisk: high`n`nHigh-risk task.").Definition
    Assert-Equal -Actual (Resolve-WishlistRoute -TaskDefinition $highTask -Config $routingConfig).ModelKey -Expected 'sol' -Name 'auto-routing selects Sol for high risk'
    $terraTask = (Parse-WishlistTask -Text "@@PI_TASK`nproject: Wishlist`nmodel: terra`n`nExplicit Terra task.").Definition
    Assert-Equal -Actual (Resolve-WishlistRoute -TaskDefinition $terraTask -Config $routingConfig).ModelKey -Expected 'terra' -Name 'Terra remains explicit-only'
    Assert-True -Condition (@($routingConfig.automaticRoutes | Where-Object { $_.model -eq 'terra' }).Count -eq 0) -Name 'Terra is absent from automatic routing'
    Assert-True -Condition (@($routingConfig.skillRules | Where-Object { $_.skills -contains 'wishlist-feature-delivery' }).Count -eq 1) -Name 'routing selects the Wishlist feature skill'
    Assert-True -Condition (@($routingConfig.skillRules | Where-Object { $_.skills -match 'unity|asset' }).Count -eq 0) -Name 'Unity and asset skills are not ported'

    $fakeConfig = Get-WishlistRoutingConfig -Path $configPath
    $fakeConfig.launcher.configured = $true
    $fakeConfig.launcher.command = Join-Path $fixtureRoot 'fake-pi.cmd'
    $fakeConfig.launcher.arguments = @()
    $fakeConfig.launcher.inputMode = 'stdin'
    $fakeConfig.launcher.outputMode = 'text'
    $fakeConfigPath = Join-Path $script:DisposableRoot 'fake-routing.json'
    Write-JsonFile -Path $fakeConfigPath -Value $fakeConfig

    $handoffScript = Join-Path $handoffRoot 'Invoke-WishlistTask.ps1'
    $preview = Invoke-JsonScript -ScriptPath $handoffScript -Arguments @('-Text', $validText, '-RoutingConfigPath', $fakeConfigPath, '-RepoPath', $repoRoot, '-Json', '-NoProcessExit')
    Assert-Equal -Actual $preview.Status -Expected 'PASS' -Name 'handoff accepts the Wishlist dry-run task'
    Assert-Equal -Actual $preview.Mode -Expected 'DRY_RUN' -Name 'handoff reports dry-run mode'
    Assert-Equal -Actual $preview.PiStatus -Expected 'DRY_RUN_READY' -Name 'dry-run reports a ready Pi preview'
    Assert-Equal -Actual $preview.Invocation.WorkingDirectory -Expected $repoRoot -Name 'preview working directory is the Wishlist repository'
    Assert-True -Condition (-not [bool]$preview.Forwarded -and -not [bool]$preview.Launch.Started) -Name 'dry-run does not launch or forward'
    Assert-Equal -Actual $preview.Report.Status -Expected 'SKIPPED' -Name 'dry-run does not create a report'

    $reportDirectory = Join-Path $script:DisposableRoot 'reports'
    $apply = Invoke-JsonScript -ScriptPath $handoffScript -Arguments @('-Text', $validText, '-RoutingConfigPath', $fakeConfigPath, '-RepoPath', $repoRoot, '-ReportDirectory', $reportDirectory, '-GitHubCommandPath', 'wishlist-test-gh-missing', '-Apply', '-Json', '-NoProcessExit')
    Assert-Equal -Actual $apply.Status -Expected 'PASS' -Name 'apply executes the hermetic local Pi fixture'
    Assert-Equal -Actual $apply.Launch.Response -Expected 'PI_FAKE_HANDOFF_READY' -Name 'apply returns the Pi response'
    Assert-Equal -Actual $apply.Report.Status -Expected 'WARNING' -Name 'missing GitHub CLI remains a secondary warning'
    Assert-True -Condition (Test-Path -LiteralPath $apply.Report.LocalPath -PathType Leaf) -Name 'failed GitHub delivery keeps a local report'

    $jsonConfig = Get-WishlistRoutingConfig -Path $configPath
    $jsonConfig.launcher.configured = $true
    $jsonConfig.launcher.command = Join-Path $fixtureRoot 'fake-pi-json.cmd'
    $jsonConfig.launcher.arguments = @('--mode', 'json')
    $jsonConfig.launcher.inputMode = 'stdin'
    $jsonConfig.launcher.outputMode = 'json'
    $jsonConfigPath = Join-Path $script:DisposableRoot 'json-routing.json'
    Write-JsonFile -Path $jsonConfigPath -Value $jsonConfig
    $jsonApply = Invoke-JsonScript -ScriptPath $handoffScript -Arguments @('-Text', $validText, '-RoutingConfigPath', $jsonConfigPath, '-RepoPath', $repoRoot, '-ReportDirectory', $reportDirectory, '-GitHubCommandPath', 'wishlist-test-gh-missing', '-Apply', '-Json', '-NoProcessExit')
    Assert-Equal -Actual $jsonApply.Status -Expected 'PASS' -Name 'JSON Pi fixture completes successfully'
    Assert-Equal -Actual $jsonApply.Launch.Response -Expected 'PI_FAKE_JSON_READY' -Name 'JSON Pi response is extracted'
    Assert-Equal -Actual $jsonApply.Launch.UsageSummary.TotalTokens -Expected 21 -Name 'JSON usage remains structured'
    Assert-Equal -Actual $jsonApply.Task.Project -Expected 'Wishlist' -Name 'handoff JSON exposes the Wishlist task'

    $reportLaunch = [pscustomobject]@{ Status = 'PASS'; PiSessionId = 'wishlist-session'; Response = 'Implemented Wishlist safely.'; UsageSummary = [pscustomobject]@{ InputTokens = 1; OutputTokens = 2; TotalTokens = 3; Cost = 0.01 } }
    $calls = New-Object 'System.Collections.Generic.List[object]'
    $bodies = New-Object 'System.Collections.Generic.List[string]'
    $runner = {
        param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
        $calls.Add([pscustomobject]@{ FilePath = $FilePath; Arguments = @($Arguments) }) | Out-Null
        $bodies.Add([IO.File]::ReadAllText([string]$Arguments[6])) | Out-Null
        return [pscustomobject]@{ ExitCode = 0 }
    }.GetNewClosure()
    $delivery = Publish-WishlistAgentReport -TaskDefinition $validParse.Definition -Route $route -LaunchResult $reportLaunch -ReportDirectory (Join-Path $script:DisposableRoot 'posted') -CommandRunner $runner
    Assert-Equal -Actual $delivery.Status -Expected 'POSTED' -Name 'ticketed report uses the GitHub seam'
    Assert-Equal -Actual $calls.Count -Expected 1 -Name 'ticketed report makes one GitHub attempt'
    Assert-Equal -Actual $calls[0].Arguments[4] -Expected 'Yuugel/wishlist' -Name 'GitHub report targets Yuugel/wishlist'
    Assert-True -Condition ([string]$bodies[0] -like '*<!-- wishlist-agent-report:v1 -->*') -Name 'report uses the Wishlist marker'
    Assert-True -Condition ([string]$bodies[0] -notlike '*Implement the bounded inventory task.*') -Name 'report excludes the task body'

    $hostText = [IO.File]::ReadAllText((Join-Path $handoffRoot 'Start-WishlistAgentHost.ps1'))
    $rootLauncherText = [IO.File]::ReadAllText((Join-Path $repoRoot 'Start-WishlistPiTask.ps1'))
    Assert-True -Condition ($hostText -like '*Ctrl+Alt+W*' -and $rootLauncherText -like '*Ctrl+Alt+W*') -Name 'Wishlist hotkey validation supports the default Ctrl+Alt+W'
    Assert-True -Condition ($rootLauncherText -like '*Start-WishlistHandoffHotkey.ps1*' -and $rootLauncherText -like '*RepoPath = $repositoryRoot*') -Name 'root launcher targets only the local Wishlist toolchain'

    Write-Output "TOTAL: $script:Total"
    Write-Output "PASSED: $script:Passed"
    Write-Output "FAILED: $script:Failed"
    if ($script:Failed -gt 0) {
        foreach ($failure in $script:Failures) { Write-Output "FAILED TEST: $failure" }
        exit 1
    }
    exit 0
} finally {
    if (Test-Path -LiteralPath $script:DisposableRoot -PathType Container) {
        Remove-Item -LiteralPath $script:DisposableRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
