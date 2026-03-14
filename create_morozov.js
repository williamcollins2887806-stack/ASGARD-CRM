const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({ user:'asgard', password:'123456789', host:'localhost', database:'asgard_crm', port:5432 });

(async () => {
  const adj = ['Viking','Odin','Thor','Freya','Asgard','Rune','Nord','Fenrir','Mjolnir','Valhalla','Bifrost','Huginn','Muninn','Gungnir','Drakar','Ulfr','Sigurd','Baldur','Heimdall','Tyr'];
  const tempPass = adj[Math.floor(Math.random()*adj.length)] + String(Math.floor(100+Math.random()*900));
  const passHash = await bcrypt.hash(tempPass, 10);

  const res = await pool.query(
    `INSERT INTO users (login, password_hash, pin_hash, name, email, role, phone, is_active, must_change_password, created_at)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, true, true, NOW()) RETURNING id`,
    ['i.morozov', passHash, 'Морозов Иван', 'i.morozov@asgard-service.com', 'TO', '+79157032315']
  );

  console.log('Created i.morozov ID=' + res.rows[0].id + ' temp_pass=' + tempPass);

  const creds = JSON.parse(fs.readFileSync('/tmp/user_credentials.json','utf8'));
  creds.push({
    id: res.rows[0].id, login:'i.morozov', password: tempPass, pin: null,
    name:'Морозов Иван', email:'i.morozov@asgard-service.com',
    role:'TO', title:'Менеджер тендерного отдела', phone:'+79157032315'
  });
  fs.writeFileSync('/tmp/user_credentials.json', JSON.stringify(creds, null, 2));
  console.log('Credentials updated');

  await pool.end();
})();
