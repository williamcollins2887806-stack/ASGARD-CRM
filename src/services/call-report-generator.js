'use strict';

/**
 * ASGARD CRM — Генератор отчётов по звонкам
 * Агрегирует данные из call_history и генерирует AI-отчёт
 */

const { getCallReportPrompt } = require('../prompts/call-report-prompt');

class CallReportGenerator {
  constructor(db, aiProvider) {
    this.db = db;
    this.aiProvider = aiProvider;
  }

  /**
   * Генерация отчёта
   * @param {'daily'|'weekly'|'monthly'} reportType
   * @param {string} dateFrom — YYYY-MM-DD
   * @param {string} dateTo — YYYY-MM-DD
   * @param {number|null} requestedBy — user_id запросившего
   * @returns {Object} — сохранённый отчёт
   */
  async generate(reportType, dateFrom, dateTo, requestedBy = null) {
    const db = this.db;

    // 1. Общая статистика
    const totalsRes = await db.query(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE ai_is_target = true) as target_calls,
        COUNT(*) FILTER (WHERE call_type = 'inbound' AND duration_seconds < 5) as missed_calls,
        AVG(duration_seconds) FILTER (WHERE duration_seconds > 0) as avg_duration
      FROM call_history
      WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')
    `, [dateFrom, dateTo]);
    const totals = totalsRes.rows[0];

    // 2. По менеджерам
    const byManagerRes = await db.query(`
      SELECT
        u.name,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ch.ai_is_target = true) as target,
        COUNT(*) FILTER (WHERE ch.call_type = 'inbound' AND ch.duration_seconds < 5) as missed,
        AVG(ch.duration_seconds) FILTER (WHERE ch.duration_seconds > 0) as avg_duration
      FROM call_history ch
      LEFT JOIN users u ON ch.user_id = u.id
      WHERE ch.created_at >= $1::date AND ch.created_at < ($2::date + INTERVAL '1 day')
      GROUP BY u.name
      ORDER BY total DESC
      LIMIT 20
    `, [dateFrom, dateTo]);

    // 3. По типам
    const byTypeRes = await db.query(`
      SELECT call_type, COUNT(*) as count
      FROM call_history
      WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')
      GROUP BY call_type
    `, [dateFrom, dateTo]);

    // 4. Топ клиентов (из ai_lead_data)
    const topClientsRes = await db.query(`
      SELECT
        COALESCE(ai_lead_data->>'company_name', from_number) as company,
        COUNT(*) as calls
      FROM call_history
      WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')
        AND ai_is_target = true
      GROUP BY COALESCE(ai_lead_data->>'company_name', from_number)
      ORDER BY calls DESC
      LIMIT 10
    `, [dateFrom, dateTo]);

    // 5. Формируем промпт и вызываем AI
    const reportData = {
      reportType,
      periodFrom: dateFrom,
      periodTo: dateTo,
      totalCalls: parseInt(totals.total_calls) || 0,
      targetCalls: parseInt(totals.target_calls) || 0,
      missedCalls: parseInt(totals.missed_calls) || 0,
      avgDuration: parseFloat(totals.avg_duration) || 0,
      byManager: byManagerRes.rows.map(r => ({
        name: r.name || 'Неизвестный',
        total: parseInt(r.total),
        target: parseInt(r.target),
        missed: parseInt(r.missed),
        avg_duration: parseFloat(r.avg_duration) || 0
      })),
      byType: byTypeRes.rows.map(r => ({ call_type: r.call_type, count: parseInt(r.count) })),
      topClients: topClientsRes.rows.map(r => ({ company: r.company, calls: parseInt(r.calls) }))
    };

    const systemPrompt = getCallReportPrompt(reportData);

    let summaryText = '';
    let recommendations = [];
    let statsJson = reportData;
    let title = `Отчёт по звонкам за ${dateFrom} — ${dateTo}`;
    let insights = [];
    let attentionItems = [];
    let parsed = {};

    if (this.aiProvider) {
      try {
        const completeFn = this.aiProvider.completeAnalytics || this.aiProvider.complete || this.aiProvider;
        const aiResult = await completeFn({
          system: systemPrompt,
          messages: [{ role: 'user', content: 'Сгенерируй отчёт на основе предоставленных данных.' }],
          maxTokens: 2500,
          temperature: 0.3
        });

        const text = aiResult.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
          title = parsed.title || title;
          summaryText = parsed.summary || text;
          recommendations = parsed.recommendations || [];
          insights = parsed.insights || [];
          attentionItems = parsed.attention_items || [];
          if (parsed.highlights) {
            statsJson = { ...reportData, highlights: parsed.highlights };
          }
          if (parsed.manager_highlights) {
            statsJson = { ...statsJson, manager_highlights: parsed.manager_highlights };
          }
        } else {
          summaryText = text;
        }
      } catch (aiErr) {
        console.error('[CallReportGenerator] AI error:', aiErr.message);
        summaryText = `Автоматический отчёт: ${reportData.totalCalls} звонков, ${reportData.targetCalls} целевых, ${reportData.missedCalls} пропущенных.`;
      }
    } else {
      summaryText = `Всего звонков: ${reportData.totalCalls}. Целевых: ${reportData.targetCalls}. Пропущенных: ${reportData.missedCalls}. Средняя длительность: ${Math.round(reportData.avgDuration)} сек.`;
    }

    // Генерируем WOW HTML для модалки
    const reportHtml = this._buildReportHtml(reportData, parsed);

    // 6. Сохраняем в БД
    const insertRes = await db.query(`
      INSERT INTO call_reports (
        report_type, period_from, period_to, title, summary_text,
        stats_json, recommendations_json, generated_by, requested_by,
        report_html, metrics, insights, attention_items
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      reportType, dateFrom, dateTo, title, summaryText,
      JSON.stringify(statsJson), JSON.stringify(recommendations),
      requestedBy ? 'manual' : 'system', requestedBy,
      reportHtml, JSON.stringify(reportData),
      JSON.stringify(insights), JSON.stringify(attentionItems)
    ]);

    return insertRes.rows[0];
  }

  _buildReportHtml(data, aiResult) {
    const m = data;
    const insights = aiResult.insights || [];
    const recs = aiResult.recommendations || [];
    const managers = (m.byManager || []).slice(0, 10);
    const maxCalls = Math.max(...managers.map(mg => mg.total || 0), 1);

    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `<div class="cr-detail">
  <div class="cr-metrics" style="margin-bottom:20px">
    ${[
      { icon: '\uD83D\uDCDE', value: m.totalCalls, label: 'Звонков', cls: 'total' },
      { icon: '\uD83C\uDFAF', value: m.targetCalls, label: 'Целевых', cls: 'target' },
      { icon: '\u274C', value: m.missedCalls, label: 'Пропущ.', cls: 'missed' },
      { icon: '\u23F1', value: Math.round(m.avgDuration || 0) + 'с', label: 'Средняя', cls: 'duration' }
    ].map(c => `
      <div class="cr-metric">
        <div class="cr-metric__icon cr-metric__icon--${c.cls}">${c.icon}</div>
        <div class="cr-metric__value">${c.value || 0}</div>
        <div class="cr-metric__label">${c.label}</div>
      </div>
    `).join('')}
  </div>

  ${insights.length ? `
  <div style="margin-bottom:20px">
    <div style="font-size:14px;font-weight:600;color:var(--t1);margin-bottom:10px">\u26A0\uFE0F Обратите внимание</div>
    ${insights.map(ins => {
      const borderColor = ins.priority === 'critical' ? 'var(--err-t)' : ins.priority === 'high' ? '#f59e0b' : 'var(--ok-t)';
      const icons = { critical: '\uD83D\uDD34', high: '\uD83D\uDFE1', medium: '\uD83D\uDFE2' };
      return `
      <div style="border-left:3px solid ${borderColor};padding:10px 14px;margin-bottom:8px;border-radius:0 8px 8px 0;background:var(--bg3)">
        <div style="font-size:13px;font-weight:600;color:var(--t1)">${icons[ins.priority] || '\u26AA'} ${esc(ins.title)}</div>
        <div style="font-size:12px;color:var(--t2);margin-top:4px">${esc(ins.description)}</div>
        ${ins.recommendation ? `<div style="font-size:12px;color:var(--gold);margin-top:4px">\uD83D\uDCA1 ${esc(ins.recommendation)}</div>` : ''}
      </div>`;
    }).join('')}
  </div>` : ''}

  <div style="font-size:13px;color:var(--t2);line-height:1.7;margin-bottom:20px;white-space:pre-wrap">${esc(aiResult.summary || '')}</div>

  ${managers.length ? `
  <div style="margin-bottom:20px">
    <div style="font-size:14px;font-weight:600;color:var(--t1);margin-bottom:10px">\uD83D\uDC65 Менеджеры</div>
    <table class="cr-managers__table">
      <thead><tr><th>#</th><th>Менеджер</th><th style="text-align:center">Звонки</th><th style="text-align:center">Целевые</th><th>Прогресс</th></tr></thead>
      <tbody>
      ${managers.map((mg, i) => {
        const pct = Math.round(((mg.total || 0) / maxCalls) * 100);
        const barCls = pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'low';
        return `<tr>
          <td><span class="cr-managers__rank${i < 3 ? ' cr-managers__rank--' + (i+1) : ''}">${i+1}</span></td>
          <td>${esc(mg.name)}</td>
          <td style="text-align:center">${mg.total || 0}</td>
          <td style="text-align:center">${mg.target || 0}</td>
          <td><div class="cr-managers__bar"><div class="cr-managers__bar-fill cr-managers__bar-fill--${barCls}" style="width:${pct}%"></div></div></td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
  </div>` : ''}

  ${recs.length ? `
  <div>
    <div style="font-size:14px;font-weight:600;color:var(--t1);margin-bottom:10px">\uD83D\uDCCB Рекомендации</div>
    <ol style="margin:0;padding-left:20px">
      ${recs.map(r => `<li style="font-size:13px;color:var(--t2);padding:3px 0;line-height:1.6">${esc(r)}</li>`).join('')}
    </ol>
  </div>` : ''}
</div>`;
  }
}

module.exports = CallReportGenerator;
