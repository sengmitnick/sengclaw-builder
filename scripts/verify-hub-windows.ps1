$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$release = Join-Path $root 'hub/desktop/src-tauri/target/release'
$installers = @(Get-ChildItem (Join-Path $release 'bundle/nsis') -Filter '*-setup.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS installer.' }
function Assert-Signed([string]$file) {
    $sig = Get-AuthenticodeSignature -LiteralPath $file
    if ($sig.Status -ne 'Valid' -or !$sig.TimeStamperCertificate) {
        throw "Missing valid timestamped signature: $file"
    }
    if ($script:thumbprint -and $sig.SignerCertificate.Thumbprint -ne $script:thumbprint) {
        throw 'Signer mismatch between installer and installed payload.'
    }
    $script:thumbprint = $sig.SignerCertificate.Thumbprint
    return $sig
}
$signature = Assert-Signed $installers[0].FullName
$destination = Join-Path $env:RUNNER_TEMP 'Hub signed install test'
if (Test-Path $destination) { throw 'Install destination must be fresh.' }
# NSIS requires /D to be the final argument without quotes, even with spaces.
$process = Start-Process -FilePath $installers[0].FullName -ArgumentList "/S /D=$destination" -PassThru
if (!$process.WaitForExit(120000)) { $process.Kill(); throw 'NSIS installation timed out.' }
if ($process.ExitCode -ne 0) { throw "NSIS installation failed: $($process.ExitCode)" }
$files = @('sengclaw-hub-desktop.exe', 'hub-sidecar.exe', 'uninstall.exe')
foreach ($name in $files) {
    $installed = Join-Path $destination $name
    if (!(Test-Path $installed)) { throw "Installer did not create $name" }
    $null = Assert-Signed $installed
}
$help = & (Join-Path $destination 'hub-sidecar.exe') --help
if ($LASTEXITCODE -ne 0 -or ($help -join "`n") -notmatch 'SengClaw Hub private desktop sidecar') {
    throw 'Installed sidecar startup failed.'
}
$receipt = [ordered]@{
    version = (Get-Content (Join-Path $root 'hub/desktop/package.json') | ConvertFrom-Json).version
    source_sha = (git -C (Join-Path $root 'hub') rev-parse HEAD)
    installer = $installers[0].Name
    sha256 = (Get-FileHash $installers[0].FullName -Algorithm SHA256).Hash
    signer = $signature.SignerCertificate.Subject
    signer_thumbprint = $signature.SignerCertificate.Thumbprint
    signature_status = 'Valid'
    timestamped = $true
    silent_install = 'passed on windows-2022 runner'
    installed_signatures = $files
    installed_sidecar_startup = 'passed'
    customer_machine_ui_acceptance = 'not yet verified'
    build_url = "https://github.com/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID"
}
$receipt | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $root 'hub-windows-receipt.json') -Encoding utf8
Write-Host 'Signed NSIS installer, installed payload signatures and sidecar startup: PASS.'
