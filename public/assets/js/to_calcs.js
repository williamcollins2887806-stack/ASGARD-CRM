/**
 * ASGARD CRM — Страница «Мои просчёты» для тендерного отдела (TO/HEAD_TO).
 * ═══════════════════════════════════════════════════════════════════════════
 * Аналог /pm-calcs для РП, но для ТО которые ВЗЯЛИ тендер себе на просчёт
 * (calculator_kind='to' в tenders). Согласует HEAD_TO (не директор).
 *
 * RBAC:
 *   TO       — видит свои тендеры (calculator_user_id = me)
 *   HEAD_TO  — видит все тендеры с calculator_kind='to'
 *   ADMIN    — видит все
 *
 * Кнопки на карточке:
 *   🧮 Просчитать          — openEstimateMethodPicker(null, tender_id)
 *   📤 На согласование      — POST /api/approval/estimates/:id/send (HEAD_TO согласует)
 *   ⚡ Создать ТКП           — открывает форму ТКП (через /tkp страницу)
 *   ✉️ Отправить КП          — POST /api/tkp/:id/send
 *   📝 Открыть карточку     — #/tenders?id=N
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
window.AsgardToCalcsPage = (function () {
  const { $, $$, esc, toast, showModal, money } = AsgardUI;

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

  async function loadTenders(user) {
    // GET /api/tenders с фильтром — сервер вернёт всё, фильтруем на клиенте
    const data = await fetchJSON('/api/tenders?limit=500');
    const all = data.tenders || [];
    return all.filter(t => {
      if (t.calculator_kind !== 'to') return false;
      if (user.role === 'TO') {
        return Number(t.calculator_user_id || t.created_by_user_id || t.created_by) === Number(user.id);
      }
      return true; // HEAD_TO и ADMIN видят все
    });
  }

  async function loadEstimates(tenderIds) {
    if (!tenderIds.length) return new Map();
    const map = new Map();
    // По одному GET /api/estimates?tender_id=N — параллельно
    const promises = tenderIds.map(id =>
      fetchJSON(`/api/estimates?tender_id=${id}`).then(d => ({ id, items: d.estimates || d.items || [] })).catch(() => ({ id, items: [] }))
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      // самый свежий estimate для тендера
      const last = r.items.sort((a, b) => (b.id || 0) - (a.id || 0))[0] || null;
      if (last) map.set(r.id, last);
    }
    return map;
  }

  async function loadTkps(tenderIds) {
    if (!tenderIds.length) return new Map();
    const map = new Map();
    const promises = tenderIds.map(id =>
      fetchJSON(`/api/tkp?tender_id=${id}`).then(d => ({ id, items: d.items || [] })).catch(() => ({ id, items: [] }))
    );
    const results = await Promise.all(promises);
    for (const r of results) {
      const last = r.items.sort((a, b) => (b.id || 0) - (a.id || 0))[0] || null;
      if (last) map.set(r.id, last);
    }
    return map;
  }

  function statusBadge(status) {
    const colors = {
      'Отправлено на просчёт': '#5b8def',
      'Согласование ТКП': '#9b59b6',
      'ТКП согласовано': '#2ecc71',
      'Готово к отправке КП': '#c8a84e',
      'КП отправлено': '#17a2b8',
      'Выиграли': '#27ae60',
      'Проиграли': '#e74c3c'
    };
    const c = colors[status] || '#6c757d';
    return `<span style="display:inline-block;padding:2px 10px;border-radius:10px;background:${c}22;color:${c};font-weight:600;font-size:12px">${esc(status || '—')}</span>`;
  }

  function approvalBadge(estimate) {
    if (!estimate) return '<span class="help">просчёт ещё не запущен</span>';
    const map = {
      draft: { bg: '#6c757d', label: 'Черновик' },
      sent: { bg: '#5b8def', label: 'На согласовании у HEAD_TO' },
      approved: { bg: '#2ecc71', label: 'Согласовано' },
      rework: { bg: '#e67e22', label: 'На доработке' },
      question: { bg: '#f39c12', label: 'Вопрос' },
      rejected: { bg: '#e74c3c', label: 'Отклонено' }
    };
    const m = map[estimate.approval_status] || { bg: '#6c757d', label: estimate.approval_status || 'Черновик' };
    return `<span style="display:inline-block;padding:2px 10px;border-radius:10px;background:${m.bg}22;color:${m.bg};font-weight:600;font-size:12px">${esc(m.label)}</span>`;
  }

  function bucketOf(tender) {
    const s = tender.tender_status;
    if (['Отправлено на просчёт', 'Согласование ТКП'].includes(s)) return 'calc';
    if (s === 'ТКП согласовано') return 'tkp';
    if (s === 'Готово к отправке КП') return 'send';
    return 'other';
  }

  function tenderCard(t, est, tkp, user) {
    const totalSum = est?.price_tkp || est?.total_sum || t.tender_price;
    const sumStr = totalSum ? money(totalSum) + ' ₽' : '—';
    const ddl = t.docs_deadline ? new Date(t.docs_deadline).toLocaleDateString('ru-RU') : '';
    const myRowOk = (user.role !== 'TO') || Number(t.calculator_user_id || t.created_by_user_id || t.created_by) === Number(user.id);

    const actions = [];
    // 🧮 Просчитать — пока статус «Отправлено на просчёт» или нет estimate, или estimate=draft/rework/question
    const canCalc = ['Отправлено на просчёт'].includes(t.tender_status)
      || (['Согласование ТКП'].includes(t.tender_status) && ['rework', 'question'].includes(est?.approval_status));
    if (canCalc && myRowOk) {
      actions.push(`<button class="btn red mini" data-act="calc" data-id="${t.id}">🧮 Просчитать</button>`);
    }
    // 📤 Отправить на согласование
    if (est && est.approval_status === 'draft' && myRowOk) {
      actions.push(`<button class="btn mini" data-act="send-approval" data-est="${est.id}" style="background:#5b8def;color:#fff">📤 На согласование</button>`);
    }
    // Переотправить после доработки
    if (est && ['rework', 'question'].includes(est.approval_status) && myRowOk) {
      actions.push(`<button class="btn mini" data-act="resubmit" data-est="${est.id}" style="background:#e67e22;color:#fff">↻ Переотправить</button>`);
    }
    // ⚡ Создать ТКП — после ТКП согласовано, ТКП ещё нет
    if (t.tender_status === 'ТКП согласовано' && myRowOk && !tkp) {
      actions.push(`<button class="btn mini" data-act="create-tkp" data-id="${t.id}" style="background:#c8a84e;color:#1a1000;font-weight:700">⚡ Создать ТКП</button>`);
    }
    // ✉️ Отправить КП — после готовности
    if (t.tender_status === 'Готово к отправке КП' && tkp) {
      actions.push(`<button class="btn mini" data-act="send-kp" data-tkp="${tkp.id}" style="background:#17a2b8;color:#fff">✉️ Отправить КП клиенту</button>`);
    }
    actions.push(`<button class="btn ghost mini" data-act="open" data-id="${t.id}">📝 Карточка</button>`);

    return `
      <div class="card" style="margin-bottom:10px" data-tid="${t.id}">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:15px">${esc(t.customer_name || '')} — ${esc(t.tender_title || '')}</div>
            <div class="help" style="margin-top:4px">
              ${esc(t.tender_type || '')} · НМЦ: <b>${sumStr}</b>${ddl ? ' · Дедлайн: <b>' + esc(ddl) + '</b>' : ''}
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              ${statusBadge(t.tender_status)}
              ${approvalBadge(est)}
              ${tkp ? `<span style="display:inline-block;padding:2px 10px;border-radius:10px;background:#c8a84e22;color:#c8a84e;font-weight:600;font-size:12px">ТКП #${tkp.id}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;min-width:280px">
            ${actions.join(' ')}
          </div>
        </div>
      </div>
    `;
  }

  function bucketBlock(title, icon, items, est, tkp, user) {
    if (!items.length) return '';
    return `
      <div style="margin-bottom:18px">
        <h3 style="margin:0 0 10px;display:flex;align-items:center;gap:8px">
          <span>${icon}</span><span>${title}</span>
          <span class="badge">${items.length}</span>
        </h3>
        ${items.map(t => tenderCard(t, est.get(t.id), tkp.get(t.id), user)).join('')}
      </div>
    `;
  }

  async function bindActions(root, user, rerender) {
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const tid = Number(btn.getAttribute('data-id') || 0);
      const estId = Number(btn.getAttribute('data-est') || 0);
      const tkpId = Number(btn.getAttribute('data-tkp') || 0);

      if (act === 'calc' && tid) {
        if (typeof window.openEstimateMethodPicker === 'function') {
          window.openEstimateMethodPicker(null, tid);
        } else if (typeof window.openMimirAutoEstimate === 'function') {
          window.openMimirAutoEstimate(null, tid);
        } else {
          toast('Просчёт', 'Модуль авто-просчёта не загружен', 'err');
        }
        return;
      }

      if (act === 'open' && tid) {
        location.hash = `#/tenders?id=${tid}`;
        return;
      }

      if (act === 'send-approval' && estId) {
        btn.disabled = true;
        try {
          await fetchJSON(`/api/approval/estimates/${estId}/send`, { method: 'POST' });
          toast('Согласование', 'Просчёт отправлен Рук. ТО на согласование', 'ok');
          await rerender();
        } catch (err) {
          toast('Согласование', err.message || 'Ошибка', 'err');
          btn.disabled = false;
        }
        return;
      }

      if (act === 'resubmit' && estId) {
        btn.disabled = true;
        try {
          await fetchJSON(`/api/approval/estimates/${estId}/resubmit`, { method: 'POST' });
          toast('Согласование', 'Просчёт переотправлен на согласование', 'ok');
          await rerender();
        } catch (err) {
          toast('Согласование', err.message || 'Ошибка', 'err');
          btn.disabled = false;
        }
        return;
      }

      if (act === 'create-tkp' && tid) {
        // Откроем карточку тендера — там кнопка «Создать ТКП» открывает существующую модалку
        location.hash = `#/tenders?id=${tid}`;
        return;
      }

      if (act === 'send-kp' && tkpId) {
        const ok = confirm('Отправить КП клиенту по email? (адрес возьмётся из карточки ТКП)');
        if (!ok) return;
        btn.disabled = true;
        try {
          await fetchJSON(`/api/tkp/${tkpId}/send`, { method: 'POST', body: JSON.stringify({}) });
          toast('Отправка', 'КП отправлено клиенту', 'ok');
          await rerender();
        } catch (err) {
          toast('Отправка', err.message || 'Ошибка', 'err');
          btn.disabled = false;
        }
        return;
      }
    });
  }

  async function render({ layout, title }) {
    const auth = (typeof AsgardAuth !== 'undefined') ? AsgardAuth.getAuth() : null;
    const user = auth?.user || {};
    if (!user.id) { layout('<div class="card">Требуется авторизация</div>', title); return; }

    await layout('<div id="toCalcsRoot"><div class="card"><div class="help">⏳ Загрузка…</div></div></div>', { title: title || 'Мои просчёты (ТО)' });
    const root = document.getElementById('toCalcsRoot');
    if (!root) { console.warn('[to-calcs] root not found'); return; }

    async function doRender() {
      try {
        const tenders = await loadTenders(user);
        if (!tenders.length) {
          root.innerHTML = `
            <div class="card">
              <h3 style="margin:0 0 8px">Мои просчёты</h3>
              <div class="help">Пока нет тендеров на ваш просчёт. Когда вы создадите тендер и выберете «Я сам (ТО)», а Рук. ТО одобрит — он появится здесь.</div>
            </div>`;
          return;
        }

        const ids = tenders.map(t => t.id);
        const [estMap, tkpMap] = await Promise.all([loadEstimates(ids), loadTkps(ids)]);

        const groups = { calc: [], tkp: [], send: [], other: [] };
        for (const t of tenders) groups[bucketOf(t)].push(t);

        const html = `
          <div class="card" style="margin-bottom:12px">
            <h2 style="margin:0 0 4px">📊 Мои просчёты (ТО)</h2>
            <div class="help">Тендеры, которые вы считаете сами. Согласует Рук. тендерного отдела (не директор). ${user.role === 'HEAD_TO' ? 'Вы видите ВСЕ ТО-просчёты команды.' : 'Вы видите только свои.'}</div>
          </div>
          ${bucketBlock('На просчёт / доработке', '🧮', groups.calc, estMap, tkpMap, user)}
          ${bucketBlock('Готовы к ТКП', '⚡', groups.tkp, estMap, tkpMap, user)}
          ${bucketBlock('Готово к отправке КП', '✉️', groups.send, estMap, tkpMap, user)}
          ${bucketBlock('Прочее', '📦', groups.other, estMap, tkpMap, user)}
        `;
        root.innerHTML = html;
      } catch (err) {
        root.innerHTML = `<div class="card"><div style="color:var(--err-t,#e74c3c)">Ошибка: ${esc(err.message)}</div></div>`;
      }
    }

    await doRender();
    await bindActions(root, user, doRender);
  }

  return { render };
})();
