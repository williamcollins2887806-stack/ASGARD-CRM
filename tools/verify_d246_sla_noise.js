#!/usr/bin/env node
'use strict';

/**
 * D-246 (шум): рантайм-проверка SLA-тика на фейковом окружении.
 *
 * Что доказываем:
 *  1) ЧТЕНИЙ `by-index` больше не «правило × получатель», а ≤ числа уникальных
 *     получателей (кэш на тик). Замер: calls vs pairs.
 *  2) Семантика не изменилась: набор созданных уведомлений совпадает с эталоном,
 *     посчитанным напрямую по правилам (docs_deadline / pm_calc_due / birthday_*).
 *  3) Повторный тик в тот же день не создаёт дублей (dedup работает).
 *  4) В фоне (document.hidden) тик не запускается — проверяем модель router.js.
 *
 * Запуск: node tools/verify_d246_sla_noise.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let byIndexCalls = 0;
let addCalls = 0;
let byIndexPerUser = new Map();

function makeEnv({ hidden = false, offline = false } = {}) {
  byIndexCalls = 0;
  addCalls = 0;
  byIndexPerUser = new Map();

  const users = [
    { id: 1, name: 'ТО Один', role: 'TO', is_active: true },
    { id: 2, name: 'ТО Два', role: 'TO', is_active: true },
    { id: 3, name: 'Директор', role: 'DIRECTOR', is_active: true },
    { id: 4, name: 'Офис Кто-то', role: 'PM', is_active: true, birth_date: '1990-09-16' },
    { id: 5, name: 'Офис Два', role: 'PM', is_active: true, birth_date: '1991-09-18' }
  ];
  const tenders = [
    { id: 101, docs_deadline: '2026-09-25', responsible_pm_id: 4, handoff_at: '2026-09-10' }
  ];
  const estimates = [];
  const employees = [{ id: 900, fio: 'Рабочий Один', birth_date: '1985-09-17' }];

  const notifications = []; // серверная «таблица»

  const AsgardDB = {
    async get(store, key) {
      if (store === 'settings' && key === 'app') {
        return { value_json: JSON.stringify({ sla: { docs_deadline_notice_days: 5, pm_calc_due_workdays: 3, birthday_notice_days: 5 } }) };
      }
      return null;
    },
    async all(store) {
      if (store === 'users') return users.slice();
      if (store === 'tenders') return tenders.slice();
      if (store === 'estimates') return estimates.slice();
      if (store === 'employees') return employees.slice();
      return [];
    },
    async byIndex(store, index, value) {
      byIndexCalls++;
      byIndexPerUser.set(value, (byIndexPerUser.get(value) || 0) + 1);
      if (store !== 'notifications' || index !== 'user_id') return [];
      return notifications.filter((n) => n.user_id === value);
    },
    async add(store, val) {
      addCalls++;
      notifications.push(val);
      return notifications.length;
    }
  };

  const listeners = { visibilitychange: [] };
  const sandbox = {
    console,
    Date,
    Set,
    Map,
    Math,
    JSON,
    parseInt,
    Number,
    String,
    Array,
    Object,
    isFinite,
    isNaN,
    URLSearchParams,
    AsgardDB,
    AsgardAuth: {
      getAuth: () => ({ user: users[0], token: 't' }),
      isDirectorRole: (r) => r === 'DIRECTOR' || String(r || '').startsWith('DIRECTOR_')
    },
    AsgardUI: { formatDate: (v) => String(v).slice(0, 10) },
    AsgardSessionGuard: { isLocked: () => false, isOffline: () => offline },
    localStorage: { getItem: (k) => (k === 'asgard_token' ? 'tok' : null) },
    document: {
      hidden,
      addEventListener: (ev, cb) => { (listeners[ev] = listeners[ev] || []).push(cb); }
    },
    window: {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'sla.js'), 'utf8');
  vm.runInContext(code, ctx, { filename: 'sla.js' });

  return { sandbox, notifications, users, tenders, employees, listeners };
}

function countPairs({ users, tenders, employees }) {
  const tos = users.filter((u) => u.role === 'TO').length;
  const dirs = users.filter((u) => u.role === 'DIRECTOR').length;
  const office = users.filter((u) => u.is_active && u.birth_date).length;
  const officeRecipients = users.filter((u) => u.is_active).length;
  const hrDir = users.filter((u) => ['HR', 'DIRECTOR'].includes(u.role) || String(u.role).startsWith('DIRECTOR_')).length;
  const empBday = employees.filter((e) => e.birth_date).length;
  // A) дедлайны: получатели = TO + директора + РП
  const dlPairs = tenders.length * (tos + dirs + 1);
  // B) просчёт РП
  const pmPairs = 1;
  // E) дни рождения офиса: именинники (в окне ≤5 дней) × все активные
  const inWindow = users.filter((u) => u.birth_date && ['09-16', '09-18'].includes(String(u.birth_date).slice(5))).length;
  const ePairs = inWindow * officeRecipients;
  // F) дни рождения рабочих
  const fPairs = empBday * hrDir;
  return { dlPairs, pmPairs, ePairs, fPairs, total: dlPairs + pmPairs + ePairs + fPairs, recipients: new Set([
    ...users.filter((u) => u.role === 'TO').map((u) => u.id),
    ...users.filter((u) => u.role === 'DIRECTOR').map((u) => u.id),
    4,
    ...users.map((u) => u.id)
  ]).size, officePairsForOff: office * officeRecipients };
}

const results = [];
function check(name, pass, proof) {
  results.push({ name, pass: !!pass, proof: String(proof === undefined ? '' : proof) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  — ${proof}`);
}

(async () => {
  // ── 1) Тик при видимой вкладке ──
  const env = makeEnv({ hidden: false, offline: false });
  const pairs = countPairs(env);
  await env.sandbox.AsgardSLA.tick(env.users[0]);

  const uniqUsers = byIndexPerUser.size;
  check('SLA: чтений by-index ≈ уникальные получатели, а не пары «правило×получатель»',
    byIndexCalls <= uniqUsers && byIndexCalls < pairs.total,
    `calls=${byIndexCalls}, uniqUsers=${uniqUsers}, было бы pairs=${pairs.total}`);
  check('SLA: одно чтение на пользователя (нет повторных)',
    [...byIndexPerUser.values()].every((n) => n === 1),
    `max per user=${Math.max(...byIndexPerUser.values())}`);

  const made = env.notifications.length;
  check('SLA: уведомления всё-таки созданы (тик не «сломался»)',
    made > 0, `created=${made}`);

  const newReads = byIndexCalls; // зафиксировать ДО следующего makeEnv (он сбрасывает счётчики)

  // Эталон — ПРЕЖНИЙ код из git-истории (read-only). Это дискриминирующий контроль:
  // ловит и попытку «оптимизировать» за счёт смены набора уведомлений.
  const { execSync } = require('child_process');
  let oldCode = '';
  try {
    oldCode = execSync('git show HEAD:public/assets/js/sla.js', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  } catch (e) {
    console.error('WARN: не удалось достать прежний sla.js из git:', e.message);
  }
  if (oldCode) {
    const envOld = makeEnv({ hidden: false, offline: false }); // сбрасывает byIndexCalls в 0
    const ctxOld = vm.createContext(envOld.sandbox);
    vm.runInContext(oldCode, ctxOld, { filename: 'sla.old.js' });
    await ctxOld.AsgardSLA.tick(envOld.users[0]);
    const readsOld = byIndexCalls;
    const setOld = [...new Set(envOld.notifications.map((n) => n.dedup_key))].sort();
    const setNew = [...new Set(env.notifications.map((n) => n.dedup_key))].sort();
    const same = JSON.stringify(setOld) === JSON.stringify(setNew);
    check('SLA: набор уведомлений идентичен прежнему коду (git HEAD)', same,
      `old=${setOld.length}, new=${setNew.length}${same ? '' : `; old=[${setOld}] new=[${setNew}]`}`);
    check('контроль: прежний код делал больше чтений, чем новый', readsOld > newReads,
      `old=${readsOld}, new=${newReads}`);
  } else {
    check('SLA: эталон из git доступен', false, 'git show HEAD:public/assets/js/sla.js не выполнился');
  }

  // ── 3) Повторный тик — без дублей ──
  const env2 = makeEnv({ hidden: false, offline: false });
  await env2.sandbox.AsgardSLA.tick(env2.users[0]);
  const first = env2.notifications.length;
  // обход коулдауна: новый контекст + предзаполненная «серверная» таблица
  const env3Code = makeEnv({ hidden: false, offline: false });
  for (const n of env2.notifications) env3Code.notifications.push(n);
  await env3Code.sandbox.AsgardSLA.tick(env3Code.users[0]);
  check('SLA: повторный тик в тот же день не создаёт дублей',
    env3Code.notifications.length === first,
    `first=${first}, after second=${env3Code.notifications.length}`);

  // ── 2) Офлайн: не читаем и не создаём (дубли) ──
  const envOff = makeEnv({ hidden: false, offline: true });
  await envOff.sandbox.AsgardSLA.tick(envOff.users[0]);
  check('SLA: в офлайне by-index не дёргается и уведомления не плодятся',
    byIndexCalls === 0 && envOff.notifications.length === 0,
    `calls=${byIndexCalls}, created=${envOff.notifications.length}`);

  // ── 4) Фоновая вкладка: модель router.js не запускает тик ──
  check('router: фоновый интервал пропускает тик при document.hidden',
    /if\s*\(!document\.hidden\)\s*_slaTick\(\)/.test(
      fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'router.js'), 'utf8')
    ),
    'router.js:setInterval(() => { if (!document.hidden) _slaTick(); })');

  const failed = results.filter((r) => !r.pass);
  console.log(`\n═══ D-246 SLA/шум: ${results.length - failed.length}/${results.length} PASS ═══`);
  if (failed.length) failed.forEach((f) => console.log(`  FAIL: ${f.name} — ${f.proof}`));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
