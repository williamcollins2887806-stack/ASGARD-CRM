'use strict';

/**
 * Wave 2 scenario matrix (L1 unit + source contracts + DB checks on clone).
 *
 * Покрывает новые требования (08.10.2026):
 *   L1 — одна линия с перехватом (partial unique index, claimLine)
 *   L2 — цепочка фолбэков: браузер (10с) → дежурный мобильный (30с) → голосовая почта
 *   L3 — голосовая почта (saveVoicemail + /recording/voicemail)
 *   L4 — запись всегда (MixMonitor в входящем/исходящем/from-internal)
 *   S1 — fail-open при недоступном AGI (dialplan)
 *   S2 — звонок во время переключения/перехвата
 *   A  — JsSIP валиден (гейт) + SIP не блокирует on_line
 *
 * Usage: node tests/pbx/scenario-matrix-w2.js
 * Optional DB: DATABASE_URL=...asgard_crm_test (L1/L3 реальные проверки)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildRingPlan,
  expandOperatorTargets,
} = require('../../src/pbx/dial-engine');
const { normalizePbxConfig, buildDialVars } = require('../../src/pbx/call-lifecycle');
const { claimLine } = require('../../src/pbx/line-claim');

const ROOT = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;
const results = [];

function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function test(id, name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      results.push({ id, name, ok: true });
      console.log(`  ✓ ${id} ${name}`);
    })
    .catch((e) => {
      failed++;
      results.push({ id, name, ok: false, error: e.message });
      console.error(`  ✗ ${id} ${name}: ${e.message}`);
    });
}

const workHours = {
  mon: { start: '09:00', end: '18:00' },
  tue: { start: '09:00', end: '18:00' },
  wed: { start: '09:00', end: '18:00' },
  thu: { start: '09:00', end: '18:00' },
  fri: { start: '09:00', end: '18:00' },
  sat: null,
  sun: null,
};

const baseConfig = normalizePbxConfig({
  routing_mode: 'duty_first',
  timezone: 'Europe/Moscow',
  work_hours: workHours,
  duty_until: '20:00',
  max_agents: 3,
});

const workNow = new Date('2026-10-02T09:00:00.000Z'); // Пт 12:00 MSK

function op(id, overrides = {}) {
  return {
    user_id: id,
    can_accept: true,
    sort_order: id * 10,
    receive_mode: 'browser',
    on_line: true,
    mobile_phone: `+790000000${id}`,
    sip_username: `sip${id}`,
    miss_streak: 0,
    paused_until: null,
    webrtc_registered: true,
    last_seen_at: new Date(workNow.getTime() - 30000).toISOString(),
    ...overrides,
  };
}

async function main() {
  console.log('scenario-matrix-w2');

  // ── A. JsSIP и регистрация ──
  await test('A1', 'vendor jssip.min.js валиден (parse + JsSIP.UA)', () => {
    const src = readSrc('public/assets/vendor/jssip.min.js');
    assert.ok(src.length > 100000, 'файл слишком мал — похоже, повреждён');
    // eslint-disable-next-line no-new-func
    new Function(src); // бросит SyntaxError на битом бандле
    assert.ok(src.indexOf('JsSIP') !== -1, 'нет маркера JsSIP');
  });

  await test('A2', 'index.html подключает jssip до phone_core', () => {
    const html = readSrc('public/index.html');
    const ji = html.indexOf('jssip.min.js');
    const pi = html.indexOf('phone_core.js');
    assert.ok(ji !== -1, 'jssip.min.js не подключён');
    assert.ok(pi !== -1, 'phone_core.js не подключён');
    assert.ok(ji < pi, 'jssip должен грузиться раньше phone_core');
  });

  await test('A3', 'register() не ставит on_line (регистрация != дежурство)', () => {
    const core = readSrc('public/assets/js/phone_core.js');
    const regIdx = core.indexOf('register: function');
    const dutyIdx = core.indexOf('goOnDuty: function');
    assert.ok(regIdx !== -1 && dutyIdx !== -1, 'нет register/goOnDuty');
    const regBody = core.slice(regIdx, dutyIdx);
    assert.ok(!/claim-line/.test(regBody), 'register() не должен брать линию');
    const dutyBody = core.slice(dutyIdx, dutyIdx + 900);
    assert.ok(/claim-line/.test(dutyBody), 'goOnDuty() должен звать claim-line');
  });

  await test('A4', 'успешная SIP-регистрация НЕ занимает линию (on_line не шлётся)', () => {
    const core = readSrc('public/assets/js/phone_core.js');
    const regIdx = core.indexOf("ua.on('registered'");
    assert.ok(regIdx !== -1, 'нет обработчика registered');
    const body = core.slice(regIdx, regIdx + 700);
    assert.ok(/operator\/webrtc/.test(body), 'registered должен отмечать webrtc_registered');
    assert.ok(!/on_line: true/.test(body), 'registered не должен выставлять on_line=true (захват линии)');
  });

  await test('A5', 'исходящий поднимает SIP лениво и звонит из браузера', () => {
    const core = readSrc('public/assets/js/phone_core.js');
    const outIdx = core.indexOf('outbound: function');
    assert.ok(outIdx !== -1, 'нет outbound');
    const body = core.slice(outIdx, outIdx + 1600);
    assert.ok(/ensureRegistered\(\)/.test(body), 'outbound не поднимает SIP лениво');
    assert.ok(/waitRegistered\(/.test(body), 'outbound не ждёт регистрацию');
    assert.ok(/ua\.call\(/.test(body), 'нет звонка из браузера через ua.call');
    assert.ok(/ensureRegistered: function/.test(core), 'нет ensureRegistered');
  });

  await test('A6', 'ленивая регистрация не берёт leader-lock (не запирает линию)', () => {
    const core = readSrc('public/assets/js/phone_core.js');
    const eIdx = core.indexOf('ensureRegistered: function');
    const wIdx = core.indexOf('waitRegistered: function');
    assert.ok(eIdx !== -1 && wIdx !== -1, 'нет ensureRegistered/waitRegistered');
    const body = core.slice(eIdx, wIdx);
    assert.ok(!/holdLeaderLock/.test(body), 'ensureRegistered не должен держать leader-lock');
    assert.ok(!/on_line: true/.test(body), 'ensureRegistered не должен ставить on_line');
  });

  await test('A7', 'статус «на линии» отделён от mode (флаг onDuty)', () => {
    const core = readSrc('public/assets/js/phone_core.js');
    assert.ok(/var onDuty = false/.test(core), 'нет флага onDuty');
    const hang = core.slice(core.indexOf('hangup: function'), core.indexOf('hangup: function') + 700);
    assert.ok(/onDuty \?/.test(hang), 'hangup по mode вернёт ложное «на линии»');
  });

  await test('A8', 'меню контакта звонит из браузера, а не гейтит на getSipRegistered', () => {
    const dock = readSrc('public/assets/js/huginn_dock.js');
    const idx = dock.indexOf('async function callContactViaMango');
    assert.ok(idx !== -1, 'нет callContactViaMango');
    const body = dock.slice(idx, idx + 1400);
    assert.ok(!/getSipRegistered/.test(body), 'callContactViaMango не должен гейтить по предварительной регистрации');
    assert.ok(/P\.outbound\(phone\)/.test(body), 'должен звонить через AsgardPhone.outbound (браузер)');
  });

  // ── L1. Линия (multi-line с V442) ──
  await test('L1a', 'миграция V442: снят эксклюзивный индекс, добавлен calls_taken', () => {
    const sql = readSrc('migrations/V442__pbx_multi_line.sql');
    assert.ok(/DROP INDEX IF EXISTS uniq_pbx_operators_single_on_line/.test(sql),
      'V442 должен снимать эксклюзивный индекс одной линии');
    assert.ok(/calls_taken/.test(sql), 'нет счётчика принятых звонков');
    // Историческая миграция, создавшая индекс, должна остаться неизменной.
    const old = readSrc('migrations/V376__pbx_single_line.sql');
    assert.ok(/uniq_pbx_operators_single_on_line/.test(old), 'V376 должна сохраниться как история');
  });

  await test('L1b', 'claim-line: multi-line — никого не снимает, ставит себя', () => {
    const js = readSrc('src/pbx/line-claim.js');
    assert.ok(/async function joinLine/.test(js), 'нет joinLine');
    // Проверяем ТОЛЬКО тело joinLine: снятие on_line у себя законно делает leaveLine.
    const body = js.slice(js.indexOf('async function joinLine'), js.indexOf('async function claimLine'));
    assert.ok(!/SET on_line = false/.test(body),
      'joinLine не должен снимать линию ни у себя, ни у другого оператора');
    assert.ok(!/WHERE user_id <> \$1/.test(body), 'joinLine не должен трогать других операторов');
    assert.ok(/previousUserId: null/.test(js), 'previousUserId должен быть null (никого не снимаем)');
    assert.ok(/onLineCount/.test(js), 'нет счётчика линии для UI');
    assert.ok(/BEGIN/.test(js) && /COMMIT/.test(js), 'нет транзакции');
  });

  await test('L1c', 'route /operator/claim-line существует и под доступом', () => {
    const r = readSrc('src/routes/telephony-pbx.js');
    assert.ok(r.includes("'/operator/claim-line'"), 'нет роута claim-line');
    assert.ok(/canUseTelephony/.test(r), 'нет гейта доступа к телефонии');
  });

  if (process.env.DATABASE_URL && /asgard_crm_test/.test(process.env.DATABASE_URL)) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await test('L1d', 'DB: несколько операторов на линии ОДНОВРЕМЕННО (multi-line V442)', async () => {
        const { rows: u } = await pool.query(
          `SELECT id FROM users WHERE is_active = true ORDER BY id LIMIT 2`
        );
        assert.ok(u.length >= 2, 'нужно ≥2 активных пользователя');
        const [a, b] = [u[0].id, u[1].id];
        await pool.query(`UPDATE pbx_operators SET on_line = false WHERE user_id IN ($1, $2)`, [a, b]);
        // Раньше unique-индекс (V376) запрещал второго on_line=true. С V442
        // линия не эксклюзивна: входящий звонит всем, кто на линии.
        await pool.query(
          `INSERT INTO pbx_operators (user_id, on_line, receive_mode) VALUES ($1, true, 'browser')
           ON CONFLICT (user_id) DO UPDATE SET on_line = true, receive_mode = 'browser'`,
          [a]
        );
        await pool.query(
          `INSERT INTO pbx_operators (user_id, on_line, receive_mode) VALUES ($1, true, 'browser')
           ON CONFLICT (user_id) DO UPDATE SET on_line = true, receive_mode = 'browser'`,
          [b]
        );
        const { rows } = await pool.query(
          `SELECT user_id FROM pbx_operators WHERE on_line = true AND user_id IN ($1,$2)`,
          [a, b]
        );
        assert.strictEqual(rows.length, 2, 'на линии должны быть оба оператора');
        // чистим
        await pool.query(`UPDATE pbx_operators SET on_line = false WHERE user_id IN ($1, $2)`, [a, b]);
      });

      await test('L1e', 'DB: claimLine НЕ снимает других (линия неотбирающая)', async () => {
        const { rows: u } = await pool.query(
          `SELECT id FROM users WHERE is_active = true ORDER BY id LIMIT 2`
        );
        const [a, b] = [u[0].id, u[1].id];
        await pool.query(`UPDATE pbx_operators SET on_line = false WHERE user_id IN ($1, $2)`, [a, b]);
        await claimLine(pool, a);
        const r = await claimLine(pool, b);
        assert.strictEqual(r.previousUserId, null, 'multi-line: прежний владелец не должен сниматься');
        const { rows } = await pool.query(
          `SELECT user_id FROM pbx_operators WHERE on_line = true AND user_id IN ($1,$2)`,
          [a, b]
        );
        assert.strictEqual(rows.length, 2, 'оба остаются на линии');
        assert.ok(r.onLineCount >= 2, 'счётчик линии должен вернуть ≥2');
        await pool.query(`UPDATE pbx_operators SET on_line = false WHERE user_id IN ($1, $2)`, [a, b]);
      });
    } finally {
      await pool.end();
    }
  } else {
    console.log('  · skip L1d/L1e (set DATABASE_URL=...asgard_crm_test)');
  }

  // ── L2. Цепочка фолбэков ──
  await test('L2a', 'тайминги 25/30 (браузер/мобильный)', () => {
    const cfg = normalizePbxConfig({});
    const t = expandOperatorTargets(
      op(1, { receive_mode: 'both', webrtc_registered: true }),
      cfg,
      workNow.getTime()
    );
    const web = t.find((x) => x.targetType === 'webrtc');
    const mob = t.find((x) => x.targetType === 'mobile');
    // 27.10.2026: browser_ring_sec 10 → 25 — при 10 секундах оператор не
    // успевал снять трубку в браузере, звонок уходил дальше по каскаду.
    assert.strictEqual(web.ringSec, 25, 'browser_ring_sec должен быть 25');
    assert.strictEqual(mob.ringSec, 30, 'mobile_ring_sec должен быть 30');
  });

  await test('L2b', 'dialplan: цепочка duty mobile → voicemail', () => {
    const dp = readSrc('ops/asterisk/extensions_asgard.conf');
    assert.ok(/ASGARD_DUTY_MOBILE/.test(dp), 'нет звена «дежурный на мобильный»');
    assert.ok(/\[asgard-voicemail\]/.test(dp), 'нет контекста голосовой почты');
    assert.ok(/Record\(/.test(dp), 'нет записи голосового сообщения');
  });

  await test('L2c', 'AGI отдаёт ASGARD_DUTY_MOBILE и VM-переменные', () => {
    const js = readSrc('src/pbx/index.js');
    assert.ok(/ASGARD_DUTY_MOBILE/.test(js), 'AGI не передаёт номер дежурного');
    assert.ok(/loadDutyMobile/.test(js), 'нет функции резолва мобильного дежурного');
    assert.ok(/ASGARD_VM_MAX_SEC/.test(js), 'нет ограничения длины голосового');
  });

  await test('L2d', 'конфиг: duty_mobile_fallback и voicemail_max_sec по умолчанию', () => {
    const cfg = normalizePbxConfig({});
    assert.strictEqual(cfg.duty_mobile_fallback, true);
    assert.strictEqual(cfg.voicemail_max_sec, 60);
  });

  // ── L3. Голосовая почта ──
  await test('L3a', 'saveVoicemail привязывает файл и помечает voicemail', () => {
    const js = readSrc('src/pbx/recording.js');
    assert.ok(/saveVoicemail/.test(js), 'нет saveVoicemail');
    assert.ok(/outcome = 'voicemail'/.test(js), 'не помечает звонок как голосовую почту');
    assert.ok(/pbx_recording_ready/.test(js), 'нет NOTIFY о готовой записи');
  });

  await test('L3b', 'CMD /recording/voicemail есть в openPaths', () => {
    const js = readSrc('src/pbx/index.js');
    assert.ok(/recording\/voicemail/.test(js), 'нет хендлера voicemail');
  });

  // ── L4. Запись всегда ──
  await test('L4a', 'MixMonitor во входящем, исходящем и внутреннем', () => {
    const dp = readSrc('ops/asterisk/extensions_asgard.conf');
    const sections = {
      inbound: dp.slice(dp.indexOf('[from-mango-inbound]'), dp.indexOf('[asgard-ring]')),
      outbound: dp.slice(dp.indexOf('[outbound-crm]'), dp.indexOf('[from-internal]')),
      internal: dp.slice(dp.indexOf('[from-internal]'), dp.indexOf('[noagents]')),
    };
    for (const [name, body] of Object.entries(sections)) {
      assert.ok(/MixMonitor\(/.test(body), `нет MixMonitor в ${name}`);
    }
  });

  await test('L4b', 'MixMonitor стоит ДО AGI (запись при мёртвой CRM)', () => {
    const dp = readSrc('ops/asterisk/extensions_asgard.conf');
    const inb = dp.slice(dp.indexOf('[from-mango-inbound]'), dp.indexOf('[asgard-ring]'));
    const mix = inb.indexOf('MixMonitor(');
    const agi = inb.indexOf('AGI(');
    assert.ok(mix !== -1 && agi !== -1, 'нет MixMonitor или AGI');
    assert.ok(mix < agi, 'MixMonitor должен быть раньше AGI');
  });

  // ── S1. Падение CRM ──
  await test('S1a', 'dialplan: fail-open при недоступном AGI', () => {
    const dp = readSrc('ops/asterisk/extensions_asgard.conf');
    assert.ok(/failopen/.test(dp), 'нет ветки fail-open');
    assert.ok(/ASGARD_FAILOPEN_MOBILE|voicemail/.test(dp), 'fail-open не ведёт к фолбэку');
  });

  await test('S1b', 'AGI проверяет пустой dial string -> ?failopen', () => {
    const dp = readSrc('ops/asterisk/extensions_asgard.conf');
    assert.ok(/\?failopen,1\)/.test(dp), 'AGI-выход не уходит в failopen');
  });

  // ── S2. Звонок во время переключения ──
  await test('S2a', 'линия не обрывает активные каналы (multi-line V442)', () => {
    const js = readSrc('src/pbx/line-claim.js');
    assert.ok(!/Hangup/i.test(js), 'line-claim не должен сбрасывать каналы');
    // Перехвата больше нет — линия неотбирающая, событие входа на линию есть.
    const body = js.slice(js.indexOf('async function claimLine'), js.indexOf('async function leaveLine'));
    assert.ok(!/call:line_taken/.test(body), 'событие перехвата линии больше не рассылается');
    assert.ok(/call:line_join/.test(body), 'должно быть событие входа на линию');
  });

  await test('S2b', 'входящий план: звонок идёт всем, кто на линии (multi-line V442)', () => {
    // V442: линия не эксклюзивна — входящий получают ВСЕ, кто on_line.
    const ops = [
      op(1, { on_line: true }),
      op(2, { on_line: true }),
      op(3, { on_line: false }),
    ];
    const plan = buildRingPlan(ops, 1, baseConfig, workNow);
    const users = new Set(plan.targets.map((t) => t.userId));
    assert.strictEqual(users.size, 2, `ожидали 2 оператора на линии, получили ${users.size}`);
    assert.ok(users.has(1) && users.has(2), 'оба оператора на линии должны быть в плане');
    assert.ok(!users.has(3), 'оператор не на линии не должен звониться');
  });

  // ── Отчёт ──
  const report = path.join(ROOT, 'tests/reports/TELEPHONY-W2-MATRIX.md');
  const lines = [
    '# TELEPHONY-W2-MATRIX',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| ID | Result | Scenario |',
    '|----|--------|----------|',
    ...results.map((r) => `| ${r.id} | ${r.ok ? 'GREEN' : 'RED'} | ${r.name}${r.error ? ' — ' + r.error : ''} |`),
    '',
    `**${passed} passed, ${failed} failed**`,
    '',
  ];
  fs.writeFileSync(report, lines.join('\n'), 'utf8');
  console.log(`\n${passed} passed, ${failed} failed → ${report}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
