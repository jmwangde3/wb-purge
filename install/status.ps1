# dsh-purge (WorkBuddy port) — 状态
[CmdletBinding()]
param([string]$ConfigDir, [string]$AppDir, [string]$NodeExe)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$purge = Join-Path $here 'purge.mjs'

$node = if ($NodeExe) { $NodeExe } else { (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) {
  $guess = 'D:\installation package\nodejs\node.exe'
  if (Test-Path $guess) { $node = $guess } else { throw '找不到 node.exe，用 -NodeExe 指定' }
}

$argv = @($purge, 'status')
if ($ConfigDir) { $argv += @('--config-dir', $ConfigDir) }
if ($AppDir)    { $argv += @('--app-dir', $AppDir) }

& $node @argv
exit $LASTEXITCODE
