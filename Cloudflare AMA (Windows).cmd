@echo off
REM Double-click: the online link (Cloudflare tunnel) - connect, start, stop, test, log. See scripts\tunnel.js.
setlocal
title AMA Order System - Online link (Cloudflare)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer.
  echo   Install the LTS version from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

node scripts\tunnel.js
REM The menu waits for a key itself; this keeps an unexpected error readable.
if errorlevel 1 (
  echo.
  pause
)
