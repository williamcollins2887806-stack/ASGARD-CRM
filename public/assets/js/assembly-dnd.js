/**
 * ASGARD CRM — Visual Pallet Builder (WOW EDITION + CAPACITY + DEMOB)
 *
 * Wooden pallets. Items stack on them. Stretch film wraps.
 * FLIP animations. Ripple on drop. Landing bounce.
 * Touch support. Web Audio thud on drop.
 * Capacity limits with shake on overfill.
 * Demob return_status with popup selector.
 */
window.AsgardAssemblyDnD = (function () {
  'use strict';

  const esc = (window.AsgardUI?.esc) || (s => String(s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
  const toast = window.AsgardUI?.toast || (() => {});

  let _ct, _asmId, _items, _pallets, _canEdit, _onUpdate;
  let _ghost = null, _dragId = null;
  let _audioCtx = null;
  let _isDemob = false;
  let _openMenu = null;

  const S = {
    reservation:           { l: 'Со склада',       c: 'var(--blue)' },
    procurement_warehouse: { l: 'Закупка→склад',   c: 'var(--ok)' },
    procurement_object:    { l: 'Закупка→объект',   c: 'var(--gold)' },
    manual:                { l: 'Вручную',          c: 'var(--t3)' },
    on_site_purchase:      { l: 'Купл. на объекте', c: 'var(--warn)' },
  };

  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' };
  }
  async function apiPut(u, b) { return (await fetch(u, { method: 'PUT', headers: hdr(), body: JSON.stringify(b || {}) })).json(); }
  async function apiPost(u, b) { return (await fetch(u, { method: 'POST', headers: hdr(), body: JSON.stringify(b || {}) })).json(); }

  // ── Web Audio: wooden thud ──
  function playThud() {
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = _audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(80, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
      const click = ctx.createOscillator();
      const clickGain = ctx.createGain();
      click.type = 'square';
      click.frequency.setValueAtTime(200, ctx.currentTime);
      click.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.05);
      clickGain.gain.setValueAtTime(0.15, ctx.currentTime);
      clickGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      click.connect(clickGain); clickGain.connect(ctx.destination);
      click.start(ctx.currentTime); click.stop(ctx.currentTime + 0.08);
    } catch (e) { /* audio not supported */ }
  }

  // ── FLIP engine ──
  function flipCapture() {
    const m = new Map();
    if (_ct) _ct.querySelectorAll('[data-iid]').forEach(el => m.set(el.dataset.iid, el.getBoundingClientRect()));
    return m;
  }
  function flipPlay(prev) {
    if (!_ct) return;
    requestAnimationFrame(() => {
      _ct.querySelectorAll('[data-iid]').forEach(el => {
        const old = prev.get(el.dataset.iid);
        if (!old) return;
        const cur = el.getBoundingClientRect();
        const dx = old.left - cur.left, dy = old.top - cur.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.style.transform = `translate(${dx}px,${dy}px)`;
        el.style.transition = 'none';
        requestAnimationFrame(() => {
          el.classList.add('vpb__flip');
          el.style.transform = ''; el.style.transition = '';
          el.addEventListener('transitionend', function h() { el.classList.remove('vpb__flip'); el.removeEventListener('transitionend', h); });
        });
      });
    });
  }

  // ── Capacity check ──
  function isOverCapacity(pid) {
    const pallet = _pallets.find(p => p.id === pid);
    if (!pallet?.capacity_items) return false;
    const currentCount = _items.filter(i => i.pallet_id === pid).length;
    return currentCount >= pallet.capacity_items;
  }

  function shakeAndWarn(pid) {
    const pallet = _pallets.find(p => p.id === pid);
    const palletEl = _ct.querySelector(`[data-pid="${pid}"]`);
    if (palletEl) {
      palletEl.classList.remove('is-overfill');
      void palletEl.offsetWidth;
      palletEl.classList.add('is-overfill');
    }
    toast('Паллет полный', `Максимум ${pallet?.capacity_items || '?'} позиций`, 'warn');
  }

  // ══════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════

  function render(animate) {
    if (!_ct) return;
    const prev = animate ? flipCapture() : new Map();
    const free = _items.filter(i => !i.pallet_id && !i.packed);
    const ofPallet = pid => _items.filter(i => i.pallet_id === pid);

    let h = '';

    // Legend
    h += `<div class="vpb__legend">${Object.entries(S).map(([k, v]) =>
      `<span class="vpb__legend-item"><span class="vpb__legend-dot" style="background:${v.c}"></span>${v.l}</span>`
    ).join('')}</div>`;

    // Demob legend
    if (_isDemob) {
      h += `<div class="vpb__demob-legend">
        <span style="font-weight:600;color:var(--t2)">Статус возврата:</span>
        <span class="vpb__demob-legend-item"><span class="vpb__ret-dot" style="background:var(--ok)"></span>Возвращается</span>
        <span class="vpb__demob-legend-item"><span class="vpb__ret-dot" style="background:var(--err)"></span>Сломано</span>
        <span class="vpb__demob-legend-item"><span class="vpb__ret-dot" style="background:var(--t3)"></span>Утеряно</span>
        <span class="vpb__demob-legend-item"><span class="vpb__ret-dot" style="background:var(--warn)"></span>Израсходовано</span>
      </div>`;
    }

    h += '<div class="vpb">';

    // ── Pool ──
    h += `<div class="vpb__pool" id="vpb-pool">
      <div class="vpb__pool-head">
        <span class="vpb__pool-title">Неразмещённые</span>
        <span class="vpb__pool-badge" id="vpb-pool-n">${free.length}</span>
      </div>`;
    if (!free.length) {
      h += `<div class="vpb__pool-empty">
        <svg viewBox="0 0 56 56" fill="none"><rect x="8" y="18" width="40" height="30" rx="3" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/>
        <path d="M22 38l6-6 6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="28" cy="44" r="1.5" fill="currentColor"/></svg>
        <span>Всё на паллетах ✓</span>
      </div>`;
    } else {
      free.forEach((it, i) => { h += cardHTML(it, i); });
    }
    h += '</div>';

    // ── Pallets ──
    h += '<div class="vpb__pallets">';
    _pallets.forEach((p, pi) => {
      const pIt = ofPallet(p.id);
      const packed = ['packed', 'shipped', 'received'].includes(p.status);

      // Capacity-aware fill calculation
      const capItems = p.capacity_items;
      let fillPct = 0, capState = '';
      if (capItems) {
        fillPct = Math.round(pIt.length / capItems * 100);
        if (fillPct >= 100) capState = pIt.length > capItems ? 'overfill' : 'full';
        else if (fillPct >= 80) capState = 'warning';
      } else {
        fillPct = Math.min(95, Math.round(pIt.length / 8 * 100));
      }

      h += `<div class="vpb__pallet ${packed ? 'is-packed' : ''} ${capState ? 'is-' + capState : ''}" data-pid="${p.id}" style="animation-delay:${pi * 0.1}s">
        <div class="vpb__pallet-base"></div>`;

      // Fill indicator
      h += `<div class="vpb__fill"><div class="vpb__fill-bar" style="height:${Math.min(fillPct, 100)}%"></div></div>`;

      // Capacity info
      if (capItems || p.capacity_kg) {
        const label = capItems
          ? `${pIt.length}/${capItems} поз.${capState === 'full' ? ' — ПОЛНЫЙ' : capState === 'overfill' ? ' — ПЕРЕГРУЗ!' : capState === 'warning' ? ' — почти полный' : ''}`
          : `${p.capacity_kg} кг макс.`;
        const cls = capState === 'overfill' || capState === 'full' ? 'vpb__cap-full'
          : capState === 'warning' ? 'vpb__cap-warn' : '';
        h += `<div class="vpb__cap ${cls}">${label}</div>`;
      }

      // Header
      h += `<div class="vpb__pallet-head">
        <div>
          <div class="vpb__pallet-num">№${p.pallet_number}</div>
          ${p.label ? `<div class="vpb__pallet-lbl">${esc(p.label)}</div>` : ''}
        </div>
        <div class="vpb__pallet-tools">
          <button onclick="window.open('/api/assembly/${_asmId}/pallets/${p.id}/label-pdf','_blank')" title="Печать">🖨️</button>
          ${_canEdit && !packed ? `<button class="vpb-pack" data-pid="${p.id}" title="Обмотать стретчем и упаковать">🎞️</button>` : ''}
          <img class="vpb__pallet-qr" src="/api/assembly/${_asmId}/pallets/${p.id}/qr" alt="QR"
               onclick="window.open(this.src,'_blank')" title="QR">
        </div>
      </div>`;

      // Stacked items
      h += `<div class="vpb__pallet-items" data-pid="${p.id}">`;
      pIt.forEach((it, ii) => { h += stackedHTML(it, _canEdit && !packed, ii); });
      h += '</div>';

      // Film + stamp
      if (packed) {
        h += `<div class="vpb__film"></div>`;
        h += `<div class="vpb__stamp">📦 УПАКОВАНО</div>`;
      }

      // Footer
      h += `<div class="vpb__pallet-foot">
        <span class="vpb__pallet-foot-count" data-pcnt="${p.id}">${pIt.length} поз.</span>
        <span>${packed ? '✅ отправляется' : pIt.length ? '⏳ готов' : ''}</span>
      </div>`;
      h += '</div>';
    });

    // Add pallet
    if (_canEdit) {
      h += `<div class="vpb__add" id="vpb-add" style="animation-delay:${_pallets.length * 0.1}s">
        <span class="vpb__add-icon">+</span>
        <span>Новое паллетоместо</span>
      </div>`;
    }

    h += '</div></div>';
    _ct.innerHTML = h;
    _ct.querySelectorAll('.vpb__card').forEach((el, i) => { el.style.animationDelay = `${i * 0.04}s`; });
    bindAll();
    if (animate && prev.size) flipPlay(prev);
  }

  function cardHTML(it, idx) {
    const s = S[it.source] || S.manual;
    const ret = it.return_status || (_isDemob ? 'returning' : '');
    return `<div class="vpb__card ${it.packed ? 'is-packed' : ''}" draggable="${_canEdit && !it.packed ? 'true' : 'false'}"
      data-iid="${it.id}" data-src="${it.source || 'manual'}" data-ret="${ret}">
      <span class="vpb__card-grip">⠿</span>
      <div class="vpb__card-body">
        <div class="vpb__card-name">${esc(it.name)}</div>
        <div class="vpb__card-meta"><span class="vpb__card-dot" style="background:${s.c}"></span>${s.l}${it.article ? ' · ' + esc(it.article) : ''}</div>
      </div>
      <span class="vpb__card-qty">${it.quantity} ${esc(it.unit || 'шт')}</span>
    </div>`;
  }

  function stackedHTML(it, canRm, idx) {
    const s = S[it.source] || S.manual;
    const ml = (idx % 3) * 2;
    const ret = it.return_status || (_isDemob ? 'returning' : '');
    const retLabels = { returning: 'Возврат', damaged: 'Сломано', lost: 'Утеряно', consumed: 'Израсх.' };

    return `<div class="vpb__stacked" data-iid="${it.id}" data-ret="${ret}" style="margin-left:${ml}px"
      ${canRm ? 'title="✕ убрать · клик по статусу — сменить"' : ''}>
      <span class="vpb__stacked-color" style="background:${s.c}"></span>
      <span class="vpb__stacked-name">${esc(it.name)}</span>
      <span class="vpb__stacked-qty">${it.quantity} ${esc(it.unit || 'шт')}</span>
      ${_isDemob && ret ? `<span class="vpb__ret-badge" data-ret="${ret}" data-iid="${it.id}">${retLabels[ret] || ret}</span>` : ''}
      ${canRm ? '<span class="vpb__stacked-x">✕</span>' : ''}
    </div>`;
  }

  // ══════════════════════════════════════════════
  //  DRAG & DROP
  // ══════════════════════════════════════════════

  function bindAll() {
    if (!_canEdit) return;

    // Cards: drag
    _ct.querySelectorAll('.vpb__card[draggable="true"]').forEach(el => {
      el.addEventListener('dragstart', onDragStart);
      el.addEventListener('dragend', onDragEnd);
      el.addEventListener('pointerdown', onPtrDown);
    });

    // Pallet drop zones
    _ct.querySelectorAll('.vpb__pallet:not(.is-packed)').forEach(p => {
      p.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      p.addEventListener('dragenter', e => { e.preventDefault(); p.classList.add('is-over'); });
      p.addEventListener('dragleave', e => {
        const r = p.getBoundingClientRect();
        if (e.clientX <= r.left || e.clientX >= r.right || e.clientY <= r.top || e.clientY >= r.bottom) p.classList.remove('is-over');
      });
      p.addEventListener('drop', onDrop);
    });

    // Pool drop
    const pool = _ct.querySelector('#vpb-pool');
    if (pool) {
      pool.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      pool.addEventListener('dragenter', e => { e.preventDefault(); pool.classList.add('is-over'); });
      pool.addEventListener('dragleave', e => {
        const r = pool.getBoundingClientRect();
        if (e.clientX <= r.left || e.clientX >= r.right || e.clientY <= r.top || e.clientY >= r.bottom) pool.classList.remove('is-over');
      });
      pool.addEventListener('drop', onDropPool);
    }

    // Remove from pallet
    _ct.querySelectorAll('.vpb__stacked').forEach(el => {
      el.addEventListener('dblclick', () => unassign(+el.dataset.iid));
      const x = el.querySelector('.vpb__stacked-x');
      if (x) x.addEventListener('click', e => { e.stopPropagation(); unassign(+el.dataset.iid); });
    });

    // Return status selector (demob only)
    if (_isDemob) {
      _ct.querySelectorAll('.vpb__ret-badge[data-iid]').forEach(badge => {
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          openReturnMenu(badge, +badge.dataset.iid);
        });
      });
    }

    // Pack
    _ct.querySelectorAll('.vpb-pack').forEach(b => {
      b.addEventListener('click', async () => {
        const pid = +b.dataset.pid;
        const pIt = _items.filter(i => i.pallet_id === pid);
        if (!pIt.length) { toast('Пусто', 'Положите что-нибудь на паллет', 'warn'); return; }
        const p = _pallets.find(x => x.id === pid);
        if (!confirm(`Обмотать стретчем и упаковать паллет №${p?.pallet_number || pid}? (${pIt.length} поз.)\nЭто действие необратимо.`)) return;
        await apiPut(`/api/assembly/${_asmId}/pallets/${pid}/pack`, {});
        if (p) p.status = 'packed';
        render(false);
        playThud();
        if (_onUpdate) _onUpdate();
      });
    });

    // Add pallet (with capacity prompt)
    const addBtn = _ct.querySelector('#vpb-add');
    if (addBtn) addBtn.addEventListener('click', async () => {
      const label = prompt('Метка паллетоместа (необязательно):');
      let capacity = null;
      const capStr = prompt('Макс. количество позиций (Enter = без лимита):');
      if (capStr && capStr.trim()) {
        const n = parseInt(capStr);
        if (!isNaN(n) && n > 0) capacity = n;
      }
      const r = await apiPost(`/api/assembly/${_asmId}/pallets`, { label: label || null, capacity_items: capacity });
      if (r.pallet) { _pallets.push(r.pallet); render(false); }
    });
  }

  function onDragStart(e) {
    const id = +e.target.dataset.iid;
    _dragId = id;
    e.target.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(id));
    const it = _items.find(i => i.id === id);
    if (it) {
      const s = S[it.source] || S.manual;
      _ghost = document.createElement('div');
      _ghost.className = 'vpb__ghost';
      _ghost.innerHTML = `<span class="vpb__ghost-dot" style="background:${s.c}"></span>${esc(it.name)}<span class="vpb__ghost-qty">${it.quantity} ${esc(it.unit || 'шт')}</span>`;
      document.body.appendChild(_ghost);
      _ghost.style.left = '-9999px';
      e.dataTransfer.setDragImage(_ghost, 16, 16);
    }
  }

  function onDragEnd(e) {
    e.target.classList.remove('is-dragging');
    _dragId = null;
    if (_ghost) { _ghost.remove(); _ghost = null; }
    _ct.querySelectorAll('.is-over').forEach(x => x.classList.remove('is-over'));
  }

  async function onDrop(e) {
    e.preventDefault();
    const pEl = e.currentTarget.closest('.vpb__pallet');
    if (!pEl) return;
    const pid = +pEl.dataset.pid;
    const iid = +e.dataTransfer.getData('text/plain');
    if (!iid || !pid) return;
    pEl.classList.remove('is-over');
    const it = _items.find(i => i.id === iid);
    if (!it || it.pallet_id === pid) return;

    // Capacity check
    if (isOverCapacity(pid)) { shakeAndWarn(pid); return; }

    // Ripple
    const rect = pEl.getBoundingClientRect();
    const rip = document.createElement('div');
    rip.className = 'vpb__ripple';
    rip.style.left = (e.clientX - rect.left) + 'px';
    rip.style.top = (e.clientY - rect.top) + 'px';
    pEl.appendChild(rip);
    rip.addEventListener('animationend', () => rip.remove());

    // FLIP + optimistic
    const prev = flipCapture();
    it.pallet_id = pid;
    render(false);
    flipPlay(prev);
    playThud();

    setTimeout(() => {
      const el = _ct.querySelector(`.vpb__stacked[data-iid="${iid}"]`);
      if (el) el.classList.add('just-landed');
    }, 20);

    popCount(pid); popPoolCount();
    const r = await apiPut(`/api/assembly/${_asmId}/items/${iid}/assign-pallet`, { pallet_id: pid });
    if (r.error) { it.pallet_id = null; render(false); toast('Ошибка', r.error, 'err'); }
    if (_onUpdate) _onUpdate();
  }

  async function onDropPool(e) {
    e.preventDefault();
    const iid = +e.dataTransfer.getData('text/plain');
    e.currentTarget.classList.remove('is-over');
    if (!iid) return;
    const it = _items.find(i => i.id === iid);
    if (!it?.pallet_id) return;
    await unassign(iid);
  }

  async function unassign(iid) {
    const it = _items.find(i => i.id === iid);
    if (!it?.pallet_id || !_canEdit) return;
    const prev = flipCapture();
    it.pallet_id = null;
    render(false); flipPlay(prev); popPoolCount();
    await apiPut(`/api/assembly/${_asmId}/items/${iid}/unassign-pallet`, {});
    if (_onUpdate) _onUpdate();
  }

  function popCount(pid) {
    const el = _ct.querySelector(`[data-pcnt="${pid}"]`);
    if (el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  }
  function popPoolCount() {
    const el = _ct.querySelector('#vpb-pool-n');
    if (el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  }

  // ══════════════════════════════════════════════
  //  RETURN STATUS (DEMOB)
  // ══════════════════════════════════════════════

  function closeReturnMenu() {
    if (_openMenu) { _openMenu.remove(); _openMenu = null; }
    document.removeEventListener('click', closeReturnMenu);
  }

  function openReturnMenu(anchor, itemId) {
    closeReturnMenu();
    const item = _items.find(i => i.id === itemId);
    if (!item) return;
    const menu = document.createElement('div');
    menu.className = 'vpb__ret-menu';
    const options = [
      { val: 'returning', label: '✅ Возвращается', color: 'var(--ok)' },
      { val: 'damaged',   label: '🔧 Сломано',      color: 'var(--err)' },
      { val: 'lost',      label: '❓ Утеряно',       color: 'var(--t3)' },
      { val: 'consumed',  label: '🔥 Израсходовано', color: 'var(--warn)' },
    ];
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = `vpb__ret-opt ${(item.return_status || 'returning') === opt.val ? 'is-active' : ''}`;
      btn.innerHTML = `<span class="vpb__ret-dot" style="background:${opt.color}"></span>${opt.label}`;
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        let reason = null;
        if (opt.val === 'damaged' || opt.val === 'lost') {
          reason = prompt(`Причина (${opt.label}):`);
          if (reason === null) return;
          if (!reason.trim()) { toast('Ошибка', 'Причина обязательна', 'err'); return; }
        }
        item.return_status = opt.val;
        item.return_reason = reason;
        closeReturnMenu();
        render(false);
        await apiPut(`/api/assembly/${_asmId}/items/${itemId}/return-status`, {
          return_status: opt.val, return_reason: reason
        });
        if (_onUpdate) _onUpdate();
      });
      menu.appendChild(btn);
    });
    anchor.style.position = 'relative';
    anchor.parentElement.style.position = 'relative';
    anchor.parentElement.appendChild(menu);
    _openMenu = menu;
    setTimeout(() => document.addEventListener('click', closeReturnMenu), 10);
  }

  // ══════════════════════════════════════════════
  //  TOUCH / POINTER
  // ══════════════════════════════════════════════

  let _ptr = null, _ptrGhost = null, _ptrOn = false;

  function onPtrDown(e) {
    if (e.pointerType === 'mouse') return;
    const el = e.currentTarget;
    const id = +el.dataset.iid;
    const it = _items.find(i => i.id === id);
    if (!it) return;
    _ptr = { el, id, sx: e.clientX, sy: e.clientY };
    _ptrOn = false;

    const onMove = ev => {
      if (!_ptrOn && Math.abs(ev.clientX - _ptr.sx) + Math.abs(ev.clientY - _ptr.sy) > 10) {
        _ptrOn = true;
        el.classList.add('is-dragging');
        const s = S[it.source] || S.manual;
        _ptrGhost = document.createElement('div');
        _ptrGhost.className = 'vpb__ghost';
        _ptrGhost.innerHTML = `<span class="vpb__ghost-dot" style="background:${s.c}"></span>${esc(it.name)}`;
        document.body.appendChild(_ptrGhost);
      }
      if (_ptrOn && _ptrGhost) {
        _ptrGhost.style.left = (ev.clientX + 14) + 'px';
        _ptrGhost.style.top = (ev.clientY - 14) + 'px';
        _ct.querySelectorAll('.vpb__pallet:not(.is-packed)').forEach(p => {
          const r = p.getBoundingClientRect();
          p.classList.toggle('is-over', ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom);
        });
      }
    };

    const onUp = async ev => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      el.classList.remove('is-dragging');
      if (_ptrGhost) { _ptrGhost.remove(); _ptrGhost = null; }
      if (!_ptrOn) { _ptr = null; return; }

      const tgt = [..._ct.querySelectorAll('.vpb__pallet.is-over')][0];
      _ct.querySelectorAll('.is-over').forEach(x => x.classList.remove('is-over'));

      if (tgt) {
        const pid = +tgt.dataset.pid;
        if (it.pallet_id !== pid) {
          // Capacity check
          if (isOverCapacity(pid)) { shakeAndWarn(pid); _ptr = null; _ptrOn = false; return; }

          const rect = tgt.getBoundingClientRect();
          const rip = document.createElement('div');
          rip.className = 'vpb__ripple';
          rip.style.left = (ev.clientX - rect.left) + 'px';
          rip.style.top = (ev.clientY - rect.top) + 'px';
          tgt.appendChild(rip);
          rip.addEventListener('animationend', () => rip.remove());

          const prev = flipCapture();
          it.pallet_id = pid;
          render(false); flipPlay(prev); playThud();
          popCount(pid); popPoolCount();
          await apiPut(`/api/assembly/${_asmId}/items/${id}/assign-pallet`, { pallet_id: pid });
          if (_onUpdate) _onUpdate();
        }
      } else {
        const pool = _ct.querySelector('#vpb-pool');
        if (pool && it.pallet_id) {
          const r = pool.getBoundingClientRect();
          if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
            await unassign(id);
          }
        }
      }
      _ptr = null; _ptrOn = false;
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // ══════════════════════════════════════════════
  //  PUBLIC
  // ══════════════════════════════════════════════

  function init(container, opts) {
    _ct = container; _asmId = opts.assemblyId;
    _items = opts.items || []; _pallets = opts.pallets || [];
    _canEdit = opts.canEdit !== false; _onUpdate = opts.onUpdate || null;
    _isDemob = opts.isDemob || _items.some(i => i.return_status != null);
    render(true);
  }

  function updateData(items, pallets) {
    _items = items || _items; _pallets = pallets || _pallets; render(true);
  }

  function destroy() {
    closeReturnMenu();
    if (_ct) _ct.innerHTML = '';
    if (_ghost) { _ghost.remove(); _ghost = null; }
    _ct = null; _items = []; _pallets = [];
  }

  return { init, updateData, destroy };
})();
