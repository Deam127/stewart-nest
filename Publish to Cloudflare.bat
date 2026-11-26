@echo off
title Publish The Stewart Nest
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Run "Start Stewart Nest.bat" first. & pause & exit /b)
if not exist node_modules call npm install
node scripts\publish.mjs
pause
