[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceBranch,
    [string]$TargetBranch = 'dev',
    [string]$RepoPath = '',
    [string]$ExpectedSourceSha = '',
    [string]$ExpectedTargetSha = '',
    [string]$ExpectedMainSha = '',
    [switch]$Apply,
    [switch]$Json,
    [switch]$NoProcessExit
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Import-Module (Join-Path $scriptRoot 'WishlistGitSafety.psm1') -Force

if ([string]::IsNullOrWhiteSpace($RepoPath)) {
    $RepoPath = [IO.Path]::GetFullPath((Join-Path $scriptRoot '..\..'))
}

$sourceName = $SourceBranch -replace '^refs/heads/', ''
$targetName = $TargetBranch -replace '^refs/heads/', ''
$state = Get-WishlistGitState -RepoPath $RepoPath
$checks = New-Object 'System.Collections.Generic.List[object]'

function Add-IntegrationCheck {
    param(
        [string]$Name,
        [string]$Status,
        [string]$Detail
    )

    $checks.Add([pscustomobject]@{
        Name = $Name
        Status = $Status
        Detail = $Detail
    })
}

function Get-LocalCommit {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $result = Invoke-WishlistGit -RepoPath $RepoPath -Arguments @('rev-parse', '--verify', "$Name^{commit}")
    if ($result.ExitCode -ne 0) {
        return $null
    }
    return (($result.Output -join "`n").Trim())
}

if (-not $state.IsRepository) {
    Add-IntegrationCheck -Name 'repository' -Status 'INFRA' -Detail (($state.Errors -join ' '))
} else {
    Add-IntegrationCheck -Name 'repository' -Status 'PASS' -Detail $state.RepositoryPath
}

if ($state.IsRepository -and $state.IsWorktree) {
    Add-IntegrationCheck -Name 'normal-clone' -Status 'BLOCKED' -Detail 'Integration gate refuses Git worktrees.'
} elseif ($state.IsRepository) {
    Add-IntegrationCheck -Name 'normal-clone' -Status 'PASS' -Detail 'Normal clone confirmed.'
}

if ($targetName -ieq 'main' -or $sourceName -ieq 'main') {
    Add-IntegrationCheck -Name 'main-protection' -Status 'BLOCKED' -Detail 'main is protected and cannot be an integration target/source here.'
} elseif ($targetName -ieq $sourceName) {
    Add-IntegrationCheck -Name 'distinct-branches' -Status 'BLOCKED' -Detail 'Source and target branches must be different.'
} else {
    Add-IntegrationCheck -Name 'main-protection' -Status 'PASS' -Detail 'Neither source nor target is main.'
    Add-IntegrationCheck -Name 'distinct-branches' -Status 'PASS' -Detail "Source '$sourceName' and target '$targetName' are distinct."
}

$sourceSha = if ($state.IsRepository) { Get-LocalCommit -Name $sourceName } else { $null }
$targetSha = if ($state.IsRepository) { Get-LocalCommit -Name $targetName } else { $null }
$mainBefore = if ($state.IsRepository) { Get-LocalCommit -Name 'main' } else { $null }

if ([string]::IsNullOrWhiteSpace($sourceSha)) {
    Add-IntegrationCheck -Name 'source-branch' -Status 'BLOCKED' -Detail "Source branch '$sourceName' does not resolve to a commit."
} else {
    Add-IntegrationCheck -Name 'source-branch' -Status 'PASS' -Detail $sourceSha
}

if ([string]::IsNullOrWhiteSpace($targetSha)) {
    Add-IntegrationCheck -Name 'target-branch' -Status 'BLOCKED' -Detail "Target branch '$targetName' does not resolve to a commit."
} else {
    Add-IntegrationCheck -Name 'target-branch' -Status 'PASS' -Detail $targetSha
}

if (-not [string]::IsNullOrWhiteSpace($ExpectedSourceSha) -and -not [string]::IsNullOrWhiteSpace($sourceSha)) {
    if ($sourceSha -ieq $ExpectedSourceSha) {
        Add-IntegrationCheck -Name 'expected-source-sha' -Status 'PASS' -Detail $sourceSha
    } else {
        Add-IntegrationCheck -Name 'expected-source-sha' -Status 'BLOCKED' -Detail "Expected $ExpectedSourceSha but found $sourceSha."
    }
}

if (-not [string]::IsNullOrWhiteSpace($ExpectedTargetSha) -and -not [string]::IsNullOrWhiteSpace($targetSha)) {
    if ($targetSha -ieq $ExpectedTargetSha) {
        Add-IntegrationCheck -Name 'expected-target-sha' -Status 'PASS' -Detail $targetSha
    } else {
        Add-IntegrationCheck -Name 'expected-target-sha' -Status 'BLOCKED' -Detail "Expected $ExpectedTargetSha but found $targetSha."
    }
}

if (-not [string]::IsNullOrWhiteSpace($ExpectedMainSha) -and -not [string]::IsNullOrWhiteSpace($mainBefore)) {
    if ($mainBefore -ieq $ExpectedMainSha) {
        Add-IntegrationCheck -Name 'expected-main-sha' -Status 'PASS' -Detail $mainBefore
    } else {
        Add-IntegrationCheck -Name 'expected-main-sha' -Status 'BLOCKED' -Detail "Expected $ExpectedMainSha but found $mainBefore."
    }
}

if (-not $state.IsRepository -or -not $state.IsClean) {
    Add-IntegrationCheck -Name 'working-tree-clean' -Status 'BLOCKED' -Detail 'Working tree must be clean before integration.'
} else {
    Add-IntegrationCheck -Name 'working-tree-clean' -Status 'PASS' -Detail 'Working tree is clean.'
}

$ancestryStatus = 'BLOCKED'
$ancestryDetail = 'Fast-forward relationship could not be verified.'
if (-not [string]::IsNullOrWhiteSpace($sourceSha) -and -not [string]::IsNullOrWhiteSpace($targetSha)) {
    $ancestry = Invoke-WishlistGit -RepoPath $RepoPath -Arguments @('merge-base', '--is-ancestor', $targetSha, $sourceSha)
    if ($ancestry.ExitCode -eq 0) {
        $ancestryStatus = 'PASS'
        $ancestryDetail = "Target $targetName is an ancestor of source $sourceName."
    } else {
        $ancestryDetail = "Source $sourceName is not a descendant of target $targetName; fast-forward is blocked."
    }
}
Add-IntegrationCheck -Name 'fast-forward-ancestry' -Status $ancestryStatus -Detail $ancestryDetail

$statuses = @($checks | ForEach-Object { $_.Status })
$ready = ($statuses.Count -gt 0 -and ($statuses -notcontains 'INFRA') -and ($statuses -notcontains 'FAIL') -and ($statuses -notcontains 'BLOCKED'))
$applied = $false
$repositoryChanged = $false
$applyDetail = 'CHECK ONLY / DRY RUN'

if ($ready -and $Apply) {
    $switchResult = Invoke-WishlistGit -RepoPath $RepoPath -Arguments @('switch', '--', $targetName)
    if ($switchResult.ExitCode -ne 0) {
        Add-IntegrationCheck -Name 'apply-switch' -Status 'FAIL' -Detail (($switchResult.Output -join ' ').Trim())
        $ready = $false
    } else {
        $mergeResult = Invoke-WishlistGit -RepoPath $RepoPath -Arguments @('merge', '--ff-only', $sourceName)
        if ($mergeResult.ExitCode -ne 0) {
            Add-IntegrationCheck -Name 'apply-fast-forward' -Status 'FAIL' -Detail (($mergeResult.Output -join ' ').Trim())
            $ready = $false
        } else {
            $applied = $true
            $repositoryChanged = $true
            $applyDetail = 'Fast-forward applied.'
            Add-IntegrationCheck -Name 'apply-fast-forward' -Status 'PASS' -Detail $applyDetail
        }
    }
}

if ($ready -and $Apply -and $applied) {
    $targetAfter = Get-LocalCommit -Name $targetName
    $mainAfter = Get-LocalCommit -Name 'main'
    if ($targetAfter -ieq $sourceSha) {
        Add-IntegrationCheck -Name 'verify-target-after-apply' -Status 'PASS' -Detail $targetAfter
    } else {
        Add-IntegrationCheck -Name 'verify-target-after-apply' -Status 'FAIL' -Detail "Target ended at $targetAfter instead of source $sourceSha."
        $ready = $false
    }
    if (-not [string]::IsNullOrWhiteSpace($mainBefore) -and $mainAfter -ieq $mainBefore) {
        Add-IntegrationCheck -Name 'verify-main-unchanged' -Status 'PASS' -Detail $mainAfter
    } elseif ([string]::IsNullOrWhiteSpace($mainBefore) -and [string]::IsNullOrWhiteSpace($mainAfter)) {
        Add-IntegrationCheck -Name 'verify-main-unchanged' -Status 'PASS' -Detail 'main ref is absent both before and after.'
    } else {
        Add-IntegrationCheck -Name 'verify-main-unchanged' -Status 'FAIL' -Detail "main changed from $mainBefore to $mainAfter."
        $ready = $false
    }
}

$finalStatuses = @($checks | ForEach-Object { $_.Status })
$overallStatus = if ($finalStatuses -contains 'INFRA') { 'INFRA' } elseif ($finalStatuses -contains 'FAIL') { 'FAIL' } elseif ($finalStatuses -contains 'BLOCKED') { 'BLOCKED' } else { 'PASS' }
$message = if ($overallStatus -eq 'PASS') {
    if ($Apply -and $applied) { 'FAST-FORWARD APPLIED' } else { 'READY FOR FAST-FORWARD' }
} else {
    'BLOCKED: integration prerequisites are not satisfied.'
}

$report = [pscustomobject]@{
    Status = $overallStatus
    Message = $message
    Mode = if ($Apply) { 'APPLY' } else { 'CHECK_ONLY' }
    RepositoryPath = $state.RepositoryPath
    SourceBranch = $sourceName
    TargetBranch = $targetName
    SourceSha = $sourceSha
    TargetShaBefore = $targetSha
    MainShaBefore = $mainBefore
    Applied = $applied
    RepositoryChanged = $repositoryChanged
    ApplyDetail = $applyDetail
    Checks = @($checks | ForEach-Object { $_ })
}

if ($Json) {
    Write-Output ($report | ConvertTo-Json -Depth 8)
} else {
    Write-Output $report.Message
    if ($repositoryChanged) {
        Write-Output 'REPOSITORY STATE CHANGED BY EXPLICIT APPLY'
    } else {
        Write-Output 'NO REPOSITORY STATE CHANGED'
    }
    Write-Output "Repository: $($report.RepositoryPath)"
    Write-Output "Source: $($report.SourceBranch) @ $($report.SourceSha)"
    Write-Output "Target: $($report.TargetBranch) @ $($report.TargetShaBefore)"
    foreach ($check in @($report.Checks)) {
        Write-Output ("[{0}] {1}: {2}" -f $check.Status, $check.Name, $check.Detail)
    }
}

if (-not $NoProcessExit) {
    exit (Get-WishlistExitCode -Status $overallStatus)
}
