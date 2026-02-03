/**
 * АСГАРД CRM — Автоотчёты
 * Месячные, квартальные, годовые отчёты с уведомлениями
 */
window.AsgardReports = (function(){
  const {$, $$, esc, toast, showModal, closeModal} = AsgardUI;
  
  const REPORT_TYPES = {
    monthly: { label: 'Месячный', icon: '📅' },
    quarterly: { label: 'Квартальный', icon: '📊' },
    yearly: { label: 'Годовой', icon: '📈' }
  };
  
  const MONTHS = ['', 'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  // Загрузка списка сохранённых отчётов
  async function loadSavedReports() {
    try {
      const auth = await AsgardAuth.getAuth();
      const response = await fetch('/api/reports/saved', {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      if (response.ok) {
        const data = await response.json();
        return data.reports || [];
      }
    } catch(e) {}
    return [];
  }

  // Генерация отчёта
  async function generateReport(type, params = {}) {
    try {
      const auth = await AsgardAuth.getAuth();
      let url = `/api/reports/generate/${type}?`;
      
      if (type === 'monthly') {
        url += `year=${params.year || new Date().getFullYear()}&month=${params.month || new Date().getMonth() + 1}`;
      } else if (type === 'quarterly') {
        url += `year=${params.year || new Date().getFullYear()}&quarter=${params.quarter || Math.ceil((new Date().getMonth() + 1) / 3)}`;
      } else {
        url += `year=${params.year || new Date().getFullYear()}`;
      }
      
      const response = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch(e) {
      console.error('generateReport error:', e);
    }
    return null;
  }

  // Скачивание отчёта в Excel
  async function downloadReport(type, params = {}) {
    try {
      const auth = await AsgardAuth.getAuth();
      let url = `/api/reports/download/${type}?format=xlsx&`;
      
      if (type === 'monthly') {
        url += `year=${params.year}&month=${params.month}`;
      } else if (type === 'quarterly') {
        url += `year=${params.year}&quarter=${params.quarter}`;
      } else {
        url += `year=${params.year}`;
      }
      
      const response = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + auth.token }
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `report_${type}_${params.year}${params.month ? '_' + params.month : ''}${params.quarter ? '_Q' + params.quarter : ''}.xlsx`;
        a.click();
        toast('Отчёт', 'Файл скачан', 'ok');
      } else {
        toast('Ошибка', 'Не удалось скачать отчёт', 'err');
      }
    } catch(e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  // Форматирование суммы
  function fmtMoney(val) {
    return (parseFloat(val) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₽';
  }

  // Отрисовка страницы отчётов
  async function renderReportsPage(container) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentQuarter = Math.ceil(currentMonth / 3);
    
    container.innerHTML = `
      <div class="page-header">
        <h1>📊 Отчёты</h1>
      </div>
      
      <div class="tabs" style="margin-bottom:20px">
        <button class="tab active" data-tab="generate">Создать отчёт</button>
        <button class="tab" data-tab="saved">Сохранённые</button>
        <button class="tab" data-tab="settings">Настройки</button>
      </div>
      
      <div id="tab_generate" class="tab-content">
        <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:20px">
          
          <!-- Месячный отчёт -->
          <div class="card">
            <h3>📅 Месячный отчёт</h3>
            <div class="stack" style="gap:12px;margin-top:12px">
              <div class="row" style="gap:10px">
                <select id="monthly_year" class="inp" style="flex:1">
                  ${[currentYear, currentYear-1, currentYear-2].map(y => `<option value="${y}" ${y===currentYear?'selected':''}>${y}</option>`).join('')}
                </select>
                <select id="monthly_month" class="inp" style="flex:1">
                  ${MONTHS.slice(1).map((m,i) => `<option value="${i+1}" ${i+1===currentMonth?'selected':''}>${m}</option>`).join('')}
                </select>
              </div>
              <div class="row" style="gap:10px">
                <button class="btn" data-action="preview" data-type="monthly">👁 Просмотр</button>
                <button class="btn primary" data-action="download" data-type="monthly">📥 Скачать Excel</button>
              </div>
            </div>
          </div>
          
          <!-- Квартальный отчёт -->
          <div class="card">
            <h3>📊 Квартальный отчёт</h3>
            <div class="stack" style="gap:12px;margin-top:12px">
              <div class="row" style="gap:10px">
                <select id="quarterly_year" class="inp" style="flex:1">
                  ${[currentYear, currentYear-1, currentYear-2].map(y => `<option value="${y}" ${y===currentYear?'selected':''}>${y}</option>`).join('')}
                </select>
                <select id="quarterly_quarter" class="inp" style="flex:1">
                  ${[1,2,3,4].map(q => `<option value="${q}" ${q===currentQuarter?'selected':''}>${q} квартал</option>`).join('')}
                </select>
              </div>
              <div class="row" style="gap:10px">
                <button class="btn" data-action="preview" data-type="quarterly">👁 Просмотр</button>
                <button class="btn primary" data-action="download" data-type="quarterly">📥 Скачать Excel</button>
              </div>
            </div>
          </div>
          
          <!-- Годовой отчёт -->
          <div class="card">
            <h3>📈 Годовой отчёт</h3>
            <div class="stack" style="gap:12px;margin-top:12px">
              <div class="row" style="gap:10px">
                <select id="yearly_year" class="inp" style="flex:1">
                  ${[currentYear, currentYear-1, currentYear-2, currentYear-3].map(y => `<option value="${y}" ${y===currentYear-1?'selected':''}>${y}</option>`).join('')}
                </select>
              </div>
              <div class="row" style="gap:10px">
                <button class="btn" data-action="preview" data-type="yearly">👁 Просмотр</button>
                <button class="btn primary" data-action="download" data-type="yearly">📥 Скачать Excel</button>
              </div>
            </div>
          </div>
          
        </div>
        
        <!-- Область просмотра отчёта -->
        <div id="report_preview" style="display:none;margin-top:24px">
          <div class="card">
            <div id="report_content"></div>
          </div>
        </div>
      </div>
      
      <div id="tab_saved" class="tab-content" style="display:none">
        <div id="saved_reports_list">
          <div class="muted">Загрузка...</div>
        </div>
      </div>
      
      <div id="tab_settings" class="tab-content" style="display:none">
        <div class="card" style="max-width:500px">
          <h3>⚙️ Автоматические отчёты</h3>
          <div class="stack" style="gap:16px;margin-top:16px">
            <label class="checkbox">
              <input type="checkbox" id="auto_monthly" checked/>
              <span>Месячный отчёт (1-го числа каждого месяца)</span>
            </label>
            <label class="checkbox">
              <input type="checkbox" id="auto_quarterly" checked/>
              <span>Квартальный отчёт (после завершения квартала)</span>
            </label>
            <label class="checkbox">
              <input type="checkbox" id="auto_yearly" checked/>
              <span>Годовой отчёт (1 января)</span>
            </label>
            <div class="help">
              Отчёты автоматически создаются и отправляются директорам в Telegram + уведомление на сайте.
            </div>
            <button class="btn primary" id="save_auto_settings">💾 Сохранить настройки</button>
          </div>
        </div>
      </div>
    `;
    
    // Вкладки
    $$('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.tab').forEach(t => t.classList.remove('active'));
        $$('.tab-content').forEach(c => c.style.display = 'none');
        tab.classList.add('active');
        $(`#tab_${tab.dataset.tab}`).style.display = 'block';
        
        if (tab.dataset.tab === 'saved') {
          loadAndRenderSaved();
        }
      });
    });
    
    // Кнопки просмотра и скачивания
    $$('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const type = btn.dataset.type;
        
        const params = getReportParams(type);
        
        if (action === 'preview') {
          btn.disabled = true;
          btn.textContent = '⏳ Загрузка...';
          
          const report = await generateReport(type, params);
          
          btn.disabled = false;
          btn.textContent = '👁 Просмотр';
          
          if (report) {
            renderReportPreview(report);
          } else {
            toast('Ошибка', 'Не удалось загрузить отчёт', 'err');
          }
        } else if (action === 'download') {
          btn.disabled = true;
          btn.textContent = '⏳ Скачивание...';
          
          await downloadReport(type, params);
          
          btn.disabled = false;
          btn.textContent = '📥 Скачать Excel';
        }
      });
    });
    
    // Сохранение настроек
    $('#save_auto_settings')?.addEventListener('click', async () => {
      const settings = {
        enabled: true,
        monthly: $('#auto_monthly').checked,
        quarterly: $('#auto_quarterly').checked,
        yearly: $('#auto_yearly').checked
      };
      
      await AsgardDB.put('settings', {
        key: 'auto_reports',
        value_json: JSON.stringify(settings)
      });
      
      toast('Настройки', 'Сохранено', 'ok');
    });
    
    // Загрузка настроек
    loadAutoSettings();
  }
  
  function getReportParams(type) {
    if (type === 'monthly') {
      return {
        year: parseInt($('#monthly_year').value),
        month: parseInt($('#monthly_month').value)
      };
    } else if (type === 'quarterly') {
      return {
        year: parseInt($('#quarterly_year').value),
        quarter: parseInt($('#quarterly_quarter').value)
      };
    } else {
      return {
        year: parseInt($('#yearly_year').value)
      };
    }
  }
  
  function renderReportPreview(report) {
    const preview = $('#report_preview');
    const content = $('#report_content');
    
    preview.style.display = 'block';
    
    const d = report.data || {};
    const profitColor = (d.profit || 0) >= 0 ? '#22c55e' : '#ef4444';
    
    content.innerHTML = `
      <h2 style="margin-bottom:20px">📊 ${esc(report.period)}</h2>
      
      <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:16px">
        
        <div class="stat-card">
          <div class="stat-label">Тендеры</div>
          <div class="stat-value">${d.tenders?.total || 0}</div>
          <div class="stat-sub">
            ✅ Выиграно: ${d.tenders?.won || 0} &nbsp;
            ❌ Проиграно: ${d.tenders?.lost || 0}
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">Работы</div>
          <div class="stat-value">${d.works?.total || 0}</div>
          <div class="stat-sub">
            ✅ Завершено: ${d.works?.completed || 0}
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">Доходы</div>
          <div class="stat-value" style="color:#22c55e">${fmtMoney(d.incomes?.total)}</div>
        </div>
        
        <div class="stat-card">
          <div class="stat-label">Расходы</div>
          <div class="stat-value" style="color:#ef4444">${fmtMoney(d.expenses?.total)}</div>
        </div>
        
        <div class="stat-card" style="grid-column: span 2">
          <div class="stat-label">Прибыль</div>
          <div class="stat-value" style="color:${profitColor};font-size:2em">${fmtMoney(d.profit)}</div>
        </div>
        
      </div>
      
      ${d.top_customers?.length ? `
        <h3 style="margin-top:24px">🏆 Топ заказчики</h3>
        <table class="tbl" style="margin-top:12px">
          <thead><tr><th>Заказчик</th><th>Тендеров</th><th>Сумма</th></tr></thead>
          <tbody>
            ${d.top_customers.map(c => `
              <tr>
                <td>${esc(c.customer_name || '—')}</td>
                <td>${c.count}</td>
                <td>${fmtMoney(c.sum)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : ''}
      
      <div style="margin-top:20px;text-align:right">
        <small class="muted">Сформирован: ${new Date(report.generated_at).toLocaleString('ru-RU')}</small>
      </div>
    `;
  }
  
  async function loadAndRenderSaved() {
    const container = $('#saved_reports_list');
    const reports = await loadSavedReports();
    
    if (!reports.length) {
      container.innerHTML = '<div class="muted">Нет сохранённых отчётов</div>';
      return;
    }
    
    container.innerHTML = `
      <table class="tbl">
        <thead>
          <tr>
            <th>Тип</th>
            <th>Период</th>
            <th>Создан</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${reports.map(r => `
            <tr>
              <td>${REPORT_TYPES[r.type]?.icon || '📄'} ${REPORT_TYPES[r.type]?.label || r.type}</td>
              <td>${esc(r.period)}</td>
              <td>${new Date(r.created_at).toLocaleDateString('ru-RU')}</td>
              <td>
                <button class="btn mini" data-download="${r.type}" data-code="${r.period_code}">📥 Excel</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    
    $$('[data-download]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const type = btn.dataset.download;
        const code = btn.dataset.code;
        
        // Парсим period_code (например: 2024-01, 2024-Q1, 2024)
        let params = {};
        if (code.includes('-Q')) {
          const [y, q] = code.split('-Q');
          params = { year: parseInt(y), quarter: parseInt(q) };
        } else if (code.includes('-')) {
          const [y, m] = code.split('-');
          params = { year: parseInt(y), month: parseInt(m) };
        } else {
          params = { year: parseInt(code) };
        }
        
        await downloadReport(type, params);
      });
    });
  }
  
  async function loadAutoSettings() {
    try {
      const settings = await AsgardDB.get('settings', 'auto_reports');
      if (settings?.value_json) {
        const config = JSON.parse(settings.value_json);
        if ($('#auto_monthly')) $('#auto_monthly').checked = config.monthly !== false;
        if ($('#auto_quarterly')) $('#auto_quarterly').checked = config.quarterly !== false;
        if ($('#auto_yearly')) $('#auto_yearly').checked = config.yearly !== false;
      }
    } catch(e) {}
  }

  return {
    renderReportsPage,
    generateReport,
    downloadReport,
    loadSavedReports,
    REPORT_TYPES,
    MONTHS
  };
})();
