[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$BucketName = "emotion-diary"
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$resourceRoot = Join-Path $repositoryRoot "resource"
$imageRoot = [IO.Path]::GetFullPath((Join-Path $resourceRoot "image"))
$imageRootPrefix = $imageRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) +
    [IO.Path]::DirectorySeparatorChar
$markdown = Get-Content -Raw -Encoding utf8 (Join-Path $resourceRoot "README.md")
$references = [regex]::Matches($markdown, '!\[[^\]]*\]\(([^)]+)\)')
$uploaded = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
)
$imageCount = 0

foreach ($reference in $references) {
    $imagePath = [Uri]::UnescapeDataString($reference.Groups[1].Value.Trim())
    if (-not $imagePath.StartsWith("image/", [StringComparison]::OrdinalIgnoreCase)) {
        continue
    }

    $localPath = [IO.Path]::GetFullPath(
        (Join-Path $resourceRoot ($imagePath.Replace("/", [IO.Path]::DirectorySeparatorChar)))
    )
    if (
        -not $localPath.StartsWith($imageRootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $localPath -PathType Leaf)
    ) {
        throw "Referenced diary image is missing or outside resource/image: $imagePath"
    }

    $imageKey = "resource/$($imagePath.Replace('\', '/'))"
    if (-not $uploaded.Add($imageKey)) {
        continue
    }

    if ($PSCmdlet.ShouldProcess("$BucketName/$imageKey", "Upload diary image")) {
        & npx wrangler r2 object put "$BucketName/$imageKey" --file $localPath --remote
        if ($LASTEXITCODE -ne 0) {
            throw "Wrangler failed to upload $imageKey (exit code $LASTEXITCODE)."
        }
    }

    $imageCount += 1
}

Write-Output "Processed $imageCount unique diary images for bucket '$BucketName'."
