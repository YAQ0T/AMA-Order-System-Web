@echo off
REM For developers: starts the API (with auto-restart on code changes) and the
REM Vite dev server (live reload), each in its own window.
REM   API:    http://localhost:6001      Client: http://localhost:5173
REM Stop both with scripts\stop-dev.cmd (or close the two windows).
REM
REM It uses server\.env as it is, so the DATABASE IS THE REAL ONE on this
REM computer. Telegram is switched off (npm run dev sets TELEGRAM=off): only one
REM program may read the bot's messages, and that is the real system.
REM Not for running the system - that is "Start AMA". To work on screens
REM without a database, use scripts\start-mock.cmd instead.

cd /d "%~dp0\.."

if not exist "server\node_modules" (
  echo Installing server dependencies...
  pushd server && call npm install && popd
)
if not exist "client\node_modules" (
  echo Installing client dependencies...
  pushd client && call npm install && popd
)

start "AMA API" cmd /k "cd /d %CD%\server && npm run dev"
start "AMA Client" cmd /k "cd /d %CD%\client && npm run dev"

echo.
echo API:    http://localhost:6001   (real database, Telegram off)
echo Client: http://localhost:5173
echo Stop both with scripts\stop-dev.cmd
