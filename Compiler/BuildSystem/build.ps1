# One-command Windows build for the Obr host compiler.
# All paths are resolved from this script's directory; no absolute paths.
[CmdletBinding()]
param(
  [ValidateSet('windows-mingw')]
  [string]$Preset = 'windows-mingw',
  [switch]$Clean,
  [switch]$Fresh,
  [switch]$NoTest
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found in PATH: $Name"
  }
}

Require-Command 'cmake'
Require-Command 'ninja'
Require-Command 'c++.exe'

Push-Location $here
try {
  $buildDir = Join-Path $here "build/$Preset"

  if ($Clean -and (Test-Path $buildDir)) {
    Remove-Item $buildDir -Recurse -Force
    Write-Host "Removed build/$Preset"
  }

  $configureArgs = @('--preset', $Preset)
  if ($Fresh) {
    $configureArgs = @('--fresh') + $configureArgs
  }

  & cmake @configureArgs
  if ($LASTEXITCODE -ne 0) {
    throw "cmake configure failed with exit code $LASTEXITCODE"
  }

  & cmake --build --preset $Preset
  if ($LASTEXITCODE -ne 0) {
    throw "cmake build failed with exit code $LASTEXITCODE"
  }

  if (-not $NoTest) {
    & ctest --preset $Preset --output-on-failure
    if ($LASTEXITCODE -ne 0) {
      throw "ctest failed with exit code $LASTEXITCODE"
    }
  }

  $artifact = Join-Path $here '../ObrCompiler/obrc.exe'
  if (-not (Test-Path $artifact)) {
    throw "obrc.exe was not produced at ../ObrCompiler/obrc.exe"
  }

  Write-Host ''
  Write-Host "Preset:  $Preset"
  Write-Host "Build:   build/$Preset"
  Write-Host 'obrc:    ../ObrCompiler/obrc.exe'
}
finally {
  Pop-Location
}
