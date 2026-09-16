param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

if (@($Arguments) -contains '--help') {
    Write-Output 'fake-pi-unicode help'
    exit 0
}

$text = -join @(
    [char]0x0070, [char]0x0072, [char]0x0069, [char]0x006D, [char]0x00E4,
    [char]0x0072, [char]0x0065, [char]0x0072, [char]0x0020, [char]0x2014,
    [char]0x0020, [char]0x00C4, [char]0x006E, [char]0x0064, [char]0x0065,
    [char]0x0072, [char]0x0075, [char]0x006E, [char]0x0067, [char]0x0065,
    [char]0x006E, [char]0x002C, [char]0x0020, [char]0x0047, [char]0x0072,
    [char]0x00F6, [char]0x00DF, [char]0x0065, [char]0x002C, [char]0x0020,
    [char]0x007A, [char]0x0075, [char]0x0072, [char]0x00FC, [char]0x0063,
    [char]0x006B
)
$isJson = (@($Arguments) -contains '--mode') -and (@($Arguments) -contains 'json')
$outputText = if ($isJson) {
    @(
        '{"type":"session","version":3,"id":"unicode-fixture"}'
        '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"' + $text + '"}]}}'
        '{"type":"agent_end","messages":[{"role":"assistant","content":[{"type":"text","text":"' + $text + '"}]}]}'
    ) -join [Environment]::NewLine
} else {
    $text
}
$bytes = [System.Text.Encoding]::UTF8.GetBytes($outputText)
$standardOutput = [Console]::OpenStandardOutput()
$standardOutput.Write($bytes, 0, $bytes.Length)
$standardOutput.Flush()
$errorBytes = [System.Text.Encoding]::UTF8.GetBytes($text)
$standardError = [Console]::OpenStandardError()
$standardError.Write($errorBytes, 0, $errorBytes.Length)
$standardError.Flush()
exit 0
