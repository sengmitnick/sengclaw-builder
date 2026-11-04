$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$archives = @(Get-ChildItem (Join-Path $root 'hub/.runtime/releases/windows-portable') -Filter '*-windows-x64-portable.zip')
if ($archives.Count -ne 1) { throw 'Expected exactly one portable Windows ZIP.' }

function Assert-Signed([string]$file) {
    $sig = Get-AuthenticodeSignature -LiteralPath $file
    if ($sig.Status -ne 'Valid' -or !$sig.TimeStamperCertificate) {
        throw "Missing valid timestamped signature: $file"
    }
    if ($script:thumbprint -and $sig.SignerCertificate.Thumbprint -ne $script:thumbprint) {
        throw 'Signer mismatch between portable executables.'
    }
    $script:thumbprint = $sig.SignerCertificate.Thumbprint
    return $sig
}

$destination = Join-Path $env:RUNNER_TEMP 'Work Assistant portable test'
if (Test-Path $destination) { Remove-Item $destination -Recurse -Force }
Expand-Archive -LiteralPath $archives[0].FullName -DestinationPath $destination
$folders = @(Get-ChildItem $destination -Directory)
if ($folders.Count -ne 1) { throw 'Portable ZIP must contain one top-level folder.' }
$portable = $folders[0].FullName
$files = @('工作助手.exe', 'hub-sidecar.exe', 'meegle.exe', 'lark-cli.exe')
$signature = $null
foreach ($name in $files) {
    $file = Join-Path $portable $name
    if (!(Test-Path $file)) { throw "Portable ZIP did not contain $name" }
    $current = Assert-Signed $file
    if (!$signature) { $signature = $current }
}
$help = & (Join-Path $portable 'hub-sidecar.exe') --help
if ($LASTEXITCODE -ne 0 -or ($help -join "`n") -notmatch 'private desktop sidecar') {
    throw 'Portable sidecar startup failed.'
}
$toolchain = Get-Content (Join-Path $root 'hub/desktop/toolchain.lock.json') | ConvertFrom-Json
$meegle = & (Join-Path $portable 'meegle.exe') --version
$lark = & (Join-Path $portable 'lark-cli.exe') --version
if (($meegle -join ' ') -notmatch [regex]::Escape($toolchain.meegle.version)) { throw 'Meegle version mismatch.' }
if (($lark -join ' ') -notmatch [regex]::Escape($toolchain.'lark-cli'.version)) { throw 'Lark CLI version mismatch.' }

$receipt = [ordered]@{
    version = (Get-Content (Join-Path $root 'hub/desktop/package.json') | ConvertFrom-Json).version
    source_sha = (git -C (Join-Path $root 'hub') rev-parse HEAD)
    package = $archives[0].Name
    package_type = 'portable-zip'
    sha256 = (Get-FileHash $archives[0].FullName -Algorithm SHA256).Hash
    signer = $signature.SignerCertificate.Subject
    signer_thumbprint = $signature.SignerCertificate.Thumbprint
    signature_status = 'Valid'
    timestamped = $true
    signed_files = $files
    bundled_tool_versions = 'passed'
    portable_sidecar_startup = 'passed on windows-2022 runner'
    customer_machine_ui_acceptance = 'not yet verified'
    build_url = "https://github.com/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID"
}
$receipt | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $root 'hub-windows-receipt.json') -Encoding utf8
Write-Host 'Signed portable ZIP, executable signatures, tools and sidecar startup: PASS.'
