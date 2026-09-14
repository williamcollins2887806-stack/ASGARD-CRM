'use strict';

/**
 * HTML-письмо: еженедельный директорский дайджест (600px).
 * Только русский текст, без внутренних кодов (d30, inbox и т.п.).
 */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtShort(d) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  if (!y) return esc(s);
  return `${day}.${m}`;
}

function fmtPeriod(a, b) {
  return `${fmtShort(a)}–${fmtShort(b)}.${String(a).slice(0, 4)}`;
}

function tile(value, label, color) {
  return `<td width="20%" style="background:#f8fafc;border-radius:8px;padding:10px 6px;text-align:center;border-left:3px solid ${color};">
    <div style="font-size:22px;font-weight:bold;color:#1e293b;">${esc(value)}</div>
    <div style="font-size:10px;color:#64748b;line-height:1.3;">${esc(label)}</div>
  </td>`;
}

function sectionTitle(t) {
  return `<h3 style="margin:0 0 8px;font-size:14px;color:#1e293b;">${esc(t)}</h3>`;
}

function shortName(name) {
  const s = String(name || '').trim();
  if (!s) return '—';
  const parts = s.split(/\s+/);
  if (parts.length >= 2) return `${parts[0]} ${parts[1][0]}.`;
  return s;
}

function workTitleLine(w) {
  const rawTitle = String(w.work_title || '').trim();
  const customer = String(w.customer_name || '').trim();
  const objectName = String(w.object_name || '').trim();
  const isPlaceholder = !rawTitle
    || /^работа из заявки/i.test(rawTitle)
    || /^работа\s*#?\d+$/i.test(rawTitle);

  let main = isPlaceholder ? 'без названия' : rawTitle;
  if (main.length > 110) main = `${main.slice(0, 107)}…`;

  const subBits = [];
  if (customer) subBits.push(customer);
  if (objectName && objectName !== rawTitle) {
    const ob = objectName.length > 70 ? `${objectName.slice(0, 67)}…` : objectName;
    if (!subBits.some((b) => b.includes(ob.slice(0, 20)))) subBits.push(ob);
  }
  return { main, sub: subBits.join(' · ') };
}

const STAGE_RU = {
  new: 'новые',
  calc: 'расчёт',
  approval: 'согласование',
  kp_prep: 'коммерческое предложение',
  sent: 'отправлено',
  addendum: 'дозапрос'
};

function generatePmAnalysisWeeklyEmail(payload) {
  const k = payload.kpi || {};
  const previewBanner = payload.preview
    ? `<tr><td style="padding:10px 16px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:bold;">
        ПРОСМОТР — черновик письма для согласования, не штатная понедельничная рассылка
      </td></tr>`
    : '';

  const dutyHtml = (payload.duty || []).map((d) =>
    `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:8px;font-size:13px;"><strong>${esc(d.pm_name)}</strong><br>
        <span style="color:#64748b;font-size:11px;">смена ${fmtShort(d.period_start)}–${fmtShort(d.period_end)}</span></td>
      <td style="padding:8px;font-size:13px;text-align:center;">${d.closed || 0}<br>
        <span style="color:#64748b;font-size:11px;">${d.go || 0} «подаём» / ${d.reject || 0} отказ</span></td>
      <td style="padding:8px;font-size:13px;text-align:center;">${esc(d.grade_d30 || '—')}${d.score_d30 != null ? ` · ${d.score_d30}` : ''}</td>
    </tr>`
  ).join('') || `<tr><td colspan="3" style="padding:8px;font-size:13px;color:#64748b;">Нет смен дежурства за период</td></tr>`;

  const staleHtml = (payload.stale || []).slice(0, 5).map((s) => {
    const label = (s.customer_name && String(s.customer_name).trim())
      || (s.tender_title && String(s.tender_title).trim())
      || (`Тендер №${s.tender_id}`);
    return `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:6px 8px;font-size:12px;">${esc(label)}</td>
      <td style="padding:6px 8px;font-size:12px;">${esc(shortName(s.pm_name))}</td>
      <td style="padding:6px 8px;font-size:12px;color:#b91c1c;">${fmtShort(s.docs_deadline)}</td>
    </tr>`;
  }).join('');

  const worksList = (payload.works?.items || []).map((w) => {
    const { main, sub } = workTitleLine(w);
    const st = String(w.work_status || '');
    const color = st.toLowerCase() === 'в работе' ? '#16a34a'
      : st.toLowerCase().includes('пауз') ? '#d97706' : '#64748b';
    return `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:7px 8px;font-size:12px;">
        <div style="font-weight:600;color:#1e293b;">${esc(main)}</div>
        ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${esc(sub)}</div>` : ''}
      </td>
      <td style="padding:7px 8px;font-size:12px;color:${color};font-weight:600;">${esc(st)}</td>
      <td style="padding:7px 8px;font-size:12px;">${esc(shortName(w.pm_name))}</td>
    </tr>`;
  }).join('');

  const wc = payload.works?.counts || {};
  const worksShown = (payload.works?.items || []).length;
  const worksTotal = payload.works?.total || 0;
  const worksMore = worksTotal > worksShown
    ? `<div style="font-size:11px;color:#64748b;margin-top:6px;">ещё ${worksTotal - worksShown} активных — полный список в CRM</div>`
    : '';

  const mp = payload.marketplace || {};
  const kanbanPeople = (payload.kanban?.people || []).map((p) => {
    const bits = Object.entries(p.cols || {})
      .filter(([, n]) => n > 0)
      .map(([col, n]) => `${n} ${STAGE_RU[col] || col}`);
    return `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:7px 8px;font-size:12px;"><strong>${esc(shortName(p.pm_name))}</strong></td>
      <td style="padding:7px 8px;font-size:12px;text-align:center;">${p.total}</td>
      <td style="padding:7px 8px;font-size:11px;color:#64748b;">${esc(bits.join(', ') || '—')}</td>
    </tr>`;
  }).join('');

  const ratingHtml = (payload.ratingsTop || []).map((r, i) =>
    `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:6px 8px;font-size:12px;">${i + 1}</td>
      <td style="padding:6px 8px;font-size:12px;">${esc(r.name)}</td>
      <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:700;">${esc(r.grade_d30 || '')}</td>
      <td style="padding:6px 8px;font-size:12px;text-align:right;font-weight:700;">${r.score_d30 != null ? r.score_d30 : '—'}</td>
    </tr>`
  ).join('');

  const toRows = (payload.toActivity?.people || []).map((p) =>
    `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:6px 8px;font-size:12px;"><strong>${esc(shortName(p.name))}</strong></td>
      <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:700;">${p.created || 0}</td>
      <td style="padding:6px 8px;font-size:12px;text-align:center;">${p.submitted || 0}</td>
      <td style="padding:6px 8px;font-size:12px;text-align:center;">${p.cancelled || 0}</td>
      <td style="padding:6px 8px;font-size:12px;text-align:center;">${p.lost || 0}</td>
      <td style="padding:6px 8px;font-size:12px;text-align:center;color:#16a34a;font-weight:700;">${p.won || 0}</td>
    </tr>`
  ).join('');

  const crmRows = (payload.crmActivity?.people || []).map((p) =>
    `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:6px 8px;font-size:12px;"><strong>${esc(shortName(p.name))}</strong>
        <span style="color:#94a3b8;font-size:10px;"> · ${esc(roleRu(p.role))}</span></td>
      <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:700;">${p.hours != null ? p.hours : '—'}</td>
      <td style="padding:6px 8px;font-size:12px;text-align:center;">${p.visits || 0}</td>
    </tr>`
  ).join('');

  const nextDuty = payload.nextDuty || {};
  let nextDutyHtml;
  if (nextDuty.continuing) {
    nextDutyHtml = `<div style="margin-top:10px;padding:10px 12px;background:#ecfdf5;border-radius:8px;border-left:3px solid #059669;font-size:13px;color:#065f46;">
        <strong>Дежурство продолжается:</strong> ${esc(nextDuty.pm_name)}
        <span style="color:#047857;"> · до ${fmtShort(nextDuty.period_end)}</span>
        ${nextDuty.needs_successor
          ? `<div style="margin-top:6px;font-size:12px;color:#047857;">После ${fmtShort(nextDuty.period_end)} следующий в реестре не указан.</div>`
          : ''}
      </div>`;
  } else if (nextDuty.assigned) {
    nextDutyHtml = `<div style="margin-top:10px;padding:10px 12px;background:#ecfdf5;border-radius:8px;border-left:3px solid #059669;font-size:13px;color:#065f46;">
        <strong>Следующий дежурный:</strong> ${esc(nextDuty.pm_name)}
        <span style="color:#047857;"> · ${fmtShort(nextDuty.period_start)}–${fmtShort(nextDuty.period_end)}</span>
      </div>`;
  } else {
    nextDutyHtml = `<div style="margin-top:10px;padding:10px 12px;background:#fff7ed;border-radius:8px;border-left:3px solid #ea580c;font-size:13px;color:#9a3412;">
        <strong>Следующий дежурный не назначен</strong> — нужно указать смену в реестре дежурств.
      </div>`;
  }

  const othersClosers = (payload.analysisLeaders || []).filter((a) => !a.on_duty);
  const leadersBlock = othersClosers.length
    ? `<div style="margin-top:12px;">
      <div style="font-size:12px;color:#64748b;margin-bottom:6px;">Также закрывали анализ (вне дежурства):</div>
      <table width="100%" style="border-collapse:collapse;">
        <tr style="background:#f1f5f9;">
          <th style="padding:6px 8px;text-align:left;font-size:11px;">Кто</th>
          <th style="padding:6px 8px;text-align:center;font-size:11px;">Всего</th>
          <th style="padding:6px 8px;text-align:center;font-size:11px;">подаём / отказ</th>
        </tr>
        ${othersClosers.map((a) =>
          `<tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:6px 8px;font-size:12px;"><strong>${esc(shortName(a.name))}</strong></td>
            <td style="padding:6px 8px;font-size:12px;text-align:center;font-weight:700;">${a.closed || 0}</td>
            <td style="padding:6px 8px;font-size:11px;text-align:center;color:#64748b;">${a.go || 0} / ${a.reject || 0}</td>
          </tr>`
        ).join('')}
      </table>
    </div>`
    : '';

  const recs = (payload.recommendations || []).map((t) =>
    `<li style="margin-bottom:6px;font-size:13px;color:#374151;">${esc(t)}</li>`
  ).join('');

  const headline = payload.title
    || (payload.kind === 'monthly' ? 'Месячный дайджест' : 'Еженедельный дайджест');

  const crmHoursLabel = (payload.crmActivity?.tracked) ? 'Часов в CRM' : 'Часов';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;">
  <tr><td style="background:linear-gradient(135deg,#1a2332,#0f1724);padding:24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:20px;">ASGARD CRM</h1>
    <p style="color:#e2e8f0;margin:6px 0 2px;font-size:16px;font-weight:bold;">${esc(headline)}</p>
    <p style="color:#94a3b8;margin:0;font-size:13px;">${fmtPeriod(payload.weekStart, payload.weekEnd)}</p>
  </td></tr>
  ${previewBanner}
  <tr><td style="padding:16px 16px 8px;">
    <div style="font-size:13px;color:#374151;line-height:1.55;background:#f8fafc;border-radius:8px;padding:12px;border-left:3px solid #c8a84e;">
      <strong style="color:#1e293b;">Мимир:</strong> ${esc(payload.verdict || '')}
    </div>
  </td></tr>
  <tr><td style="padding:8px 16px 4px;">
    <table width="100%" cellspacing="6" cellpadding="0"><tr>
      ${tile(k.taken || 0, 'Закрыто анализов', '#3b82f6')}
      ${tile(k.go || 0, 'Решение: подаём', '#22c55e')}
      ${tile(k.reject || 0, 'Решение: не подаём', '#f59e0b')}
      ${tile(k.submitted || 0, 'В реестре: подались', '#8b5cf6')}
      ${tile(k.cancelled || 0, 'В реестре: отмена', '#ef4444')}
    </tr></table>
    <div style="font-size:11px;color:#64748b;line-height:1.45;padding:4px 6px 12px;">
      «Подаём / не подаём» — решение по анализу тендера.<br>
      «Подались / отмена» — уже статус в реестре (подача документов или снятие).
    </div>
  </td></tr>

  <tr><td style="padding:0 16px 16px;">
    ${sectionTitle('1. Дежурство и анализ тендеров')}
    <table width="100%" style="border-collapse:collapse;">
      <tr style="background:#f1f5f9;">
        <th style="padding:8px;text-align:left;font-size:11px;">Дежурный</th>
        <th style="padding:8px;text-align:center;font-size:11px;">Закрыто им за период</th>
        <th style="padding:8px;text-align:center;font-size:11px;">Оценка за 30 дней</th>
      </tr>
      ${dutyHtml}
    </table>
    ${nextDutyHtml}
    ${leadersBlock}
    ${staleHtml ? `<div style="margin-top:12px;">${sectionTitle('Риски: нет движения или дедлайн ≤ 2 дней')}
      <table width="100%" style="border-collapse:collapse;">
        <tr style="background:#fef2f2;">
          <th style="padding:6px 8px;text-align:left;font-size:11px;">Клиент / тендер</th>
          <th style="padding:6px 8px;text-align:left;font-size:11px;">Ответственный</th>
          <th style="padding:6px 8px;text-align:left;font-size:11px;">Дедлайн</th>
        </tr>${staleHtml}
      </table>
      ${(payload.staleTotal || 0) > 5 ? `<div style="font-size:11px;color:#64748b;margin-top:4px;">ещё ${payload.staleTotal - 5}…</div>` : ''}
    </div>` : ''}
  </td></tr>

  <tr><td style="padding:0 16px 16px;">
    ${sectionTitle('2. Активные работы сейчас')}
    <div style="font-size:12px;color:#64748b;margin-bottom:8px;">
      Всего активных: <strong style="color:#1e293b;">${worksTotal}</strong>
      (подготовка / новая <strong style="color:#1e293b;">${wc.prep || 0}</strong> ·
      в работе <strong style="color:#16a34a;">${wc.in_work || 0}</strong> ·
      пауза / акт <strong style="color:#d97706;">${wc.pause || 0}</strong>)
    </div>
    <table width="100%" style="border-collapse:collapse;">
      <tr style="background:#f1f5f9;">
        <th style="padding:7px 8px;text-align:left;font-size:11px;">Работа</th>
        <th style="padding:7px 8px;text-align:left;font-size:11px;">Статус</th>
        <th style="padding:7px 8px;text-align:left;font-size:11px;">Руководитель</th>
      </tr>
      ${worksList || `<tr><td colspan="3" style="padding:8px;font-size:12px;color:#64748b;">Нет активных работ</td></tr>`}
    </table>
    ${worksMore}
  </td></tr>

  <tr><td style="padding:0 16px 16px;">
    ${sectionTitle('3. Заявки: свободные и в работе')}
    <div style="font-size:13px;margin-bottom:8px;color:#374151;line-height:1.5;">
      Без назначенного руководителя: <strong>${mp.free_total || 0}</strong>
      <span style="color:#64748b;font-size:11px;">
        (из почты ${mp.inbox_free || 0} · предтендерные ${mp.pretender_free || 0})
      </span><br>
      Уже взяты в работу руководителями: <strong>${payload.kanban?.total || 0}</strong>
    </div>
    <table width="100%" style="border-collapse:collapse;">
      <tr style="background:#f1f5f9;">
        <th style="padding:7px 8px;text-align:left;font-size:11px;">Руководитель</th>
        <th style="padding:7px 8px;text-align:center;font-size:11px;">Заявок</th>
        <th style="padding:7px 8px;text-align:left;font-size:11px;">По этапам</th>
      </tr>
      ${kanbanPeople || `<tr><td colspan="3" style="padding:8px;font-size:12px;color:#64748b;">Нет открытых заявок</td></tr>`}
    </table>
  </td></tr>

  <tr><td style="padding:0 16px 16px;">
    ${sectionTitle('4. Тендерный отдел — внесение и статусы')}
    <div style="font-size:11px;color:#64748b;line-height:1.45;margin-bottom:8px;">
      ${esc(payload.toActivity?.note || '')}
    </div>
    <table width="100%" style="border-collapse:collapse;">
      <tr style="background:#f1f5f9;">
        <th style="padding:6px 4px;text-align:left;font-size:10px;">ТО</th>
        <th style="padding:6px 4px;text-align:center;font-size:10px;">Внёс</th>
        <th style="padding:6px 4px;text-align:center;font-size:10px;">Подались</th>
        <th style="padding:6px 4px;text-align:center;font-size:10px;">Отмена</th>
        <th style="padding:6px 4px;text-align:center;font-size:10px;">Проиграли</th>
        <th style="padding:6px 4px;text-align:center;font-size:10px;">Выиграли</th>
      </tr>
      ${toRows || `<tr><td colspan="6" style="padding:8px;font-size:12px;color:#64748b;">Нет данных по ТО</td></tr>`}
    </table>
  </td></tr>

  <tr><td style="padding:0 16px 16px;">
    ${sectionTitle('Рейтинг анализа тендеров за 30 дней — топ-5')}
    <table width="100%" style="border-collapse:collapse;">
      <tr style="background:#f1f5f9;">
        <th style="padding:6px 8px;text-align:left;font-size:11px;">№</th>
        <th style="padding:6px 8px;text-align:left;font-size:11px;">Руководитель</th>
        <th style="padding:6px 8px;text-align:center;font-size:11px;">Оценка</th>
        <th style="padding:6px 8px;text-align:right;font-size:11px;">Баллы</th>
      </tr>
      ${ratingHtml || `<tr><td colspan="4" style="padding:8px;font-size:12px;color:#64748b;">Нет данных рейтинга</td></tr>`}
    </table>
  </td></tr>

  ${recs ? `<tr><td style="padding:0 16px 16px;">
    ${sectionTitle('Рекомендации Мимира')}
    <ol style="margin:0;padding-left:18px;">${recs}</ol>
  </td></tr>` : ''}

  <tr><td style="padding:0 16px 16px;">
    ${sectionTitle('5. Приложение рабочих')}
    <div style="font-size:11px;color:#64748b;line-height:1.45;margin-bottom:8px;">
      ${esc(payload.fieldApp?.note || '')}
    </div>
    <table width="100%" cellspacing="6" cellpadding="0"><tr>
      ${tile(payload.fieldApp?.total_users || 0, 'Аккаунтов рабочих', '#0ea5e9')}
      ${tile(payload.fieldApp?.active_users || 0, 'Заходили за период', '#16a34a')}
      ${tile(payload.fieldApp?.new_users || 0, 'Новых аккаунтов', '#ca8a04')}
    </tr></table>
  </td></tr>

  <tr><td style="padding:0 16px 16px;">
    ${sectionTitle('6. Активность в CRM')}
    <div style="font-size:11px;color:#64748b;line-height:1.45;margin-bottom:8px;">
      ${esc(payload.crmActivity?.note || '')}
    </div>
    <table width="100%" style="border-collapse:collapse;">
      <tr style="background:#f1f5f9;">
        <th style="padding:6px 8px;text-align:left;font-size:11px;">Сотрудник</th>
        <th style="padding:6px 8px;text-align:center;font-size:11px;">${esc(crmHoursLabel)}</th>
        <th style="padding:6px 8px;text-align:center;font-size:11px;">Дней</th>
      </tr>
      ${crmRows || `<tr><td colspan="3" style="padding:8px;font-size:12px;color:#64748b;">Нет данных активности</td></tr>`}
    </table>
  </td></tr>

  <tr><td style="padding:16px;text-align:center;">
    <a href="https://asgard-crm.ru/#/pm-calculations" style="background:#3b82f6;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;font-size:12px;margin:4px;">Анализ тендеров</a>
    <a href="https://asgard-crm.ru/#/director-inbox" style="background:#1e293b;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;font-size:12px;margin:4px;">Свободные заявки</a>
    <a href="https://asgard-crm.ru/#/pm-works" style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;font-size:12px;margin:4px;">Работы</a>
  </td></tr>
  <tr><td style="padding:16px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;">
    ООО «Асгард Сервис» • ASGARD CRM
  </td></tr>
</table>
</body></html>`;
}

function roleRu(role) {
  const map = {
    PM: 'руководитель проекта',
    HEAD_PM: 'руководитель РП',
    TO: 'тендерный отдел',
    HEAD_TO: 'руководитель ТО',
    DIRECTOR_GEN: 'директор',
    DIRECTOR_COMM: 'директор',
    DIRECTOR_DEV: 'директор',
    BUH: 'бухгалтерия',
    PROC: 'снабжение',
    HR: 'кадры',
    HR_MANAGER: 'кадры',
    OFFICE_MANAGER: 'офис-менеджер',
    CHIEF_ENGINEER: 'главный инженер',
    WAREHOUSE: 'кладовщик',
    FIELD_WORKER: 'рабочий'
  };
  return map[role] || role || '';
}

module.exports = { generatePmAnalysisWeeklyEmail };
