@echo off
title StockFlow — Warehouse App
color 0A

rem If this file lives in the project folder, use that path.
set "APP_DIR=%~dp0"
if not exist "%APP_DIR%package.json" (
  rem Fallback when you copy this file to the Desktop.
  set "APP_DIR=C:\Users\Administrator\OneDrive\Desktop\website\stock-smarter-main\"
)

cd /d "%APP_DIR%" || (
  echo.
  echo  Could not open the app folder:
  echo  %APP_DIR%
  echo.
  echo  Edit StockFlow.bat and set APP_DIR to your project path.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>&1 || (
  echo.
  echo  Node.js / npm not found. Install from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo.
  echo  First run — installing dependencies...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo  Starting StockFlow...
echo  Close this window to stop the app.
echo.

call npm run electron:dev

if errorlevel 1 (
  echo.
  echo  The app exited with an error.
  pause
)
