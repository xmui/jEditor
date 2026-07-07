$content = Get-Content "app/script.js" -TotalCount 1749
Set-Content -Path "app/script.js" -Value $content
Write-Host "Truncated app/script.js to 1749 lines."
