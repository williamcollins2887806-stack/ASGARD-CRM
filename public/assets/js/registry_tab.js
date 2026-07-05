/**
 * Registry tab — live TO tender spreadsheet (#/tenders → Реестр)
 */
window.AsgardRegistryTab = (function () {
  const { esc, toast, showModal, hideModal } = AsgardUI;
  const API = AsgardRegistryApi;
  const timers = {};
  let mountEl = null;
  let state = { subtab: 'registry', period: 'current', burnOnly: false };
  let onRefreshCb = null;
  let onOpenWinCb = null;
  let pmsCache = [];

  function debounce(key, fn, delay) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(fn, delay || 400);
  }

  function scoreTooltip(score) {
    if (!score || !score.top_reject_reasons) return '';
    const parts = score.top_reject_reasons.map((r) => (r.reason || r.label || r) + (r.count ? ' (' + r.count + ')' : ''));
    return parts.join('\n') || '';
  }

  function renderCustomerCell(row) {
    const id = 'reg-cust-' + row.id;
    return '<div class="reg-cust-wrap" data-id="' + row.id + '">' +
      '<input class="inp reg-cust-inp" id="' + id + '" value="' + esc(row.customer_name || '') + '" autocomplete="off" style="width:100%;min-width:120px"/>' +
      '<div class="reg-cust-dd" style="display:none;position:absolute;z-index:50;background:var(--bg);border:1px solid var(--brd);max-height:200px;overflow:auto;width:100%"></div>' +
      '</div>';
  }

  function bindCustomerSuggest(wrap, row, saveField) {
    const inp = wrap.querySelector('.reg-cust-inp');
    const dd = wrap.querySelector('.reg-cust-dd');
    if (!inp || !dd) return;
    wrap.style.position = 'relative';

    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      saveField(row.id, 'customer_name', v);
      if (v.length < 2) { dd.style.display = 'none'; return; }
      debounce('suggest-' + row.id, () => {
        API.suggestCustomers(v).then((items) => {
          if (!items.length) { dd.style.display = 'none'; return; }
          dd.innerHTML = items.slice(0, 8).map((it) => {
            const name = it.value || it.name || it.label || '';
            const inn = it.data && it.data.inn ? it.data.inn : (it.inn || '');
            return '<div class="reg-cust-opt" data-name="' + esc(name) + '" data-inn="' + esc(inn) + '" style="padding:6px 8px;cursor:pointer">' +
              esc(name) + (inn ? ' <small class="muted">ИНН ' + esc(inn) + '</small>' : '') + '</div>';
          }).join('');
          dd.style.display = 'block';
          dd.querySelectorAll('.reg-cust-opt').forEach((opt) => {
            opt.addEventListener('mousedown', (e) => {
              e.preventDefault();
              inp.value = opt.dataset.name;
              saveField(row.id, 'customer_name', opt.dataset.name);
              if (opt.dataset.inn) saveField(row.id, 'customer_inn', opt.dataset.inn);
              dd.style.display = 'none';
            });
          });
        });
      }, 300);
    });
    inp.addEventListener('blur', () => setTimeout(() => { dd.style.display = 'none'; }, 150));
  }

  function openWinModal(tender) {
    if (typeof onOpenWinCb === 'function') { onOpenWinCb(tender); return; }
    const html = '<p>' + esc(tender.customer_name) + ' — ' + esc(tender.tender_title) + '</p>' +
      '<label>РП на работу<select class="inp" id="winWorkPm" style="width:100%;margin-top:4px"><option value="">— выберите —</option></select></label>' +
      '<div style="display:flex;gap:8px;margin-top:16px">' +
      '<button type="button" class="btn" id="winWorkSubmit">Создать работу</button>' +
      '<button type="button" class="btn ghost" id="winWorkCancel">Отмена</button></div>';
    showModal({
      title: 'Выиграли — создать работу',
      html,
      wide: true,
      onMount: () => {
        const sel = document.getElementById('winWorkPm');
        pmsCache.forEach((p) => {
          const o = document.createElement('option');
          o.value = p.id;
          o.textContent = p.name;
          if (tender.responsible_pm_id === p.id) o.selected = true;
          sel.appendChild(o);
        });
        document.getElementById('winWorkCancel')?.addEventListener('click', hideModal);
        document.getElementById('winWorkSubmit')?.addEventListener('click', async () => {
          const pmId = Number(document.getElementById('winWorkPm')?.value);
          if (!pmId) { toast('Выберите РП', 'err'); return; }
          try {
            await API.createRegistryWork(tender.id, pmId);
            toast('Работа создана', 'ok');
            hideModal();
            refresh();
            onRefreshCb && onRefreshCb();
          } catch (e) { toast(e.message, 'err'); }
        });
      }
    });
  }

  function renderToolbar(total, periodOptions) {
    const opts = periodOptions.map((o) =>
      '<option value="' + esc(o.value) + '"' + (o.value === state.period ? ' selected' : '') + '>' + esc(o.label) + '</option>'
    ).join('');
    return '<div class="reg-toolbar" style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<label style="display:flex;align-items:center;gap:6px"><span class="muted" style="font-size:13px">Период:</span>' +
      '<select class="inp" id="regPeriodSel">' + opts + '</select></label>' +
      '<span class="muted" style="font-size:13px">' + total + ' тендеров · ' + esc(API.periodLabel(state.period, periodOptions)) +
      (state.burnOnly ? ' · горящие дедлайны' : '') + '</span>' +
      '<button type="button" class="btn mini" id="regAddRow">+ Добавить строку</button>' +
      '<button type="button" class="btn mini ghost" id="regRefresh">↻ Обновить</button>' +
      '<a href="#/pm-duty" class="btn mini ghost">📅 Дежурство РП</a>' +
      '</div>';
  }

  function renderTable(rows) {
    const statusOpts = API.REGISTRY_STATUSES.map((s) => '<option value="' + s.value + '">' + esc(s.label) + '</option>').join('');
    let html = '<div style="overflow-x:auto"><table class="tnd-table asg" style="width:100%;font-size:13px"><thead><tr>' +
      '<th>Заказчик</th><th>Тендер</th><th>НМЦ</th><th>Срок</th><th>Статус</th><th>Кто считает</th><th>РП</th><th>Скор</th><th>↗</th>' +
      '</tr></thead><tbody>';
    rows.forEach((row) => {
      const rpPill = row.rp_review?.decision === 'submit' ? '<span class="pill ok">Подаём</span>'
        : row.rp_review?.decision === 'reject' ? '<span class="pill err">Не подаём</span>'
        : '<span class="pill">ожидает</span>';
      const score = row.score;
      const scoreTxt = score ? score.win_chance_pct + '% (' + (score.tenders_count || 0) + ')' : '—';
      const scoreTitle = esc(scoreTooltip(score));
      const dl = row.docs_deadline ? String(row.docs_deadline).slice(0, 10) : '';
      html += '<tr data-id="' + row.id + '">' +
        '<td>' + renderCustomerCell(row) + '</td>' +
        '<td><input class="inp reg-field" data-field="tender_title" value="' + esc(row.tender_title || '') + '" style="width:100%;min-width:140px"/></td>' +
        '<td><input class="inp reg-field" data-field="tender_price" type="number" value="' + (row.tender_price != null ? row.tender_price : '') + '" style="width:90px"/></td>' +
        '<td><input class="inp reg-field" data-field="docs_deadline" type="date" value="' + dl + '"/></td>' +
        '<td><select class="inp reg-status">' + API.REGISTRY_STATUSES.map((s) =>
          '<option value="' + s.value + '"' + ((row.registry_status || 'рассмотрение') === s.value ? ' selected' : '') + '>' + esc(s.label) + '</option>'
        ).join('') + '</select></td>' +
        '<td>' + esc(row.calculator_user_name || row.rp_review?.calculator_name || '—') + '</td>' +
        '<td>' + rpPill + '</td>' +
        '<td title="' + scoreTitle + '">' + esc(scoreTxt) + '</td>' +
        '<td>' + (row.purchase_url
          ? '<a href="' + esc(row.purchase_url) + '" target="_blank" rel="noopener" class="btn mini ghost">↗</a>'
          : '<input class="inp reg-field" data-field="purchase_url" placeholder="URL" value="' + esc(row.purchase_url || '') + '" style="width:80px"/>') +
        '</td></tr>';
    });
    html += '</tbody></table></div>';
    if (!rows.length) {
      html += '<p class="muted">' + (state.burnOnly ? 'Нет горящих дедлайнов в выбранном периоде' : 'Нет записей за выбранный период') + '</p>';
    }
    return html;
  }

  function bindTable(rows, saveField, saveStatus) {
    mountEl.querySelectorAll('.reg-cust-wrap').forEach((wrap) => {
      const id = Number(wrap.dataset.id);
      const row = rows.find((r) => r.id === id);
      if (row) bindCustomerSuggest(wrap, row, saveField);
    });
    mountEl.querySelectorAll('.reg-field').forEach((inp) => {
      const tr = inp.closest('tr');
      const id = Number(tr?.dataset.id);
      const field = inp.dataset.field;
      inp.addEventListener('change', () => {
        let val = inp.value;
        if (field === 'tender_price') val = val === '' ? null : Number(val);
        if (field === 'docs_deadline') val = val || null;
        saveField(id, field, val);
      });
      if (field === 'tender_title' || field === 'purchase_url') {
        inp.addEventListener('input', () => debounce(id + ':' + field, () => saveField(id, field, inp.value)));
      }
    });
    mountEl.querySelectorAll('.reg-status').forEach((sel) => {
      const id = Number(sel.closest('tr')?.dataset.id);
      sel.addEventListener('change', () => saveStatus(id, sel.value));
    });
  }

  async function refresh() {
    if (!mountEl) return;
    mountEl.innerHTML = '<p>Загрузка реестра…</p>';
    const periodOptions = API.buildRegistryPeriodOptions();
    try {
      const d = await API.loadRegistry({
        subtab: state.subtab,
        period: state.period,
        burn: state.burnOnly,
        limit: state.period === '' ? 2000 : 500
      });
      const rows = d.items || [];
      mountEl.innerHTML = renderToolbar(d.total != null ? d.total : rows.length, periodOptions) + renderTable(rows);

      const saveField = (id, field, value) => {
        debounce(id + ':' + field, () => {
          API.patchRegistryField(id, field, value)
            .then(() => onRefreshCb && onRefreshCb())
            .catch((e) => toast(e.message, 'err'));
        });
      };
      const saveStatus = (id, registry_status) => {
        API.patchRegistryStatus(id, registry_status)
          .then((res) => {
            if (registry_status === 'выиграли') openWinModal(res.tender || { id, registry_status });
            onRefreshCb && onRefreshCb();
            refresh();
          })
          .catch((e) => toast(e.message, 'err'));
      };
      bindTable(rows, saveField, saveStatus);

      const periodSel = document.getElementById('regPeriodSel');
      if (periodSel) periodSel.addEventListener('change', () => {
        state.period = periodSel.value;
        state.burnOnly = false;
        refresh();
      });
      document.getElementById('regAddRow')?.addEventListener('click', () => {
        API.createRegistryRow({ customer_name: 'Новый заказчик', tender_title: 'Новый тендер' })
          .then(() => { toast('Строка добавлена', 'ok'); refresh(); onRefreshCb && onRefreshCb(); })
          .catch((e) => toast(e.message, 'err'));
      });
      document.getElementById('regRefresh')?.addEventListener('click', refresh);
    } catch (e) {
      mountEl.innerHTML = '<p class="err">Ошибка загрузки: ' + esc(e.message) + '</p>';
    }
  }

  return {
    mount(el, opts) {
      mountEl = el;
      opts = opts || {};
      state.subtab = opts.subtab || 'registry';
      state.period = opts.period != null ? opts.period : 'current';
      state.burnOnly = !!opts.burnOnly;
      onRefreshCb = opts.onRefresh;
      onOpenWinCb = opts.onOpenWin;
      API.loadUsers('PM,HEAD_PM').then((u) => { pmsCache = u || []; }).catch(() => {});
      refresh();
    },
    setBurnOnly(on) {
      state.burnOnly = !!on;
      state.period = state.period || 'current';
      if (mountEl) refresh();
    },
    setPeriod(p) {
      state.period = p;
      state.burnOnly = false;
      if (mountEl) refresh();
    },
    setSubtab(sub) {
      state.subtab = sub || 'registry';
      if (mountEl) refresh();
    },
    refresh,
    unmount() {
      mountEl = null;
      Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
    }
  };
})();
