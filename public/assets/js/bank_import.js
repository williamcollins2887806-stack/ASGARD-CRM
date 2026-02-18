/**
 * АСГАРД CRM — Импорт банковских выписок v2
 * 
 * Особенности:
 * 1. Защита от дублей (хеш операции: дата+сумма+контрагент)
 * 2. Двухэтапный импорт: просмотр → подтверждение
 * 3. Авто-разнесение по ключевым словам
 * 4. Обучение системы по ручным разнесениям
 */
window.AsgardBankImport = (function(){
  const {$, $$, esc, toast, showModal, closeModal} = AsgardUI;
  
  // Статьи расходов с ключевыми словами
  const EXPENSE_ARTICLES = [
    {code: 'fot', label: 'ФОТ', keywords: ['зарплат', 'заработн', 'оклад', 'премия', 'аванс сотруд']},
    {code: 'taxes', label: 'Налоги и сборы', keywords: ['налог', 'ндс', 'ндфл', 'пфр', 'фсс', 'фомс', 'взнос', 'пени', 'штраф', 'ифнс']},
    {code: 'rent', label: 'Аренда', keywords: ['аренда', 'арендн', 'найм', 'субаренд']},
    {code: 'utilities', label: 'Коммунальные', keywords: ['коммунал', 'электроэнерг', 'водоснаб', 'отоплен', 'газ ', 'жкх']},
    {code: 'logistics', label: 'Логистика', keywords: ['доставк', 'транспорт', 'перевоз', 'логистик', 'грузо', 'такси', 'билет', 'ржд', 'авиа']},
    {code: 'materials', label: 'Материалы', keywords: ['материал', 'запчаст', 'комплектующ', 'расходн', 'инструмент']},
    {code: 'subcontract', label: 'Субподряд', keywords: ['субподряд', 'подряд', 'услуги по договор', 'выполнен работ']},
    {code: 'equipment', label: 'Оборудование', keywords: ['оборудован', 'станок', 'техник', 'машин', 'агрегат']},
    {code: 'software', label: 'ПО и лицензии', keywords: ['лицензи', 'программ', 'софт', 'подписк', '1с', 'microsoft', 'google', 'яндекс']},
    {code: 'bank', label: 'Банковские комиссии', keywords: ['комисси', 'банковск', 'рко', 'обслуживан счет', 'за ведение']},
    {code: 'office', label: 'Офисные расходы', keywords: ['канцеляр', 'бумаг', 'офисн', 'мебел', 'кулер', 'вода питьев']},
    {code: 'communication', label: 'Связь', keywords: ['связь', 'телефон', 'интернет', 'мобильн', 'мтс', 'билайн', 'мегафон', 'ростелеком']},
    {code: 'other', label: 'Прочее', keywords: []}
  ];
  
  // Статьи доходов
  const INCOME_ARTICLES = [
    {code: 'advance', label: 'Аванс', keywords: ['аванс', 'предоплат', 'предварител']},
    {code: 'payment', label: 'Оплата по договору', keywords: ['оплата', 'по договор', 'по счет', 'за услуг', 'за работ', 'по акт']},
    {code: 'final', label: 'Окончательный расчёт', keywords: ['окончател', 'финальн', 'закрыт', 'полн расчет']},
    {code: 'refund', label: 'Возврат', keywords: ['возврат', 'перепла']},
    {code: 'other', label: 'Прочее', keywords: []}
  ];

  // Генерация хеша операции для проверки дублей
  function generateHash(row) {
    const str = `${row.date}|${row.amount}|${(row.counterparty || '').slice(0,30)}|${(row.description || '').slice(0,30)}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'tx_' + Math.abs(hash).toString(36);
  }

  // Проверка, импортирована ли уже операция
  async function checkDuplicates(rows) {
    const importedHashes = new Set();
    
    try {
      // Загружаем хеши всех импортированных операций
      const incomes = await AsgardDB.all('incomes') || [];
      const workExp = await AsgardDB.all('work_expenses') || [];
      const officeExp = await AsgardDB.all('office_expenses') || [];
      
      [...incomes, ...workExp, ...officeExp].forEach(item => {
        if (item.import_hash) importedHashes.add(item.import_hash);
      });
    } catch(e) {
      console.error('checkDuplicates error:', e);
    }
    
    // Помечаем дубли
    rows.forEach(row => {
      row.hash = generateHash(row);
      row.isDuplicate = importedHashes.has(row.hash);
    });
    
    return rows;
  }

  // Загрузка правил пользователя
  async function loadRules() {
    try {
      const rules = await AsgardDB.all('bank_rules') || [];
      return rules.sort((a,b) => (b.usage_count || 0) - (a.usage_count || 0));
    } catch(e) {
      return [];
    }
  }

  // Сохранение правила
  async function saveRule(pattern, article, type, workId = null) {
    if (!pattern || pattern.length < 3) return;
    try {
      const existing = await AsgardDB.all('bank_rules') || [];
      const found = existing.find(r => r.pattern === pattern.toLowerCase());
      
      if (found) {
        found.usage_count = (found.usage_count || 0) + 1;
        found.article = article;
        found.work_id = workId;
        await AsgardDB.put('bank_rules', found);
      } else {
        await AsgardDB.add('bank_rules', {
          pattern: pattern.toLowerCase(),
          article, type, work_id: workId,
          created_at: new Date().toISOString(),
          usage_count: 1
        });
      }
    } catch(e) {}
  }

  // Авто-определение статьи
  function detectArticle(text, type, customRules = []) {
    const lowerText = (text || '').toLowerCase();
    
    // Пользовательские правила (приоритет)
    for (const rule of customRules) {
      if (rule.type === type && lowerText.includes(rule.pattern)) {
        return { article: rule.article, work_id: rule.work_id, confidence: 'high', match: rule.pattern };
      }
    }
    
    // Встроенные ключевые слова
    const articles = type === 'income' ? INCOME_ARTICLES : EXPENSE_ARTICLES;
    for (const art of articles) {
      for (const kw of art.keywords || []) {
        if (lowerText.includes(kw)) {
          return { article: art.code, work_id: null, confidence: 'medium', match: kw };
        }
      }
    }
    
    return { article: '', work_id: null, confidence: 'none' };
  }

  // Парсинг CSV
  function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    
    const sep = lines[0].includes(';') ? ';' : ',';
    let startIdx = 0;
    const header = lines[0].toLowerCase();
    if (header.includes('дата') || header.includes('сумма') || header.includes('назначение')) {
      startIdx = 1;
    }
    
    const results = [];
    
    for (let i = startIdx; i < lines.length; i++) {
      const row = parseCSVRow(lines[i], sep);
      if (row.length < 3) continue;
      
      let date, amount, description, counterparty;
      
      if (row.length >= 6 && (row[3] === 'RUB' || row[3] === 'RUR' || row[3] === 'руб')) {
        date = parseDate(row[0] || row[1]);
        amount = parseAmount(row[2]);
        description = row[4] || '';
        counterparty = row[5] || '';
      } else if (row.length >= 5) {
        date = parseDate(row[0]);
        amount = parseAmount(row[1]);
        counterparty = row[2] || '';
        description = row[3] || row[4] || '';
      } else {
        date = parseDate(row[0]);
        amount = parseAmount(row[1]);
        description = row[2] || '';
        counterparty = '';
      }
      
      if (!date || isNaN(amount)) continue;
      
      results.push({
        id: i,
        date, amount,
        description: description.trim(),
        counterparty: counterparty.trim(),
        type: amount >= 0 ? 'income' : 'expense',
        article: '',
        work_id: null,
        status: 'pending',
        isDuplicate: false,
        hash: ''
      });
    }
    
    return results;
  }
  
  function parseCSVRow(line, sep) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === sep && !inQuotes) {
        result.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else current += char;
    }
    result.push(current.trim().replace(/^"|"$/g, ''));
    return result;
  }
  
  function parseDate(str) {
    if (!str) return null;
    str = str.trim();
    let m = str.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    return null;
  }
  
  function parseAmount(str) {
    if (!str) return NaN;
    str = String(str).trim().replace(/\s/g, '').replace(/,/g, '.').replace(/[^\d.-]/g, '');
    return parseFloat(str);
  }

  // Главное окно импорта
  async function openImportModal() {
    return new Promise(async (resolve) => {
      const works = await AsgardDB.all('works') || [];
      const customRules = await loadRules();
      
      const html = `
        <div class="stack" style="gap:16px">
          <div class="help">
            📥 <b>Импорт банковской выписки</b><br>
            <small>1. Загрузите CSV → 2. Проверьте разнесение → 3. Нажмите "Распределить"</small>
          </div>
          
          <div class="field">
            <label>Файл выписки (CSV)</label>
            <input type="file" id="bank_file" accept=".csv,.txt" class="inp"/>
          </div>
          
          <div id="import_stats" style="display:none">
            <div class="card" style="padding:12px;display:flex;gap:20px;flex-wrap:wrap">
              <div>📊 Всего: <b id="stat_total">0</b></div>
              <div style="color:var(--ok-t)">✅ Авто: <b id="stat_auto">0</b></div>
              <div style="color:var(--amber)">⚠️ Вручную: <b id="stat_manual">0</b></div>
              <div style="color:var(--err-t)">🔄 Дубли: <b id="stat_dupes">0</b></div>
            </div>
          </div>
          
          <div id="import_preview" style="display:none">
            <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
              <button class="btn mini active" data-tab="new">🆕 Новые</button>
              <button class="btn mini ghost" data-tab="manual">⚠️ Требуют разнесения</button>
              <button class="btn mini ghost" data-tab="dupes">🔄 Дубли (пропустить)</button>
              <button class="btn mini ghost" data-tab="all">📋 Все</button>
            </div>
            
            <div class="tbl-wrap" style="max-height:320px;overflow:auto">
              <table class="tbl" id="preview_table">
                <thead>
                  <tr>
                    <th style="width:30px"><input type="checkbox" id="chkAll"/></th>
                    <th>Дата</th>
                    <th>Сумма</th>
                    <th>Контрагент</th>
                    <th>Статья</th>
                    <th>Проект</th>
                  </tr>
                </thead>
                <tbody id="preview_tbody"></tbody>
              </table>
            </div>
            
            <div class="help" style="margin-top:8px">
              <span style="color:var(--ok-t)">✅</span> Распознано автоматически &nbsp;
              <span style="color:var(--amber)">⚠️</span> Требует ручного разнесения &nbsp;
              <span style="color:var(--err-t)">🔄</span> Дубль (уже импортировано)
            </div>
          </div>
          
          <div class="row" style="gap:10px;justify-content:flex-end;margin-top:8px">
            <button class="btn ghost" data-act="cancel">Отмена</button>
            <button class="btn primary" data-act="distribute" id="btnDistribute" disabled>
              ✅ Распределить
            </button>
          </div>
        </div>
      `;
      
      let parsedData = [];
      let currentTab = 'new';
      
      showModal({
        title: '📄 Импорт банковской выписки',
        html,
        wide: true,
        onMount: () => {
          const fileInput = $('#bank_file');
          const preview = $('#import_preview');
          const stats = $('#import_stats');
          const tbody = $('#preview_tbody');
          const btnDistribute = $('#btnDistribute');
          
          // Вкладки
          $$('[data-tab]').forEach(tab => {
            tab.addEventListener('click', () => {
              $$('[data-tab]').forEach(t => { t.classList.remove('active'); t.classList.add('ghost'); });
              tab.classList.add('active');
              tab.classList.remove('ghost');
              currentTab = tab.dataset.tab;
              renderTable();
            });
          });
          
          // Выбрать все
          $('#chkAll').addEventListener('change', (e) => {
            $$('.row-check:not([disabled])').forEach(c => c.checked = e.target.checked);
          });
          
          function updateStats() {
            const auto = parsedData.filter(r => r.status === 'auto' && !r.isDuplicate).length;
            const manual = parsedData.filter(r => r.status === 'pending' && !r.isDuplicate).length;
            const dupes = parsedData.filter(r => r.isDuplicate).length;
            const newOps = parsedData.filter(r => !r.isDuplicate).length;
            
            $('#stat_total').textContent = parsedData.length;
            $('#stat_auto').textContent = auto;
            $('#stat_manual').textContent = manual;
            $('#stat_dupes').textContent = dupes;
            
            // Обновляем счётчик на кнопке
            btnDistribute.textContent = `✅ Распределить (${newOps - manual})`;
          }
          
          function renderTable() {
            const expenseOpts = EXPENSE_ARTICLES.map(a => `<option value="${a.code}">${esc(a.label)}</option>`).join('');
            const incomeOpts = INCOME_ARTICLES.map(a => `<option value="${a.code}">${esc(a.label)}</option>`).join('');
            const workOpts = works.map(w => `<option value="${w.id}">${esc(w.work_number || w.contract_number || '#'+w.id)}</option>`).join('');
            
            let filtered = parsedData;
            if (currentTab === 'new') filtered = parsedData.filter(r => !r.isDuplicate);
            else if (currentTab === 'manual') filtered = parsedData.filter(r => r.status === 'pending' && !r.isDuplicate);
            else if (currentTab === 'dupes') filtered = parsedData.filter(r => r.isDuplicate);
            
            tbody.innerHTML = filtered.slice(0, 100).map((row) => {
              const isIncome = row.type === 'income';
              const opts = isIncome ? incomeOpts : expenseOpts;
              const amtStyle = isIncome ? 'color:var(--ok-t)' : 'color:var(--err-t)';
              
              let rowStyle = '';
              let statusIcon = '';
              let checkDisabled = '';
              
              if (row.isDuplicate) {
                rowStyle = 'background:rgba(239,68,68,0.08);opacity:0.6';
                statusIcon = '🔄';
                checkDisabled = 'disabled';
              } else if (row.status === 'pending') {
                rowStyle = 'background:rgba(245,158,11,0.08);border-left:3px solid var(--amber)';
                statusIcon = '⚠️';
              } else {
                rowStyle = 'border-left:3px solid var(--ok-t)';
                statusIcon = '✅';
              }
              
              return `
                <tr data-id="${row.id}" style="${rowStyle}">
                  <td>
                    <input type="checkbox" class="row-check" data-id="${row.id}" 
                      ${row.status === 'auto' && !row.isDuplicate ? 'checked' : ''} ${checkDisabled}/>
                  </td>
                  <td style="white-space:nowrap">${statusIcon} ${esc(row.date)}</td>
                  <td style="${amtStyle};font-weight:600">${row.amount.toLocaleString('ru-RU')} ₽</td>
                  <td style="max-width:160px">
                    <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis">${esc(row.counterparty || '—')}</div>
                    <div class="muted small" style="overflow:hidden;text-overflow:ellipsis">${esc((row.description || '').slice(0,40))}</div>
                  </td>
                  <td>
                    <select class="inp sel-article" data-id="${row.id}" style="min-width:120px" ${row.isDuplicate ? 'disabled' : ''}>
                      <option value="">— выбрать —</option>
                      ${opts}
                    </select>
                  </td>
                  <td>
                    <select class="inp sel-work" data-id="${row.id}" style="min-width:100px" ${row.isDuplicate ? 'disabled' : ''}>
                      <option value="">—</option>
                      ${workOpts}
                    </select>
                  </td>
                </tr>
              `;
            }).join('');
            
            // Устанавливаем значения
            filtered.slice(0, 100).forEach(row => {
              const artSel = $(`.sel-article[data-id="${row.id}"]`);
              const workSel = $(`.sel-work[data-id="${row.id}"]`);
              if (artSel && row.article) artSel.value = row.article;
              if (workSel && row.work_id) workSel.value = row.work_id;
            });
            
            // Слушатели
            $$('.sel-article').forEach(sel => {
              sel.addEventListener('change', () => {
                const id = parseInt(sel.dataset.id, 10);
                const row = parsedData.find(r => r.id === id);
                if (row && !row.isDuplicate) {
                  row.article = sel.value;
                  row.status = sel.value ? 'manual' : 'pending';
                  const chk = $(`.row-check[data-id="${id}"]`);
                  if (chk) chk.checked = !!sel.value;
                  updateStats();
                }
              });
            });
            
            $$('.sel-work').forEach(sel => {
              sel.addEventListener('change', () => {
                const id = parseInt(sel.dataset.id, 10);
                const row = parsedData.find(r => r.id === id);
                if (row) row.work_id = sel.value ? parseInt(sel.value, 10) : null;
              });
            });
          }
          
          // Загрузка файла
          fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
              toast('Загрузка', 'Анализ выписки...', 'info');
              
              const text = await file.text();
              parsedData = parseCSV(text);
              
              if (!parsedData.length) {
                toast('Ошибка', 'Не удалось распознать данные', 'err');
                return;
              }
              
              // Проверка дублей
              await checkDuplicates(parsedData);
              
              // Авто-разнесение
              for (const row of parsedData) {
                if (row.isDuplicate) continue;
                const fullText = (row.counterparty || '') + ' ' + (row.description || '');
                const detected = detectArticle(fullText, row.type, customRules);
                if (detected.article) {
                  row.article = detected.article;
                  row.work_id = detected.work_id;
                  row.status = 'auto';
                }
              }
              
              stats.style.display = 'block';
              preview.style.display = 'block';
              btnDistribute.disabled = false;
              
              updateStats();
              renderTable();
              
              const dupes = parsedData.filter(r => r.isDuplicate).length;
              const auto = parsedData.filter(r => r.status === 'auto' && !r.isDuplicate).length;
              const manual = parsedData.filter(r => r.status === 'pending' && !r.isDuplicate).length;
              
              if (dupes > 0) {
                toast('Внимание', `${dupes} операций уже импортированы ранее (пропущены)`, 'warn');
              }
              if (manual === 0 && auto > 0) {
                toast('Отлично!', `Все ${auto} новых операций распознаны`, 'ok');
              } else if (manual > 0) {
                toast('Проверьте', `${manual} операций требуют ручного разнесения`, 'warn');
              }
              
            } catch (err) {
              toast('Ошибка', err.message, 'err');
            }
          });
          
          // Кнопки
          $$('[data-act]').forEach(btn => {
            btn.addEventListener('click', async () => {
              if (btn.dataset.act === 'cancel') {
                closeModal();
                resolve(null);
                return;
              }
              
              // Распределить
              const toImport = [];
              
              parsedData.forEach(row => {
                if (row.isDuplicate) return;
                const chk = $(`.row-check[data-id="${row.id}"]`);
                if (!chk?.checked) return;
                
                const artSel = $(`.sel-article[data-id="${row.id}"]`);
                const workSel = $(`.sel-work[data-id="${row.id}"]`);
                
                const article = artSel?.value || row.article || '';
                const workId = workSel?.value ? parseInt(workSel.value, 10) : row.work_id;
                
                if (!article) return;
                
                row.article = article;
                row.work_id = workId;
                
                // Обучаем систему
                if (row.status !== 'auto' && row.counterparty && row.counterparty.length >= 3) {
                  saveRule(row.counterparty.toLowerCase().slice(0, 25), article, row.type, workId);
                }
                
                toImport.push(row);
              });
              
              if (!toImport.length) {
                toast('Ошибка', 'Выберите операции со статьёй', 'err');
                return;
              }
              
              closeModal();
              resolve(toImport);
            });
          });
        }
      });
    });
  }
  
  // Сохранение в БД
  async function importTransactions(data, userId) {
    let imported = 0;
    const now = new Date().toISOString();
    
    for (const row of data) {
      try {
        const baseData = {
          date: row.date,
          amount: Math.abs(row.amount),
          counterparty: row.counterparty,
          description: row.description,
          work_id: row.work_id,
          created_by: userId,
          created_at: now,
          source: 'bank_import',
          import_hash: row.hash // Для проверки дублей
        };
        
        if (row.type === 'income') {
          await AsgardDB.add('incomes', { ...baseData, type: row.article || 'payment' });
        } else {
          const store = row.work_id ? 'work_expenses' : 'office_expenses';
          await AsgardDB.add(store, { ...baseData, category: row.article || 'other', status: 'approved' });
        }
        imported++;
      } catch (e) {
        console.error('Import error:', e);
      }
    }
    
    return imported;
  }

  // Серверная синхронизация: отправка локальных транзакций на сервер
  async function syncToServer() {
    try {
      const auth = await AsgardAuth.getAuth();
      if (!auth?.token) return { synced: 0 };

      // Собираем из всех store где source=bank_import
      const stores = ['incomes', 'work_expenses', 'office_expenses'];
      const txList = [];

      for (const store of stores) {
        try {
          const all = await AsgardDB.getAll(store);
          const bankItems = (all || []).filter(function(r) { return r.source === 'bank_import'; });
          bankItems.forEach(function(r) {
            txList.push({
              import_hash: r.import_hash || r.hash,
              transaction_date: r.date,
              amount: r.amount,
              direction: store === 'incomes' ? 'income' : 'expense',
              counterparty_name: r.counterparty,
              payment_purpose: r.description,
              article: r.article || r.category || r.type,
              work_id: r.work_id || null,
              status: 'confirmed'
            });
          });
        } catch (e) { /* store may not exist */ }
      }

      if (!txList.length) return { synced: 0 };

      const resp = await fetch('/api/integrations/bank/sync-from-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token },
        body: JSON.stringify({ transactions: txList })
      });
      const data = await resp.json();
      return { synced: data.inserted || 0, duplicates: data.duplicates || 0 };
    } catch (e) {
      console.error('[BankImport] syncToServer error:', e);
      return { synced: 0, error: e.message };
    }
  }

  return {
    openImportModal,
    importTransactions,
    syncToServer,
    parseCSV,
    detectArticle,
    loadRules,
    saveRule,
    generateHash,
    checkDuplicates,
    EXPENSE_ARTICLES,
    INCOME_ARTICLES
  };
})();
