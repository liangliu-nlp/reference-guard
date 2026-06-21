param(
  [string]$Output = "dist/reference-guard.xpi"
)

$ErrorActionPreference = "Stop"
$files = @(
  "manifest.json",
  "bootstrap.js",
  "src/ref-guard.js",
  "src/ref-guard.css"
)

$outputDir = Split-Path $Output
if ($outputDir) {
  New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
}

$zipOutput = [System.IO.Path]::ChangeExtension($Output, ".zip")
Remove-Item -LiteralPath $Output -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zipOutput -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipOutput, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $source = (Resolve-Path -LiteralPath $file).Path
    $entryName = $file.Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $source, $entryName) | Out-Null
  }
}
finally {
  $zip.Dispose()
}

if ($zipOutput -ne $Output) {
  Move-Item -LiteralPath $zipOutput -Destination $Output
}
Write-Host "Created $Output"
