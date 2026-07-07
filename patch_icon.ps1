
$htmlPath = "standalone.html"
$b64Path = "icon_b64.txt"

$b64 = [System.IO.File]::ReadAllText($b64Path)
$imgTag = "<img src=""data:image/png;base64,$b64"" style=""width: 80px; height: 80px; border-radius: 16px; margin-bottom: 1.5rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5);"">"

$content = [System.IO.File]::ReadAllText($htmlPath)
$target = "<h1>jEditor 1.1.1</h1>"
$replacement = "$imgTag`n                $target"

if ($content.Contains($target)) {
    $newContent = $content.Replace($target, $replacement)
    [System.IO.File]::WriteAllText($htmlPath, $newContent)
    Write-Host "Patched successfully"
} else {
    Write-Host "Target not found!"
}
