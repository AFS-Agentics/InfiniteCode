# install.ps1 — Download and install the latest infinitecode binary for Windows.
#
# Usage (run as administrator is not required, installs to user-local bin):
#   irm https://raw.githubusercontent.com/AFS-Agentics/InfiniteCode/main/install.ps1 | iex
#
# Pin a specific version:
#   $env:VERSION = "v0.1.2"; irm https://raw.githubusercontent.com/AFS-Agentics/InfiniteCode/main/install.ps1 | iex
#
# Offline install from assets next to install.ps1:
#   .\install.ps1 -Offline

param(
    [string]$Version = $env:VERSION,
    [switch]$InstallCodeSearchModel,
    [switch]$Offline
)

$ErrorActionPreference = "Stop"
$Repo = "AFS-Agentics/InfiniteCode"
$RipgrepRepo = "BurntSushi/ripgrep"
$CodeSearchModelRepo = "minishlab/potion-code-16M"
$CodeSearchModelDirName = "minishlab--potion-code-16M"
$CodeSearchModelFiles = @("tokenizer.json", "model.safetensors", "config.json")

# ── Platform detection ───────────────────────────────────────────────────
function Get-Target {
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64" } else {
        Write-Error "32-bit Windows is not supported"
        exit 1
    }
    return "${arch}-pc-windows-msvc"
}

function Get-RipgrepTarget {
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64" } else {
        Write-Error "32-bit Windows is not supported for ripgrep"
        exit 1
    }
    return "${arch}-pc-windows-msvc"
}

function Normalize-PathEntry {
    param(
        [string]$Value
    )

    $normalized = $Value.Trim()
    while ($normalized.Length -gt 3 -and $normalized.EndsWith("\\")) {
        $normalized = $normalized.Substring(0, $normalized.Length - 1)
    }

    return $normalized
}

function Test-PathEntryPresent {
    param(
        [string]$PathValue,
        [string]$Entry
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $false
    }

    $normalizedEntry = Normalize-PathEntry $Entry
    foreach ($candidate in ($PathValue -split ";")) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        if ((Normalize-PathEntry $candidate) -ieq $normalizedEntry) {
            return $true
        }
    }

    return $false
}

function Add-InstallDirToPath {
    param(
        [string]$InstallDir
    )

    $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Test-PathEntryPresent -PathValue $currentUserPath -Entry $InstallDir)) {
        $newUserPath = if ([string]::IsNullOrWhiteSpace($currentUserPath)) {
            $InstallDir
        } else {
            "$InstallDir;$currentUserPath"
        }
        [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
    }

    if (-not (Test-PathEntryPresent -PathValue $env:Path -Entry $InstallDir)) {
        $env:Path = if ([string]::IsNullOrWhiteSpace($env:Path)) {
            $InstallDir
        } else {
            "$InstallDir;$env:Path"
        }
    }
}

function Broadcast-EnvironmentChange {
    if (-not ("Win32.NativeMethods" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace Win32 {
    public static class NativeMethods {
        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern IntPtr SendMessageTimeout(
            IntPtr hWnd,
            int Msg,
            UIntPtr wParam,
            string lParam,
            int fuFlags,
            int uTimeout,
            out UIntPtr lpdwResult);
    }
}
"@
    }

    $result = [UIntPtr]::Zero
    [Win32.NativeMethods]::SendMessageTimeout(
        [IntPtr]0xffff,
        0x1A,
        [UIntPtr]::Zero,
        "Environment",
        2,
        5000,
        [ref]$result
    ) | Out-Null
}

# ── Resolve version ──────────────────────────────────────────────────────
function Resolve-GitHubLatestVersion {
    param(
        [string]$RepoName
    )

    # First try the releases API (requires a published release).
    try {
        $latest = Invoke-RestMethod -Uri "https://api.github.com/repos/$RepoName/releases/latest" -ErrorAction Stop
        return $latest.tag_name
    }
    catch {
        # Fall back to the tags API when there are no published releases.
        $tags = Invoke-RestMethod -Uri "https://api.github.com/repos/$RepoName/tags" -ErrorAction Stop
        if ($tags -and $tags.Count -gt 0) {
            return $tags[0].name
        }
        throw "Failed to resolve the latest version from releases or tags"
    }
}

function Resolve-Version {
    if ($Version) {
        return Normalize-Version $Version
    }

    return Normalize-Version (Resolve-GitHubLatestVersion -RepoName $Repo)
}

function Normalize-Version {
    param(
        [string]$Value
    )

    $normalized = $Value.Trim()
    if ($normalized.StartsWith("v")) {
        return $normalized
    }

    return "v$normalized"
}

function Test-Truthy {
    param(
        [string]$Value
    )

    return $Value -match "^(1|true|yes|on)$"
}

function Should-InstallCodeSearchModel {
    return $InstallCodeSearchModel -or (Test-Truthy $env:INFINITECODE_INSTALL_CODE_SEARCH_MODEL)
}

function Get-InfiniteCodeHome {
    if (-not [string]::IsNullOrWhiteSpace($env:INFINITECODE_HOME)) {
        return $env:INFINITECODE_HOME
    }

    return Join-Path $HOME ".infinitecode"
}

function Normalize-InfiniteCodeVersionOutput {
    param(
        [string]$RawVersion
    )

    foreach ($part in ($RawVersion -split "\s+")) {
        if ($part -match "^v\d+\.\d+\.\d+.*$") {
            return $part
        }
        if ($part -match "^\d+\.\d+\.\d+.*$") {
            return "v$part"
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($RawVersion)) {
        return $RawVersion.Trim()
    }

    return "unknown"
}

function Get-ExistingInfiniteCodePath {
    param(
        [string]$InstallDir
    )

    $installedTarget = Join-Path $InstallDir "infinitecode.exe"
    if (Test-Path $installedTarget) {
        return $installedTarget
    }

    $command = Get-Command "infinitecode.exe" -ErrorAction SilentlyContinue
    if ($command) {
        if ($command.Source) {
            return $command.Source
        }
        return $command.Path
    }

    $command = Get-Command "infinitecode" -ErrorAction SilentlyContinue
    if ($command) {
        if ($command.Source) {
            return $command.Source
        }
        return $command.Path
    }

    return $null
}

function Get-InstalledInfiniteCodeVersion {
    param(
        [string]$InfiniteCodePath
    )

    try {
        $rawVersion = (& $InfiniteCodePath --version 2>$null) -join " "
    } catch {
        $rawVersion = ""
    }

    return Normalize-InfiniteCodeVersionOutput $rawVersion
}

function Write-VersionTransition {
    param(
        [string]$InstallDir,
        [string]$TargetVersion
    )

    $installedPath = Get-ExistingInfiniteCodePath -InstallDir $InstallDir
    if ($installedPath) {
        $currentVersion = Get-InstalledInfiniteCodeVersion -InfiniteCodePath $installedPath
    } else {
        $currentVersion = "not installed"
    }

    Write-Host "Version: $currentVersion -> $TargetVersion"
}

function Test-InfiniteCodeVersionInstalled {
    param(
        [string]$InstallDir,
        [string]$ExpectedVersion
    )

    $installedPath = Get-ExistingInfiniteCodePath -InstallDir $InstallDir
    if (-not $installedPath) {
        return $false
    }

    $installedVersion = Get-InstalledInfiniteCodeVersion -InfiniteCodePath $installedPath
    if ($installedVersion -eq $ExpectedVersion) {
        Write-Host "infinitecode $ExpectedVersion is already installed at $installedPath"
        return $true
    }

    Write-Host "Found existing infinitecode at $installedPath ($installedVersion)"
    return $false
}

# ── Banner ───────────────────────────────────────────────────────────────
function Print-Banner {
    Write-Host ""
    Write-Host " ___ _   _ _____ ___ _   _ ___ _____ _____" -ForegroundColor DarkGray
    Write-Host "|_ _| \ | |  ___|_ _| \ | |_ _|_   _| ____|" -ForegroundColor DarkGray
    Write-Host " | ||  \| | |_   | ||  \| || |  | | |  _|" -ForegroundColor DarkGray
    Write-Host " | || |\  |  _|  | || |\  || |  | | | |___" -ForegroundColor DarkGray
    Write-Host "|___|_| \_|_|   |___|_| \_|___| |_| |_____|" -ForegroundColor DarkGray
    Write-Host ""
}

function Install-RipgrepSidecar {
    param(
        [string]$InstallDir,
        [string]$TempRoot
    )

    if ($env:INFINITECODE_SKIP_RG_INSTALL -eq "1") {
        Write-Host "Skipping ripgrep sidecar install because INFINITECODE_SKIP_RG_INSTALL=1."
        return
    }

    $targetPath = Join-Path $InstallDir "rg.exe"
    if (Test-Path $targetPath) {
        Write-Host "ripgrep sidecar is already installed at $targetPath"
        return
    }

    $rgTarget = Get-RipgrepTarget
    $rgVersion = Resolve-GitHubLatestVersion -RepoName $RipgrepRepo
    $rgArchiveUrl = "https://github.com/$RipgrepRepo/releases/download/$rgVersion/ripgrep-${rgVersion}-${rgTarget}.zip"
    $rgTmpDir = Join-Path $TempRoot "ripgrep"
    New-Item -ItemType Directory -Force -Path $rgTmpDir | Out-Null

    Write-Host "Downloading ripgrep $rgVersion for $rgTarget ..."

    $rgZipPath = Join-Path $rgTmpDir "ripgrep.zip"
    Invoke-WebRequest -Uri $rgArchiveUrl -OutFile $rgZipPath
    Expand-Archive -Path $rgZipPath -DestinationPath $rgTmpDir -Force

    $rgExe = Get-ChildItem -Recurse -Filter "rg.exe" -Path $rgTmpDir | Select-Object -First 1
    if (-not $rgExe) {
        Write-Error "rg.exe not found in the ripgrep archive"
    }

    Copy-Item -Path $rgExe.FullName -Destination $targetPath -Force
}

function Install-CodeSearchModel {
    param(
        [string]$TempRoot
    )

    if (-not (Should-InstallCodeSearchModel)) {
        return
    }

    $infinitecodeHome = Get-InfiniteCodeHome
    $modelDir = Join-Path (Join-Path $infinitecodeHome "local-models") $CodeSearchModelDirName
    New-Item -ItemType Directory -Force -Path $modelDir | Out-Null

    $missingFiles = @(
        foreach ($file in $CodeSearchModelFiles) {
            $targetPath = Join-Path $modelDir $file
            if (-not (Test-Path $targetPath)) {
                $file
            }
        }
    )

    if ($missingFiles.Count -eq 0) {
        Write-Host "code_search model is already installed at $modelDir"
        return
    }

    $modelTmpDir = Join-Path $TempRoot "code-search-model"
    New-Item -ItemType Directory -Force -Path $modelTmpDir | Out-Null

    Write-Host "Installing code_search model $CodeSearchModelRepo into $modelDir ..."

    foreach ($file in $CodeSearchModelFiles) {
        $targetPath = Join-Path $modelDir $file
        if (Test-Path $targetPath) {
            Write-Host "Found existing $targetPath"
            continue
        }

        $url = "https://huggingface.co/$CodeSearchModelRepo/resolve/main/$file"
        $tmpPath = Join-Path $modelTmpDir $file
        Write-Host "Downloading $file ..."
        Invoke-WebRequest -Uri $url -OutFile $tmpPath
        Move-Item -Path $tmpPath -Destination $targetPath -Force
    }

    foreach ($file in $CodeSearchModelFiles) {
        $targetPath = Join-Path $modelDir $file
        if (-not (Test-Path $targetPath)) {
            Write-Error "code_search model files were not fully installed at $modelDir"
        }
    }
}

function Get-InstallerAssetDir {
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        return $PSScriptRoot
    }

    return (Get-Location).Path
}

function Get-FirstMatchingFile {
    param(
        [string]$Directory,
        [string]$Pattern
    )

    return Get-ChildItem -Path $Directory -Filter $Pattern -File |
        Sort-Object -Property Name |
        Select-Object -First 1
}

function Install-InfiniteCodeOffline {
    param(
        [string]$AssetDir,
        [string]$InstallDir,
        [string]$TempRoot
    )

    $localExe = Join-Path $AssetDir "infinitecode.exe"
    if (Test-Path $localExe) {
        Write-Host "Installing infinitecode from local binary: $localExe"
        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        Copy-Item -Path $localExe -Destination (Join-Path $InstallDir "infinitecode.exe") -Force
        return
    }

    $target = Get-Target
    $archive = Get-FirstMatchingFile -Directory $AssetDir -Pattern "infinitecode-*-${target}.zip"
    if (-not $archive) {
        Write-Error "Offline infinitecode asset not found. Place infinitecode-*-${target}.zip or infinitecode.exe next to install.ps1."
    }

    Write-Host "Installing infinitecode from offline archive: $($archive.FullName)"
    $infinitecodeTmpDir = Join-Path $TempRoot "infinitecode-offline"
    New-Item -ItemType Directory -Force -Path $infinitecodeTmpDir | Out-Null
    Expand-Archive -Path $archive.FullName -DestinationPath $infinitecodeTmpDir -Force

    $exe = Get-ChildItem -Recurse -Filter "infinitecode.exe" -Path $infinitecodeTmpDir | Select-Object -First 1
    if (-not $exe) {
        Write-Error "infinitecode.exe not found in the offline archive"
    }

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -Path $exe.FullName -Destination (Join-Path $InstallDir "infinitecode.exe") -Force
}

function Install-RipgrepSidecarOffline {
    param(
        [string]$AssetDir,
        [string]$InstallDir,
        [string]$TempRoot
    )

    if ($env:INFINITECODE_SKIP_RG_INSTALL -eq "1") {
        Write-Host "Skipping ripgrep sidecar install because INFINITECODE_SKIP_RG_INSTALL=1."
        return
    }

    $targetPath = Join-Path $InstallDir "rg.exe"
    if (Test-Path $targetPath) {
        Write-Host "ripgrep sidecar is already installed at $targetPath"
        return
    }

    $localRg = Join-Path $AssetDir "rg.exe"
    if (Test-Path $localRg) {
        Write-Host "Installing ripgrep sidecar from $localRg"
        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        Copy-Item -Path $localRg -Destination $targetPath -Force
        return
    }

    $rgTarget = Get-RipgrepTarget
    $archive = Get-FirstMatchingFile -Directory $AssetDir -Pattern "ripgrep-*-${rgTarget}.zip"
    if (-not $archive) {
        Write-Error "Offline ripgrep asset not found. Place ripgrep-*-${rgTarget}.zip or rg.exe next to install.ps1."
    }

    Write-Host "Installing ripgrep sidecar from offline archive: $($archive.FullName)"
    $rgTmpDir = Join-Path $TempRoot "ripgrep-offline"
    New-Item -ItemType Directory -Force -Path $rgTmpDir | Out-Null
    Expand-Archive -Path $archive.FullName -DestinationPath $rgTmpDir -Force

    $rgExe = Get-ChildItem -Recurse -Filter "rg.exe" -Path $rgTmpDir | Select-Object -First 1
    if (-not $rgExe) {
        Write-Error "rg.exe not found in the offline archive"
    }

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Copy-Item -Path $rgExe.FullName -Destination $targetPath -Force
}

function Test-CodeSearchModelFiles {
    param(
        [string]$Directory
    )

    foreach ($file in $CodeSearchModelFiles) {
        if (-not (Test-Path (Join-Path $Directory $file))) {
            return $false
        }
    }

    return $true
}

function Install-CodeSearchModelOffline {
    param(
        [string]$AssetDir
    )

    $nestedModelDir = Join-Path $AssetDir $CodeSearchModelDirName
    if (Test-CodeSearchModelFiles -Directory $nestedModelDir) {
        $sourceDir = $nestedModelDir
    } elseif (Test-CodeSearchModelFiles -Directory $AssetDir) {
        $sourceDir = $AssetDir
    } else {
        Write-Error "Offline code_search model files not found. Place config.json, model.safetensors, and tokenizer.json next to install.ps1 or under ${CodeSearchModelDirName}\."
    }

    $modelDir = Join-Path (Join-Path (Get-InfiniteCodeHome) "local-models") $CodeSearchModelDirName
    New-Item -ItemType Directory -Force -Path $modelDir | Out-Null

    Write-Host "Installing code_search model from $sourceDir into $modelDir"
    foreach ($file in $CodeSearchModelFiles) {
        Copy-Item -Path (Join-Path $sourceDir $file) -Destination (Join-Path $modelDir $file) -Force
    }

    if (-not (Test-CodeSearchModelFiles -Directory $modelDir)) {
        Write-Error "code_search model files were not fully installed at $modelDir"
    }
}

# ── Install ──────────────────────────────────────────────────────────────
function Main {
    Print-Banner

    $tmpDir = Join-Path $env:TEMP "infinitecode-install"
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue | Out-Null
    New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

    try {
        $installDir = Join-Path $env:LOCALAPPDATA "Programs\infinitecode"

        if ($Offline) {
            $assetDir = Get-InstallerAssetDir
            Write-Host "Offline asset directory: $assetDir"
            Install-InfiniteCodeOffline -AssetDir $assetDir -InstallDir $installDir -TempRoot $tmpDir
            Install-RipgrepSidecarOffline -AssetDir $assetDir -InstallDir $installDir -TempRoot $tmpDir
            Install-CodeSearchModelOffline -AssetDir $assetDir
        } else {
            $target = Get-Target
            $version = Resolve-Version
            Write-VersionTransition -InstallDir $installDir -TargetVersion $version

            $skipAppInstall = Test-InfiniteCodeVersionInstalled -InstallDir $installDir -ExpectedVersion $version
            if (-not $skipAppInstall) {
                $archiveUrl = "https://github.com/$Repo/releases/download/$version/infinitecode-${version}-${target}.zip"

                Write-Host "Downloading infinitecode $version for $target ..."

                $zipPath = Join-Path $tmpDir "infinitecode.zip"
                Invoke-WebRequest -Uri $archiveUrl -OutFile $zipPath

                Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force

                # Locate infinitecode.exe (it's inside a versioned subdirectory).
                $exe = Get-ChildItem -Recurse -Filter "infinitecode.exe" -Path $tmpDir | Select-Object -First 1
                if (-not $exe) {
                    Write-Error "infinitecode.exe not found in the archive"
                }

                New-Item -ItemType Directory -Force -Path $installDir | Out-Null
                Copy-Item -Path $exe.FullName -Destination (Join-Path $installDir "infinitecode.exe") -Force
            }
            Install-RipgrepSidecar -InstallDir $installDir -TempRoot $tmpDir
            Install-CodeSearchModel -TempRoot $tmpDir
        }

        Add-InstallDirToPath -InstallDir $installDir

        Write-Host "Installed infinitecode to ${installDir}\infinitecode.exe"
        $rgPath = Join-Path $installDir "rg.exe"
        if (Test-Path $rgPath) {
            Write-Host "ripgrep sidecar available at $rgPath"
        } else {
            Write-Host "ripgrep sidecar was not installed."
        }
        if ($Offline -or (Should-InstallCodeSearchModel)) {
            $modelPath = Join-Path (Join-Path (Get-InfiniteCodeHome) "local-models") $CodeSearchModelDirName
            Write-Host "code_search model available at $modelPath"
        }
        Write-Host "PATH was updated for future terminals."
        Write-Host "Open a new terminal, or run:"
        Write-Host "  `$env:Path = `"$installDir;`$env:Path`""
        Write-Host "Run 'infinitecode onboard' to get started."
    }
    finally {
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue | Out-Null
    }
}

Main
