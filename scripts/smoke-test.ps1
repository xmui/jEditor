# Runs jEditor's smoke test: makes a folder of photos, then
#   jEditor.exe --smoke-test <folder> --log <file>
# which opens it in jEditor, rotates a photo and checks it was saved.
#
#   ./scripts/smoke-test.ps1                        dist\publish\jEditor.exe
#   ./scripts/smoke-test.ps1 -Exe <path>\jEditor.exe

param([string]$Exe = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\publish\jEditor.exe'))

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Exe)) { throw "No $Exe; run scripts/build.ps1 first" }

# In the user's folder, where orders are (Pictures, Documents): not under
# %LOCALAPPDATA% (the temp folder), where WebView2 156 stops the page writing
$work = Join-Path $env:USERPROFILE ("jeditor-smoke-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$photos = Join-Path $work 'Smoke Order'
New-Item -ItemType Directory -Force $photos | Out-Null

# Three small JPEGs, like a scanner's: no orientation tag
Add-Type -AssemblyName System.Drawing
foreach ($i in 1..3) {
    $bmp = New-Object System.Drawing.Bitmap 160, 120
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::FromArgb(40 * $i, 120, 200 - 40 * $i))
    $g.Dispose()
    $bmp.Save((Join-Path $photos ("scan_{0:D4}.jpg" -f $i)), [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()
}

$log = Join-Path $work 'smoke.log'
Write-Host "Smoke test: $Exe on $photos"
$p = Start-Process -FilePath $Exe -ArgumentList @('--smoke-test', "`"$photos`"", '--log', "`"$log`"") -PassThru
if (-not $p.WaitForExit(150000)) {
    $p.Kill()
    Write-Host "jEditor didn't exit within 150 s"
    $code = 3
} else {
    $code = $p.ExitCode
}
if (Test-Path $log) { Get-Content $log | ForEach-Object { Write-Host "  $_" } } else { Write-Host "  (no log written)" }
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
if ($code -ne 0) { Write-Host "Smoke test FAILED (exit code $code)"; exit 1 }
Write-Host "Smoke test passed"
exit 0
