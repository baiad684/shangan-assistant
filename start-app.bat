@echo off
cd /d "%~dp0"
title ShangAn Assistant - localhost:3000

if not exist ".next\BUILD_ID" (
  echo.
  echo   [!] Build output not found in .next
  echo   [!] Run:  npm run build
  echo.
  pause
  exit /b 1
)

netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo.
  echo   Server is already running. Opening browser...
  echo.
  start "" http://localhost:3000
  timeout /t 3 /nobreak >nul
  exit /b 0
)

echo.
echo   Starting ShangAn Assistant, please wait...
echo.
start "shangan-server" /min cmd /c "npm start"
timeout /t 8 /nobreak >nul
start "" http://localhost:3000

echo   +--------------------------------------------+
echo   ^|  ShangAn Assistant is running              ^|
echo   ^|  http://localhost:3000                     ^|
echo   ^|                                            ^|
echo   ^|  To stop: close the minimized window       ^| 
echo   ^|           named "shangan-server"           ^|
echo   +--------------------------------------------+
echo.
pause
