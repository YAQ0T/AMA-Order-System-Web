@echo off
REM Stops the API and Vite dev server started by start-dev.cmd.
echo Stopping AMA dev servers...
call "%~dp0_stop-ports.cmd"
