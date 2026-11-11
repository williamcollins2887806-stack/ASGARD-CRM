#!/usr/bin/env node
/**
 * Синтетическая проба Тинга (D-191, уровень 3).
 *
 * Зачем: чтобы не собирать людей в тестовые сессии. Два headless-браузера с
 * ФЕЙКОВЫМИ камерой и микрофоном заходят в комнату как обычные участники,
 * публикуют эталонную картинку, снимают getStats и уходят.
 *
 * Ключевое отличие от ручной проверки: канал можно испортить УПРАВЛЯЕМО.
 * С Chrome 124+ троттлинг DevTools влияет и на WebRTC (UDP), если включён
 * ДО создания сокетов — поэтому профиль задаётся до навигации.
 *
 * Usage:
 *   THING_TEST_BASE=https://asgard-crm.ru THING_TEST_SLUG=<slug> \
 *     node tools/ting_canary.js
 *
 *   --scenario baseline|bandwidth|loss|cpu   (по умолчанию baseline)
 *   --seconds 20                             (длительность замера)
 *   --json
 *
 * ВАЖНО: нужна тестовая комната (slug), которую не жалко. Скрипт входит в неё
 * как гость и публикует медиа.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const BASE = process.env.THING_TEST_BASE || 'https://asgard-crm.ru';
const SLUG = process.env.THING_TEST_SLUG || String(arg('slug', '') || '');
const SCENARIO = String(arg('scenario', 'baseline'));
const SECONDS = Math.max(5, Number(arg('seconds', 20)) || 20);
const AS_JSON = !!arg('json', false);

/* Профили троттлинга. Параметры packet-* работают только в Chrome 124+. */
const SCENARIOS = {
  baseline: null,
  bandwidth: { offline: false, latency: 40, downloadThroughput: 0, uploadThroughput: 1024 * 1024 / 8, connectionType: 'cellular3g', packetLoss: 0 },
  loss: { offline: false, latency: 60, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'cellular3g', packetLoss: 10 },
  cpu: { cpuThrottlingRate: 4 }
};

function post(p, body) {
  const u = new URL(BASE + p);
  const lib = u.protocol === 'https:' ? https : http;
  const payload = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const r = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      rejectUnauthorized: false
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(d); } catch (_) { /* */ }
        resolve({ status: res.statusCode, json: j, text: d });
      });
    });
    r.on('error', reject);
    r.setTimeout(20000, () => r.destroy(new Error('timeout')));
    r.write(payload);
    r.end();
  });
}

async function main() {
  if (!SLUG) {
    console.error('FAIL: укажите THING_TEST_SLUG=<slug тестовой комнаты>');
    process.exitCode = 2;
    return;
  }

  /* Проверяем, что комната жива и метаданные отдаются (окно входа может
     быть закрыто — тогда проба не имеет смысла). */
  const meta = await (async () => {
    const u = new URL(BASE + '/api/thing/public/' + encodeURIComponent(SLUG));
    const lib = u.protocol === 'https:' ? https : http;
    return new Promise((resolve) => {
      lib.get({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, rejectUnauthorized: false }, (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          let j = null;
          try { j = JSON.parse(d); } catch (_) { /* */ }
          resolve({ status: res.statusCode, json: j });
        });
      }).on('error', () => resolve({ status: 0, json: null }));
    });
  })();

  if (meta.status !== 200) {
    console.error(`FAIL: комната ${SLUG} недоступна (status=${meta.status})`);
    process.exitCode = 1;
    return;
  }
  if (meta.json && meta.json.join_open === false) {
    console.error(`FAIL: вход ещё не открыт (opens_at=${meta.json.opens_at}). ` +
      'Для пробы нужна комната с открытым входом.');
    process.exitCode = 1;
    return;
  }

  /* Два участника: A — под троттлингом (проблемный), B — контроль. */
  const participantA = await post('/api/thing/public/' + encodeURIComponent(SLUG) + '/guest-token', {
    name: 'Проба-A', guest_key: 'canary-a-' + Date.now()
  });
  const participantB = await post('/api/thing/public/' + encodeURIComponent(SLUG) + '/guest-token', {
    name: 'Проба-B', guest_key: 'canary-b-' + Date.now()
  });

  if (!participantA.json || !participantA.json.token) {
    console.error('FAIL: не удалось получить токен для пробы A:', participantA.text.slice(0, 200));
    process.exitCode = 1;
    return;
  }
  if (!participantB.json || !participantB.json.token) {
    console.error('FAIL: не удалось получить токен для пробы B:', participantB.text.slice(0, 200));
    process.exitCode = 1;
    return;
  }

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (_) {
    console.error('FAIL: puppeteer не установлен (npm i puppeteer)');
    process.exitCode = 2;
    return;
  }

  const chromeArgs = [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required'
  ];

  const result = { scenario: SCENARIO, slug: SLUG, seconds: SECONDS, samples: [] };
  const browser = await puppeteer.launch({ headless: 'new', args: chromeArgs });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    /* Троттлинг задаём ДО навигации: иначе UDP-сокеты создадутся без него. */
    const cdp = await page.target().createCDPSession();
    await cdp.send('Network.enable');
    const prof = SCENARIOS[SCENARIO];
    if (prof && !('cpuThrottlingRate' in prof)) {
      await cdp.send('Network.emulateNetworkConditions', prof);
    }
    if (prof && prof.cpuThrottlingRate) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpuThrottlingRate });
    }

    /* Комната открывается той же страницей, что и у гостя: проба идёт
       «как пользователь», а не отдельным SDK-скриптом. */
    const url = BASE + '/ting/' + encodeURIComponent(SLUG);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    /* Подставляем токен в страницу: вход минуя UI-форму. */
    await page.evaluate(async (creds) => {
      window.__canaryCreds = creds;
    }, { token: participantA.json.token, url: participantA.json.url || participantA.json.livekit_url });

    /* Замер: снимаем getStats через LiveKit-клиент страницы, если он поднялся.
       Если страница не подключилась — честно сообщаем, а не выдумываем цифры. */
    const stats = await page.evaluate(async (ms) => {
      const out = [];
      const started = Date.now();
      const toMs = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
      while (Date.now() - started < ms) {
        try {
          const LK = window.LivekitClient;
          const room = window.__canaryRoom;
          if (LK && room && window.TingMediaProfile) {
            const pcs = window.TingMediaProfile.peerConnections(room);
            const s = await window.TingMediaProfile.collectStats(pcs.pub, pcs.sub);
            out.push({ t: Date.now() - started, ...s, limiter: s.limiter, res: s.width && s.height ? s.width + 'x' + s.height : null });
          }
        } catch (_) { /* */ }
        await new Promise((r) => setTimeout(r, 2000));
      }
      return out;
    }, SECONDS * 1000);

    result.samples = stats;
    result.connected = stats.length > 0;
  } finally {
    await browser.close().catch(() => {});
  }

  if (AS_JSON) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`=== Проба Тинга: ${SCENARIO}, ${SECONDS} с ===`);
    if (!result.connected) {
      console.log('ВНИМАНИЕ: страница не подключилась к комнате, замеров нет.');
      console.log('Это не значит «всё плохо»: проверьте, что комната принимает гостей.');
    } else {
      const last = result.samples[result.samples.length - 1] || {};
      console.log(`сэмплов: ${result.samples.length}`);
      console.log(`разрешение: ${last.res || '—'}`);
      console.log(`fps: ${last.fps ?? '—'}, битрейт: ${last.bitrateKbps ?? '—'} кбит/с`);
      console.log(`ограничитель: ${last.limiter || '—'}`);
      console.log(`транспорт: ${last.icePair || '—'}`);
      console.log(`потери: ${last.packetsLost ?? '—'}, фризы: ${last.freezeCount ?? '—'}`);
    }
  }

  /* Результат в отчёт — чтобы можно было сравнивать прогоны. */
  const outDir = path.join(__dirname, '../tests/reports');
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, `TING-CANARY-${SCENARIO}.json`),
      JSON.stringify(result, null, 2),
      'utf8'
    );
  } catch (_) { /* не критично */ }
}

main().catch((e) => {
  console.error('FAIL:', e && e.message);
  process.exitCode = 1;
});
