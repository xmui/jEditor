# libheif for the engine's HEIC thumbnails (engine/src/heif.rs), from vcpkg,
# as DLLs (x64-windows): LGPL, so linked dynamically and shipped beside
# jeditor_engine.dll, where they can be replaced. src/jEditor.csproj finds
# them in $env:VCPKG_ROOT (or the runner's VCPKG_INSTALLATION_ROOT) and
# builds the engine with the feature heif.
#
# Decoding only: libde265 for HEVC. Not vcpkg's default `hevc` feature,
# which is the x265 encoder (GPL): checked below, never shipped.
#
#   ./scripts/engine-heif.ps1          (once; vcpkg caches what it built)
param([string]$Vcpkg = $(if ($env:VCPKG_ROOT) { $env:VCPKG_ROOT } else { $env:VCPKG_INSTALLATION_ROOT }))

$ErrorActionPreference = 'Stop'
if (-not $Vcpkg -or -not (Test-Path (Join-Path $Vcpkg 'vcpkg.exe'))) {
    throw "No vcpkg: install it (https://vcpkg.io) and set VCPKG_ROOT"
}
$exe = Join-Path $Vcpkg 'vcpkg.exe'
& $exe install 'libheif[core,libde265]:x64-windows' --recurse
if ($LASTEXITCODE -ne 0) { throw "vcpkg couldn't install libheif" }

$listed = & $exe list --x-full-desc
if ($listed -match '(?m)^x265[:\[]') { throw "x265 (GPL) is installed in $Vcpkg; jEditor mustn't ship it: vcpkg remove x265:x64-windows --recurse" }
$bin = Join-Path $Vcpkg 'installed\x64-windows\bin'
Write-Host "libheif's DLLs (shipped with the engine):"
Get-ChildItem $bin -Filter *.dll | ForEach-Object { Write-Host "  $($_.Name)" }
