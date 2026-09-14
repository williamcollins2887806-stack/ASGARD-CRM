'use strict';

/**
 * MLSP stay cron — daily 08:05 MSK
 *   1) reconcile: open stays / auto-depart (ежедневно)
 *   2) письмо «Перевахтовка»: пн и пт — settings + Данилова/Хосе/Вика + РП по срезу
 *      HTML-таблица + Excel; только ≤14 дн или просрочка
 *   3) push рабочему за 7 дней (точечно, один раз, ежедневно)
 */

const cron = require('node-cron');
const ExcelJS = require('exceljs');
const {
  reconcileStays,
  listVisibleStays,
  loadNotifyUserIds,
  logEvent,
  ymd,
  todayYmdMsk,
  addDays,
  ARRIVAL_OFFSET
} = require('../lib/mlsp-stay');
const { filterOutTestUsers, usersExcludeSql } = require('../lib/user-filters');

/** Письмо «Перевахтовка» — только пн и пт (MSK). Reconcile/push — ежедневно. */
function shouldSendDigestToday(now = new Date()) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', weekday: 'short' }).format(now);
  return wd === 'Mon' || wd === 'Fri';
}

let _task = null;

function start(db, log) {
  if (_task) return;
  _task = cron.schedule('5 8 * * *', () => {
    run(db, log).catch((e) => log.error('[mlsp-stay-cron] ' + (e && e.message)));
  }, { timezone: 'Europe/Moscow' });
  log.info('[mlsp-stay-cron] Started — daily 08:05 MSK (reconcile + worker push; digest Mon/Fri)');
}

function stop() {
  if (_task) { _task.stop(); _task = null; }
}

async function sendEmailSafe(db, log, payload) {
  try {
    const { sendCrmEmail } = require('./crm-mailer');
    await sendCrmEmail(db, null, payload);
  } catch (e) {
    log?.warn?.({ err: e }, '[mlsp-stay-cron] email failed');
  }
}

function transportRu(code) {
  if (code === 'ship') return 'судно';
  if (code === 'helicopter') return 'вертолёт';
  return '—';
}

function statusOf(stay) {
  if (stay.is_overdue || (stay.days_left != null && stay.days_left < 0)) return 'просрочен';
  if (stay.days_left != null && stay.days_left <= 7) return 'вывоз ≤7 дн';
  if (stay.days_left != null && stay.days_left <= 14) return 'вывоз ≤14 дн';
  return 'в норме';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(d) {
  const y = ymd(d);
  if (!y) return '—';
  const [Y, M, D] = y.split('-');
  return `${D}.${M}.${Y}`;
}

/** Получатели digest: Вика/Хосе/Данилова (settings) + РП по срезу; без массовой рассылки всем ТО */
async function resolveDigestRecipients(db, stays) {
  const fixedIds = await loadNotifyUserIds(db);
  const pmIds = [];
  for (const s of stays) {
    for (const w of (s.works || [])) {
      if (w.pm_id) pmIds.push(Number(w.pm_id));
    }
  }

  const { rows } = await db.query(`
    SELECT DISTINCT u.id, u.name, u.email, u.role, u.login
    FROM users u
    WHERE COALESCE(u.is_active, true) = true
      AND u.email IS NOT NULL AND TRIM(u.email) <> ''
      ${usersExcludeSql('u')}
      AND (
        u.id = ANY($1::int[])
        OR u.id = ANY($2::int[])
        OR u.name ILIKE '%Тумаева%'
        OR u.name ILIKE '%Данилова%'
        OR u.name ILIKE '%Хосе%'
      )
    ORDER BY u.name
  `, [fixedIds.length ? fixedIds : [0], pmIds.length ? pmIds : [0]]);

  const map = new Map();
  for (const u of filterOutTestUsers(rows)) {
    map.set(String(u.email).toLowerCase(), u);
  }
  return [...map.values()];
}

async function loadExtendInfo(db, stayIds) {
  if (!stayIds.length) return {};
  const { rows } = await db.query(`
    SELECT DISTINCT ON (stay_id)
      stay_id,
      payload->>'from' AS plan_before,
      payload->>'to' AS plan_after,
      payload->>'note' AS note
    FROM mlsp_stay_events
    WHERE stay_id = ANY($1::int[])
      AND event_type = 'extended'
    ORDER BY stay_id, id DESC
  `, [stayIds]);
  const out = {};
  for (const r of rows) out[r.stay_id] = r;
  return out;
}

function enrichExtend(stay, extMap) {
  const baseline = stay.arrived_at ? addDays(ymd(stay.arrived_at), ARRIVAL_OFFSET) : null;
  const planned = ymd(stay.planned_depart_at);
  const ev = extMap[stay.id];
  const hasNote = !!(stay.extend_note && String(stay.extend_note).trim());
  const shifted = baseline && planned && planned > baseline;
  const isExt = !!(ev || hasNote || shifted);
  return {
    is_extended: isExt,
    plan_before: ev?.plan_before || (shifted ? baseline : null),
    extend_comment: (ev?.note || stay.extend_note || '').trim() || '—'
  };
}

async function buildExcelBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Перевахтовка');
  ws.columns = [
    { header: '№', key: 'n', width: 5 },
    { header: 'ФИО', key: 'fio', width: 30 },
    { header: 'Проект (МЛСП)', key: 'project', width: 36 },
    { header: 'Дата заезда', key: 'arrived', width: 12 },
    { header: 'Дата выезда (план)', key: 'planned', width: 14 },
    { header: 'Дней на платформе', key: 'days_on', width: 12 },
    { header: 'Осталось дней', key: 'days_left', width: 11 },
    { header: 'Чем заезжал', key: 'inbound', width: 12 },
    { header: 'Чем выезжает', key: 'outbound', width: 12 },
    { header: 'Продление', key: 'ext', width: 10 },
    { header: 'План до продления', key: 'before', width: 14 },
    { header: 'Комментарий продления', key: 'note', width: 28 },
    { header: 'Статус', key: 'status', width: 13 },
    { header: 'РП / контакт', key: 'pm', width: 18 }
  ];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial', size: 10 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  header.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };

  rows.forEach((r, i) => {
    ws.addRow({
      n: i + 1,
      fio: r.fio,
      project: r.project,
      arrived: r.arrived,
      planned: r.planned,
      days_on: r.days_on,
      days_left: r.days_left,
      inbound: r.inbound,
      outbound: r.outbound,
      ext: r.ext,
      before: r.before,
      note: r.note,
      status: r.status,
      pm: r.pm
    });
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function buildHtml(today, digestRows, counts) {
  const rowsHtml = digestRows.map((r, i) => {
    const bg = r.status === 'просрочен' || r.status.startsWith('вывоз ≤7')
      ? '#FFEBEE'
      : (r.status.startsWith('вывоз ≤14') ? '#FFF8E1' : '#FFFFFF');
    const extCell = r.ext === 'да'
      ? `<td style="border:1px solid #ddd;background:#E3F2FD"><b>да</b>${r.before && r.before !== '—' ? ` (было ${esc(r.before)})` : ''}${r.note && r.note !== '—' ? `<br><span style="color:#555;font-size:11px">${esc(r.note)}</span>` : ''}</td>`
      : `<td style="border:1px solid #ddd">нет</td>`;
    return `<tr style="background:${bg}">
      <td style="border:1px solid #ddd">${i + 1}</td>
      <td style="border:1px solid #ddd">${esc(r.fio)}</td>
      <td style="border:1px solid #ddd">${esc(r.project)}</td>
      <td style="border:1px solid #ddd">${esc(r.arrived)}</td>
      <td style="border:1px solid #ddd">${esc(r.planned)}</td>
      <td style="border:1px solid #ddd">${r.days_on ?? '—'}</td>
      <td style="border:1px solid #ddd">${r.days_left ?? '—'}</td>
      <td style="border:1px solid #ddd">${esc(r.inbound)}</td>
      <td style="border:1px solid #ddd">${esc(r.outbound)}</td>
      ${extCell}
      <td style="border:1px solid #ddd"><b>${esc(r.status)}</b></td>
      <td style="border:1px solid #ddd">${esc(r.pm)}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:13px;color:#222">
<p>Добрый день.</p>
<p>Срез по вахте МЛСП на <b>${esc(fmtDate(today))}</b> (только у кого срок подходит).<br>
Итого в таблице: <b>${digestRows.length}</b> чел.
· просрочен: ${counts.over}
· ≤7 дн: ${counts.d7}
· ≤14 дн: ${counts.d14}
· с продлением: <b>${counts.ext}</b></p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:1200px">
<thead><tr style="background:#1F4E79;color:#fff;text-align:left">
<th style="border:1px solid #163A5A">#</th>
<th style="border:1px solid #163A5A">ФИО</th>
<th style="border:1px solid #163A5A">Проект</th>
<th style="border:1px solid #163A5A">Заезд</th>
<th style="border:1px solid #163A5A">Выезд (план)</th>
<th style="border:1px solid #163A5A">Дней</th>
<th style="border:1px solid #163A5A">Ост.</th>
<th style="border:1px solid #163A5A">Заезжал</th>
<th style="border:1px solid #163A5A">Выезжает</th>
<th style="border:1px solid #163A5A">Продление</th>
<th style="border:1px solid #163A5A">Статус</th>
<th style="border:1px solid #163A5A">РП</th>
</tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
<p style="color:#666;font-size:12px;margin-top:12px">Полный список — во вложении Excel.<br>— ASGARD CRM · перевахтовка</p>
</body></html>`;
}

function toDigestRow(stay, ext) {
  const works = stay.works || [];
  const project = works.map((w) => w.work_title).filter(Boolean).join('; ') || 'МЛСП';
  const pm = [...new Set(works.map((w) => w.pm_name).filter(Boolean))].join(', ') || '—';
  return {
    stay_id: stay.id,
    employee_id: stay.employee_id,
    fio: stay.fio || ('#' + stay.employee_id),
    project,
    arrived: fmtDate(stay.arrived_at),
    planned: fmtDate(stay.planned_depart_at),
    days_on: stay.days_on_platform,
    days_left: stay.days_left,
    inbound: transportRu(stay.inbound_transport),
    outbound: transportRu(stay.transport),
    ext: ext.is_extended ? 'да' : 'нет',
    before: ext.plan_before ? fmtDate(ext.plan_before) : '—',
    note: ext.extend_comment,
    status: statusOf(stay),
    pm
  };
}

async function sendPerevahtovkaDigest(db, log) {
  const today = todayYmdMsk();
  const open = await listVisibleStays(db, { seg: 'on_platform' });
  // только срок подходит
  const due = open.filter((s) =>
    s.is_open && s.days_left != null && (s.days_left <= 14 || s.is_overdue)
  );
  if (!due.length) {
    log.info('[mlsp-stay-cron] Перевахтовка: пустой срез — письмо не шлём');
    return { sent: false, count: 0 };
  }

  due.sort((a, b) => {
    const la = a.days_left ?? 999;
    const lb = b.days_left ?? 999;
    return la - lb;
  });

  const extMap = await loadExtendInfo(db, due.map((s) => s.id));
  const digestRows = due.map((s) => toDigestRow(s, enrichExtend(s, extMap)));

  const counts = {
    over: digestRows.filter((r) => r.status === 'просрочен').length,
    d7: digestRows.filter((r) => r.status === 'вывоз ≤7 дн').length,
    d14: digestRows.filter((r) => r.status === 'вывоз ≤14 дн').length,
    ext: digestRows.filter((r) => r.ext === 'да').length
  };

  const recipients = await resolveDigestRecipients(db, due);
  if (!recipients.length) {
    log.warn('[mlsp-stay-cron] Перевахтовка: нет получателей с email');
    return { sent: false, count: due.length, recipients: 0 };
  }

  const to = recipients.map((u) => u.email).join(', ');
  const subject = `Перевахтовка · МЛСП · срок подходит · ${fmtDate(today)} · ${due.length} чел.`;
  const text =
    `Срез по вахте МЛСП на ${fmtDate(today)} (только срок подходит).\n` +
    `Итого: ${due.length} · просрочен: ${counts.over} · ≤7: ${counts.d7} · ≤14: ${counts.d14} · продление: ${counts.ext}\n\n` +
    digestRows.map((r, i) =>
      `${i + 1}) ${r.fio} — план ${r.planned}, ост. ${r.days_left}, ${r.status}` +
      (r.ext === 'да' ? `, продление (было ${r.before})` : '') +
      `, ${r.project}`
    ).join('\n') +
    `\n\nПолный список — во вложении Excel.\n— ASGARD CRM · перевахтовка`;

  const html = buildHtml(today, digestRows, counts);
  const xlsx = await buildExcelBuffer(digestRows);
  const filename = `Perevahtovka_MLSP_${today}.xlsx`;

  await sendEmailSafe(db, log, {
    to,
    subject,
    text,
    html,
    attachments: [{
      filename,
      content: xlsx,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }]
  });

  // in-app всем получателям (одно уведомление)
  try {
    const { createNotification } = require('./notify');
    for (const u of recipients) {
      await createNotification(db, {
        user_id: u.id,
        title: subject,
        message: `${due.length} чел. на вывоз/просрочке. См. почту.`,
        type: 'mlsp_stay',
        link: '#/personnel?status=on_mlsp'
      });
    }
  } catch (_) { /* ignore */ }

  for (const s of due) {
    await logEvent(db, s.id, 'notify', {
      kind: 'perevahtovka_digest',
      days_left: s.days_left,
      recipients: recipients.map((u) => u.email)
    }, null);
  }

  log.info(`[mlsp-stay-cron] Перевахтовка sent to ${recipients.length}: ${due.length} rows`);
  return { sent: true, count: due.length, recipients: recipients.length };
}

/**
 * Office/field push goes through users via employees.user_id.
 * (users.employee_id does NOT exist — old query crashed every morning.)
 */
async function workerUserId(db, employeeId) {
  const { rows } = await db.query(
    `SELECT e.user_id AS id
     FROM employees e
     WHERE e.id = $1 AND e.user_id IS NOT NULL
     LIMIT 1`,
    [employeeId]
  );
  return rows[0]?.id || null;
}

/** Точечный push рабочему за ≤7 дней (один раз) */
async function runWorkerPushes(db, log) {
  const open = await listVisibleStays(db, { seg: 'on_platform' });
  let n7 = 0;
  for (const stay of open) {
    if (!stay.is_open || stay.days_left == null) continue;
    if (stay.days_left < 0 || stay.days_left > 7) continue;
    if (stay.notify_7_sent_at) continue;
    try {
      const uid = await workerUserId(db, stay.employee_id);
      if (uid) {
        const { createNotification } = require('./notify');
        await createNotification(db, {
          user_id: uid,
          title: 'Вывоз с МЛСП',
          message: `Вас планируют вывезти ${fmtDate(stay.planned_depart_at)}${stay.transport === 'helicopter' ? ' вертолётом' : stay.transport === 'ship' ? ' судном' : ''}.`,
          type: 'mlsp_stay',
          link: '/field'
        });
      } else {
        log?.info?.(
          `[mlsp-stay-cron] stay#${stay.id} emp#${stay.employee_id}: no employees.user_id — push skipped`
        );
      }
      await db.query(`UPDATE mlsp_stays SET notify_7_sent_at = NOW(), updated_at = NOW() WHERE id = $1`, [stay.id]);
      n7++;
    } catch (e) {
      log?.warn?.({ err: e }, `[mlsp-stay-cron] worker push fail stay#${stay.id}`);
    }
  }
  return n7;
}

async function runNotifies(db, log) {
  let digest;
  if (shouldSendDigestToday()) {
    digest = await sendPerevahtovkaDigest(db, log);
  } else {
    log.info('[mlsp-stay-cron] Перевахтовка: сегодня не пн/пт — digest пропущен');
    digest = { sent: false, skipped: true, count: 0 };
  }
  const n7 = await runWorkerPushes(db, log);
  log.info(`[mlsp-stay-cron] digest=${digest.sent ? 'yes' : (digest.skipped ? 'skip' : 'no')} rows=${digest.count || 0} worker7=${n7}`);
  return { digest, n7 };
}

async function run(db, log) {
  const rec = await reconcileStays(db, log);
  log.info(`[mlsp-stay-cron] reconcile opened=${rec.opened} autoDeparted=${rec.autoDeparted} splitClosed=${rec.splitClosed || 0}`);
  const n = await runNotifies(db, log);
  return { ...rec, ...n };
}

module.exports = {
  start,
  stop,
  run,
  runNotifies,
  sendPerevahtovkaDigest,
  resolveDigestRecipients,
  shouldSendDigestToday
};
