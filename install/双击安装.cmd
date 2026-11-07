@echo off
title wb-purge installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply.ps1"
echo.
if errorlevel 1 (
  echo [FAIL] Error message is above. Keep this window open.
) else (
  echo [OK] Done. Now quit WorkBuddy fully including tray, start it again, open a new chat.
)
pause
