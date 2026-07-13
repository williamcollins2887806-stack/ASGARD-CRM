'use strict';

/**
 * ASGARD CRM — Генератор отчётов по звонкам
 * Терминология: сотрудник (НЕ менеджер), % целевых (НЕ конверсия)
 */

const { getCallReportPrompt } = require('../prompts/call-report-prompt');
const { parseStrictJson } = require('./mimir-conductor/agents/_util');

const AI_STRICT_SUFFIX =
  '\n\nКРИТИЧНО: верни ТОЛЬКО валидный JSON-объект. Без markdown (```), без комментариев, без trailing comma. ' +
  'Все ключи и строки в двойных кавычках. Массивы и объекты должны быть полностью закрыты.';

const AI_REPAIR_PROMPT =
  'Тебе дали ТЕКСТ от другой модели, который ДОЛЖЕН был быть валидным JSON-объектом, ' +
  'но содержит ошибки парсинга (битые кавычки, незакрытые скобки, trailing comma, преамбулы, markdown). ' +
  'Твоя задача — вернуть ТОЛЬКО валидный JSON-объект, исправив ошибки. ' +
  'Ничего не комментируй. Не оборачивай в ```. Сохрани все смысловые данные.';

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

    // 1. Общая статистика (новые метрики)
    const totalsRes = await db.query(`
      SELECT
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE ai_is_target = true) as target_calls,
        ROUND(COUNT(*) FILTER (WHERE ai_is_target = true)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as target_pct,
        COUNT(*) FILTER (WHERE call_type = 'missed' AND COALESCE(missed_acknowledged, false) = false AND missed_callback_at IS NULL) as lost_calls,
        ROUND(AVG(COALESCE(ai_quality_score, (ai_lead_data->>'quality_score')::int))
          FILTER (WHERE ai_quality_score IS NOT NULL OR ai_lead_data->>'quality_score' IS NOT NULL), 1) as avg_quality,
        COUNT(*) FILTER (WHERE lead_id IS NOT NULL) as leads_created,
        AVG(duration_seconds) FILTER (WHERE duration_seconds > 0) as avg_duration
      FROM call_history
      WHERE created_at >= $1::date AND created_at < ($2::date + INTERVAL '1 day')
    `, [dateFrom, dateTo]);
    const totals = totalsRes.rows[0];

    // 2. По сотрудникам
    const byEmployeeRes = await db.query(`
      SELECT
        COALESCE(u.name, u2.name) as name,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ch.ai_is_target = true) as target,
        COUNT(*) FILTER (WHERE ch.call_type = 'missed' AND COALESCE(ch.missed_acknowledged, false) = false AND ch.missed_callback_at IS NULL) as missed,
        AVG(ch.duration_seconds) FILTER (WHERE ch.duration_seconds > 0) as avg_duration
      FROM call_history ch
      LEFT JOIN users u ON ch.user_id = u.id
      LEFT JOIN users u2 ON u.id IS NULL AND u2.is_active = true
        AND replace(replace(COALESCE(u2.phone,''), '+', ''), '-', '') LIKE '%' ||
            RIGHT(replace(replace(
              CASE WHEN ch.direction = 'inbound' THEN ch.to_number ELSE ch.from_number END,
            '+', ''), '-', ''), 10)
      WHERE ch.created_at >= $1::date AND ch.created_at < ($2::date + INTERVAL '1 day')
      GROUP BY ch.user_id, u.name, u2.name
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

    // 5. Формируем данные для промпта
    const reportData = {
      reportType,
      periodFrom: dateFrom,
      periodTo: dateTo,
      totalCalls: parseInt(totals.total_calls) || 0,
      targetCalls: parseInt(totals.target_calls) || 0,
      targetPct: parseFloat(totals.target_pct) || 0,
      lostCalls: parseInt(totals.lost_calls) || 0,
      avgQuality: parseFloat(totals.avg_quality) || 0,
      leadsCreated: parseInt(totals.leads_created) || 0,
      avgDuration: parseFloat(totals.avg_duration) || 0,
      byEmployee: byEmployeeRes.rows.map(r => ({
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
        parsed = await this._generateAiParsed(systemPrompt);
        title = parsed.title || title;
        summaryText = parsed.summary || summaryText;
        recommendations = parsed.recommendations || [];
        insights = parsed.insights || [];
        attentionItems = parsed.attention_items || [];
        if (parsed.highlights) {
          statsJson = { ...reportData, highlights: parsed.highlights };
        }
        if (parsed.employee_highlights) {
          statsJson = { ...statsJson, employee_highlights: parsed.employee_highlights };
        }
      } catch (aiErr) {
        console.error('[CallReportGenerator] AI error (all retries failed):', aiErr.message);
        summaryText = `Автоматический отчёт: ${reportData.totalCalls} звонков, ${reportData.targetCalls} целевых, ${reportData.lostCalls} потеряно без ответа.`;
      }
    } else {
      const m = reportData;
      summaryText = `Всего звонков: ${m.totalCalls}. Целевых: ${m.targetCalls} (${m.targetPct}%). Потеряно без ответа: ${m.lostCalls}. Качество (AI): ${m.avgQuality || '—'}. Заявки из звонков: ${m.leadsCreated}.`;
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

  /**
   * AI-генерация отчёта: json_object + 3 retry + haiku-repair.
   * @param {string} systemPrompt
   * @returns {Promise<Object>}
   */
  async _generateAiParsed(systemPrompt) {
    const completeFn = this.aiProvider.completeAnalytics || this.aiProvider.complete;
    if (typeof completeFn !== 'function') {
      throw new Error('AI provider has no complete() method');
    }

    const userMsg = 'Сгенерируй отчёт на основе предоставленных данных.';
    let lastRaw = '';
    let lastErr = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const aiResult = await completeFn({
          system: attempt === 1 ? systemPrompt : systemPrompt + AI_STRICT_SUFFIX,
          messages: [{ role: 'user', content: userMsg }],
          maxTokens: 3500,
          temperature: attempt === 1 ? 0.25 : 0,
          responseFormat: { type: 'json_object' }
        });
        lastRaw = aiResult.text || '';
        const parsed = parseStrictJson(lastRaw);
        if (attempt > 1) {
          console.log(`[CallReportGenerator] AI JSON parsed on attempt ${attempt}`);
        }
        return parsed;
      } catch (err) {
        lastErr = err;
        console.warn(`[CallReportGenerator] AI attempt ${attempt}/3 failed: ${err.message}`);
      }
    }

    if (lastRaw) {
      try {
        console.log('[CallReportGenerator] Trying haiku JSON repair...');
        const repairFn = this.aiProvider.complete || this.aiProvider.completeAnalytics;
        const repaired = await repairFn({
          system: AI_REPAIR_PROMPT,
          messages: [{ role: 'user', content: `БИТЫЙ ТЕКСТ:\n${lastRaw.slice(0, 60000)}\n\nВЕРНИ ВАЛИДНЫЙ JSON:` }],
          model: 'haiku-4-5',
          maxTokens: 8000,
          temperature: 0,
          responseFormat: { type: 'json_object' }
        });
        if (repaired._stub) throw new Error('stub mode');
        const parsed = parseStrictJson(repaired.text || '');
        console.log('[CallReportGenerator] AI JSON repaired via haiku');
        return parsed;
      } catch (repairErr) {
        console.warn(`[CallReportGenerator] Haiku repair failed: ${repairErr.message}`);
      }
    }

    throw lastErr || new Error('AI report generation failed');
  }

  _buildReportHtml(data, aiResult) {
    const m = data;
    const insights = aiResult.insights || [];
    const recs = aiResult.recommendations || [];
    const employees = (m.byEmployee || []).slice(0, 10);
    const maxCalls = Math.max(...employees.map(e => e.total || 0), 1);

    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `<div class="cr-detail">
  <div class="cr-metrics" style="margin-bottom:20px">
    ${[
      { icon: '\uD83D\uDCDE', value: m.totalCalls, label: 'Звонков', cls: 'total' },
      { icon: '\uD83C\uDFAF', value: m.targetPct ? m.targetPct + '%' : (m.targetCalls || 0), label: '% целевых', cls: 'target' },
      { icon: '\u274C', value: m.lostCalls || 0, label: 'Потеряно', cls: 'missed' },
      { icon: '\u2B50', value: m.avgQuality || '\u2014', label: 'Качество AI', cls: 'duration' }
    ].map(c => `
      <div class="cr-metric">
        <div class="cr-metric__icon cr-metric__icon--${c.cls}">${c.icon}</div>
        <div class="cr-metric__value">${c.value}</div>
        <div class="cr-metric__label">${c.label}</div>
      </div>
    `).join('')}
  </div>

  ${m.leadsCreated ? `<div style="font-size:13px;color:var(--gold);margin-bottom:16px">\uD83D\uDCCB Заявки из звонков: ${m.leadsCreated} из ${m.totalCalls} (${m.totalCalls ? Math.round(m.leadsCreated / m.totalCalls * 100) : 0}%)</div>` : ''}

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

  ${employees.length ? `
  <div style="margin-bottom:20px">
    <div style="font-size:14px;font-weight:600;color:var(--t1);margin-bottom:10px">\uD83D\uDC65 Активность по сотрудникам</div>
    <table class="cr-employees__table">
      <thead><tr><th>#</th><th>Сотрудник</th><th style="text-align:center">Звонки</th><th style="text-align:center">Целевые</th><th>Прогресс</th></tr></thead>
      <tbody>
      ${employees.map((e, i) => {
        const pct = Math.round(((e.total || 0) / maxCalls) * 100);
        const barCls = pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'low';
        return `<tr>
          <td><span class="cr-employees__rank${i < 3 ? ' cr-employees__rank--' + (i+1) : ''}">${i+1}</span></td>
          <td>${esc(e.name)}</td>
          <td style="text-align:center">${e.total || 0}</td>
          <td style="text-align:center">${e.target || 0}</td>
          <td><div class="cr-employees__bar"><div class="cr-employees__bar-fill cr-employees__bar-fill--${barCls}" style="width:${pct}%"></div></div></td>
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
