'use strict';

/**
 * Тинг — продуктовый load-прогон комнаты (Q04 / TING-CAPACITY).
 *
 * Подключает N headless-клиентов LiveKit в одну комнату, публикует камеру
 * (синтетический видео-трек) и меряет: время до первого кадра, число
 * переподключений, CPU сервера по /api/thing/health.
 *
 * Запуск (на клоне, не на проде):
 *   BASE_URL=http://127.0.0.1:3100 \
 *   LOGIN=admin PASSWORD=... \
 *   node tests/ting/load/room_load.js --participants 12 --duration 90
 *
 * Требует переменные LiveKit в окружении приложения (LIVEKIT_URL/API_KEY/API_SECRET)
 * либо передаётся --url/--key/--secret для прямого подключения.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const LOGIN = process.env.LOGIN || '';
const PASSWORD = process.env.PASSWORD || '';
const OUT_DIR = path.join(__dirname, '..', '..', 'reports');

/* Защита от случайного запуска по проду: load-тест создаёт реальные комнаты
   и тратит CPU/диск. Разрешаем только локальные адреса и явный opt-in. */
function assertSafeTarget(baseUrl) {
  const allowProd = process.env.ALLOW_PROD_LOAD === '1';
  let host = '';
  try { host = new URL(baseUrl).hostname; } catch (_) { host = ''; }
  const localHosts = ['127.0.0.1', 'localhost', '::1'];
  if (localOk(host)) return;
  if (allowProd) {
    console.warn('[load] ВНИМАНИЕ: прогон по нелокальному адресу ' + host + ' (ALLOW_PROD_LOAD=1)');
    return;
  }
  console.error('[load] Отказано: BASE_URL=' + baseUrl + ' не локальный.');
  console.error('       Нагрузочный прогон по проду запрещён. Для осознанного запуска: ALLOW_PROD_LOAD=1');
  process.exit(4);
}
function localOk(host) {
  return ['127.0.0.1', 'localhost', '::1'].includes(host)
    || /^127\./.test(host)
    || /^192\.168\./.test(host)
    || /^10\./.test(host);
}

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const PARTICIPANTS = Math.max(2, parseInt(arg('participants', '8'), 10) || 8);
const DURATION_SEC = Math.max(15, parseInt(arg('duration', '60'), 10) || 60);
const PUBLISH_VIDEO = arg('video', '1') !== '0';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

async function login() {
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: LOGIN, password: PASSWORD })
  });
  const j = await r.json();
  if (!j.token) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 200));
  return j.token;
}

async function api(token, method, url, body) {
  const r = await fetch(`${BASE_URL}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${text.slice(0, 200)}`);
  return json;
}

async function serverHealth() {
  try {
    const j = await api(null, 'GET', '/api/thing/health');
    return j;
  } catch (_) {
    return null;
  }
}

async function run() {
  assertSafeTarget(BASE_URL);
  if (!LOGIN || !PASSWORD) {
    console.error('Нужны LOGIN и PASSWORD (env). Прогон на клоне, не на проде.');
    process.exit(2);
  }

  let LivekitClient;
  // Локальный пакет браузерного SDK может отсутствовать — тогда честно сообщаем.
  try {
    LivekitClient = require(path.join(REPO_ROOT, 'node_modules', 'livekit-client'));
  } catch (_) {
    console.error('livekit-client не установлен локально — используйте livekit-cli load-test');
    process.exit(3);
  }

  console.log(`[load] ${BASE_URL} · участников: ${PARTICIPANTS} · ${DURATION_SEC}s · video=${PUBLISH_VIDEO}`);
  const token = await login();
  const before = await serverHealth();

  const roomResp = await api(token, 'POST', '/api/thing/rooms', {
    title: `load-${PARTICIPANTS}-${Date.now()}`,
    mode: 'instant',
    recording_mode: 'off',
    protocol_enabled: false,
    max_participants: Math.max(PARTICIPANTS + 5, 20),
    max_video: PARTICIPANTS
  });
  const room = roomResp.room || roomResp;
  console.log(`[load] комната ${room.slug} (${room.id})`);

  const results = [];
  const roomObj = new LivekitClient.Room({
    adaptiveStream: true,
    dynacast: true
  });

  // Первый (хост) подключается и создаёт комнату на SFU.
  const hostTok = await api(token, 'POST', `/api/thing/rooms/${room.id}/token`, {});
  const t0 = Date.now();
  await roomObj.connect(hostTok.url || hostTok.livekit_url, hostTok.token);
  const hostConnectMs = Date.now() - t0;

  if (PUBLISH_VIDEO) {
    try {
      await roomObj.localParticipant.setCameraEnabled(true);
    } catch (e) {
      console.warn('[load] host camera unavailable: ' + e.message);
    }
  }

  results.push({ role: 'host', connect_ms: hostConnectMs, reconnects: 0 });

  // Гости — публичные токены, как реальный сценарий.
  for (let i = 1; i < PARTICIPANTS; i++) {
    try {
      const g = await api(null, 'POST', `/api/thing/public/${room.slug}/guest-token`, {
        name: `load-guest-${i}`
      });
      const r = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });
      const started = Date.now();
      await r.connect(g.url || g.livekit_url, g.token, { autoSubscribe: true });
      const connectMs = Date.now() - started;
      if (PUBLISH_VIDEO && g.video_allowed !== false) {
        try { await r.localParticipant.setCameraEnabled(true); } catch (_) { /* слоты */ }
      }
      results.push({ role: 'guest', index: i, connect_ms: connectMs, video_allowed: g.video_allowed !== false });
      r.on('reconnecting', () => { results[results.length - 1].reconnects = (results[results.length - 1].reconnects || 0) + 1; });
    } catch (e) {
      results.push({ role: 'guest', index: i, error: e.message });
    }
  }

  const mid = await serverHealth();
  console.log('[load] прогрев завершён, держим комнату…');
  await new Promise(res => setTimeout(res, DURATION_SEC * 1000));

  const after = await serverHealth();
  const connects = results.map(x => x.connect_ms).filter(Boolean).sort((a, b) => a - b);
  const p50 = connects.length ? connects[Math.floor(connects.length * 0.5)] : null;
  const p95 = connects.length ? connects[Math.floor(connects.length * 0.95)] : null;
  const errors = results.filter(x => x.error).length;

  const report = {
    date: new Date().toISOString(),
    base_url: BASE_URL,
    participants_requested: PARTICIPANTS,
    participants_connected: results.filter(x => !x.error).length,
    errors,
    publish_video: PUBLISH_VIDEO,
    duration_sec: DURATION_SEC,
    connect_ms: { p50, p95, host: hostConnectMs },
    reconnects: results.reduce((s, x) => s + (x.reconnects || 0), 0),
    health_before: before,
    health_mid: mid,
    health_after: after,
    per_participant: results,
    verdict: errors === 0 && p95 !== null && p95 < 5000 ? 'PASS' : 'FAIL'
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `TING-LOAD-${PARTICIPANTS}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[load] ${report.verdict}: ${report.participants_connected}/${PARTICIPANTS}, p95=${p95}ms → ${out}`);

  await roomObj.disconnect();
  process.exit(report.verdict === 'PASS' ? 0 : 1);
}

run().catch(e => {
  console.error('[load] failed:', e.message);
  process.exit(1);
});
