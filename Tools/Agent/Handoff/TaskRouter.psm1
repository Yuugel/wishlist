Set-StrictMode -Version 2.0

$script:DefaultRoutingConfigPath = Join-Path $PSScriptRoot 'routing.json'

function Get-WishlistObjectProperty {
    param(
        [AllowNull()]
        [object]$Object,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }

    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) {
            return $Object[$Name]
        }
        return $null
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

function ConvertTo-WishlistComparableValue {
    param([AllowNull()][object]$Value)

    if ($null -eq $Value) {
        return ''
    }

    return ([string]$Value).Trim().ToLowerInvariant().Replace('_', '-').Replace(' ', '-')
}

function Get-WishlistRoutingConfig {
    [CmdletBinding()]
    param(
        [string]$Path = $script:DefaultRoutingConfigPath
    )

    try {
        $resolvedPath = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
        $json = Get-Content -LiteralPath $resolvedPath -Raw -ErrorAction Stop
        return ($json | ConvertFrom-Json -ErrorAction Stop)
    } catch {
        throw "Unable to load routing configuration '$Path': $($_.Exception.Message)"
    }
}

function Get-WishlistTaskFieldValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$TaskDefinition,

        [Parameter(Mandatory = $true)]
        [string]$FieldName
    )

    switch ($FieldName.ToLowerInvariant()) {
        'risk' { return Get-WishlistObjectProperty -Object $TaskDefinition -Name 'Risk' }
        'type' { return Get-WishlistObjectProperty -Object $TaskDefinition -Name 'Type' }
        'scope' { return Get-WishlistObjectProperty -Object $TaskDefinition -Name 'Scope' }
        'project' { return Get-WishlistObjectProperty -Object $TaskDefinition -Name 'Project' }
        'ticket' { return Get-WishlistObjectProperty -Object $TaskDefinition -Name 'Ticket' }
        'model' { return Get-WishlistObjectProperty -Object $TaskDefinition -Name 'RequestedModel' }
        'requestedmodel' { return Get-WishlistObjectProperty -Object $TaskDefinition -Name 'RequestedModel' }
        default {
            $metadata = Get-WishlistObjectProperty -Object $TaskDefinition -Name 'Metadata'
            if ($null -ne $metadata) {
                return Get-WishlistObjectProperty -Object $metadata -Name $FieldName
            }
            return $null
        }
    }
}

function Test-WishlistRouteMatch {
    param(
        [Parameter(Mandatory = $true)]
        [object]$TaskDefinition,

        [AllowNull()]
        [object]$When
    )

    if ($null -eq $When) {
        return $true
    }

    $properties = @($When.PSObject.Properties)
    if ($properties.Count -eq 0) {
        return $true
    }

    foreach ($property in $properties) {
        $taskValue = ConvertTo-WishlistComparableValue (Get-WishlistTaskFieldValue -TaskDefinition $TaskDefinition -FieldName $property.Name)
        $routeValue = $property.Value
        $routeValues = @()
        if ($routeValue -is [System.Array]) {
            $routeValues = @($routeValue)
        } else {
            $routeValues = @($routeValue)
        }

        $matched = $false
        foreach ($candidate in $routeValues) {
            if ((ConvertTo-WishlistComparableValue $candidate) -eq $taskValue) {
                $matched = $true
                break
            }
        }

        if (-not $matched) {
            return $false
        }
    }

    return $true
}

function Find-WishlistModelDefinition {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$RequestedModel
    )

    $models = Get-WishlistObjectProperty -Object $Config -Name 'models'
    if ($null -eq $models) {
        return $null
    }

    $wanted = ConvertTo-WishlistComparableValue $RequestedModel
    foreach ($property in @($models.PSObject.Properties)) {
        $model = $property.Value
        $candidates = @($property.Name)
        $aliases = Get-WishlistObjectProperty -Object $model -Name 'aliases'
        if ($null -ne $aliases) {
            $candidates += @($aliases)
        }

        foreach ($candidate in @($candidates)) {
            if ((ConvertTo-WishlistComparableValue $candidate) -eq $wanted) {
                $modelKey = [string]$property.Name
                $model | Add-Member -NotePropertyName 'ModelKey' -NotePropertyValue $modelKey -Force
                return $model
            }
        }
    }

    return $null
}

function New-WishlistSessionId {
    [CmdletBinding()]
    param(
        [AllowNull()]
        [string]$Project,

        [AllowNull()]
        [string]$Ticket,

        [AllowNull()]
        [string]$Scope,

        [AllowNull()]
        [string]$Body,

        [AllowNull()]
        [string]$ExplicitSession
    )

    function ConvertTo-SessionPart {
        param(
            [AllowNull()]
            [string]$Value,

            [Parameter(Mandatory = $true)]
            [string]$Fallback
        )

        if ([string]::IsNullOrWhiteSpace($Value)) {
            return $Fallback
        }

        $part = $Value.Trim()
        $part = [regex]::Replace($part, '([a-z0-9])([A-Z])', '$1-$2')
        $part = [regex]::Replace($part, '[^A-Za-z0-9]+', '-')
        $part = $part.Trim('-').ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($part)) {
            return $Fallback
        }

        if ($part.Length -gt 42) {
            $part = $part.Substring(0, 42).Trim('-')
        }

        return $part
    }

    $projectPart = ConvertTo-SessionPart -Value $Project -Fallback 'wishlist-project'
    if (-not [string]::IsNullOrWhiteSpace($ExplicitSession)) {
        $requestedSession = $ExplicitSession.Trim()
        if ($requestedSession -ieq 'new') {
            $nonce = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmssfff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
            return "$projectPart-new-$nonce"
        }

        if ($requestedSession -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$') {
            throw "Explicit session '$ExplicitSession' is invalid for Pi --session-id. Use only alphanumeric characters, '-', '_', or '.', with an alphanumeric first and last character."
        }

        $explicitPart = ConvertTo-SessionPart -Value $requestedSession -Fallback 'session'
        return "$projectPart-$explicitPart"
    }

    if (-not [string]::IsNullOrWhiteSpace($Ticket)) {
        $ticketPart = ConvertTo-SessionPart -Value $Ticket -Fallback 'unticketed'
        return "$projectPart-$ticketPart"
    }

    $scopePart = ConvertTo-SessionPart -Value $Scope -Fallback 'general'
    $hashInput = "$Project|$Scope|$Body"
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($hashInput)
        $hash = $sha.ComputeHash($bytes)
        $hashPart = ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant().Substring(0, 10)
    } finally {
        $sha.Dispose()
    }

    $timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmssfff')
    $nonce = [Guid]::NewGuid().ToString('N').Substring(0, 8)
    return "$projectPart-adhoc-$scopePart-$timestamp-$hashPart-$nonce"
}

function Get-WishlistSkillSelection {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [object]$TaskDefinition,

        [AllowNull()]
        [object]$SelectedRoute
    )

    $skills = New-Object 'System.Collections.Generic.List[string]'
    $routeSkills = if ($null -eq $SelectedRoute) { $null } else { Get-WishlistObjectProperty -Object $SelectedRoute -Name 'skills' }
    foreach ($skill in @($routeSkills)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$skill) -and -not $skills.Contains([string]$skill)) {
            $skills.Add([string]$skill)
        }
    }

    $skillRules = Get-WishlistObjectProperty -Object $Config -Name 'skillRules'
    foreach ($rule in @($skillRules)) {
        if (Test-WishlistRouteMatch -TaskDefinition $TaskDefinition -When (Get-WishlistObjectProperty -Object $rule -Name 'when')) {
            $ruleSkills = Get-WishlistObjectProperty -Object $rule -Name 'skills'
            foreach ($skill in @($ruleSkills)) {
                if (-not [string]::IsNullOrWhiteSpace([string]$skill) -and -not $skills.Contains([string]$skill)) {
                    $skills.Add([string]$skill)
                }
            }
        }
    }

    return @($skills | ForEach-Object { $_ })
}

function New-WishlistBlockedRoute {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Reason,

        [AllowNull()]
        [object]$TaskDefinition,

        [string]$RequestedModel = ''
    )

    return [pscustomobject]@{
        Status = 'BLOCKED'
        Reason = $Reason
        RequestedModel = $RequestedModel
        ModelKey = $null
        ModelName = $null
        Provider = $null
        LauncherTarget = $null
        Thinking = $null
        Skills = @()
        SessionId = $null
        Automatic = $false
        Definition = $TaskDefinition
    }
}

function Resolve-WishlistRoute {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [object]$TaskDefinition,

        [object]$Config,

        [switch]$AllowAstra
    )

    if ($null -eq $Config) {
        $Config = Get-WishlistRoutingConfig
    }

    $requestedModel = [string](Get-WishlistObjectProperty -Object $TaskDefinition -Name 'RequestedModel')
    if ([string]::IsNullOrWhiteSpace($requestedModel)) {
        $requestedModel = 'auto'
    }
    $requestedModel = $requestedModel.Trim().ToLowerInvariant()
    $selectedModel = $null
    $selectedRoute = $null
    $automatic = ($requestedModel -eq 'auto')

    if ($automatic) {
        $routes = Get-WishlistObjectProperty -Object $Config -Name 'automaticRoutes'
        foreach ($route in @($routes)) {
            if (Test-WishlistRouteMatch -TaskDefinition $TaskDefinition -When (Get-WishlistObjectProperty -Object $route -Name 'when')) {
                $selectedRoute = $route
                $routeModelKey = [string](Get-WishlistObjectProperty -Object $route -Name 'model')
                $selectedModel = Find-WishlistModelDefinition -Config $Config -RequestedModel $routeModelKey
                break
            }
        }

        if ($null -eq $selectedRoute -or $null -eq $selectedModel) {
            return New-WishlistBlockedRoute -Reason 'No valid automatic route matched the task.' -TaskDefinition $TaskDefinition -RequestedModel $requestedModel
        }
    } else {
        $selectedModel = Find-WishlistModelDefinition -Config $Config -RequestedModel $requestedModel
        if ($null -eq $selectedModel) {
            return New-WishlistBlockedRoute -Reason "Requested model '$requestedModel' is not configured; no fallback was launched." -TaskDefinition $TaskDefinition -RequestedModel $requestedModel
        }
    }

    $enabled = Get-WishlistObjectProperty -Object $selectedModel -Name 'enabled'
    if ($false -eq [bool]$enabled) {
        return New-WishlistBlockedRoute -Reason "Model '$($selectedModel.ModelKey)' is disabled in routing configuration." -TaskDefinition $TaskDefinition -RequestedModel $requestedModel
    }

    $guarded = [bool](Get-WishlistObjectProperty -Object $selectedModel -Name 'guarded')
    $policy = Get-WishlistObjectProperty -Object $Config -Name 'guardedModelPolicy'
    $allowExplicitGuarded = [bool](Get-WishlistObjectProperty -Object $policy -Name 'allowExplicitWithFlag')
    $allowAutomaticGuarded = [bool](Get-WishlistObjectProperty -Object $policy -Name 'allowAutomatic')
    if ($guarded) {
        if ($automatic -and -not $allowAutomaticGuarded) {
            return New-WishlistBlockedRoute -Reason "Guarded model '$($selectedModel.ModelKey)' is never selected automatically." -TaskDefinition $TaskDefinition -RequestedModel $requestedModel
        }
        if (-not $automatic -and (-not $AllowAstra -or -not $allowExplicitGuarded)) {
            return New-WishlistBlockedRoute -Reason "Guarded model '$($selectedModel.ModelKey)' requires the explicit allow flag and guarded policy." -TaskDefinition $TaskDefinition -RequestedModel $requestedModel
        }
    }

    $modelName = [string](Get-WishlistObjectProperty -Object $selectedModel -Name 'displayName')
    if ([string]::IsNullOrWhiteSpace($modelName)) {
        $modelName = [string]$selectedModel.ModelKey
    }
    $launcherTarget = [string](Get-WishlistObjectProperty -Object $selectedModel -Name 'launcherTarget')
    $provider = [string](Get-WishlistObjectProperty -Object $selectedModel -Name 'provider')
    $thinking = [string](Get-WishlistObjectProperty -Object $selectedModel -Name 'thinking')
    $reason = [string](Get-WishlistObjectProperty -Object $selectedRoute -Name 'reason')
    if ([string]::IsNullOrWhiteSpace($reason)) {
        if ($automatic) {
            $reason = "Automatic route selected '$($selectedModel.ModelKey)' from task metadata."
        } else {
            $reason = "Explicit model request selected '$($selectedModel.ModelKey)'."
        }
    }

    $sessionOverride = [string](Get-WishlistTaskFieldValue -TaskDefinition $TaskDefinition -FieldName 'session')
    $sessionId = $null
    try {
        $sessionId = New-WishlistSessionId `
            -Project ([string](Get-WishlistObjectProperty -Object $TaskDefinition -Name 'Project')) `
            -Ticket ([string](Get-WishlistObjectProperty -Object $TaskDefinition -Name 'Ticket')) `
            -Scope ([string](Get-WishlistObjectProperty -Object $TaskDefinition -Name 'Scope')) `
            -Body ([string](Get-WishlistObjectProperty -Object $TaskDefinition -Name 'Body')) `
            -ExplicitSession $sessionOverride
    } catch {
        return New-WishlistBlockedRoute -Reason $_.Exception.Message -TaskDefinition $TaskDefinition -RequestedModel $requestedModel
    }

    return [pscustomobject]@{
        Status = 'PASS'
        Reason = $reason
        RequestedModel = $requestedModel
        ModelKey = [string]$selectedModel.ModelKey
        ModelName = $modelName
        Provider = $provider
        LauncherTarget = $launcherTarget
        Thinking = $thinking
        Skills = @(Get-WishlistSkillSelection -Config $Config -TaskDefinition $TaskDefinition -SelectedRoute $selectedRoute)
        SessionId = $sessionId
        Automatic = $automatic
        Definition = $TaskDefinition
    }
}

Export-ModuleMember -Function Get-WishlistRoutingConfig, New-WishlistSessionId, Get-WishlistSkillSelection, Resolve-WishlistRoute
