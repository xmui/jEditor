
$htmlPath = "standalone.html"
$b64Path = "icon_b64.txt"

# Read Base64 (trim whitespace just in case)
$b64 = [System.IO.File]::ReadAllText($b64Path).Trim()

# Construct the missing HTML block
$imgBlock = "<img src=""data:image/png;base64,$b64"" style=""width: 80px; height: 80px; border-radius: 16px; margin-bottom: 1.5rem; box-shadow: 0 10px 30px rgba(0,0,0,0.5);"">"
$h1Block = "<h1>jEditor 1.1.1</h1>"
$btnBlock = "<button id=""btn-browse-folder"" class=""browse-btn"">Open Folder</button>"
$pBlock = "<p class=""drop-hint"">or drag and drop images here</p>"

$fullBlock = "$imgBlock`n                $h1Block`n                $btnBlock`n                $pBlock"

# Read HTML
$content = [System.IO.File]::ReadAllText($htmlPath)

# Target the opening div tag
$target = "<div class=""drop-content"">"
# Append our block after the opening tag
$replacement = "$target`n                $fullBlock"

if ($content.Contains($target)) {
    # Check if we already patched it to avoid duplication if run multiple times (though h1 check failed before)
    if (-not $content.Contains("jEditor 1.1.1")) {
        $newContent = $content.Replace($target, $replacement)
        [System.IO.File]::WriteAllText($htmlPath, $newContent)
        Write-Host "Patched successfully: Restored landing page content."
    }
    else {
        Write-Host "Target content appears to be present already?"
    }
}
else {
    Write-Host "Anchor tag <div class='drop-content'> not found!"
}
