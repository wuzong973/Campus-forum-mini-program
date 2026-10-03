@echo off
chcp 65001 >nul
schtasks /Delete /TN "ForumBroadcastBot" /F
if errorlevel 1 (
    echo 没有找到自启任务，或删除失败。
) else (
    echo [完成] 已取消开机自启。
)
pause
