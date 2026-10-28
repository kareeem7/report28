@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM ====== عدّل السطرين دول ======
set PORT=3000
set ADMIN_KEY=قويسنا2026
REM خلّي السطر ده متعطّل (rem) لو انت بس اللي هترفع
rem set ALLOW_UNIT_WRITES=on
REM ==============================

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Get it from https://nodejs.org
  pause & exit /b 1
)

echo Starting server on port %PORT% ...
node server.js
pause
