/**
 * ASGARD CRM — Согласования просчётов (all-estimates)
 * ═══════════════════════════════════════════════════════════════
 * Простое согласование: РП → директор (4 действия) → готово
 * Без бухгалтерии, без оплаты. Просчёт — это калькуляция.
 */
window.AsgardAllEstimatesPage = (function() {
  const { $, $$, esc, toast, showModal } = AsgardUI;

  function ymNow() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
  function money(x) { if (x === null || x === undefined || x === '') return '—'; const n = Number(x); return isNaN(n) ? esc(String(x)) : n.toLocaleString('ru-RU'); }
  function norm(s) { return String(s || '').toLowerCase().trim(); }
  function isDirectorRole(role) { return role === 'ADMIN' || String(role || '').startsWith('DIRECTOR'); }

  // ─── Статусы с цветами ───
  const STATUS_MAP = {
    draft:    { label: 'Черновик',       color: '#6b7280', bg: 'rgba(107,114,128,.15)' },
    sent:     { label: 'На согласовании', color: '#3b82f6', bg: 'rgba(59,130,246,.15)' },
    approved: { label: 'Согласовано',     color: '#22c55e', bg: 'rgba(34,197,94,.15)' },
    rework:   { label: 'На доработке',    color: '#f59e0b', bg: 'rgba(245,158,11,.15)' },
    question: { label: 'Вопрос',          color: '#a855f7', bg: 'rgba(168,85,247,.15)' },
    rejected: { label: 'Отклонено',       color: '#ef4444', bg: 'rgba(239,68,68,.15)' },
    cancelled:{ label: 'Отменено',        color: '#6b7280', bg: 'rgba(107,114,128,.15)' }
  };

  function statusPill(status) {
    const s = STATUS_MAP[status] || STATUS_MAP.draft;
    return `<span style="display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;color:${s.color};background:${s.bg};border:1px solid ${s.color}30">${s.label}</span>`;
  }

  function statusLabel(status) {
    return (STATUS_MAP[status] || STATUS_MAP.draft).label;
  }

  function getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (localStorage.getItem('asgard_token') || '')
    };
  }

  async function render({ layout, title }) {
    let currentPage = 1;
    let pageSize = window.AsgardPagination ? AsgardPagination.getPageSize() : 20;
    const auth = await AsgardAuth.requireUser();
    if (!auth) { location.hash = '#/login'; return; }
    const user = auth.user || auth;
    const users = await AsgardDB.all('users');
    const byId = new Map(users.filter(u => u.is_active).map(u => [u.id, u]));
    const settings = await AsgardDB.get('settings', 'app');
    const vatPct = settings ? (JSON.parse(settings.value_json || '{}').vat_pct || 20) : 20;
    const tenders = await AsgardDB.all('tenders');
    let estimates = await AsgardDB.all('estimates');
    let sortKey = 'sent_for_approval_at';
    let sortDir = -1;

    function generatePeriodOptions(current) {
      const opts = ['<option value="">Все</option>'];
      const now = new Date();
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
        opts.push(`<option value="${v}"${v === current ? ' selected' : ''}>${esc(label)}</option>`);
      }
      return opts.join('');
    }

    const filterHtml = `
      <div class="tools">
        <div class="field"><label>Период</label><select id="f_period">${generatePeriodOptions(ymNow())}</select></div>
        <div class="field"><label>Поиск</label><input id="f_q" placeholder="заказчик / тендер"/></div>
        <div class="field"><label>РП</label><select id="f_pm"><option value="">Все</option>${
          users.filter(u => u.is_active && (u.role === 'PM' || u.role === 'HEAD_PM'))
            .map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')
        }</select></div>
        <div class="field"><label>Статус</label><select id="f_a"><option value="">Все</option>${
          Object.entries(STATUS_MAP).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')
        }</select></div>
      </div>`;

    const body = `<div class="panel">
      <div class="help">Очередь просчётов на согласование. Директор согласовывает / возвращает / задаёт вопрос / отклоняет.</div>
      <hr class="hr"/>${filterHtml}<hr class="hr"/>
      <div style="overflow:auto">
        <table class="asg"><thead><tr>
          <th style="cursor:pointer" data-sort="tender_id">Заказчик</th>
          <th style="cursor:pointer" data-sort="pm_id">РП</th>
          <th style="cursor:pointer" data-sort="version_no">v</th>
          <th style="cursor:pointer" data-sort="approval_status">Статус</th>
          <th style="cursor:pointer" data-sort="price_tkp">Цена ТКП</th>
          <th style="cursor:pointer" data-sort="cost_plan">Себестоим.</th>
          <th></th>
        </tr></thead><tbody id="tb"></tbody></table>
      </div>
      <div class="help" id="cnt"></div>
    </div>`;

    await layout(body, { title: title || 'Согласование просчётов' });
    const tb = $('#tb');
    const cnt = $('#cnt');

    function sortBy(key, dir) {
      return (a, b) => {
        const av = a[key] ?? '';
        const bv = b[key] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
        return dir * String(av).localeCompare(String(bv), 'ru', { sensitivity: 'base' });
      };
    }

    function row(e) {
      const t = tenders.find(x => x.id === e.tender_id);
      const pm = byId.get(e.pm_id);
      const priceNoVat = e.price_tkp != null ? Math.round(Number(e.price_tkp) / (1 + vatPct / 100)) : null;
      const sent = e.sent_for_approval_at ? new Date(e.sent_for_approval_at).toLocaleDateString('ru-RU') : '';
      return `<tr data-id="${e.id}">
        <td><b>${esc(t?.customer_name || '—')}</b><div class="help">${esc(t?.tender_title || '—')}</div></td>
        <td>${esc(pm ? pm.name : '—')}</td>
        <td>#${esc(e.version_no || 1)}</td>
        <td>${statusPill(e.approval_status || 'draft')}${sent ? `<div class="help" style="margin-top:4px">${sent}</div>` : ''}</td>
        <td><b>${money(e.price_tkp)}</b>${priceNoVat != null ? `<div class="help">б/НДС: ${money(priceNoVat)}</div>` : ''}</td>
        <td>${money(e.cost_plan)}</td>
        <td><button class="btn" style="padding:6px 10px" data-act="open">Открыть</button></td>
      </tr>`;
    }

    function apply() {
      const per = norm($('#f_period').value);
      const q = norm($('#f_q').value);
      const pm = $('#f_pm').value;
      const a = $('#f_a').value;
      let list = estimates.filter(e => {
        const t = tenders.find(x => x.id === e.tender_id);
        if (per && norm(t?.period || '') !== per) return false;
        if (pm && String(e.pm_id) !== String(pm)) return false;
        if (a && (e.approval_status || 'draft') !== a) return false;
        if (q) { const hay = `${t?.customer_name || ''} ${t?.tender_title || ''}`.toLowerCase(); if (!hay.includes(q)) return false; }
        return true;
      });
      list.sort(sortBy(sortKey, sortDir));
      const paged = window.AsgardPagination ? AsgardPagination.paginate(list, currentPage, pageSize) : list;
      tb.innerHTML = paged.map(row).join('');
      if (window.AsgardPagination) {
        let pgEl = document.getElementById('estimates_pagination');
        if (!pgEl) { pgEl = document.createElement('div'); pgEl.id = 'estimates_pagination'; tb.closest('table').after(pgEl); }
        pgEl.innerHTML = AsgardPagination.renderControls(list.length, currentPage, pageSize);
        AsgardPagination.attachHandlers('estimates_pagination', p => { currentPage = p; apply(); }, s => { pageSize = s; currentPage = 1; apply(); });
      }
      cnt.textContent = `Показано: ${list.length} из ${estimates.length}`;
    }

    // ─── Модалка просмотра/согласования ───
    async function openEst(id) {
      const e = await AsgardDB.get('estimates', id);
      if (!e) { toast('Ошибка', 'Просчёт не найден', 'err'); return; }
      const t = tenders.find(x => x.id === e.tender_id);
      const pm = byId.get(e.pm_id);
      const sent = e.sent_for_approval_at ? new Date(e.sent_for_approval_at).toLocaleString('ru-RU') : '—';
      const decided = e.decided_at ? new Date(e.decided_at).toLocaleString('ru-RU') : null;
      const decidedBy = e.decided_by_user_id ? byId.get(e.decided_by_user_id) : null;

      const canAct = isDirectorRole(user.role) && e.approval_status === 'sent';
      const isPmRework = ['rework', 'question'].includes(e.approval_status) && (Number(user.id) === Number(e.pm_id) || user.role === 'ADMIN');

      const actionsHtml = canAct ? `
        <hr class="hr"/>
        <div style="font-weight:600;margin-bottom:8px">Решение директора</div>
        <div style="margin-bottom:12px">
          <label style="font-size:13px;color:var(--t3)">Комментарий <span style="color:var(--t3);font-weight:400">(обязателен для доработки, вопроса, отклонения)</span></label>
          <input id="a_comm" value="" placeholder="Ваш комментарий" style="width:100%;margin-top:4px"/>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" id="btnApprove" style="background:var(--green,#22c55e);color:#fff">✅ Согласовать</button>
          <button class="btn" id="btnRework" style="background:var(--amber,#f59e0b);color:#fff">🔄 Доработка</button>
          <button class="btn" id="btnQuestion" style="background:var(--purple,#a855f7);color:#fff">❓ Вопрос</button>
          <button class="btn" id="btnReject" style="background:var(--red,#ef4444);color:#fff">❌ Отклонить</button>
        </div>` : '';

      const pmHint = isPmRework ? `
        <hr class="hr"/>
        <div style="padding:12px;border-radius:8px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3)">
          <div style="font-weight:600;color:var(--amber)">⚠️ ${e.approval_status === 'question' ? 'Вопрос от директора' : 'Возвращено на доработку'}</div>
          <div style="margin-top:6px;font-size:13px">${esc(e.approval_comment || '—')}</div>
          <div style="margin-top:10px">
            <button class="btn" id="btnResend">📤 Отправить повторно</button>
          </div>
        </div>` : '';

      const html = `
        <div style="max-width:600px">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:12px;flex-wrap:wrap">
            <div>
              <div style="font-size:16px;font-weight:700">${esc(t?.customer_name || '—')}</div>
              <div class="help" style="margin-top:4px">${esc(t?.tender_title || '—')}</div>
            </div>
            ${statusPill(e.approval_status || 'draft')}
          </div>
          <hr class="hr"/>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:13px">
            <div><span style="color:var(--t3)">РП:</span> <b>${esc(pm?.name || '—')}</b></div>
            <div><span style="color:var(--t3)">Версия:</span> <b>v${esc(String(e.version_no || 1))}</b></div>
            <div><span style="color:var(--t3)">Цена ТКП:</span> <b>${money(e.price_tkp)} ₽</b></div>
            <div><span style="color:var(--t3)">Себестоимость:</span> <b>${money(e.cost_plan)} ₽</b></div>
            <div><span style="color:var(--t3)">Отправлено:</span> ${sent}</div>
            ${decided ? `<div><span style="color:var(--t3)">Решение:</span> ${decided}${decidedBy ? ' · ' + esc(decidedBy.name) : ''}</div>` : ''}
          </div>
          ${e.cover_letter ? `<hr class="hr"/><div style="font-weight:600;margin-bottom:6px">Сопроводительное письмо</div><div style="padding:10px;border-radius:6px;background:var(--bg2);font-size:13px;white-space:pre-wrap">${esc(e.cover_letter)}</div>` : ''}
          ${e.comment ? `<div style="margin-top:10px;font-size:13px"><span style="color:var(--t3)">Комментарий РП:</span> ${esc(e.comment)}</div>` : ''}
          ${e.approval_comment && !isPmRework ? `<div style="margin-top:10px;font-size:13px"><span style="color:var(--t3)">Комментарий директора:</span> ${esc(e.approval_comment)}</div>` : ''}
          ${pmHint}
          ${actionsHtml}
        </div>`;

      showModal(`Просчёт #${id}`, html);

      // ─── Обработчики кнопок директора ───
      async function doAction(newStatus, requireComment) {
        const comm = (document.getElementById('a_comm')?.value || '').trim();
        if (requireComment && !comm) { toast('Ошибка', 'Нужен комментарий', 'err'); return; }
        try {
          const resp = await fetch(`/api/data/estimates/${id}`, {
            method: 'PUT', headers: getHeaders(),
            body: JSON.stringify({ approval_status: newStatus, approval_comment: comm || null })
          });
          if (!resp.ok) { const err = await resp.json(); throw new Error(err.error || 'Ошибка'); }
          await AsgardDB.put('estimates', { ...(await AsgardDB.get('estimates', id)), approval_status: newStatus, approval_comment: comm });
          estimates = await AsgardDB.all('estimates');
          toast('Готово', statusLabel(newStatus), 'ok');
          apply();
          AsgardUI.hideModal();
        } catch (err) { toast('Ошибка', err.message, 'err'); }
      }

      const btnApprove = document.getElementById('btnApprove');
      const btnRework = document.getElementById('btnRework');
      const btnQuestion = document.getElementById('btnQuestion');
      const btnReject = document.getElementById('btnReject');
      const btnResend = document.getElementById('btnResend');

      if (btnApprove) btnApprove.addEventListener('click', () => doAction('approved', false));
      if (btnRework) btnRework.addEventListener('click', () => doAction('rework', true));
      if (btnQuestion) btnQuestion.addEventListener('click', () => doAction('question', true));
      if (btnReject) btnReject.addEventListener('click', () => doAction('rejected', true));
      if (btnResend) btnResend.addEventListener('click', () => doAction('sent', false));
    }

    // ─── Events ───
    estimates = await AsgardDB.all('estimates');
    apply();
    $('#f_period').addEventListener('input', apply);
    $('#f_q').addEventListener('input', apply);
    $('#f_pm').addEventListener('change', apply);
    $('#f_a').addEventListener('change', apply);
    $$('[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.getAttribute('data-sort');
        if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; }
        apply();
      });
    });
    tb.addEventListener('click', ev => {
      const tr = ev.target.closest('tr[data-id]');
      if (!tr) return;
      const id = Number(tr.getAttribute('data-id'));
      if (ev.target.getAttribute('data-act') === 'open') openEst(id);
    });

    const parseId = () => { const h = String(location.hash || ''); const i = h.indexOf('?'); if (i < 0) return null; const p = new URLSearchParams(h.slice(i + 1)); const id = Number(p.get('id')); return id > 0 ? id : null; };
    const initialId = parseId();
    if (initialId) setTimeout(() => openEst(initialId), 0);
  }

  return { render };
})();
