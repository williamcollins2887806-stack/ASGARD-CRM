/**
 * ASGARD CRM — Аналитика звонков v2.0 (WOW)
 * cr-* CSS классы, animateNumber, SVG inline charts, skeleton loading
 * Никаких инлайн hex-цветов — только CSS-переменные
 */
window.AsgardCallReportsPage = (function() {
  'use strict';

  const { $, $$, esc, toast, showModal, closeModal } = AsgardUI;
  const token = () => localStorage.getItem('asgard_token');

  /* ════════════ API ════════════ */
  const API = {
    async getReports(type, limit, offset) {
      limit = limit || 20; offset = offset || 0;
      const url = '/api/call-reports?limit=' + limit + '&offset=' + offset + (type ? '&type=' + type : '');
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token() } });
      return res.json();
    },
    async getReport(id) {
      const res = await fetch('/api/call-reports/' + id, { headers: { Authorization: 'Bearer ' + token() } });
      return res.json();
    },
    async generate(reportType, dateFrom, dateTo) {
      const res = await fetch('/api/call-reports/generate', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_type: reportType, date_from: dateFrom, date_to: dateTo })
      });
      return res.json();
    },
    async getSchedule() {
      const res = await fetch('/api/call-reports/schedule', { headers: { Authorization: 'Bearer ' + token() } });
      return res.json();
    },
    async getDashboard() {
      const res = await fetch('/api/call-reports/dashboard', { headers: { Authorization: 'Bearer ' + token() } });
      return res.json();
    }
  };

  /* ════════════ STATE ════════════ */
  let _filterType = '';
  let _reports = [];

  /* ════════════ RENDER ════════════ */
  async function render({ layout, title }) {
    if (layout) {
      await layout(`
        <div class="cr-page">
          <div class="cr-header">
            <h2>⚡ Аналитика звонков</h2>
            <div class="cr-actions">
              <div class="cr-period">
                <button class="cr-period-btn cr-period-btn--active" data-type="">Все</button>
                <button class="cr-period-btn" data-type="daily">День</button>
                <button class="cr-period-btn" data-type="weekly">Неделя</button>
                <button class="cr-period-btn" data-type="monthly">Месяц</button>
              </div>
              <button id="crSettings" class="fk-btn fk-btn--ghost" title="Настройки уведомлений">\u2699\uFE0F</button>
              <button id="crGenerate" class="fk-btn fk-btn--primary">Создать отчёт</button>
            </div>
          </div>
          <div id="crMetrics" class="cr-metrics">
            <div class="cr-skeleton cr-skeleton--card"></div>
            <div class="cr-skeleton cr-skeleton--card"></div>
            <div class="cr-skeleton cr-skeleton--card"></div>
            <div class="cr-skeleton cr-skeleton--card"></div>
          </div>
          <div id="crInsight"></div>
          <div id="crChart">
            <div class="cr-skeleton cr-skeleton--chart"></div>
          </div>
          <div id="crManagers"></div>
          <div id="crReportsList">
            <div class="cr-skeleton cr-skeleton--row"></div>
            <div class="cr-skeleton cr-skeleton--row"></div>
            <div class="cr-skeleton cr-skeleton--row"></div>
          </div>
        </div>
      `, { title: title || 'Аналитика звонков' });
    }

    _bindEvents();
    await loadReports();
    _loadDashboard();
  }

  function _bindEvents() {
    document.querySelectorAll('.cr-period-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.cr-period-btn').forEach(function(b) { b.classList.remove('cr-period-btn--active'); });
        btn.classList.add('cr-period-btn--active');
        _filterType = btn.dataset.type || '';
        loadReports(_filterType);
      });
    });

    var genBtn = document.getElementById('crGenerate');
    if (genBtn) genBtn.addEventListener('click', openGenerateModal);

    var settBtn = document.getElementById('crSettings');
    if (settBtn) settBtn.addEventListener('click', openSettingsModal);
  }

  /* ════════════ LOAD REPORTS ════════════ */
  async function loadReports(type) {
    var listEl = document.getElementById('crReportsList');
    var metricsEl = document.getElementById('crMetrics');
    if (!listEl) return;

    try {
      var data = await API.getReports(type);
      _reports = data.items || [];

      _renderMetrics(metricsEl, data);
      _renderList(listEl, _reports);
    } catch (err) {
      listEl.innerHTML = '<div class="cr-list__empty">Ошибка загрузки: ' + esc(err.message) + '</div>';
    }
  }

  /* ════════════ DASHBOARD (chart, managers, insight) ════════════ */
  async function _loadDashboard() {
    try {
      var data = await API.getDashboard();
      if (data && data.stats) {
        _renderInsight(document.getElementById('crInsight'), data);
        _renderChart(document.getElementById('crChart'), data.chartData || []);
        _renderEmployees(document.getElementById('crManagers'), data.stats);
      }
    } catch (_) {
      // Dashboard endpoint may not exist yet — silent fail
      var chartEl = document.getElementById('crChart');
      if (chartEl) chartEl.innerHTML = '';
    }
  }

  /* ════════════ METRICS ════════════ */
  function _renderMetrics(el, data) {
    if (!el) return;
    var reports = data.items || [];
    var total = data.total || reports.length;
    var daily = 0, weekly = 0, monthly = 0;
    for (var i = 0; i < reports.length; i++) {
      if (reports[i].report_type === 'daily') daily++;
      else if (reports[i].report_type === 'weekly') weekly++;
      else if (reports[i].report_type === 'monthly') monthly++;
    }

    var cards = [
      { icon: '📊', cls: 'total', value: total, label: 'Всего отчётов' },
      { icon: '📅', cls: 'target', value: daily, label: 'Ежедневных' },
      { icon: '📆', cls: 'missed', value: weekly, label: 'Еженедельных' },
      { icon: '📈', cls: 'duration', value: monthly, label: 'Ежемесячных' }
    ];

    el.innerHTML = cards.map(function(c, i) {
      return '<div class="cr-metric cr-wow-card" style="animation-delay:' + (i * 60) + 'ms">' +
        '<div class="cr-metric__icon cr-metric__icon--' + c.cls + '">' + c.icon + '</div>' +
        '<div class="cr-metric__value" data-target="' + c.value + '">0</div>' +
        '<div class="cr-metric__label">' + c.label + '</div>' +
      '</div>';
    }).join('');

    // Animate numbers
    setTimeout(function() {
      el.querySelectorAll('.cr-metric__value').forEach(function(valEl) {
        animateNumber(valEl, parseInt(valEl.dataset.target) || 0);
      });
    }, 200);
  }

  /* ════════════ INSIGHT (AI summary from latest report) ════════════ */
  function _renderInsight(el, data) {
    if (!el) return;
    var stats = data.stats || {};
    if (!stats.totalCalls && !stats.latestSummary) { el.innerHTML = ''; return; }

    el.innerHTML =
      '<div class="cr-insight cr-wow-card">' +
        '<div class="cr-insight__title">🧙 Инсайт Мимира</div>' +
        '<div class="cr-insight__text">' + esc(stats.latestSummary || ('Всего звонков за период: ' + (stats.totalCalls || 0) + '. Целевых: ' + (stats.targetCalls || 0) + '. Пропущенных: ' + (stats.missedCalls || 0) + '.')) + '</div>' +
      '</div>';
  }

  /* ════════════ SVG CHART ════════════ */
  function _renderChart(el, chartData) {
    if (!el) return;
    if (!chartData || !chartData.length) { el.innerHTML = ''; return; }

    var W = 580, H = 200, PL = 40, PR = 10, PT = 10, PB = 30;
    var cw = W - PL - PR, ch = H - PT - PB;
    var n = chartData.length;
    if (n < 2) { el.innerHTML = ''; return; }

    var maxVal = 1;
    for (var i = 0; i < n; i++) {
      var d = chartData[i];
      if ((d.total || 0) > maxVal) maxVal = d.total;
      if ((d.target || 0) > maxVal) maxVal = d.target;
      if ((d.missed || 0) > maxVal) maxVal = d.missed;
    }
    maxVal = Math.ceil(maxVal * 1.1) || 10;

    function x(idx) { return PL + (idx / (n - 1)) * cw; }
    function y(val) { return PT + ch - ((val || 0) / maxVal) * ch; }

    function buildPath(key) {
      var pts = [];
      for (var j = 0; j < n; j++) pts.push(x(j).toFixed(1) + ',' + y(chartData[j][key]).toFixed(1));
      return 'M' + pts.join('L');
    }
    function buildArea(key) {
      var pts = [PL.toFixed(1) + ',' + (PT + ch).toFixed(1)];
      for (var j = 0; j < n; j++) pts.push(x(j).toFixed(1) + ',' + y(chartData[j][key]).toFixed(1));
      pts.push((PL + cw).toFixed(1) + ',' + (PT + ch).toFixed(1));
      return 'M' + pts.join('L') + 'Z';
    }

    // Grid lines
    var gridLines = '';
    var gridCount = 4;
    for (var g = 0; g <= gridCount; g++) {
      var gy = PT + (g / gridCount) * ch;
      var gv = Math.round(maxVal - (g / gridCount) * maxVal);
      gridLines += '<line x1="' + PL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + gy.toFixed(1) + '" class="cr-chart__grid-line"/>';
      gridLines += '<text x="' + (PL - 6) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" class="cr-chart__axis-label">' + gv + '</text>';
    }

    // X labels
    var xLabels = '';
    var step = Math.max(1, Math.floor(n / 6));
    for (var li = 0; li < n; li += step) {
      xLabels += '<text x="' + x(li).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" class="cr-chart__axis-label">' + esc(chartData[li].label || '') + '</text>';
    }

    // Dots
    var dots = '';
    var series = ['total', 'target', 'missed'];
    for (var si = 0; si < series.length; si++) {
      for (var di = 0; di < n; di++) {
        dots += '<circle cx="' + x(di).toFixed(1) + '" cy="' + y(chartData[di][series[si]]).toFixed(1) + '" class="cr-chart__dot cr-chart__dot--' + series[si] + '"/>';
      }
    }

    // Calculate path lengths for animation
    var totalLen = 0, targetLen = 0, missedLen = 0;
    for (var pi = 1; pi < n; pi++) {
      var dx1 = x(pi) - x(pi - 1);
      totalLen += Math.sqrt(dx1 * dx1 + Math.pow(y(chartData[pi].total) - y(chartData[pi - 1].total), 2));
      targetLen += Math.sqrt(dx1 * dx1 + Math.pow(y(chartData[pi].target) - y(chartData[pi - 1].target), 2));
      missedLen += Math.sqrt(dx1 * dx1 + Math.pow(y(chartData[pi].missed) - y(chartData[pi - 1].missed), 2));
    }

    el.innerHTML =
      '<div class="cr-chart cr-wow-card">' +
        '<div class="cr-chart__title">Динамика звонков</div>' +
        '<svg class="cr-chart__svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
          gridLines + xLabels +
          '<path d="' + buildArea('total') + '" class="cr-chart__area cr-chart__area--total"/>' +
          '<path d="' + buildArea('target') + '" class="cr-chart__area cr-chart__area--target"/>' +
          '<path d="' + buildArea('missed') + '" class="cr-chart__area cr-chart__area--missed"/>' +
          '<path d="' + buildPath('total') + '" class="cr-chart__line cr-chart__line--total cr-chart__line--animate" style="--path-len:' + Math.ceil(totalLen) + ';stroke-dasharray:' + Math.ceil(totalLen) + '"/>' +
          '<path d="' + buildPath('target') + '" class="cr-chart__line cr-chart__line--target cr-chart__line--animate" style="--path-len:' + Math.ceil(targetLen) + ';stroke-dasharray:' + Math.ceil(targetLen) + '"/>' +
          '<path d="' + buildPath('missed') + '" class="cr-chart__line cr-chart__line--missed cr-chart__line--animate" style="--path-len:' + Math.ceil(missedLen) + ';stroke-dasharray:' + Math.ceil(missedLen) + '"/>' +
          dots +
        '</svg>' +
        '<div class="cr-chart__legend">' +
          '<div class="cr-chart__legend-item"><span class="cr-chart__legend-dot cr-chart__legend-dot--total"></span>Всего</div>' +
          '<div class="cr-chart__legend-item"><span class="cr-chart__legend-dot cr-chart__legend-dot--target"></span>Целевые</div>' +
          '<div class="cr-chart__legend-item"><span class="cr-chart__legend-dot cr-chart__legend-dot--missed"></span>Пропущенные</div>' +
        '</div>' +
      '</div>';
  }

  /* ════════════ EMPLOYEES ════════════ */
  function _renderEmployees(el, stats) {
    if (!el) return;
    var employees = stats.byEmployee || stats.byManager || [];
    if (!employees.length) { el.innerHTML = ''; return; }

    var maxTotal = 1;
    for (var i = 0; i < employees.length; i++) {
      if ((employees[i].total || 0) > maxTotal) maxTotal = employees[i].total;
    }

    var rows = employees.slice(0, 10).map(function(emp, i) {
      var pct = Math.round(((emp.total || 0) / maxTotal) * 100);
      var rankCls = (i < 3) ? ' cr-employees__rank--' + (i + 1) : '';
      var barCls = pct >= 70 ? 'good' : (pct >= 40 ? 'mid' : 'low');
      return '<tr class="cr-wow-card" style="animation-delay:' + (i * 40) + 'ms">' +
        '<td><span class="cr-employees__rank' + rankCls + '">' + (i + 1) + '</span></td>' +
        '<td>' + esc(emp.name || '—') + '</td>' +
        '<td style="text-align:center">' + (emp.total || 0) + '</td>' +
        '<td style="text-align:center">' + (emp.target || 0) + '</td>' +
        '<td style="text-align:center">' + (emp.missed || 0) + '</td>' +
        '<td><div class="cr-employees__bar"><div class="cr-employees__bar-fill cr-employees__bar-fill--' + barCls + '" style="width:' + pct + '%"></div></div></td>' +
      '</tr>';
    }).join('');

    el.innerHTML =
      '<div class="cr-employees cr-wow-card">' +
        '<div class="cr-employees__title">Активность по сотрудникам</div>' +
        '<table class="cr-employees__table">' +
          '<thead><tr>' +
            '<th>#</th><th>Сотрудник</th><th style="text-align:center">Звонки</th>' +
            '<th style="text-align:center" class="cr-col-hide-sm">Целевые</th>' +
            '<th style="text-align:center" class="cr-col-hide-sm">Потеряно</th>' +
            '<th>Прогресс</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';
  }

  /* ════════════ REPORT LIST ════════════ */
  function _renderList(el, reports) {
    if (!el) return;
    if (!reports.length) {
      el.innerHTML = '<div class="cr-list"><div class="cr-list__empty">Отчётов пока нет. Нажмите «Создать отчёт».</div></div>';
      return;
    }

    var TYPE_LABELS = { daily: 'Ежедневный', weekly: 'Еженедельный', monthly: 'Ежемесячный' };
    var GEN_LABELS = { system: 'Авто', manual: 'Вручную' };

    var rows = reports.map(function(r, i) {
      return '<tr class="cr-list__row cr-wow-card" data-id="' + r.id + '" style="animation-delay:' + (i * 30) + 'ms">' +
        '<td>' + r.id + '</td>' +
        '<td><span class="cr-badge cr-badge--' + (r.report_type || 'daily') + '">' + (TYPE_LABELS[r.report_type] || r.report_type) + '</span></td>' +
        '<td>' + fmtDate(r.period_from) + ' — ' + fmtDate(r.period_to) + '</td>' +
        '<td>' + esc(r.title || '—') + '</td>' +
        '<td><span class="cr-badge cr-badge--' + (r.generated_by || 'system') + '">' + (GEN_LABELS[r.generated_by] || r.generated_by) + '</span></td>' +
        '<td>' + fmtDateTime(r.created_at) + '</td>' +
      '</tr>';
    }).join('');

    el.innerHTML =
      '<div class="cr-list">' +
        '<table class="cr-list__table">' +
          '<thead><tr>' +
            '<th>#</th><th>Тип</th><th>Период</th><th>Заголовок</th><th>Источник</th><th>Дата</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';

    el.querySelectorAll('.cr-list__row').forEach(function(row) {
      row.addEventListener('click', function() { openReportDetail(row.dataset.id); });
    });
  }

  /* ════════════ REPORT DETAIL MODAL ════════════ */
  async function openReportDetail(id) {
    try {
      var data = await API.getReport(id);
      var r = data.item;
      if (!r) { toast('Отчёт не найден', 'error'); return; }

      var TYPE_LABELS = { daily: 'Ежедневный', weekly: 'Еженедельный', monthly: 'Ежемесячный' };
      var stats = {};
      try { stats = typeof r.stats_json === 'string' ? JSON.parse(r.stats_json) : (r.stats_json || {}); } catch (_) {}
      var recs = [];
      try { recs = typeof r.recommendations_json === 'string' ? JSON.parse(r.recommendations_json) : (r.recommendations_json || []); } catch (_) {}

      var metricsHtml = '';
      if (stats.totalCalls !== undefined) {
        var items = [
          { v: stats.totalCalls || 0, l: 'Звонков' },
          { v: stats.targetCalls || 0, l: 'Целевых' },
          { v: stats.missedCalls || 0, l: 'Пропущено' },
          { v: Math.round(stats.avgDuration || 0) + 'с', l: 'Средн.' }
        ];
        metricsHtml = '<div class="cr-detail__metrics">' + items.map(function(it) {
          return '<div class="cr-detail__mini"><div class="cr-detail__mini-value">' + it.v + '</div><div class="cr-detail__mini-label">' + it.l + '</div></div>';
        }).join('') + '</div>';
      }

      var recsHtml = '';
      if (recs.length) {
        recsHtml = '<div class="cr-detail__recs">' +
          '<div class="cr-detail__recs-title">Рекомендации</div>' +
          '<ol class="cr-detail__recs-list">' + recs.map(function(rec) { return '<li>' + esc(rec) + '</li>'; }).join('') + '</ol>' +
        '</div>';
      }

      // Employee table in detail (fallback)
      var employeesDetail = '';
      var byEmp = stats.byEmployee || stats.byManager || [];
      if (byEmp.length) {
        employeesDetail = '<div class="cr-accordion cr-wow-card" style="margin-top:12px">' +
          '<div class="cr-accordion__head" onclick="this.parentElement.classList.toggle(\'cr-accordion--open\')">Активность по сотрудникам <span class="cr-accordion__arrow">\u25BC</span></div>' +
          '<div class="cr-accordion__body"><div class="cr-accordion__content">' +
            '<table class="cr-employees__table"><thead><tr><th>#</th><th>Сотрудник</th><th style="text-align:center">Звонки</th><th style="text-align:center">Целевые</th><th style="text-align:center">Потеряно</th></tr></thead><tbody>' +
            byEmp.slice(0, 10).map(function(emp, i) {
              return '<tr><td>' + (i + 1) + '</td><td>' + esc(emp.name || '\u2014') + '</td><td style="text-align:center">' + (emp.total || 0) + '</td><td style="text-align:center">' + (emp.target || 0) + '</td><td style="text-align:center">' + (emp.missed || 0) + '</td></tr>';
            }).join('') +
          '</tbody></table></div></div></div>';
      }

      var bodyContent;
      if (r.report_html) {
        // WOW HTML-отчёт из генератора
        bodyContent = '<div class="cr-html-report-content">' + r.report_html + '</div>';
      } else {
        // Fallback на plain text
        bodyContent = metricsHtml +
          '<div class="cr-detail__summary">' + esc(r.summary_text || 'Нет текста отчёта') + '</div>' +
          recsHtml +
          employeesDetail;
      }

      var html =
        '<div class="cr-detail">' +
          '<div class="cr-detail__header">' +
            '<div class="cr-detail__title">' + esc(r.title || 'Отчёт') + '</div>' +
            '<div class="cr-detail__subtitle">' + (TYPE_LABELS[r.report_type] || r.report_type) + ' | ' + fmtDate(r.period_from) + ' — ' + fmtDate(r.period_to) + '</div>' +
          '</div>' +
          bodyContent +
        '</div>';

      showModal(html, { title: 'Отчёт #' + r.id, width: 750 });

      // Animate detail mini values
      setTimeout(function() {
        document.querySelectorAll('.cr-detail__mini-value').forEach(function(valEl) {
          var num = parseInt(valEl.textContent);
          if (!isNaN(num) && num > 0) animateNumber(valEl, num, 600);
        });
      }, 100);

    } catch (err) {
      toast('Ошибка: ' + err.message, 'error');
    }
  }

  /* ════════════ GENERATE MODAL ════════════ */
  function openGenerateModal() {
    var today = new Date().toISOString().slice(0, 10);
    var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    var html =
      '<div class="cr-generate">' +
        '<label class="cr-generate__label">Тип отчёта' +
          '<div id="crselect-crGenType"></div>' +
        '</label>' +
        '<label class="cr-generate__label">Дата от' +
          '<input type="date" id="crGenFrom" class="fk-input" value="' + weekAgo + '">' +
        '</label>' +
        '<label class="cr-generate__label">Дата до' +
          '<input type="date" id="crGenTo" class="fk-input" value="' + today + '">' +
        '</label>' +
        '<button id="crGenSubmit" class="fk-btn fk-btn--primary">Сгенерировать</button>' +
      '</div>';

    showModal(html, { title: 'Новый отчёт по звонкам', width: 420 });

    setTimeout(function() {
      // CRSelect init — report type
      document.getElementById('crselect-crGenType')?.appendChild(CRSelect.create({
        id:'crGenType', fullWidth:true, value:'weekly',
        options:[
          {value:'daily', label:'Ежедневный'},
          {value:'weekly', label:'Еженедельный'},
          {value:'monthly', label:'Ежемесячный'},
        ],
      }));

      var submitBtn = document.getElementById('crGenSubmit');
      if (submitBtn) submitBtn.addEventListener('click', async function() {
        var reportType = CRSelect.getValue('crGenType') || 'weekly';
        var dateFrom = (document.getElementById('crGenFrom') || {}).value;
        var dateTo = (document.getElementById('crGenTo') || {}).value;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Генерация...';

        try {
          var result = await API.generate(reportType, dateFrom, dateTo);
          if (result.success) {
            closeModal();
            toast('Отчёт создан', 'success');
            await loadReports(_filterType);
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

  /* ════════════ animateNumber ════════════ */
  function animateNumber(el, target, duration) {
    duration = duration || 800;
    if (typeof target !== 'number' || isNaN(target)) { el.textContent = target; return; }
    var start = 0;
    var startTime = null;
    function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      el.textContent = Math.round(easeOutQuart(progress) * target);
      if (progress < 1) requestAnimationFrame(step);
      else {
        el.textContent = target;
        var card = el.closest('.cr-metric');
        if (card) card.classList.add('cr-wow-flash');
      }
    }
    requestAnimationFrame(step);
  }

  /* ════════════ FORMATTING ════════════ */
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ru-RU');
  }

  function fmtDateTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* ════════════ SETTINGS MODAL ════════════ */
  async function openSettingsModal() {
    var data;
    try { data = await API.getSchedule(); } catch(_) { data = {}; }

    var types = [
      { key: 'daily', label: 'Ежедневный', icon: '\uD83D\uDCC5' },
      { key: 'weekly', label: 'Еженедельный', icon: '\uD83D\uDCC6' },
      { key: 'monthly', label: 'Ежемесячный', icon: '\uD83D\uDCCA' }
    ];

    var html = '<div class="cr-settings">';
    types.forEach(function(t) {
      var p = data[t.key] || {};
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--brd)">' +
        '<div style="font-size:14px;font-weight:600;color:var(--t1)">' + t.icon + ' ' + t.label + '</div>' +
        '<div style="display:flex;gap:14px;align-items:center">' +
          '<label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--t2);cursor:pointer"><input type="checkbox" data-type="' + t.key + '" data-field="is_enabled" ' + (p.is_enabled !== false ? 'checked' : '') + '> Вкл</label>' +
          '<label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--t2);cursor:pointer"><input type="checkbox" data-type="' + t.key + '" data-field="via_huginn" ' + (p.via_huginn !== false ? 'checked' : '') + '> Huginn</label>' +
          '<label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--t2);cursor:pointer"><input type="checkbox" data-type="' + t.key + '" data-field="via_email" ' + (p.via_email !== false ? 'checked' : '') + '> Email</label>' +
        '</div>' +
      '</div>';
    });
    html += '<button id="crSaveSettings" class="fk-btn fk-btn--primary" style="margin-top:16px;width:100%">Сохранить</button>';
    html += '</div>';

    showModal(html, { title: '\u2699\uFE0F Настройки отчётов', width: 480 });

    setTimeout(function() {
      var saveBtn = document.getElementById('crSaveSettings');
      if (saveBtn) saveBtn.addEventListener('click', async function() {
        var body = {};
        types.forEach(function(t) {
          body[t.key] = {};
          document.querySelectorAll('[data-type="' + t.key + '"]').forEach(function(input) {
            body[t.key][input.dataset.field] = input.checked;
          });
        });
        saveBtn.disabled = true;
        saveBtn.textContent = 'Сохраняю...';
        try {
          await fetch('/api/call-reports/schedule', {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          closeModal();
          toast('Настройки сохранены', 'success');
        } catch (e) {
          toast('Ошибка: ' + e.message, 'error');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Сохранить';
        }
      });
    }, 100);
  }

  return { render: render, openReportDetail: openReportDetail, openSettingsModal: openSettingsModal };
})();
