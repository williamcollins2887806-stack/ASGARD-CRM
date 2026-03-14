// Fix users: set must_change_password=true, remove pin_hash, generate simple temp passwords
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  user: 'asgard', password: '123456789',
  host: 'localhost', database: 'asgard_crm', port: 5432
});

// Simple readable temp passwords
function genTempPass() {
  const adj = ['Viking', 'Odin', 'Thor', 'Freya', 'Asgard', 'Rune', 'Nord', 'Fenrir', 'Mjolnir', 'Valhalla',
               'Bifrost', 'Huginn', 'Muninn', 'Gungnir', 'Drakar', 'Ulfr', 'Sigurd', 'Baldur', 'Heimdall', 'Tyr'];
  const num = String(Math.floor(100 + Math.random() * 900));
  return adj[Math.floor(Math.random() * adj.length)] + num;
}

(async () => {
  // Load existing credentials
  const creds = JSON.parse(fs.readFileSync('/tmp/user_credentials.json', 'utf8'));

  for (const u of creds) {
    const tempPass = genTempPass();
    const passHash = await bcrypt.hash(tempPass, 10);

    await pool.query(`
      UPDATE users
      SET password_hash = $1, pin_hash = NULL, must_change_password = true, updated_at = NOW()
      WHERE login = $2
    `, [passHash, u.login]);

    u.password = tempPass;
    u.pin = null;
    console.log(`${u.login}: temp password = ${tempPass}`);
  }

  fs.writeFileSync('/tmp/user_credentials.json', JSON.stringify(creds, null, 2));
  console.log('\nUpdated ' + creds.length + ' users with temp passwords, must_change_password=true');

  await pool.end();
})();
