# Installs jEditor with its installer, checks it went in for this user only
# (no admin locations), runs the smoke test on the installed copy, updates
# it the way jEditor's updater does while its files are still busy (they
# must be waited for, not half-replaced and rolled back), then uninstalls
# and checks it's gone.
#
#   ./scripts/install-test.ps1 -Setup dist\jEditor-Setup-<ver>.exe

param([Parameter(Mandatory)][string]$Setup)

$ErrorActionPreference = 'Stop'
$appId = '{3DE12F63-EDF7-4FD0-B174-E0BD0FA2421E}_is1'
$dir = Join-Path $env:LOCALAPPDATA 'Programs\jEditor'
$exe = Join-Path $dir 'jEditor.exe'
$userKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appId"
$machineKeys = @("HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$appId",
                 "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\$appId")
function Fail($msg) { Write-Host "Install test FAILED: $msg"; exit 1 }

Write-Host "Installing $Setup"
$p = Start-Process -FilePath $Setup -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -PassThru -Wait
if ($p.ExitCode -ne 0) { Fail "the installer exited with $($p.ExitCode)" }
if (-not (Test-Path $exe)) { Fail "no $exe" }
if (-not (Test-Path (Join-Path $dir 'app\index.html'))) { Fail "no app\index.html beside the exe" }
if (-not (Test-Path $userKey)) { Fail "no uninstall entry in HKCU" }
foreach ($k in $machineKeys) { if (Test-Path $k) { Fail "an uninstall entry in HKLM ($k)" } }
if (Test-Path "$env:ProgramFiles\jEditor") { Fail "files in Program Files" }
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'jEditor.lnk'
if (-not (Test-Path $shortcut)) { Fail "no Start menu shortcut at $shortcut" }
Write-Host "Installed for this user: $dir"

& (Join-Path $PSScriptRoot 'smoke-test.ps1') -Exe $exe
if ($LASTEXITCODE -ne 0) { Fail "the smoke test failed on the installed copy" }

# An update while jEditor is still letting go of its files: jEditor.exe is
# held open (as by a process still exiting) for 4 s after the update starts
Write-Host "Updating while jEditor.exe is still busy"
$log = Join-Path $env:TEMP 'jeditor-update-test.log'
$hold = [System.IO.File]::Open($exe, 'Open', 'Read', 'None')
$started = Get-Date
$u = Start-Process -FilePath $Setup -ArgumentList '/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$log" -PassThru
Start-Sleep -Seconds 4
$hold.Close()
$u.WaitForExit()
$took = ((Get-Date) - $started).TotalSeconds
if ($u.ExitCode -ne 0) {
    Get-Content $log -Tail 30 | ForEach-Object { Write-Host "  $_" }
    Fail "the update exited with $($u.ExitCode) (rolled back?)"
}
if (Select-String -Path $log -Pattern 'Rolling back' -Quiet) { Fail "the update rolled back" }
if (-not (Select-String -Path $log -Pattern 'Installation process succeeded' -Quiet)) { Fail "the update's log doesn't say it succeeded" }
if ($took -lt 4) { Fail "the update didn't wait for jEditor.exe ($([int]$took) s)" }
Write-Host "Update waited for the busy file and installed ($([int]$took) s)"

Write-Host "Uninstalling"
$uninstaller = (Get-ItemProperty $userKey).UninstallString.Trim('"')
Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait
# The uninstaller hands over to a copy of itself and returns early
for ($i = 0; $i -lt 60 -and ((Test-Path $exe) -or (Test-Path $userKey)); $i++) { Start-Sleep -Milliseconds 500 }
if (Test-Path $exe) { Fail "$exe is still there after uninstalling" }
if (Test-Path $userKey) { Fail "the uninstall entry is still there" }
if (Test-Path $shortcut) { Fail "the Start menu shortcut is still there" }
Write-Host "Install test passed"
