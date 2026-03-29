'use strict';

/**
 * ASGARD CRM — HTML email-шаблон для отчётов по звонкам
 * Терминология: сотрудник (НЕ менеджер), % целевых (НЕ конверсия)
 * Email — единственное место где допускаются инлайн-стили
 */

function generateReportEmail(report) {
  let stats = {};
  try { stats = typeof report.stats_json === 'string' ? JSON.parse(report.stats_json) : (report.stats_json || {}); } catch (_) {}
  let recs = [];
  try { recs = typeof report.recommendations_json === 'string' ? JSON.parse(report.recommendations_json) : (report.recommendations_json || []); } catch (_) {}

  const m = stats;
  const targetPct = m.targetPct || (m.totalCalls ? Math.round(m.targetCalls / m.totalCalls * 100) : 0);

  const employeesHtml = (m.byEmployee || m.byManager || []).slice(0, 5).map((emp, i) =>
    `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:6px 8px;font-size:13px;">${i + 1}</td>
      <td style="padding:6px 8px;font-size:13px;">${emp.name || '—'}</td>
      <td style="padding:6px 8px;text-align:center;font-size:13px;">${emp.total || 0}</td>
      <td style="padding:6px 8px;text-align:center;font-size:13px;">${emp.target || 0}</td>
      <td style="padding:6px 8px;text-align:center;font-size:13px;">${emp.missed || 0}</td>
    </tr>`
  ).join('');

  const recsHtml = recs.slice(0, 5).map(r =>
    `<li style="margin-bottom:6px;font-size:13px;color:#374151;">${r}</li>`
  ).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;">
  <tr><td style="background:linear-gradient(135deg,#1a2332,#0f1724);padding:24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:20px;">⚡ ASGARD CRM</h1>
    <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Отчёт по звонкам — ${report.title || ''}</p>
  </td></tr>
  <tr><td style="padding:16px;">
    <table width="100%" cellspacing="8" cellpadding="0"><tr>
      <td width="25%" style="background:#f8fafc;border-radius:8px;padding:12px;text-align:center;border-left:3px solid #3b82f6;">
        <div style="font-size:24px;font-weight:bold;color:#1e293b;">${m.totalCalls || 0}</div>
        <div style="font-size:11px;color:#64748b;">Всего звонков</div>
      </td>
      <td width="25%" style="background:#f8fafc;border-radius:8px;padding:12px;text-align:center;border-left:3px solid #22c55e;">
        <div style="font-size:24px;font-weight:bold;color:#1e293b;">${targetPct}%</div>
        <div style="font-size:11px;color:#64748b;">% целевых</div>
      </td>
      <td width="25%" style="background:#f8fafc;border-radius:8px;padding:12px;text-align:center;border-left:3px solid #ef4444;">
        <div style="font-size:24px;font-weight:bold;color:#1e293b;">${m.lostCalls || m.missedCalls || 0}</div>
        <div style="font-size:11px;color:#64748b;">Потеряно</div>
      </td>
      <td width="25%" style="background:#f8fafc;border-radius:8px;padding:12px;text-align:center;border-left:3px solid #f59e0b;">
        <div style="font-size:24px;font-weight:bold;color:#1e293b;">${m.avgQuality || '—'}</div>
        <div style="font-size:11px;color:#64748b;">Качество AI</div>
      </td>
    </tr></table>
  </td></tr>
  ${m.leadsCreated ? `<tr><td style="padding:0 16px 8px;">
    <div style="font-size:13px;color:#d97706;font-weight:bold;">📋 Заявки из звонков: ${m.leadsCreated} из ${m.totalCalls} (${m.totalCalls ? Math.round(m.leadsCreated / m.totalCalls * 100) : 0}%)</div>
  </td></tr>` : ''}
  ${report.summary_text ? `<tr><td style="padding:0 16px 16px;">
    <div style="font-size:13px;color:#374151;line-height:1.6;">${report.summary_text.slice(0, 800)}</div>
  </td></tr>` : ''}
  ${employeesHtml ? `<tr><td style="padding:0 16px 16px;">
    <h3 style="margin:0 0 8px;font-size:14px;color:#1e293b;">Активность по сотрудникам</h3>
    <table width="100%" style="border-collapse:collapse;">
      <tr style="background:#f1f5f9;"><th style="padding:8px;text-align:left;font-size:12px;">#</th><th style="padding:8px;text-align:left;font-size:12px;">Сотрудник</th><th style="padding:8px;text-align:center;font-size:12px;">Звонки</th><th style="padding:8px;text-align:center;font-size:12px;">Целевые</th><th style="padding:8px;text-align:center;font-size:12px;">Потеряно</th></tr>
      ${employeesHtml}
    </table>
  </td></tr>` : ''}
  ${recsHtml ? `<tr><td style="padding:0 16px 16px;">
    <h3 style="margin:0 0 8px;font-size:14px;color:#1e293b;">Рекомендации</h3>
    <ol style="margin:0;padding-left:18px;">${recsHtml}</ol>
  </td></tr>` : ''}
  <tr><td style="padding:16px;text-align:center;">
    <a href="https://asgard-crm.ru/#/telephony?tab=analytics&report=${report.id}"
       style="background:#3b82f6;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;font-size:14px;">
      Открыть полный отчёт в CRM
    </a>
  </td></tr>
  <tr><td style="padding:16px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;">
    ООО «Асгард Сервис» • ASGARD CRM
  </td></tr>
</table>
</body></html>`;
}

module.exports = { generateReportEmail };
