'use strict';

/**
 * Провижининг PJSIP WebRTC-эндпоинтов операторов из БД (запуск под root).
 *
 *   node tools/provision_pjsip_operators.js            # пишет конфиг + pjsip reload
 *   node tools/provision_pjsip_operators.js --dry-run   # только печатает
 *
 * Требует колонку pbx_operators.sip_password (миграция V374).
 * Запуск: export DATABASE_URL=... (или через systemd ExecStartPost / вручную).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.ASTERISK_OPERATORS_CONF || '/etc/asterisk/pjsip_operators.conf';
const PJSIP_CONF = process.env.ASTERISK_PJSIP_CONF || '/etc/asterisk/pjsip.conf';

function loadPool() {
  const { Pool } = require(path.join(ROOT, 'node_modules/pg'));
  const cs = process.env.DATABASE_URL
    || `postgresql://${process.env.DB_USER || 'asgard'}:${process.env.DB_PASSWORD || '123456789'}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'asgard_crm'}`;
  return new Pool({ connectionString: cs });
}

function section(username, password) {
  const u = username.replace(/[^A-Za-z0-9_.-]/g, '');
  return [
    `; ASGARD operator ${u} (generated)`,
    `[${u}](webrtc-template)`,
    `auth=${u}`,
    `aors=${u}`,
    '',
    `[${u}](auth-webrtc-template)`,
    `username=${u}`,
    `password=${password}`,
    '',
    `[${u}](aor-webrtc-template)`,
    '',
  ].join('\n');
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const pool = loadPool();

  // Выпустить пароли тем операторам, у кого есть sip_username, но нет sip_password.
  const { rows: missing } = await pool.query(
    `SELECT user_id, sip_username FROM pbx_operators
     WHERE sip_username IS NOT NULL AND sip_username <> ''
       AND (sip_password IS NULL OR sip_password = '')`
  );
  if (!dry) {
    const crypto = require('crypto');
    for (const m of missing) {
      const pass = crypto.randomBytes(12).toString('base64url');
      await pool.query(
        `UPDATE pbx_operators SET sip_password = $2, sip_password_hash = $3, updated_at = NOW() WHERE user_id = $1`,
        [m.user_id, pass, crypto.createHash('sha256').update(pass).digest('hex')]
      );
      console.log(`issued password for ${m.sip_username}`);
    }
  } else if (missing.length) {
    console.log(`[dry-run] will issue ${missing.length} passwords`);
  }

  const { rows } = await pool.query(
    `SELECT sip_username, sip_password FROM pbx_operators
     WHERE sip_username IS NOT NULL AND sip_username <> ''
       AND sip_password IS NOT NULL AND sip_password <> ''
     ORDER BY user_id`
  );
  await pool.end();

  if (!rows.length) {
    console.error('Нет операторов с sip_password — сначала выпустить пароли (credentials endpoint).');
    process.exit(2);
  }

  const header = [
    '; ⚠ АВТОГЕНЕРАЦИЯ — не редактировать руками.',
    '; Источник: pbx_operators.sip_username/sip_password.',
    '; Обновить: node tools/provision_pjsip_operators.js',
    '',
  ].join('\n');
  const body = header + rows.map((r) => section(r.sip_username, r.sip_password)).join('\n');

  if (dry) {
    console.log(body);
    console.log(`\n[dry-run] ${rows.length} endpoints → ${OUT}`);
    return 0;
  }

  fs.writeFileSync(OUT, body, { encoding: 'utf8', mode: 0o640 });
  console.log(`written ${OUT} (${rows.length} endpoints)`);

  // #include в pjsip.conf (одним #include, сам файл генерируется целиком)
  const pj = fs.readFileSync(PJSIP_CONF, 'utf8');
  const marker = 'pjsip_operators.conf';
  if (!pj.includes(marker)) {
    fs.writeFileSync(PJSIP_CONF, pj.replace(/\s*$/, '\n') + `#include ${marker}\n`, 'utf8');
    console.log(`#include добавлен в ${PJSIP_CONF}`);
  }

  try {
    execFileSync('asterisk', ['-rx', 'pjsip reload'], { encoding: 'utf8' });
    console.log('pjsip reload: OK');
  } catch (e) {
    console.error('pjsip reload FAILED:', e.message);
    return 1;
  }
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
