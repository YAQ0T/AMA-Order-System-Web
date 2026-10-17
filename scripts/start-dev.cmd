@echo off
REM Starts the API and the Vite dev server in separate windows.
REM Use scripts\start-mock.cmd instead if you have no database.

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
echo API:    http://localhost:6001
echo Client: http://localhost:5173
