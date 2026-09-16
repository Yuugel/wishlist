Set-StrictMode -Version 2.0

$script:TaskMarker = '@@PI_TASK'
$script:KnownRisks = @('low', 'medium', 'high', 'architecture-sensitive')

function New-WishlistParseResult {
    param(
        [bool]$IsValid,
        [string]$Status,
        [string[]]$Errors,
        [string[]]$Warnings,
        [object]$Definition
    )

    return [pscustomobject]@{
        IsValid = $IsValid
        Status = $Status
        Errors = @($Errors)
        Warnings = @($Warnings)
        Definition = $Definition
    }
}

function Get-WishlistMetadataValue {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Metadata,

        [Parameter(Mandatory = $true)]
        [string[]]$Keys
    )

    foreach ($key in $Keys) {
        if ($Metadata.Contains($key)) {
            return [string]$Metadata[$key]
        }
    }

    return $null
}

function Normalize-WishlistRisk {
    param(
        [string]$Value,
        [System.Collections.Generic.List[string]]$Warnings
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        $Warnings.Add('risk was omitted; defaulted conservatively to medium.')
        return 'medium'
    }

    $normalized = $Value.Trim().ToLowerInvariant()
    $aliases = @{
        'architecture_sensitive' = 'architecture-sensitive'
        'architecture sensitive' = 'architecture-sensitive'
        'arch-sensitive' = 'architecture-sensitive'
    }
    if ($aliases.ContainsKey($normalized)) {
        $normalized = $aliases[$normalized]
    }

    if ($script:KnownRisks -contains $normalized) {
        return $normalized
    }

    $Warnings.Add("unknown risk '$Value' was treated as high for safe routing.")
    return 'high'
}

function Normalize-WishlistDependencies {
    param(
        [AllowNull()][string]$Value,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$Errors
    )

    if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Trim() -eq '-') {
        return @()
    }

    $dependencies = New-Object 'System.Collections.Generic.List[object]'
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($rawPart in $Value.Split(',')) {
        $part = $rawPart.Trim()
        if ([string]::IsNullOrWhiteSpace($part)) {
            $Errors.Add("DEPENDENCY_INVALID: depends-on contains an empty ticket value in '$Value'.") | Out-Null
            continue
        }
        if ($part -notmatch '^\d+$') {
            $Errors.Add("DEPENDENCY_INVALID: dependency '$part' must be a positive numeric ticket number.") | Out-Null
            continue
        }

        try {
            $number = [int64]::Parse($part, [Globalization.CultureInfo]::InvariantCulture)
        } catch {
            $Errors.Add("DEPENDENCY_INVALID: dependency '$part' is outside the supported numeric ticket range.") | Out-Null
            continue
        }
        if ($number -le 0) {
            $Errors.Add("DEPENDENCY_INVALID: dependency '$part' must be greater than zero.") | Out-Null
            continue
        }

        $key = $number.ToString([Globalization.CultureInfo]::InvariantCulture)
        if ($seen.Add($key)) {
            $dependencies.Add($number) | Out-Null
        }
    }

    return [int64[]]$dependencies.ToArray()
}

function Get-WishlistPositiveTicketNumber {
    param([AllowNull()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Trim() -notmatch '^\d+$') {
        return $null
    }
    try {
        $number = [int64]::Parse($Value.Trim(), [Globalization.CultureInfo]::InvariantCulture)
    } catch {
        return $null
    }
    if ($number -le 0) { return $null }
    return $number
}

function Parse-WishlistTask {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Text
    )

    $errors = New-Object 'System.Collections.Generic.List[string]'
    $warnings = New-Object 'System.Collections.Generic.List[string]'

    if ($null -eq $Text) {
        return New-WishlistParseResult -IsValid $false -Status 'BLOCKED' -Errors @('Task input is null; unmarked input is ignored.') -Warnings @() -Definition $null
    }

    $normalizedText = $Text
    if ($normalizedText.Length -gt 0 -and [int][char]$normalizedText[0] -eq 0xFEFF) {
        $normalizedText = $normalizedText.Substring(1)
    }

    $normalizedText = $normalizedText -replace "`r`n?", "`n"
    $lines = [regex]::Split($normalizedText, "`n")
    if ($lines.Count -eq 0 -or $lines[0] -notmatch '^@@PI_TASK(?:\s*)$') {
        return New-WishlistParseResult -IsValid $false -Status 'BLOCKED' -Errors @('Input does not begin with the required @@PI_TASK marker; input was ignored.') -Warnings @() -Definition $null
    }

    $metadata = [ordered]@{}
    $blankLineIndex = -1
    for ($index = 1; $index -lt $lines.Count; $index++) {
        if ([string]::IsNullOrWhiteSpace($lines[$index])) {
            $blankLineIndex = $index
            break
        }

        $headerLine = $lines[$index]
        if ($headerLine -notmatch '^\s*([A-Za-z][A-Za-z0-9_.-]*)\s*:\s*(.*?)\s*$') {
            $errors.Add("Malformed metadata header at line $($index + 1): '$headerLine'. Expected key: value.")
            continue
        }

        $key = $matches[1]
        $value = $matches[2].Trim()
        if ($metadata.Contains($key)) {
            $errors.Add("Duplicate metadata field '$key' at line $($index + 1).")
            continue
        }

        $metadata[$key] = $value
    }

    if ($blankLineIndex -lt 0) {
        $errors.Add('Task body separator is missing; metadata must end at the first blank line.')
        $blankLineIndex = $lines.Count
    }

    $body = ''
    if ($blankLineIndex -lt $lines.Count) {
        if ($blankLineIndex + 1 -lt $lines.Count) {
            $body = (($lines[($blankLineIndex + 1)..($lines.Count - 1)]) -join "`n").Trim()
        }
    }

    if ([string]::IsNullOrWhiteSpace($body)) {
        $errors.Add('Task body must not be empty.')
    }

    $project = Get-WishlistMetadataValue -Metadata $metadata -Keys @('project')
    if ([string]::IsNullOrWhiteSpace($project)) {
        $errors.Add("Required metadata field 'project' is missing or empty.")
    }

    $risk = Normalize-WishlistRisk -Value (Get-WishlistMetadataValue -Metadata $metadata -Keys @('risk')) -Warnings $warnings
    if ($errors.Count -gt 0) {
        return New-WishlistParseResult -IsValid $false -Status 'BLOCKED' -Errors @($errors | ForEach-Object { $_ }) -Warnings @($warnings | ForEach-Object { $_ }) -Definition $null
    }

    $ticket = Get-WishlistMetadataValue -Metadata $metadata -Keys @('ticket')
    $taskType = Get-WishlistMetadataValue -Metadata $metadata -Keys @('type')
    $scope = Get-WishlistMetadataValue -Metadata $metadata -Keys @('scope')
    $requestedModel = Get-WishlistMetadataValue -Metadata $metadata -Keys @('model', 'requested-model', 'requested_model')
    $protocolVersion = Get-WishlistMetadataValue -Metadata $metadata -Keys @('protocol-version', 'protocol_version', 'version')
    $dependencies = Normalize-WishlistDependencies `
        -Value (Get-WishlistMetadataValue -Metadata $metadata -Keys @('depends-on', 'depends_on', 'dependson')) `
        -Errors $errors

    $ticketNumber = Get-WishlistPositiveTicketNumber -Value $ticket
    if ($null -ne $ticketNumber) {
        foreach ($dependency in @($dependencies)) {
            if ([int64]$dependency -eq [int64]$ticketNumber) {
                $errors.Add("SELF_DEPENDENCY: ticket $ticket depends on itself.") | Out-Null
                break
            }
        }
    }

    if ($errors.Count -gt 0) {
        return New-WishlistParseResult -IsValid $false -Status 'BLOCKED' -Errors @($errors | ForEach-Object { $_ }) -Warnings @($warnings | ForEach-Object { $_ }) -Definition $null
    }

    if ([string]::IsNullOrWhiteSpace($taskType)) {
        $taskType = 'implementation'
    } else {
        $taskType = $taskType.Trim().ToLowerInvariant()
    }
    if ([string]::IsNullOrWhiteSpace($scope)) {
        $scope = 'general'
    } else {
        $scope = $scope.Trim().ToLowerInvariant()
    }
    if ([string]::IsNullOrWhiteSpace($requestedModel)) {
        $requestedModel = 'auto'
    } else {
        $requestedModel = $requestedModel.Trim().ToLowerInvariant()
    }
    if ([string]::IsNullOrWhiteSpace($protocolVersion)) {
        $protocolVersion = '1'
    } else {
        $protocolVersion = $protocolVersion.Trim()
    }

    $normalizedDependencies = [int64[]]@()
    if ($null -ne $dependencies) { $normalizedDependencies = [int64[]]$dependencies }

    $definition = [pscustomobject]@{
        Marker = $script:TaskMarker
        ProtocolVersion = $protocolVersion
        Project = $project.Trim()
        Ticket = if ($null -eq $ticket) { '' } else { $ticket.Trim() }
        Type = $taskType
        Scope = $scope
        Risk = $risk
        RequestedModel = $requestedModel
        Dependencies = $normalizedDependencies
        Body = $body
        Metadata = $metadata
        RawText = $Text
    }

    return New-WishlistParseResult -IsValid $true -Status 'PASS' -Errors @() -Warnings @($warnings | ForEach-Object { $_ }) -Definition $definition
}

Export-ModuleMember -Function Parse-WishlistTask
