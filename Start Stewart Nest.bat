@echo off
title The Stewart Nest
cd /d "%~dp0"
echo.
echo   ==== The Stewart Nest ====
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed yet.
  echo Installing it now with winget - say Yes if Windows asks...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo Node.js installed. Close this window and double-click "Start Stewart Nest" again.
  pause
  exit /b
)
if not exist node_modules (
  echo First run: installing the app parts, this takes a minute or two...
  call npm install
  if errorlevel 1 ( echo npm install failed. & pause & exit /b )
)
if not exist .wrangler\state (
  echo First run: creating the family database...
  call npm run setup
  if errorlevel 1 ( echo Database setup failed. & pause & exit /b )
)
echo.
echo Starting... the app opens in your browser at http://localhost:8787
echo Phones on the same Wi-Fi: use this laptop's IP address with :8787 (run ipconfig to see it)
echo Leave this window open while you use the app. Close it to stop.
echo.
start "" cmd /c "timeout /t 6 >nul & start http://localhost:8787"
call npm run dev
pause
