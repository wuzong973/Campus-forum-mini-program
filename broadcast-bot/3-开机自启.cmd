@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo 将创建开机自启任务：每次开机登录后自动运行播报机器人（静默无窗口）。
echo （任务名：ForumBroadcastBot，可在「任务计划程序」里查看）
echo.
set "PYW=%~dp0runtime\pythonw.exe"
set "BOT=%~dp0broadcast_bot.py"
schtasks /Create /TN "ForumBroadcastBot" /TR "\"%PYW%\" \"%BOT%\"" /SC ONLOGON /RL LIMITED /F
if errorlevel 1 (
    echo [失败] 创建失败，可截图本窗口反馈；不影响手动双击运行。
) else (
    echo [完成] 已设置开机自启。
    echo 注意：电脑仍需保持企业微信客户端登录状态。
    echo 如需取消：双击运行「4-取消开机自启.cmd」
)
pause
