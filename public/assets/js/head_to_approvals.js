/**
 * ASGARD CRM — Очередь согласований просчётов ТО для Рук. ТО.
 * ═══════════════════════════════════════════════════════════════════════════
 * HEAD_TO видит здесь все estimates от тендеров с calculator_kind='to', где
 * approval_status='sent'. Действия (через generic /api/approval/estimates/:id/*):
 *   ✓ Согласовать  → POST .../approve
 *   ↻ На доработку → POST .../rework (требует комментарий)
 *   ❓ Вопрос       → POST .../question (требует комментарий)
 *   ✕ Отклонить    → POST .../reject (требует комментарий)
 *
 * Бэкенд знает что для kind='to' согласует HEAD_TO (approvalService.js).
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
window.AsgardHeadToApprovalsPage = (function () {
  const { $, esc, toast, showModal, money } = AsgardUI;

  function getHeaders() {
    const auth = (typeof AsgardAuth !== 'undefined') ? AsgardAuth.getAuth() : null;
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (auth?.token || localStorage.getItem('asgard_token') || '')
    };
  }

  async function fetchJSON(url, opts) {
    const res = await fetch(url, Object.assign({ headers: getHeaders() }, opts || {}));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
    return data;
  }

  async function loadPending() {
    // 1) тендеры с kind='to'
    const td = await fetchJSON('/api/tenders?limit=500');
    const toTenders = (td.tenders || []).filter(t => t.calculator_kind === 'to');
    if (!toTenders.length) return [];
    // 2) для каждого — последний estimate, фильтр approval_status='sent'
    const out = [];
    const promises = toTenders.map(t =>
      fetchJSON(`/api/estimates?tender_id=${t.id}`)
        .then(d => {
          const items = d.estimates || d.items || [];
          for (const e of items) {
            if (['sent'].includes(e.approval_status)) out.push({ tender: t, estimate: e });
          }
        }).catch(() => null)
    );
    await Promise.all(promises);
    out.sort((a, b) => (b.estimate.sent_for_approval_at || '').localeCompare(a.estimate.sent_for_approval_at || ''));
    return out;
  }

  async function askComment(title, label) {
    return new Promise(resolve => {
      let val = '';
      showModal({
        title,
        html: `
          <div class="cr-f-field">
            <div class="cr-f-label">${esc(label)} <span class="cr-f-label__req">*</span></div>
            <textarea id="apvCmt" rows="4" style="width:100%;min-height:80px"></textarea>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
            <button class="btn ghost" id="apvCancel">Отмена</button>
            <button class="btn red" id="apvOk">Подтвердить</button>
          </div>
        `,
        onMount: (root) => {
          const scope = root && root.querySelector ? root : document;
          const ta = scope.querySelector('#apvCmt');
          const ok = scope.querySelector('#apvOk');
          const cn = scope.querySelector('#apvCancel');
          if (ta) ta.focus();
          if (ok) ok.addEventListener('click', () => { val = (ta?.value || '').trim(); AsgardUI.hideModal(); resolve(val); });
          if (cn) cn.addEventListener('click', () => { AsgardUI.hideModal(); resolve(null); });
        }
      });
      setTimeout(() => {
        const ta = document.getElementById('apvCmt');
        const ok = document.getElementById('apvOk');
        const cn = document.getElementById('apvCancel');
        if (ok && !ok._b) { ok._b = 1; ok.addEventListener('click', () => { val = (ta?.value || '').trim(); AsgardUI.hideModal(); resolve(val); }); }
        if (cn && !cn._b) { cn._b = 1; cn.addEventListener('click', () => { AsgardUI.hideModal(); resolve(null); }); }
      }, 50);
    });
  }

  function row(entry) {
    const { tender: t, estimate: e } = entry;
    const sum = e.price_tkp || e.total_sum || t.tender_price;
    const sumStr = sum ? money(sum) + ' ₽' : '—';
    const margin = e.margin_pct || e.margin_percent;
    return `
      <div class="card" style="margin-bottom:10px" data-est="${e.id}">
        <div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:15px">
              ${esc(t.customer_name || '')} — ${esc(t.tender_title || '')}
            </div>
            <div class="help" style="margin-top:4px">
              Тип: <b>${esc(t.tender_type || '')}</b> · Сумма ТКП: <b>${sumStr}</b>${margin ? ' · Маржа: <b>' + esc(String(margin)) + '%</b>' : ''}
            </div>
            <div style="margin-top:6px;font-size:12px;color:var(--t3)">
              Просчёт #${e.id}, версия ${e.version_no || e.version || 1}, отправлен на согласование ${e.sent_for_approval_at ? new Date(e.sent_for_approval_at).toLocaleString('ru-RU') : '—'}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;min-width:340px">
            <button class="btn mini" data-act="approve" data-est="${e.id}" style="background:#2ecc71;color:#fff;font-weight:700">✓ Согласовать</button>
            <button class="btn mini" data-act="rework" data-est="${e.id}" style="background:#e67e22;color:#fff">↻ Доработать</button>
            <button class="btn mini" data-act="question" data-est="${e.id}" style="background:#f39c12;color:#fff">❓ Вопрос</button>
            <button class="btn mini" data-act="reject" data-est="${e.id}" style="background:#e74c3c;color:#fff">✕ Отклонить</button>
            <button class="btn ghost mini" data-act="open-tender" data-tid="${t.id}">📝 Карточка</button>
          </div>
        </div>
      </div>
    `;
  }

  async function bindActions(root, rerender) {
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const estId = Number(btn.getAttribute('data-est') || 0);
      const tid = Number(btn.getAttribute('data-tid') || 0);

      if (act === 'open-tender' && tid) {
        location.hash = `#/tenders?id=${tid}`;
        return;
      }

      if (act === 'approve' && estId) {
        const cmt = await askComment('Согласовать просчёт', 'Комментарий (необязательно)');
        if (cmt === null) return; // отмена
        btn.disabled = true;
        try {
          await fetchJSON(`/api/approval/estimates/${estId}/approve`, {
            method: 'POST', body: JSON.stringify({ comment: cmt || '' })
          });
          toast('Согласование', 'Просчёт согласован ✓', 'ok');
          await rerender();
        } catch (err) {
          toast('Согласование', err.message || 'Ошибка', 'err');
          btn.disabled = false;
        }
        return;
      }

      const actionMap = {
        rework: { label: 'Отправить на доработку', cmtLabel: 'Что нужно доработать', okMsg: 'Отправлено на доработку' },
        question: { label: 'Задать вопрос', cmtLabel: 'Ваш вопрос', okMsg: 'Вопрос отправлен ТО' },
        reject: { label: 'Отклонить просчёт', cmtLabel: 'Причина отклонения', okMsg: 'Просчёт отклонён' }
      };
      const cfg = actionMap[act];
      if (!cfg || !estId) return;

      const cmt = await askComment(cfg.label, cfg.cmtLabel);
      if (!cmt) {
        if (cmt === '') toast('Согласование', 'Комментарий обязателен', 'err');
        return;
      }
      btn.disabled = true;
      try {
        await fetchJSON(`/api/approval/estimates/${estId}/${act}`, {
          method: 'POST', body: JSON.stringify({ comment: cmt })
        });
        toast('Согласование', cfg.okMsg, 'ok');
        await rerender();
      } catch (err) {
        toast('Согласование', err.message || 'Ошибка', 'err');
        btn.disabled = false;
      }
    });
  }

  async function render({ layout, title }) {
    const auth = (typeof AsgardAuth !== 'undefined') ? AsgardAuth.getAuth() : null;
    const user = auth?.user || {};
    if (!user.id) { layout('<div class="card">Требуется авторизация</div>', title); return; }
    if (!['HEAD_TO', 'ADMIN'].includes(user.role)) {
      layout('<div class="card"><div style="color:var(--err-t)">Доступно только Рук. тендерного отдела.</div></div>', title);
      return;
    }

    await layout('<div id="htApRoot"><div class="card"><div class="help">⏳ Загрузка очереди…</div></div></div>', { title: title || 'Согласование просчётов ТО' });
    const root = document.getElementById('htApRoot');
    if (!root) { console.warn('[head-to-approvals] root not found'); return; }

    async function doRender() {
      try {
        const items = await loadPending();
        const intro = `
          <div class="card" style="margin-bottom:12px">
            <h2 style="margin:0 0 4px">📋 Согласование просчётов тендерного отдела</h2>
            <div class="help">
              Здесь только те просчёты, которые ТО считал САМ (calculator_kind='to') и отправил на ваше согласование.
              Обычные просчёты РП по-прежнему идут директорам.
            </div>
          </div>
        `;
        if (!items.length) {
          root.innerHTML = intro + `<div class="card"><div class="help">Очередь пуста. Ждём отправок от ТО.</div></div>`;
          return;
        }
        root.innerHTML = intro + `<h3 style="margin:8px 0 12px">К рассмотрению: <span class="badge">${items.length}</span></h3>` + items.map(row).join('');
      } catch (err) {
        root.innerHTML = `<div class="card"><div style="color:var(--err-t,#e74c3c)">Ошибка: ${esc(err.message)}</div></div>`;
      }
    }

    await doRender();
    await bindActions(root, doRender);
  }

  return { render };
})();
