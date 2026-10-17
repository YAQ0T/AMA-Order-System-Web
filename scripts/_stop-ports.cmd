@echo off
REM Shared stop logic for start-dev.cmd and start-mock.cmd.
REM Not meant to be run directly - use stop-dev.cmd or stop-mock.cmd.
REM
REM Works by port rather than PID files, the same way stop_ama.command's
REM fallback does, so it also cleans up servers you started by hand. Before
REM killing anything it checks the process is actually node.exe, so it will not
REM take down something unrelated that happens to be sitting on the port.

setlocal enabledelayedexpansion

call :stop_port 6001 "API"
call :stop_port 5173 "client"
call :close_windows

echo.
echo Stop command finished.
exit /b 0

REM ---------------------------------------------------------------------------
:stop_port
set "PORT=%~1"
set "NAME=%~2"
set "FOUND="
REM netstat lists a separate LISTENING row per address family, so the same PID
REM shows up twice. Track what we've handled or the second pass reports a
REM process we just killed as "missing".
set "SEEN= "

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING" 2^>nul') do (
    if not "%%p"=="0" (
        echo !SEEN! | findstr /c:" %%p " >nul
        if errorlevel 1 (
            set "SEEN=!SEEN!%%p "
            call :kill_pid %%p "!NAME!" "!PORT!"
            if not errorlevel 1 set "FOUND=1"
        )
    )
)

if not defined FOUND echo   No %NAME% running on port %PORT%.
exit /b 0

REM ---------------------------------------------------------------------------
:kill_pid
set "KPID=%~1"
set "KNAME=%~2"
set "KPORT=%~3"
set "IMAGE="

for /f "tokens=1 delims=," %%n in ('tasklist /fi "PID eq %KPID%" /nh /fo csv 2^>nul') do set "IMAGE=%%~n"

REM Process vanished between the netstat scan and now - nothing to do.
if not defined IMAGE exit /b 1
echo !IMAGE! | findstr /i /c:"INFO:" >nul && exit /b 1

echo !IMAGE! | findstr /i /c:"node.exe" >nul
if errorlevel 1 (
    echo   Port %KPORT% is held by !IMAGE! ^(PID %KPID%^), not node - left alone.
    exit /b 0
)

taskkill /PID %KPID% /T /F >nul 2>&1
if errorlevel 1 (
    echo   Could not stop %KNAME% ^(PID %KPID%^) - try running as Administrator.
    exit /b 1
)

echo   Stopped %KNAME% ^(PID %KPID% on port %KPORT%^).
exit /b 0

REM ---------------------------------------------------------------------------
:close_windows
REM The consoles opened by `start "TITLE" cmd /k` outlive the node process they
REM launched, so close them by title too.
for %%t in ("AMA API" "AMA Mock API" "AMA Client") do (
    taskkill /F /FI "WINDOWTITLE eq %%~t" >nul 2>&1
)
exit /b 0
