/**
 * Вкладки склада: Сборки / Ведомость / Готовность (мониторинг РП).
 * window.WH2Asm
 */
window.WH2Asm = (function () {
  const UI = window.AsgardUI || {};
  const esc = UI.esc || ((s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const toast = UI.toast || ((t, m) => console.log(t, m));
  const STATUSES = {
    draft: 'Черновик', confirmed: 'Подтверждена', packing: 'Сборка', packed: 'Собрано',
    in_transit: 'В пути', received: 'Принято', returned: 'Возвращено', closed: 'Закрыта'
  };
  const LINE_ST = {
    reserved: 'резерв', awaiting_wh_approve: 'ждёт склад', awaiting_procurement: 'в закупке',
    on_shelf: 'на полке', stock_ready: 'на полке', in_transit: 'в пути',
    unpick_requested: 'убрать с паллета', packed: 'собрано'
  };
  const FLAG_LABELS = {
    reserved: 'резерв', assembled: 'собрано', in_transit: 'в пути',
    in_procurement: 'в закупке', paid: 'оплачено', on_shelf: 'на полке'
  };

  let _ctx = null; // { api, user, toast, esc }
  let _sheetId = null;
  let _monitorId = null;

  function api() { return _ctx.api; }
  function role() { return (_ctx.user && _ctx.user.role) || ''; }
  function isWh() { return ['WAREHOUSE', 'ADMIN'].includes(role()); }
  function isPm() { return ['PM', 'HEAD_PM', 'ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(role()); }

  function humanTitle(a) {
    if (!a) return 'Сборка';
    const raw = String(a.work_title || a.title || '').trim();
    const id = a.id != null ? a.id : '';
    const obj = String(a.destination || a.object_name || '').trim();
    if (/FULL-BIZ|E2E|Монтаж\s*тест|STORY\s*wave|WAVE\s*partial|\d{10,}/i.test(raw) || !raw) {
      return (id !== '' ? ('Сборка #' + id) : 'Сборка') + (obj ? (' · ' + obj) : '');
    }
    return raw + (obj ? (' · ' + obj) : '');
  }

  function dt(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('ru-RU'); } catch (_) { return String(d); }
  }

  function statusChip(s) {
    return `<span class="wh2-asm-status wh2-asm-status--${esc((s || '').replace(/_/g, '-'))}">${esc(STATUSES[s] || s || '—')}</span>`;
  }

  function flagChips(flags) {
    if (!flags) return '';
    return Object.keys(FLAG_LABELS).filter((k) => flags[k]).map((k) =>
      `<span class="wh2-asm-chip wh2-asm-chip--${k}">${FLAG_LABELS[k]}</span>`
    ).join('');
  }

  function kpiBar(kpi) {
    const pct = (kpi && kpi.ready_pct) != null ? kpi.ready_pct : 0;
    const kg = (kpi && kpi.packed_weight_kg) != null ? kpi.packed_weight_kg : 0;
    const n = (kpi && kpi.pallets_count) != null ? kpi.pallets_count : 0;
    return `<div class="wh2-asm-kpi">
      <div class="wh2-asm-kpi__pct"><b>${pct}%</b><span>готовность</span></div>
      <div class="wh2-asm-kpi__bar"><i style="width:${Math.min(100, pct)}%"></i></div>
      <div class="wh2-asm-kpi__meta"><span><b>${kg}</b> кг собрано</span><span><b>${n}</b> паллет</span></div>
    </div>`;
  }

  function emptyState(title, verb, ctaLabel, ctaHref) {
    return `<div class="wh2-asm-empty">
      <div class="wh2-asm-empty__title">${esc(title)}</div>
      <div class="wh2-asm-empty__verb">${esc(verb)}</div>
      ${ctaHref ? `<a class="btn primary wh2-asm-cta" href="${esc(ctaHref)}">${esc(ctaLabel || 'Открыть')}</a>` : ''}
    </div>`;
  }

  /** Очередь сборок для кладовщика */
  async function renderAssemblies(body) {
    body.innerHTML = `<div class="wh2-asm"><div class="wh2-asm-head">
      <div><div class="wh2-asm-kicker">Очередь склада</div><h3 class="wh2-asm-h">Сборки к комплектации</h3></div>
      <button type="button" class="btn" id="wh2-asm-ref">Обновить</button>
    </div><div id="wh2-asm-list" class="wh2-asm-list">Загрузка…</div></div>`;
    body.querySelector('#wh2-asm-ref').onclick = () => renderAssemblies(body);
    const box = body.querySelector('#wh2-asm-list');
    let d;
    try { d = await api()('/api/assembly?limit=60'); } catch (e) {
      box.innerHTML = emptyState('Не удалось загрузить', e.message || 'Ошибка сети', null);
      return;
    }
    const items = d.items || [];
    if (!items.length) {
      box.innerHTML = emptyState('Очередь пуста', 'Нет сборок к комплектации — ждите заявки РП или откройте приёмку.', 'К приёмке', '#/warehouse-v2?tab=incoming');
      return;
    }
    box.innerHTML = items.map((a) => {
      const pct = a.items_count > 0 ? Math.round((a.packed_count / a.items_count) * 100) : 0;
      const who = a.pm_name || a.creator_name || '—';
      return `<article class="wh2-asm-card" data-id="${a.id}">
        <div class="wh2-asm-card__top">
          <div>
            <div class="wh2-asm-card__title">${esc(humanTitle(a))}</div>
            <div class="wh2-asm-card__meta">Для: <b>${esc(who)}</b>
              ${a.planned_date ? ' · план ' + dt(a.planned_date) : ''}
              ${a.destination ? ' · → ' + esc(a.destination) : ''}
              · ${a.items_count || 0} поз.</div>
          </div>
          <div class="wh2-asm-card__right">${statusChip(a.status)}<div class="wh2-asm-card__pct">${pct}%</div></div>
        </div>
        <div class="wh2-asm-card__bar"><i style="width:${pct}%"></i></div>
        <button type="button" class="btn primary wh2-asm-cta" data-open="${a.id}">Открыть ведомость</button>
      </article>`;
    }).join('');
    box.querySelectorAll('[data-open]').forEach((b) => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        openSheet(+b.dataset.open, body);
      };
    });
    box.querySelectorAll('.wh2-asm-card[data-id]').forEach((c) => {
      c.onclick = () => openSheet(+c.dataset.id, body);
    });
  }

  async function openSheet(id, body) {
    _sheetId = id;
    if (body) {
      // switch visual tab via hash so refresh keeps context
      try {
        const u = new URL(location.href);
        // hash router: #/warehouse-v2?tab=sheet&id=
        location.hash = '#/warehouse-v2?tab=sheet&id=' + id;
      } catch (_) {}
    }
    const host = body || document.getElementById('wh2-body');
    if (!host) return;
    host.innerHTML = `<div class="wh2-asm"><div class="wh2-asm-loading">Загрузка ведомости #${id}…</div></div>`;
    let d, live;
    try {
      d = await api()('/api/assembly/' + id);
      live = await api()('/api/assembly/' + id + '/live');
    } catch (e) {
      host.innerHTML = emptyState('Ведомость недоступна', e.message || '', 'К списку', '#/warehouse-v2?tab=assemblies');
      return;
    }
    const a = d.item || {};
    const items = d.items || [];
    const pallets = d.pallets || live.pallets || [];
    const kpi = live.kpi || {
      ready_pct: live.ready_pct,
      packed_weight_kg: live.packed_weight_kg,
      pallets_count: live.pallets_count
    };
    const canSend = ['packed', 'packing'].includes(a.status) && isWh();
    const canConfirm = a.status === 'draft' && isPm();
    const canPack = isWh() && ['confirmed', 'packing'].includes(a.status);

    host.innerHTML = `<div class="wh2-asm wh2-asm--sheet">
      <div class="wh2-asm-head">
        <div>
          <button type="button" class="btn" id="wh2-asm-back">← К сборкам</button>
          <div class="wh2-asm-kicker" style="margin-top:10px">Ведомость</div>
          <h3 class="wh2-asm-h">${esc(humanTitle(a))}</h3>
          <div class="wh2-asm-card__meta">${statusChip(a.status)}
            ${a.planned_date ? ' · план ' + dt(a.planned_date) : ''}
            ${a.destination ? ' · ' + esc(a.destination) : ''}
          </div>
        </div>
        <div class="wh2-asm-actions">
          ${canConfirm ? '<button type="button" class="btn primary" id="wh2-asm-confirm">Подтвердить</button>' : ''}
          ${canPack ? '<button type="button" class="btn primary" id="wh2-asm-mk-pallet">＋ Паллет</button>' : ''}
          ${canPack ? '<button type="button" class="btn" id="wh2-asm-to-ops">Операции (пикинг)</button>' : ''}
          ${canSend ? '<button type="button" class="btn primary" id="wh2-asm-send">Отправить на объект</button>' : ''}
          <a class="btn" target="_blank" href="/api/assembly/${id}/pdf">PDF</a>
          <a class="btn" target="_blank" href="/api/assembly/${id}/labels">Бирки</a>
        </div>
      </div>
      ${kpiBar(kpi)}
      <div class="wh2-asm-sec-h">Позиции · ${items.length}</div>
      <div class="wh2-asm-table">${items.length ? items.map((it) => `
        <div class="wh2-asm-row" data-item-id="${it.id}">
          <div class="wh2-asm-row__name">${esc(it.name)}</div>
          <div class="wh2-asm-row__qty">${esc(String(it.quantity))} ${esc(it.unit || 'шт')}</div>
          <div class="wh2-asm-row__st">${it.packed ? '<span class="wh2-asm-chip wh2-asm-chip--assembled">собрано</span>' : '<span class="wh2-asm-chip">' + esc(LINE_ST[it.line_status] || it.line_status || '—') + '</span>'}</div>
          ${canPack && !it.packed ? `<button type="button" class="btn primary wh2-asm-pack" data-pack="${it.id}">Собрать на паллет</button>` : ''}
        </div>`).join('') : emptyState('Нет позиций', 'Добавьте из корзины или change-order.', null)}
      </div>
      <div class="wh2-asm-sec-h">Паллеты · ${pallets.length}</div>
      <div class="wh2-asm-pallets">${pallets.length ? pallets.map((p) => `
        <div class="wh2-asm-pallet">Паллет ${esc(String(p.pallet_number || p.id))} · ${esc(p.status || '—')} · ${p.items || 0} поз. · ${p.packed || 0} собрано</div>
      `).join('') : '<div class="wh2-asm-card__meta">Паллеты ещё не созданы — нажмите «＋ Паллет»</div>'}
      </div>
    </div>`;

    const back = host.querySelector('#wh2-asm-back');
    if (back) back.onclick = () => { location.hash = '#/warehouse-v2?tab=assemblies'; };
    const conf = host.querySelector('#wh2-asm-confirm');
    if (conf) conf.onclick = async () => {
      try {
        await api()('/api/assembly/' + id + '/confirm', { method: 'PUT', body: '{}' });
        toast('Сборка', 'Подтверждена', 'ok');
        openSheet(id, host);
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
    const toOps = host.querySelector('#wh2-asm-to-ops');
    if (toOps) toOps.onclick = () => { location.hash = '#/warehouse-v2?tab=ops'; };
    const mkPal = host.querySelector('#wh2-asm-mk-pallet');
    if (mkPal) mkPal.onclick = async () => {
      try {
        await api()('/api/assembly/' + id + '/pallets', { method: 'POST', body: JSON.stringify({ label: 'Паллет ОФС' }) });
        toast('Паллет', 'Создан', 'ok');
        openSheet(id, host);
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
    host.querySelectorAll('[data-pack]').forEach((btn) => {
      btn.onclick = async () => {
        const itemId = btn.getAttribute('data-pack');
        try {
          let palletId = (pallets[0] && pallets[0].id) || null;
          if (!palletId) {
            const pr = await api()('/api/assembly/' + id + '/pallets', { method: 'POST', body: JSON.stringify({ label: 'Паллет ОФС' }) });
            palletId = (pr.pallet && pr.pallet.id) || (pr.item && pr.item.id) || pr.id;
          }
          if (palletId) {
            await api()('/api/assembly/' + id + '/items/' + itemId + '/assign-pallet', {
              method: 'PUT', body: JSON.stringify({ pallet_id: palletId })
            });
          }
          await api()('/api/assembly/' + id + '/items/' + itemId + '/pack', { method: 'PUT', body: '{}' });
          toast('Сборка', 'Позиция на паллете', 'ok');
          openSheet(id, host);
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
    });
    const send = host.querySelector('#wh2-asm-send');
    if (send) send.onclick = async () => {
      try {
        await api()('/api/assembly/' + id + '/send', { method: 'PUT', body: '{}' });
        toast('Сборка', 'Отправлена', 'ok');
        openSheet(id, host);
      } catch (e) { toast('Ошибка', e.message, 'err'); }
    };
  }

  /** Мониторинг готовности для РП */
  async function renderMonitor(body) {
    if (_monitorId) return openMonitorDetail(_monitorId, body);
    body.innerHTML = `<div class="wh2-asm"><div class="wh2-asm-head">
      <div><div class="wh2-asm-kicker">Мониторинг РП</div><h3 class="wh2-asm-h">Готовность отгрузок</h3></div>
      <button type="button" class="btn" id="wh2-mon-ref">Обновить</button>
    </div><div id="wh2-mon-list" class="wh2-asm-list">Загрузка…</div></div>`;
    body.querySelector('#wh2-mon-ref').onclick = () => { _monitorId = null; renderMonitor(body); };
    const box = body.querySelector('#wh2-mon-list');
    let d;
    try { d = await api()('/api/assembly/monitor?mine=1&limit=40'); } catch (e) {
      box.innerHTML = emptyState('Нет данных', e.message || '', null);
      return;
    }
    const items = d.items || [];
    if (!items.length) {
      box.innerHTML = emptyState(
        'Пока нет отгрузок',
        'Наберите корзину на складе, укажите работу, объект и плановую дату — появится контроль готовности.',
        'На склад / маркет',
        '#/warehouse-v2?tab=consumables'
      );
      return;
    }
    box.innerHTML = items.map((a) => {
      const kpi = a.kpi || { ready_pct: a.ready_pct, packed_weight_kg: a.packed_weight_kg, pallets_count: a.pallets_count };
      return `<article class="wh2-asm-card" data-mid="${a.id}">
        <div class="wh2-asm-card__top">
          <div>
            <div class="wh2-asm-card__title">${esc(humanTitle(a))}</div>
            <div class="wh2-asm-card__meta">${a.planned_date ? 'План ' + dt(a.planned_date) : 'Дата не задана'}
              ${a.destination ? ' · ' + esc(a.destination) : ''} · ${statusChip(a.status)}</div>
          </div>
        </div>
        ${kpiBar(kpi)}
        <button type="button" class="btn primary wh2-asm-cta" data-mid="${a.id}">Открыть готовность</button>
      </article>`;
    }).join('');
    box.querySelectorAll('[data-mid]').forEach((el) => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        openMonitorDetail(+el.dataset.mid, body);
      };
    });
  }

  async function openMonitorDetail(id, body) {
    _monitorId = id;
    location.hash = '#/warehouse-v2?tab=monitor&id=' + id;
    const host = body || document.getElementById('wh2-body');
    host.innerHTML = `<div class="wh2-asm"><div class="wh2-asm-loading">Загрузка готовности…</div></div>`;
    let d;
    try { d = await api()('/api/assembly/monitor/' + id); } catch (e) {
      host.innerHTML = emptyState('Не найдена', e.message || '', 'К списку', '#/warehouse-v2?tab=monitor');
      return;
    }
    const a = d.item || {};
    const board = d.board || [];
    const kpi = d.kpi || {};

    host.innerHTML = `<div class="wh2-asm wh2-asm--monitor">
      <div class="wh2-asm-head">
        <div>
          <button type="button" class="btn" id="wh2-mon-back">← К списку</button>
          <div class="wh2-asm-kicker" style="margin-top:10px">Готовность</div>
          <h3 class="wh2-asm-h">${esc(humanTitle(a))}</h3>
          <div class="wh2-asm-card__meta">${a.planned_date ? 'План ' + dt(a.planned_date) : 'Дата не задана'}
            ${a.destination ? ' · ' + esc(a.destination) : ''}</div>
        </div>
      </div>
      ${kpiBar(kpi)}
      <div class="wh2-asm-sec-h">Позиции · ${board.length}</div>
      <div class="wh2-asm-table" id="wh2-mon-board">${board.length ? board.map((it) => rowMonitor(it, id)).join('') : emptyState('Нет позиций', 'Сборка пуста.', null)}</div>
    </div>`;

    const back = host.querySelector('#wh2-mon-back');
    if (back) back.onclick = () => { _monitorId = null; location.hash = '#/warehouse-v2?tab=monitor'; renderMonitor(host); };
    bindMonitorRows(host, id);
  }

  function rowMonitor(it, asmId) {
    const mode = it.edit_mode || 'delete';
    const qty = Number(it.qty) || 0;
    const acts = mode === 'locked'
      ? '<span class="wh2-asm-card__meta">без правок</span>'
      : `<div class="wh2-asm-qty">
          ${mode === 'stock' || mode === 'decrease' ? `<button type="button" class="btn" data-dec="${it.assembly_item_id}" data-qty="${qty}">−</button>` : ''}
          <input class="wh2-asm-qty__inp" data-qty-inp="${it.assembly_item_id}" value="${qty}" ${mode === 'decrease' ? 'data-max="' + qty + '"' : ''}/>
          ${mode === 'stock' ? `<button type="button" class="btn" data-inc="${it.assembly_item_id}" data-qty="${qty}">+</button>` : ''}
          ${mode === 'delete' || mode === 'decrease' || mode === 'stock' ? `<button type="button" class="btn" data-rm="${it.assembly_item_id}" title="Убрать с контроля">Удалить</button>` : ''}
          <button type="button" class="btn primary" data-save="${it.assembly_item_id}">Сохранить</button>
        </div>`;
    return `<div class="wh2-asm-row" data-item="${it.assembly_item_id}">
      <div class="wh2-asm-row__name">${esc(it.name)}<div class="wh2-asm-row__flags">${flagChips(it.flags)}</div></div>
      <div class="wh2-asm-row__acts">${acts}</div>
    </div>`;
  }

  function bindMonitorRows(host, asmId) {
    host.querySelectorAll('[data-dec]').forEach((b) => {
      b.onclick = () => {
        const inp = host.querySelector(`[data-qty-inp="${b.dataset.dec}"]`);
        if (!inp) return;
        const v = Math.max(0.001, (parseFloat(inp.value) || 0) - 1);
        inp.value = String(v);
      };
    });
    host.querySelectorAll('[data-inc]').forEach((b) => {
      b.onclick = () => {
        const inp = host.querySelector(`[data-qty-inp="${b.dataset.inc}"]`);
        if (!inp) return;
        inp.value = String((parseFloat(inp.value) || 0) + 1);
      };
    });
    host.querySelectorAll('[data-save]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.save;
        const inp = host.querySelector(`[data-qty-inp="${id}"]`);
        const qty = parseFloat(inp && inp.value);
        if (!(qty > 0)) { toast('Кол-во', 'Укажите число > 0', 'warn'); return; }
        try {
          await api()(`/api/assembly/${asmId}/items/${id}/monitor-qty`, {
            method: 'PATCH', body: JSON.stringify({ quantity: qty })
          });
          toast('Сохранено', 'Количество обновлено', 'ok');
          openMonitorDetail(asmId, host);
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
    });
    host.querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Снять позицию с контроля? Закупщику/складу уйдёт уведомление (в тестах — dry-run).')) return;
        try {
          const r = await api()(`/api/assembly/${asmId}/items/${b.dataset.rm}/monitor-remove`, {
            method: 'POST', body: JSON.stringify({ reason: 'РП снял с контроля' })
          });
          if (r && r.mail && r.mail.dry_run) {
            toast('Dry-run почта', 'Письмо не отправлено наружу — только preview', 'ok');
          } else {
            toast('Удалено', 'Позиция снята', 'ok');
          }
          openMonitorDetail(asmId, host);
        } catch (e) { toast('Ошибка', e.message, 'err'); }
      };
    });
  }

  function render(body, tab, ctx) {
    _ctx = ctx || _ctx;
    if (tab === 'assemblies') return renderAssemblies(body);
    if (tab === 'sheet') {
      const id = _sheetId || (ctx && ctx.id);
      if (id) return openSheet(id, body);
      return renderAssemblies(body);
    }
    if (tab === 'monitor') {
      if (ctx && ctx.id) _monitorId = ctx.id;
      return renderMonitor(body);
    }
  }

  function setSheetId(id) { _sheetId = id; }
  function setMonitorId(id) { _monitorId = id; }

  return { render, openSheet, openMonitorDetail, setSheetId, setMonitorId, isWh, isPm };
})();
