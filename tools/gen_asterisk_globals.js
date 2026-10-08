'use strict';

/**
 * Генерация /etc/asterisk/asgard_globals.conf из pbx_config.
 *
 * Нужно для fail-open: когда AGI (asgard-pbx) недоступен, номер дежурного для
 * переадресации входящего он сообщить уже не может — значение обязано лежать
 * в файле, который Asterisk читает сам (без участия CRM/Node).
 *
 * Запуск: node tools/gen_asterisk_globals.js [--out /etc/asterisk/asgard_globals.conf]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = '/etc/asterisk/asgard_globals.conf';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const out = arg('--out', DEFAULT_OUT);
  const { Pool } = require(path.join(ROOT, 'node_modules/pg'));
  const cs = process.env.DATABASE_URL
    || `postgresql://${process.env.DB_USER || 'asgard'}:${process.env.DB_PASSWORD || '123456789'}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'asgard_crm'}`;
  const pool = new Pool({ connectionString: cs });

  let cfg = {};
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM settings WHERE key = 'pbx_config' LIMIT 1`
    );
    cfg = rows[0]?.value_json || {};
    if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch (_) { cfg = {}; } }
  } finally {
    await pool.end();
  }

  const digits = (v) => String(v || '').replace(/[^\d]/g, '');
  const failopenMobile = digits(cfg.failopen_mobile || cfg.duty_mobile || '');
  const vmMax = Number(cfg.voicemail_max_sec) > 0 ? Number(cfg.voicemail_max_sec) : 60;
  const dutyTo = Number(cfg.mobile_ring_sec) > 0 ? Number(cfg.mobile_ring_sec) : 30;

  const body = [
    '; ⚠ АВТОГЕНЕРАЦИЯ — не редактировать руками.',
    '; Источник: settings.pbx_config. Обновить: node tools/gen_asterisk_globals.js',
    '; ВАЖНО: файл подключается ВНУТРИ [globals] из extensions.conf (без своего заголовка),',
    '; иначе второй [globals] Asterisk игнорирует.',
    `ASGARD_FAILOPEN_MOBILE=${failopenMobile}`,
    `ASGARD_DUTY_MOBILE_TO=${dutyTo}`,
    `ASGARD_VM_MAX_SEC=${vmMax}`,
    '',
  ].join('\n');

  fs.writeFileSync(out, body, { encoding: 'utf8', mode: 0o640 });
  try { fs.chownSync(out, 'asterisk', 'asterisk'); } catch (_) { /* не root — пропускаем */ }
  console.log(`generated ${out}: failopen_mobile=${failopenMobile || '(пусто)'}, duty_to=${dutyTo}, vm=${vmMax}`);
  return failopenMobile ? 0 : 2;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error('FAIL', e.message);
    process.exit(1);
  });
