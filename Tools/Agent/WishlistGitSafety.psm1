Set-StrictMode -Version 2.0

$script:StatusExitCodes = @{
    PASS = 0
    FAIL = 1
    BLOCKED = 2
    INFRA = 3
    NOT_DISCOVERED = 4
}

function Get-WishlistExitCode {
    param([Parameter(Mandatory = $true)][string]$Status)

    $key = $Status.ToUpperInvariant()
    if ($script:StatusExitCodes.ContainsKey($key)) {
        return [int]$script:StatusExitCodes[$key]
    }
    return 1
}

function Invoke-WishlistGit {
    param(
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $output = @()
    $exitCode = 1
    try {
        $output = @(& git -C $RepoPath @Arguments 2>&1 | ForEach-Object { [string]$_ })
        $exitCode = [int]$LASTEXITCODE
    } catch {
        $output = @($_.Exception.Message)
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = @($output)
    }
}

function Get-WishlistGitValue {
    param(
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $result = Invoke-WishlistGit -RepoPath $RepoPath -Arguments $Arguments
    if ($result.ExitCode -ne 0) { return $null }
    return (($result.Output -join "`n").Trim())
}

function Get-WishlistChangedPaths {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$StatusLines)

    $changes = @()
    foreach ($line in @($StatusLines)) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -lt 3) { continue }
        $indexState = $line.Substring(0, 1)
        $worktreeState = $line.Substring(1, 1)
        $path = $line.Substring(3)
        if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1] }
        $changes += [pscustomobject]@{
            IndexState = $indexState
            WorktreeState = $worktreeState
            Path = $path
            IsUntracked = ($indexState -eq '?' -and $worktreeState -eq '?')
            IsStaged = ($indexState -ne ' ' -and $indexState -ne '?')
        }
    }
    return @($changes)
}

function Get-WishlistGitState {
    param([Parameter(Mandatory = $true)][string]$RepoPath)

    $resolvedPath = $RepoPath
    try {
        $resolvedPath = (Resolve-Path -LiteralPath $RepoPath -ErrorAction Stop).Path
    } catch {
        return [pscustomobject]@{
            RepositoryPath = $RepoPath; IsRepository = $false; IsWorktree = $false
            Branch = $null; IsDetached = $false; Head = $null; OriginDev = $null; OriginMain = $null
            StatusLines = @(); ChangedPaths = @(); IsClean = $false; Status = 'INFRA'
            Errors = @('Repository path does not exist.')
        }
    }

    $topLevel = Get-WishlistGitValue -RepoPath $resolvedPath -Arguments @('rev-parse', '--show-toplevel')
    if ([string]::IsNullOrWhiteSpace($topLevel)) {
        return [pscustomobject]@{
            RepositoryPath = $resolvedPath; IsRepository = $false; IsWorktree = $false
            Branch = $null; IsDetached = $false; Head = $null; OriginDev = $null; OriginMain = $null
            StatusLines = @(); ChangedPaths = @(); IsClean = $false; Status = 'INFRA'
            Errors = @('Path is not a Git repository.')
        }
    }

    $gitEntry = Join-Path $resolvedPath '.git'
    $isWorktree = Test-Path -LiteralPath $gitEntry -PathType Leaf
    $branch = Get-WishlistGitValue -RepoPath $resolvedPath -Arguments @('symbolic-ref', '--short', '-q', 'HEAD')
    $isDetached = [string]::IsNullOrWhiteSpace($branch)
    if ($isDetached) { $branch = '(detached)' }
    $head = Get-WishlistGitValue -RepoPath $resolvedPath -Arguments @('rev-parse', 'HEAD')
    $originDev = Get-WishlistGitValue -RepoPath $resolvedPath -Arguments @('rev-parse', '--verify', 'refs/remotes/origin/dev^{commit}')
    $originMain = Get-WishlistGitValue -RepoPath $resolvedPath -Arguments @('rev-parse', '--verify', 'refs/remotes/origin/main^{commit}')
    $statusResult = Invoke-WishlistGit -RepoPath $resolvedPath -Arguments @('status', '--porcelain=v1', '--untracked-files=all')
    $statusLines = @($statusResult.Output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $changedPaths = @(Get-WishlistChangedPaths -StatusLines $statusLines)

    $errors = @()
    if ($isWorktree) { $errors += 'The repository path is a Git worktree; use a normal clone for this workflow.' }
    if ($isDetached) { $errors += 'HEAD is detached; a feature/fix branch is required.' }
    if ([string]::IsNullOrWhiteSpace($originDev)) { $errors += 'refs/remotes/origin/dev is unavailable.' }
    if ([string]::IsNullOrWhiteSpace($originMain)) { $errors += 'refs/remotes/origin/main is unavailable.' }

    $status = 'PASS'
    if ($errors.Count -gt 0) {
        $status = 'INFRA'
    } elseif ($branch -ieq 'main' -or $branch -ieq 'dev') {
        $status = 'BLOCKED'
        $errors += 'Protected/integration branch is checked out; use a feature or fix branch.'
    } elseif ($changedPaths.Count -gt 0) {
        $status = 'BLOCKED'
        $errors += 'Working tree is not clean.'
    }

    return [pscustomobject]@{
        RepositoryPath = $resolvedPath
        IsRepository = $true
        IsWorktree = $isWorktree
        Branch = $branch
        IsDetached = $isDetached
        Head = $head
        OriginDev = $originDev
        OriginMain = $originMain
        StatusLines = @($statusLines)
        ChangedPaths = @($changedPaths)
        IsClean = ($changedPaths.Count -eq 0)
        Status = $status
        Errors = @($errors)
    }
}

Export-ModuleMember -Function Get-WishlistExitCode, Invoke-WishlistGit, Get-WishlistGitValue, Get-WishlistGitState
