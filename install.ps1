<#
.SYNOPSIS
  Installs Arcus Code on Windows.

.DESCRIPTION
  The POSIX `install` script wires PATH by appending to shell rc files, which
  does nothing for PowerShell. This is the Windows equivalent: it copies the
  binary into a stable location and edits the user PATH environment variable.

  Until Arcus Code publishes releases there is nothing to download, so this
  installs from a locally built binary. Build one first:

    cd packages\opencode
    bun run script/build.ts --single --skip-install

.PARAMETER Binary
  Path to a built arcus-code.exe. Defaults to the single-platform build output.

.PARAMETER InstallDir
  Where to install. Defaults to ~\.arcus-code\bin, matching INSTALL_DIR in the
  POSIX script so both platforms agree and `arcus-code uninstall` finds it.

.PARAMETER NoModifyPath
  Copy the binary but leave PATH alone.

.EXAMPLE
  .\install.ps1
.EXAMPLE
  .\install.ps1 -Binary D:\builds\arcus-code.exe
#>
[CmdletBinding()]
param(
  [string]$Binary,
  [string]$InstallDir = (Join-Path $HOME ".arcus-code\bin"),
  [switch]$NoModifyPath
)

$ErrorActionPreference = "Stop"

# Keep in step with BIN_NAME in the POSIX `install` script and with
# PATH_MARKERS / BIN_DIRS in packages/opencode/src/cli/cmd/uninstall.ts.
$BinName = "arcus-code"

if (-not $Binary) {
  $Binary = Join-Path $PSScriptRoot "packages\opencode\dist\$BinName-windows-x64\bin\$BinName.exe"
}

if (-not (Test-Path -LiteralPath $Binary)) {
  Write-Host "No binary at: $Binary" -ForegroundColor Red
  Write-Host ""
  Write-Host "Build one first:" -ForegroundColor Yellow
  Write-Host "  cd packages\opencode"
  Write-Host "  bun run script/build.ts --single --skip-install"
  exit 1
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$target = Join-Path $InstallDir "$BinName.exe"

# A running instance holds a lock on its own executable, and the copy would
# fail partway. Say so plainly rather than leaving a half-written binary.
if (Test-Path -LiteralPath $target) {
  try {
    $stream = [System.IO.File]::Open($target, 'Open', 'ReadWrite', 'None')
    $stream.Close()
  } catch {
    Write-Host "$target is in use. Close any running $BinName and try again." -ForegroundColor Red
    exit 1
  }
}

Copy-Item -LiteralPath $Binary -Destination $target -Force
Write-Host "Installed $BinName to $target" -ForegroundColor Green

if ($NoModifyPath) {
  Write-Host ""
  Write-Host "PATH not modified. Add this yourself:" -ForegroundColor Yellow
  Write-Host "  $InstallDir"
  exit 0
}

# Edit the user PATH, not the machine one: no elevation, and it cannot damage
# a system-wide value. Read the stored value rather than $env:Path, which is
# the merged machine+user copy for this process and would duplicate entries.
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$entries = @($userPath -split ';' | Where-Object { $_ -ne '' })

if ($entries -contains $InstallDir) {
  Write-Host "Already on PATH."
} else {
  [Environment]::SetEnvironmentVariable("Path", (($entries + $InstallDir) -join ';'), "User")
  Write-Host "Added to your user PATH."
}

# The stored PATH is the only thing this script can change. It cannot touch the
# environment of the shell that launched it, nor of that shell's parent, and
# Windows only broadcasts a change notification that long-running processes are
# free to ignore -- VS Code and Explorer do. A terminal they spawn inherits the
# PATH they started with, however old, so a correct stored value can still be
# invisible right here. Check the live PATH rather than assume, because
# "Already on PATH" is exactly the case where the gap is most confusing.
if (($env:Path -split ';') -notcontains $InstallDir) {
  Write-Host ""
  Write-Host "This terminal cannot see $InstallDir yet." -ForegroundColor Yellow
  Write-Host "Restart your terminal -- and VS Code too, if this is its terminal, since"
  Write-Host "terminals inherit its PATH. To use it here without restarting, run:"
  Write-Host '  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")'
  Write-Host ""
  exit 0
}

Write-Host ""
Write-Host "Then: $BinName" -ForegroundColor Green
