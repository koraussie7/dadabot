# =============================================================================
# DadaBot installer — Windows PowerShell 5.1+ / PowerShell 7+
# Mirrors install.sh with Windows-native commands.
# =============================================================================
[CmdletBinding()]
param(
    [string]$Version = "latest",
    [ValidateSet("stable", "beta", "nightly")]
    [string]$Channel = "stable",
    # NOTE: dadabot.dev unreachable, fall back to raw GitHub mirror.
    # Restore to "https://dadabot.dev" when the domain is back online.
    [string]$BaseUrl = "https://raw.githubusercontent.com/koraussie7/dadabot/main",
    # NOTE: github.com/dadabot-ai/dadabot is a placeholder; use this user's repo.
    [string]$ApiUrl = "https://api.github.com/repos/koraussie7/dadabot/releases",
    [string]$Home = "$env:USERPROFILE\.dadabot",
    [int]$Port = 7878,
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"

# ----- Colors ----------------------------------------------------------------
function Info($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host " ✓ $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host " ! $msg" -ForegroundColor Yellow }
function Err($msg)   { Write-Host " ✗ $msg" -ForegroundColor Red }

# ----- Banner ----------------------------------------------------------------
Write-Host @"
       ____           ____        _
      |  _ \  __ _ __| __ )  ___ | |_
      | | | |/ _` | '__|  _ \ / _ \| __|
      | |_| | (_| | |  | |_) | (_) | |_
      |____/ \__,_|_|  |____/ \___/ \__|
      Local-first AI Agent OS · v0.1.0-beta.1
"@

# ----- Stage 2: detect_platform ---------------------------------------------
Info "Detecting platform..."
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLower()
$assetSuffix = switch ($arch) {
    "x64"   { "windows-x86_64" }
    "arm64" { "windows-aarch64" }
    default { throw "Unsupported architecture: $arch" }
}
$assetSuffix = "windows-x86_64"  # MVP only x64
Ok "Platform: windows / $arch  →  $assetSuffix"

# ----- Stage 3: resolve_version ---------------------------------------------
$cacheDir = Join-Path $Home "cache"
$null = New-Item -ItemType Directory -Force -Path $cacheDir, (Join-Path $Home "bin")
$manifestPath = Join-Path $cacheDir "latest-$Channel.json"

if ($Version -eq "latest") {
    Info "Resolving latest version for channel: $Channel"
    try {
        Invoke-WebRequest -Uri "$BaseUrl/releases/latest-$Channel.json" -OutFile $manifestPath -UseBasicParsing -TimeoutSec 60
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        $resolvedVersion = $manifest.version
        Ok "Manifest served: $resolvedVersion"
    } catch {
        Warn "Manifest fetch failed: $_"
        try {
            $releaseJson = Invoke-RestMethod -Uri "$ApiUrl/latest" -TimeoutSec 60
            $resolvedVersion = $releaseJson.tag_name.TrimStart("v")
        } catch {
            Err "Could not resolve latest version"
            exit 1
        }
    }
} else {
    $resolvedVersion = $Version
    Info "Pinned version: $resolvedVersion"
}
$Version = $resolvedVersion
Ok "Version: $Version"

# ----- Extract platform asset -----------------------------------------------
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$entry = $manifest.platforms.$assetSuffix
if (-not $entry) { Err "Platform $assetSuffix not in manifest"; exit 1 }
$assetName   = $entry.asset
$downloadUrl = $entry.download_url
$expectedSha = $entry.sha256
Ok "Platform: $assetSuffix  asset=$assetName"

# ----- Stage 4: download -----------------------------------------------------
$tmpDir = Join-Path $env:TEMP ("dadabot-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $tmpDir
$archivePath = Join-Path $tmpDir $assetName

Info "Downloading $assetName..."
try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing -TimeoutSec 300
} catch {
    Err "Download failed: $_"
    exit 1
}

# ----- Stage 5: verify SHA-256 ----------------------------------------------
Info "Verifying SHA-256..."
$actualSha = (Get-FileHash -Algorithm SHA256 -Path $archivePath).Hash.ToLower()
if ($actualSha -ne $expectedSha.ToLower()) {
    Err "SHA-256 mismatch: expected $expectedSha, got $actualSha"
    exit 1
}
Ok "SHA-256 verified"

# ----- Stage 6: bootstrap_runtimes -------------------------------------------
$extractDir = Join-Path $Home "versions\$Version"
$null = New-Item -ItemType Directory -Force -Path $extractDir
Info "Extracting to $extractDir..."
Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force
Ok "Extracted"

# ----- Stage 7: setup_path --------------------------------------------------
$binDir = Join-Path $Home "bin"
$binLink = Join-Path $binDir "dadabot.exe"
if (Test-Path $binLink) { Remove-Item $binLink -Force }
$null = New-Item -ItemType SymbolicLink -Path $binLink -Target (Join-Path $extractDir "bin\dadabot.exe")

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$binDir;$userPath", "User")
    Ok "Added $binDir to user PATH"
}
Ok "Symlink: $binLink"

# ----- Stage 8: launch ------------------------------------------------------
if (-not $DryRun) {
    Info "Starting daemon..."
    $proc = Start-Process -FilePath $binLink -ArgumentList @("daemon", "--port", $Port) `
                           -RedirectStandardOutput (Join-Path $Home "daemon.log") `
                           -RedirectStandardError  (Join-Path $Home "daemon.log") `
                           -PassThru -NoNewWindow
    Start-Sleep -Seconds 1
    if (-not $proc.HasExited) {
        Ok "Daemon started (pid=$($proc.Id), port=$Port)"
    } else {
        Warn "Daemon failed — check $(Join-Path $Home 'daemon.log')"
    }
}

Write-Host @"
────────────────────────────────────────────
  ✓ DadaBot 설치 완료

  Powershell 세션 새로 시작 후:
    dadabot chat
────────────────────────────────────────────
"@
