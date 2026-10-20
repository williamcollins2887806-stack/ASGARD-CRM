'use strict';
/**
 * D-302: показать пример письма-дайджеста на реальных данных.
 * Отправляет ТОЛЬКО на указанный адрес, НЕ пишет в doc_reminder_log
 * (то есть не «съедает» задачи у реальных получателей).
 *
 * Запуск: node tools/send_digest_preview.js <email>
 */
const email = process.argv[2] || 'n.androsov@asgard-service.com';
const db = require('../src/services/db');

// ── Точная копия хелперов из reminder-cron.js ────────────────────────────
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDateRu(d) {
  const s = String(d || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
function plural(n, one, few, many) {
  const a = Math.abs(Number(n) || 0) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

(async () => {
  // Задачи берём те же, что в проде: реальные просроченные по владельцу.
  const { rows: tasks } = await db.query(`
    SELECT d.id AS doc_id, d.doc_owner_id AS user_id,
           CASE
             WHEN d.correction_state='requested' THEN 'correction'
             WHEN d.payment_due_at IS NOT NULL AND d.payment_due_at::date <= CURRENT_DATE
                  AND COALESCE(d.pay_status,'none') NOT IN ('paid','n_a') THEN 'pay_due'
             WHEN d.sf_due_at IS NOT NULL AND d.sf_due_at::date <= (NOW() + INTERVAL '5 days')::date
                  AND d.sf_received_at IS NULL THEN 'sf_due'
             ELSE NULL END AS kind,
           COALESCE(d.payment_due_at, d.sf_due_at)::date AS due_date,
           d.invoice_number, d.counterparty_name
      FROM doc_registry d
     WHERE d.deleted_at IS NULL
       AND d.doc_owner_id IS NOT NULL
       AND (d.correction_state = 'requested'
            OR (d.payment_due_at IS NOT NULL AND d.payment_due_at::date <= CURRENT_DATE
                AND COALESCE(d.pay_status,'none') NOT IN ('paid','n_a'))
            OR (d.sf_due_at IS NOT NULL AND d.sf_due_at::date <= (NOW() + INTERVAL '5 days')::date
                AND d.sf_received_at IS NULL))
     ORDER BY d.payment_due_at NULLS LAST
     LIMIT 12`);

  const fresh = tasks.filter(t => t.kind);
  if (!fresh.length) {
    console.log('Нет задач для примера — все оплачены / закрыты.');
    await db.pool.end();
    return;
  }

  const { wrapEmail, publicBaseUrl } = require('../src/services/payment-mail');
  const base = publicBaseUrl();
  const link = `${base}/?_v=${Date.now()}#/doc-hub`;

  const lines = fresh.map((f) => {
    const label = f.invoice_number ? `Счёт ${f.invoice_number}` : `Документ #${f.doc_id}`;
    const dueTxt = f.due_date ? `до ${fmtDateRu(f.due_date)}` : '';
    const overdue = f.due_date && String(f.due_date).slice(0, 10) < todayIso();
    let action, where, kindTxt;
    if (f.kind === 'correction') {
      kindTxt = 'корректировка';
      action = 'Заменить СФ/акт и снять флаг';
      where = 'Карточка документа → «Закрывающие» → загрузить новый файл, затем «Снять» в красном баннере';
    } else if (f.kind === 'pay_due') {
      kindTxt = 'срок оплаты';
      if (overdue) {
        action = 'Оплатить сегодня и отметить оплату';
        where = 'Карточка документа → «В очередь оплаты» → после платежа «Отметить оплачено» (или через очередь бухгалтерии)';
      } else {
        action = 'Подготовить оплату и отметить оплату';
        where = 'Карточка документа → «В очередь оплаты» → после платежа «Отметить оплачено»';
      }
    } else {
      kindTxt = 'закрывающие';
      action = 'Запросить СФ или акт у поставщика';
      where = 'Карточка документа → «Закрывающие» → добавить номер и дату, либо «СФ получена»';
    }
    return { label, kindTxt, dueTxt, overdue, cp: f.counterparty_name || '', kind: f.kind, doc_id: f.doc_id, action, where };
  });

  const overdueCount = lines.filter(l => l.overdue).length;

  const rowHtml = lines.map((l) => {
    const accent = l.overdue ? '#b91c1c' : (l.kind === 'correction' ? '#b45309' : '#1b2a4a');
    const badgeBg = l.overdue ? '#fef2f2' : (l.kind === 'correction' ? '#fff8e6' : '#eef2ff');
    const badgeTxt = l.overdue ? 'просрочено' : (l.kind === 'correction' ? 'корректировка' : l.kindTxt);
    const whereShort = escHtml(l.where.replace('Карточка документа → ', ''));
    return `<tr>
      <td style="padding:12px 0;border-bottom:1px solid #eef1f6;vertical-align:top;">
        <div style="font-size:14px;font-weight:700;color:${accent};">${escHtml(l.label)}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:2px;">${escHtml(l.cp)}${l.dueTxt ? ' · ' + escHtml(l.dueTxt) : ''}</div>
        <div style="margin-top:7px;padding:8px 10px;border-left:3px solid ${accent};background:#f8fafc;border-radius:0 6px 6px 0;">
          <div style="font-size:13px;font-weight:700;color:${accent};">${escHtml(l.action)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:3px;line-height:1.4;">${whereShort}</div>
        </div>
      </td>
      <td style="padding:12px 0 12px 10px;border-bottom:1px solid #eef1f6;text-align:right;white-space:nowrap;vertical-align:top;">
        <span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;background:${badgeBg};color:${accent};">${escHtml(badgeTxt)}</span>
      </td>
    </tr>`;
  }).join('');

  const name = 'Андросов Никита Андреевич';

  const html = wrapEmail(
    `Задачи по документам: ${fresh.length}`,
    `<div style="font-size:13px;color:#6b7280;margin-bottom:4px;">Здравствуйте, ${escHtml(name)}!</div>
     <div style="font-size:15px;color:#1b2a4a;margin-bottom:6px;">
       ${fresh.length} ${plural(fresh.length, 'задача', 'задачи', 'задач')} по реестру документов${overdueCount ? `, из них <b style="color:#b91c1c;">${overdueCount} ${plural(overdueCount, 'просрочена', 'просрочены', 'просрочено')}</b>` : ''}.
     </div>
     <div style="font-size:12.5px;color:#6b7280;margin-bottom:14px;">
       По каждой задаче указано, что сделать и в каком месте карточки.
     </div>
     <table style="width:100%;border-collapse:collapse;margin-bottom:6px;">${rowHtml}</table>
     <a href="${escHtml(link)}" style="display:block;background:#15803d;color:#fff;text-decoration:none;text-align:center;padding:14px 16px;border-radius:10px;font-weight:700;font-size:16px;margin:18px 0 8px;">Открыть реестр документов</a>
     <p style="font-size:12px;color:#6b7280;margin:10px 0 0;line-height:1.45;">
       Ссылка ведёт в CRM. Если кнопка не открывается — скопируйте адрес:<br>
       <span style="color:#1b2a4a;word-break:break-all;">${escHtml(link)}</span>
     </p>`,
    {
      kicker: 'АСГАРД · ДОКУМЕНТЫ',
      footer: 'Сводка формируется автоматически один раз в день. Задача исчезает из неё, когда действие выполнено: оплата отмечена, СФ/акт получены, корректировка снята.'
    });

  const text =
    `Здравствуйте, ${name}!\n\n`
    + `Задачи по реестру документов — ${fresh.length}:\n\n`
    + lines.map((l) => `• ${l.label} · ${l.cp}${l.dueTxt ? ' (' + l.dueTxt + ')' : ''}\n`
        + `  ЧТО СДЕЛАТЬ: ${l.action}\n`
        + `  ГДЕ: ${l.where}`).join('\n\n')
    + `\n\nОткрыть реестр: ${link}\n`;

  // Отправка — ТОЛЬКО на указанный адрес, без записи в doc_reminder_log.
  const { sendCrmEmail } = require('../src/services/crm-mailer');
  try {
    await sendCrmEmail(db, null, {
      to: email,
      subject: `[Doc Hub] Задачи по документам: ${fresh.length} (пример письма)`,
      html,
      text,
      skipBcc: true
    });
    console.log(`ОТПРАВЛЕНО на ${email}`);
    console.log(`Задач в примере: ${fresh.length} (просрочено: ${overdueCount})`);
    console.log(`Ссылка: ${link}`);
  } catch (e) {
    console.log(`ОШИБКА отправки: ${e.message}`);
  }

  await db.pool.end().catch(() => {});
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
