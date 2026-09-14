/**
 * Site Crew Matrix — кто на объектах (HEAD_TO / ADMIN / directors)
 * Аккордеон-блоки по работам + поиск ФИО / объект / РП.
 */
window.AsgardSiteCrewPage = (function () {
  const UI = window.AsgardUI || {};
  const $ = UI.$ || ((s, r) => (r || document).querySelector(s));
  const esc = UI.esc || ((s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const toast = UI.toast || ((t, m) => alert(t + ': ' + m));
  const showModal = UI.showModal;
  const hideModal = UI.hideModal || UI.closeModal || (() => {});

  function ensureStyles() {
    if (document.getElementById('sc-styles')) return;
    const st = document.createElement('style');
    st.id = 'sc-styles';
    st.textContent = `
      .sc-toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
      .sc-toolbar h2 { margin:0; flex:1; min-width:160px; }
      .sc-filters { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
      .sc-filters .inp { flex:1; min-width:220px; max-width:420px; }
      .sc-stat { font-size:12px; color:var(--t-2); white-space:nowrap; }
      .sc-block {
        border: 1px solid var(--brd);
        border-radius: 12px;
        background: var(--bg-2, var(--card, #fff));
        margin-bottom: 10px;
        overflow: hidden;
      }
      .sc-block-head {
        display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
        padding: 12px 14px; cursor: pointer; user-select: none;
        transition: background .12s ease;
      }
      .sc-block-head:hover { background: var(--bg-3, rgba(0,0,0,.04)); }
      .sc-block-head:focus-visible { outline: 2px solid var(--gold, #c9a227); outline-offset: -2px; }
      .sc-block-title { font-weight: 800; font-size: 15px; color: var(--t-1); }
      .sc-block-meta { font-size: 12px; color: var(--t-2); flex: 1; min-width: 140px; }
      .sc-badge {
        font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px;
        background: var(--bg-3, rgba(0,0,0,.06)); color: var(--t-1);
        border: 1px solid var(--brd);
      }
      .sc-chevron {
        font-size: 14px; color: var(--t-2); transition: transform .15s ease;
        width: 1.2em; text-align: center;
      }
      .sc-block.open .sc-chevron { transform: rotate(90deg); }
      .sc-block-body { display: none; padding: 0 14px 14px; border-top: 1px solid var(--brd); }
      .sc-block.open .sc-block-body { display: block; }
      .sc-block-body table { width: 100%; font-size: 13px; margin-top: 10px; }
      tr.sc-hit td { background: color-mix(in srgb, var(--gold, #c9a227) 18%, transparent); }
      tr.sc-hit td:first-child { box-shadow: inset 3px 0 0 var(--gold, #c9a227); }
    `;
    document.head.appendChild(st);
  }

  async function api(method, path, body) {
    const token = localStorage.getItem('asgard_token');
    const opts = {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch('/api/site-crew' + path, opts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || data.message || ('HTTP ' + resp.status));
    return data;
  }

  function norm(s) {
    return String(s || '').toLowerCase().trim();
  }

  /** @returns {{ work: object, metaHit: boolean, crewHits: Set<number> }[]} */
  function filterWorks(works, qRaw) {
    const q = norm(qRaw);
    if (!q) {
      return (works || []).map((w) => ({ work: w, metaHit: false, crewHits: new Set() }));
    }
    const out = [];
    for (const w of works || []) {
      const metaHit = [w.work_title, w.customer_name, w.city, w.pm_name]
        .some((x) => norm(x).includes(q));
      const crewHits = new Set();
      for (const c of w.crew || []) {
        if (norm(c.fio).includes(q) || norm(c.position).includes(q)) {
          crewHits.add(c.employee_id);
        }
      }
      if (metaHit || crewHits.size) {
        out.push({ work: w, metaHit, crewHits });
      }
    }
    return out;
  }

  async function render({ layout, title }) {
    ensureStyles();
    let worksCache = [];
    const expanded = new Set();
    let filterQ = '';
    let debounceTimer = null;

    await layout(`
      <div class="panel">
        <div class="sc-toolbar">
          <h2>${esc(title || 'Кто на объектах')}</h2>
          <button class="btn primary" id="sc_add" type="button">＋ Добавить на объект</button>
          <button class="btn ghost" id="sc_refresh" type="button">↻ Обновить</button>
        </div>
        <div class="sc-filters">
          <input id="sc_q" class="inp" type="search" placeholder="ФИО, объект или РП…" autocomplete="off" aria-label="Поиск по ФИО, объекту или РП">
          <span class="sc-stat" id="sc_stat"></span>
        </div>
        <div id="sc_body" class="help">Загрузка…</div>
      </div>
    `, { title: title || 'Кто на объектах' });

    function updateStat(filtered) {
      const el = $('#sc_stat');
      if (!el) return;
      const nWorks = filtered.length;
      const nPeople = filtered.reduce((s, x) => s + ((x.work.crew || []).length), 0);
      const totalPeople = worksCache.reduce((s, w) => s + ((w.crew || []).length), 0);
      if (filterQ.trim()) {
        el.textContent = `${nWorks} из ${worksCache.length} объектов · ${nPeople} чел.`;
      } else {
        el.textContent = `${worksCache.length} объектов · ${totalPeople} чел.`;
      }
    }

    function bindExpand(box) {
      box.querySelectorAll('.sc-block-head').forEach((head) => {
        head.addEventListener('click', () => {
          const block = head.closest('.sc-block');
          if (!block) return;
          const id = Number(block.dataset.workId);
          const open = block.classList.toggle('open');
          head.setAttribute('aria-expanded', open ? 'true' : 'false');
          if (open) expanded.add(id);
          else expanded.delete(id);
        });
        head.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            head.click();
          }
        });
      });
    }

    function bindActions(box, reload) {
      box.querySelectorAll('.sc-warn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          warnRemove(btn.dataset.w, btn.dataset.e, btn.dataset.fio, reload);
        });
      });
      box.querySelectorAll('.sc-force').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          forceRemove(btn.dataset.w, btn.dataset.e, btn.dataset.fio, reload);
        });
      });
    }

    function renderList() {
      const box = $('#sc_body');
      if (!box) return;
      const filtered = filterWorks(worksCache, filterQ);
      updateStat(filtered);

      if (!worksCache.length) {
        box.innerHTML = '<div class="help">Нет активных назначений на объектах</div>';
        return;
      }
      if (!filtered.length) {
        box.innerHTML = '<div class="help">Ничего не найдено</div>';
        return;
      }

      const q = norm(filterQ);
      const autoExpandCrew = q && filtered.some((x) => x.crewHits.size > 0);
      const onlyOne = filtered.length === 1;

      box.innerHTML = filtered.map(({ work: w, crewHits }) => {
        const forceOpen = (q && crewHits.size > 0) || (q && onlyOne) || expanded.has(w.work_id);
        if (forceOpen) expanded.add(w.work_id);
        const openCls = forceOpen ? ' open' : '';
        const rows = (w.crew || []).map((c) => {
          const rem = c.removal;
          let btn;
          if (!rem) {
            btn = `<button class="btn ghost mini sc-warn" type="button" data-w="${w.work_id}" data-e="${c.employee_id}" data-fio="${esc(c.fio)}">Снять с объекта</button>`;
          } else if (rem.can_force) {
            btn = `<button class="btn danger mini sc-force" type="button" data-w="${w.work_id}" data-e="${c.employee_id}" data-fio="${esc(c.fio)}">Снять принудительно</button>`;
          } else {
            btn = `<span class="muted" style="font-size:12px">Ждём РП · ещё ~${rem.hours_left || '?'} ч</span>`;
          }
          const dir = c.last_travel_direction === 'to_site' ? '→ туда'
            : (c.last_travel_direction === 'from_site' ? '← обратно' : '—');
          const hitCls = crewHits.has(c.employee_id) ? ' class="sc-hit"' : '';
          return `<tr${hitCls}>
            <td><b>${esc(c.fio)}</b><div class="muted" style="font-size:11px">${esc(c.position || '')}</div></td>
            <td>${esc(c.since || '—')}</td>
            <td>${esc(dir)}</td>
            <td style="text-align:right">${btn}</td>
          </tr>`;
        }).join('');

        const metaParts = [
          w.customer_name || '',
          w.city || '',
          w.pm_name ? ('РП: ' + w.pm_name) : ''
        ].filter(Boolean);

        return `<div class="sc-block${openCls}" data-work-id="${w.work_id}">
          <div class="sc-block-head" role="button" tabindex="0" aria-expanded="${forceOpen ? 'true' : 'false'}">
            <span class="sc-chevron" aria-hidden="true">▶</span>
            <div class="sc-block-title">${esc(w.work_title)}</div>
            <div class="sc-block-meta">${esc(metaParts.join(' · '))}</div>
            <span class="sc-badge">${(w.crew || []).length} чел.</span>
          </div>
          <div class="sc-block-body">
            <table class="table">
              <thead><tr><th>Рабочий</th><th>На объекте с</th><th>Дорога</th><th></th></tr></thead>
              <tbody>${rows || '<tr><td colspan="4" class="muted">Пусто</td></tr>'}</tbody>
            </table>
          </div>
        </div>`;
      }).join('');

      // autoExpandCrew unused except for clarity — forceOpen already handles
      void autoExpandCrew;
      bindExpand(box);
      bindActions(box, load);
    }

    async function load() {
      const box = $('#sc_body');
      try {
        const data = await api('GET', '/matrix');
        worksCache = data.works || [];
        // keep expansion for still-present works
        const ids = new Set(worksCache.map((w) => w.work_id));
        for (const id of [...expanded]) {
          if (!ids.has(id)) expanded.delete(id);
        }
        renderList();
      } catch (e) {
        box.innerHTML = `<div class="help" style="color:var(--err-t)">${esc(e.message)}</div>`;
      }
    }

    const qInp = $('#sc_q');
    if (qInp) {
      qInp.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          filterQ = qInp.value || '';
          renderList();
        }, 200);
      });
    }

    $('#sc_refresh').onclick = load;
    $('#sc_add').onclick = () => openAdd(load);
    await load();
  }

  function warnRemove(workId, empId, fio, reload) {
    showModal({
      title: 'Предупреждение РП',
      html: `<p>Отправить РП письмо: снять <b>${esc(fio)}</b> в течение 24 часов?</p>
        <label class="muted">Причина</label>
        <textarea id="sc_reason" class="inp" rows="3" style="width:100%"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="btn ghost" id="sc_cancel" type="button">Отмена</button>
          <button class="btn primary" id="sc_ok" type="button">Отправить</button>
        </div>`,
      onMount: ({ body }) => {
        $('#sc_cancel', body).onclick = () => hideModal();
        $('#sc_ok', body).onclick = async () => {
          const reason = ($('#sc_reason', body) || {}).value || '';
          if (!reason.trim()) { toast('Ошибка', 'Укажите причину', 'err'); return; }
          try {
            await api('POST', '/remove-warn', { work_id: Number(workId), employee_id: Number(empId), reason: reason.trim() });
            toast('Отправлено', 'РП уведомлён', 'ok');
            hideModal();
            reload();
          } catch (e) { toast('Ошибка', e.message, 'err'); }
        };
      }
    });
  }

  function forceRemove(workId, empId, fio, reload) {
    const today = new Date().toISOString().slice(0, 10);
    showModal({
      title: 'Принудительное снятие',
      html: `<p>Снять <b>${esc(fio)}</b> с объекта сейчас?</p>
        <label class="muted">Причина</label>
        <textarea id="sc_reason" class="inp" rows="3" style="width:100%"></textarea>
        <label class="muted" style="margin-top:8px;display:block">Дата отъезда</label>
        <input id="sc_dep" class="inp" type="date" value="${today}" style="width:100%">
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="btn ghost" id="sc_cancel" type="button">Отмена</button>
          <button class="btn danger" id="sc_ok" type="button">Снять</button>
        </div>`,
      onMount: ({ body }) => {
        $('#sc_cancel', body).onclick = () => hideModal();
        $('#sc_ok', body).onclick = async () => {
          const reason = ($('#sc_reason', body) || {}).value || '';
          const departure_date = ($('#sc_dep', body) || {}).value || today;
          if (!reason.trim()) { toast('Ошибка', 'Укажите причину', 'err'); return; }
          try {
            await api('POST', '/remove-force', {
              work_id: Number(workId), employee_id: Number(empId),
              reason: reason.trim(), departure_date
            });
            toast('Снят', fio, 'ok');
            hideModal();
            reload();
          } catch (e) { toast('Ошибка', e.message, 'err'); }
        };
      }
    });
  }

  async function openAdd(reload) {
    let works = [];
    try {
      const w = await api('GET', '/works');
      works = w.works || [];
    } catch (e) {
      toast('Ошибка', e.message, 'err');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    showModal({
      title: 'Добавить на объект',
      wide: true,
      html: `
        <label class="muted">Объект</label>
        <select id="sc_work" class="inp" style="width:100%">
          ${works.map((w) => `<option value="${w.id}">${esc(w.label || w.title)}</option>`).join('') || '<option value="">Нет работ</option>'}
        </select>
        <label class="muted" style="margin-top:8px;display:block">Рабочий (поиск ФИО)</label>
        <input id="sc_emp_q" class="inp" style="width:100%" placeholder="Начните вводить ФИО…">
        <select id="sc_emp" class="inp" style="width:100%;margin-top:6px"><option value="">—</option></select>
        <label class="muted" style="margin-top:8px;display:block">Дата с</label>
        <input id="sc_from" class="inp" type="date" value="${today}" style="width:100%">
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="btn ghost" id="sc_cancel" type="button">Отмена</button>
          <button class="btn primary" id="sc_ok" type="button">Добавить</button>
        </div>`,
      onMount: ({ body }) => {
        const q = $('#sc_emp_q', body);
        const sel = $('#sc_emp', body);
        let timer = null;
        if (q && sel) {
          q.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(async () => {
              const s = q.value.trim();
              if (s.length < 2) return;
              try {
                const token = localStorage.getItem('asgard_token');
                const r = await fetch('/api/staff/employees?search=' + encodeURIComponent(s) + '&limit=20', {
                  headers: { Authorization: 'Bearer ' + token }
                });
                const d = await r.json();
                const emps = d.employees || [];
                sel.innerHTML = emps.map((e) =>
                  `<option value="${e.id}">${esc(e.fio || e.full_name || ('#' + e.id))}</option>`
                ).join('') || '<option value="">Не найдено</option>';
              } catch (_) { /* ignore */ }
            }, 300);
          });
        }
        $('#sc_cancel', body).onclick = () => hideModal();
        $('#sc_ok', body).onclick = async () => {
          const work_id = Number(($('#sc_work', body) || {}).value);
          const employee_id = Number(($('#sc_emp', body) || {}).value);
          const date_from = ($('#sc_from', body) || {}).value;
          if (!work_id || !employee_id) { toast('Ошибка', 'Выберите объект и рабочего', 'err'); return; }
          try {
            await api('POST', '/add', { work_id, employee_id, date_from });
            toast('Добавлен', 'РП уведомлён', 'ok');
            hideModal();
            reload();
          } catch (e) { toast('Ошибка', e.message, 'err'); }
        };
      }
    });
  }

  return { render };
})();
