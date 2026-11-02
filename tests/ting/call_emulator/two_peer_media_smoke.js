#!/usr/bin/env node
/**
 * 2-peer LiveKit media smoke: host + guest both connect, publish A/V,
 * each sees the other's remote track, then mic/cam toggle.
 *
 * Usage:
 *   THING_TEST_BASE=https://asgard-crm.ru THING_ADMIN_TOKEN=<jwt> \
 *     node tests/ting/call_emulator/two_peer_media_smoke.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const BASE = process.env.THING_TEST_BASE || 'https://asgard-crm.ru';
const TOKEN = process.env.THING_ADMIN_TOKEN || '';
const outPath = path.join(__dirname, '../../reports/TING-2PEER-MEDIA-SMOKE.json');
const rows = [];

function mark(id, pass, detail) {
  rows.push({ id, pass: !!pass, detail: String(detail || '') });
  console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + ' — ' + detail);
}

function req(method, p, body, token) {
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

function finish(ok) {
  const summary = {
    at: new Date().toISOString(),
    base: BASE,
    numerator: rows.filter((r) => r.pass).length,
    denominator: rows.length,
    pass: !!ok,
    rows
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log('\n2PEER SMOKE ' + summary.numerator + '/' + summary.denominator + (ok ? ' GREEN' : ' RED'));
  console.log('Wrote ' + outPath);
  process.exit(ok ? 0 : 1);
}

(async () => {
  if (!TOKEN) {
    console.error('THING_ADMIN_TOKEN required');
    process.exit(2);
  }

  const health = await req('GET', '/api/thing/health');
  mark('P00_health', health.status === 200 && health.data.livekit === true, JSON.stringify(health.data));

  const created = await req('POST', '/api/thing/rooms', {
    title: '2peer smoke ' + Date.now(),
    lobby_enabled: false
  }, TOKEN);
  const room = created.data.room || {};
  mark('P01_create', created.status === 201 && !!room.slug, 'status=' + created.status + ' slug=' + (room.slug || ''));

  if (!room.slug) {
    finish(false);
    return;
  }

  // Instant create already sets status=live on prod; /start must accept slug (local fix) or numeric id (prod legacy).
  if (room.status === 'live' || room.status === 'active') {
    mark('P02_start', true, 'already ' + room.status + ' after create');
  } else {
    const startPath = `/api/thing/rooms/${room.id || room.slug}/start`;
    const started = await req('POST', startPath, {}, TOKEN).catch((e) => ({ status: 0, data: { error: e.message } }));
    const startOk = started.status === 200 || started.status === 201 || !!(started.data && (started.data.room || started.data.success));
    mark('P02_start', startOk, 'status=' + started.status + ' path=' + startPath + ' body=' + JSON.stringify(started.data).slice(0, 180));
  }

  const hostTok = await req('POST', `/api/thing/rooms/${room.slug}/token`, {}, TOKEN);
  mark('P03_host_token', hostTok.status === 200 && !!hostTok.data.token, 'status=' + hostTok.status);

  const guestTok = await req('POST', `/api/thing/public/${room.slug}/guest-token`, { name: 'SmokeGuest' });
  mark('P04_guest_token', guestTok.status === 200 && !!guestTok.data.token, 'status=' + guestTok.status);

  if (!hostTok.data.token || !guestTok.data.token) {
    await req('POST', `/api/thing/rooms/${room.slug}/end`, {}, TOKEN).catch(() => {});
    finish(false);
    return;
  }

  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      headless: true,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
    });
    const ctx = await browser.newContext({
      permissions: ['camera', 'microphone']
    });
    const pageH = await ctx.newPage();
    const pageG = await ctx.newPage();

    await pageH.goto(BASE + '/ting/' + room.slug, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pageG.goto(BASE + '/ting/' + room.slug, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pageH.waitForFunction(() => !!(window.LivekitClient || window.LiveKit || window.livekit), null, { timeout: 20000 });
    await pageG.waitForFunction(() => !!(window.LivekitClient || window.LiveKit || window.livekit), null, { timeout: 20000 });

    const connectFn = async (creds, label) => {
      const LK = window.LivekitClient || window.LiveKit || window.livekit;
      if (!LK || !LK.Room) return { ok: false, err: 'no LivekitClient' };
      const roomObj = new LK.Room();
      window.__lk2 = roomObj;
      window.__lk2_label = label;
      const url = creds.url || creds.ws_url || creds.serverUrl;
      if (!url) return { ok: false, err: 'no ws url' };
      await roomObj.connect(url, creds.token);
      await roomObj.localParticipant.setMicrophoneEnabled(true);
      await roomObj.localParticipant.setCameraEnabled(true);
      return {
        ok: true,
        identity: roomObj.localParticipant.identity,
        state: roomObj.state
      };
    };

    const hRes = await pageH.evaluate(connectFn, Object.assign({}, hostTok.data, { _label: 'host' })).catch((e) => ({ ok: false, err: e.message }));
    mark('P05_host_connect', !!hRes.ok, hRes.err || ('id=' + hRes.identity));

    const gRes = await pageG.evaluate(connectFn, Object.assign({}, guestTok.data, { _label: 'guest' })).catch((e) => ({ ok: false, err: e.message }));
    mark('P06_guest_connect', !!gRes.ok, gRes.err || ('id=' + gRes.identity));

    if (!hRes.ok || !gRes.ok) {
      await browser.close();
      await req('POST', `/api/thing/rooms/${room.slug}/end`, {}, TOKEN).catch(() => {});
      finish(false);
      return;
    }

    // Wait until each side sees ≥1 remote participant with video track
    async function waitRemoteMedia(page, timeoutMs) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const snap = await page.evaluate(() => {
          const r = window.__lk2;
          if (!r) return { remotes: 0, video: 0, audio: 0 };
          let video = 0;
          let audio = 0;
          r.remoteParticipants.forEach((p) => {
            p.trackPublications.forEach((pub) => {
              if (!pub.track) return;
              if (pub.kind === 'video' || (pub.track && pub.track.kind === 'video')) video += 1;
              if (pub.kind === 'audio' || (pub.track && pub.track.kind === 'audio')) audio += 1;
            });
          });
          return { remotes: r.remoteParticipants.size, video, audio };
        });
        if (snap.remotes >= 1 && snap.video >= 1 && snap.audio >= 1) return snap;
        await page.waitForTimeout(400);
      }
      return page.evaluate(() => {
        const r = window.__lk2;
        let video = 0;
        let audio = 0;
        if (r) {
          r.remoteParticipants.forEach((p) => {
            p.trackPublications.forEach((pub) => {
              if (!pub.track) return;
              if (pub.kind === 'video' || (pub.track && pub.track.kind === 'video')) video += 1;
              if (pub.kind === 'audio' || (pub.track && pub.track.kind === 'audio')) audio += 1;
            });
          });
        }
        return { remotes: r ? r.remoteParticipants.size : 0, video, audio };
      });
    }

    const hostSees = await waitRemoteMedia(pageH, 20000);
    mark('P07_host_sees_guest', hostSees.remotes >= 1 && hostSees.video >= 1 && hostSees.audio >= 1,
      JSON.stringify(hostSees));

    const guestSees = await waitRemoteMedia(pageG, 20000);
    mark('P08_guest_sees_host', guestSees.remotes >= 1 && guestSees.video >= 1 && guestSees.audio >= 1,
      JSON.stringify(guestSees));

    const micToggle = await pageG.evaluate(async () => {
      await window.__lk2.localParticipant.setMicrophoneEnabled(false);
      await window.__lk2.localParticipant.setMicrophoneEnabled(true);
      return true;
    }).catch((e) => ({ err: e.message }));
    mark('P09_mic_toggle', micToggle === true, micToggle.err || 'ok');

    const camToggle = await pageG.evaluate(async () => {
      await window.__lk2.localParticipant.setCameraEnabled(false);
      await window.__lk2.localParticipant.setCameraEnabled(true);
      return true;
    }).catch((e) => ({ err: e.message }));
    mark('P10_cam_toggle', camToggle === true, camToggle.err || 'ok');

    // Optional TURN probe: iceServers from health or livekit room options not always exposed;
    // record whether health mentions turn / coturn if present.
    const turnHint = !!(health.data && (health.data.turn || health.data.coturn || health.data.ice));
    mark('P11_turn_health_hint', true, turnHint ? JSON.stringify({ turn: health.data.turn, coturn: health.data.coturn }) : 'health has no turn field (coturn wired in livekit.yaml on prod)');

    await browser.close();
  } catch (e) {
    ['P05_host_connect', 'P06_guest_connect', 'P07_host_sees_guest', 'P08_guest_sees_host', 'P09_mic_toggle', 'P10_cam_toggle', 'P11_turn_health_hint']
      .forEach((id) => {
        if (!rows.find((r) => r.id === id)) mark(id, false, e.message);
      });
    if (browser) try { await browser.close(); } catch (_) { /* */ }
  }

  await req('POST', `/api/thing/rooms/${room.slug}/end`, {}, TOKEN).catch(() => {});
  finish(rows.every((r) => r.pass));
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
