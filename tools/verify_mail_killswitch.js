/**
 * Негативный/позитивный тест предохранителя почты (D-210, шаг 0.5).
 *
 * Проверяет на «живом» nodemailer без сети:
 *   1) non-prod  → transport, созданный и через `nodemailer.createTransport`,
 *      и через деструктуризацию `const {createTransport}=require('nodemailer')`,
 *      НЕ идёт в сеть: sendMail возвращает {suppressed:true}. Если бы шёл —
 *      получили бы ECONNREFUSED (host 127.0.0.1, порт 1).
 *   2) адрес НЕ в MAIL_ALLOW_TO → подавлено;
 *   3) адрес В MAIL_ALLOW_TO → реальная попытка (значит, ловится ECONNREFUSED,
 *      а НЕ suppressed) — подтверждает, что исключение работает точечно;
 *   4) прод-режим (NODE_ENV=production + DB_NAME=asgard_crm) → предохранитель OFF,
 *      транспорт настоящий (снова ECONNREFUSED).
 *
 * Запуск: MAIL_ALLOW_TO=... node tools/verify_mail_killswitch.js
 */
'use strict';
const assert = require('assert');

const BOGUS = { host: '127.0.0.1', port: 1, secure: false, auth: { user: 'x', pass: 'y' }, connectionTimeout: 1500, greetingTimeout: 1500, socketTimeout: 1500 };

function freshNodemailer() {
  delete require.cache[require.resolve('nodemailer')];
  delete require.cache[require.resolve('../src/lib/mail-killswitch')];
  const nm = require('nodemailer');
  require('../src/lib/mail-killswitch').install();
  return nm;
}

async function sendOk(transport, to) {
  try {
    const info = await transport.sendMail({ from: 'test@asgard.local', to, subject: 'probe', text: 'probe' });
    return { suppressed: !!info.suppressed, err: null };
  } catch (e) {
    return { suppressed: false, err: e.code || e.message };
  }
}

(async () => {
  const results = [];
  const add = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + ' — ' + detail); };

  // ── 1) non-prod, без allowlist ───────────────────────────────────────
  process.env.NODE_ENV = 'development';
  process.env.DB_NAME = 'asgard_crm_test';
  process.env.MAIL_DISABLED = '0';
  delete process.env.MAIL_ALLOW_TO;
  let nm = freshNodemailer();

  let t = nm.createTransport(BOGUS);
  let r = await sendOk(t, 'someone@example.com');
  add('non-prod: createTransport → suppressed', r.suppressed && !r.err, JSON.stringify(r));

  // деструктуризация — как в crm-mailer (`const nodemailer = require('nodemailer')` vs `const {createTransport}`)
  const { createTransport } = require('nodemailer');
  t = createTransport(BOGUS);
  r = await sendOk(t, 'another@example.com');
  add('non-prod: destructured createTransport → suppressed', r.suppressed && !r.err, JSON.stringify(r));

  // callback-форма
  const cbRes = await new Promise((resolve) => {
    nm.createTransport(BOGUS).sendMail({ from: 'a@b.c', to: 'cb@example.com', subject: 's', text: 't' }, (err, info) =>
      resolve({ err: err && err.message, suppressed: info && info.suppressed }));
  });
  add('non-prod: callback-форма → suppressed', cbRes.suppressed && !cbRes.err, JSON.stringify(cbRes));

  // ── 2) allowlist: чужой адрес всё равно глушится ─────────────────────
  process.env.MAIL_ALLOW_TO = 'n.androsov@asgard-service.com';
  nm = freshNodemailer();
  r = await sendOk(nm.createTransport(BOGUS), 'stranger@example.com');
  add('allowlist: чужой адрес → suppressed', r.suppressed && !r.err, JSON.stringify(r));

  // ── 3) allowlist: разрешённый адрес → реальная попытка (ECONNREFUSED) ─
  r = await sendOk(nm.createTransport(BOGUS), 'n.androsov@asgard-service.com');
  const attempted = !r.suppressed && !!r.err;
  add('allowlist: адрес Андросова → реальная попытка (не suppressed)', attempted, JSON.stringify(r));

  // «Имя <адрес>» тоже распознаётся
  r = await sendOk(nm.createTransport(BOGUS), 'Андросов <n.androsov@asgard-service.com>');
  add('allowlist: "Имя <адрес>" распознан', !r.suppressed && !!r.err, JSON.stringify(r));

  // ── 3-бис) to разрешён, но cc/bcc — чужие => ОБЯЗАНО глушиться ────────
  // Регресс на находку верификатора: раньше проверялся только `to`,
  // и письмо с посторонним cc уходило в сеть.
  async function sendFull(mail) {
    try {
      const info = await nm.createTransport(BOGUS).sendMail(mail);
      return { suppressed: !!info.suppressed, err: null };
    } catch (e) { return { suppressed: false, err: e.code || e.message }; }
  }
  r = await sendFull({ from: 'a@asgard.local', to: 'n.androsov@asgard-service.com', cc: 'stranger@example.com', subject: 's', text: 't' });
  add('allowlist: чужой CC → suppressed (регресс)', r.suppressed && !r.err, JSON.stringify(r));
  r = await sendFull({ from: 'a@asgard.local', to: 'n.androsov@asgard-service.com', bcc: 'stranger@example.com', subject: 's', text: 't' });
  add('allowlist: чужой BCC → suppressed (регресс)', r.suppressed && !r.err, JSON.stringify(r));
  r = await sendFull({ from: 'a@asgard.local', to: 'n.androsov@asgard-service.com', cc: 'n.androsov@asgard-service.com', subject: 's', text: 't' });
  add('allowlist: to+cc оба разрешены → реальная попытка', !r.suppressed && !!r.err, JSON.stringify(r));
  // массив в to
  r = await sendFull({ from: 'a@asgard.local', to: ['stranger@example.com', 'n.androsov@asgard-service.com'], subject: 's', text: 't' });
  add('allowlist: чужой адрес в массиве to → suppressed', r.suppressed && !r.err, JSON.stringify(r));

  // ── 4) прод-режим → предохранитель OFF ───────────────────────────────
  process.env.NODE_ENV = 'production';
  process.env.DB_NAME = 'asgard_crm';
  delete process.env.MAIL_ALLOW_TO;
  nm = freshNodemailer();
  r = await sendOk(nm.createTransport(BOGUS), 'anyone@example.com');
  add('prod: предохранитель OFF → реальная попытка', !r.suppressed && !!r.err, JSON.stringify(r));

  // ── 5) аварийный тумблер MAIL_DISABLED=1 на проде ────────────────────
  process.env.MAIL_DISABLED = '1';
  nm = freshNodemailer();
  r = await sendOk(nm.createTransport(BOGUS), 'anyone@example.com');
  add('prod + MAIL_DISABLED=1 → снова suppressed', r.suppressed && !r.err, JSON.stringify(r));

  const fails = results.filter((x) => !x.ok);
  console.log('\n=== ' + (results.length - fails.length) + '/' + results.length + ' PASS ===');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(3); });
