@echo off
REM For working on screens: a fake API with sample data (tools\mock-api.js) and
REM the Vite dev server, each in its own window. No database, no Telegram -
REM nothing real is touched.
REM Log in as admin / maker1 / taker1 / taker2 / acc1 with any password.
REM Stop both with scripts\stop-mock.cmd (or close the two windows).

cd /d "%~dp0\.."

if not exist "client\node_modules" (
  echo Installing client dependencies...
  pushd client && call npm install && popd
)

start "AMA Mock API" cmd /k "cd /d %CD% && node tools\mock-api.js"
start "AMA Client" cmd /k "cd /d %CD%\client && npm run dev"

echo.
echo Mock API: http://localhost:6001
echo Client:   http://localhost:5173   (log in as admin, maker1, taker1, taker2 or acc1 - any password)
echo Stop both with scripts\stop-mock.cmd
