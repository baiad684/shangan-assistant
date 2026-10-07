@echo off
rem Stop the ShangAn Assistant server listening on port 3000
set STOPPED=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1 && set STOPPED=1
)
if "%STOPPED%"=="1" (
  echo Server stopped.
) else (
  echo Server is not running.
)
pause
