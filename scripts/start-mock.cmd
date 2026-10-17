@echo off
REM Front-end only: fake API with seed data, no PostgreSQL needed.
REM Log in as admin / maker1 / taker1 / taker2 / acc1 with any password.

cd /d "%~dp0\.."

if not exist "client\node_modules" (
  echo Installing client dependencies...
  pushd client && call npm install && popd
)

start "AMA Mock API" cmd /k "cd /d %CD% && node tools\mock-api.js"
start "AMA Client" cmd /k "cd /d %CD%\client && npm run dev"

echo.
echo Mock API: http://localhost:6001
echo Client:   http://localhost:5173
