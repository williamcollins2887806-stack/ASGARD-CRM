/**
 * ASGARD CRM — Mail killswitch (D-210 / задача «mail-killswitch», шаг 0.5)
 * ═══════════════════════════════════════════════════════════════════════════
 * Зачем. Прод-почту нельзя трогать из тестов, но гейт «не слать» был только у
 * 5 мейлеров (payment-mail, tender-director-mail, cash-mail, assembly-mail,
 * reminder-cron). `crm-mailer.js` и ~15 других путей дёргали SMTP напрямую
 * (D-210). Правка каждого вызова = риск что-то забыть и снова «выстрелить».
 *
 * Решение. Одна точка перехвата — `nodemailer.createTransport`. В non-prod
 * ЛЮБОЙ созданный транспорт подменяется «глушителем»: метод sendMail не идёт
 * в сеть, а возвращает правдоподобный ответ, повторяющий форму nodemailer
 * (messageId/accepted/envelope). Вызывающий код (и запись в `emails`) работают
 * как обычно, но письмо реально не уходит.
 *
 * Когда активен:
 *   - non-prod определяется как (NODE_ENV !== 'production') ИЛИ
 *     (DB_NAME !== 'asgard_crm') — как в payment-mail.js;
 *   - либо принудительно MAIL_DISABLED=1 (в т.ч. на проде — аварийный тумблер).
 *
 * Единственное исключение: MAIL_ALLOW_TO=<адреса через запятую>. Письмо уходит
 * по-настоящему ТОЛЬКО если ВСЕ получатели входят в этот список (для тестов —
 * n.androsov@asgard-service.com). Список пуст по умолчанию => не уходит ничего.
 *
 * Выключатель предохранителя только на проде: NODE_ENV=production +
 * DB_NAME=asgard_crm + MAIL_DISABLED≠1.
 */
'use strict';

const nodemailer = require('nodemailer');

const LOG_PREFIX = '[mail-killswitch]';
let _installed = false;
let _suppressed = 0; // счётчик подавленных писем (для негативных тестов/диагностики)

function isProd() {
  return process.env.NODE_ENV === 'production' && process.env.DB_NAME === 'asgard_crm';
}

function isActive() {
  if (process.env.MAIL_DISABLED === '1') return true;
  return !isProd();
}

function allowList() {
  return String(process.env.MAIL_ALLOW_TO || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function recipients(to) {
  const arr = Array.isArray(to) ? to : String(to || '').split(',');
  return arr.map((s) => String(s).trim().toLowerCase()
    .replace(/^.*<([^>]+)>.*$/, '$1') // "Имя <a@b>" -> a@b
    .trim())
    .filter(Boolean);
}

/**
 * ВСЕ получатели письма: to + cc + bcc.
 * Раньше проверялся только `to` — письмо с `cc`/`bcc` вне списка уходило в сеть
 * (находка независимого верификатора, 20.09). Теперь перечисляются все три поля,
 * и реальная отправка возможна, только если ВСЕ они в allowlist.
 */
function allRecipients(mail) {
  const m = mail || {};
  return [...recipients(m.to), ...recipients(m.cc), ...recipients(m.bcc)];
}

/**
 * Разрешена ли реальная отправка: allowlist непуст и покрывает ВСЕХ получателей
 * (to, cc, bcc). Любой получатель вне списка => отправка подавляется.
 */
function isAllowed(to) {
  const list = allowList();
  if (!list.length) return false;
  // Совместимость: прежняя сигнатура isAllowed(to) — строка/массив `to`.
  const r = Array.isArray(to) || typeof to === 'string' ? recipients(to) : allRecipients(to);
  if (!r.length) return false;
  return r.every((addr) => list.includes(addr));
}

/** Разрешена ли отправка конкретного письма (учитывает to/cc/bcc). */
function isAllowedMail(mail) {
  const list = allowList();
  if (!list.length) return false;
  const r = allRecipients(mail);
  if (!r.length) return false;
  return r.every((addr) => list.includes(addr));
}

function fakeInfo(mail) {
  const r = allRecipients(mail);
  const id = '<suppressed-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10) + '@asgard.local>';
  return {
    accepted: r,
    rejected: [],
    ehlo: [],
    envelopeTime: 0,
    messageTime: 0,
    messageSize: Buffer.byteLength(String((mail && mail.text) || (mail && mail.html) || ''), 'utf8'),
    response: '250 OK (suppressed by mail-killswitch)',
    envelope: { from: (mail && mail.from) || '', to: r },
    messageId: id,
    suppressed: true
  };
}

/**
 * Создать «глушитель»-транспорт. Совместим с тем, как код использует
 * nodemailer: sendMail(mail[, cb]) (Promise или callback), verify(), close().
 * Любое прочее свойство — no-op-функция (не роняем код, который щупает API).
 */
function makeSink(realFactory) {
  let _real = null;
  const real = () => (_real || (_real = realFactory()));

  const sink = {
    __mailKillswitchSink: true,

    async sendMail(mail, cb) {
      // Явное исключение (Андросов) — шлём по-настоящему. Учитываем ВСЕ получатели:
      // to + cc + bcc (письмо с чужим cc не должно уходить).
      if (isAllowedMail(mail)) {
        console.log(LOG_PREFIX + ' ALLOWED -> real SMTP: ' + allRecipients(mail).join(', '));
        return real().sendMail(mail, cb);
      }
      _suppressed++;
      const info = fakeInfo(mail);
      const to = allRecipients(mail).join(', ') || '(нет получателя)';
      console.log(LOG_PREFIX + ' SUPPRESSED to=' + to + ' env=' +
        (process.env.NODE_ENV || '?') + ' db=' + (process.env.DB_NAME || '?') + ' id=' + info.messageId);
      if (typeof cb === 'function') {
        // nodemailer вызывает callback асинхронно — повторяем поведение.
        setImmediate(() => cb(null, info));
      }
      return info;
    },

    // Верификация соединения в тестах не нужна — считаем «ок».
    async verify() { return true; },

    async close() { if (_real) return _real.close(); return true; },

    // Всё остальное (не должно вызываться, но не падаем).
    on() { return sink; },
    removeListener() { return sink; },
    set() { return sink; },
    get() { return undefined; },
    use() { return sink; }
  };

  // Дать доступ к настоящему транспорту, если он кому-то понадобится напрямую.
  sink.__real = () => real();
  return sink;
}

function install() {
  if (_installed) return;
  _installed = true;

  const orig = nodemailer.createTransport;
  if (typeof orig !== 'function') {
    console.error(LOG_PREFIX + ' nodemailer.createTransport не найден — предохранитель НЕ установлен');
    _installed = false;
    return;
  }

  if (!isActive()) {
    console.log(LOG_PREFIX + ' OFF — prod runtime (' + (process.env.DB_NAME || '?') + '); реальная почта разрешена');
    return;
  }

  // ВАЖНО: патч ставим всегда, но решение «глушить/слать» принимается в момент
  // sendMail — env может измениться (тесты), да и так безопаснее (fail-closed).
  nodemailer.createTransport = function patchedCreateTransport(cfg, defaults) {
    const realFactory = () => orig.call(nodemailer, cfg, defaults);
    if (!isActive()) return realFactory();
    return makeSink(realFactory);
  };

  const ex = allowList();
  console.log(LOG_PREFIX + ' ON — SMTP-отправка заглушена (non-prod: NODE_ENV=' +
    (process.env.NODE_ENV || '?') + ', DB=' + (process.env.DB_NAME || '?') +
    '). Исключение MAIL_ALLOW_TO=' + (ex.length ? ex.join(',') : '— нет —'));
}

module.exports = { install, isActive, isProd, isAllowed, isAllowedMail, allRecipients, allowList, recipients, _counters: () => ({ suppressed: _suppressed }) };
