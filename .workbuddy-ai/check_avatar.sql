SELECT 'a_user_old_path' k, COUNT(*) v FROM sys_user WHERE avatar_url LIKE '/assets/avatar2/1%(%'
UNION ALL SELECT 'b_user_empty_avatar', COUNT(*) FROM sys_user WHERE avatar_url IS NULL OR avatar_url = ''
UNION ALL SELECT 'c_user_default_nick', COUNT(*) FROM sys_user WHERE nick_name IS NULL OR nick_name = '' OR nick_name IN ('校园用户','微信用户','用户')
UNION ALL SELECT 'd_notif_old_path', COUNT(*) FROM system_notification WHERE actor_avatar LIKE '/assets/avatar2/1%(%'
UNION ALL SELECT 'e_user_total', COUNT(*) FROM sys_user;
