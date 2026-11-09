$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Join-Path $repositoryRoot "dist"
$pagesOutput = Join-Path $outputRoot "pages"
$resourceOutput = Join-Path $outputRoot "resource"

New-Item -ItemType Directory -Force -Path $pagesOutput, $resourceOutput | Out-Null
Copy-Item (Join-Path $repositoryRoot "index.html") $outputRoot -Force
Copy-Item (Join-Path $repositoryRoot "_routes.json") $outputRoot -Force

foreach ($directory in @("css", "html", "js")) {
    $source = Join-Path $PSScriptRoot $directory
    $destination = Join-Path $pagesOutput $directory
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Copy-Item (Join-Path $source "*") $destination -Recurse -Force
}

Copy-Item (Join-Path $repositoryRoot "resource\README.md") $resourceOutput -Force
