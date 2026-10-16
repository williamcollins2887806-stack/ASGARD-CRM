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

function loadEnvFile(file) {
  try {
    const txt = require('fs').readFileSync(file, 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      if (process.env[key]) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch (_) { /* файла нет — не критично */ }
}

function loadPool() {
  // Ищем строку подключения в известных env-файлах, если она не задана явно.
  // Приложение (ubuntu) не может прочитать /etc/asgard-crm/pbx.env (0600 root),
  // а самостоятельный запуск под root — может; под sudo env сохраняется.
  if (!process.env.DATABASE_URL) {
    loadEnvFile('/etc/asgard-crm/pbx.env');
    loadEnvFile(path.join(ROOT, '.env'));
  }
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

/**
 * СИП-логин оператора. Держать В ТОЧНОСТИ как `genSipUsername` в
 * src/routes/telephony-pbx.js — иначе фронт ждёт один логин, а в Asterisk
 * заведён другой, и регистрация падает 404/401.
 */
function genSipUsername(userId, name) {
  const slug = String(name || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 12);
  return `u${userId}${slug ? '_' + slug : ''}`;
}

/**
 * Выдать СИП всем офисным, у кого его нет (и логин, и пароль).
 *
 * Раньше СИП появлялся только «лениво» — при первом входе в софтфон. Из-за
 * этого 20 из 25 офисных не имели СИП вообще и не могли принимать звонки в
 * браузере (всё уходило на мобильный), а перевести им «в СРМ» было нельзя
 * (17.10.2026, Тумаева). Теперь СИП раздаётся сразу всем, кто проходит тот же
 * фильтр, что и миграция V393 (активные, кроме BOT/FIELD_WORKER и тестовых).
 */
async function issueAllCredentials(pool, dry) {
  const { rows } = await pool.query(
    `SELECT o.user_id, o.sip_username, o.sip_password, u.name
     FROM users u
     JOIN pbx_operators o ON o.user_id = u.id
     WHERE u.is_active = true
       AND u.role <> ALL (ARRAY['BOT', 'FIELD_WORKER'])
       AND (u.login IS NULL OR (u.login !~ '^test_' AND u.login <> 'mimir_bot'))
       AND (COALESCE(o.sip_username, '') = '' OR COALESCE(o.sip_password, '') = '')
     ORDER BY o.user_id`
  );
  if (!rows.length) {
    console.log('credentials: все офисные уже имеют СИП');
    return 0;
  }
  if (dry) {
    console.log(`[dry-run] выдать СИП ${rows.length} операторам`);
    return rows.length;
  }
  const crypto = require('crypto');
  for (const r of rows) {
    const username = r.sip_username && r.sip_username !== ''
      ? r.sip_username
      : genSipUsername(r.user_id, r.name);
    const pass = r.sip_password && r.sip_password !== ''
      ? r.sip_password
      : crypto.randomBytes(12).toString('base64url');
    await pool.query(
      `UPDATE pbx_operators
         SET sip_username = $2, sip_password = $3, sip_password_hash = $4, updated_at = NOW()
       WHERE user_id = $1`,
      [r.user_id, username, pass, crypto.createHash('sha256').update(pass).digest('hex')]
    );
    console.log(`issued SIP ${username} (user ${r.user_id})`);
  }
  return rows.length;
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const pool = loadPool();

  // Раздать СИП всем офисным (логин + пароль) — не ждать, пока зайдут в софтфон.
  await issueAllCredentials(pool, dry);

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

  // КРИТИЧНО (инцидент 16.10.2026): НЕ делаем `pjsip reload`, если файл НЕ
  // изменился. Раньше reload шёл на КАЖДЫЙ /softphone/provision (а фронт зовёт
  // provision при каждой регистрации/ensureRegistered). `pjsip reload`
  // перечитывает конфиг и сбрасывает ВСЕ контакты операторов — при 3 открытых
  // сессиях это рушило регистрацию каждые 1-2 минуты («СИП не зарегистрирован»,
  // «звонок в браузер не приходит», «звонок идёт на мобильный»).
  let prevBody = '';
  try { prevBody = fs.readFileSync(OUT, 'utf8'); } catch (_) { /* файла ещё нет */ }
  const changed = prevBody !== body;

  if (changed) {
    fs.writeFileSync(OUT, body, { encoding: 'utf8', mode: 0o640 });
    // Файл лежит в /etc/asterisk и должен читаться пользователем asterisk.
    // Скрипт запускается под root, поэтому writeFileSync создаст root:root 0640
    // → asterisk не прочтёт конфиг и эндпоинты не поднимутся (16.10.2026).
    try {
      const uid = execFileSync('id', ['-u', 'asterisk'], { encoding: 'utf8' }).trim();
      const gid = execFileSync('id', ['-g', 'asterisk'], { encoding: 'utf8' }).trim();
      fs.chownSync(OUT, Number(uid), Number(gid));
    } catch (e) {
      console.warn(`chown asterisk:asterisk failed (${e.message}) — проверьте права вручную`);
    }
    console.log(`written ${OUT} (${rows.length} endpoints)`);
  } else {
    console.log(`unchanged ${OUT} (${rows.length} endpoints) — reload skipped`);
  }

  // #include в pjsip.conf (одним #include, сам файл генерируется целиком)
  const pj = fs.readFileSync(PJSIP_CONF, 'utf8');
  const marker = 'pjsip_operators.conf';
  let includeAdded = false;
  if (!pj.includes(marker)) {
    fs.writeFileSync(PJSIP_CONF, pj.replace(/\s*$/, '\n') + `#include ${marker}\n`, 'utf8');
    console.log(`#include добавлен в ${PJSIP_CONF}`);
    includeAdded = true;
  }

  // Reload ТОЛЬКО если конфиг реально изменился (или добавлен #include).
  if (!changed && !includeAdded) {
    console.log('pjsip reload: skipped (no changes)');
    return 0;
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
