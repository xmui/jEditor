# Brings the runner's WebView2 runtime up to the one users have now (the
# Evergreen standalone installer installs the latest over an older one), so
# the smoke test runs on it. Runner images lag: WebView2 156 stopped the
# page writing under %LOCALAPPDATA% while some runners still had 155, and a
# pull request passed that the beta built from it then failed.
#
#   ./scripts/update-webview2.ps1
#
# A download that fails warns and goes on with the runner's own.

$ErrorActionPreference = 'Stop'
$key = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
function Version { try { (Get-ItemProperty $key -Name pv).pv } catch { 'none' } }

$before = Version
$setup = Join-Path ([IO.Path]::GetTempPath()) 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
try {
    Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/?linkid=2124701' -OutFile $setup -UseBasicParsing
    $p = Start-Process -FilePath $setup -ArgumentList '/silent', '/install' -Wait -PassThru
    Write-Host "WebView2 runtime: $before -> $(Version) (installer exit $($p.ExitCode))"
} catch {
    Write-Host "::warning::Couldn't update the WebView2 runtime ($($_.Exception.Message)); testing on $before"
}
