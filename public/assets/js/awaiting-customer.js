/**
 * ASGARD CRM — Дашборд «Просчёты в ожидании заказчика» (Сессия 5, Шаг 5.6)
 * ═══════════════════════════════════════════════════════════════════════════
 * Список просчётов Conductor в статусе BLOCKED_BY_CUSTOMER с днями ожидания,
 * номером письма и кнопками: скачать PDF/DOCX, отметить отправленным, загрузить
 * ответ заказчика (файл/текст) → разметка ответов → применить и возобновить.
 *
 * Зависит от window.AsgardAuth (getToken) и window.AsgardUI (toast).
 * ═══════════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  const API = '/api/mimir/conductor';
  const ui = () => window.AsgardUI || {};
  function toast(t, m, k) { if (ui().toast) ui().toast(t, m, k); else console.log(t, m); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function token() { return (window.AsgardAuth && window.AsgardAuth.getToken && window.AsgardAuth.getToken()) || ''; }
  function authFetch(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers, { Authorization: 'Bearer ' + token() });
    return fetch(url, opts);
  }
  function fmtRub(v) {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return Math.round(n).toLocaleString('ru-RU') + ' ₽';
  }

  let _items = [];

  async function load() {
    const list = document.getElementById('ac-list');
    const empty = document.getElementById('ac-empty');
    list.innerHTML = '<div class="mc-empty">Загрузка…</div>';
    try {
      const r = await authFetch(API + '/awaiting-customer');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      _items = data.items || [];
    } catch (e) {
      list.innerHTML = '<div class="mc-empty">Ошибка загрузки: ' + esc(e.message) + '</div>';
      return;
    }
    if (!_items.length) { list.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    list.innerHTML = _items.map(renderCard).join('');
    attachHandlers();
  }

  function renderCard(it) {
    const title = esc(it.tender_title || ('Просчёт #' + it.run_id));
    const cust = esc(it.customer_name || '—');
    const days = it.days_waiting != null ? it.days_waiting : '—';
    const daysCls = it.days_waiting >= 10 ? 'ac-days-danger' : (it.days_waiting >= 5 ? 'ac-days-warn' : '');
    const letterId = it.letter_id;
    const lstatus = esc(it.letter_status || '—');
    const lnum = esc(it.letter_number || '');

    let letterBlock;
    if (letterId) {
      const sentBtns = (it.letter_status === 'DRAFTED')
        ? `<button class="mc-btn mc-btn-primary ac-act" data-act="mark-sent" data-letter="${letterId}">✉ Отметить отправленным</button>`
        : `<button class="mc-btn mc-btn-primary ac-act" data-act="upload-reply" data-letter="${letterId}">📥 Получен ответ</button>`;
      letterBlock = `
        <div class="ac-letter">
          <span>📄 Письмо <b>${lnum}</b> — <i>${lstatus}</i></span>
          <div class="ac-letter-btns">
            <a class="mc-btn mc-btn-ghost" href="${API}/letter/${letterId}/download/pdf?_t=${token()}" data-dl="pdf" data-letter="${letterId}">PDF</a>
            <a class="mc-btn mc-btn-ghost" href="${API}/letter/${letterId}/download/docx?_t=${token()}" data-dl="docx" data-letter="${letterId}">DOCX</a>
            ${sentBtns}
          </div>
        </div>`;
    } else {
      letterBlock = `<div class="ac-letter"><span>Письмо ещё не сформировано. Открытых вопросов: ${it.open_questions || 0}</span>
        <button class="mc-btn mc-btn-primary ac-act" data-act="gen-letter" data-run="${it.run_id}">📄 Сформировать письмо</button></div>`;
    }

    return `
      <div class="ac-card" data-run="${it.run_id}">
        <div class="ac-card-head">
          <span class="ac-card-title">${title}</span>
          <span class="ac-days ${daysCls}">⏳ ${days} дн.</span>
        </div>
        <div class="ac-card-sub">Заказчик: ${cust} · открытых вопросов: ${it.open_questions || 0}</div>
        ${letterBlock}
      </div>`;
  }

  function attachHandlers() {
    document.querySelectorAll('.ac-act').forEach((btn) => {
      btn.addEventListener('click', onAction);
    });
    // download-ссылки работают как обычные <a>, но добавим заголовок через blob,
    // потому что токен в query сервер не проверяет на download — используем fetch.
    document.querySelectorAll('a[data-dl]').forEach((a) => {
      a.addEventListener('click', onDownload);
    });
  }

  async function onDownload(ev) {
    ev.preventDefault();
    const letterId = ev.currentTarget.getAttribute('data-letter');
    const fmt = ev.currentTarget.getAttribute('data-dl');
    try {
      const r = await authFetch(`${API}/letter/${letterId}/download/${fmt}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `letter_${letterId}.${fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast('Ошибка', 'Не удалось скачать: ' + e.message, 'err');
    }
  }

  async function onAction(ev) {
    const btn = ev.currentTarget;
    const act = btn.getAttribute('data-act');
    if (act === 'gen-letter') return genLetter(btn.getAttribute('data-run'));
    if (act === 'mark-sent') return markSent(btn.getAttribute('data-letter'));
    if (act === 'upload-reply') return openReplyModal(btn.getAttribute('data-letter'));
  }

  async function genLetter(runId) {
    // Берём открытые вопросы к заказчику через детали прогона.
    try {
      const r = await authFetch(`${API}/run/${runId}`);
      const det = await r.json();
      const ids = (det.clarifications || [])
        .filter((c) => c.channel === 'CUSTOMER' && c.status === 'OPEN')
        .map((c) => c.id);
      if (!ids.length) { toast('Нет вопросов', 'Открытых вопросов к заказчику не найдено', 'warn'); return; }
      const gr = await authFetch(`${API}/letter/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: Number(runId), clarification_ids: ids })
      });
      if (!gr.ok) { const e = await gr.json().catch(() => ({})); throw new Error(e.error || ('HTTP ' + gr.status)); }
      const res = await gr.json();
      toast('Письмо сформировано', 'Исх. № ' + res.letterNumber, 'ok');
      load();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  async function markSent(letterId) {
    try {
      const r = await authFetch(`${API}/letter/${letterId}/mark-sent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'manual' })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      toast('Готово', 'Письмо отмечено отправленным', 'ok');
      load();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  // ─── Модалка загрузки ответа + разметки ───
  function openReplyModal(letterId) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'ac-modal-bg';
    m.id = 'ac-modal';
    m.innerHTML = `
      <div class="ac-modal">
        <div class="ac-modal-head">📥 Ответ заказчика по письму #${esc(letterId)}
          <button class="ac-modal-x" id="ac-modal-x">✕</button></div>
        <div class="ac-modal-body">
          <label>Вставьте текст ответа заказчика:</label>
          <textarea id="ac-reply-text" rows="6" placeholder="Текст письма-ответа…"></textarea>
          <div class="ac-or">— или —</div>
          <input type="file" id="ac-reply-file" accept=".pdf,.docx,.txt,.csv,.xls,.xlsx,.jpg,.png">
          <button class="mc-btn mc-btn-primary" id="ac-parse-btn">Распознать ответ</button>
          <div id="ac-mapping"></div>
        </div>
      </div>`;
    document.body.appendChild(m);
    document.getElementById('ac-modal-x').addEventListener('click', closeModal);
    document.getElementById('ac-parse-btn').addEventListener('click', () => parseReply(letterId));
  }

  function closeModal() {
    const m = document.getElementById('ac-modal');
    if (m) m.remove();
  }

  async function parseReply(letterId) {
    const text = (document.getElementById('ac-reply-text').value || '').trim();
    const fileInput = document.getElementById('ac-reply-file');
    const file = fileInput.files && fileInput.files[0];
    if (!text && !file) { toast('Нужны данные', 'Вставьте текст или выберите файл', 'warn'); return; }

    let mapping;
    try {
      let r;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        if (text) fd.append('text', text);
        r = await authFetch(`${API}/letter/${letterId}/upload-reply`, { method: 'POST', body: fd });
      } else {
        r = await authFetch(`${API}/letter/${letterId}/upload-reply`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
        });
      }
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || ('HTTP ' + r.status)); }
      mapping = (await r.json()).mapping;
    } catch (e) {
      toast('Ошибка разбора', e.message, 'err');
      return;
    }
    renderMapping(letterId, mapping);
  }

  function renderMapping(letterId, mapping) {
    const wrap = document.getElementById('ac-mapping');
    const matches = (mapping && mapping.matches) || [];
    if (!matches.length) { wrap.innerHTML = '<div class="mc-empty">Вопросов не найдено</div>'; return; }
    wrap.innerHTML = `
      <div class="ac-map-title">Сопоставление (можно править):</div>
      ${matches.map((m, i) => `
        <div class="ac-map-row" data-qid="${m.question_id}">
          <div class="ac-map-q">Вопрос #${esc(m.question_id)} ${m.confidence ? '· уверенность ' + Math.round(m.confidence * 100) + '%' : ''}</div>
          <textarea class="ac-map-ans" rows="2" placeholder="Ответ заказчика…">${esc(m.answer_text || '')}</textarea>
          ${m.note ? `<div class="ac-map-note">${esc(m.note)}</div>` : ''}
        </div>`).join('')}
      <button class="mc-btn mc-btn-primary" id="ac-apply-btn">✅ Применить и возобновить просчёт</button>`;
    document.getElementById('ac-apply-btn').addEventListener('click', () => applyMapping(letterId));
  }

  async function applyMapping(letterId) {
    const rows = Array.from(document.querySelectorAll('.ac-map-row'));
    const mapping = rows.map((row) => ({
      question_id: Number(row.getAttribute('data-qid')),
      answer_text: (row.querySelector('.ac-map-ans').value || '').trim() || null
    }));
    try {
      const r = await authFetch(`${API}/letter/${letterId}/apply-mapping`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapping })
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || ('HTTP ' + r.status)); }
      const res = await r.json();
      const resumed = res.resume && res.resume.resumed;
      toast('Применено', resumed ? 'Просчёт возобновлён' : 'Ответы сохранены', 'ok');
      closeModal();
      load();
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  function init() {
    const btn = document.getElementById('ac-refresh');
    if (btn) btn.addEventListener('click', load);
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
