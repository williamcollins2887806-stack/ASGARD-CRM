'use strict';

/**
 * Регрессии 16.10.2026 — перевод звонка сотруднику без строки pbx_operators.
 *
 * Живой инцидент: перевод Путков → Тумаева (user_id 3471, OFFICE_MANAGER,
 * тел. 79199900139). У Тумаевой не было строки в pbx_operators, и
 * resolveTransferDial отдавал её внутренний ID «3471» как НОМЕР ТЕЛЕФОНА →
 * Asterisk звал PJSIP/3471@mango-trunk → congested → звонок рвался.
 *
 * Тест требует клон БД (asgard_crm_test) с применённой V393:
 *   DATABASE_URL=postgresql://asgard:123456789@127.0.0.1:5432/asgard_crm_test \
 *     node tests/pbx/transfer-nonoperator.test.js
 *
 * Без DATABASE_URL проверяются только source-контракты (быстрые инварианты).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;

function test(id, name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { passed++; console.log(`  \u2713 ${id} ${name}`); })
    .catch((e) => { failed++; console.error(`  \u2717 ${id} ${name}: ${e.message}`); });
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('transfer-nonoperator');

async function main() {
  // ── Source-контракты (без БД) ──────────────────────────────────────────
  await test('T1', 'resolveTransferDial ищет цель от users (LEFT JOIN), а не от pbx_operators', () => {
    const js = read('src/pbx/index.js');
    const i = js.indexOf('async function resolveTransferDial');
    const blk = js.slice(i, i + 2600);
    assert.ok(/FROM users u[\s\S]*LEFT JOIN pbx_operators o ON o\.user_id = u\.id/.test(blk),
      'нет LEFT JOIN от users — сотрудник без оператора не опознается');
    assert.ok(!/FROM pbx_operators o\s*\n\s*JOIN users u ON u\.id = o\.user_id[\s\S]{0,400}WHERE o\.user_id = \$1/.test(blk),
      'остался INNER JOIN по операторам в ветке числового target');
  });

  await test('T2', 'голый внутренний ID (<10 цифр) НЕ диалается как телефон', () => {
    const js = read('src/pbx/index.js');
    const i = js.indexOf('async function resolveTransferDial');
    const j = js.indexOf('\nfunction createCmdServer', i);
    const blk = js.slice(i, j > i ? j : i + 9000);
    assert.ok(/digits\.length >= 10/.test(blk), 'нет порога длины номера — «3471» уйдёт на транк');
    assert.ok(/target unresolved/.test(blk), 'нет предупреждения при неопознанной цели');
    // 11-значный номер не должен идти в int4 как user_id (overflow → 500).
    assert.ok(/asNum <= 2147483647/.test(blk), 'нет отсечки по int4 — длинный номер уронит запрос');
  });

  await test('T2b', 'мобильные/desktop-фронты: роль OFFICE_MANAGER не режется whitelist', () => {
    const files = [
      'public/assets/js/phone_ui.js',
      'public/assets/js/telephony_popup.js',
      'public/assets/js/custom_dashboard.js',
      'public/mobile-app/src/pages/More.jsx',
      'public/mobile-app/src/widgets/index.js',
      'public/desktop-v2-src/src/pages/Telephony/index.jsx',
      'public/desktop-v2-src/src/pages/Telephony/IncomingCallPopup.jsx',
    ];
    for (const f of files) {
      const txt = read(f);
      assert.ok(!/['"]DIRECTOR_COMM['"],\s*['"]DIRECTOR_DEV['"],\s*['"]PM['"]/.test(txt),
        `${f}: остался whitelist ролей телефонии`);
    }
    const widgets = read('public/mobile-app/src/widgets/index.js');
    assert.ok(/telephony_status:[^\n]*roles: \['\*'\]/.test(widgets),
      'widgets/index.js: виджет телефонии под whitelist');
    assert.ok(/canUseTelephony/.test(read('public/mobile-app/src/components/telephony/SoftphoneProvider.jsx')),
      'mobile: нет canUseTelephony');
    assert.ok(!/roles: \['ADMIN','DIRECTOR_GEN'/.test(read('public/mobile-app/src/pages/More.jsx')),
      'More.jsx: пункт «Телефон» всё ещё под whitelist');
  });

  await test('T2c', 'виджет дашборда telephony_status доступен всем ролям', () => {
    const txt = read('public/assets/js/custom_dashboard.js');
    assert.ok(/telephony_status:[^\n]*roles: \['\*'\]/.test(txt),
      'custom_dashboard.js: виджет телефонии под whitelist');
  });

  await test('T3', '/transfer/staff ищет от users (иначе сотрудника нет в списке перевода)', () => {
    const js = read('src/routes/telephony-pbx.js');
    const i = js.indexOf("'/transfer/staff'");
    const blk = js.slice(i, i + 1600);
    assert.ok(/FROM users u[\s\S]*LEFT JOIN pbx_operators o ON o\.user_id = u\.id/.test(blk),
      'список перевода строится от pbx_operators → без оператора сотрудник отсутствует');
    assert.ok(/usersExcludeSql/.test(blk), 'нет фильтра тестовых/служебных логинов');
  });

  await test('T4', 'провижининг запускается через sudo -n (приложение не root)', () => {
    const js = read('src/routes/telephony-pbx.js');
    assert.ok(/sudo'/.test(js) && /'-n'/.test(js), 'нет запуска через sudo -n');
    assert.ok(/chownSync\(OUT/.test(read('tools/provision_pjsip_operators.js')),
      'нет chown asterisk:asterisk — Asterisk не прочтёт конфиг');
  });

  // ── Живая проверка на клоне (если задан DATABASE_URL) ──────────────────
  const cs = process.env.DATABASE_URL;
  if (!cs) {
    console.log('  (DATABASE_URL не задан — пропуск живых T5-T8)');
  } else {
    const { Pool } = require(path.join(ROOT, 'node_modules/pg'));
    const pool = new Pool({ connectionString: cs });
    const { resolveTransferDial } = require('../../src/pbx/index.js');

    try {
      const { rows: tg } = await pool.query(
        `SELECT u.id, u.role, u.phone, (o.user_id IS NOT NULL) AS has_op
         FROM users u LEFT JOIN pbx_operators o ON o.user_id = u.id
         WHERE u.id = 3471`
      );
      const target = tg[0];

      if (!target) {
        console.log('  (пользователь 3471 в клоне не найден — пропуск T5-T8)');
      } else {
        await test('T5', 'Тумаева опознана и её мобильный = 79199900139 (не «3471»)', async () => {
          const r = await resolveTransferDial(pool, { target: '3471', user_id: 3474 });
          const mob = (r.targets || []).find((t) => t.targetType === 'mobile');
          assert.ok(mob, 'нет mobile-цели');
          assert.strictEqual(mob.targetAddr, '79199900139', `ожидали телефон, получили «${mob.targetAddr}»`);
          assert.ok(!/^PJSIP\/3471@/.test(r.dial), `dial ушёл на внутренний ID: ${r.dial}`);
        });

        await test('T6', 'dial не содержит @mango-trunk с голым ID (3471)', async () => {
          const r = await resolveTransferDial(pool, { target: '3471', user_id: 3474 });
          assert.ok(!/PJSIP\/3471@mango-trunk/.test(r.dial || ''), `регрессия: ${r.dial}`);
        });

        await test('T7', 'выбор «на мобильный» даёт ровно один mobile-таргет', async () => {
          const r = await resolveTransferDial(pool, { target: '3471', user_id: 3474, target_mode: 'mobile' });
          assert.strictEqual((r.targets || []).length, 1, 'ожидали один таргет');
          assert.strictEqual(r.targets[0].targetType, 'mobile');
          assert.strictEqual(r.targets[0].targetAddr, '79199900139');
        });

        await test('T8', 'несуществующий короткий ID не превращается в телефон', async () => {
          const r = await resolveTransferDial(pool, { target: '999999', user_id: 3474 });
          assert.strictEqual((r.targets || []).length, 0, 'короткий неизвестный ID не должен давать mobile-таргет');
          assert.ok(!/mango-trunk/.test(r.dial || ''), `ложный транк-набор: ${r.dial}`);
        });

        await test('T9', '11-значный номер как target не роняет запрос (нет overflow int4)', async () => {
          let r;
          try {
            r = await resolveTransferDial(pool, { target: '79199900139', user_id: 3474 });
          } catch (e) {
            throw new Error(`resolveTransferDial бросил: ${e.message}`);
          }
          const mob = (r.targets || []).find((t) => t.targetType === 'mobile');
          assert.ok(mob, 'внешний номер должен уходить в mobile-таргет');
          assert.strictEqual(mob.targetAddr, '79199900139');
        });
      }

      await test('T10', 'артефакт V393 при прогоне НЕ заводит тестовых (транзакция + rollback)', async () => {
        // Не копия предиката, а РЕАЛЬНЫЙ прогон migrations/V393...sql в
        // транзакции: считаем именно НОВЫЕ строки операторов, а затем откат.
        // Так тест ловит регрессию фильтра в артефакте и не зависит от
        // легаси-состояния клона.
        const sql = fs.readFileSync(
          path.join(ROOT, 'migrations', 'V393__pbx_provision_office_operators.sql'), 'utf8');
        const client = await pool.connect();
        let leaked = -1;
        let added = -1;
        try {
          await client.query('BEGIN');
          await client.query('CREATE TEMP TABLE _v393_before ON COMMIT DROP AS SELECT user_id FROM pbx_operators');
          await client.query(sql);
          const { rows } = await client.query(
            `SELECT count(*)::int AS leaked,
                    (SELECT count(*)::int FROM pbx_operators o
                     WHERE o.user_id NOT IN (SELECT user_id FROM _v393_before)) AS added
             FROM pbx_operators o
             JOIN users u ON u.id = o.user_id
             WHERE o.user_id NOT IN (SELECT user_id FROM _v393_before)
               AND ( u.role IN ('BOT','FIELD_WORKER')
                     OR u.login ~ '^test_' OR u.login = 'mimir_bot'
                     OR COALESCE(u.email,'') ILIKE '%@test.%'
                     OR COALESCE(u.name,'') ~* '^\\s*(test|тест)(\\s|$)' )`
          );
          leaked = rows[0].leaked;
          added = rows[0].added;
        } finally {
          await client.query('ROLLBACK').catch(() => {});
          client.release();
        }
        assert.strictEqual(leaked, 0, `V393 завела тестовых операторов: ${leaked} (добавлено всего ${added})`);
        // Санити: миграция вообще что-то делает (иначе тест vacuously зелен).
        assert.ok(added > 0, 'V393 не добавила ни одной строки — тест бессмыслен');
      });
    } finally {
      await pool.end();
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
