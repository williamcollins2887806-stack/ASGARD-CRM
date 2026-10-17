'use strict';

/**
 * V398 (Часть II): «Добро» в треде → согласование счёта от лица директора.
 * ═══════════════════════════════════════════════════════════════════════════
 * Заказчик: директор НЕ жмёт кнопку — он отвечает в письме словом «Добро».
 * Здесь связка: определить согласие (approval-detector) → найти заявки по треду
 * → применить решение (payment-mail.applyDecision) ОТ ЛИЦА ДИРЕКТОРА → запись
 * в реестр (хук ensureRegistryDoc внутри applyDecision).
 *
 * Инварианты:
 *   • ложно-согласие недопустимо: при неоднозначном треде — НЕ согласуем,
 *     возвращаем needs_manual (ручная привязка);
 *   • одно «Добро» применятся ко ВСЕМ счетам этого письма-заявки (норма плана);
 *   • повторное письмо с «Добро» не воскрешает уже принятые заявки (applyDecision
 *     идемпотентен: не-awaiting_dir → already).
 */

const { detectApproval, detectRejection } = require('./approval-detector');

/** Адрес согласующего (настройка doc_approver_user_id, fallback 3456). */
async function approverId(db) {
  try {
    const r = await db.query(`SELECT value_json FROM settings WHERE key='doc_approver_user_id' LIMIT 1`);
    if (r.rows[0]) { let v = r.rows[0].value_json; try { v = JSON.parse(v); } catch (_) {} const n = parseInt(v, 10); if (Number.isFinite(n)) return n; }
  } catch (_) {}
  return 3456;
}

/**
 * Привязать ответ директора к заявкам по треду и применить решение.
 * @param {object} db
 * @param {object} email — строка emails (id, thread_id, in_reply_to, references_header, body_text, from_email)
 * @returns {Promise<{action:string, matched:number, applied:number, needs_manual?:boolean, ids?:number[], reason?:string}>}
 */
/**
 * Извлечь чистый email из строки (отсекает display-name и угловые скобки).
 * СТРОГО: ровно ОДИН «@», после которого домен вида `label(.label)+` из 2-24
 * латинских букв — иначе '' (fail-closed). Ловит подделки
 * `go@asgard-service.com@evil.ru` (два @) и `go@asgard-service.com.` (пустой TLD).
 * FAIL-2 (верификатор 17.10).
 */
function extractEmail(raw) {
  const s = String(raw || '').trim();
  const inBrackets = s.match(/<([^>]+)>/);
  const src = (inBrackets ? inBrackets[1] : s).trim();
  // Ровно один @.
  const atCount = (src.match(/@/g) || []).length;
  if (atCount !== 1) return '';
  const m = src.match(/^([a-z0-9._%+\-]{1,64})@([a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?)*\.([a-z]{2,24})$/i);
  return m ? m[0].toLowerCase() : '';
}

async function handleApprovalReply(db, email) {
  const body = email.body_text || '';
  // F4 (верификатор 17.10): сервис сам проверяет отправителя — раньше фильтр
  // жил только в imap.js, и прямой вызов согласовывал от лица директора
  // без проверки from_email. Сравнение — ТОЧНЫМ адресом (не подстрокой!).
  // FAIL-3 (верификатор 17.10): FAIL-CLOSED — если список пуст (у согласующего
  // нет email и нет заместителей), согласование НЕ выполняется (раньше пустой
  // список отключал проверку и любой чужак согласовывал счёт).
  const sender = extractEmail(email.from_email);
  if (!sender) return { action: 'none', matched: 0, applied: 0, reason: 'sender_unparsable', sender: email.from_email || null };
  const allowed = await approverEmails(db);
  if (!allowed.length) return { action: 'none', matched: 0, applied: 0, reason: 'approver_list_empty', sender };
  if (!allowed.includes(sender)) {
    return { action: 'none', matched: 0, applied: 0, reason: 'sender_not_approver', sender };
  }
  const appr = detectApproval(body);
  const rej = detectRejection(body);
  if (rej.reject) return { action: 'reject', matched: 0, applied: 0, reason: 'rejection_word' };
  if (!appr.approve) return { action: 'none', matched: 0, applied: 0, reason: 'no_approval_signal' };

  // Ищем заявки в этом треде. Признаки: письмо-предок с тем же thread_id либо
  // in_reply_to/references указывают на письмо-заявку.
  const threadKey = email.thread_id || null;
  const refs = [email.in_reply_to, email.references_header].filter(Boolean).join(' ');
  const ids = new Set();

  // 1) прямые ссылки: по source_email_id заявок, чьё письмо в цепочке references.
  const refIds = (refs.match(/<[^>]+>/g) || [inReplyToClean(email.in_reply_to)]).filter(Boolean);
  if (refIds.length) {
    const q = await db.query(
      `SELECT pi.id FROM payment_invoices pi
         JOIN emails e ON e.id = pi.source_email_id
        WHERE e.message_id = ANY($1::text[])`, [refIds]);
    for (const r of q.rows) ids.add(r.id);
  }
  // 2) по треду: письма треда → заявки, созданные из этих писем.
  if (threadKey) {
    const q = await db.query(
      `SELECT pi.id FROM payment_invoices pi
         JOIN emails e ON e.id = pi.source_email_id
        WHERE e.thread_id = $1`, [threadKey]);
    for (const r of q.rows) ids.add(r.id);
  }
  // 3) фолбэк: заявки без source_email_id, но awaiting_dir с недавним апдейтом и
  //    тем же контрагентом из темы — НЕ трогаем (неоднозначно) → needs_manual.
  const idArr = [...ids];
  if (!idArr.length) {
    return { action: 'approve', matched: 0, applied: 0, needs_manual: true, reason: 'thread_not_matched' };
  }

  const actorId = await approverId(db);
  const actor = (await db.query(`SELECT id, name, role FROM users WHERE id=$1`, [actorId])).rows[0]
    || { id: actorId, name: 'Согласующий (по email)', role: 'DIRECTOR_COMM' };

  let applied = 0;
  const appliedIds = [];
  // applyDecision вызывает db.pool.connect() и db.query(...). Сервис db имеет
  // оба; «сырой» Pool — только .query и .connect. Собираем совместимый адаптер.
  let dbp = db;
  if (!dbp.pool) {
    dbp = {
      query: (t, p) => db.query(t, p),
      pool: db,
      connect: () => db.connect()
    };
  }
  for (const id of idArr) {
    const pay = (await db.query(`SELECT * FROM payment_invoices WHERE id=$1`, [id])).rows[0];
    if (!pay || pay.status !== 'awaiting_dir') continue;   // уже решено — не воскрешаем
    try {
      const { applyDecision } = require('./payment-mail');
      const res = await applyDecision(dbp, pay, 'approve', actor);
      if (res && (res.status === 'pending_payment')) { applied++; appliedIds.push(id); }
    } catch (e) {
      console.error('[approval-thread] applyDecision failed:', e.message);
    }
  }
  return {
    action: 'approve', matched: idArr.length, applied, ids: appliedIds,
    actor: actor.name, channel: 'email'
  };
}

function inReplyToClean(v) {
  if (!v) return null;
  const m = String(v).match(/<[^>]+>/);
  return m ? m[0] : String(v).trim() || null;
}

/** Список допустимых адресов согласующего (сам ящик + заместители из настроек). */
async function approverEmails(db) {
  const out = new Set();
  try {
    const id = await approverId(db);
    const u = await db.query(`SELECT email FROM users WHERE id=$1`, [id]);
    if (u.rows[0] && u.rows[0].email) out.add(String(u.rows[0].email).toLowerCase());
    const s = await db.query(`SELECT value_json FROM settings WHERE key='doc_approver_emails' LIMIT 1`);
    if (s.rows[0]) {
      let v = s.rows[0].value_json;
      try { v = JSON.parse(v); } catch (_) {}
      if (typeof v === 'string') v = v.split(/[,\s;]+/);
      if (Array.isArray(v)) for (const e of v) if (e) out.add(String(e).toLowerCase().trim());
    }
  } catch (_) { /* нет настроек — вернём то, что есть */ }
  // Нормализуем каждый адрес (display-name/скобки) — сравнение точное.
  return [...out].map((e) => extractEmail(e)).filter(Boolean);
}

module.exports = { handleApprovalReply, approverId, approverEmails, extractEmail };
