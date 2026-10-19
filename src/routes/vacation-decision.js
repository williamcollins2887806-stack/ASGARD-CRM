'use strict';

/**
 * Публичное решение по отпуску из письма директору (без входа в CRM).
 * GET  /vacation-decision/:token  — страница с кнопками Да / Нет (без мутации).
 * POST /vacation-decision/:token  — { action: approve|reject, reason? } (мутация).
 *
 * Токен подписан HMAC (см. services/vacation-reminders-cron.decisionToken):
 *   vacationId.directorUserId.decision.exp
 * Поэтому знать id директора не нужно — он внутри токена, подделать нельзя.
 *
 * При «Да» — голос директора; период «согласован», когда «за» ВСЕ директора,
 * и тогда сервис проставляет «отп» в график офиса.
 * При «Нет» — комментарий обязателен, дни уходят в блокировку по сотруднику.
 */

const vacRules = require('../services/vacation-rules');
const vacSync = require('../services/vacation-sync');
const cron = require('../services/vacation-reminders-cron');

module.exports = async function vacationDecisionRoutes(fastify) {
  const db = fastify.db;

  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(body || ''))); }
    catch (err) { done(err); }
  });

  function sendPage(reply, status, html) {
    return reply.code(status).type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function shell(title, inner) {
    return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;color:#1b2a4a;">
  <div style="max-width:560px;margin:0 auto;padding:20px 16px 40px;">
    <div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(27,42,74,.08);">
      <div style="background:#1b2a4a;color:#fff;padding:18px 20px;">
        <div style="font-size:12px;letter-spacing:.08em;color:#c9a227;font-weight:700;">АСГАРД · ОТПУСКА</div>
        <div style="font-size:18px;font-weight:700;margin-top:4px;">${esc(title)}</div>
      </div>
      <div style="padding:22px 20px 26px;">${inner}</div>
    </div>
  </div>
</body></html>`;
  }

  function message(title, text, kind) {
    const color = kind === 'ok' ? '#15803d' : kind === 'warn' ? '#b45309' : '#b91c1c';
    return shell(title, `<p style="font-size:15px;line-height:1.55;margin:0;color:${color}">${esc(text)}</p>`);
  }

  async function loadVacation(id) {
    const { rows } = await db.query(
      `SELECT v.*, s.name AS fio,
              to_char(v.date_from,'YYYY-MM-DD') AS from_iso,
              to_char(v.date_to,'YYYY-MM-DD') AS to_iso
         FROM office_vacations v LEFT JOIN staff s ON s.id = v.employee_id
        WHERE v.id = $1`, [id]);
    return rows[0] || null;
  }

  async function activeDirectorIds() {
    const { rows } = await db.query(
      `SELECT id FROM users WHERE role = ANY($1::text[]) AND is_active = true`,
      [['DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV']]);
    return rows.map((r) => r.id);
  }

  /* ── GET: страница решения ──────────────────────────────────────────── */
  fastify.get('/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const tok = cron.verifyDecisionToken(request.params.token);
    if (!tok.ok) {
      const map = {
        expired: 'Срок ссылки истёк. Откройте график отпусков в CRM.',
        bad_signature: 'Ссылка повреждена.',
        malformed: 'Ссылка повреждена.',
      };
      return sendPage(reply, 400, message('Ссылка недоступна', map[tok.reason] || 'Ссылка недействительна.', 'err'));
    }

    const v = await loadVacation(tok.vacationId);
    if (!v) return sendPage(reply, 404, message('Отпуск не найден', 'Возможно, период удалён.', 'err'));
    if (v.status === 'approved') return sendPage(reply, 200, message('Уже согласовано', 'Этот отпуск уже согласован всеми директорами.', 'warn'));
    if (v.status === 'rejected') return sendPage(reply, 200, message('Уже отклонено', 'Решение по этому отпуску уже принято.', 'warn'));
    if (v.status === 'cancelled') return sendPage(reply, 200, message('Отпуск снят', 'Период снят автоматически — директора не ответили на напоминания.', 'warn'));

    const period = vacRules.fmtRange(v.from_iso, v.to_iso);
    const hol = Number(v.holidays_count) || 0;
    const inner = `
      <p style="font-size:15px;line-height:1.55;margin:0 0 14px;">
        <b>${esc(v.fio || 'Сотрудник')}</b> просит отпуск<br>
        <b>${esc(period)}</b> — ${Number(v.days) || 0} календарных дней${hol ? ` (+${hol} празд. продлевают)` : ''}.
      </p>
      <form method="POST" action="/vacation-decision/${encodeURIComponent(request.params.token)}" style="margin:0">
        <input type="hidden" name="action" value="approve">
        <button type="submit" style="display:block;width:100%;background:#15803d;color:#fff;border:0;cursor:pointer;
          padding:14px 16px;border-radius:10px;font-weight:700;font-size:16px;margin:8px 0 10px;">Да, согласовать</button>
      </form>
      <form method="POST" action="/vacation-decision/${encodeURIComponent(request.params.token)}" style="margin:14px 0 0">
        <input type="hidden" name="action" value="reject">
        <label style="display:block;font-size:13px;color:#6b7280;margin-bottom:6px;">
          Если «Нет» — объясните сотруднику, когда лучше взять (обязательно):</label>
        <textarea name="reason" rows="3" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;"></textarea>
        <button type="submit" style="display:block;width:100%;background:#b91c1c;color:#fff;border:0;cursor:pointer;
          padding:14px 16px;border-radius:10px;font-weight:700;font-size:16px;margin-top:10px;">Нет, снять</button>
      </form>
      <p style="font-size:12px;color:#6b7280;margin:16px 0 0;line-height:1.45;">
        Отпуск считается согласованным, когда «за» все директора. При отказе дни снимаются и повторно поставить их нельзя.
      </p>`;
    return sendPage(reply, 200, shell('Согласование отпуска', inner));
  });

  /* ── POST: применение решения ───────────────────────────────────────── */
  fastify.post('/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const tok = cron.verifyDecisionToken(request.params.token);
    if (!tok.ok) return sendPage(reply, 400, message('Ссылка недоступна', 'Ссылка повреждена или истекла.', 'err'));

    const body = request.body || {};
    const action = String(body.action || tok.decision);
    const v = await loadVacation(tok.vacationId);
    if (!v) return sendPage(reply, 404, message('Отпуск не найден', 'Возможно, период удалён.', 'err'));
    if (v.status !== 'pending') return sendPage(reply, 200, message('Уже решено', 'По этому отпуску решение уже принято.', 'warn'));

    const directorId = tok.directorUserId;

    if (action === 'approve') {
      await db.query(
        `INSERT INTO office_vacation_approvals (vacation_id, director_user_id, decision)
         VALUES ($1,$2,'approve')
         ON CONFLICT (vacation_id, director_user_id)
         DO UPDATE SET decision='approve', comment=NULL, decided_at=NOW()`,
        [tok.vacationId, directorId]);

      const ids = await activeDirectorIds();
      const { rows: votes } = await db.query(
        'SELECT director_user_id, decision FROM office_vacation_approvals WHERE vacation_id = $1', [tok.vacationId]);
      const pr = vacRules.approvalProgress(votes, ids);

      if (pr.done >= pr.total) {
        await db.query(`UPDATE office_vacations SET status='approved', decided_by=$2, decided_at=NOW(), updated_at=NOW() WHERE id=$1`,
          [tok.vacationId, directorId]);
        await vacSync.applyToStaffPlan(db, { ...v, status: 'approved' }, 'approved');
        // Уведомление сотруднику — «согласован, пишите заявление».
        try {
          const { createNotification } = require('../services/notify');
          if (v.user_id) {
            await createNotification(db, {
              user_id: v.user_id,
              title: 'Отпуск согласован',
              message: `${vacRules.fmtRange(v.from_iso, v.to_iso)} — согласован всеми директорами. Напишите заявление.`,
              type: 'success',
              link: '#/vacation-schedule',
            });
          }
        } catch (_) { /* уведомление не критично */ }
        return sendPage(reply, 200, message('Согласовано', 'Отпуск согласован всеми директорами. Сотруднику отправлено уведомление.', 'ok'));
      }
      return sendPage(reply, 200, message('Ваш голос учтён',
        `Согласовали ${pr.done} из ${pr.total}. Ждём остальных директоров.`, 'ok'));
    }

    if (action === 'reject') {
      const reason = String(body.reason || '').trim();
      if (!reason) {
        // возвращаем подсказку — без «молчаливого» отказа
        return sendPage(reply, 400, message('Нужен комментарий',
          'Без причины отклонять нельзя: сотрудник должен понять, когда взять отпуск. Вернитесь назад и напишите причину.', 'err'));
      }
      await db.query(
        `INSERT INTO office_vacation_approvals (vacation_id, director_user_id, decision, comment)
         VALUES ($1,$2,'reject',$3)
         ON CONFLICT (vacation_id, director_user_id)
         DO UPDATE SET decision='reject', comment=$3, decided_at=NOW()`,
        [tok.vacationId, directorId, reason]);

      const days = vacSync.rangeDays(v.from_iso, v.to_iso);
      for (const d of days) {
        await db.query(
          `INSERT INTO office_vacation_blocked_days (employee_id, date, vacation_id, reason, blocked_by)
           VALUES ($1,$2::date,$3,$4,$5)
           ON CONFLICT (employee_id, date) DO UPDATE SET reason=EXCLUDED.reason, blocked_by=EXCLUDED.blocked_by`,
          [v.employee_id, d, tok.vacationId, reason, directorId]);
      }
      await db.query(`UPDATE office_vacations SET status='rejected', reason=$2, decided_by=$3, decided_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [tok.vacationId, reason, directorId]);
      await vacSync.removeFromStaffPlan(db, { ...v, status: 'rejected' });

      try {
        const { createNotification } = require('../services/notify');
        if (v.user_id) {
          await createNotification(db, {
            user_id: v.user_id,
            title: 'Отпуск не согласован',
            message: `${vacRules.fmtRange(v.from_iso, v.to_iso)} снят. Причина: ${reason}`,
            type: 'error',
            link: '#/vacation-schedule',
          });
        }
      } catch (_) { /* не критично */ }

      return sendPage(reply, 200, message('Отклонено',
        'Отпуск снят, сотрудник получил уведомление с причиной. Прежние даты поставить повторно нельзя.', 'warn'));
    }

    return sendPage(reply, 400, message('Неизвестное действие', 'Ожидалось «согласовать» или «снять».', 'err'));
  });
};
