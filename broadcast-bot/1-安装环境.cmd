@echo off
title Forum Broadcast Bot - Setup
cd /d "%~dp0"

echo ============ Forum Broadcast Bot - Setup ============
echo IMPORTANT: run this from the EXTRACTED folder, never inside the zip.
echo Arch: %PROCESSOR_ARCHITECTURE%
echo.

set "SETUP_LOG=%cd%\bot-setup.log"
echo [%date% %time%] setup start, arch=%PROCESSOR_ARCHITECTURE% > "%SETUP_LOG%"

rem File integrity check: the folder must be complete (a missing file means
rem the zip was not fully extracted or files were moved out by hand).
set "MISSING="
if not exist "broadcast_bot.py" set "MISSING=%MISSING% broadcast_bot.py"
if not exist "config.ini" set "MISSING=%MISSING% config.ini"
if not exist "README.md" set "MISSING=%MISSING% README.md"
if not "%MISSING%"=="" (
  echo [FAIL] The folder is INCOMPLETE. Missing files:%MISSING%
  echo        Please extract the WHOLE zip to one folder and run again.
  echo [%date% %time%] missing files:%MISSING% >> "%SETUP_LOG%"
  pause
  exit /b 1
)

rem Always rebuild a clean portable runtime: deterministic, no installer,
rem no registry state, immune to antivirus blocking installers.
if exist runtime rmdir /s /q runtime
if exist python-embed.zip del /q python-embed.zip
if exist python-setup.exe del /q python-setup.exe
if exist get-pip.py del /q get-pip.py
mkdir runtime

set "EPKG=python-3.11.9-embed-amd64.zip"
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" set "EPKG=python-3.11.9-embed-win32.zip"

echo Step 1/3: downloading portable python (%EPKG%)...
echo Download URL: https://mirrors.huaweicloud.com/python/3.11.9/%EPKG%
curl -L --fail --retry 2 -o python-embed.zip https://mirrors.huaweicloud.com/python/3.11.9/%EPKG%
if not exist python-embed.zip (
  echo [FAIL] download failed. Check network, then run this file again.
  echo [%date% %time%] embed download failed >> "%SETUP_LOG%"
  pause
  exit /b 1
)
powershell -NoProfile -Command "Expand-Archive -Path 'python-embed.zip' -DestinationPath 'runtime' -Force"
if not exist "runtime\python.exe" (
  echo [FAIL] unpack failed. Screenshot this window and contact tech support.
  echo [%date% %time%] unpack failed >> "%SETUP_LOG%"
  pause
  exit /b 1
)
echo python311.zip> "runtime\python311._pth"
echo .>> "runtime\python311._pth"
echo Lib\site-packages>> "runtime\python311._pth"
echo import site>> "runtime\python311._pth"
del /q python-embed.zip >nul 2>nul
echo [OK] portable python ready.

echo.
echo Step 2/3: preparing pip...
runtime\python.exe -m pip --version >nul 2>nul
if errorlevel 1 (
  echo Bootstrapping pip...
  curl -L --fail --retry 2 -o get-pip.py https://bootstrap.pypa.io/get-pip.py
  if exist get-pip.py runtime\python.exe get-pip.py --no-warn-script-location
  if not exist get-pip.py runtime\python.exe -m ensurepip >nul 2>nul
  del /q get-pip.py >nul 2>nul
)
runtime\python.exe -m pip --version >nul 2>nul
if errorlevel 1 (
  echo [FAIL] pip bootstrap failed. Send bot-setup.log to tech support.
  echo [%date% %time%] pip bootstrap failed >> "%SETUP_LOG%"
  pause
  exit /b 1
)
echo [OK] pip ready.

echo.
echo Step 3/3: installing bot packages (china mirror)...
rem Package list is embedded here on purpose - do not depend on external files.
runtime\python.exe -m pip install uiautomation requests -i https://pypi.tuna.tsinghua.edu.cn/simple --no-warn-script-location
if errorlevel 1 (
  echo [FAIL] package install failed. Check network and run this file again.
  echo [%date% %time%] deps failed >> "%SETUP_LOG%"
  pause
  exit /b 1
)
echo [%date% %time%] setup OK >> "%SETUP_LOG%"
echo.
echo ============ Setup done! ============
echo Next: 1. Login WeCom PC client (guangqingguancha account)
echo       2. Edit config.ini - set your group names
echo       3. Double click file No.2 to start the bot
echo (Chinese guide: see README.md)
pause
