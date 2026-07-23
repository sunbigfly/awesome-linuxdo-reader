$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$manifestPath = Join-Path $projectRoot 'tools/userscript-dev/Cargo.toml'
$cargoCommand = Get-Command cargo -ErrorAction SilentlyContinue

if ($null -eq $cargoCommand) {
    Write-Output '{"ok":false,"command":"launcher","error":{"kind":"missing_dependency","message":"Rust Cargo is required. Install Rust from https://rustup.rs/ and retry."}}'
    exit 2
}

$previousLocation = Get-Location
$previousTargetDir = $env:CARGO_TARGET_DIR
$exitCode = 2

try {
    Set-Location -LiteralPath $projectRoot
    $env:CARGO_TARGET_DIR = Join-Path ([System.IO.Path]::GetTempPath()) 'awesome-linuxdo-reader-userscript-dev-target'
    & cargo run --quiet --locked --manifest-path $manifestPath -- @args
    $exitCode = $LASTEXITCODE
}
finally {
    Set-Location -LiteralPath $previousLocation
    if ($null -eq $previousTargetDir) {
        Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
    }
    else {
        $env:CARGO_TARGET_DIR = $previousTargetDir
    }
}

exit $exitCode
