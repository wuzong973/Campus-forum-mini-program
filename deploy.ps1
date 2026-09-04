<#
.SYNOPSIS
    广轻工校园小程序后端一键部署脚本
.DESCRIPTION
    自动将 server 目录上传到 payun01.cn，安装依赖，配置 MySQL、Nginx、PM2 并启动服务。
.PARAMETER Server
    服务器地址，默认 payun01.cn
.PARAMETER User
    SSH 用户名，默认 root
.PARAMETER RemoteDir
    远程部署目录，默认 /opt/gqg-campus
.PARAMETER DbPassword
    MySQL root 密码（必填）
.PARAMETER JwtSecret
    JWT 密钥（不传则自动生成随机值）
#>

param(
    [string]$Server = "payun01.cn",
    [string]$User = "root",
    [string]$RemoteDir = "/opt/gqg-campus",
    [Parameter(Mandatory=$true)]
    [string]$DbPassword,
    [string]$JwtSecret = "",
    [string]$LocalServerDir = "$PSScriptRoot\server",
    [switch]$SkipUpload,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$requiredDeploymentSecrets = @('WX_APPID', 'WX_APPSECRET', 'WX_MCH_ID', 'WX_SERIAL_NO', 'WX_APIV3_KEY', 'WX_PLATFORM_PUBLIC_KEY', 'WX_PRIVATE_KEY', 'WX_PAY_NOTIFY_URL')
$missingDeploymentSecrets = $requiredDeploymentSecrets | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }
if ($missingDeploymentSecrets.Count -gt 0) {
    throw "缺少部署密钥环境变量：$($missingDeploymentSecrets -join ', ')。请从密钥管理器注入，不要把凭据写入脚本。"
}

function Write-Step {
    param([string]$Step, [string]$Msg)
    Write-Host ""
    Write-Host "[$Step] $Msg" -ForegroundColor Yellow
}

function Write-Ok {
    param([string]$Msg)
    Write-Host "  $Msg" -ForegroundColor Green
}

function Write-Err {
    param([string]$Msg)
    Write-Host "  ERROR: $Msg" -ForegroundColor Red
}

function Write-Info {
    param([string]$Msg)
    Write-Host "  $Msg" -ForegroundColor Gray
}

function Invoke-Remote {
    param([string]$Cmd)
    $fullCmd = "ssh -o StrictHostKeyChecking=accept-new ${User}@${Server} `"$Cmd`""
    if ($DryRun) {
        Write-Info "[DRY-RUN] $fullCmd"
        return $null, 0
    }
    $output = Invoke-Expression $fullCmd 2>&1
    $exitCode = $LASTEXITCODE
    return $output, $exitCode
}

# ============================================================
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  广轻工校园小程序后端一键部署" -ForegroundColor Cyan
Write-Host "  目标: ${User}@${Server} -> ${RemoteDir}" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# ---- 1. 前置检查 ----
Write-Step "1/9" "检查前置条件"

if (-not (Test-Path $LocalServerDir)) {
    Write-Err "找不到 server 目录: $LocalServerDir"
    exit 1
}

$sshCmd = Get-Command ssh -ErrorAction SilentlyContinue
$scpCmd = Get-Command scp -ErrorAction SilentlyContinue
if (-not $sshCmd -or -not $scpCmd) {
    Write-Err "未找到 ssh/scp 命令"
    Write-Info "Windows 10+ 可在 设置 > 应用 > 可选功能 中安装 OpenSSH 客户端"
    exit 1
}
Write-Ok "ssh/scp: OK"

# ---- 2. 测试 SSH 连接 ----
Write-Step "2/9" "测试 SSH 连接"
$output, $code = Invoke-Remote "echo SSH_OK"
if ($code -ne 0) {
    Write-Err "SSH 连接失败"
    Write-Info "请确保已配置 SSH 密钥: ssh-keygen -t ed25519 && ssh-copy-id ${User}@${Server}"
    exit 1
}
Write-Ok "SSH 连接: OK"

# ---- 3. 上传代码 ----
if (-not $SkipUpload) {
    Write-Step "3/9" "上传代码到服务器"

    # 用 scp 递归上传，排除不必要的文件
    Write-Info "创建远程目录..."
    Invoke-Remote "mkdir -p $RemoteDir" | Out-Null

    Write-Info "上传 server 目录..."
    $excludeFile = "$env:TEMP\deploy-exclude-$PID.txt"
    @"
node_modules
logs
.env
uploads
*.test.js
tests
.git
.DS_Store
"@ | Set-Content -Path $excludeFile -Encoding UTF8

    # 用 rsync 或 scp 上传
    $rsyncCmd = "rsync -avz --exclude-from=$excludeFile --delete $LocalServerDir/ ${User}@${Server}:${RemoteDir}/"
    $rsyncAvailable = Get-Command rsync -ErrorAction SilentlyContinue

    if ($rsyncAvailable) {
        Write-Info "使用 rsync 同步..."
        if ($DryRun) {
            Write-Info "[DRY-RUN] $rsyncCmd"
        } else {
            Invoke-Expression $rsyncCmd 2>&1 | ForEach-Object { Write-Info $_ }
        }
    } else {
        Write-Info "rsync 不可用，使用 scp..."
        # 先上传 .env 模板（不含密码）
        $tempEnv = "$env:TEMP\deploy-env-$PID"
        @"
# 服务端口
PORT=3000

# 运行环境
NODE_ENV=production

# MySQL 配置
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=$DbPassword
DB_NAME=gqg_campus

# Redis 配置
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# JWT 配置
JWT_SECRET=$JwtSecret
JWT_EXPIRES=7d

# 微信小程序配置
WX_APPID=$env:WX_APPID
WX_APPSECRET=$env:WX_APPSECRET

# 微信支付配置
WX_MCH_ID=$env:WX_MCH_ID
WX_SERIAL_NO=$env:WX_SERIAL_NO
WX_APIV3_KEY=$env:WX_APIV3_KEY
WX_APIV2_KEY=$env:WX_APIV2_KEY
WX_PUBLIC_KEY_ID=$env:WX_PUBLIC_KEY_ID
WX_PAY_NOTIFY_URL=$env:WX_PAY_NOTIFY_URL
WX_PLATFORM_PUBLIC_KEY=$env:WX_PLATFORM_PUBLIC_KEY
WX_PRIVATE_KEY=$env:WX_PRIVATE_KEY
JW_USE_OCR=1
JW_CAPTCHA_ATTEMPTS=1
JW_INITIAL_SYNC_WEEKS=1
SCHEDULE_TOTAL_WEEKS=19
JW_BASE_DELAY_MS=0
JW_JITTER_MS=0
JW_TIMEOUT_MS=8000
JW_MAX_RETRIES=0
JW_RETRY_BACKOFF_MS=300
JW_SYNC_COOLDOWN_MS=0
JW_FAST_SEMESTER_CONCURRENCY=6
"@ | Set-Content -Path $tempEnv -Encoding UTF8

        # 上传所有文件（排除 node_modules 等）
        Get-ChildItem -Path $LocalServerDir -Recurse | Where-Object {
            $rel = $_.FullName.Substring($LocalServerDir.Length + 1)
            $rel -notlike 'node_modules*' -and
            $rel -notlike 'logs*' -and
            $rel -notlike 'uploads*' -and
            $rel -notlike '.git*' -and
            $_.Name -notlike '*.test.js' -and
            $rel -notlike 'tests*'
        } | ForEach-Object {
            if ($_.PSIsContainer) {
                Invoke-Remote "mkdir -p $RemoteDir/$($_.FullName.Substring($LocalServerDir.Length + 1).Replace('\','/'))" | Out-Null
            } else {
                $remotePath = "$RemoteDir/$($_.FullName.Substring($LocalServerDir.Length + 1).Replace('\','/'))"
                if ($DryRun) {
                    Write-Info "[DRY-RUN] scp $($_.FullName) -> $remotePath"
                } else {
                    scp $_.FullName "${User}@${Server}:${remotePath}" 2>$null
                }
            }
        }

        # 上传 .env
        if ($DryRun) {
            Write-Info "[DRY-RUN] scp .env -> $RemoteDir/.env"
        } else {
            scp $tempEnv "${User}@${Server}:${RemoteDir}/.env" 2>$null
        }
        Remove-Item $tempEnv -Force -ErrorAction SilentlyContinue
        Remove-Item $excludeFile -Force -ErrorAction SilentlyContinue
    }

    Write-Ok "代码上传: OK"
} else {
    Write-Step "3/9" "跳过代码上传 (--SkipUpload)"
}

# ---- 4. 安装系统依赖 ----
Write-Step "4/9" "安装系统依赖 (Node.js, MySQL, Nginx, PM2)"

$installScript = @'
set -e

# 更新包列表
echo "  更新包列表..."
apt-get update -qq

# 安装 MySQL（如未安装）
if ! command -v mysql &> /dev/null; then
    echo "  安装 MySQL..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mysql-server
    systemctl enable mysql
    systemctl start mysql
fi

# 安装 Node.js 20.x（如未安装或版本过低）
if ! command -v node &> /dev/null || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 18 ]; then
    echo "  安装 Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
fi

# 安装 Nginx（如未安装）
if ! command -v nginx &> /dev/null; then
    echo "  安装 Nginx..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx
    systemctl enable nginx
fi

# 安装 PM2
if ! command -v pm2 &> /dev/null; then
    echo "  安装 PM2..."
    npm install -g pm2
fi

# 安装 certbot（SSL 证书）
if ! command -v certbot &> /dev/null; then
    echo "  安装 certbot..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
fi

echo "  版本信息:"
node -v
npm -v
mysql --version
nginx -v 2>&1
pm2 -v
'@

$output, $code = Invoke-Remote $installScript
if ($code -ne 0) {
    Write-Err "系统依赖安装失败"
    Write-Info ($output -join "`n")
    exit 1
}
Write-Info ($output -join "`n")
Write-Ok "系统依赖: OK"

# ---- 5. 初始化 MySQL 数据库 ----
Write-Step "5/9" "初始化 MySQL 数据库"

# 生成 JWT 密钥（如果未提供）
if ([string]::IsNullOrEmpty($JwtSecret)) {
    $JwtSecret = [Convert]::ToBase64String([System.Security.Cryptography.RNGCryptoServiceProvider]::new().GetBytes(32))
}

# 上传 SQL 文件并执行
$sqlInit = Join-Path $LocalServerDir "sql\init.sql"
$sqlSeed = Join-Path $LocalServerDir "sql\seed.sql"

if (-not (Test-Path $sqlInit)) {
    Write-Err "找不到初始化 SQL: $sqlInit"
    exit 1
}

Write-Info "上传并执行 init.sql..."
if (-not $DryRun) {
    scp $sqlInit "${User}@${Server}:/tmp/gqg_init.sql" 2>$null
}

$mysqlInitCmd = @"
mysql -u root -p'$DbPassword' < /tmp/gqg_init.sql && rm -f /tmp/gqg_init.sql
"@

$output, $code = Invoke-Remote $mysqlInitCmd
if ($code -ne 0) {
    Write-Err "init.sql 执行失败"
    Write-Info ($output -join "`n")
    exit 1
}
Write-Ok "数据库初始化: OK"

# 执行 seed.sql（可选）
if (Test-Path $sqlSeed) {
    Write-Info "上传并执行 seed.sql（测试数据）..."
    if (-not $DryRun) {
        scp $sqlSeed "${User}@${Server}:/tmp/gqg_seed.sql" 2>$null
    }
    $mysqlSeedCmd = "mysql -u root -p'$DbPassword' gqg_campus < /tmp/gqg_seed.sql && rm -f /tmp/gqg_seed.sql"
    $output, $code = Invoke-Remote $mysqlSeedCmd
    if ($code -ne 0) {
        Write-Info "seed.sql 执行有警告（可忽略）"
    } else {
        Write-Ok "测试数据导入: OK"
    }
}

# ---- 6. 安装 Node.js 依赖 ----
Write-Step "6/9" "安装项目依赖"

$npmScript = @'
cd /opt/gqg-campus
mkdir -p logs uploads
npm install --production 2>&1
'@

$output, $code = Invoke-Remote $npmScript
if ($code -ne 0) {
    Write-Err "npm install 失败"
    Write-Info ($output -join "`n")
    exit 1
}
Write-Info ($output -join "`n")
Write-Ok "项目依赖: OK"

# ---- 7. 配置 Nginx ----
Write-Step "7/9" "配置 Nginx 反向代理 + SSL"

$nginxConfig = @'
server {
    listen 80;
    server_name payun01.cn;

    location /api/v1/ {
        proxy_pass http://127.0.0.1:3000/api/v1/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location /uploads/ {
        alias /opt/gqg-campus/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
'@

# 写入 Nginx 配置
$nginxWriteCmd = @"
cat > /etc/nginx/sites-available/gqg-campus << 'NGINX_EOF'
$nginxConfig
NGINX_EOF
ln -sf /etc/nginx/sites-available/gqg-campus /etc/nginx/sites-enabled/gqg-campus
rm -f /etc/nginx/sites-enabled/default
nginx -t 2>&1
"@

$output, $code = Invoke-Remote $nginxWriteCmd
if ($code -ne 0) {
    Write-Err "Nginx 配置失败"
    Write-Info ($output -join "`n")
    exit 1
}
Write-Info ($output -join "`n")

# 申请 SSL 证书
Write-Info "申请 Let's Encrypt SSL 证书..."
$certbotCmd = "certbot --nginx -d payun01.cn --non-interactive --agree-tos --email admin@payun01.cn --redirect 2>&1"
$output, $code = Invoke-Remote $certbotCmd
if ($code -ne 0) {
    Write-Info "SSL 证书申请可能有警告（如域名未解析或已存在证书）"
    Write-Info ($output -join "`n")
} else {
    Write-Ok "SSL 证书: OK"
}

# 重载 Nginx
Invoke-Remote "systemctl reload nginx" | Out-Null
Write-Ok "Nginx 配置: OK"

# ---- 8. 启动服务 ----
Write-Step "8/9" "启动后端服务 (PM2)"

$pm2Script = @'
cd /opt/gqg-campus
pm2 delete GQG-campus 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true
sleep 2
pm2 list
'@

$output, $code = Invoke-Remote $pm2Script
if ($code -ne 0) {
    Write-Err "PM2 启动失败"
    Write-Info ($output -join "`n")
    exit 1
}
Write-Info ($output -join "`n")
Write-Ok "PM2 服务: OK"

# ---- 9. 验证 ----
Write-Step "9/9" "验证服务"

$healthCmd = "curl -s http://127.0.0.1:3000/api/v1/health"
$output, $code = Invoke-Remote $healthCmd
if ($code -eq 0) {
    Write-Ok "健康检查: $output"
} else {
    Write-Err "健康检查失败"
    Write-Info ($output -join "`n")
}

# ============================================================
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  部署完成！" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "验证命令:" -ForegroundColor Yellow
Write-Host "  curl https://payun01.cn/api/v1/health" -ForegroundColor Gray
Write-Host ""
Write-Host "小程序端修改:" -ForegroundColor Yellow
Write-Host "  小程序已固定使用真实 API，请确认微信后台配置 payun01.cn 为合法域名" -ForegroundColor Gray
Write-Host ""
Write-Host "PM2 管理命令 (在服务器上执行):" -ForegroundColor Yellow
Write-Host "  pm2 list          # 查看进程" -ForegroundColor Gray
Write-Host "  pm2 logs          # 查看日志" -ForegroundColor Gray
Write-Host "  pm2 restart all   # 重启服务" -ForegroundColor Gray
Write-Host "  pm2 monit         # 监控面板" -ForegroundColor Gray
Write-Host ""

