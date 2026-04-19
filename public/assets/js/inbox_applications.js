/**
 * АСГАРД CRM — Входящие заявки (AI-анализ)
 * Фаза 9: Список, карточка, фильтры, принятие/отклонение
 */
window.AsgardInboxApplicationsPage = (function(){
  const { $, $$, esc, toast, showModal, hideModal } = AsgardUI;

  const STATUS_MAP = {
    new:           { label: 'Новая',          badge: 'badge-info' },
    ai_processed:  { label: 'AI обработана',  badge: 'badge-primary' },
    under_review:  { label: 'На рассмотрении', badge: 'badge-warning' },
    accepted:      { label: 'Принята',        badge: 'badge-success' },
    rejected:      { label: 'Отклонена',      badge: 'badge-danger' },
    archived:      { label: 'Архив',          badge: 'badge-muted' }
  };

  const CLASS_MAP = {
    direct_request:   'Прямой запрос',
    platform_tender:  'Тендер',
    commercial_offer: 'Коммерч. предложение',
    information:      'Информация',
    spam:             'Спам',
    personal:         'Личное',
    other:            'Другое'
  };

  const COLOR_MAP = {
    green:  { bg: '#16a34a22', border: 'var(--ok)', icon: '🟢', label: 'Наш профиль' },
    yellow: { bg: '#eab30822', border: 'var(--amber)', icon: '🟡', label: 'Требует оценки' },
    red:    { bg: '#dc262622', border: 'var(--red)', icon: '🔴', label: 'Не наш профиль' }
  };

  let currentFilter = { status: '', color: '', search: '' };
  let currentItems = [];

  function money(x) { return AsgardUI.money(Math.round(Number(x || 0))) + ' ₽'; }

  // ── API ────────────────────────────────────────────────────────────

  async function api(path, opts = {}) {
    const auth = await AsgardAuth.getAuth();
    const res = await fetch('/api/inbox-applications' + path, {
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + auth.token,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    return res.json();
  }

  // ── Рендер страницы ────────────────────────────────────────────────

  async function render({ layout, title }) {
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }

    const html = `
      <div class="inbox-app-page">
        <!-- Статистика -->
        <div id="inboxStats" class="inbox-stats"></div>

        <!-- Фильтры -->
        <div class="inbox-filters" style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0;align-items:center">
          <div id="crw_fStatus" style="width:160px"></div>
          <div id="crw_fColor" style="width:160px"></div>
          <input id="fSearch" class="inp" placeholder="Поиск..." style="flex:1;min-width:150px"/>
          <button class="btn ghost" id="btnRefreshInbox">↻ Обновить</button>
        </div>

        <!-- Список -->
        <div id="inboxList"></div>
      </div>

      <style>
        .inbox-stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px}
        .inbox-stat{background:var(--bg-card);border:1px solid var(--line);border-radius:6px;padding:16px 20px;flex:1;min-width:120px;text-align:center}
        .inbox-stat .val{font-size:28px;font-weight:900}
        .inbox-stat .lbl{font-size:11px;color:var(--text-muted);margin-top:4px;text-transform:uppercase}
        .inbox-card{background:var(--bg-card);border:1px solid var(--line);border-radius:6px;padding:16px;margin-bottom:8px;cursor:pointer;transition:border-color .2s,box-shadow .2s}
        .inbox-card:hover{border-color:var(--gold);box-shadow:0 2px 12px rgba(242,208,138,.15)}
        .inbox-card .ic-top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px}
        .inbox-card .ic-subject{font-weight:700;font-size:14px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .inbox-card .ic-meta{font-size:12px;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap}
        .inbox-card .ic-ai{font-size:12px;margin-top:8px;padding:8px 12px;border-radius:6px}
        .badge-info{background:#3b82f622;color:var(--info);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
        .badge-primary{background:#8b5cf622;color:var(--purple);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
        .badge-warning{background:#eab30822;color:var(--amber);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
        .badge-success{background:#16a34a22;color:var(--ok);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
        .badge-danger{background:#dc262622;color:var(--red);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
        .badge-muted{background:#94a3b822;color:var(--t2);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700}
        .inbox-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px;padding-top:16px;border-top:1px solid var(--line)}
        .inbox-actions .btn{min-width:120px;padding:10px 20px;font-size:13px;font-weight:700;letter-spacing:.3px}
        .inbox-actions .btn.success{background:var(--grad-green, linear-gradient(135deg,var(--ok),var(--ok)));border-color:var(--ok);color:#fff}
        .inbox-actions .btn.success:hover{box-shadow:0 4px 15px rgba(22,163,74,.35);transform:translateY(-1px)}
        .inbox-actions .btn.danger{background:var(--grad-red, linear-gradient(135deg,var(--red),var(--red-h)));border-color:var(--red);color:#fff}
        .inbox-actions .btn.danger:hover{box-shadow:0 4px 15px rgba(220,38,38,.35);transform:translateY(-1px)}
        .inbox-actions .btn.secondary{background:var(--grad-blue);border-color:var(--info);color:#fff}
        .inbox-actions .btn.secondary:hover{box-shadow:0 4px 15px rgba(59,130,246,.35);transform:translateY(-1px)}
      </style>
    `;

    await layout(html, { title: title || 'Входящие заявки (AI)' });

    $('#crw_fStatus')?.appendChild(CRSelect.create({
      id: 'fStatus', fullWidth: true, placeholder: 'Все статусы', clearable: true,
      options: [
        { value: 'new', label: 'Новые' },
        { value: 'ai_processed', label: 'AI обработаны' },
        { value: 'under_review', label: 'На рассмотрении' },
        { value: 'accepted', label: 'Принятые' },
        { value: 'rejected', label: 'Отклонённые' },
        { value: 'archived', label: 'Архив' }
      ],
      onChange: (v) => { currentFilter.status = v; loadList(); }
    }));
    $('#crw_fColor')?.appendChild(CRSelect.create({
      id: 'fColor', fullWidth: true, placeholder: 'Все цвета', clearable: true,
      options: [
        { value: 'green', label: 'Зелёные' },
        { value: 'yellow', label: 'Жёлтые' },
        { value: 'red', label: 'Красные' }
      ],
      onChange: (v) => { currentFilter.color = v; loadList(); }
    }));

    // Загрузить данные
    loadStats();
    loadList();
    let searchTimer;
    $('#fSearch').addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { currentFilter.search = e.target.value; loadList(); }, 300);
    });
    $('#btnRefreshInbox').addEventListener('click', () => { loadStats(); loadList(); });
  }

  // ── Загрузка статистики ────────────────────────────────────────────

  async function loadStats() {
    const el = document.getElementById('inboxStats');
    if (!el) return;
    try {
      const data = await api('/stats/summary');
      if (!data.success) { el.innerHTML = ''; return; }
      const s = data.stats;
      el.innerHTML = `
        <div class="inbox-stat"><div class="val" style="color:var(--gold)">${s.total || 0}</div><div class="lbl">Всего</div></div>
        <div class="inbox-stat"><div class="val" style="color:var(--info)">${(s.byStatus?.new || 0) + (s.byStatus?.ai_processed || 0)}</div><div class="lbl">Новые</div></div>
        <div class="inbox-stat"><div class="val" style="color:var(--ok)">${s.byColor?.green || 0}</div><div class="lbl">🟢 Зелёные</div></div>
        <div class="inbox-stat"><div class="val" style="color:var(--amber)">${s.byColor?.yellow || 0}</div><div class="lbl">🟡 Жёлтые</div></div>
        <div class="inbox-stat"><div class="val" style="color:var(--red)">${s.byColor?.red || 0}</div><div class="lbl">🔴 Красные</div></div>
        <div class="inbox-stat"><div class="val">${s.recentWeek || 0}</div><div class="lbl">За неделю</div></div>
      `;
    } catch(e) { el.innerHTML = ''; }
  }

  // ── Загрузка списка ────────────────────────────────────────────────

  async function loadList() {
    const el = document.getElementById('inboxList');
    if (!el) return;
    el.innerHTML = '<div class="help" style="text-align:center;padding:20px">Загрузка...</div>';

    const params = new URLSearchParams();
    if (currentFilter.status) params.set('status', currentFilter.status);
    if (currentFilter.color) params.set('color', currentFilter.color);
    if (currentFilter.search) params.set('search', currentFilter.search);
    params.set('limit', '100');

    try {
      const data = await api('/?' + params.toString());
      if (!data.success || !data.items?.length) {
        el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><div style="font-size:48px;margin-bottom:12px">📭</div>Нет заявок</div>';
        return;
      }
      currentItems = data.items;
      el.innerHTML = data.items.map(renderCard).join('');

      // Клики по карточкам
      el.querySelectorAll('.inbox-card').forEach(card => {
        card.addEventListener('click', () => openDetail(parseInt(card.dataset.id)));
      });
    } catch(e) {
      el.innerHTML = '<div class="help" style="color:var(--red)">Ошибка загрузки</div>';
    }
  }

  // ── Рендер карточки в списке ───────────────────────────────────────

  function renderCard(item) {
    const st = STATUS_MAP[item.status] || STATUS_MAP.new;
    const cl = CLASS_MAP[item.ai_classification] || item.ai_classification || '';
    const col = COLOR_MAP[item.ai_color] || {};
    const date = item.created_at ? new Date(item.created_at).toLocaleDateString('ru-RU') : '';
    const borderStyle = col.border ? `border-left:4px solid ${col.border}` : '';
    const creatorName = item.created_by_name || 'МиМир (AI)';
    const isAI = !item.created_by;

    return `
      <div class="inbox-card" data-id="${item.id}" style="${borderStyle}">
        <div class="ic-top">
          <span class="ic-subject">${col.icon || ''} ${esc(item.subject || '(без темы)')}</span>
          <span class="${st.badge}">${st.label}</span>
        </div>
        <div class="ic-meta">
          <span>${esc(item.source_name || item.source_email || '—')}</span>
          ${cl ? '<span>' + esc(cl) + '</span>' : ''}
          ${item.ai_confidence ? '<span>AI: ' + Math.round(item.ai_confidence * 100) + '%</span>' : ''}
          <span>${date}</span>
          ${item.attachment_count ? '<span>📎 ' + item.attachment_count + '</span>' : ''}
          <span style="color:${isAI ? '#8b5cf6' : 'var(--text-muted)'}">${isAI ? '🤖 ' : ''}${esc(creatorName)}</span>
        </div>
        ${item.ai_summary ? `<div class="ic-ai" style="background:${col.bg || 'var(--bg-elevated)'}">${esc(item.ai_summary)}</div>` : ''}
      </div>
    `;
  }

  // ── Детальная карточка ─────────────────────────────────────────────

  async function openDetail(id) {
    try {
      const data = await api('/' + id);
      if (!data.success) { toast('Ошибка', 'Заявка не найдена', 'err'); return; }
      const item = data.item;
      const st = STATUS_MAP[item.status] || STATUS_MAP.new;
      const col = COLOR_MAP[item.ai_color] || {};

      const html = `
        <div style="max-width:700px">
          <!-- Шапка -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <div>
              <span class="${st.badge}" style="font-size:13px">${st.label}</span>
              ${col.icon ? '<span style="margin-left:8px">' + col.icon + ' ' + (col.label || '') + '</span>' : ''}
            </div>
            <span style="color:var(--text-muted);font-size:12px">#${item.id}</span>
          </div>

          <!-- Тема -->
          <h3 style="margin:0 0 12px;color:var(--gold)">${esc(item.subject || '(без темы)')}</h3>

          <!-- Отправитель -->
          <div style="margin-bottom:16px;font-size:13px">
            <b>От:</b> ${esc(item.source_name || '')} &lt;${esc(item.source_email || '')}&gt;
            <br><b>Дата:</b> ${item.created_at ? new Date(item.created_at).toLocaleString('ru-RU') : '—'}
            <br><b>Внёс:</b> ${item.created_by ? esc(item.created_by_name || '—') : '<span style="color:#8b5cf6">🤖 МиМир (AI)</span>'}
            ${item.attachment_count ? '<br><b>Вложения:</b> ' + item.attachment_count + ' файлов' : ''}
          </div>

          <!-- AI Анализ -->
          ${item.ai_summary ? `
          <div style="background:${col.bg || 'var(--bg-elevated)'};border:1px solid ${col.border || 'var(--line)'};border-radius:6px;padding:16px;margin-bottom:16px">
            <div style="font-weight:700;margin-bottom:8px">🤖 AI Анализ</div>
            <div style="margin-bottom:8px">${esc(item.ai_summary)}</div>
            <div style="font-size:12px;color:var(--text-muted)">
              <b>Рекомендация:</b> ${esc(item.ai_recommendation || '—')}
              ${item.ai_work_type ? '<br><b>Тип работ:</b> ' + esc(item.ai_work_type) : ''}
              ${item.ai_estimated_budget ? '<br><b>Бюджет:</b> ~' + money(item.ai_estimated_budget) : ''}
              ${item.ai_estimated_days ? '<br><b>Срок:</b> ~' + item.ai_estimated_days + ' дней' : ''}
              ${item.ai_keywords?.length ? '<br><b>Ключевые:</b> ' + item.ai_keywords.map(k => esc(k)).join(', ') : ''}
              <br><b>Уверенность:</b> ${item.ai_confidence ? Math.round(item.ai_confidence * 100) + '%' : '—'}
              ${item.ai_model ? '<br><b>Модель:</b> ' + esc(item.ai_model) : ''}
            </div>
          </div>` : `
          <div style="background:var(--bg-elevated);border-radius:6px;padding:16px;margin-bottom:16px;text-align:center">
            <div class="help">AI-анализ не проводился</div>
            <button class="btn ghost" id="btnRunAI" style="margin-top:8px">🤖 Запустить анализ</button>
          </div>`}

          ${item.ai_report ? `
          <details style="margin-bottom:16px" open>
            <summary style="cursor:pointer;font-weight:700;font-size:13px">AI-отчёт</summary>
            <div style="margin-top:8px;padding:12px;background:var(--bg-elevated);border:1px solid var(--line);border-radius:6px;font-size:13px;line-height:1.6">${AsgardUI.renderMarkdown(item.ai_report)}</div>
          </details>` : ''}

          <!-- Текст письма -->
          <details style="margin-bottom:16px">
            <summary style="cursor:pointer;font-weight:600;font-size:13px">Текст письма</summary>
            <div style="margin-top:8px;padding:12px;background:var(--bg-elevated);border-radius:6px;font-size:12px;max-height:300px;overflow:auto;white-space:pre-wrap">${esc(item.email_body_text || item.body_preview || '(пусто)')}</div>
          </details>

          <!-- Вложения -->
          ${data.attachments?.length ? `
          <details style="margin-bottom:16px">
            <summary style="cursor:pointer;font-weight:600;font-size:13px">📎 Вложения (${data.attachments.length})</summary>
            <div style="margin-top:8px">
              ${data.attachments.map(a => '<div style="padding:4px 0;font-size:12px">📄 ' + esc(a.original_filename) + ' <span class="help">(' + Math.round((a.size || 0) / 1024) + ' КБ)</span></div>').join('')}
            </div>
          </details>` : ''}

          <!-- Решение -->
          ${item.decision_by_name ? `
          <div style="margin-bottom:16px;padding:12px;background:var(--bg-elevated);border-radius:6px;font-size:12px">
            <b>Решение:</b> ${esc(item.decision_by_name)} · ${item.decision_at ? new Date(item.decision_at).toLocaleString('ru-RU') : ''}
            ${item.decision_notes ? '<br>' + esc(item.decision_notes) : ''}
            ${item.rejection_reason ? '<br><b>Причина:</b> ' + esc(item.rejection_reason) : ''}
            ${item.linked_tender_id ? '<br><a href="#/tenders?open=' + item.linked_tender_id + '">Тендер #' + item.linked_tender_id + ' →</a>' : ''}
          </div>` : ''}

          <!-- Действия -->
          <div class="inbox-actions">
            ${['new','ai_processed','under_review'].includes(item.status) ? `
              <button class="btn success" id="btnAcceptApp">Принять</button>
              <button class="btn danger" id="btnRejectApp">Отклонить</button>
            ` : ''}
            ${['new','ai_processed'].includes(item.status) ? `
              <button class="btn secondary" id="btnReviewApp">На рассмотрение</button>
            ` : ''}
            <button class="btn ghost" id="btnReanalyze">Переанализировать</button>
            ${item.status !== 'archived' ? '<button class="btn ghost" id="btnArchiveApp">В архив</button>' : ''}
          </div>

          <!-- Загрузка компании на момент анализа -->
          ${item.workload_snapshot ? `
          <details style="margin-top:16px">
            <summary style="cursor:pointer;font-weight:600;font-size:12px;color:var(--text-muted)">Загрузка компании (на момент анализа)</summary>
            <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">
              Активных работ: ${item.workload_snapshot.activeWorks || 0} ·
              Тендеров: ${item.workload_snapshot.activeTenders || 0} ·
              Свободных: ${item.workload_snapshot.availableCrews || 0}
            </div>
          </details>` : ''}
        </div>
      `;

      showModal({ title: 'Заявка #' + id, html, wide: true, onMount: () => {
        // Кнопки действий
        const btnAccept = document.getElementById('btnAcceptApp');
        if (btnAccept) btnAccept.addEventListener('click', async () => {
          if (!confirm('Принять заявку и создать тендер?')) return;
          btnAccept.disabled = true;
          btnAccept.textContent = '⏳ Создание...';
          const res = await api('/' + id + '/accept', { method: 'POST', body: { create_tender: true, send_email: true } });
          if (res.success) {
            toast('Заявка принята', res.tender_id ? 'Тендер #' + res.tender_id + ' создан' : '');
            hideModal(); loadStats(); loadList();
          } else if (res.tender_id) {
            toast('Уже обработана', 'Заявка уже принята. Тендер #' + res.tender_id, 'warn');
            hideModal(); loadStats(); loadList();
          } else { toast('Ошибка', res.error || 'Не удалось', 'err'); btnAccept.disabled = false; btnAccept.textContent = 'Принять'; }
        });

        const btnReject = document.getElementById('btnRejectApp');
        if (btnReject) btnReject.addEventListener('click', async () => {
          const reason = prompt('Причина отклонения:');
          if (reason === null) return;
          const res = await api('/' + id + '/reject', { method: 'POST', body: { reason, send_email: true } });
          if (res.success) {
            toast('Заявка отклонена', '');
            hideModal(); loadStats(); loadList();
          } else { toast('Ошибка', res.error || 'Не удалось', 'err'); }
        });

        const btnReview = document.getElementById('btnReviewApp');
        if (btnReview) btnReview.addEventListener('click', async () => {
          const res = await api('/' + id + '/review', { method: 'POST' });
          if (res.success) { toast('Взято на рассмотрение', ''); hideModal(); loadStats(); loadList(); }
        });

        const btnReanalyze = document.getElementById('btnReanalyze');
        if (btnReanalyze) btnReanalyze.addEventListener('click', async () => {
          btnReanalyze.disabled = true;
          btnReanalyze.textContent = '⏳ Анализ...';
          const res = await api('/' + id + '/analyze', { method: 'POST' });
          if (res.success) { toast('Анализ завершён', ''); hideModal(); openDetail(id); loadStats(); loadList(); }
          else { toast('Ошибка AI', res.error || '', 'err'); btnReanalyze.disabled = false; btnReanalyze.textContent = '🤖 Переанализировать'; }
        });

        const btnRunAI = document.getElementById('btnRunAI');
        if (btnRunAI) btnRunAI.addEventListener('click', async () => {
          btnRunAI.disabled = true;
          btnRunAI.textContent = '⏳ Анализ...';
          const res = await api('/' + id + '/analyze', { method: 'POST' });
          if (res.success) { toast('Анализ завершён', ''); hideModal(); openDetail(id); loadStats(); loadList(); }
          else { toast('Ошибка AI', res.error || '', 'err'); btnRunAI.disabled = false; btnRunAI.textContent = '🤖 Запустить анализ'; }
        });

        const btnArchive = document.getElementById('btnArchiveApp');
        if (btnArchive) btnArchive.addEventListener('click', async () => {
          const res = await api('/' + id + '/archive', { method: 'POST' });
          if (res.success) { toast('Архивировано', ''); hideModal(); loadStats(); loadList(); }
        });
      }});
    } catch(e) {
      toast('Ошибка', 'Не удалось загрузить заявку', 'err');
    }
  }

  return { render };
})();
