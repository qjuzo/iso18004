@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22+ from https://nodejs.org and re-run this script.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo Enabling pnpm via corepack...
  call corepack enable
  if errorlevel 1 (
    echo Failed to locate pnpm. Run: npm install -g pnpm
    pause
    exit /b 1
  )
)

if not exist "node_modules" (
  echo Installing dependencies...
  call pnpm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Building @qr-scan/core and starting web app...
call pnpm --filter @qr-scan/core build
if errorlevel 1 (
  echo Core build failed.
  pause
  exit /b 1
)

call pnpm --filter @qr-scan/web dev -- --open
endlocal
