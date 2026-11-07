#!/usr/bin/env node
'use strict';
/**
 * Поведенческий гейт сторожа версии PWA /h/ (D-396).
 *
 * Проверяет не наличие строк, а ЛОГИКУ: берёт реальный inline-IIFE из
 * public/h/index.html, подсовывает поддельные DOM/fetch/storage и считает,
 * сколько раз страница перезагрузилась. Именно этого не хватало:
 * `guard_shells.js` искал подстроки и оставался ЗЕЛЁНЫМ, когда тело защёлки
 * вырезали, оставив имена.
 *
 *   node tools/test_huginn_ver_guard.js
 *
 * Критерий (жалоба 06.11.2026, 4093 полных загрузки за 13 минут):
 *   - одна перезагрузка на версию, дальше — баннер;
 *   - при недоступном/незаписываемом sessionStorage — НИ ОДНОЙ перезагрузки;
 *   - версия сервера, равная VER, не даёт перезагрузок вообще.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'public/h/index.html');

const src = fs.readFileSync(HTML, 'utf8');

// Вырезаем именно тот IIFE, что сторожит версию.
const m = /\(function \(\) \{\s*\n\s*var VER = '([^']+)';[\s\S]*?\n    \}\)\(\);/.exec(src);
if (!m) {
  console.log('FAIL  сторож версии не найден в public/h/index.html');
  process.exit(1);
}
const VER = m[1];
const body = m[0];

let failures = 0;
function report(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures += 1;
}

/**
 * Прогон сторожа в песочнице.
 * @param {object} opts
 *   serverVer  — что отдаёт /api/version
 *   storage    — 'ok' | 'throws-on-set' | 'dead'
 *   loads      — сколько «загрузок страницы» имитируем
 */
function run({ serverVer, storage = 'ok', loads = 5 }) {
  const store = new Map();
  const sessionStorage = {
    getItem(k) {
      if (storage === 'dead') throw new Error('storage disabled');
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      if (storage === 'dead') throw new Error('storage disabled');
      if (storage === 'throws-on-set') throw new Error('QuotaExceededError');
      store.set(k, v);
    },
    removeItem(k) {
      if (storage === 'dead') throw new Error('storage disabled');
      store.delete(k);
    },
  };

  let reloads = 0;
  let notices = 0;

  // Имитация перезагрузки: считаем и «начинаем новую загрузку» — состояние
  // хранилища (store) сохраняется, как в реальном браузере.
  function makeSandbox() {
    const el = () => ({
      id: '', className: '', style: { cssText: '' }, children: [],
      appendChild(c) { this.children.push(c); }, setAttribute() {}, remove() {},
    });
    const sandbox = {
      VER_PLACEHOLDER: VER,
      sessionStorage,
      document: {
        getElementById: () => (notices > 0 ? el() : null),
        createElement: el,
        body: { appendChild() { notices += 1; } },
        visibilityState: 'visible',
        addEventListener() {},
      },
      location: {
        hash: '',
        replace() { reloads += 1; },
        reload() { reloads += 1; },
      },
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ version: serverVer }) }),
      setInterval: () => 0,
      setTimeout: (fn) => { fn(); return 0; },
      // В браузере Cache API ЕСТЬ. Если объявить caches: undefined, проверка
      // `'caches' in window` даст true, а caches.keys() бросит TypeError —
      // стенд проверит не то поведение, что в реальном клиенте.
      caches: {
        keys: () => Promise.resolve([]),
        delete: () => Promise.resolve(true),
        open: () => Promise.resolve({ put: () => Promise.resolve(), add: () => Promise.resolve(), match: () => Promise.resolve(null) }),
        match: () => Promise.resolve(null),
      },
      console: { log() {}, warn() {}, error() {} },
    };
    sandbox.addEventListener = () => {};
    sandbox.removeEventListener = () => {};
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    return sandbox;
  }

  // Каждая «загрузка» — новый контекст, но с тем же sessionStorage.
  const pending = [];
  for (let i = 0; i < loads; i++) {
    const sandbox = makeSandbox();
    vm.createContext(sandbox);
    try {
      vm.runInContext(body, sandbox, { timeout: 5000 });
    } catch (e) {
      failures += 1;
      console.log(`FAIL  сторож упал при исполнении: ${e.message}`);
      return { reloads, notices };
    }
    pending.push(Promise.resolve());
  }

  return (async () => {
    // Дать отработать микро/макротаскам промисов внутри контекста.
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    return { reloads, notices };
  })();
}

(async () => {
  console.log(`VER из файла = ${VER}\n`);

  const newer = '99.99.99';

  // 1. Версия совпадает — перезагрузок быть не должно вообще.
  {
    const r = await run({ serverVer: VER, loads: 5 });
    report('сервер == VER → 0 перезагрузок', r.reloads === 0 && r.notices === 0,
      `перезагрузок ${r.reloads}, баннеров ${r.notices}`);
  }

  // 2. Версия новее, storage исправен — ровно ОДНА перезагрузка за 5 загрузок.
  {
    const r = await run({ serverVer: newer, loads: 5 });
    report('storage ок → ровно 1 перезагрузка на версию', r.reloads === 1,
      `перезагрузок ${r.reloads} (ожидалось 1), баннеров ${r.notices}`);
    report('storage ок → на повторных попытках баннер, а не цикл',
      r.notices >= 1, `баннеров ${r.notices}`);
  }

  // 3. setItem бросает (приватный режим Safari) — рецидив инцидента, если
  //    перезагрузка всё равно происходит. Ожидание: НИ ОДНОЙ.
  {
    const r = await run({ serverVer: newer, storage: 'throws-on-set', loads: 5 });
    report('setItem бросает → 0 перезагрузок (нет цикла)', r.reloads === 0,
      `перезагрузок ${r.reloads} (ожидалось 0)`);
    report('setItem бросает → показан баннер', r.notices >= 1, `баннеров ${r.notices}`);
  }

  // 4. Хранилище недоступно целиком.
  {
    const r = await run({ serverVer: newer, storage: 'dead', loads: 5 });
    report('storage недоступен → 0 перезагрузок', r.reloads === 0,
      `перезагрузок ${r.reloads} (ожидалось 0)`);
  }

  console.log(failures ? `\nИТОГ: FAIL — ${failures}` : '\nИТОГ: OK — сторож не может зациклиться');
  process.exitCode = failures ? 1 : 0;
})();
