@echo off
REM Stops the mock API and Vite dev server started by start-mock.cmd.
echo Stopping AMA mock servers...
call "%~dp0_stop-ports.cmd"
