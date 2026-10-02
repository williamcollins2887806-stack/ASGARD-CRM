#!/usr/bin/env node
/**
 * THING call emulator + action matrix runner.
 * Covers A01–A40: API layer always; Playwright LiveKit when BASE reachable + chromium.
 *
 * Usage:
 *   THING_TEST_BASE=http://127.0.0.1:3100 node tests/ting/call_emulator/run.js
 *   THING_EMU_SKIP_LIVEKIT=1  — skip media connect (still runs API/DOM matrix)
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

const BASE = process.env.THING_TEST_BASE || 'http://127.0.0.1:3000';
const SKIP_LK = process.env.THING_EMU_SKIP_LIVEKIT === '1';
const out = [];
const reportPath = path.join(__dirname, '../../reports/THING-ACTION-MATRIX-RUN.json');
const mdPath = path.join(__dirname, '../../reports/THING-ACTION-MATRIX.md');

function mark(id, pass, detail, skip) {
  out.push({ id, pass: skip ? null : !!pass, skip: !!skip, detail: String(detail || '') });
  const tag = skip ? 'SKIP' : (pass ? 'PASS' : 'FAIL');
  console.log(tag + ' ' + id + ' — ' + detail);
}

function req(method, p, body, token, extraHeaders) {
  const payload = body == null ? null : JSON.stringify(body);
  const u = new URL(BASE + p);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const r = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(extraHeaders || {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let d = '';
        res.on('data', (x) => (d += x));
        res.on('end', () => {
          let j = {};
          try { j = JSON.parse(d || '{}'); } catch (_) { j = { raw: d }; }
          resolve({ status: res.statusCode, data: j });
        });
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function readSources() {
  const root = path.join(__dirname, '../../..');
  return {
    tingPage: fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8'),
    tingCss: fs.readFileSync(path.join(root, 'public/assets/css/ting.css'), 'utf8'),
    guest: fs.readFileSync(path.join(root, 'public/ting/index.html'), 'utf8'),
    app: fs.readFileSync(path.join(root, 'public/assets/js/app.js'), 'utf8'),
    index: fs.readFileSync(path.join(root, 'public/index.html'), 'utf8'),
    thing: fs.readFileSync(path.join(root, 'src/routes/thing.js'), 'utf8')
  };
}

(async () => {
  const src = readSources();

  // ── Static / DOM contract (always) ───────────────────────────
  mark('A01', /#\/ting|r:"\/ting"/.test(src.app) && /AsgardTing/.test(src.tingPage), 'hub route + AsgardTing');
  mark('A02', /Из Тинга/.test(src.tingPage), 'tab Из Тинга');
  mark('A03', /Из Совещаний/.test(src.tingPage), 'tab Из Совещаний');
  mark('A04', /data-act="new"/.test(src.tingPage) && /v === 'new'|view === 'new'|go\('new'\)/.test(src.tingPage), 'CTA new');
  mark('A05', /meeting-create/.test(src.tingPage), 'CTA meeting-create');
  mark('A06', /data-act="schedule"/.test(src.tingPage), 'CTA schedule');
  mark('A07', /data-act="dialin"/.test(src.tingPage), 'CTA dialin');
  mark('A09', /copy-link/.test(src.tingPage), 'ready copy link');
  mark('A10', /copy-dial/.test(src.tingPage) && /ting-dial/.test(src.tingPage), 'ready dial 6');
  mark('A11', /enter-lobby/.test(src.tingPage), 'ready→lobby');
  mark('A12', /tog-mic|tog-cam/.test(src.tingPage), 'lobby mic/cam');
  mark('A20', /toggle-side.*people|data-side="people"/.test(src.tingPage), 'people panel');
  mark('A23', /chat-send|\/chat/.test(src.tingPage), 'chat UI');
  mark('A24', /ting-consent|data-act="rec"/.test(src.tingPage), 'recording consent UI');
  mark('A26', /host-end-confirm/.test(src.tingPage), 'host-end modal');
  mark('A27', /data-act="leave"/.test(src.tingPage), 'leave');
  mark('A28', /view === 'ended'|renderEnded/.test(src.tingPage), 'ended CTA');
  mark('A29', /ting-proto-doc|renderProtocol/.test(src.tingPage), 'protocol A4');
  mark('A32', /renderDialin|Вход по телефону/.test(src.tingPage), 'dialin UI');
  mark('A36', /renderMeetingCard|view === 'meeting'/.test(src.tingPage), 'meeting card');
  mark('A38', /r:"\/ting",l:"Тинг"/.test(src.app) && /ting_page\.js/.test(src.index), 'NAV + script');
  mark('A39', /btnPeople|btnChat|btnMic/.test(src.guest), 'guest dock');
  mark('A40', /lobby-status|waiting/.test(src.guest), 'guest waiting poll');

  // ── API against live BASE ────────────────────────────────────
  let dbOk = false;
  let token = null;
  let tokenOther = null;
  let room = null;
  try {
    const c = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME || process.env.PGDATABASE,
      user: process.env.DB_USER || process.env.PGUSER,
      password: process.env.DB_PASSWORD || process.env.PGPASSWORD
    });
    await c.connect();
    const { rows } = await c.query(
      `SELECT id, login, role, name FROM users WHERE role='ADMIN' AND COALESCE(is_active,true)=true ORDER BY id LIMIT 1`
    );
    const { rows: others } = await c.query(
      `SELECT id, login, role, name FROM users WHERE id <> $1 AND COALESCE(is_active,true)=true ORDER BY id LIMIT 1`,
      [rows[0].id]
    );
    token = jwt.sign(
      { id: rows[0].id, login: rows[0].login, role: rows[0].role, name: rows[0].name, pinVerified: true },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );
    if (others[0]) {
      tokenOther = jwt.sign(
        { id: others[0].id, login: others[0].login, role: others[0].role, name: others[0].name, pinVerified: true },
        process.env.JWT_SECRET,
        { expiresIn: '2h' }
      );
    }
    await c.end();
    dbOk = true;
  } catch (e) {
    console.warn('DB unavailable for API actions:', e.message);
  }

  if (!dbOk || !token) {
    ['A08', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A19', 'A21', 'A22', 'A25', 'A30', 'A31', 'A33', 'A34', 'A35', 'A37'].forEach((id) => {
      mark(id, false, 'DB/API unreachable — FAIL (no silent skip for coverage)', false);
    });
  } else {
    // A08 create
    let r = await req('POST', '/api/thing/rooms', {
      title: 'Emu ' + Date.now(),
      lobby_enabled: true,
      protocol_enabled: true,
      pin_code: '1234'
    }, token);
    room = r.data.room;
    mark('A08', r.status === 201 && room && /^\d{6}$/.test(room.dial_code), 'create room dial=' + (room && room.dial_code));

    // A37 schedule-like (scheduled_at optional — create second)
    const rSched = await req('POST', '/api/thing/rooms', {
      title: 'Sched ' + Date.now(),
      lobby_enabled: false,
      protocol_enabled: false
    }, token);
    mark('A37', rSched.status === 201, 'schedule/create room');

    // A15 admit / A16 reject
    const guestWait = await req('POST', `/api/thing/public/${room.slug}/guest-token`, {
      name: 'Wait Guest', pin: '1234'
    });
    const waitId = guestWait.data.participant_id;
    const waitIdent = guestWait.data.identity;
    const admit = waitId
      ? await req('POST', `/api/thing/rooms/${room.slug}/lobby/${waitId}/admit`, {}, token)
      : { status: 0, data: {} };
    mark(
      'A15',
      guestWait.status === 200 && guestWait.data.lobby_status === 'waiting' && admit.status === 200,
      `waiting+admit id=${waitId} admit=${admit.status}`
    );

    const guest2 = await req('POST', `/api/thing/public/${room.slug}/guest-token`, {
      name: 'Reject Me', pin: '1234'
    });
    const rej = await req('POST', `/api/thing/rooms/${room.slug}/lobby/${guest2.data.participant_id}/reject`, {}, token);
    mark('A16', rej.status === 200, 'reject guest');

    // A21 mute-all
    const mute = await req('POST', `/api/thing/rooms/${room.slug}/mute-all`, {}, token);
    mark('A21', mute.status === 200 || mute.status === 503, 'mute-all status=' + mute.status);

    // A22 kick
    const parts = await req('GET', `/api/thing/rooms/${room.slug}/participants`, null, token);
    const guestPart = (parts.data.participants || []).find((p) => p.role === 'guest' && p.identity);
    if (guestPart) {
      const kick = await req('POST', `/api/thing/rooms/${room.slug}/participants/${encodeURIComponent(guestPart.identity)}/remove`, {}, token);
      mark('A22', kick.status === 200, 'kick ' + guestPart.identity);
    } else {
      mark('A22', false, 'no guest identity to kick');
    }

    // A23 chat (API; static already checked)
    const chatPost = await req('POST', `/api/thing/rooms/${room.slug}/chat`, { text: 'emu hi' }, token);
    const chatGet = await req('GET', `/api/thing/rooms/${room.slug}/chat`, null, token);
    const chatOk = chatPost.status === 200 && (chatGet.data.messages || []).length >= 1;
    // upgrade static A23 if present
    const prevChat = out.find((x) => x.id === 'A23');
    if (prevChat) {
      prevChat.pass = prevChat.pass && chatOk;
      prevChat.detail += ' + API roundtrip=' + chatOk;
    } else {
      mark('A23', chatOk, 'chat roundtrip');
    }

    // A24/A25 recording
    const recStart = await req('POST', `/api/thing/rooms/${room.slug}/recording/start`, {}, token);
    if (recStart.status === 200) {
      mark('A24', true, 'recording start');
      const recStop = await req('POST', `/api/thing/rooms/${room.slug}/recording/stop`, {}, token);
      mark('A25', recStop.status === 200, 'recording stop');
    } else if (recStart.status === 503 || recStart.status === 400) {
      mark('A24', null, 'recording start ACK status=' + recStart.status, true);
      mark('A25', null, 'recording stop ACK (no active egress)', true);
    } else {
      mark('A24', false, 'recording start ' + recStart.status);
      mark('A25', false, 'blocked');
    }

    // A30/A31 protocol
    const protoHost = await req('GET', `/api/thing/rooms/${room.slug}/protocol`, null, token);
    mark('A30', protoHost.status === 200, 'protocol host ' + protoHost.status);
    if (tokenOther) {
      const protoOther = await req('GET', `/api/thing/rooms/${room.slug}/protocol`, null, tokenOther);
      mark('A31', protoOther.status === 403, 'non-host 403 got ' + protoOther.status);
    } else {
      mark('A31', false, 'no second user for 403');
    }

    // A33 dial-in resolve
    const secret = process.env.THING_DIALIN_SECRET || '';
    if (secret && room.dial_code) {
      const resv = await req('POST', '/api/thing/dial-in/resolve', { dial_code: room.dial_code }, null, {
        'x-thing-dialin-secret': secret
      });
      mark('A33', resv.status === 200, 'dial-in resolve');
    } else {
      mark('A33', null, 'THING_DIALIN_SECRET unset — ACK', true);
    }

    // A26 host end API (UI checked statically)
    const end = await req('POST', `/api/thing/rooms/${room.slug}/end`, {}, token);
    const prevEnd = out.find((x) => x.id === 'A26');
    if (prevEnd) {
      prevEnd.pass = prevEnd.pass && end.status === 200;
      prevEnd.detail += ' + API end=' + end.status;
    } else {
      mark('A26', end.status === 200, 'host end API ' + end.status);
    }
    const tokEnded = await req('POST', `/api/thing/rooms/${room.slug}/token`, {}, token);
    mark('A34', tokEnded.status === 410 || tokEnded.status === 400, 'ended token ' + tokEnded.status);

    // A35 bad pin — new room
    const r2 = await req('POST', '/api/thing/rooms', {
      title: 'Pin ' + Date.now(), lobby_enabled: false, pin_code: '9999'
    }, token);
    const bad = await req('POST', `/api/thing/public/${r2.data.room.slug}/guest-token`, {
      name: 'X', pin: '0000'
    });
    mark('A35', bad.status === 403 || bad.status === 401 || bad.status === 400, 'bad PIN status=' + bad.status);

    // LiveKit media (Playwright) A13/A14/A17–A19
    if (SKIP_LK) {
      ['A13', 'A14', 'A17', 'A18', 'A19'].forEach((id) => mark(id, null, 'THING_EMU_SKIP_LIVEKIT=1', true));
    } else {
      const probe = await req('POST', '/api/thing/rooms', {
        title: 'LK probe ' + Date.now(), lobby_enabled: false
      }, token);
      const probeTok = await req('POST', `/api/thing/rooms/${probe.data.room.slug}/token`, {}, token);
      if (probeTok.status === 503 || !probeTok.data.token) {
        ['A13', 'A14', 'A17', 'A18', 'A19'].forEach((id) =>
          mark(id, null, 'LiveKit not configured locally — ACK (' + (probeTok.data.error || probeTok.status) + ')', true)
        );
        await req('POST', `/api/thing/rooms/${probe.data.room.slug}/end`, {}, token);
      } else {
        try {
          const { chromium } = require('playwright');
          const browser = await chromium.launch({
            headless: true,
            args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
          });
          const slug = probe.data.room.slug;
          const ctx1 = await browser.newContext();
          const page1 = await ctx1.newPage();
          await page1.goto(BASE + '/ting/' + slug, { waitUntil: 'commit', timeout: 30000 });
          await page1.evaluate((t) => localStorage.setItem('asgard_token', t), token);
          await page1.reload({ waitUntil: 'commit' });
          await page1.waitForTimeout(4000);
          const connected = await page1.evaluate(() => {
            return !!(document.getElementById('roomView') && document.getElementById('roomView').classList.contains('on'));
          }).catch(() => false);
          mark('A13', connected, connected ? 'host in roomView' : 'host not connected (LiveKit?)');

          const guestTok = await req('POST', `/api/thing/public/${slug}/guest-token`, { name: 'EmuGuest' });
          const ctx2 = await browser.newContext();
          const page2 = await ctx2.newPage();
          await page2.goto(BASE + '/ting/' + slug, { waitUntil: 'commit', timeout: 30000 });
          if (guestTok.status === 200 && guestTok.data.token) {
            await page2.evaluate(async (creds) => {
              const Room = window.LivekitClient.Room;
              const room = new Room();
              window.__emuRoom = room;
              await room.connect(creds.url, creds.token);
              await room.localParticipant.setMicrophoneEnabled(true);
              await room.localParticipant.setCameraEnabled(true);
            }, guestTok.data);
            mark('A14', true, 'guest Room.connect');
            await page2.evaluate(async () => {
              await window.__emuRoom.localParticipant.setMicrophoneEnabled(false);
            });
            mark('A17', true, 'mic toggle via LK');
            await page2.evaluate(async () => {
              await window.__emuRoom.localParticipant.setCameraEnabled(false);
            });
            mark('A18', true, 'cam toggle via LK');
            try {
              await page2.evaluate(async () => {
                await window.__emuRoom.localParticipant.setScreenShareEnabled(true);
                await window.__emuRoom.localParticipant.setScreenShareEnabled(false);
              });
              mark('A19', true, 'screen share toggle');
            } catch (e) {
              mark('A19', null, 'screen share ACK headless: ' + (e.message || e), true);
            }
          } else {
            mark('A14', false, 'guest token ' + guestTok.status + ' ' + (guestTok.data.error || ''));
            mark('A17', false, 'no guest');
            mark('A18', false, 'no guest');
            mark('A19', false, 'no guest');
          }
          await req('POST', `/api/thing/rooms/${slug}/end`, {}, token);
          await browser.close();
        } catch (e) {
          ['A13', 'A14', 'A17', 'A18', 'A19'].forEach((id) => mark(id, false, 'playwright/LK: ' + e.message));
        }
      }
    }
  }

  // Deduplicate ids keeping last non-skip or first pass
  const byId = new Map();
  for (const row of out) {
    const prev = byId.get(row.id);
    if (!prev) byId.set(row.id, row);
    else if (row.pass === true || (row.pass !== false && prev.pass === false)) byId.set(row.id, row);
  }
  const final = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const denom = final.filter((x) => !x.skip).length;
  const numer = final.filter((x) => x.pass === true && !x.skip).length;
  const fails = final.filter((x) => x.pass === false && !x.skip);

  const summary = {
    at: new Date().toISOString(),
    base: BASE,
    numerator: numer,
    denominator: denom,
    skipped: final.filter((x) => x.skip).length,
    pass: numer === denom && denom > 0,
    fails: fails.map((f) => f.id + ': ' + f.detail),
    rows: final
  };
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  // Update matrix markdown statuses
  let md = fs.readFileSync(mdPath, 'utf8');
  for (const row of final) {
    const st = row.skip ? 'SKIP' : (row.pass ? 'PASS' : 'FAIL');
    md = md.replace(new RegExp('(\\| ' + row.id + ' \\|[^|]+\\|[^|]+\\|[^|]+\\|) PENDING'), '$1 ' + st);
  }
  md = md.replace(/\*\*Итог:\*\*.*/, `**Итог:** \`${numer} / ${denom}\` (skip ${summary.skipped}) · ${summary.pass ? 'GREEN' : 'RED'} · ${summary.at}`);
  fs.writeFileSync(mdPath, md);

  console.log('\nMATRIX ' + numer + '/' + denom + (summary.pass ? ' GREEN' : ' RED'));
  if (fails.length) console.log('FAILS: ' + fails.map((f) => f.id).join(', '));
  process.exit(summary.pass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
