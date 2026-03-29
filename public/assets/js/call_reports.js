/**
 * ASGARD CRM — Аналитика звонков (фронтенд)
 * Карточки метрик, список отчётов, кнопка генерации
 */
window.AsgardCallReportsPage = (function() {
  'use strict';

  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  const token = () => localStorage.getItem('asgard_token');

  const API = {
    async getReports(type, limit = 20, offset = 0) {
      const url = `/api/call-reports?limit=${limit}&offset=${offset}` + (type ? `&type=${type}` : '');
      const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token() } });
      return res.json();
    },
    async getReport(id) {
      const res = await fetch(`/api/call-reports/${id}`, { headers: { 'Authorization': 'Bearer ' + token() } });
      return res.json();
    },
    async generate(reportType, dateFrom, dateTo) {
      const res = await fetch('/api/call-reports/generate', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_type: reportType, date_from: dateFrom, date_to: dateTo })
      });
      return res.json();
    },
    async getSchedule() {
      const res = await fetch('/api/call-reports/schedule', { headers: { 'Authorization': 'Bearer ' + token() } });
      return res.json();
    }
  };

  async function render({ layout, title }) {
    if (layout) {
      await layout(`
        <div class="cr-page">
          <div class="cr-header">
            <h2>Аналитика звонков</h2>
            <div class="cr-actions">
              <select id="crFilterType" class="fk-input" style="width:160px">
                <option value="">Все типы</option>
                <option value="daily">Ежедневные</option>
                <option value="weekly">Еженедельные</option>
                <option value="monthly">Ежемесячные</option>
              </select>
              <button id="crGenerate" class="fk-btn fk-btn--primary">Создать отчёт</button>
            </div>
          </div>
          <div id="crMetrics" class="cr-metrics"></div>
          <div id="crReportsList" class="cr-reports-list">
            <div style="padding:40px;text-align:center;opacity:0.5">Загрузка отчётов...</div>
          </div>
        </div>
      `, { title: title || 'Аналитика звонков' });
    }

    // Привязываем события
    const filterEl = document.getElementById('crFilterType');
    if (filterEl) filterEl.addEventListener('change', () => loadReports(filterEl.value));

    const genBtn = document.getElementById('crGenerate');
    if (genBtn) genBtn.addEventListener('click', openGenerateModal);

    await loadReports();
  }

  async function loadReports(type) {
    const listEl = document.getElementById('crReportsList');
    const metricsEl = document.getElementById('crMetrics');
    if (!listEl) return;

    try {
      const data = await API.getReports(type);
      const reports = data.items || [];

      // Метрики
      if (metricsEl) {
        const total = data.total || reports.length;
        const daily = reports.filter(r => r.report_type === 'daily').length;
        const weekly = reports.filter(r => r.report_type === 'weekly').length;
        const monthly = reports.filter(r => r.report_type === 'monthly').length;

        metricsEl.innerHTML = `
          <div class="cr-metric-card">
            <div class="cr-metric-value">${total}</div>
            <div class="cr-metric-label">Всего отчётов</div>
          </div>
          <div class="cr-metric-card">
            <div class="cr-metric-value">${daily}</div>
            <div class="cr-metric-label">Ежедневных</div>
          </div>
          <div class="cr-metric-card">
            <div class="cr-metric-value">${weekly}</div>
            <div class="cr-metric-label">Еженедельных</div>
          </div>
          <div class="cr-metric-card">
            <div class="cr-metric-value">${monthly}</div>
            <div class="cr-metric-label">Ежемесячных</div>
          </div>
        `;
      }

      if (!reports.length) {
        listEl.innerHTML = '<div style="padding:40px;text-align:center;opacity:0.5">Отчётов пока нет. Нажмите «Создать отчёт».</div>';
        return;
      }

      const typeLabels = { daily: 'Ежедневный', weekly: 'Еженедельный', monthly: 'Ежемесячный' };
      const genLabels = { system: 'Авто', manual: 'Вручную' };

      listEl.innerHTML = `
        <table class="fk-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Тип</th>
              <th>Период</th>
              <th>Заголовок</th>
              <th>Источник</th>
              <th>Дата</th>
            </tr>
          </thead>
          <tbody>
            ${reports.map(r => `
              <tr class="cr-report-row" data-id="${r.id}" style="cursor:pointer">
                <td>${r.id}</td>
                <td><span class="cr-badge cr-badge--${r.report_type}">${typeLabels[r.report_type] || r.report_type}</span></td>
                <td>${formatDate(r.period_from)} — ${formatDate(r.period_to)}</td>
                <td>${esc(r.title || '—')}</td>
                <td>${genLabels[r.generated_by] || r.generated_by}</td>
                <td>${formatDateTime(r.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      listEl.querySelectorAll('.cr-report-row').forEach(row => {
        row.addEventListener('click', () => openReportDetail(row.dataset.id));
      });
    } catch (err) {
      listEl.innerHTML = `<div style="padding:20px;color:var(--danger)">Ошибка загрузки: ${esc(err.message)}</div>`;
    }
  }

  async function openReportDetail(id) {
    try {
      const data = await API.getReport(id);
      const r = data.item;
      if (!r) { toast('Отчёт не найден', 'error'); return; }

      const typeLabels = { daily: 'Ежедневный', weekly: 'Еженедельный', monthly: 'Ежемесячный' };
      let stats = {};
      try { stats = typeof r.stats_json === 'string' ? JSON.parse(r.stats_json) : (r.stats_json || {}); } catch (_) {}
      let recs = [];
      try { recs = typeof r.recommendations_json === 'string' ? JSON.parse(r.recommendations_json) : (r.recommendations_json || []); } catch (_) {}

      const html = `
        <div style="max-width:700px">
          <h3 style="margin:0 0 8px">${esc(r.title || 'Отчёт')}</h3>
          <div style="margin-bottom:12px;opacity:0.7;font-size:13px">
            ${typeLabels[r.report_type] || r.report_type} | ${formatDate(r.period_from)} — ${formatDate(r.period_to)}
          </div>

          ${stats.totalCalls !== undefined ? `
          <div class="cr-detail-metrics" style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
            <div class="cr-mini-card"><strong>${stats.totalCalls}</strong><br><small>Звонков</small></div>
            <div class="cr-mini-card"><strong>${stats.targetCalls || 0}</strong><br><small>Целевых</small></div>
            <div class="cr-mini-card"><strong>${stats.missedCalls || 0}</strong><br><small>Пропущено</small></div>
            <div class="cr-mini-card"><strong>${Math.round(stats.avgDuration || 0)}с</strong><br><small>Средн.</small></div>
          </div>` : ''}

          <div style="white-space:pre-wrap;line-height:1.6;margin-bottom:16px">${esc(r.summary_text || 'Нет текста отчёта')}</div>

          ${recs.length ? `
          <div style="margin-top:12px">
            <strong>Рекомендации:</strong>
            <ul style="margin:8px 0;padding-left:20px">
              ${recs.map(rec => `<li>${esc(rec)}</li>`).join('')}
            </ul>
          </div>` : ''}
        </div>
      `;

      showModal(html, { title: 'Отчёт #' + r.id, width: 750 });
    } catch (err) {
      toast('Ошибка: ' + err.message, 'error');
    }
  }

  function openGenerateModal() {
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const html = `
      <div style="display:flex;flex-direction:column;gap:12px;min-width:350px">
        <label>Тип отчёта:
          <select id="crGenType" class="fk-input" style="width:100%">
            <option value="daily">Ежедневный</option>
            <option value="weekly" selected>Еженедельный</option>
            <option value="monthly">Ежемесячный</option>
          </select>
        </label>
        <label>Дата от:
          <input type="date" id="crGenFrom" class="fk-input" value="${weekAgo}" style="width:100%">
        </label>
        <label>Дата до:
          <input type="date" id="crGenTo" class="fk-input" value="${today}" style="width:100%">
        </label>
        <button id="crGenSubmit" class="fk-btn fk-btn--primary" style="margin-top:8px">Сгенерировать</button>
      </div>
    `;

    showModal(html, { title: 'Новый отчёт по звонкам', width: 420 });

    setTimeout(() => {
      const submitBtn = document.getElementById('crGenSubmit');
      if (submitBtn) submitBtn.addEventListener('click', async () => {
        const reportType = document.getElementById('crGenType')?.value || 'weekly';
        const dateFrom = document.getElementById('crGenFrom')?.value;
        const dateTo = document.getElementById('crGenTo')?.value;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Генерация...';

        try {
          const result = await API.generate(reportType, dateFrom, dateTo);
          if (result.success) {
            closeModal();
            toast('Отчёт создан', 'success');
            await loadReports();
          } else {
            toast(result.error || 'Ошибка', 'error');
          }
        } catch (err) {
          toast('Ошибка: ' + err.message, 'error');
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Сгенерировать';
        }
      });
    }, 100);
  }

  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ru-RU');
  }

  function formatDateTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // Инлайн CSS для страницы
  if (!document.getElementById('cr-page-styles')) {
    const style = document.createElement('style');
    style.id = 'cr-page-styles';
    style.textContent = `
      .cr-page { padding: 0; }
      .cr-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px; }
      .cr-header h2 { margin:0; font-size:20px; }
      .cr-actions { display:flex; gap:8px; align-items:center; }
      .cr-metrics { display:flex; gap:12px; margin-bottom:20px; flex-wrap:wrap; }
      .cr-metric-card {
        flex:1; min-width:140px; padding:16px 20px;
        background: var(--surface, #1a1d2e); border-radius:12px;
        border: 1px solid var(--border, #2a2d3e);
      }
      .cr-metric-value { font-size:28px; font-weight:700; color: var(--gold, #D4A843); }
      .cr-metric-label { font-size:13px; opacity:0.6; margin-top:4px; }
      .cr-badge {
        display:inline-block; padding:2px 8px; border-radius:8px; font-size:12px; font-weight:600;
      }
      .cr-badge--daily { background:rgba(59,130,246,0.15); color:#60a5fa; }
      .cr-badge--weekly { background:rgba(34,197,94,0.15); color:#4ade80; }
      .cr-badge--monthly { background:rgba(168,85,247,0.15); color:#c084fc; }
      .cr-report-row:hover { background: var(--surface-hover, rgba(255,255,255,0.04)); }
      .cr-mini-card {
        padding:10px 14px; background:var(--surface, #1a1d2e); border-radius:8px;
        border:1px solid var(--border, #2a2d3e); text-align:center; min-width:80px;
      }
      .cr-mini-card strong { font-size:20px; color:var(--gold, #D4A843); }
    `;
    document.head.appendChild(style);
  }

  return { render };
})();
