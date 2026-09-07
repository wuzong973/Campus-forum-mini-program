const pool = require('./config/pool');
(async () => {
  try {
    const [idx] = await pool.query('SHOW INDEX FROM private_conversation');
    console.log('indexes:', [...new Set(idx.map(i => i.Key_name))].join(', '));
    const [rows] = await pool.query("SELECT id, user_id, peer_id, LEFT(persona_key,44) AS persona, is_anonymous, LEFT(last_message_text,12) AS last_text FROM private_conversation ORDER BY id DESC LIMIT 12");
    console.table(rows);
    const [msgs] = await pool.query("SELECT COUNT(*) AS total, SUM(persona_key != '') AS with_persona FROM private_message");
    console.log('messages:', JSON.stringify(msgs[0]));
  } catch (e) { console.error('ERR:', e.message); }
  process.exit(0);
})();
