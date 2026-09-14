/**
 * Brigade cart — корзина бригады в Дружине (vanilla).
 * Persist: localStorage asgard-brigade-cart:{userId}
 */
(function () {
  'use strict';

  const LS_PREFIX = 'asgard-brigade-cart:';
  const COMMENT_CHIPS = ['дисциплина', 'качество', 'ответственность', 'повторил бы', 'не брать', 'обучаемый'];
  const SCORE_HINTS = {
    1: 'критично', 2: 'очень слабо', 3: 'слабо', 4: 'ниже среднего', 5: 'средне',
    6: 'норма', 7: 'хорошо', 8: 'сильно', 9: 'отлично', 10: 'эталон'
  };
  const ASSIGN_ROLES = ['PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];
  const RATE_ROLES = ['PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'ADMIN'];

  let _userId = null;
  let _userRole = null;
  let _ids = [];
  let _cache = {};
  let _mounted = false;
  let _docClickBound = false;

  function toast(t, m, k) {
    if (window.AsgardUI?.toast) AsgardUI.toast(t, m, k || 'ok');
    else if (window.toast) window.toast(t, m, k);
  }

  function token() {
    try {
      return AsgardAuth.getAuth?.()?.token || localStorage.getItem('asgard_token') || '';
    } catch (_) { return ''; }
  }

  function authHeaders(json) {
    const h = { Authorization: 'Bearer ' + token() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function initials(fio) {
    const p = String(fio || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
    return (p[0][0] + p[1][0]).toUpperCase();
  }

  /** Читаемое название работы (битая кодировка / пустые поля). */
  function isGarbled(s) {
    const raw = String(s || '').trim();
    if (!raw) return true;
    if (/^[?\uFFFD\s.\-·]+$/.test(raw)) return true;
    const letters = raw.replace(/[^\u0400-\u04FFa-zA-Z0-9]/g, '');
    if (letters.length < 2 && /[?]{2,}/.test(raw)) return true;
    // mojibake heuristics: mostly replacement/question marks
    const q = (raw.match(/[?]/g) || []).length;
    if (q >= 4 && q / raw.length > 0.4) return true;
    return false;
  }

  function workLabel(w) {
    if (!w) return '—';
    const id = w.id || '—';
    const candidates = [
      w.work_title, w.title, w.object_name, w.customer_name, w.customer,
      w.work_number ? ('№' + w.work_number) : ''
    ];
    for (const c of candidates) {
      if (!isGarbled(c)) return String(c).trim();
    }
    const num = w.work_number && !isGarbled(w.work_number) ? String(w.work_number) : '';
    return num ? ('Работа №' + num + ' · #' + id) : ('Работа #' + id);
  }

  function statusLabelWork(w) {
    const st = w && (w.work_status || w.status);
    if (!st || isGarbled(st)) return '';
    return String(st).trim();
  }

  function statusLabel(e) {
    const s = e.effective_status || e.readiness_status || '';
    const map = {
      on_site: 'На объекте', approved: 'Согласован', ready: 'Готов',
      not_ready: 'Не готов', unknown: 'Без статуса', archive: 'Архив', planned: 'План'
    };
    return map[s] || s || '—';
  }

  function todayYmd() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function addDaysYmd(ymd, n) {
    const d = new Date(ymd + 'T12:00:00');
    d.setDate(d.getDate() + n);
    const p = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function fmtRu(d) {
    const s = String(d || '').slice(0, 10);
    if (s.length < 10) return '';
    return s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4);
  }

  function loadIds() {
    if (!_userId) return [];
    try {
      const raw = localStorage.getItem(LS_PREFIX + _userId);
      const arr = JSON.parse(raw || '[]');
      return Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
    } catch (_) { return []; }
  }

  function saveIds() {
    if (!_userId) return;
    try { localStorage.setItem(LS_PREFIX + _userId, JSON.stringify(_ids)); } catch (_) {}
  }

  function has(id) { return _ids.includes(Number(id)); }

  function add(id, snap) {
    id = Number(id);
    if (!Number.isFinite(id) || has(id)) return false;
    _ids.push(id);
    if (snap) _cache[id] = snap;
    saveIds();
    renderChrome();
    return true;
  }

  function remove(id) {
    id = Number(id);
    _ids = _ids.filter((x) => x !== id);
    saveIds();
    renderChrome();
    updateRowButtons();
  }

  function clear(confirmMsg) {
    if (!_ids.length) return;
    const msg = confirmMsg || ('Убрать ' + _ids.length + ' человек из корзины?');
    if (!window.confirm(msg)) return;
    _ids = [];
    saveIds();
    renderChrome();
    updateRowButtons();
    closeDrawer();
  }

  function mergeCache(employees) {
    (employees || []).forEach((e) => {
      if (e && e.id != null) _cache[e.id] = e;
    });
  }

  function people() {
    return _ids.map((id) => _cache[id] || { id, fio: '#' + id });
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  // ── DOM chrome ─────────────────────────────────────────────────────────────

  function bindBarButtons() {
    const openBtn = document.getElementById('bc_bar_open');
    const clearBtn = document.getElementById('bc_bar_clear');
    if (openBtn) {
      openBtn.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openDrawer();
      };
    }
    if (clearBtn) {
      clearBtn.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        clear();
      };
    }
  }

  function ensureDocClick() {
    if (_docClickBound) return;
    _docClickBound = true;
    document.addEventListener('click', function (ev) {
      const openHit = ev.target && ev.target.closest && ev.target.closest('#bc_bar_open');
      const clearHit = ev.target && ev.target.closest && ev.target.closest('#bc_bar_clear');
      if (!openHit && !clearHit) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (openHit) openDrawer();
      else clear();
    }, true);
  }

  function ensureDom() {
    let root = document.getElementById('bc_root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'bc_root';
      root.innerHTML = `
        <div id="bc_bar" class="bc-bar" hidden>
          <div class="bc-bar__left">
            <div class="bc-bar__title">Бригада · <span id="bc_bar_n">0</span></div>
            <div class="bc-bar__chips" id="bc_bar_chips"></div>
          </div>
          <div class="bc-bar__actions">
            <button type="button" class="btn ghost" id="bc_bar_clear">Очистить</button>
            <button type="button" class="btn bc-bar__open" id="bc_bar_open">Открыть корзину</button>
          </div>
        </div>
        <div id="bc_overlay" class="bc-overlay" hidden></div>
        <aside id="bc_drawer" class="bc-drawer" hidden aria-hidden="true">
          <div class="bc-drawer__topline" aria-hidden="true"></div>
          <div class="bc-drawer__head">
            <div>
              <div class="bc-drawer__title">Корзина бригады</div>
              <div class="bc-drawer__sub"><b id="bc_drawer_n">0</b> человек</div>
            </div>
            <button type="button" class="bc-drawer__close" id="bc_drawer_close" aria-label="Закрыть">✕</button>
          </div>
          <div class="bc-drawer__body" id="bc_drawer_body"></div>
          <div class="bc-drawer__foot" id="bc_drawer_foot"></div>
        </aside>
        <div id="bc_modal" class="bc-modal" hidden></div>
      `;
      document.body.appendChild(root);

      document.getElementById('bc_drawer_close')?.addEventListener('click', closeDrawer);
      document.getElementById('bc_overlay')?.addEventListener('click', closeDrawer);
      document.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape') return;
        if (!document.getElementById('bc_modal')?.hidden) closeModal();
        else closeDrawer();
      });
    }
    bindBarButtons();
    ensureDocClick();
  }

  function renderChrome() {
    ensureDom();
    const n = _ids.length;
    const bar = document.getElementById('bc_bar');
    const badge = document.getElementById('prs_bc_badge');
    if (document.getElementById('bc_bar_n')) document.getElementById('bc_bar_n').textContent = String(n);
    if (document.getElementById('bc_drawer_n')) document.getElementById('bc_drawer_n').textContent = String(n);
    if (badge) {
      badge.textContent = String(n);
      badge.hidden = n === 0;
      badge.classList.toggle('bc-badge--on', n > 0);
    }
    if (bar) {
      if (n === 0) {
        bar.hidden = true;
      } else {
        bar.hidden = false;
        const chips = document.getElementById('bc_bar_chips');
        if (chips) {
          const show = people().slice(0, 12);
          chips.innerHTML = show.map((p) => {
            const warn = p.on_site_info ? ' bc-chip--warn' : '';
            return `<span class="bc-chip${warn}" title="${esc(p.fio || '')}" data-id="${p.id}">
              <span class="bc-chip__av">${esc(initials(p.fio))}</span>
              <button type="button" class="bc-chip__x" data-rm="${p.id}" aria-label="Убрать">×</button>
            </span>`;
          }).join('') + (n > 12 ? `<span class="bc-chip bc-chip--more">+${n - 12}</span>` : '');
          chips.querySelectorAll('[data-rm]').forEach((btn) => {
            btn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              remove(btn.dataset.rm);
              if (!document.getElementById('bc_drawer')?.hidden) renderDrawerBody();
            });
          });
        }
      }
    }
    bindBarButtons();
    updateRowButtons();
    if (!document.getElementById('bc_drawer')?.hidden) renderDrawerBody();
  }

  function openDrawer() {
    ensureDom();
    renderDrawerBody();
    const root = document.getElementById('bc_root');
    const o = document.getElementById('bc_overlay');
    const d = document.getElementById('bc_drawer');
    if (!o || !d) return;
    root?.classList.add('bc-root--drawer-open');
    o.hidden = false;
    o.removeAttribute('hidden');
    requestAnimationFrame(() => o.classList.add('is-on'));
    d.hidden = false;
    d.removeAttribute('hidden');
    d.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => d.classList.add('bc-drawer--open'));
  }

  function closeDrawer() {
    const d = document.getElementById('bc_drawer');
    if (!d) return;
    document.getElementById('bc_root')?.classList.remove('bc-root--drawer-open');
    d.classList.remove('bc-drawer--open');
    d.setAttribute('aria-hidden', 'true');
    const o = document.getElementById('bc_overlay');
    if (o) o.classList.remove('is-on');
    setTimeout(() => {
      d.hidden = true;
      if (o) o.hidden = true;
    }, 280);
  }

  function closeModal() {
    destroyWorkSelect('bc_work_id');
    destroyWorkSelect('bc_rt_work');
    const m = document.getElementById('bc_modal');
    if (!m) return;
    m.classList.remove('is-on');
    setTimeout(() => { m.hidden = true; m.innerHTML = ''; }, 200);
  }

  function showModal(html, opts) {
    ensureDom();
    const wide = opts && opts.wide;
    const xl = opts && opts.xl;
    const cardCls = 'bc-modal__card' + (xl ? ' bc-modal__card--xl' : wide ? ' bc-modal__card--wide' : '');
    const m = document.getElementById('bc_modal');
    m.hidden = false;
    m.removeAttribute('hidden');
    m.innerHTML = `<div class="${cardCls}"><div class="bc-modal__inner">${html}</div></div>`;
    m.onclick = (ev) => { if (ev.target === m) closeModal(); };
    requestAnimationFrame(() => m.classList.add('is-on'));
  }

  function renderDrawerBody() {
    const body = document.getElementById('bc_drawer_body');
    const foot = document.getElementById('bc_drawer_foot');
    if (!body || !foot) return;
    const list = people();
    if (!list.length) {
      body.innerHTML = `<div class="bc-empty">
        <div class="bc-empty__icon" aria-hidden="true">＋</div>
        <div class="bc-empty__t">Корзина пуста</div>
        <div class="bc-empty__s">Выберите людей в реестре кнопкой «+»</div>
        <button type="button" class="btn" id="bc_empty_close">Выбрать в реестре</button>
      </div>`;
      foot.innerHTML = '';
      document.getElementById('bc_empty_close')?.addEventListener('click', closeDrawer);
      return;
    }

    body.innerHTML = list.map((p) => {
      const onSite = p.on_site_info;
      const warn = onSite
        ? `<div class="bc-card__warn">⚠ на объекте: ${esc(onSite.work_title || '')}</div>`
        : (p.planned_info
          ? `<div class="bc-card__warn bc-card__warn--info">план: ${esc(p.planned_info.work_title || '')}</div>`
          : '');
      const phone = p.phone
        ? `<a class="bc-card__phone" href="tel:${esc(p.phone)}" onclick="event.stopPropagation()">${esc(p.phone)}</a>`
        : '<span class="bc-card__muted">нет телефона</span>';
      const rating = p.rating_avg != null
        ? `<span class="bc-card__rate">★ ${Number(p.rating_avg).toFixed(1)}</span>`
        : '';
      return `<div class="bc-card" data-id="${p.id}">
        <div class="bc-card__av">${esc(initials(p.fio))}</div>
        <div class="bc-card__main">
          <div class="bc-card__fio">${esc(p.fio || '—')}</div>
          <div class="bc-card__meta">
            ${phone}
            <span class="bc-card__chip">${esc(statusLabel(p))}</span>
            ${rating}
          </div>
          ${warn}
        </div>
        <button type="button" class="bc-card__rm" data-rm="${p.id}" title="Убрать">×</button>
      </div>`;
    }).join('');

    body.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        remove(btn.dataset.rm);
        renderDrawerBody();
      });
    });

    const canAssign = ASSIGN_ROLES.includes(_userRole) || String(_userRole || '').startsWith('DIRECTOR_');
    const canRate = RATE_ROLES.includes(_userRole) || String(_userRole || '').startsWith('DIRECTOR_');

    foot.innerHTML = `
      <label class="bc-pdn"><input type="checkbox" id="bc_include_pdn"/> Включить ПДн в Excel состава</label>
      <div class="bc-cta">
        <button type="button" class="btn" id="bc_act_excel">Excel состав</button>
        <button type="button" class="btn ghost" id="bc_act_permits">Допуски</button>
        ${canAssign ? `<button type="button" class="btn" id="bc_act_assign">На объект</button>
        <button type="button" class="btn ghost" id="bc_act_plan">В план</button>` : ''}
        ${canRate ? `<button type="button" class="btn ghost bc-cta__primary" id="bc_act_rate">Оценить</button>` : ''}
      </div>
      <div class="bc-cta-secondary">
        <button type="button" class="btn ghost" id="bc_act_clear">Очистить корзину</button>
      </div>`;

    document.getElementById('bc_act_excel')?.addEventListener('click', downloadExcel);
    document.getElementById('bc_act_permits')?.addEventListener('click', openPermitsMatrix);
    document.getElementById('bc_act_assign')?.addEventListener('click', () => openWorkPicker('assign'));
    document.getElementById('bc_act_plan')?.addEventListener('click', () => openWorkPicker('plan'));
    document.getElementById('bc_act_rate')?.addEventListener('click', openRatingWizard);
    document.getElementById('bc_act_clear')?.addEventListener('click', () => clear());
  }

  // ── Row + ──────────────────────────────────────────────────────────────────

  function cartBtnHtml(empId) {
    const on = has(empId);
    return `<button type="button" class="bc-row-btn${on ? ' bc-row-btn--on' : ''}" data-bc-toggle="${empId}" title="${on ? 'Убрать из корзины' : 'В корзину'}" aria-pressed="${on ? 'true' : 'false'}">${on ? '✓' : '+'}</button>`;
  }

  function updateRowButtons() {
    document.querySelectorAll('[data-bc-toggle]').forEach((btn) => {
      const id = Number(btn.dataset.bcToggle);
      const on = has(id);
      btn.classList.toggle('bc-row-btn--on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = on ? 'Убрать из корзины' : 'В корзину';
      btn.textContent = on ? '✓' : '+';
    });
  }

  function bindRowControls() {
    document.querySelectorAll('[data-bc-toggle]').forEach((btn) => {
      if (btn._bcBound) return;
      btn._bcBound = true;
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = Number(btn.dataset.bcToggle);
        if (has(id)) remove(id);
        else {
          const snap = _cache[id] || { id };
          add(id, snap);
          if (snap.on_site_info) {
            toast('В корзине', `${snap.fio || 'Рабочий'} сейчас на объекте «${snap.on_site_info.work_title || ''}»`, 'warn');
          }
        }
      });
    });
  }

  // ── Excel состав ───────────────────────────────────────────────────────────

  async function downloadExcel() {
    if (!_ids.length) return;
    const includePdn = !!document.getElementById('bc_include_pdn')?.checked;
    try {
      const r = await fetch('/api/staff/brigade-cart/export', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ employee_ids: _ids, include_pdn: includePdn })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || ('HTTP ' + r.status));
      }
      downloadBlob(await r.blob(), 'brigada_' + todayYmd() + '.xlsx');
      toast('Excel', 'Состав бригады скачан', 'ok');
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  // ── Допуски ────────────────────────────────────────────────────────────────

  function permitCellView(c) {
    if (!c) {
      return { cls: 'bc-mx--none', icon: '—', title: 'Нет допуска', text: '—' };
    }
    const st = c.status || 'active';
    if (st === 'expired') {
      return { cls: 'bc-mx--err', icon: '✕', title: 'Просрочен' + (c.expiry_date ? ' · ' + fmtRu(c.expiry_date) : ''), text: 'просрочен' };
    }
    if (st === 'expiring_14') {
      return { cls: 'bc-mx--warn14', icon: '!', title: (c.days_left != null ? c.days_left + ' дн.' : '≤14 дн.'), text: fmtRu(c.expiry_date) || '≤14' };
    }
    if (st === 'expiring_30') {
      return { cls: 'bc-mx--warn30', icon: '!', title: (c.days_left != null ? c.days_left + ' дн.' : '≤30 дн.'), text: fmtRu(c.expiry_date) || '≤30' };
    }
    return {
      cls: 'bc-mx--ok',
      icon: '✓',
      title: c.expiry_date ? ('до ' + fmtRu(c.expiry_date)) : 'Бессрочно',
      text: c.expiry_date ? fmtRu(c.expiry_date) : 'бесср.'
    };
  }

  async function openPermitsMatrix() {
    if (!_ids.length) return;
    showModal(`<div class="bc-modal__head">Матрица допусков</div><div class="bc-loading">Загрузка…</div>`, { xl: true });
    try {
      const r = await fetch('/api/staff/brigade-cart/matrix?employee_ids=' + _ids.join(','), {
        headers: authHeaders()
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || ('HTTP ' + r.status));
      }
      const data = await r.json();
      const emps = data.employees || [];
      const matrix = data.matrix || {};
      // Только типы, которые реально есть у кого-то в корзине (без чекбокс-фильтров)
      const usedTypeIds = new Set();
      Object.keys(matrix).forEach((k) => {
        const parts = k.split('_');
        if (parts.length >= 2) usedTypeIds.add(Number(parts[parts.length - 1]));
      });
      const types = (data.types || []).filter((t) => usedTypeIds.has(Number(t.id)));
      const list = types.length ? types : (data.types || []);
      function statsFor(viewTypes) {
        let ok = 0, warn = 0, err = 0, miss = 0;
        emps.forEach((e) => {
          viewTypes.forEach((t) => {
            const c = matrix[`${e.id}_${t.id}`];
            if (!c) { miss++; return; }
            if (c.status === 'expired') err++;
            else if (c.status === 'expiring_14' || c.status === 'expiring_30') warn++;
            else ok++;
          });
        });
        return { ok, warn, err, miss };
      }

      const st = statsFor(list);
      const head = list.map((t) => {
        const label = t.code || (t.name || '').slice(0, 18);
        return `<th class="bc-mx-th" title="${esc(t.name || t.code || '')}"><span>${esc(label)}</span></th>`;
      }).join('');
      const rows = emps.map((e) => {
        const cells = list.map((t) => {
          const v = permitCellView(matrix[`${e.id}_${t.id}`]);
          return `<td class="bc-mx ${v.cls}" title="${esc(v.title)}"><span class="bc-mx-ico">${v.icon}</span><span class="bc-mx-txt">${esc(v.text)}</span></td>`;
        }).join('');
        return `<tr><td class="bc-mx-fio" title="${esc(e.fio || '')}">${esc(e.fio || '—')}</td>${cells}</tr>`;
      }).join('');

      showModal(`
        <div class="bc-modal__head">
          <div>
            <div>Матрица допусков · ${emps.length} чел.</div>
            <div class="bc-mx-legend">
              <span class="bc-mx-pill bc-mx--ok">✓ ок ${st.ok}</span>
              <span class="bc-mx-pill bc-mx--warn30">! скоро ${st.warn}</span>
              <span class="bc-mx-pill bc-mx--err">✕ просрочен ${st.err}</span>
              <span class="bc-mx-pill bc-mx--none">— нет ${st.miss}</span>
            </div>
          </div>
          <button type="button" class="btn ghost" id="bc_mx_close">✕</button>
        </div>
        <div class="bc-mx-wrap">
          <table class="bc-mx-table">
            <thead><tr><th class="bc-mx-fio-h">Сотрудник</th>${head}</tr></thead>
            <tbody>${rows || '<tr><td colspan="2" class="muted">Нет данных</td></tr>'}</tbody>
          </table>
        </div>
        <div class="bc-modal__foot">
          <button type="button" class="btn ghost" id="bc_mx_close2">Закрыть</button>
          <button type="button" class="btn" id="bc_mx_excel">Скачать Excel</button>
        </div>`, { xl: true });

      document.getElementById('bc_mx_close')?.addEventListener('click', closeModal);
      document.getElementById('bc_mx_close2')?.addEventListener('click', closeModal);
      document.getElementById('bc_mx_excel')?.addEventListener('click', () => downloadPermitsExcel());
    } catch (e) {
      showModal(`<div class="bc-modal__head">Допуски</div><div class="bc-error">${esc(e.message)}</div>
        <button type="button" class="btn" id="bc_mx_close">Закрыть</button>`);
      document.getElementById('bc_mx_close')?.addEventListener('click', closeModal);
    }
  }

  async function downloadPermitsExcel() {
    try {
      const r = await fetch('/api/staff/brigade-cart/permits-export', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ employee_ids: _ids })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || ('HTTP ' + r.status));
      }
      downloadBlob(await r.blob(), 'brigada_dopuski_' + todayYmd() + '.xlsx');
      toast('Excel', 'Состав и допуски скачаны', 'ok');
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  // ── Works picker ───────────────────────────────────────────────────────────

  async function loadWorks() {
    const uid = _userId;
    let url = '/api/works?limit=300';
    // PM видит только свои и так на бэке; лишний pm_id не нужен HEAD_PM
    if (_userRole === 'PM') {
      url += '&pm_id=' + encodeURIComponent(uid);
    }
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) throw new Error('Не удалось загрузить работы');
    const j = await r.json();
    const list = j.works || j.items || j || [];
    return Array.isArray(list) ? list.filter((w) => w && w.id) : [];
  }

  async function fetchConflicts(ids) {
    const r = await fetch('/api/staff/brigade-cart/conflicts', {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify({ employee_ids: ids })
    });
    if (!r.ok) return { items: [], conflict_count: 0 };
    return r.json();
  }

  function workOptions(works) {
    return (works || []).map((w) => {
      const st = statusLabelWork(w);
      return {
        value: String(w.id),
        label: workLabel(w) + (st ? ' · ' + st : '')
      };
    });
  }

  function destroyWorkSelect(selectId) {
    try {
      if (window.CRSelect?.destroy) CRSelect.destroy(selectId);
    } catch (_) { /* ignore */ }
  }

  /** Канонический CRSelect (поиск + стиль CRM), не native listbox. */
  function mountWorkSelect(wrapId, selectId, works, selectedValue) {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    destroyWorkSelect(selectId);
    wrap.innerHTML = '';

    if (!window.CRSelect?.create) {
      const opts = workOptions(works).map((o) =>
        `<option value="${esc(o.value)}"${String(selectedValue) === o.value ? ' selected' : ''}>${esc(o.label)}</option>`
      ).join('');
      wrap.innerHTML = `<select id="${esc(selectId)}" class="input bc-work-fallback">
        <option value="">— выберите работу —</option>${opts}
      </select>`;
      return;
    }

    const el = CRSelect.create({
      id: selectId,
      options: workOptions(works),
      value: selectedValue ? String(selectedValue) : '',
      placeholder: works.length ? 'Выберите работу…' : 'Нет доступных работ',
      searchable: true,
      clearable: true,
      fullWidth: true,
      dropdownClass: 'z-bc-modal'
    });
    wrap.appendChild(el);
    const hint = document.createElement('div');
    hint.className = 'help bc-work-hint';
    hint.textContent = works.length
      ? ('Доступно работ: ' + works.length)
      : 'Список работ пуст — проверьте права или фильтр РП';
    wrap.appendChild(hint);
  }

  function readWorkSelect(selectId) {
    let raw = '';
    let label = '';
    if (window.CRSelect?.getValue) {
      raw = CRSelect.getValue(selectId) || '';
      label = (CRSelect.getLabel && CRSelect.getLabel(selectId)) || '';
    } else {
      const sel = document.getElementById(selectId);
      raw = sel?.value || '';
      label = sel?.selectedOptions?.[0]?.textContent || '';
    }
    const id = parseInt(raw, 10);
    return {
      workId: Number.isFinite(id) ? id : null,
      workTitle: String(label || '').trim()
    };
  }

  async function openWorkPicker(mode) {
    showModal(`<div class="bc-modal__head">${mode === 'plan' ? 'В план' : 'На объект'}</div>
      <div class="bc-loading">Загрузка работ…</div>`, { wide: true });
    let works = [];
    try {
      works = await loadWorks();
    } catch (e) {
      showModal(`<div class="bc-modal__head">Ошибка</div><div class="bc-error">${esc(e.message)}</div>
        <button type="button" class="btn" id="bc_wp_x">Закрыть</button>`);
      document.getElementById('bc_wp_x')?.addEventListener('click', closeModal);
      return;
    }

    const crew = people();
    const dateFields = mode === 'plan'
      ? `<div class="bc-form-row">
          <label>Дата с<input type="date" id="bc_plan_from" class="input" value="${esc(todayYmd())}"/></label>
          <label>Дата по<input type="date" id="bc_plan_to" class="input" value="${esc(addDaysYmd(todayYmd(), 30))}"/></label>
        </div>`
      : `<p class="help bc-wp-note">Люди будут добавлены в бригаду выбранной работы. Ставки и детали — в полевом модуле.</p>`;

    showModal(`
      <div class="bc-modal__head">
        <div>
          <div>${mode === 'plan' ? 'Планируемое привлечение' : 'Назначить на объект'}</div>
          <div class="help">В корзине: <b>${crew.length}</b> чел.</div>
        </div>
        <button type="button" class="btn ghost" id="bc_wp_x">✕</button>
      </div>
      <div class="bc-form">
        <label class="bc-form-label">Работа (обязательно)</label>
        <div id="bc_work_wrap" class="bc-work-wrap"></div>
        ${dateFields}
        <div class="bc-wp-preview" id="bc_wp_preview">
          ${crew.slice(0, 8).map((p) => `<span class="bc-wp-chip" title="${esc(p.fio || '')}">${esc(initials(p.fio))}</span>`).join('')}
          ${crew.length > 8 ? `<span class="help">+${crew.length - 8}</span>` : ''}
        </div>
        <label class="bc-pdn">
          <input type="checkbox" id="bc_clear_after" checked/> очистить корзину после успеха
        </label>
      </div>
      <div class="bc-modal__foot">
        <button type="button" class="btn ghost" id="bc_wp_x2">Отмена</button>
        <button type="button" class="btn" id="bc_wp_go">Проверить и далее</button>
      </div>`, { wide: true });

    mountWorkSelect('bc_work_wrap', 'bc_work_id', works, null);
    document.getElementById('bc_wp_x')?.addEventListener('click', closeModal);
    document.getElementById('bc_wp_x2')?.addEventListener('click', closeModal);
    document.getElementById('bc_wp_go')?.addEventListener('click', async () => {
      const { workId, workTitle } = readWorkSelect('bc_work_id');
      if (!workId) {
        toast('Работа', 'Выберите работу из списка', 'warn');
        return;
      }
      const planned_from = document.getElementById('bc_plan_from')?.value || null;
      const planned_to = document.getElementById('bc_plan_to')?.value || null;
      if (mode === 'plan' && planned_from && planned_to && planned_from > planned_to) {
        toast('Период', 'Дата «с» не позже «по»', 'warn');
        return;
      }
      const clearAfter = !!document.getElementById('bc_clear_after')?.checked;
      await runWithConflicts({ mode, workId, workTitle, planned_from, planned_to, clearAfter });
    });
  }

  async function runWithConflicts({ mode, workId, workTitle, planned_from, planned_to, clearAfter }) {
    const conf = await fetchConflicts(_ids);
    const conflicts = (conf.items || []).filter((i) => i.conflict);
    if (!conflicts.length) {
      await doAssignOrPlan({ mode, workId, workTitle, planned_from, planned_to, clearAfter, ids: _ids.slice(), assignMode: 'all' });
      return;
    }

    const freeCount = _ids.length - conflicts.length;
    const listHtml = conflicts.map((c) => {
      let why = '';
      if (c.on_site) why = `уже на объекте «${esc(c.on_site.work_title || '')}»`;
      else if (c.planned) {
        const d = c.planned.planned_from ? (' с ' + fmtRu(c.planned.planned_from)) : '';
        why = `уже план на «${esc(c.planned.work_title || '')}»${d}`;
      }
      return `<li><b>${esc(c.fio || c.employee_id)}</b> — ${why}</li>`;
    }).join('');

    showModal(`
      <div class="bc-modal__head">Конфликты · ${conflicts.length} из ${_ids.length}</div>
      <p class="help">Часть людей уже заняты. Выберите, как поступить.</p>
      <ul class="bc-conflict-list">${listHtml}</ul>
      <div class="bc-modal__foot bc-modal__foot--col">
        <button type="button" class="btn" id="bc_cf_all">Продолжить для всех (${_ids.length})</button>
        <button type="button" class="btn ghost" id="bc_cf_free" ${freeCount ? '' : 'disabled'}>Только свободных (${freeCount})</button>
        <button type="button" class="btn ghost" id="bc_cf_rm">Убрать конфликтных из корзины</button>
        <button type="button" class="btn ghost" id="bc_cf_x">Отмена</button>
      </div>`, { wide: true });

    document.getElementById('bc_cf_x')?.addEventListener('click', closeModal);
    document.getElementById('bc_cf_all')?.addEventListener('click', () => {
      doAssignOrPlan({ mode, workId, workTitle, planned_from, planned_to, clearAfter, ids: _ids.slice(), assignMode: 'all' });
    });
    document.getElementById('bc_cf_free')?.addEventListener('click', () => {
      doAssignOrPlan({ mode, workId, workTitle, planned_from, planned_to, clearAfter, ids: _ids.slice(), assignMode: 'free_only' });
    });
    document.getElementById('bc_cf_rm')?.addEventListener('click', () => {
      const bad = new Set(conflicts.map((c) => Number(c.employee_id)));
      bad.forEach((id) => remove(id));
      const left = _ids.slice();
      if (!left.length) {
        toast('Корзина', 'Остались только конфликтные — некого назначать', 'warn');
        closeModal();
        return;
      }
      doAssignOrPlan({ mode, workId, workTitle, planned_from, planned_to, clearAfter, ids: left, assignMode: 'all' });
    });
  }

  async function doAssignOrPlan({ mode, workId, workTitle, planned_from, planned_to, clearAfter, ids, assignMode }) {
    try {
      if (mode === 'plan') {
        const r = await fetch('/api/staff/planned-engagements/bulk', {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({
            work_id: workId,
            planned_from,
            planned_to,
            employee_ids: ids,
            mode: assignMode
          })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        const skipMsg = (j.skipped || []).length ? `; пропущено ${j.skipped.length}` : '';
        toast('В план', `Назначено ${j.assigned_count || 0} → «${j.work_title || workTitle}»${skipMsg}`, 'ok');
        if (clearAfter) { _ids = []; saveIds(); renderChrome(); }
        closeModal();
        return;
      }

      let targetIds = ids;
      if (assignMode === 'free_only') {
        const conf = await fetchConflicts(ids);
        const busy = new Set((conf.items || []).filter((i) => i.conflict).map((i) => i.employee_id));
        targetIds = ids.filter((id) => !busy.has(id));
      }
      if (!targetIds.length) {
        toast('На объект', 'Некого назначать', 'warn');
        return;
      }

      const employees = targetIds.map((id) => ({ employee_id: id, field_role: 'worker' }));
      const r = await fetch('/api/field/manage/projects/' + workId + '/crew', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ employees })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));

      const failed = (j.results || j.items || []).filter((x) => x && x.error);
      const okCount = targetIds.length - failed.length;
      const failNote = failed.length
        ? `<p class="bc-error">Не удалось: ${failed.length}. ${esc((failed[0].error || '').slice(0, 120))}</p>`
        : '';

      const fieldLink = '#/pm-works?open=' + workId;
      showModal(`
        <div class="bc-modal__head">Назначено</div>
        <p class="bc-success-msg">Добавлено <b>${okCount}</b> чел. на «${esc(workTitle)}».</p>
        ${failNote}
        <p class="help">Ставки можно уточнить в полевом модуле работы.</p>
        <div class="bc-modal__foot">
          <a class="btn" href="${fieldLink}" id="bc_go_field">Открыть работу</a>
          <button type="button" class="btn ghost" id="bc_wp_x">Закрыть</button>
        </div>`, { wide: true });
      document.getElementById('bc_wp_x')?.addEventListener('click', closeModal);
      document.getElementById('bc_go_field')?.addEventListener('click', () => { closeModal(); closeDrawer(); });
      if (clearAfter && okCount > 0) { _ids = []; saveIds(); renderChrome(); }
    } catch (e) {
      toast('Ошибка', e.message, 'err');
    }
  }

  // ── Rating wizard (как в карточке сотрудника, шире) ────────────────────────

  function scoreScaleHtml(selected, name) {
    return `<div class="bc-rate-scale" data-scale="${esc(name || '')}">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
        `<button type="button" class="bc-rate-n${selected === n ? ' is-on' : ''}" data-s="${n}" title="${esc(SCORE_HINTS[n])}">${n}</button>`
      ).join('')}
    </div>
    <div class="bc-rate-hints"><span>1 · слабо</span><span>5 · норма</span><span>10 · эталон</span></div>`;
  }

  function chipsHtml(comment) {
    const parts = String(comment || '').split(',').map((x) => x.trim()).filter(Boolean);
    return `<div class="bc-rate-chips">
      ${COMMENT_CHIPS.map((c) =>
        `<button type="button" class="bc-chip-btn${parts.includes(c) ? ' is-on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`
      ).join('')}
    </div>`;
  }

  async function openRatingWizard() {
    if (!_ids.length) return;
    showModal(`<div class="bc-modal__head">Оценка</div><div class="bc-loading">Загрузка работ…</div>`, { wide: true });
    let works = [];
    try {
      works = await loadWorks();
    } catch (e) {
      showModal(`<div class="bc-error">${esc(e.message)}</div>
        <button type="button" class="btn" id="bc_rt_x">Закрыть</button>`);
      document.getElementById('bc_rt_x')?.addEventListener('click', closeModal);
      return;
    }

    const queue = people().map((p) => ({
      id: p.id,
      fio: p.fio,
      rating_avg: p.rating_avg,
      score: null,
      comment: '',
      skipped: false
    }));

    let mode = 'all'; // all | each
    let workId = null;
    let bulkScore = null;
    let bulkComment = '';

    function toggleChip(target, getComment, setComment) {
      const c = target.dataset.c;
      const parts = String(getComment() || '').split(',').map((x) => x.trim()).filter(Boolean);
      const i = parts.indexOf(c);
      if (i >= 0) parts.splice(i, 1);
      else parts.push(c);
      setComment(parts.join(', '));
      target.classList.toggle('is-on', parts.includes(c));
    }

    function render() {
      const rated = queue.filter((q) => q.score != null).length;
      showModal(`
        <div class="bc-modal__head">
          <div>
            <div>Оценить бригаду</div>
            <div class="help">${queue.length} чел. · как в карточке сотрудника: балл 1–10 + комментарий по работе</div>
          </div>
          <button type="button" class="btn ghost" id="bc_rt_x">✕</button>
        </div>

        <div class="bc-form">
          <label class="bc-form-label">Работа (обязательно)</label>
          <div id="bc_rt_work_wrap" class="bc-work-wrap"></div>

          <div class="bc-rate-modes" role="tablist">
            <button type="button" class="bc-rate-mode${mode === 'all' ? ' is-on' : ''}" data-mode="all">Одна оценка всем</button>
            <button type="button" class="bc-rate-mode${mode === 'each' ? ' is-on' : ''}" data-mode="each">Каждому отдельно</button>
          </div>

          <div id="bc_rt_panel"></div>
        </div>

        <div class="bc-modal__foot">
          <span class="help" id="bc_rt_stat">Оценено: ${rated}/${queue.length}</span>
          <button type="button" class="btn ghost" id="bc_rt_cancel">Отмена</button>
          <button type="button" class="btn" id="bc_rt_save">Сохранить оценки</button>
        </div>`, { wide: true });

      mountWorkSelect('bc_rt_work_wrap', 'bc_rt_work', works, workId);

      document.getElementById('bc_rt_x')?.addEventListener('click', closeModal);
      document.getElementById('bc_rt_cancel')?.addEventListener('click', closeModal);
      document.querySelectorAll('.bc-rate-mode').forEach((b) => {
        b.addEventListener('click', () => {
          mode = b.dataset.mode;
          const cur = readWorkSelect('bc_rt_work');
          if (cur.workId) workId = cur.workId;
          render();
        });
      });

      const panel = document.getElementById('bc_rt_panel');
      if (mode === 'all') {
        panel.innerHTML = `
          <div class="bc-rate-block">
            <div class="bc-rate-block__t">Оценка для всех</div>
            ${scoreScaleHtml(bulkScore, 'bulk')}
            ${chipsHtml(bulkComment)}
            <textarea id="bc_rt_bulk_c" class="input bc-textarea" rows="3" placeholder="что сделали хорошо / что улучшить">${esc(bulkComment)}</textarea>
            <div class="bc-rate-people">
              ${queue.map((q) => `
                <div class="bc-rate-people__row">
                  <span class="bc-rate-people__av">${esc(initials(q.fio))}</span>
                  <span class="bc-rate-people__fio">${esc(q.fio || '#' + q.id)}</span>
                  <span class="bc-rate-people__avg">${q.rating_avg != null ? '★ ' + Number(q.rating_avg).toFixed(1) : 'без рейтинга'}</span>
                </div>`).join('')}
            </div>
          </div>`;

        panel.querySelectorAll('[data-scale="bulk"] [data-s]').forEach((b) => {
          b.addEventListener('click', () => {
            bulkScore = Number(b.dataset.s);
            queue.forEach((q) => { q.score = bulkScore; q.skipped = false; });
            panel.querySelectorAll('[data-scale="bulk"] [data-s]').forEach((x) => {
              x.classList.toggle('is-on', Number(x.dataset.s) === bulkScore);
            });
            const st = document.getElementById('bc_rt_stat');
            if (st) st.textContent = 'Оценено: ' + queue.length + '/' + queue.length + ' · балл ' + bulkScore;
          });
        });
        panel.querySelectorAll('.bc-chip-btn[data-c]').forEach((b) => {
          b.addEventListener('click', () => {
            toggleChip(b, () => bulkComment, (v) => {
              bulkComment = v;
              const ta = document.getElementById('bc_rt_bulk_c');
              if (ta) ta.value = v;
              queue.forEach((q) => { q.comment = v; });
            });
          });
        });
        document.getElementById('bc_rt_bulk_c')?.addEventListener('input', (ev) => {
          bulkComment = ev.target.value;
          queue.forEach((q) => { q.comment = bulkComment; });
        });
      } else {
        panel.innerHTML = `
          <div class="bc-rate-block">
            <div class="bc-rate-toolbar">
              <span class="help">Быстро: выставить балл всем без оценки</span>
              <div class="bc-rate-scale bc-rate-scale--sm" id="bc_rt_fill">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
                  `<button type="button" class="bc-rate-n" data-fill="${n}">${n}</button>`
                ).join('')}
              </div>
            </div>
            <div class="bc-rate-list">
              ${queue.map((q, i) => `
                <div class="bc-rate-card" data-idx="${i}">
                  <div class="bc-rate-card__head">
                    <span class="bc-rate-people__av">${esc(initials(q.fio))}</span>
                    <div>
                      <div class="bc-rate-card__fio">${esc(q.fio || '#' + q.id)}</div>
                      <div class="help">${q.rating_avg != null ? 'сейчас ★ ' + Number(q.rating_avg).toFixed(1) : 'рейтинга ещё нет'}</div>
                    </div>
                    <button type="button" class="btn ghost btn-sm" data-skip="${i}">${q.skipped ? 'Вернуть' : 'Пропуск'}</button>
                  </div>
                  <div class="${q.skipped ? 'bc-rate-card__body is-skip' : 'bc-rate-card__body'}">
                    ${scoreScaleHtml(q.score, 'r' + i)}
                    ${chipsHtml(q.comment)}
                    <textarea class="input bc-textarea" rows="2" data-cmt="${i}" placeholder="комментарий по этому человеку">${esc(q.comment || '')}</textarea>
                  </div>
                </div>`).join('')}
            </div>
          </div>`;

        document.getElementById('bc_rt_fill')?.querySelectorAll('[data-fill]').forEach((b) => {
          b.addEventListener('click', () => {
            const v = Number(b.dataset.fill);
            queue.forEach((q) => {
              if (!q.skipped) q.score = v;
            });
            bulkScore = v;
            render();
          });
        });

        panel.querySelectorAll('[data-skip]').forEach((b) => {
          b.addEventListener('click', () => {
            const i = Number(b.dataset.skip);
            queue[i].skipped = !queue[i].skipped;
            if (queue[i].skipped) queue[i].score = null;
            render();
          });
        });

        panel.querySelectorAll('.bc-rate-card').forEach((card) => {
          const i = Number(card.dataset.idx);
          card.querySelectorAll('[data-s]').forEach((b) => {
            b.addEventListener('click', () => {
              queue[i].score = Number(b.dataset.s);
              queue[i].skipped = false;
              card.querySelectorAll('[data-s]').forEach((x) => {
                x.classList.toggle('is-on', Number(x.dataset.s) === queue[i].score);
              });
              card.querySelector('.bc-rate-card__body')?.classList.remove('is-skip');
              const st = document.getElementById('bc_rt_stat');
              if (st) st.textContent = 'Оценено: ' + queue.filter((q) => q.score != null).length + '/' + queue.length;
            });
          });
          card.querySelectorAll('.bc-chip-btn[data-c]').forEach((b) => {
            b.addEventListener('click', () => {
              toggleChip(b, () => queue[i].comment, (v) => {
                queue[i].comment = v;
                const ta = card.querySelector('[data-cmt]');
                if (ta) ta.value = v;
              });
            });
          });
          card.querySelector('[data-cmt]')?.addEventListener('input', (ev) => {
            queue[i].comment = ev.target.value;
          });
        });
      }

      document.getElementById('bc_rt_save')?.addEventListener('click', async () => {
        const picked = readWorkSelect('bc_rt_work');
        workId = picked.workId;
        if (!workId) {
          toast('Работа', 'Выберите работу — оценка всегда привязана к объекту', 'warn');
          return;
        }
        if (mode === 'all') {
          const ta = document.getElementById('bc_rt_bulk_c');
          if (ta) bulkComment = ta.value;
          if (bulkScore == null) {
            toast('Оценка', 'Выберите балл 1–10', 'warn');
            return;
          }
          queue.forEach((q) => {
            if (!q.skipped) {
              q.score = bulkScore;
              q.comment = bulkComment;
            }
          });
        }
        const items = queue
          .filter((q) => q.score != null && !q.skipped)
          .map((q) => ({ employee_id: q.id, score: q.score, comment: q.comment || '' }));
        if (!items.length) {
          toast('Оценка', 'Нет оценок для сохранения', 'warn');
          return;
        }
        const btn = document.getElementById('bc_rt_save');
        if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем…'; }
        try {
          const r = await fetch('/api/staff/reviews/bulk', {
            method: 'POST',
            headers: authHeaders(true),
            body: JSON.stringify({ work_id: workId, items })
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
          (j.saved || []).forEach((s) => {
            if (_cache[s.employee_id]) _cache[s.employee_id].rating_avg = s.rating_avg;
          });
          toast('Оценка', 'Сохранено ' + (j.saved_count || items.length) + ' из ' + queue.length, 'ok');
          closeModal();
          renderDrawerBody();
        } catch (e) {
          toast('Ошибка', e.message, 'err');
          if (btn) { btn.disabled = false; btn.textContent = 'Сохранить оценки'; }
        }
      });
    }

    render();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function mount({ user, employees }) {
    _userId = user?.id;
    _userRole = user?.role;
    _ids = loadIds();
    mergeCache(employees);
    ensureDom();
    renderChrome();
    bindRowControls();
    _mounted = true;

    const badgeBtn = document.getElementById('prs_bc_open');
    if (badgeBtn) {
      badgeBtn.onclick = function (ev) {
        ev.preventDefault();
        openDrawer();
      };
    }
  }

  window.AsgardBrigadeCart = {
    mount,
    cartBtnHtml,
    has,
    add,
    remove,
    clear,
    getIds: () => _ids.slice(),
    open: openDrawer
  };
})();
