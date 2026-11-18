@echo off
setlocal
cd /d "D:\workspace\canver-quant"

rem If the server is already up, just open the browser.
curl -s -o nul -m 2 http://localhost:3000/ >nul 2>&1
if not errorlevel 1 (
  echo [canver-quant] server already running - opening browser...
  start http://localhost:3000
  exit /b 0
)

if not exist "node_modules\.bin\tsx.cmd" (
  echo [ERROR] node_modules not found. Run "npm install" first.
  pause
  exit /b 1
)

echo [canver-quant] starting server...
start "" cmd /c "timeout /t 6 >nul & start http://localhost:3000"

echo [canver-quant] url: http://localhost:3000
echo Keep this window open. Close it or press Ctrl+C to stop the server.
echo.

call "node_modules\.bin\tsx.cmd" server.ts

echo.
echo [canver-quant] server stopped.
pause
