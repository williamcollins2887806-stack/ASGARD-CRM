/**
 * АСГАРД CRM — Предварительные заявки
 * Шаг 10: Список, карточка, AI-отчёт, модальные принять/отклонить
 */
window.AsgardPreTendersPage = (function(){
  const { $, $$, esc, toast, showModal, hideModal } = AsgardUI;

  const STATUS = {
    new:        { label: 'Новая',           cls: 'badge-info' },
    in_review:  { label: 'На рассмотрении', cls: 'badge-warning' },
    need_docs:  { label: 'Нужны документы',  cls: 'badge-warning' },
    accepted:   { label: 'Принята',         cls: 'badge-success' },
    rejected:   { label: 'Отклонена',       cls: 'badge-danger' },
    expired:    { label: 'Истекла',          cls: 'badge-muted' }
  };

  const COLOR = {
    green:  { dot: '#22c55e', bg: 'rgba(34,197,94,.08)',  border: '#22c55e', icon: '🟢', tip: 'Наш профиль, рекомендуем брать' },
    yellow: { dot: '#eab308', bg: 'rgba(234,179,8,.08)',  border: '#eab308', icon: '🟡', tip: 'Частично наш профиль / риски' },
    red:    { dot: '#ef4444', bg: 'rgba(239,68,68,.08)',  border: '#ef4444', icon: '🔴', tip: 'Не наш профиль / невыполнимо' },
    gray:   { dot: '#94a3b8', bg: 'rgba(148,163,184,.08)', border: '#94a3b8', icon: '⚪', tip: 'Без AI-анализа' }
  };

  const REJECT_REASONS = [
    'Не наш профиль работ',
    'Нет свободных специалистов',
    'Невыгодные условия',
    'Срок не подходит',
    'Другое'
  ];

  let filter = { status: '', ai_color: '', search: '' };

  function money(n) {
    return Math.round(Number(n||0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g,' ') + ' ₽';
  }

  async function api(path, opts = {}) {
    const auth = await AsgardAuth.getAuth();
    const res = await fetch('/api/pre-tenders' + path, {
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + auth.token,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    return res.json();
  }

  // ═══════════════════════════════════════════════════════════════════
  // РЕНДЕР СТРАНИЦЫ
  // ═══════════════════════════════════════════════════════════════════

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }

    const html = `
      <div class="pt-page">
        <div id="ptStats" class="pt-stats-row"></div>

        <div class="pt-filters" style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0;align-items:center">
          <select id="fPtStatus" class="inp" style="width:170px">
            <option value="">Все статусы</option>
            <option value="new" selected>Новые</option>
            <option value="in_review">На рассмотрении</option>
            <option value="need_docs">Нужны документы</option>
            <option value="accepted">Принятые</option>
            <option value="rejected">Отклонённые</option>
          </select>
          <select id="fPtColor" class="inp" style="width:160px">
            <option value="">Все цвета</option>
            <option value="green">🟢 Зелёные</option>
            <option value="yellow">🟡 Жёлтые</option>
            <option value="red">🔴 Красные</option>
          </select>
          <input id="fPtSearch" class="inp" placeholder="Поиск по заказчику, описанию..." style="flex:1;min-width:150px"/>
          <button class="btn ghost" id="btnPtRefresh">↻</button>
          <button class="btn ghost" id="btnPtCreate">+ Заявка вручную</button>
        </div>

        <div id="ptList"></div>
      </div>

      <style>
        .pt-stats-row{display:flex;gap:10px;flex-wrap:wrap}
        .pt-stat{background:var(--bg-elevated);border-radius:6px;padding:14px 18px;flex:1;min-width:100px;text-align:center}
        .pt-stat .v{font-size:26px;font-weight:900}
        .pt-stat .l{font-size:10px;color:var(--text-muted);margin-top:2px;text-transform:uppercase;letter-spacing:.5px}
        .pt-row{background:var(--bg-elevated);border-radius:6px;padding:14px 16px;margin-bottom:6px;cursor:pointer;display:grid;grid-template-columns:36px 1fr 120px 100px 100px 90px;gap:12px;align-items:center;transition:background .15s}
        .pt-row:hover{background:var(--bg-card)}
        .pt-dot{width:14px;height:14px;border-radius:50%;margin:auto}
        .pt-subj{font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .pt-cust{font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .pt-sum{font-size:12px;font-weight:600;text-align:right}
        .pt-date{font-size:11px;color:var(--text-muted);text-align:right}
        @media(max-width:800px){
          .pt-row{grid-template-columns:30px 1fr 80px;gap:8px}
          .pt-row .pt-sum,.pt-row .pt-date,.pt-row .pt-dl{display:none}
        }
        .pt-ai-card{border-radius:6px;padding:16px;margin:12px 0}
        .pt-match-bar{height:8px;border-radius:4px;background:var(--bg-elevated);overflow:hidden;margin:6px 0}
        .pt-match-fill{height:100%;border-radius:4px;transition:width .3s}
      </style>
    `;

    await layout(html, { title: title || 'Предварительные заявки' });

    filter.status = 'new'; // по умолчанию
    loadStats();
    loadList();

    $('#fPtStatus').addEventListener('change', e => { filter.status = e.target.value; loadList(); });
    $('#fPtColor').addEventListener('change', e => { filter.ai_color = e.target.value; loadList(); });
    let st;
    $('#fPtSearch').addEventListener('input', e => { clearTimeout(st); st = setTimeout(() => { filter.search = e.target.value; loadList(); }, 300); });
    $('#btnPtRefresh').addEventListener('click', () => { loadStats(); loadList(); });
    $('#btnPtCreate').addEventListener('click', openCreateManual);
  }

  // ═══════════════════════════════════════════════════════════════════
  // СТАТИСТИКА
  // ═══════════════════════════════════════════════════════════════════

  async function loadStats() {
    const el = document.getElementById('ptStats');
    if (!el) return;
    try {
      const d = await api('/stats');
      if (!d.success) return;
      el.innerHTML = `
        <div class="pt-stat"><div class="v" style="color:#3b82f6">${d.total_new || 0}</div><div class="l">Новые</div></div>
        <div class="pt-stat"><div class="v" style="color:#eab308">${d.total_in_review || 0}</div><div class="l">На рассмотрении</div></div>
        <div class="pt-stat"><div class="v" style="color:#22c55e">${d.by_color?.green || 0}</div><div class="l">🟢 Зелёные</div></div>
        <div class="pt-stat"><div class="v" style="color:#eab308">${d.by_color?.yellow || 0}</div><div class="l">🟡 Жёлтые</div></div>
        <div class="pt-stat"><div class="v" style="color:#ef4444">${d.by_color?.red || 0}</div><div class="l">🔴 Красные</div></div>
        <div class="pt-stat"><div class="v">${d.total_accepted || 0}</div><div class="l">Принято</div></div>
      `;
    } catch(e) {}
  }

  // ═══════════════════════════════════════════════════════════════════
  // СПИСОК
  // ═══════════════════════════════════════════════════════════════════

  async function loadList() {
    const el = document.getElementById('ptList');
    if (!el) return;
    el.innerHTML = '<div class="help" style="text-align:center;padding:30px">Загрузка...</div>';

    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.ai_color) params.set('ai_color', filter.ai_color);
    if (filter.search) params.set('search', filter.search);
    params.set('limit', '100');

    try {
      const d = await api('/?' + params.toString());
      if (!d.success || !d.items?.length) {
        el.innerHTML = '<div class="asg-empty"><div class="asg-empty-icon">\u{1F4ED}</div><div class="asg-empty-text">Нет заявок</div></div>';
        return;
      }

      // Заголовок таблицы
      el.innerHTML = `<div class="pt-row" style="cursor:default;font-size:11px;font-weight:700;color:var(--text-muted);border:none;background:none">
        <div></div><div>Заказчик / Описание</div><div>Статус</div><div style="text-align:right">Сумма</div><div style="text-align:right">Дедлайн</div><div style="text-align:right">Дата</div>
      </div>` + d.items.map(renderRow).join('');

      el.querySelectorAll('.pt-row[data-id]').forEach(row => {
        row.addEventListener('click', () => openDetail(parseInt(row.dataset.id)));
      });
    } catch(e) {
      el.innerHTML = '<div class="help" style="color:var(--red)">Ошибка загрузки</div>';
    }
  }

  function renderRow(it) {
    const c = COLOR[it.ai_color] || COLOR.gray;
    const st = STATUS[it.status] || STATUS.new;
    const date = it.created_at ? new Date(it.created_at).toLocaleDateString('ru-RU') : '';
    const dl = it.work_deadline ? new Date(it.work_deadline).toLocaleDateString('ru-RU') : '—';

    return `<div class="pt-row" data-id="${it.id}">
      <div><div class="pt-dot" style="background:${c.dot}" title="${esc(c.tip)}"></div></div>
      <div>
        <div class="pt-subj">${esc(it.customer_name || it.email_from_name || '—')}</div>
        <div class="pt-cust">${esc((it.email_subject || it.work_description || '').slice(0, 80))}</div>
      </div>
      <div><span class="${st.cls}">${st.label}</span></div>
      <div class="pt-sum">${it.estimated_sum ? money(it.estimated_sum) : '—'}</div>
      <div class="pt-dl pt-date">${dl}</div>
      <div class="pt-date">${date}</div>
    </div>`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // КАРТОЧКА ЗАЯВКИ
  // ═══════════════════════════════════════════════════════════════════

  async function openDetail(id) {
    const d = await api('/' + id);
    if (!d.success) { toast('Ошибка', 'Не найдена', 'err'); return; }
    const it = d.item;
    const c = COLOR[it.ai_color] || COLOR.gray;
    const st = STATUS[it.status] || STATUS.new;
    const score = it.ai_work_match_score || 0;
    const scoreColor = score >= 70 ? '#22c55e' : score >= 30 ? '#eab308' : '#ef4444';
    const canEdit = ['new','in_review','need_docs'].includes(it.status);

    // Вспомогательная функция для редактируемого поля
    function editField(label, field, val, type) {
      if (!canEdit) return `<div><b>${label}:</b> ${esc(val || '—')}</div>`;
      const inputType = type === 'date' ? 'date' : type === 'number' ? 'number' : 'text';
      const displayVal = type === 'date' && val ? val.slice(0, 10) : (val || '');
      return `<div class="pt-edit-field" style="position:relative">
        <b>${label}:</b> <span class="pt-edit-val" data-field="${field}" style="cursor:pointer;border-bottom:1px dashed var(--text-muted)">${esc(val || '—')}</span>
        <input class="inp pt-edit-input" data-field="${field}" type="${inputType}" value="${esc(displayVal)}" style="display:none;font-size:12px;padding:2px 6px;width:120px"/>
      </div>`;
    }

    // Подготавливаем список загруженных вручную документов
    const manualDocs = it.manual_documents || [];
    const allDocsCount = (d.attachments?.length || 0) + manualDocs.length;

    const html = `<div style="max-width:750px">
      <!-- Шапка -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div><span class="${st.cls}" style="font-size:13px">${st.label}</span> <span style="margin-left:8px">${c.icon} ${esc(c.tip)}</span></div>
        <span style="color:var(--text-muted);font-size:12px">#${it.id}</span>
      </div>

      <!-- Блок 1: Информация о заказчике (inline editing) -->
      <div style="background:var(--bg-elevated);border-radius:6px;padding:16px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-weight:700">Заказчик</span>
          ${canEdit ? '<span style="font-size:10px;color:var(--text-muted)">Нажмите на значение для редактирования</span>' : ''}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
          ${editField('Компания', 'customer_name', it.customer_name)}
          ${editField('ИНН', 'customer_inn', it.customer_inn)}
          ${editField('Email', 'customer_email', it.customer_email)}
          ${editField('Контакт', 'contact_person', it.contact_person)}
          ${editField('Телефон', 'contact_phone', it.contact_phone)}
          ${editField('Место', 'work_location', it.work_location)}
          ${editField('Дедлайн', 'work_deadline', it.work_deadline, 'date')}
          ${editField('Сумма', 'estimated_sum', it.estimated_sum, 'number')}
        </div>
        ${it.work_description ? `<div style="margin-top:8px;font-size:12px"><b>Описание:</b> ${esc(it.work_description.slice(0, 300))}${it.work_description.length > 300 ? '...' : ''}</div>` : ''}
      </div>

      <!-- Блок 2: AI-отчёт -->
      ${it.ai_summary ? `
      <div class="pt-ai-card" style="background:${c.bg};border-left:4px solid ${c.border}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-weight:700">🤖 AI-анализ</span>
          <span style="font-size:11px;color:var(--text-muted)">${it.ai_processed_at ? new Date(it.ai_processed_at).toLocaleString('ru-RU') : ''}</span>
        </div>
        <div style="font-size:13px;line-height:1.6;margin-bottom:12px;white-space:pre-line">${esc(it.ai_summary)}</div>
        ${it.ai_recommendation ? `<div style="font-size:12px;padding:8px 12px;background:var(--bg-elevated);border-radius:6px;margin-bottom:8px"><b>Рекомендация:</b> ${esc(it.ai_recommendation)}</div>` : ''}
        <div style="font-size:12px;margin-bottom:4px"><b>Соответствие профилю:</b> ${score}%</div>
        <div class="pt-match-bar"><div class="pt-match-fill" style="width:${score}%;background:${scoreColor}"></div></div>
        ${it.ai_workload_warning ? `<div style="margin-top:8px;font-size:12px;color:var(--amber)">⚠️ ${esc(it.ai_workload_warning)}</div>` : ''}
        <button class="btn ghost mini" id="btnReanalyze" style="margin-top:8px">🔄 Перезапросить анализ</button>
      </div>` : `
      <div style="background:var(--bg-elevated);border-radius:6px;padding:20px;margin-bottom:12px;text-align:center">
        <div class="help">AI-анализ не проводился</div>
        <button class="btn ghost" id="btnRunAnalysis" style="margin-top:8px">🤖 Запустить AI-анализ</button>
      </div>`}

      <!-- Блок 3: Оригинальное письмо -->
      ${it.email_id ? `
      <details style="margin-bottom:12px">
        <summary style="cursor:pointer;font-weight:700;font-size:13px;padding:8px 0">📧 Оригинальное письмо</summary>
        <div style="padding:12px;background:var(--bg-elevated);border-radius:6px;margin-top:4px">
          <div style="font-size:12px;margin-bottom:8px">
            <b>От:</b> ${esc(it.email_from_name || '')} &lt;${esc(it.email_from || '')}&gt;<br>
            <b>Тема:</b> ${esc(it.email_subject || '')}<br>
            <b>Дата:</b> ${it.email_date ? new Date(it.email_date).toLocaleString('ru-RU') : '—'}
          </div>
          <div style="font-size:12px;max-height:300px;overflow:auto;white-space:pre-wrap;border-top:1px solid var(--line);padding-top:8px">${esc(it.email_body_text || '(пусто)')}</div>
          <div style="margin-top:8px;text-align:right">
            <a href="#/mailbox?email=${it.email_id}" class="btn ghost mini" style="font-size:11px">📬 Открыть в почте</a>
          </div>
        </div>
      </details>` : ''}

      <!-- Блок 4: Документы + Загрузка -->
      <details style="margin-bottom:12px" ${allDocsCount > 0 || canEdit ? 'open' : ''}>
        <summary style="cursor:pointer;font-weight:700;font-size:13px;padding:8px 0">📎 Документы (${allDocsCount})</summary>
        <div style="margin-top:4px">
          ${(d.attachments || []).map(a => `<div style="padding:4px 0;font-size:12px">📄 ${esc(a.original_filename)} <span class="help">(${Math.round((a.size||0)/1024)} КБ)</span></div>`).join('')}
          ${manualDocs.map(a => `<div style="padding:4px 0;font-size:12px">📎 ${esc(a.original_name || a.filename)} <span class="help">(${Math.round((a.size||0)/1024)} КБ, загружено вручную)</span></div>`).join('')}
          ${canEdit ? `
          <div id="ptUploadZone" style="margin-top:10px;padding:20px;border:2px dashed var(--line);border-radius:6px;text-align:center;cursor:pointer;transition:border-color .2s">
            <div style="font-size:24px;margin-bottom:4px">📎</div>
            <div style="font-size:12px;color:var(--text-muted)">Перетащите файлы сюда или нажмите для загрузки</div>
            <input type="file" id="ptFileInput" multiple style="display:none"/>
          </div>
          <button class="btn ghost mini" id="btnReanalyzeAfterUpload" style="margin-top:8px;display:none">🤖 Анализировать (после загрузки)</button>` : ''}
        </div>
      </details>

      <!-- Решение (если есть) -->
      ${it.decision_by_name ? `
      <div style="padding:12px;background:var(--bg-elevated);border-radius:6px;margin-bottom:12px;font-size:12px">
        <b>Решение:</b> ${esc(it.decision_by_name)} · ${it.decision_at ? new Date(it.decision_at).toLocaleString('ru-RU') : ''}
        ${it.decision_comment ? '<br><b>Комментарий:</b> ' + esc(it.decision_comment) : ''}
        ${it.reject_reason ? '<br><b>Причина:</b> ' + esc(it.reject_reason) : ''}
        ${it.created_tender_id ? '<br><a href="#/tenders/' + it.created_tender_id + '" style="color:var(--blue)">Тендер #' + it.created_tender_id + ' →</a>' : ''}
      </div>` : ''}

      <!-- Блок 5: Действия -->
      ${canEdit ? `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;padding-top:16px;border-top:1px solid var(--line)">
        <button class="btn" id="btnAcceptPT" style="background:#22c55e;color:var(--text);font-weight:800;flex:1;min-width:160px;font-size:14px;padding:12px">🟢 ПРИНЯТЬ В РАБОТУ</button>
        <button class="btn" id="btnRejectPT" style="background:#ef4444;flex:1;min-width:140px;font-size:14px;padding:12px">🔴 ОТКЛОНИТЬ</button>
        <button class="btn ghost" id="btnRequestDocs" style="min-width:120px">📄 Запросить документы</button>
      </div>` : ''}

      <!-- Цепочка переписки -->
      ${d.thread?.length > 1 ? `
      <details style="margin-top:12px">
        <summary style="cursor:pointer;font-weight:700;font-size:13px;padding:8px 0">💬 Цепочка (${d.thread.length})</summary>
        <div style="margin-top:4px">${d.thread.map(t => `
          <div style="padding:6px 0;border-bottom:1px solid var(--line);font-size:12px">
            <span style="color:${t.direction === 'inbound' ? 'var(--blue)' : 'var(--green)'}">${t.direction === 'inbound' ? '← входящее' : '→ исходящее'}</span>
            ${esc(t.from_name || t.from_email || '')} · ${esc((t.snippet || '').slice(0, 60))}
            <span class="help" style="float:right">${t.email_date ? new Date(t.email_date).toLocaleDateString('ru-RU') : ''}</span>
          </div>`).join('')}
        </div>
      </details>` : ''}
    </div>`;

    showModal({ title: 'Заявка #' + id, html, wide: true, onMount: () => {
      // ── Inline editing ───────────────────────────────────────────
      document.querySelectorAll('.pt-edit-val').forEach(span => {
        span.addEventListener('click', () => {
          const field = span.dataset.field;
          const input = span.parentElement.querySelector('.pt-edit-input');
          if (!input) return;
          span.style.display = 'none';
          input.style.display = 'inline-block';
          input.focus();

          const save = async () => {
            let val = input.value;
            if (input.type === 'number') val = val ? Number(val) : null;
            if (input.type === 'date') val = val || null;
            input.style.display = 'none';
            span.style.display = '';
            span.textContent = val || '—';
            await api('/' + id, { method: 'PUT', body: { [field]: val } });
          };
          input.addEventListener('blur', save, { once: true });
          input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.style.display = 'none'; span.style.display = ''; }});
        });
      });

      // ── AI анализ ────────────────────────────────────────────────
      const btnAI = document.getElementById('btnReanalyze') || document.getElementById('btnRunAnalysis');
      if (btnAI) btnAI.addEventListener('click', async () => {
        btnAI.disabled = true; btnAI.textContent = '⏳ Анализ...';
        const r = await api('/' + id + '/analyze', { method: 'POST' });
        if (r.success) { toast('AI', 'Анализ завершён'); hideModal(); openDetail(id); loadStats(); loadList(); }
        else { toast('Ошибка', r.error || '', 'err'); btnAI.disabled = false; btnAI.textContent = '🔄 Перезапросить'; }
      });

      // ── Загрузка документов (drag & drop + click) ────────────────
      const uploadZone = document.getElementById('ptUploadZone');
      const fileInput = document.getElementById('ptFileInput');
      const btnReUp = document.getElementById('btnReanalyzeAfterUpload');
      if (uploadZone && fileInput) {
        uploadZone.addEventListener('click', () => fileInput.click());
        uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.style.borderColor = 'var(--gold)'; });
        uploadZone.addEventListener('dragleave', () => { uploadZone.style.borderColor = 'var(--line)'; });
        uploadZone.addEventListener('drop', e => {
          e.preventDefault(); uploadZone.style.borderColor = 'var(--line)';
          if (e.dataTransfer.files.length) doUpload(e.dataTransfer.files);
        });
        fileInput.addEventListener('change', () => { if (fileInput.files.length) doUpload(fileInput.files); });

        async function doUpload(files) {
          uploadZone.innerHTML = '<div style="font-size:12px;color:var(--text-muted)">⏳ Загрузка ' + files.length + ' файл(ов)...</div>';
          const auth = await AsgardAuth.getAuth();
          const fd = new FormData();
          for (const f of files) fd.append('files', f);
          try {
            const resp = await fetch('/api/pre-tenders/' + id + '/upload-docs', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + auth.token },
              body: fd
            });
            const r = await resp.json();
            if (r.success) {
              toast('Загружено', r.uploaded.length + ' файл(ов)');
              if (btnReUp) btnReUp.style.display = '';
              hideModal(); openDetail(id);
            } else {
              toast('Ошибка', r.error || '', 'err');
              uploadZone.innerHTML = '<div style="font-size:12px;color:var(--red)">Ошибка загрузки</div>';
            }
          } catch(err) {
            toast('Ошибка', 'Сбой загрузки', 'err');
          }
        }
      }
      if (btnReUp) btnReUp.addEventListener('click', async () => {
        btnReUp.disabled = true; btnReUp.textContent = '⏳ Анализ...';
        const r = await api('/' + id + '/analyze', { method: 'POST' });
        if (r.success) { toast('AI', 'Анализ обновлён'); hideModal(); openDetail(id); loadStats(); loadList(); }
      });

      // ── Принять ──────────────────────────────────────────────────
      const btnAcc = document.getElementById('btnAcceptPT');
      if (btnAcc) btnAcc.addEventListener('click', () => openAcceptModal(id, it));

      // ── Отклонить ────────────────────────────────────────────────
      const btnRej = document.getElementById('btnRejectPT');
      if (btnRej) btnRej.addEventListener('click', () => openRejectModal(id, it));

      // ── Запросить документы ──────────────────────────────────────
      const btnDocs = document.getElementById('btnRequestDocs');
      if (btnDocs) btnDocs.addEventListener('click', async () => {
        const comment = prompt('Комментарий для запроса документов:');
        if (comment === null) return;
        const r = await api('/' + id + '/request-docs', { method: 'POST', body: { comment } });
        if (r.success) { toast('Статус', 'Запрос документов отправлен'); hideModal(); loadStats(); loadList(); }
      });
    }});
  }

  // ═══════════════════════════════════════════════════════════════════
  // МОДАЛЬНОЕ ОКНО: ПРИНЯТЬ
  // ═══════════════════════════════════════════════════════════════════

  async function openAcceptModal(id, pt) {
    // Получаем список РП
    let pmOptions = '<option value="">— Не назначать —</option>';
    try {
      const auth = await AsgardAuth.getAuth();
      const usersRes = await fetch('/api/users', { headers: { 'Authorization': 'Bearer ' + auth.token } });
      const usersData = await usersRes.json();
      const pms = (usersData.items || usersData || []).filter(u => u.is_active && ['PM', 'HEAD_PM'].includes(u.role));
      pmOptions += pms.map(u => `<option value="${u.id}">${esc(u.name || u.fio || '')}</option>`).join('');
    } catch(e) {}

    const emailSubject = 'Re: ' + esc(pt.email_subject || pt.work_description?.slice(0, 50) || 'заявка');

    const mHtml = `
      <div style="max-width:550px">
        <div style="margin-bottom:12px;font-size:13px;color:var(--text-muted)">
          Заявка от <b>${esc(pt.customer_name || pt.customer_email || '—')}</b> будет принята.<br>
          Автоматически создаётся тендер.
        </div>

        <div style="display:grid;gap:12px">
          <div>
            <label style="font-size:12px;font-weight:600">Назначить РП</label>
            <select id="accPM" class="inp">${pmOptions}</select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600">Контактное лицо</label>
            <input id="accContact" class="inp" value="${esc(pt.contact_person || '')}" placeholder="ФИО менеджера"/>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600">Телефон</label>
            <input id="accPhone" class="inp" value="${esc(pt.contact_phone || '')}" placeholder="+7..."/>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600">Комментарий</label>
            <textarea id="accComment" class="inp" rows="2" placeholder="Доп. информация..."></textarea>
          </div>
          <div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
              <input type="checkbox" id="accSendEmail" checked/>
              Отправить письмо заказчику (шаблон tender_accept)
            </label>
          </div>
        </div>

        <!-- Превью письма -->
        <div id="accEmailPreview" style="margin-top:12px;padding:12px;background:var(--bg-elevated);border-radius:6px;border-left:3px solid #22c55e;font-size:12px">
          <div style="font-weight:700;margin-bottom:6px">Превью письма:</div>
          <div style="color:var(--text-muted);margin-bottom:4px"><b>Кому:</b> ${esc(pt.customer_email || '—')}</div>
          <div style="color:var(--text-muted);margin-bottom:4px"><b>Тема:</b> ${emailSubject}</div>
          <div style="border-top:1px solid var(--line);padding-top:6px;margin-top:4px;line-height:1.5" id="accPreviewBody">
            Здравствуйте!<br><br>
            Благодарим вас за обращение. Мы рассмотрели вашу заявку и готовы принять её в работу.<br><br>
            Ваш контактный менеджер: <b id="accPreviewContact">${esc(pt.contact_person || 'менеджер')}</b><br>
            Телефон: <b id="accPreviewPhone">${esc(pt.contact_phone || '')}</b><br><br>
            С уважением,<br>ООО "Асгард Сервис"
          </div>
        </div>

        <div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-end">
          <button class="btn ghost" id="accCancelBtn">Отмена</button>
          <button class="btn" id="accConfirmBtn" style="background:#22c55e;color:var(--text);font-weight:800;padding:10px 24px">✅ Подтвердить</button>
        </div>
      </div>
    `;

    showModal({ title: '🟢 Принять заявку #' + id, html: mHtml, onMount: () => {
      // Обновление превью при изменении контакта/телефона
      const contactInp = document.getElementById('accContact');
      const phoneInp = document.getElementById('accPhone');
      const prevContact = document.getElementById('accPreviewContact');
      const prevPhone = document.getElementById('accPreviewPhone');
      const previewDiv = document.getElementById('accEmailPreview');
      const sendCb = document.getElementById('accSendEmail');

      if (contactInp && prevContact) contactInp.addEventListener('input', () => { prevContact.textContent = contactInp.value || 'менеджер'; });
      if (phoneInp && prevPhone) phoneInp.addEventListener('input', () => { prevPhone.textContent = phoneInp.value || ''; });
      if (sendCb && previewDiv) sendCb.addEventListener('change', () => { previewDiv.style.display = sendCb.checked ? '' : 'none'; });

      document.getElementById('accCancelBtn').addEventListener('click', () => { hideModal(); openDetail(id); });
      document.getElementById('accConfirmBtn').addEventListener('click', async () => {
        const btn = document.getElementById('accConfirmBtn');
        btn.disabled = true; btn.textContent = '⏳ Обработка...';

        const body = {
          assigned_pm_id: document.getElementById('accPM').value || null,
          contact_person: document.getElementById('accContact').value,
          contact_phone: document.getElementById('accPhone').value,
          comment: document.getElementById('accComment').value,
          send_email: document.getElementById('accSendEmail').checked
        };

        const r = await api('/' + id + '/accept', { method: 'POST', body });
        if (r.success) {
          toast('Принята', r.tender_id ? 'Тендер #' + r.tender_id + ' создан' : 'Заявка принята');
          hideModal(); loadStats(); loadList();
        } else {
          toast('Ошибка', r.error || 'Не удалось', 'err');
          btn.disabled = false; btn.textContent = '✅ Подтвердить';
        }
      });
    }});
  }

  // ═══════════════════════════════════════════════════════════════════
  // МОДАЛЬНОЕ ОКНО: ОТКЛОНИТЬ
  // ═══════════════════════════════════════════════════════════════════

  function openRejectModal(id, pt) {
    const reasonOpts = REJECT_REASONS.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    const emailSubject = 'Re: ' + esc(pt.email_subject || 'заявка');

    const mHtml = `
      <div style="max-width:550px">
        <div style="margin-bottom:12px;font-size:13px;color:var(--text-muted)">
          Заявка от <b>${esc(pt.customer_name || pt.customer_email || '—')}</b> будет отклонена.
        </div>

        <div style="display:grid;gap:12px">
          <div>
            <label style="font-size:12px;font-weight:600">Причина отказа</label>
            <select id="rejReason" class="inp">${reasonOpts}</select>
          </div>
          <div>
            <label style="font-size:12px;font-weight:600">Дополнительный комментарий</label>
            <textarea id="rejComment" class="inp" rows="2" placeholder="Необязательно..."></textarea>
          </div>
          <div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
              <input type="checkbox" id="rejSendEmail" checked/>
              Отправить письмо с отказом (шаблон tender_reject)
            </label>
          </div>
        </div>

        <!-- Превью письма -->
        <div id="rejEmailPreview" style="margin-top:12px;padding:12px;background:var(--bg-elevated);border-radius:6px;border-left:3px solid #ef4444;font-size:12px">
          <div style="font-weight:700;margin-bottom:6px">Превью письма:</div>
          <div style="color:var(--text-muted);margin-bottom:4px"><b>Кому:</b> ${esc(pt.customer_email || '—')}</div>
          <div style="color:var(--text-muted);margin-bottom:4px"><b>Тема:</b> ${emailSubject}</div>
          <div style="border-top:1px solid var(--line);padding-top:6px;margin-top:4px;line-height:1.5">
            Здравствуйте!<br><br>
            Благодарим вас за обращение. К сожалению, мы вынуждены отклонить данную заявку<span id="rejPreviewReason">, в связи с: ${esc(REJECT_REASONS[0])}</span>.<br><br>
            С уважением,<br>ООО "Асгард Сервис"
          </div>
        </div>

        <div style="display:flex;gap:10px;margin-top:16px;justify-content:flex-end">
          <button class="btn ghost" id="rejCancelBtn">Отмена</button>
          <button class="btn" id="rejConfirmBtn" style="background:#ef4444;padding:10px 24px;font-weight:800">❌ Подтвердить отказ</button>
        </div>
      </div>
    `;

    showModal({ title: '🔴 Отклонить заявку #' + id, html: mHtml, onMount: () => {
      // Обновление превью при смене причины
      const reasonSel = document.getElementById('rejReason');
      const commentInp = document.getElementById('rejComment');
      const prevReason = document.getElementById('rejPreviewReason');
      const previewDiv = document.getElementById('rejEmailPreview');
      const sendCb = document.getElementById('rejSendEmail');

      function updateRejectPreview() {
        if (!prevReason) return;
        const reason = reasonSel.value;
        const comment = commentInp.value;
        const full = comment ? reason + '. ' + comment : reason;
        prevReason.textContent = ', в связи с: ' + full;
      }
      if (reasonSel) reasonSel.addEventListener('change', updateRejectPreview);
      if (commentInp) commentInp.addEventListener('input', updateRejectPreview);
      if (sendCb && previewDiv) sendCb.addEventListener('change', () => { previewDiv.style.display = sendCb.checked ? '' : 'none'; });

      document.getElementById('rejCancelBtn').addEventListener('click', () => { hideModal(); openDetail(id); });
      document.getElementById('rejConfirmBtn').addEventListener('click', async () => {
        const btn = document.getElementById('rejConfirmBtn');
        btn.disabled = true; btn.textContent = '⏳...';

        const reason = document.getElementById('rejReason').value;
        const comment = document.getElementById('rejComment').value;
        const fullReason = comment ? reason + '. ' + comment : reason;

        const r = await api('/' + id + '/reject', {
          method: 'POST',
          body: { reject_reason: fullReason, send_email: document.getElementById('rejSendEmail').checked }
        });

        if (r.success) {
          toast('Отклонена', 'Заявка отклонена');
          hideModal(); loadStats(); loadList();
        } else {
          toast('Ошибка', r.error || '', 'err');
          btn.disabled = false; btn.textContent = '❌ Подтвердить отказ';
        }
      });
    }});
  }

  // ═══════════════════════════════════════════════════════════════════
  // РУЧНОЕ СОЗДАНИЕ
  // ═══════════════════════════════════════════════════════════════════

  function openCreateManual() {
    const mHtml = `
      <div style="max-width:500px;display:grid;gap:12px">
        <div><label style="font-size:12px;font-weight:600">Заказчик *</label><input id="mcName" class="inp" placeholder="ООО ..."/></div>
        <div><label style="font-size:12px;font-weight:600">Email</label><input id="mcEmail" class="inp" placeholder="email@company.ru"/></div>
        <div><label style="font-size:12px;font-weight:600">ИНН</label><input id="mcInn" class="inp" placeholder=""/></div>
        <div><label style="font-size:12px;font-weight:600">Контактное лицо</label><input id="mcContact" class="inp"/></div>
        <div><label style="font-size:12px;font-weight:600">Телефон</label><input id="mcPhone" class="inp"/></div>
        <div><label style="font-size:12px;font-weight:600">Описание работ *</label><textarea id="mcDesc" class="inp" rows="3"></textarea></div>
        <div><label style="font-size:12px;font-weight:600">Место</label><input id="mcLoc" class="inp"/></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><label style="font-size:12px;font-weight:600">Дедлайн</label><input id="mcDl" class="inp" type="date"/></div>
          <div><label style="font-size:12px;font-weight:600">Сумма</label><input id="mcSum" class="inp" type="number"/></div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
          <button class="btn ghost" onclick="AsgardUI.hideModal()">Отмена</button>
          <button class="btn" id="mcSave">Создать заявку</button>
        </div>
      </div>
    `;

    showModal({ title: 'Создать заявку вручную', html: mHtml, onMount: () => {
      document.getElementById('mcSave').addEventListener('click', async () => {
        const body = {
          customer_name: document.getElementById('mcName').value,
          customer_email: document.getElementById('mcEmail').value,
          customer_inn: document.getElementById('mcInn').value,
          contact_person: document.getElementById('mcContact').value,
          contact_phone: document.getElementById('mcPhone').value,
          work_description: document.getElementById('mcDesc').value,
          work_location: document.getElementById('mcLoc').value,
          work_deadline: document.getElementById('mcDl').value || null,
          estimated_sum: document.getElementById('mcSum').value || null
        };
        if (!body.customer_name && !body.work_description) {
          toast('Ошибка', 'Укажите заказчика или описание', 'err'); return;
        }
        const r = await api('/', { method: 'POST', body });
        if (r.success) { toast('Создано', 'Заявка #' + r.id); hideModal(); loadStats(); loadList(); }
        else { toast('Ошибка', r.error || '', 'err'); }
      });
    }});
  }

  return { render };
})();
