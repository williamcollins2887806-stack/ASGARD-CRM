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

    if (this.aiProvider) {
      try {
        const completeFn = this.aiProvider.completeAnalytics || this.aiProvider.complete || this.aiProvider;
        const aiResult = await completeFn({
          system: systemPrompt,
          messages: [{ role: 'user', content: 'Сгенерируй отчёт на основе предоставленных данных.' }],
          maxTokens: 2000,
          temperature: 0.3
        });

        const text = aiResult.text || '';
        // Извлекаем JSON из ответа
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          title = parsed.title || title;
          summaryText = parsed.summary || text;
          recommendations = parsed.recommendations || [];
          if (parsed.highlights) {
            statsJson = { ...reportData, highlights: parsed.highlights };
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

    // 6. Сохраняем в БД
    const insertRes = await db.query(`
      INSERT INTO call_reports (report_type, period_from, period_to, title, summary_text, stats_json, recommendations_json, generated_by, requested_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      reportType, dateFrom, dateTo, title, summaryText,
      JSON.stringify(statsJson), JSON.stringify(recommendations),
      requestedBy ? 'manual' : 'system',
      requestedBy
    ]);

    return insertRes.rows[0];
  }
}

module.exports = CallReportGenerator;
