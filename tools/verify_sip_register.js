'use strict';

/**
 * Проверка WebRTC-регистрации оператора (регрессия 09.10.2026).
 *
 * Инцидент: браузер подключается к Asterisk через nginx (127.0.0.1:8088), а в
 * pjsip_asgard_trunks.conf есть [identify-livekit] match=127.0.0.1/32. При
 * порядке идентификации по умолчанию (ip,username) REGISTER оператора
 * опознавался как livekit-ting → 404 Not Found → SIP не поднимался →
 * исходящий уходил на мобильный вместо браузера.
 *
 * Скрипт шлёт сырой SIP REGISTER по WebSocket и проверяет ответ 200 OK.
 *
 * Запуск (на сервере, WS доступен только с loopback):
 *   node tools/verify_sip_register.js                     # все операторы из БД
 *   node tools/verify_sip_register.js --user u3474 --pass XXX
 *   node tools/verify_sip_register.js --url ws://127.0.0.1:8088/ws
 *
 * Переменные: DATABASE_URL (иначе дефолт asgard/asgard_crm).
 */
const crypto = require('crypto');
const path = require('path');

let WebSocket;
try {
  WebSocket = require(path.resolve(__dirname, '../node_modules/ws'));
} catch (_) {
  console.error('[fatal] нужен модуль ws (npm i ws)');
  process.exit(2);
}

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

const WS_URL = arg('url', process.env.PBX_WS_TEST_URL || 'ws://127.0.0.1:8088/ws');
const DOMAIN = arg('domain', process.env.PBX_DOMAIN || 'asgard-crm.ru');
const ONLY_USER = arg('user', '');
const ONLY_PASS = arg('pass', '');

function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

function authHeader(challenge, method, uri, user, pass) {
  const realm = (challenge.match(/realm="([^"]+)"/) || [])[1];
  const nonce = (challenge.match(/nonce="([^"]+)"/) || [])[1];
  const cnonce = crypto.randomBytes(6).toString('hex');
  const nc = '00000001';
  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
  return `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", `
    + `response="${response}", algorithm=MD5, qop=auth, nc=${nc}, cnonce="${cnonce}"`;
}

/**
 * @returns {Promise<{ok:boolean, status:string, detail?:string}>}
 */
function tryRegister(user, pass, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let ws;
    try {
      ws = new WebSocket(WS_URL, 'sip');
    } catch (e) {
      return done({ ok: false, status: 'ws_error', detail: e.message });
    }
    const callId = crypto.randomBytes(8).toString('hex') + '@asgard';
    const uri = `sip:${DOMAIN}`;
    const via = () => `SIP/2.0/WS ${DOMAIN};branch=z9hG4bK${crypto.randomBytes(6).toString('hex')}`;
    const tag = () => crypto.randomBytes(5).toString('hex');
    let cseq = 1;
    const fromTag = tag();

    const timer = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      done({ ok: false, status: 'timeout' });
    }, timeoutMs);

    const send = (extra) => {
      const lines = [
        `REGISTER ${uri} SIP/2.0`,
        `Via: ${via()}`,
        'Max-Forwards: 70',
        `From: <sip:${user}@${DOMAIN}>;tag=${fromTag}`,
        `To: <sip:${user}@${DOMAIN}>`,
        `Call-ID: ${callId}`,
        `CSeq: ${cseq} REGISTER`,
        `Contact: <sip:${user}@${DOMAIN};transport=ws>`,
        'Expires: 60',
        ...(extra || []),
        'Content-Length: 0',
      ];
      ws.send(lines.join('\r\n') + '\r\n\r\n');
    };

    ws.on('open', () => send());
    ws.on('error', (e) => { clearTimeout(timer); done({ ok: false, status: 'ws_error', detail: e.message }); });
    ws.on('message', (data) => {
      const txt = data.toString('utf8');
      const first = txt.split('\r\n')[0];
      if (/^SIP\/2\.0 401/.test(first) || /^SIP\/2\.0 407/.test(first)) {
        const ch = (txt.match(/WWW-Authenticate:\s*(.*)/i) || [])[1]
          || (txt.match(/Proxy-Authenticate:\s*(.*)/i) || [])[1];
        cseq += 1;
        send([`Authorization: ${authHeader(ch, 'REGISTER', uri, user, pass)}`]);
        return;
      }
      if (/^SIP\/2\.0 200/.test(first)) {
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        return done({ ok: true, status: '200 OK' });
      }
      if (/^SIP\/2\.0 404/.test(first)) {
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        return done({
          ok: false,
          status: '404 Not Found',
          detail: 'эндпоинт не опознан — проверь endpoint_identifier_order=username,ip,anonymous (инцидент 09.10)',
        });
      }
      if (/^SIP\/2\.0 4\d\d|^SIP\/2\.0 5\d\d/.test(first)) {
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        return done({ ok: false, status: first });
      }
    });
    ws.on('close', () => clearTimeout(timer));
  });
}

async function loadOperators() {
  let Pool;
  try { ({ Pool } = require(path.resolve(__dirname, '../node_modules/pg'))); } catch (_) { return []; }
  const cs = process.env.DATABASE_URL
    || `postgresql://${process.env.DB_USER || 'asgard'}:${process.env.DB_PASSWORD || '123456789'}`
     + `@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'asgard_crm'}`;
  const pool = new Pool({ connectionString: cs });
  try {
    const { rows } = await pool.query(
      `SELECT sip_username, sip_password FROM pbx_operators
        WHERE sip_username IS NOT NULL AND sip_password IS NOT NULL
        ORDER BY user_id LIMIT 20`
    );
    return rows;
  } finally {
    await pool.end();
  }
}

(async () => {
  console.log(`[verify_sip_register] ws=${WS_URL} domain=${DOMAIN}`);
  let list;
  if (ONLY_USER) {
    list = [{ sip_username: ONLY_USER, sip_password: ONLY_PASS }];
  } else {
    list = await loadOperators();
  }
  if (!list.length) {
    console.error('[fail] нет операторов с SIP-кредами');
    process.exit(1);
  }

  let fail = 0;
  for (const op of list) {
    const r = await tryRegister(op.sip_username, op.sip_password);
    const mark = r.ok ? 'OK  ' : 'FAIL';
    console.log(`  ${mark} ${op.sip_username.padEnd(12)} ${r.status}${r.detail ? ' — ' + r.detail : ''}`);
    if (!r.ok) fail += 1;
  }
  console.log(`\n${list.length - fail}/${list.length} зарегистрировано`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
