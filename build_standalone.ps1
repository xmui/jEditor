$baseDir = "c:\Users\BoulderScanstation\Documents\rotating app"
$appDir = "$baseDir\app"
$outFile = "$baseDir\standalone.html"

# 1. Read Components
$html = Get-Content "$appDir\index.html" -Raw
$css = Get-Content "$appDir\style.css" -Raw
$script = Get-Content "$appDir\script.js" -Raw
$cropperCss = Get-Content "$appDir\cropper.min.css" -Raw
$cropperJs = Get-Content "$appDir\cropper.min.js" -Raw

# 2. Prepare HTML
# Remove existing link/script tags that we will inline
$html = $html -replace '<link rel="stylesheet" href="app/style.css">', ''
$html = $html -replace '<link rel="stylesheet" href="app/cropper.min.css">', ''
$html = $html -replace '<script src="app/cropper.min.js"></script>', ''
$html = $html -replace '<script src="script.js"></script>', ''

# Remove manifest link (standalone doesn't use it same way or it's embedded)
$html = $html -replace '<link rel="manifest" href="manifest.json">', ''

# 3. Inject CSS
$styleBlock = "<style>`n$cropperCss`n$css`n</style>"
$html = $html -replace '</head>', "$styleBlock`n</head>"

# 4. Inject JS
$scriptBlock = "<script>`n$cropperJs`n$script`n</script>"
$html = $html -replace '</body>', "$scriptBlock`n</body>"

# 5. Inject Icon Base64
$b64 = Get-Content "$baseDir\icon_b64.txt" -Raw
$b64 = $b64 -replace '\s+', ''
$html = $html -replace 'src="icon.png"', "src=""data:image/png;base64,$b64"""
$html = $html -replace 'href="icon.png"', "href=""data:image/png;base64,$b64"""

# 6. Write Output
$html | Set-Content $outFile -Encoding UTF8

Write-Host "Standalone build complete (with embedded icon)."
