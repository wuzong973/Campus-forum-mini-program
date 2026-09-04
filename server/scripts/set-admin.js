const mysql = require('mysql2/promise');
require('dotenv').config();

async function setAdmin() {
  const phone = process.argv[2] || '19867363523';
  const role = process.argv[3] || 'super_admin';

  console.log(`正在查找手机号: ${phone}`);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    // 查询用户
    const [users] = await connection.execute(
      'SELECT id, nick_name, role FROM sys_user WHERE phone = ?',
      [phone]
    );

    if (users.length === 0) {
      console.log('❌ 该手机号尚未注册，请先在小程序中登录注册');
      return;
    }

    const user = users[0];
    console.log(`✓ 找到用户: ID=${user.id}, 昵称=${user.nick_name}, 当前角色=${user.role}`);

    // 更新角色
    await connection.execute(
      'UPDATE sys_user SET role = ? WHERE phone = ?',
      [role, phone]
    );

    console.log(`✓ 已成功设置为 ${role}`);
  } catch (err) {
    console.error('❌ 操作失败:', err.message);
  } finally {
    await connection.end();
  }
}

setAdmin();
