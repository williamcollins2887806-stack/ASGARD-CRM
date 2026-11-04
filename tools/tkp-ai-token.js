#!/usr/bin/env node
'use strict';
/** Выпустить тестовый JWT в файл (для рантайм-проверок на клоне). */
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('../src/services/db');

const login = process.argv[2] || 'test_to';
const outFile = process.argv[3] || 'tmp/token.txt';

(async () => {
  const { rows } = await db.query('SELECT id, login, name, role FROM users WHERE login = $1 AND is_active = true', [login]);
  if (!rows[0]) { console.error('нет пользователя ' + login); process.exit(1); }
  const u = rows[0];
  const token = jwt.sign(
    { id: u.id, login: u.login, role: u.role, name: u.name },
    process.env.JWT_SECRET || 'asgard-jwt-secret-2026',
    { expiresIn: '4h' }
  );
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, token, 'utf8');
  console.log('ok: ' + u.login + ' (' + u.role + ') → ' + outFile);
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
