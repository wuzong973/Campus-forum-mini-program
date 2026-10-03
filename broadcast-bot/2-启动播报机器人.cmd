@echo off
title Forum Broadcast Bot - RUNNING (keep this window open)
cd /d "%~dp0"

if not exist "runtime\python.exe" (
    echo Runtime not installed yet. Run file No.1 first.
    pause
    exit /b 1
)

echo Bot starting... keep this window open (minimize is fine).
echo Logs also written to logs\bot.log  (中文说明见 README.md)
echo Stop: close this window or press Ctrl+C
echo.
runtime\python.exe broadcast_bot.py
echo.
echo Bot stopped. Press any key to close.
pause >nul
