Set-Location "d:\校园小程序第二版"

# 配置git用户信息
git config user.name "wuzong973"
git config user.email "wuzong973@users.noreply.github.com"

# 添加所有文件
git add .

# 提交
git commit -m "Initial commit: Campus forum mini program"

# 设置主分支
git branch -M main

# 推送到远程仓库
git push -u origin main

Write-Host "推送完成！" -ForegroundColor Green