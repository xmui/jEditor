$port = 8080
$root = Join-Path $PSScriptRoot "app"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host "Server started at http://localhost:$port/"
Write-Host "Press Ctrl+C to stop."

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $path = $request.Url.LocalPath
    if ($path -eq "/") { $path = "/index.html" }
    
    $localPath = Join-Path $root $path.TrimStart('/')
    
    if (Test-Path $localPath -PathType Leaf) {
        $content = [System.IO.File]::ReadAllBytes($localPath)
        $extension = [System.IO.Path]::GetExtension($localPath)
        
        switch ($extension) {
            ".html" { $response.ContentType = "text/html" }
            ".css"  { $response.ContentType = "text/css" }
            ".js"   { $response.ContentType = "application/javascript" }
            ".jpg"  { $response.ContentType = "image/jpeg" }
            ".png"  { $response.ContentType = "image/png" }
            ".svg"  { $response.ContentType = "image/svg+xml" }
        }
        
        $response.ContentLength64 = $content.Length
        $response.OutputStream.Write($content, 0, $content.Length)
        $response.Close()
    } else {
        $response.StatusCode = 404
        $response.Close()
    }
}
