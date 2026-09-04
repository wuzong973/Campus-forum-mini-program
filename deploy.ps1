$server = "193.112.187.95"
$user = "root"
$pass = "Wzl@88888"
$remotePath = "/root/校园论坛小程序/server"

# Files to upload
$files = @(
    "server\app.js",
    "server\controllers\adminController.js",
    "server\controllers\userController.js",
    "server\routes\adminRoutes.js",
    "server\routes\userRoutes.js",
    "server\utils\migrations.js"
)

# Create SSH config to skip host key check
$sshArgs = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

# Upload each file
foreach ($file in $files) {
    $localFile = Join-Path "d:\校园论坛小程序" $file
    $remoteFile = "$remotePath\$($file -replace '\\', '/')"
    Write-Host "Uploading: $file"
    
    # Use scp with password via expect-like approach
    $scpCmd = "echo '$pass' | scp $sshArgs `"$localFile`" ${user}@${server}:`"$remoteFile`""
    Invoke-Expression $scpCmd
}

# Restart the server
Write-Host "Restarting server..."
$restartCmd = "echo '$pass' | ssh $sshArgs ${user}@${server} 'cd $remotePath && pm2 restart all || (cd $remotePath && npm start &)' "
Invoke-Expression $restartCmd

Write-Host "Done!"
