/**
 * ASGARD CRM — Очередь оплаты (Бухгалтерия)
 * ═══════════════════════════════════════════════════════════════
 * Показывает заявки, одобренные директором и ожидающие оплаты.
 * Бухгалтер выбирает: ПП или наличные.
 */
window.AsgardApprovalPaymentPage = (function() {
  'use strict';

  const { showModal, hideModal, toast, esc, moneyRub: money } = AsgardUI;

  // D-229: копейки показываем там, где деньги РЕАЛЬНО считаются (счёт на согласование, оплата,
  // цена строки) — тем же правилом, что уже принят в v2: конструктор счёта/акта и КП идут с
  // `{ fractionDigits: 2 }`, а списки и KPI — округление до рубля. Дублируем не формат, а ПРАВИЛО
  // v2 (src/lib/money.js), поэтому модалки оплаты ниже обязаны брать суммы через money2.
  const money2 = (v) => money(v, { fractionDigits: 2 });

  const PAYMENT_STATUS_MAP = {
    awaiting_dir:      { label: 'Ожидает решения директора', color: '#a855f7', bg: 'rgba(168,85,247,.12)' },
    pending_payment:   { label: 'Ожидает оплаты',  color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
    paid:             { label: 'Оплачено (ПП)',    color: '#22c55e', bg: 'rgba(34,197,94,.12)' },
    cash_issued:      { label: 'Наличные выданы',   color: '#3b82f6', bg: 'rgba(59,130,246,.12)' },
    cash_received:    { label: 'Получено',          color: '#22c55e', bg: 'rgba(34,197,94,.12)' },
    expense_reported: { label: 'Отчёт приложен',    color: '#10b981', bg: 'rgba(16,185,129,.12)' },
    rework:           { label: 'На доработке',      color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
    question:         { label: 'Вопрос',            color: '#a855f7', bg: 'rgba(168,85,247,.12)' }
  };

  function paymentPill(status) {
    const s = PAYMENT_STATUS_MAP[status] || { label: status || '—', color: 'var(--t3)', bg: 'rgba(107,114,128,.12)' };
    return `<span style="display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;color:${s.color};background:${s.bg};border:1px solid ${s.color}30">${s.label}</span>`;
  }
  // У «ожидает директора» payment_status пуст — статус живёт в status. Без фолбэка
  // карточка остаётся без метки, и директор не понимает, что от него хотят.
  function pillFor(item) {
    if (item.payment_status) return paymentPill(item.payment_status);
    if (_mode === 'dir' || item.status === 'awaiting_dir') return paymentPill('awaiting_dir');
    return paymentPill(item.status);
  }
  function getHeaders() {
    const auth = typeof AsgardAuth !== 'undefined' ? AsgardAuth.getAuth() : null;
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (auth?.token || localStorage.getItem('asgard_token') || '')
    };
  }

  // ─── Роль и режим очереди (D1, 21.09) ───
  // Директор и бухгалтер ходят на ОДНУ страницу «Очередь оплаты», но срез разный:
  // бухгалтер — счета, одобренные директором (pending_payment); директор — счета,
  // ждущие ЕГО решения (awaiting_dir). Раньше директор получал 403 и пустой экран.
  //
  // Роль определяем по ТРЁМ источникам, а не только по localStorage: `asgard_user`
  // может отсутствовать (сессия, восстановленная из одного токена) — тогда прежняя
  // логика молча считала директора бухгалтером и снова давала ему 403.
  let _mode = 'buh';
  function roleFromStorage() {
    try {
      const auth = typeof AsgardAuth !== 'undefined' ? AsgardAuth.getAuth() : null;
      if (auth && auth.user && auth.user.role) return auth.user.role;
    } catch (_) {}
    try {
      if (window.__asgardUser && window.__asgardUser.role) return window.__asgardUser.role;
      const raw = localStorage.getItem('asgard_user');
      if (raw) { const u = JSON.parse(raw); if (u && u.role) return u.role; }
    } catch (_) {}
    return '';
  }
  function roleToMode(role) {
    const r = String(role || '');
    return (r === 'ADMIN' || /^DIRECTOR/.test(r)) ? 'dir' : 'buh';
  }
  async function resolveMode() {
    let role = roleFromStorage();
    if (!role) {
      // Надёжный источник — сам сервер. /api/users/me есть у любой роли.
      try {
        const resp = await fetch('/api/users/me', { headers: getHeaders() });
        if (resp.ok) { const j = await resp.json(); role = (j.user && j.user.role) || j.role || ''; }
      } catch (_) {}
    }
    _mode = roleToMode(role);
    return _mode;
  }

  // ─── Загрузка данных ───
  async function loadPending() {
    const resp = await fetch(`/api/approval/pending-${_mode}`, { headers: getHeaders() });
    if (!resp.ok) throw new Error('Ошибка загрузки');
    return resp.json();
  }

  // ─── Live (D2): обновление очереди без F5 ───
  // Поллинг с остановкой при скрытой вкладке и при уходе со страницы (иначе «вечный» таймер
  // после перехода в другой раздел).
  //
  // ГЛАВНАЯ ЛОВУШКА (найдена независимым верификатором, 21.09). Первая версия вешала анонимный
  // `visibilitychange`-листенер в САМОМ startLive() и не снимала его в stopLive(). При каждом
  // входе в раздел листенеров становилось на один больше, и после «зашёл → ушёл → вернулся →
  // свернул/развернул вкладку» СТАРЫЙ листенер видел отсоединённый контейнер, вызывал stopLive()
  // и гасил ЖИВОЙ таймер: live молча умирал до следующей перезагрузки (ровно профиль обычного
  // рабочего дня). Теперь листенер один на модуль, снимается перед добавлением, и остановка
  // по контейнеру идёт БЕЗ глобального эффекта.
  let _liveTimer = null;
  let _liveContainer = null;
  let _visHandler = null;

  function _clearTimer() {
    if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
  }
  function stopLive() {
    _clearTimer();
    _liveContainer = null;
  }
  function startLive(container) {
    stopLive();
    _liveContainer = container;
    _clearTimer();                       // на случай, если прошлый таймер ещё жив
    _liveTimer = setInterval(_liveTick, 20000);
    if (_visHandler) document.removeEventListener('visibilitychange', _visHandler);
    _visHandler = () => {                // ровно один листенер на модуль
      if (document.hidden) return;
      if (!_liveContainer || !document.body.contains(_liveContainer)) return; // «устаревший» не гасит живой
      _liveTick();
    };
    document.addEventListener('visibilitychange', _visHandler);
  }
  async function _liveTick() {
    const container = _liveContainer;
    if (!container) return;
    if (document.hidden) return;                                   // вкладка не видна — не тратим запросы
    if (!document.body.contains(container)) { stopLive(); return; } // ушли со страницы — гасим СВОЙ таймер
    if (document.querySelector('.cr-m-overlay')) return;            // не мешаем открытой модалке
    try {
      const data = await loadPending();
      const list = container.querySelector('#payment-list');
      if (list) renderList(list, data);
    } catch (_) { /* тихо: live не должен ломать экран */ }
  }
  window.addEventListener('hashchange', stopLive);

  function renderList(list, data) {
    if (!data.items || !data.items.length) {
      const dirMode = _mode === 'dir';
      list.innerHTML = `<div style="text-align:center;padding:60px">
        <div style="font-size:48px;margin-bottom:12px">${dirMode ? '📭' : '✅'}</div>
        <div style="font-size:16px;font-weight:600;color:var(--t2)">${dirMode ? 'Нет счетов на согласовании' : 'Нет заявок на оплату'}</div>
        <div class="help" style="margin-top:8px">${dirMode ? 'Все счета рассмотрены' : 'Все заявки обработаны'}</div>
      </div>`;
      return;
    }
    list.innerHTML = data.items.map(item => `
      <div class="card" style="padding:16px;margin-bottom:12px;border:1px solid var(--brd);border-radius:10px;background:var(--bg1);cursor:pointer" data-entity="${item.entity_type}" data-id="${item.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-weight:600">${esc(item.title || (item.label + ' #' + item.id))}</div>
            <div class="help" style="margin-top:4px">${item.basis_text ? esc(item.basis_text) + ' · ' : ''}${new Date(item.updated_at).toLocaleString('ru-RU')}</div>
            ${item.amount != null ? `<div style="margin-top:6px;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums">${money(item.amount)}</div>` : ''}
          </div>
          ${pillFor(item)}
        </div>
      </div>
    `).join('');
  }

  // Хост страницы резолвим В ЖИВОМ DOM на каждом шаге, а не один раз.
  // Иначе при повторном рендере (роутер/layout заменяют контейнер, пока идут await) карточки
  // уходят в отсоединённый узел: данные загружены, а на экране пусто — «первый вход пустой».
  function _resolveHost(fallback) {
    const live = document.getElementById('approval-payment-page');
    if (live && document.body.contains(live)) return live;
    if (fallback && document.body.contains(fallback)) return fallback;
    return null;
  }

  // ─── RENDER ───
  async function render(container) {
    stopLive();
    await resolveMode();          // роль с сервера, если localStorage пуст — не угадываем
    const dirMode = _mode === 'dir';
    const host = _resolveHost(container);
    if (!host) return;            // страницу успели сменить — тихо выходим, никто не ждёт ответа
    // Заголовок рисует layout (он же задаёт пункт меню). Приводим его к роли:
    // у директора это решение по счёту, у бухгалтера — очередь на оплату.
    const h1 = document.querySelector('.page-title');
    if (h1) h1.textContent = dirMode ? 'Согласование оплат' : 'Очередь оплаты';
    host.innerHTML = `
      <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <p style="color:var(--text-muted);font-size:var(--text-sm);margin:0" id="ap-desc">${dirMode
            ? 'Счета, ожидающие вашего решения. Список обновляется автоматически'
            : 'Заявки, одобренные директором и ожидающие оплаты. Список обновляется автоматически'}</p>
        </div>
        ${dirMode ? `<div id="dir-total" style="padding:10px 16px;border-radius:10px;background:var(--bg2);border:1px solid var(--brd)">
          <div style="font-size:11px;color:var(--t3)">К согласованию</div>
          <div style="font-size:20px;font-weight:700;color:var(--gold)" id="dir-total-val">...</div>
        </div>` : `<div id="cash-badge" style="padding:10px 16px;border-radius:10px;background:var(--bg2);border:1px solid var(--brd)">
          <div style="font-size:11px;color:var(--t3)">Баланс кассы</div>
          <div style="font-size:20px;font-weight:700;color:var(--gold)" id="cash-balance-val">...</div>
        </div>`}
      </div>
      <div id="payment-list" data-queue-mode="${dirMode ? 'dir' : 'buh'}" style="margin-top:16px">
        <div style="text-align:center;padding:40px;color:var(--text-muted)">Загрузка...</div>
      </div>`;

    try {
      const data = await loadPending();
      // Хост мог смениться, пока ходили за данными — пишем в ТОТ, что сейчас в DOM.
      const live = _resolveHost(host);
      if (!live) return;
      const cashEl = live.querySelector('#cash-balance-val');
      if (cashEl) cashEl.textContent = money(data.cash_balance);
      const dirEl = live.querySelector('#dir-total-val');
      if (dirEl) dirEl.textContent = (data.count || 0) + ' шт · ' + money(data.total || 0);

      const list = live.querySelector('#payment-list');
      if (!list) return;
      renderList(list, data);

      let _opening = false;   // защита от дубля модалки: двойной клик по карточке (D-226)
      list.addEventListener('click', async ev => {
        const card = ev.target.closest('[data-entity]');
        if (!card) return;
        const ent = card.dataset.entity;
        const id = Number(card.dataset.id);
        if (ent === 'payment_invoices') {
          if (_opening) return;             // пока модалка собирается — второй клик игнорируем
          _opening = true;
          const full = (data.items || []).find(x => x.entity_type === ent && +x.id === id);
          try {
            // Директор решает сам (dir-approve / dir-reject); бухгалтер оплачивает.
            if (dirMode) await showPaymentInvoiceDirModal(full || { id, entity_type: ent });
            else await showPaymentInvoiceBuhModal(full || { id, entity_type: ent }, data.cash_balance);
          } finally { _opening = false; }
        } else {
          showPaymentModal(ent, id, data.cash_balance);
        }
      });
      startLive(live);
    } catch (err) {
      const live = _resolveHost(host);
      const list = live && live.querySelector('#payment-list');
      if (list) list.innerHTML = `<div style="text-align:center;padding:40px;color:var(--red)">${esc(err.message)}</div>`;
    }
  }

  // ─── Модалка директора по payment_invoices (D1, 21.09) ───
  // Отдельная модалка от бухгалтерской: у директора ДРУГОЕ действие (согласовать/вернуть),
  // и он не видит баланс кассы. Переиспользует те же proc-pay-* классы (правило: без новых модалок).
  //
  // Защита от дубля (D-226, независимый верификатор): двойной клик по карточке запускал
  // ДВЕ модалки (функция `async`, между кликами был await за деталями счёта). Верхняя копия
  // оставалась без обработчиков → кнопка «Согласовать» на вид живая, но не делает ничего.
  let _dirOpening = false;
  async function showPaymentInvoiceDirModal(item) {
    if (_dirOpening) return;    // второй клик, пока первая модалка ещё собирается, игнорируем
    _dirOpening = true;
    try { return await _showPaymentInvoiceDirModalInner(item); }
    finally { _dirOpening = false; }
  }

  async function _showPaymentInvoiceDirModalInner(item) {
    let pay = item;
    try {
      const r = await fetch(`/api/payment-invoices/${item.id}`, { headers: getHeaders() });
      if (r.ok) pay = await r.json();
    } catch (_) {}
    // Признак «файл есть» берём с сервера (`has_file`), а не из непустого URL.
    // Иначе для счетов БЕЗ файла модалка строит URL /file, стучится и получает 404 —
    // в консоли ошибка, в превью «не удалось загрузить» вместо честного «файла нет».
    const hasFile = !!pay.has_file;   // сервер — единственный источник правды о наличии файла
    const fileApi = hasFile ? (pay.file_url || `/api/payment-invoices/${pay.id}/file`) : null;
    const fileStatic = hasFile && pay.file_path && String(pay.file_path).startsWith('/uploads/') ? pay.file_path : null;
    const fileName = pay.file_name || 'счёт';
    const timing = pay.pay_timing === 'deferred' ? 'deferred' : 'immediate';

    const root = showModal({
      title: 'Согласование счёта',
      wide: true,      html: `
      <div class="proc-pay-modal">
        <div class="proc-pay-modal__layout">
          <div class="proc-pay-modal__main">
            <div class="proc-pay-modal__section">
              <div class="proc-pay-modal__section-title">Счёт на согласование</div>
              <div class="proc-pay-modal__sum">${money2(pay.amount)}</div>
              <dl class="proc-pay-modal__meta" style="margin-top:12px">
                <dt>Поставщик</dt><dd>${esc(pay.supplier_name || '—')}</dd>
                <dt>Основание</dt><dd>${esc(pay.basis_text || pay.basis_type || '—')}</dd>
                <dt>Файл</dt><dd>${hasFile ? esc(fileName) : 'файл не приложен'}</dd>
              </dl>
            </div>
            <div class="proc-pay-modal__section">
              <div class="proc-pay-modal__section-title">Дата оплаты</div>
              <div class="proc-pay-timing" id="dir-timing">
                <button type="button" class="proc-pay-timing__opt ${timing === 'immediate' ? 'proc-pay-timing__opt--on' : ''}" data-t="immediate"><strong>Сразу</strong></button>
                <button type="button" class="proc-pay-timing__opt ${timing === 'deferred' ? 'proc-pay-timing__opt--on' : ''}" data-t="deferred"><strong>По дате</strong></button>
              </div>
            </div>
            <div class="proc-pay-modal__section">
              <label class="proc-pay-modal__label" for="dir-comment">Комментарий</label>
              <textarea id="dir-comment" class="proc-pay-modal__field" rows="2" placeholder="Необязательно"></textarea>
            </div>
            <div class="proc-pay-modal__actions" style="flex-direction:row;flex-wrap:wrap;gap:8px">
              <button type="button" class="btn primary" id="dir-approve">Согласовать</button>
              <button type="button" class="btn ghost" id="dir-reject">Вернуть</button>
            </div>
          </div>
          <div class="proc-pay-modal__preview">
            ${fileApi || fileStatic ? `
              <div class="proc-pay-modal__preview-head">
                <span>${esc(fileName)}</span>
                <div class="proc-pay-modal__preview-actions">
                  <button type="button" class="btn ghost" id="dir-file-open">Открыть</button>
                  <button type="button" class="btn ghost" id="dir-file-dl">Скачать</button>
                </div>
              </div>
              <div class="proc-pay-modal__preview-body" data-dir-preview="1" style="min-height:80px">
                <div class="proc-pay-modal__preview-empty" data-dir-preview-load="1"><strong>Загрузка счёта…</strong></div>
              </div>`
              : `<div class="proc-pay-modal__preview-empty"><strong>Файл не приложен</strong></div>`}
          </div>
        </div>
      </div>`,
    });

    let dirTiming = timing;
    // Работаем ТОЛЬКО внутри возвращённого overlay. Фолбэк на document убран: он и был
    // корнем D-226 (элементы брались из чужой/уходящей модалки).
    const modalRoot = root;
    modalRoot.querySelectorAll('#dir-timing .proc-pay-timing__opt').forEach(el => {
      el.onclick = () => {
        dirTiming = el.dataset.t;
        modalRoot.querySelectorAll('#dir-timing .proc-pay-timing__opt').forEach(x =>
          x.classList.toggle('proc-pay-timing__opt--on', x.dataset.t === dirTiming));
      };
    });

    // Защита от двойного клика: без неё три быстрых нажатия «Согласовать» давали три POST
    // (все 200) и три тоста «Готово» — ложное поведение, хотя БД спасала транзакция.
    let _deciding = false;
    const closeAfter = async (url, body) => {
      if (_deciding) return;
      _deciding = true;
      [modalRoot.querySelector('#dir-approve'), modalRoot.querySelector('#dir-reject')].forEach(b => {
        if (b) { b.disabled = true; }
      });
      try {
        const r = await fetch(url, { method: 'POST', headers: getHeaders(), body: JSON.stringify(body || {}) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          toast('Ошибка', j.error || j.message || 'Не удалось отправить');
          _deciding = false;
          [modalRoot.querySelector('#dir-approve'), modalRoot.querySelector('#dir-reject')].forEach(b => {
            if (b) { b.disabled = false; }
          });
          return;
        }
        toast('Готово', 'Счёт согласован', 'ok');
        // Закрываем ИМЕННО свою модалку (`hideModal(modalRoot)`), а не верхнюю в документе:
        // иначе запоздалый ответ по счёту A закрывал поверх него открытую модалку B.
        hideModal(modalRoot);
        const c = document.getElementById('approval-payment-page');
        if (c) render(c);           // обновление списка без ожидания поллинга
      } catch (e) {
        toast('Ошибка', e.message || 'Не удалось отправить', 'err');
        _deciding = false;
        [modalRoot.querySelector('#dir-approve'), modalRoot.querySelector('#dir-reject')].forEach(b => {
          if (b) { b.disabled = false; }
        });
      }
    };
    const ap = modalRoot.querySelector('#dir-approve');
    const rj = modalRoot.querySelector('#dir-reject');
    const cm = modalRoot.querySelector('#dir-comment');
    if (ap) ap.onclick = () => closeAfter(`/api/payment-invoices/${pay.id}/dir-approve`, { pay_timing: dirTiming, comment: cm ? cm.value.trim() : '' });
    if (rj) rj.onclick = () => closeAfter(`/api/payment-invoices/${pay.id}/dir-reject`, { comment: cm ? cm.value.trim() : '' });

    // ── Превью счёта ──────────────────────────────────────────────────────
    // НЕЛЬЗЯ вставлять `src="/api/.../file"` в iframe: браузер не отправит заголовок
    // Authorization, и превью молча получит 401 — директор увидит «битый» счёт.
    // Тянем файл с токеном в blob и подставляем объектный URL (как в модалке бухгалтера).
    const dirOpenFile = async (asDownload) => {
      const url = fileApi || fileStatic;
      if (!url) { toast('Файл', 'К счёту файл не приложен', 'warn'); return; }
      try {
        if (url.startsWith('/api/')) {
          const r = await fetch(url, { headers: getHeaders() });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const blob = await r.blob();
          const u = URL.createObjectURL(blob);
          if (asDownload) { const a = document.createElement('a'); a.href = u; a.download = fileName; a.click(); }
          else window.open(u, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(u), 120000);
        } else if (asDownload) {
          const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
        } else window.open(url, '_blank', 'noopener');
      } catch (e) { toast('Файл', e.message || 'Не удалось открыть', 'err'); }
    };
    const openBtn = modalRoot.querySelector('#dir-file-open');
    const dlBtn = modalRoot.querySelector('#dir-file-dl');
    if (openBtn) openBtn.onclick = () => dirOpenFile(false);
    if (dlBtn) dlBtn.onclick = () => dirOpenFile(true);

    const previewBox = modalRoot.querySelector('[data-dir-preview]');
    if (previewBox && (fileApi || fileStatic)) {
      try {
        const r = await fetch(fileApi || fileStatic, { headers: getHeaders() });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        const u = URL.createObjectURL(blob);
        const isPdf = /pdf/i.test(blob.type) || /\.pdf$/i.test(fileName);
        const isImg = /image\//i.test(blob.type) || /\.(png|jpe?g|webp|gif)$/i.test(fileName);
        if (isPdf) previewBox.innerHTML = `<iframe title="Счёт" class="proc-pay-modal__pdf" src="${u}#toolbar=0"></iframe>`;
        else if (isImg) previewBox.innerHTML = `<img alt="Счёт" src="${u}">`;
        else previewBox.innerHTML = `<div class="proc-pay-modal__preview-empty"><strong>Предпросмотр недоступен</strong><span>Откройте файл кнопкой «Открыть»</span></div>`;
      } catch (e) {
        previewBox.innerHTML = `<div class="proc-pay-modal__preview-empty"><strong>Не удалось загрузить счёт</strong><span>${esc(e.message)}</span></div>`;
      }
    }
  }

  // ─── Модалка буха по payment_invoices: счёт / сумма / основание / дата / ПП ───
  async function showPaymentInvoiceBuhModal(item, cashBalance) {
    let pay = item;
    try {
      const r = await fetch(`/api/payment-invoices/${item.id}`, { headers: getHeaders() });
      if (r.ok) pay = await r.json();
    } catch (_) {}
    // Признак «файл есть» — с сервера, а не из непустого URL: иначе модалка без файла
    // строит /file, стучится и получает 404 (ошибка в консоли вместо «файла нет»).
    const hasFile = !!pay.has_file;   // сервер — единственный источник правды о наличии файла
    const fileApi = hasFile ? (pay.file_url || `/api/payment-invoices/${pay.id}/file`) : null;
    const fileStatic = hasFile && pay.file_path && String(pay.file_path).startsWith('/uploads/') ? pay.file_path : null;
    const fileName = pay.file_name || 'счёт';
    const ext = String(fileName || fileApi || fileStatic || '').toLowerCase();
    let kind = ext.includes('.pdf') ? 'pdf' : (/\.(png|jpe?g|webp)/.test(ext) ? 'img' : 'other');
    const lines = Array.isArray(pay.line_items_json) ? pay.line_items_json
      : (typeof pay.line_items_json === 'string' ? (() => { try { return JSON.parse(pay.line_items_json || '[]'); } catch (_) { return []; } })() : []);
    const paper = `<div class="proc-pay-paper" data-pay-paper="1">
      <div class="proc-pay-paper__brand">АСГАРД · СЧЁТ</div>
      <div class="proc-pay-paper__sum">${money2(pay.amount)}</div>
      <div class="proc-pay-paper__meta">${esc(pay.supplier_name || '—')}<br>${esc(pay.basis_text || pay.basis_type || '')}</div>
      ${lines.length ? `<div class="proc-pay-paper__lines">${lines.slice(0,6).map(l =>
        `<div class="proc-pay-paper__row"><span>${esc(l.name||'—')}</span><span>${esc(String(l.qty??l.quantity??''))}</span><span>${money2(l.unit_price)}</span></div>`
      ).join('')}</div>` : ''}
      <div class="proc-pay-paper__file">${esc(fileName)}${fileApi || fileStatic ? ' · готов к открытию' : ' · файла нет'}</div>
    </div>`;
    let media = '';
    if (!fileApi && !fileStatic) {
      media = '';
    } else if (kind === 'pdf' && fileStatic) {
      media = `<iframe title="Счёт" class="proc-pay-modal__pdf" src="${esc(fileStatic)}#toolbar=0"></iframe>`;
    } else if (kind === 'img' && fileStatic) {
      media = `<img alt="Счёт" src="${esc(fileStatic)}">`;
    } else if (fileApi) {
      media = `<div class="proc-pay-modal__preview-empty" data-buh-preview-load="1" style="min-height:80px"><strong>Загрузка файла…</strong></div>`;
    }
    const previewBody = paper + media;
    const st = pay.status_label || (pay.pay_timing === 'deferred' ? 'Одобрен, ждёт даты' : 'Ожидает оплаты');
    const openUrl = fileApi || fileStatic || '';
    const html = `
      <div class="proc-pay-modal">
        <div class="proc-pay-modal__layout">
          <div class="proc-pay-modal__main">
            <div class="proc-pay-modal__section">
              <div class="proc-pay-modal__section-title">Оплата счёта</div>
              <div class="proc-pay-modal__sum">${money2(pay.amount)}</div>
              <span class="proc-pay-status proc-pay-status--pay">${esc(st)}</span>
              <dl class="proc-pay-modal__meta" style="margin-top:12px">
                <dt>Поставщик</dt><dd>${esc(pay.supplier_name || '—')}</dd>
                <dt>Основание</dt><dd>${esc(pay.basis_text || pay.basis_type || '—')}</dd>
                <dt>Срок <span class="proc-tooltip" title="Крайний срок оплаты из заявки">?</span></dt>
                <dd>${pay.due_date ? esc(String(pay.due_date).slice(0,10)) : '—'}</dd>
                ${pay.procurement_id ? `<dt>Заявка</dt><dd>#${pay.procurement_id}</dd>` : ''}
                ${pay.work_id ? `<dt>Работа</dt><dd>#${pay.work_id}</dd>` : ''}
                <dt>Режим</dt><dd>${pay.pay_timing === 'deferred' ? 'Отложенная' : 'Сразу'}</dd>
              </dl>
              ${cashBalance != null ? `<p class="proc-pay-modal__hint">Баланс кассы (справка): ${money(cashBalance)}</p>` : ''}
            </div>
            <div class="proc-pay-modal__section">
              <div class="proc-pay-modal__section-title">Платёжное поручение <span class="proc-tooltip" title="Загрузите скан ПП из банка или отметьте «без файла» с причиной в комментарии">?</span></div>
              <label class="proc-pay-modal__label" for="pi-pay-date">Дата оплаты</label>
              <input id="pi-pay-date" class="proc-pay-modal__field" type="date">
              <label class="proc-pay-modal__label" for="pi-pay-comment">Комментарий / № ПП</label>
              <input id="pi-pay-comment" class="proc-pay-modal__field" placeholder="Номер ПП, банк…">
              <label class="proc-pay-modal__label">Файл ПП</label>
              <div class="proc-file" style="margin:4px 0 10px">
                <label class="proc-file__btn" for="pi-pay-file">Выбрать файл ПП</label>
                <span class="proc-file__name" id="pi-pay-file-name">файл не выбран</span>
                <input id="pi-pay-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx">
              </div>
              <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--t2);margin-bottom:12px">
                <input type="checkbox" id="pi-skip-pp"> Оплата без файла ПП (укажите причину в комментарии)
              </label>
              <button class="btn primary" id="pi-pay-bank" style="width:100%">Подтвердить оплату</button>
            </div>
            <div style="text-align:center">
              <button type="button" class="proc-pay-btn-ghost" id="pi-buh-rework">Вернуть на доработку</button>
            </div>
          </div>
          <div class="proc-pay-modal__preview" data-buh-api="${esc(fileApi || '')}" data-buh-name="${esc(fileName)}" data-buh-kind="${kind}">
            <div class="proc-pay-modal__preview-head">
              <span>Файл счёта</span>
              <div class="proc-pay-modal__preview-actions">
                ${openUrl ? `<button type="button" class="btn ghost" id="pi-buh-open">Открыть</button>
                <button type="button" class="btn ghost" id="pi-buh-dl">Скачать</button>` : ''}
              </div>
            </div>
            <div class="proc-pay-modal__preview-body">${previewBody}</div>
          </div>
        </div>
      </div>`;
    const buhRoot = showModal({ title: 'Оплата счёта', html });

    async function openBuhFile(asDownload) {
      const url = fileApi || fileStatic;
      if (!url) return;
      try {
        if (url.startsWith('/api/')) {
          const r = await fetch(url, { headers: getHeaders() });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const blob = await r.blob();
          const u = URL.createObjectURL(blob);
          if (asDownload) {
            const a = document.createElement('a'); a.href = u; a.download = fileName; a.click();
          } else window.open(u, '_blank', 'noopener');
          setTimeout(() => URL.revokeObjectURL(u), 120_000);
        } else if (asDownload) {
          const a = document.createElement('a'); a.href = url; a.download = fileName; a.click();
        } else window.open(url, '_blank', 'noopener');
      } catch (e) { toast('Файл', e.message || 'Не удалось', 'err'); }
    }
    const openB = document.getElementById('pi-buh-open');
    const dlB = document.getElementById('pi-buh-dl');
    if (openB) openB.onclick = () => openBuhFile(false);
    if (dlB) dlB.onclick = () => openBuhFile(true);
    if (fileApi && document.querySelector('[data-buh-preview-load]')) {
      try {
        const r = await fetch(fileApi, { headers: getHeaders() });
        if (r.ok) {
          const blob = await r.blob();
          const ct = (r.headers.get('content-type') || blob.type || '').toLowerCase();
          let k = kind;
          if (k === 'other') {
            if (ct.includes('pdf')) k = 'pdf';
            else if (ct.startsWith('image/')) k = 'img';
          }
          const u = URL.createObjectURL(blob);
          const body = document.querySelector('.proc-pay-modal__preview-body');
          if (body) {
            const paperEl = body.querySelector('[data-pay-paper]');
            const paperHtml = paperEl ? paperEl.outerHTML : '';
            if (k === 'pdf') body.innerHTML = paperHtml + `<iframe title="Счёт" class="proc-pay-modal__pdf" src="${u}#toolbar=0"></iframe>`;
            else if (k === 'img') body.innerHTML = paperHtml + `<img alt="Счёт" src="${u}">`;
            else body.innerHTML = paperHtml || `<div class="proc-pay-modal__preview-empty"><strong>Превью недоступно</strong><span>Скачайте файл счёта</span></div>`;
          }
        }
      } catch (_) {}
    }

    const today = new Date().toISOString().slice(0, 10);
    const dateEl = document.getElementById('pi-pay-date');
    if (dateEl) dateEl.value = today;
    const fileInp = document.getElementById('pi-pay-file');
    if (fileInp) fileInp.onchange = () => {
      const n = document.getElementById('pi-pay-file-name');
      if (n) n.textContent = (fileInp.files[0] && fileInp.files[0].name) || 'файл не выбран';
    };

    async function uploadDoc(file) {
      if (!file) return null;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', 'Платёжное поручение');
      const r = await fetch('/api/documents/upload', { method: 'POST', headers: { Authorization: getHeaders().Authorization }, body: fd });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || 'Не удалось загрузить файл ПП');
      }
      const j = await r.json();
      return j.id || j.document_id || null;
    }

    document.getElementById('pi-pay-bank').onclick = async () => {
      try {
        const comment = (document.getElementById('pi-pay-comment').value || '').trim();
        const date = document.getElementById('pi-pay-date').value;
        const file = document.getElementById('pi-pay-file').files[0];
        const skipPp = document.getElementById('pi-skip-pp').checked;
        if (!file && !skipPp) {
          toast('Файл ПП', 'Прикрепите ПП или отметьте «без файла»', 'err');
          return;
        }
        if (skipPp && !comment) {
          toast('Комментарий', 'Укажите причину оплаты без файла ПП', 'err');
          return;
        }
        let documentId = null;
        if (file) documentId = await uploadDoc(file);
        const payload = {
          comment: (date ? ('Оплата ' + date + (comment ? ': ' + comment : '')) : comment),
          document_id: documentId,
          skip_pp: skipPp
        };
        let resp = await fetch(`/api/payment-invoices/${pay.id}/pay-bank`, {
          method: 'POST', headers: getHeaders(), body: JSON.stringify(payload)
        });
        if (!resp.ok) {
          resp = await fetch(`/api/approval/payment_invoices/${pay.id}/pay-bank`, {
            method: 'POST', headers: getHeaders(), body: JSON.stringify(payload)
          });
        }
        if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error || 'Ошибка оплаты'); }
        toast('Оплачено', 'ПП зарегистрировано', 'ok');
        hideModal(buhRoot);
        render(document.querySelector('[data-page="approval-payment"]') || document.getElementById('main-content'));
      } catch (err) { toast('Ошибка', err.message, 'err'); }
    };
    document.getElementById('pi-buh-rework').onclick = () => {
      showCommentModal('На доработку', async (comment) => {
        const resp = await fetch(`/api/approval/payment_invoices/${pay.id}/rework`, {
          method: 'POST', headers: getHeaders(), body: JSON.stringify({ comment })
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.error); }
        toast('Готово', 'Возвращено на доработку', 'ok');
        hideModal(buhRoot);
        render(document.querySelector('[data-page="approval-payment"]') || document.getElementById('main-content'));
      });
    };
  }

  // ─── Модалка выбора способа оплаты ───
  function showPaymentModal(entityType, entityId, cashBalance) {
    const html = `
      <div style="max-width:480px">
        <div style="text-align:center;margin-bottom:20px">
          <div style="font-size:14px;color:var(--t3)">Выберите способ оплаты</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
          <div id="opt-bank" style="padding:20px;border-radius:12px;border:2px solid var(--brd);background:var(--bg2);cursor:pointer;text-align:center;transition:all .15s ease"
               onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor='var(--brd)'">
            <div style="font-size:32px;margin-bottom:8px">💳</div>
            <div style="font-weight:700;font-size:14px">Платёжное поручение</div>
            <div class="help" style="margin-top:4px">Оплата через банк</div>
          </div>
          <div id="opt-cash" style="padding:20px;border-radius:12px;border:2px solid var(--brd);background:var(--bg2);cursor:pointer;text-align:center;transition:all .15s ease"
               onmouseover="this.style.borderColor='#22c55e'" onmouseout="this.style.borderColor='var(--brd)'">
            <div style="font-size:32px;margin-bottom:8px">💵</div>
            <div style="font-weight:700;font-size:14px">Наличные из кассы</div>
            <div class="help" style="margin-top:4px">Баланс: <b>${money(cashBalance)}</b></div>
          </div>
        </div>

        <!-- Форма ПП (скрыта) -->
        <div id="form-bank" style="display:none">
          <div style="padding:16px;border-radius:10px;background:var(--bg2);border:1px solid var(--brd)">
            <div style="font-weight:600;margin-bottom:12px">💳 Оплата через ПП</div>
            <div style="margin-bottom:10px">
              <label style="font-size:13px;color:var(--t3)">Комментарий</label>
              <input id="pay-bank-comment" placeholder="Номер ПП, дата и т.д." style="width:100%;margin-top:4px"/>
            </div>
            <button class="btn" id="btn-pay-bank" style="background:#3b82f6;color:#fff;border:none;width:100%">💳 Оплачено</button>
          </div>
        </div>

        <!-- Форма наличные (скрыта) -->
        <div id="form-cash" style="display:none">
          <div style="padding:16px;border-radius:10px;background:var(--bg2);border:1px solid var(--brd)">
            <div style="font-weight:600;margin-bottom:8px">💵 Выдача наличных</div>
            <div style="padding:10px;border-radius:8px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);margin-bottom:12px;text-align:center">
              <div style="font-size:11px;color:var(--t3)">Баланс кассы</div>
              <div style="font-size:22px;font-weight:700;color:#22c55e">${money(cashBalance)}</div>
            </div>
            <div style="margin-bottom:10px">
              <label style="font-size:13px;color:var(--t3)">Сумма выдачи, ₽</label>
              <input id="pay-cash-amount" type="number" min="1" step="0.01" placeholder="0" style="width:100%;margin-top:4px;font-size:18px;font-weight:700;text-align:center"/>
            </div>
            <div style="margin-bottom:12px">
              <label style="font-size:13px;color:var(--t3)">Комментарий</label>
              <input id="pay-cash-comment" placeholder="Кому, на что" style="width:100%;margin-top:4px"/>
            </div>
            <button class="btn" id="btn-pay-cash" style="background:#22c55e;color:#fff;border:none;width:100%">💵 Выдать наличные</button>
          </div>
        </div>

        <!-- Доработка / Вопрос -->
        <div style="display:flex;gap:8px;margin-top:16px;justify-content:center">
          <button class="btn ghost" id="btn-buh-rework" style="font-size:12px">🔄 На доработку</button>
          <button class="btn ghost" id="btn-buh-question" style="font-size:12px">❓ Вопрос</button>
        </div>
      </div>`;

    showModal(`Оплата: ${entityType.replace(/_/g, ' ')} #${entityId}`, html);

    // Переключение форм
    document.getElementById('opt-bank').addEventListener('click', () => {
      document.getElementById('form-bank').style.display = 'block';
      document.getElementById('form-cash').style.display = 'none';
      document.getElementById('opt-bank').style.borderColor = '#3b82f6';
      document.getElementById('opt-cash').style.borderColor = 'var(--brd)';
    });
    document.getElementById('opt-cash').addEventListener('click', () => {
      document.getElementById('form-cash').style.display = 'block';
      document.getElementById('form-bank').style.display = 'none';
      document.getElementById('opt-cash').style.borderColor = '#22c55e';
      document.getElementById('opt-bank').style.borderColor = 'var(--brd)';
    });

    // ─── Оплата через ПП ───
    document.getElementById('btn-pay-bank').addEventListener('click', async () => {
      const comment = document.getElementById('pay-bank-comment').value.trim();
      try {
        const resp = await fetch(`/api/approval/${entityType}/${entityId}/pay-bank`, {
          method: 'POST', headers: getHeaders(),
          body: JSON.stringify({ comment })
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.error); }
        toast('Оплачено', 'Платёж через ПП зарегистрирован', 'ok');
        hideModal();
        render(document.querySelector('[data-page="approval-payment"]') || document.getElementById('main-content'));
      } catch (err) { toast('Ошибка', err.message, 'err'); }
    });

    // ─── Выдача наличных ───
    document.getElementById('btn-pay-cash').addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('pay-cash-amount').value);
      const comment = document.getElementById('pay-cash-comment').value.trim();
      if (!amount || amount <= 0) { toast('Ошибка', 'Укажите сумму', 'err'); return; }
      if (amount > cashBalance) { toast('Ошибка', `Недостаточно средств. Баланс: ${money(cashBalance)}`, 'err'); return; }
      try {
        const resp = await fetch(`/api/approval/${entityType}/${entityId}/issue-cash`, {
          method: 'POST', headers: getHeaders(),
          body: JSON.stringify({ amount, comment })
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.error); }
        const data = await resp.json();
        toast('Выдано', `${money(amount)} из кассы. Баланс: ${money(data.cash_balance)}`, 'ok');
        hideModal();
        render(document.querySelector('[data-page="approval-payment"]') || document.getElementById('main-content'));
      } catch (err) { toast('Ошибка', err.message, 'err'); }
    });

    // ─── Доработка ───
    document.getElementById('btn-buh-rework').addEventListener('click', () => {
      showCommentModal('На доработку', async (comment) => {
        const resp = await fetch(`/api/approval/${entityType}/${entityId}/rework`, {
          method: 'POST', headers: getHeaders(),
          body: JSON.stringify({ comment })
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.error); }
        toast('Готово', 'Возвращено на доработку', 'ok');
        hideModal();
        render(document.querySelector('[data-page="approval-payment"]') || document.getElementById('main-content'));
      });
    });

    // ─── Вопрос ───
    document.getElementById('btn-buh-question').addEventListener('click', () => {
      showCommentModal('Вопрос', async (comment) => {
        const resp = await fetch(`/api/approval/${entityType}/${entityId}/question`, {
          method: 'POST', headers: getHeaders(),
          body: JSON.stringify({ comment })
        });
        if (!resp.ok) { const e = await resp.json(); throw new Error(e.error); }
        toast('Готово', 'Вопрос отправлен', 'ok');
        hideModal();
        render(document.querySelector('[data-page="approval-payment"]') || document.getElementById('main-content'));
      });
    });
  }

  // ─── Модалка ввода комментария ───
  function showCommentModal(title, onSubmit) {
    const html = `
      <div style="max-width:400px">
        <div style="margin-bottom:12px">
          <label style="font-size:13px;color:var(--t3)">Комментарий (обязательно)</label>
          <textarea id="buh-comment" rows="3" placeholder="Напишите..." style="width:100%;margin-top:4px;resize:vertical"></textarea>
        </div>
        <button class="btn" id="btn-submit-comment" style="width:100%">Отправить</button>
      </div>`;
    showModal(title, html);
    document.getElementById('btn-submit-comment').addEventListener('click', async () => {
      const comment = document.getElementById('buh-comment').value.trim();
      if (!comment) { toast('Ошибка', 'Нужен комментарий', 'err'); return; }
      try { await onSubmit(comment); } catch (err) { toast('Ошибка', err.message, 'err'); }
    });
  }

  return { render, showPaymentInvoiceBuhModal };
})();
