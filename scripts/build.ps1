# Builds jEditor for Windows into dist\:
#   dist\publish\                      jEditor.exe + app\ (the UI)
#   dist\jEditor-<ver>-portable.zip    the same, zipped: unzip anywhere and run
#   dist\jEditor-Setup-<ver>.exe       the per-user installer (no admin)
#
#   ./scripts/build.ps1                  everything
#   ./scripts/build.ps1 -SkipInstaller   no Inno Setup needed
#
# <ver> is jEditor's version, from jeditor\app\version.js.

param([switch]$SkipInstaller)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$publish = Join-Path $dist 'publish'

$versionJs = Join-Path $root 'jeditor\app\version.js'
if (-not (Test-Path $versionJs)) { throw "jEditor's UI is missing. Run: git submodule update --init" }
$version = [regex]::Match((Get-Content $versionJs -Raw), "APP_VERSION = '([0-9.]+)'").Groups[1].Value
if (-not $version) { throw "No APP_VERSION in $versionJs" }
Write-Host "jEditor $version"

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
dotnet publish (Join-Path $root 'src\jEditor.csproj') -c Release -o $publish
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

# Portable zip: a jEditor folder with the exe and the UI
$stage = Join-Path $dist 'stage\jEditor'
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item (Join-Path $publish '*') $stage -Recurse
$zip = Join-Path $dist "jEditor-$version-portable.zip"
Compress-Archive -Path $stage -DestinationPath $zip
Remove-Item (Join-Path $dist 'stage') -Recurse -Force
Write-Host "Built $zip"

if ($SkipInstaller) { return }

$iscc = (Get-Command iscc.exe -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
    $iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
              "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $iscc) { throw "Inno Setup 6 not found (https://jrsoftware.org/isdl.php, or: choco install innosetup)" }
& $iscc /Q "/DAppVersion=$version" "/DPublishDir=$publish" "/DOutputDir=$dist" (Join-Path $root 'installer\jEditor.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }
Write-Host "Built $(Join-Path $dist "jEditor-Setup-$version.exe")"
