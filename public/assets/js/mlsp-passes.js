/**
 * ASGARD CRM — МЛСП · пропуска и транспорт
 * #/mlsp-passes
 * Без system prompt/confirm/alert — только AsgardUI.
 */
window.AsgardMlspPassesPage = (function () {
  const TYPES = [
    { id: 'flight', name: 'Перелёт', desc: 'Авиазаявка ГПН-Снабжение · Архангельск–Варандей–МЛСП' },
    { id: 'ship', name: 'Корабль', desc: 'Список пассажиров МЛСП ↔ порт' },
    { id: 'pass_35srz', name: 'Пропуск 35 СРЗ', desc: 'Проход и проезд на территорию СРЗ' },
    { id: 'pass_mmrp', name: 'Пропуск ММРП', desc: 'Порт / пункт пропуска · Аврора Логистика' },
    { id: 'pass_mlsp', name: 'Пропуск МЛСП', desc: 'Приразломная · исходящий 141603/NN' },
    { id: 'pass_fsb', name: 'Пропуск ФСБ', desc: 'Погранзона Варандей · пр. 102 прил. 3/5' }
  ];

  const TABS = [
    { id: 'today', label: 'Сегодня' },
    { id: 'board', label: 'Сводка' },
    { id: 'gen', label: 'Генератор' },
    { id: 'apps', label: 'Заявки' },
    { id: 'registry', label: 'Реестр МЛСП' },
    { id: 'history', label: 'История' },
    { id: 'base', label: 'База' }
  ];

  const REG_STATUSES = ['Подана', 'Подтверждена', 'В работе', 'Готова', 'Сорвана'];

  const WORKFLOW_STEPS = [
    { id: 'collect', label: 'Собрать', hint: 'Люди из Дружины + договор' },
    { id: 'exported', label: 'Скачать бланк', hint: '1 файл = 1 лист под печать' },
    { id: 'sent', label: 'Отправлено', hint: 'Письмо ушло заказчику' },
    { id: 'received', label: 'Пропуск получен', hint: 'МЛСП/ФСБ → допуск в Дружине' }
  ];

  const APP_STATUS_LABEL = {
    draft: 'Черновик',
    exported: 'Скачан бланк',
    sent: 'Отправлено',
    received: 'Пропуск получен',
    cancelled: 'Отменена'
  };

  let state = {
    tab: 'today',
    pulse: null,
    appType: 'flight',
    contracts: [],
    meta: [],
    selected: [],
    form: {
      contract_number: '',
      curator: '',
      ship_curator: '',
      mvz: '',
      date_from: '',
      date_to: '',
      direction: 'inbound',
      transport: 'plane',
      route_text: '',
      purpose_text: '',
      subject_text: '',
      pass_kind: 'разовый',
      accept_warnings: false
    },
    validation: null,
    peopleQ: '',
    peopleHits: [],
    board: null,
    registry: [],
    apps: [],
    history: [],
    reglament: null,
    draftApp: null,
    preview: null,
    previewBusy: false,
    busy: false,
    searchTimer: null
  };

  function esc(s) {
    return (window.AsgardUI && AsgardUI.esc) ? AsgardUI.esc(s) : String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg, type) {
    if (window.AsgardUI && AsgardUI.toast) AsgardUI.toast(msg, type);
    else console.log(msg);
  }

  function token() {
    return localStorage.getItem('asgard_token') || '';
  }

  async function api(path, opts = {}) {
    const r = await fetch('/api/mlsp-passes' + path, {
      method: opts.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + token(),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = await r.json();
      if (!r.ok) {
        const err = new Error(j.error || 'Ошибка');
        err.status = r.status;
        err.payload = j;
        throw err;
      }
      return j;
    }
    if (!r.ok) throw new Error('Ошибка ' + r.status);
    return r;
  }

  function todayYmd() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function fmtRu(ymdStr) {
    if (!ymdStr) return '';
    const s = String(ymdStr).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    return `${m[3]}.${m[2]}.${m[1]}`;
  }

  function uiConfirm({ title, html, okLabel, danger }) {
    return new Promise((resolve) => {
      if (!window.AsgardUI?.showModal) {
        resolve(false);
        return;
      }
      AsgardUI.showModal({
        title: title || 'Подтверждение',
        subtitle: 'МЛСП · пропуска',
        html: `<div class="mlsp-confirm">
          <div class="mlsp-confirm__body">${html || ''}</div>
          <div class="mlsp-confirm__actions">
            <button type="button" class="btn ghost" data-mlsp-cancel>Отмена</button>
            <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-mlsp-ok>${esc(okLabel || 'Продолжить')}</button>
          </div>
        </div>`,
        onMount: ({ back }) => {
          back.querySelector('[data-mlsp-cancel]')?.addEventListener('click', () => {
            AsgardUI.hideModal(back);
            resolve(false);
          });
          back.querySelector('[data-mlsp-ok]')?.addEventListener('click', () => {
            AsgardUI.hideModal(back);
            resolve(true);
          });
        }
      });
    });
  }

  function uiPrompt({ title, fields, okLabel }) {
    return new Promise((resolve) => {
      if (!window.AsgardUI?.showModal) {
        resolve(null);
        return;
      }
      const fieldsHtml = (fields || []).map((f) => {
        if (f.type === 'select') {
          return `<div class="mlsp-field"><label>${esc(f.label)}</label>
            <select name="${esc(f.name)}">
              ${(f.options || []).map((o) =>
                `<option value="${esc(o)}"${o === f.value ? ' selected' : ''}>${esc(o)}</option>`
              ).join('')}
            </select></div>`;
        }
        return `<div class="mlsp-field"><label>${esc(f.label)}</label>
          <input name="${esc(f.name)}" type="${esc(f.type || 'text')}" value="${esc(f.value || '')}"
            placeholder="${esc(f.placeholder || '')}"/></div>`;
      }).join('');

      AsgardUI.showModal({
        title: title || 'Ввод',
        subtitle: 'МЛСП · пропуска',
        html: `<form class="mlsp-form-modal" data-mlsp-form>
          ${fieldsHtml}
          <div class="mlsp-confirm__actions">
            <button type="button" class="btn ghost" data-mlsp-cancel>Отмена</button>
            <button type="submit" class="btn primary">${esc(okLabel || 'Сохранить')}</button>
          </div>
        </form>`,
        onMount: ({ back }) => {
          const form = back.querySelector('[data-mlsp-form]');
          back.querySelector('[data-mlsp-cancel]')?.addEventListener('click', () => {
            AsgardUI.hideModal(back);
            resolve(null);
          });
          form?.addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const out = {};
            for (const [k, v] of fd.entries()) out[k] = String(v).trim();
            AsgardUI.hideModal(back);
            resolve(out);
          });
        }
      });
    });
  }

  async function loadPulse() {
    state.pulse = await api('/pulse');
  }
  async function loadContracts() {
    const j = await api('/contracts');
    state.meta = j.meta || [];
    state.contracts = j.contracts || [];
    if (!state.form.contract_number && state.meta[0]) {
      applyContract(state.meta[0].contract_number);
    }
  }
  async function loadBoard() {
    state.board = await api('/board?horizon=21');
  }
  async function loadRegistry() {
    const j = await api('/registry');
    state.registry = j.items || [];
  }
  async function loadApps() {
    const j = await api('/applications');
    state.apps = j.items || [];
  }
  async function loadHistory(q) {
    const j = await api('/history' + (q ? ('?q=' + encodeURIComponent(q)) : ''));
    state.history = j.items || [];
  }

  function writesDruzhina(appType) {
    return appType === 'pass_mlsp' || appType === 'pass_fsb';
  }

  async function afterDownloadWizard(app) {
    if (!app?.id || !window.AsgardUI?.showModal) return;
    const isPass = String(app.app_type || '').startsWith('pass_');
    const toDruzhina = writesDruzhina(app.app_type);
    const html = `
      <div class="mlsp-wizard">
        <p class="mlsp-wizard__lead">Скачан <b>один бланк</b> (один лист Excel под печать). Это ещё не «отправлено».</p>
        <ol class="mlsp-wizard__steps">
          <li><b>Распечатайте / приложите к письму</b> — файл уже у вас.</li>
          <li><b>Отметьте «Отправлено»</b>, когда письмо ушло заказчику${app.app_type === 'pass_mlsp' ? ' — сразу запишем исходящий и строку в реестр МЛСП' : ''}.</li>
          <li><b>«Пропуск получен»</b> — когда пропуск выдали.${toDruzhina
            ? ' Допуск появится в карточке сотрудника в Дружине.'
            : ' Статус заявки закроется; при необходимости допуск в Дружине добавьте вручную.'}</li>
        </ol>
        <div class="mlsp-confirm__actions" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn primary" id="mlsp_wiz_sent">Отправлено</button>
          ${isPass ? '<button type="button" class="btn ghost" id="mlsp_wiz_later">Позже · открыть Заявки</button>' : '<button type="button" class="btn ghost" id="mlsp_wiz_later">Понятно</button>'}
        </div>
      </div>`;
    await new Promise((resolve) => {
      AsgardUI.showModal({
        title: 'Что дальше с заявкой #' + app.id,
        subtitle: APP_STATUS_LABEL[app.status] || app.status || 'Скачан бланк',
        html,
        onMount: ({ body, backdrop: back }) => {
          body.querySelector('#mlsp_wiz_later')?.addEventListener('click', () => {
            AsgardUI.hideModal(back);
            state.tab = 'apps';
            resolve();
          });
          body.querySelector('#mlsp_wiz_sent')?.addEventListener('click', async () => {
            try {
              if (app.app_type === 'pass_mlsp') {
                const reg = await api('/applications/' + app.id + '/register-pass', {
                  method: 'POST',
                  body: { responsible_name: 'Хосе' }
                });
                state.draftApp = reg.application || state.draftApp;
                toast('Исх. ' + reg.outgoing + ' · статус «Отправлено»', 'success');
                await loadRegistry();
                await loadPulse();
              } else {
                const j = await api('/applications/' + app.id + '/mark-sent', { method: 'POST', body: {} });
                state.draftApp = j.application || state.draftApp;
                toast('Статус: Отправлено', 'success');
              }
              AsgardUI.hideModal(back);
              await loadApps();
              resolve();
            } catch (e) {
              toast(e.message, 'error');
            }
          });
        }
      });
    });
  }

  async function markAppReceived(app) {
    const ok = await uiConfirm({
      title: 'Пропуск получен?',
      html: writesDruzhina(app.app_type)
        ? `<p>Для <b>${esc(app.app_type_label || app.app_type)}</b> допуски сразу запишутся в Дружину у ${esc(String(app.people_count || (app.people || []).length || '—'))} чел.</p>
           <p class="mlsp-muted">Повторное нажатие обновит действующий допуск того же типа.</p>`
        : `<p>Закроем заявку статусом «Пропуск получен».</p>
           <p class="mlsp-muted">Отдельный тип допуска в Дружине для этого бланка не заведён — при необходимости добавьте вручную в карточке.</p>`,
      okLabel: 'Пропуск получен'
    });
    if (!ok) return null;
    const j = await api('/applications/' + app.id + '/mark-received', { method: 'POST', body: {} });
    toast(j.next_hint || 'Пропуск получен', 'success');
    return j;
  }

  function applyContract(number) {
    state.form.contract_number = number || '';
    const m = (state.meta || []).find((x) => x.contract_number === number);
    if (m) {
      state.form.mvz = m.mvz || state.form.mvz;
      state.form.curator = m.curator || state.form.curator;
      state.form.ship_curator = m.ship_curator || m.curator || state.form.ship_curator;
    }
  }

  function defaultRoute() {
    const d = fmtRu(state.form.date_from || todayYmd());
    if (state.appType === 'ship') {
      return state.form.direction === 'outbound'
        ? `Маршрут: МЛСП - Порт\nДата: ${d} - ${fmtRu(state.form.date_to || state.form.date_from)}`
        : `Маршрут: Порт - МЛСП\nДата: ${d} - ${fmtRu(state.form.date_to || state.form.date_from)}`;
    }
    if (state.form.direction === 'outbound') {
      return `ДАТА: ${d} МЛСП - ВАРАНДЕЙ - АРХАНГЕЛЬСК`;
    }
    return `ДАТА: ${d} АРХАНГЕЛЬСК - ВАРАНДЕЙ - МЛСП`;
  }

  function draftBody() {
    return {
      app_type: state.appType,
      employee_ids: state.selected.map((p) => p.id),
      contract_number: state.form.contract_number,
      curator: state.form.curator,
      ship_curator: state.form.ship_curator,
      mvz: state.form.mvz,
      date_from: state.form.date_from || todayYmd(),
      date_to: state.form.date_to || null,
      direction: state.form.direction,
      transport: state.appType === 'ship' ? 'ship' : (state.form.transport || 'plane'),
      route_text: state.form.route_text || defaultRoute(),
      purpose_text: state.form.purpose_text,
      subject_text: state.form.subject_text,
      pass_kind: state.form.pass_kind,
      accept_warnings: true
    };
  }

  async function runValidate() {
    try {
      const j = await api('/validate', { method: 'POST', body: draftBody() });
      state.validation = j;
    } catch (e) {
      state.validation = { ok: false, blocks: [{ message: e.message }], warnings: [], summary: {} };
    }
  }

  async function refreshPreview() {
    if (!state.selected.length) {
      state.preview = null;
      return;
    }
    state.previewBusy = true;
    try {
      const j = await api('/preview-draft', { method: 'POST', body: draftBody() });
      state.preview = j.sheet;
    } catch (e) {
      state.preview = { sheet: 'Ошибка', rows: [{ cells: [{ v: e.message }] }] };
    } finally {
      state.previewBusy = false;
    }
  }

  async function createAndDownload(opts = {}) {
    if (state.busy) return;
    state.busy = true;
    try {
      await runValidate();
      const v = state.validation || { ok: true, blocks: [], warnings: [] };
      if (!v.ok && !opts.force) {
        toast('Есть блокирующие замечания — исправьте состав', 'error');
        render();
        return;
      }
      if ((v.warnings || []).length && !state.form.accept_warnings && !opts.force) {
        const ok = await uiConfirm({
          title: 'Предупреждения',
          html: `<p>Есть предупреждения: <b>${v.warnings.length}</b>. Выгрузить Excel всё равно?</p>
            <ul class="mlsp-confirm__list">${v.warnings.slice(0, 8).map((w) =>
              `<li>${w.fio ? `<b>${esc(w.fio)}</b> — ` : ''}${esc(w.message)}</li>`
            ).join('')}</ul>`,
          okLabel: 'Выгрузить'
        });
        if (!ok) return;
        state.form.accept_warnings = true;
      }

      const created = await api('/applications', { method: 'POST', body: { ...draftBody(), force: !!opts.force } });
      state.draftApp = created.item;
      const id = created.item.id;
      const forceQ = (!created.validation?.ok || opts.force) ? '?force=1' : '';
      const resp = await fetch('/api/mlsp-passes/applications/' + id + '/excel' + forceQ, {
        headers: { Authorization: 'Bearer ' + token() }
      });
      if (!resp.ok) {
        let j = {};
        try { j = await resp.json(); } catch (parseErr) {
          console.warn('[mlsp] excel error body', parseErr);
        }
        throw Object.assign(new Error(j.error || 'Не удалось скачать'), { payload: j });
      }
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const cd = resp.headers.get('Content-Disposition') || '';
      const m = /filename="([^"]+)"/.exec(cd);
      a.download = m ? m[1] : ((state.appType || 'mlsp') + '_' + (state.form.date_from || todayYmd()) + '.xlsx');
      a.click();
      URL.revokeObjectURL(a.href);

      if (state.appType === 'flight' || state.appType === 'ship') {
        await api('/applications/' + id + '/publish-legs', { method: 'POST', body: {} });
        await loadBoard();
      }
      toast('Бланк скачан · 1 лист', 'success');
      state.draftApp = { ...created.item, status: 'exported' };
      await loadApps();
      await afterDownloadWizard(state.draftApp);
      await refreshPreview();
      render();
    } catch (e) {
      if (e.payload?.blocks) {
        state.validation = e.payload;
        toast(e.message || 'Блок', 'error');
        render();
      } else {
        toast(e.message || 'Ошибка', 'error');
      }
    } finally {
      state.busy = false;
    }
  }

  function kpiHtml() {
    const p = state.pulse || { registry: {}, next_outgoing: '—', legs_next_7d: 0 };
    const r = p.registry || {};
    return `<div class="mlsp-kpi">
      <div class="mlsp-kpi__card is-err"><div class="mlsp-kpi__label">Срыв SLA</div><div class="mlsp-kpi__value">${r.breach || 0}</div></div>
      <div class="mlsp-kpi__card is-warn"><div class="mlsp-kpi__label">Нет подтверждения</div><div class="mlsp-kpi__value">${r.no_confirm || 0}</div></div>
      <div class="mlsp-kpi__card is-info"><div class="mlsp-kpi__label">В работе</div><div class="mlsp-kpi__value">${r.in_work || 0}</div></div>
      <div class="mlsp-kpi__card"><div class="mlsp-kpi__label">Рейсы · 7 дней</div><div class="mlsp-kpi__value">${p.legs_next_7d || 0}</div></div>
      <div class="mlsp-kpi__card is-ok"><div class="mlsp-kpi__label">След. исх.№</div><div class="mlsp-kpi__value mlsp-kpi__value--sm">${esc(p.next_outgoing || '—')}</div></div>
    </div>`;
  }

  function tabsHtml() {
    return `<div class="mlsp-tabs" role="tablist">
      ${TABS.map((t) => `<button type="button" class="mlsp-tab${state.tab === t.id ? ' is-on' : ''}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}
    </div>`;
  }

  function validationHtml() {
    const v = state.validation;
    if (!v) return '';
    const blocks = v.blocks || [];
    const warns = v.warnings || [];
    if (!blocks.length && !warns.length) {
      return `<div class="mlsp-alert mlsp-alert--ok"><h4>Готово к отправке</h4><div>Блоков нет · предупреждений нет</div></div>`;
    }
    let html = '';
    if (blocks.length) {
      html += `<div class="mlsp-alert mlsp-alert--block"><h4>Блок · ${blocks.length}</h4><ul>${
        blocks.map((b) => `<li><b>${esc(b.fio || '')}</b> — ${esc(b.message)}</li>`).join('')
      }</ul></div>`;
    }
    if (warns.length) {
      html += `<div class="mlsp-alert mlsp-alert--warn"><h4>Предупреждения · ${warns.length}</h4><ul>${
        warns.slice(0, 12).map((b) => `<li>${b.fio ? `<b>${esc(b.fio)}</b> — ` : ''}${esc(b.message)}</li>`).join('')
      }</ul></div>`;
    }
    return html;
  }

  function sheetPreviewHtml() {
    const sheet = state.preview;
    if (state.previewBusy) {
      return `<div class="mlsp-sheet mlsp-sheet--loading"><div class="mlsp-sheet__hint">Собираю лист из шаблона…</div></div>`;
    }
    if (!sheet || !sheet.html) {
      return `<div class="mlsp-sheet mlsp-sheet--empty">
        <div class="mlsp-sheet__title">Предпросмотр бланка</div>
        <div class="mlsp-sheet__hint">Выберите сотрудников — здесь тот же лист, что уйдёт в Excel (мерджи и стили шаблона).</div>
      </div>`;
    }
    const orient = sheet.orientation === 'landscape' ? ' landscape' : '';
    return `<div class="mlsp-sheet">
      <div class="mlsp-sheet__bar">
        <div>
          <div class="mlsp-sheet__title">${esc(sheet.sheet || 'Лист')}</div>
          <div class="mlsp-sheet__meta">${esc(sheet.source || 'шаблон')} · ${esc(sheet.orientation || 'portrait')}</div>
        </div>
        <button type="button" class="btn ghost mini" id="mlsp_preview_refresh">Обновить лист</button>
      </div>
      <div class="mlsp-sheet__scroll">
        <div class="mlsp-sheet__paper${orient}">${sheet.html}</div>
      </div>
    </div>`;
  }

  function workflowHtml(activeId) {
    const order = ['collect', 'exported', 'sent', 'received'];
    const cur = order.indexOf(activeId || 'collect');
    return `<div class="mlsp-flow" aria-label="Шаги заявки">
      ${WORKFLOW_STEPS.map((s, i) => {
        const on = i === cur;
        const done = i < cur;
        return `<div class="mlsp-flow__step${on ? ' is-on' : ''}${done ? ' is-done' : ''}">
          <div class="mlsp-flow__num">${i + 1}</div>
          <div>
            <div class="mlsp-flow__label">${esc(s.label)}</div>
            <div class="mlsp-flow__hint">${esc(s.hint)}</div>
          </div>
        </div>`;
      }).join('<div class="mlsp-flow__arrow" aria-hidden="true">→</div>')}
    </div>
    <p class="mlsp-flow__note">Каждое скачивание — <b>отдельный файл с одним листом</b> бланка. Пять человек в одной заявке = один бланк со списком, не пять файлов.</p>`;
  }

  function genHtml() {
    const contractOpts = (state.meta || []).map((m) =>
      `<option value="${esc(m.contract_number)}"${state.form.contract_number === m.contract_number ? ' selected' : ''}>${esc(m.contract_number)}${m.mvz ? ' · МВЗ ' + esc(m.mvz) : ''}</option>`
    ).join('');

    return `<div class="mlsp-panel">${workflowHtml('collect')}</div>
    <div class="mlsp-panel mlsp-panel--types">
      <div class="mlsp-type-grid">
        ${TYPES.map((t) => `<button type="button" class="mlsp-type${state.appType === t.id ? ' is-on' : ''}" data-type="${t.id}">
          <div class="mlsp-type__name">${esc(t.name)}</div>
          <div class="mlsp-type__desc">${esc(t.desc)}</div>
          ${t.draft ? '<div class="mlsp-type__badge">черновик формы</div>' : ''}
        </button>`).join('')}
      </div>
    </div>
    <div class="mlsp-split mlsp-split--gen">
      <div class="mlsp-panel">
        <div class="mlsp-field-row">
          <div class="mlsp-field"><label>Договор ГНШ</label>
            <select id="mlsp_contract"><option value="">— выберите —</option>${contractOpts}</select>
          </div>
          <div class="mlsp-field"><label>МВЗ</label>
            <input id="mlsp_mvz" value="${esc(state.form.mvz || '')}" placeholder="МВЗ"/>
          </div>
        </div>
        <div class="mlsp-field-row">
          <div class="mlsp-field"><label>Куратор</label>
            <input id="mlsp_curator" value="${esc(state.form.curator || '')}"/>
          </div>
          <div class="mlsp-field"><label>Куратор корабля</label>
            <input id="mlsp_ship_curator" value="${esc(state.form.ship_curator || '')}"/>
          </div>
        </div>
        <div class="mlsp-field-row">
          <div class="mlsp-field"><label>Дата с</label>
            <input type="date" id="mlsp_from" value="${esc(state.form.date_from || todayYmd())}"/>
          </div>
          <div class="mlsp-field"><label>Дата по</label>
            <input type="date" id="mlsp_to" value="${esc(state.form.date_to || '')}"/>
          </div>
        </div>
        <div class="mlsp-field-row">
          <div class="mlsp-field"><label>Направление</label>
            <select id="mlsp_dir">
              <option value="inbound"${state.form.direction === 'inbound' ? ' selected' : ''}>Заезжает → МЛСП</option>
              <option value="outbound"${state.form.direction === 'outbound' ? ' selected' : ''}>Съезжает ← МЛСП</option>
              <option value="both"${state.form.direction === 'both' ? ' selected' : ''}>Оба направления</option>
            </select>
          </div>
          <div class="mlsp-field"><label>Транспорт</label>
            <select id="mlsp_tr">
              <option value="plane"${state.form.transport === 'plane' ? ' selected' : ''}>Самолёт</option>
              <option value="helicopter"${state.form.transport === 'helicopter' ? ' selected' : ''}>Вертолёт</option>
              <option value="ship"${state.form.transport === 'ship' ? ' selected' : ''}>Корабль</option>
            </select>
          </div>
        </div>
        ${(state.appType === 'pass_mmrp' || state.appType === 'pass_mlsp')
          ? `<div class="mlsp-field"><label>Тип пропуска</label>
              <select id="mlsp_pass_kind">
                <option value="разовый"${state.form.pass_kind !== 'постоянный' ? ' selected' : ''}>разовый</option>
                <option value="постоянный"${state.form.pass_kind === 'постоянный' ? ' selected' : ''}>постоянный</option>
              </select></div>`
          : ''}
        <div class="mlsp-field"><label>Маршрут / период (как в бланке)</label>
          <textarea id="mlsp_route" rows="2">${esc(state.form.route_text || '')}</textarea>
        </div>
        <div class="mlsp-field"><label>Поиск в Дружине</label>
          <input class="mlsp-search" id="mlsp_people_q" placeholder="ФИО…" value="${esc(state.peopleQ)}"/>
        </div>
        <div class="mlsp-people" id="mlsp_people_hits">
          ${(state.peopleHits || []).map((p) => {
            const on = state.selected.some((s) => s.id === p.id);
            return `<div class="mlsp-person">
              <div>
                <div class="mlsp-person__name">${esc(p.fio)}</div>
                <div class="mlsp-person__meta">${esc(p.position || '')} · ${esc(p.phone || '')}</div>
                <div class="mlsp-chips">
                  ${(p.chip_blocks ? `<span class="mlsp-chip is-err">блок ${p.chip_blocks}</span>` : '<span class="mlsp-chip is-ok">ок</span>')}
                  ${p.chip_warnings ? `<span class="mlsp-chip is-warn">warn ${p.chip_warnings}</span>` : ''}
                </div>
              </div>
              <button type="button" class="btn ${on ? 'ghost' : 'primary'} mini" data-add-person="${p.id}">${on ? 'Убрать' : 'В заявку'}</button>
            </div>`;
          }).join('') || '<div class="mlsp-muted">Начните ввод ФИО</div>'}
        </div>
        <div class="mlsp-selected">
          <div class="mlsp-selected__h">В заявке · ${state.selected.length}</div>
          <div class="mlsp-people mlsp-people--compact">
            ${state.selected.map((p) => `<div class="mlsp-person">
              <div class="mlsp-person__name">${esc(p.fio)}</div>
              <button type="button" class="btn ghost mini" data-rm-person="${p.id}" aria-label="Убрать">×</button>
            </div>`).join('') || '<div class="mlsp-muted">Пусто</div>'}
          </div>
        </div>
        ${validationHtml()}
        <div class="mlsp-toolbar">
          <button type="button" class="btn ghost" id="mlsp_validate">Проверить</button>
          <button type="button" class="btn primary" id="mlsp_download" ${state.busy ? 'disabled' : ''}>
            ${state.busy ? 'Собираю…' : 'Скачать бланк (1 лист)'}
          </button>
        </div>
        <p class="mlsp-muted" style="margin-top:8px">После скачивания предложим отметить «Отправлено». «Пропуск получен» — когда выдали; для МЛСП и ФСБ допуск уйдёт в Дружину.</p>
      </div>
      <div>${sheetPreviewHtml()}</div>
    </div>`;
  }

  function appsHtml() {
    const rows = state.apps || [];
    return `<div class="mlsp-panel">
      ${workflowHtml(rows[0]?.status === 'received' ? 'received' : rows[0]?.status === 'sent' ? 'sent' : rows[0]?.status === 'exported' ? 'exported' : 'collect')}
      <div class="mlsp-section-h" style="margin-top:8px">
        <h2>Мои заявки</h2>
        <button type="button" class="btn ghost mini" id="mlsp_apps_refresh">Обновить</button>
      </div>
      <p class="mlsp-muted">Здесь статусы после скачивания бланка. «Пропуск получен» для МЛСП/ФСБ пишет допуск в карточку сотрудника.</p>
      <div class="mlsp-table-wrap" style="margin-top:12px">
        <table class="mlsp-table">
          <thead><tr>
            <th>#</th><th>Тип</th><th>Дата</th><th>Люди</th><th>Исх.№</th><th>Статус</th><th>Что дальше</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.map((a) => {
              const st = a.status_label || APP_STATUS_LABEL[a.status] || a.status;
              const actions = [];
              if (a.can_mark_sent) {
                actions.push(`<button type="button" class="btn primary mini" data-app-sent="${a.id}">Отправлено</button>`);
              }
              if (a.can_mark_received) {
                actions.push(`<button type="button" class="btn ghost mini" data-app-recv="${a.id}">Пропуск получен</button>`);
              }
              actions.push(`<button type="button" class="btn ghost mini" data-app-dl="${a.id}">Бланк</button>`);
              return `<tr>
                <td>${a.id}</td>
                <td>${esc(a.app_type_label || a.app_type)}</td>
                <td>${fmtRu(a.date_from)}</td>
                <td>${a.people_count ?? (Array.isArray(a.people) ? a.people.length : '—')}</td>
                <td>${esc(a.outgoing_number || '—')}</td>
                <td><span class="mlsp-chip ${a.status === 'received' ? 'is-ok' : a.status === 'sent' ? 'is-info' : ''}">${esc(st)}</span></td>
                <td class="mlsp-muted">${esc(a.next_hint || '')}</td>
                <td><div class="mlsp-row-actions">${actions.join('')}</div></td>
              </tr>`;
            }).join('') || '<tr><td colspan="8" class="mlsp-muted">Пока нет заявок — соберите в генераторе и скачайте бланк</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function boardSection(title, items) {
    if (!items?.length) return '';
    return `<div class="mlsp-board-day">
      <div class="mlsp-board-day__h"><h3>${esc(title)}</h3><span>${items.length} чел.</span></div>
      ${items.map((it) => `<div class="mlsp-leg">
        <div class="mlsp-leg__dir ${it.direction === 'outbound' ? 'is-out' : 'is-in'}">${esc(it.direction_label || it.direction)}</div>
        <div>
          <div class="mlsp-leg__fio">${esc(it.fio)}</div>
          <div class="mlsp-leg__meta">${fmtRu(it.leg_date)} · ${esc(it.transport_label || it.transport || '')} · ${esc(it.route_text || '')}</div>
        </div>
        ${it.employee_id || it.emp_id
          ? `<a class="btn ghost mini" href="#/employee?id=${it.employee_id || it.emp_id}">Карточка</a>`
          : ''}
      </div>`).join('')}
    </div>`;
  }

  function boardHtml() {
    const g = state.board?.groups || { today: [], week: [], later: [] };
    return `<div class="mlsp-panel">
      ${boardSection('Сегодня', g.today)}
      ${boardSection('Ближайшие 7 дней', g.week)}
      ${boardSection('Позже', g.later)}
      ${!(g.today?.length || g.week?.length || g.later?.length)
        ? '<div class="mlsp-muted">Пока нет рейсов в горизонте. Соберите заявку в генераторе и опубликуйте ноги рейса.</div>'
        : ''}
    </div>`;
  }

  function todayHtml() {
    const g = state.board?.groups || {};
    const today = g.today || [];
    const pulse = state.pulse || {};
    return `<div class="mlsp-today">
      <div class="mlsp-panel">
        <div class="mlsp-section-h">
          <h2>На объекте / в пути сегодня</h2>
          <button type="button" class="btn primary mini" data-tab-jump="gen">Новая заявка</button>
        </div>
        ${today.length
          ? today.map((it) => `<div class="mlsp-leg">
              <div class="mlsp-leg__dir ${it.direction === 'outbound' ? 'is-out' : 'is-in'}">${esc(it.direction_label || (it.direction === 'outbound' ? 'съезжает' : 'заезжает'))}</div>
              <div>
                <div class="mlsp-leg__fio">${esc(it.fio)}</div>
                <div class="mlsp-leg__meta">${esc(it.route_text || '')}</div>
              </div>
            </div>`).join('')
          : '<div class="mlsp-muted">На сегодня рейсов нет</div>'}
      </div>
      <div class="mlsp-panel">
        <div class="mlsp-section-h"><h2>Реестр · внимание</h2></div>
        <div class="mlsp-attn">
          <div><b>${(pulse.registry || {}).breach || 0}</b> срыв SLA</div>
          <div><b>${(pulse.registry || {}).no_confirm || 0}</b> без подтверждения</div>
          <div>След. исх. <b>${esc(pulse.next_outgoing || '—')}</b></div>
        </div>
        <button type="button" class="btn ghost" data-tab-jump="registry" style="margin-top:12px">Открыть реестр</button>
      </div>
    </div>`;
  }

  function registryHtml() {
    return `<div class="mlsp-panel">
      <div class="mlsp-toolbar">
        <button type="button" class="btn primary" id="mlsp_reg_add">+ Строка реестра</button>
        <button type="button" class="btn ghost" id="mlsp_reglament">Регламент</button>
      </div>
      <div class="mlsp-table-wrap">
        <table class="mlsp-table">
          <thead><tr>
            <th>№ заявки</th><th>Ответственный</th><th>Договор</th><th>Дата</th><th>План +45</th>
            <th>Куратор</th><th>Статус</th><th>Сигнал</th><th>Комментарий</th>
          </tr></thead>
          <tbody>
            ${(state.registry || []).map((r) => `<tr data-reg="${r.id}">
              <td>${esc(r.request_no || '—')}</td>
              <td>${esc(r.responsible_name || '')}</td>
              <td>${esc(r.contract_number || '')}</td>
              <td>${fmtRu(r.request_date)}</td>
              <td>${fmtRu(r.planned_ready)}</td>
              <td>${esc(r.curator || '')}</td>
              <td><span class="mlsp-chip">${esc(r.status || '')}</span></td>
              <td><span class="mlsp-chip ${r.signal === 'breach' ? 'is-err' : r.signal === 'no_confirm' || r.signal === 'due_soon' ? 'is-warn' : 'is-ok'}">${esc(r.signal_label || r.signal || '')}</span></td>
              <td>${esc(r.comment || '')}</td>
            </tr>`).join('') || '<tr><td colspan="9" class="mlsp-muted">Реестр пуст</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function historyHtml() {
    return `<div class="mlsp-panel">
      <div class="mlsp-toolbar">
        <input id="mlsp_hist_q" class="mlsp-search" placeholder="ФИО / договор / маршрут" style="max-width:280px"/>
        <button type="button" class="btn ghost" id="mlsp_hist_go">Найти</button>
        <button type="button" class="btn primary" id="mlsp_hist_import">Импорт 219 перелётов</button>
      </div>
      <div class="mlsp-table-wrap">
        <table class="mlsp-table">
          <thead><tr><th>Дата</th><th>Направление</th><th>ФИО</th><th>Должность</th><th>Договор</th><th>Куратор</th><th>Маршрут</th></tr></thead>
          <tbody>
            ${(state.history || []).slice(0, 200).map((h) => `<tr>
              <td>${fmtRu(h.leg_date)}</td>
              <td>${esc(h.direction === 'outbound' ? 'с МЛСП' : 'на МЛСП')}</td>
              <td>${esc(h.fio)}</td>
              <td>${esc(h.position || '')}</td>
              <td>${esc(h.contract_number || '')}</td>
              <td>${esc(h.curator || '')}</td>
              <td>${esc(h.route_text || '')}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="mlsp-muted">История пуста — импортируйте выгрузку из Excel</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function baseHtml() {
    return `<div class="mlsp-panel">
      <div class="mlsp-section-h"><h2>Контрагенты и договоры ГНШ</h2></div>
      <p class="mlsp-muted">ИНН сверяются с ЕГРЮЛ через DaData (если задан токен): ГНШ 7725610285 · Снабжение 5501072608 · Аврора 5190087937.</p>
      <div class="mlsp-toolbar" style="margin-top:12px">
        <button type="button" class="btn primary" id="mlsp_ensure_cp">Создать / сверить в CRM</button>
      </div>
      <div class="mlsp-table-wrap" style="margin-top:14px">
        <table class="mlsp-table">
          <thead><tr><th>Договор</th><th>МВЗ</th><th>Куратор</th><th>Куратор корабля</th><th>Окончание</th></tr></thead>
          <tbody>
            ${(state.meta || []).map((m) => `<tr>
              <td>${esc(m.contract_number)}</td>
              <td>${esc(m.mvz || '')}</td>
              <td>${esc(m.curator || '')}</td>
              <td>${esc(m.ship_curator || '')}</td>
              <td>${fmtRu(m.end_date)}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="mlsp-muted">Нет meta — проверьте миграцию V477</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function bodyHtml() {
    switch (state.tab) {
      case 'today': return todayHtml();
      case 'board': return boardHtml();
      case 'gen': return genHtml();
      case 'apps': return appsHtml();
      case 'registry': return registryHtml();
      case 'history': return historyHtml();
      case 'base': return baseHtml();
      default: return '';
    }
  }

  function openRegistryDrawer(row) {
    if (!window.AsgardUI?.showDrawer) {
      toast('Drawer недоступен', 'error');
      return;
    }
    AsgardUI.showDrawer({
      title: 'Строка реестра',
      width: 'wide',
      html: `<div class="mlsp-drawer">
        <div class="mlsp-field"><label>№ заявки у заказчика</label>
          <input id="dr_req" value="${esc(row.request_no || '')}"/></div>
        <div class="mlsp-field"><label>Статус</label>
          <select id="dr_status">${REG_STATUSES.map((s) =>
            `<option value="${esc(s)}"${s === row.status ? ' selected' : ''}>${esc(s)}</option>`
          ).join('')}</select>
          <div class="mlsp-muted" style="margin-top:6px">«Готова» = пропуск получен. Если строка связана с заявкой МЛСП — допуски уйдут в Дружину.</div>
        </div>
        <div class="mlsp-field"><label>Куратор</label>
          <input id="dr_cur" value="${esc(row.curator || '')}"/></div>
        <div class="mlsp-field"><label>Дата подтверждения куратора</label>
          <input type="date" id="dr_conf" value="${esc((row.curator_confirm_date || '').slice(0, 10))}"/></div>
        <div class="mlsp-field"><label>Дата выдачи</label>
          <input type="date" id="dr_iss" value="${esc((row.issued_date || '').slice(0, 10))}"/></div>
        <div class="mlsp-field"><label>Комментарий</label>
          <textarea id="dr_com" rows="3">${esc(row.comment || '')}</textarea></div>
        <div class="mlsp-confirm__actions">
          <button type="button" class="btn primary" id="dr_save">Сохранить</button>
        </div>
      </div>`,
      onMount: ({ body }) => {
        body.querySelector('#dr_save')?.addEventListener('click', async () => {
          try {
            const nextStatus = body.querySelector('#dr_status')?.value;
            const j = await api('/registry/' + row.id, {
              method: 'PATCH',
              body: {
                request_no: body.querySelector('#dr_req')?.value || null,
                status: nextStatus,
                curator: body.querySelector('#dr_cur')?.value || null,
                curator_confirm_date: body.querySelector('#dr_conf')?.value || null,
                issued_date: body.querySelector('#dr_iss')?.value || null,
                comment: body.querySelector('#dr_com')?.value || null
              }
            });
            AsgardUI.hideDrawer();
            await loadRegistry();
            await loadPulse();
            await loadApps();
            render();
            toast(j.next_hint || 'Сохранено', 'success');
          } catch (e) {
            toast(e.message, 'error');
          }
        });
      }
    });
  }

  function bind(root) {
    root.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.tab = btn.getAttribute('data-tab');
        if (state.tab === 'history' && !state.history.length) await loadHistory('');
        if (state.tab === 'apps') await loadApps();
        if (state.tab === 'gen') await refreshPreview();
        render();
      });
    });
    root.querySelectorAll('[data-tab-jump]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.tab = btn.getAttribute('data-tab-jump');
        if (state.tab === 'apps') await loadApps();
        render();
      });
    });

    root.querySelector('#mlsp_apps_refresh')?.addEventListener('click', async () => {
      await loadApps();
      render();
    });

    root.querySelectorAll('[data-app-sent]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-app-sent'));
        const app = state.apps.find((x) => x.id === id);
        if (!app) return;
        try {
          if (app.app_type === 'pass_mlsp' && !app.outgoing_number) {
            const reg = await api('/applications/' + id + '/register-pass', {
              method: 'POST',
              body: { responsible_name: 'Хосе' }
            });
            toast('Исх. ' + reg.outgoing + ' · Отправлено', 'success');
            await loadRegistry();
            await loadPulse();
          } else {
            const j = await api('/applications/' + id + '/mark-sent', { method: 'POST', body: {} });
            toast(j.next_hint || 'Отправлено', 'success');
          }
          await loadApps();
          render();
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    });

    root.querySelectorAll('[data-app-recv]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-app-recv'));
        const app = state.apps.find((x) => x.id === id);
        if (!app) return;
        try {
          const j = await markAppReceived(app);
          if (!j) return;
          await loadApps();
          await loadRegistry();
          await loadPulse();
          render();
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    });

    root.querySelectorAll('[data-app-dl]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-app-dl'));
        try {
          const resp = await fetch('/api/mlsp-passes/applications/' + id + '/excel?force=1', {
            headers: { Authorization: 'Bearer ' + token() }
          });
          if (!resp.ok) throw new Error('Не удалось скачать бланк');
          const blob = await resp.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          const cd = resp.headers.get('Content-Disposition') || '';
          const m = /filename="([^"]+)"/.exec(cd);
          a.download = m ? m[1] : ('mlsp_' + id + '.xlsx');
          a.click();
          URL.revokeObjectURL(a.href);
          toast('Бланк · 1 лист', 'success');
          await loadApps();
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    });

    root.querySelectorAll('[data-type]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        state.appType = btn.getAttribute('data-type');
        state.validation = null;
        await refreshPreview();
        render();
      });
    });

    const syncField = (id, key, cast) => {
      const el = root.querySelector(id);
      if (!el) return;
      el.addEventListener('change', async () => {
        state.form[key] = cast ? cast(el.value) : el.value;
        if (key === 'contract_number') applyContract(el.value);
        await refreshPreview();
        const sheetHost = root.querySelector('.mlsp-sheet')?.parentElement;
        if (sheetHost && state.tab === 'gen') sheetHost.innerHTML = sheetPreviewHtml();
        bindPreviewOnly(root);
      });
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.addEventListener('input', () => {
          state.form[key] = el.value;
        });
      }
    };
    syncField('#mlsp_contract', 'contract_number');
    syncField('#mlsp_mvz', 'mvz');
    syncField('#mlsp_curator', 'curator');
    syncField('#mlsp_ship_curator', 'ship_curator');
    syncField('#mlsp_from', 'date_from');
    syncField('#mlsp_to', 'date_to');
    syncField('#mlsp_dir', 'direction');
    syncField('#mlsp_tr', 'transport');
    syncField('#mlsp_route', 'route_text');
    syncField('#mlsp_pass_kind', 'pass_kind');

    const q = root.querySelector('#mlsp_people_q');
    q?.addEventListener('input', () => {
      state.peopleQ = q.value;
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(async () => {
        if (!state.peopleQ.trim()) {
          state.peopleHits = [];
          render();
          return;
        }
        try {
          const j = await api('/people?q=' + encodeURIComponent(state.peopleQ));
          state.peopleHits = j.items || [];
          render();
        } catch (e) {
          toast(e.message, 'error');
        }
      }, 220);
    });

    root.querySelectorAll('[data-add-person]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-add-person'));
        const hit = state.peopleHits.find((p) => p.id === id);
        if (!hit) return;
        if (state.selected.some((s) => s.id === id)) {
          state.selected = state.selected.filter((s) => s.id !== id);
        } else {
          state.selected = [...state.selected, hit];
        }
        await runValidate();
        await refreshPreview();
        render();
      });
    });
    root.querySelectorAll('[data-rm-person]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-rm-person'));
        state.selected = state.selected.filter((s) => s.id !== id);
        await runValidate();
        await refreshPreview();
        render();
      });
    });

    root.querySelector('#mlsp_validate')?.addEventListener('click', async () => {
      await runValidate();
      await refreshPreview();
      render();
    });
    root.querySelector('#mlsp_download')?.addEventListener('click', () => createAndDownload());
    bindPreviewOnly(root);

    root.querySelector('#mlsp_ensure_cp')?.addEventListener('click', async () => {
      try {
        const j = await api('/ensure-counterparties', { method: 'POST', body: {} });
        toast(`Контрагенты/договоры: +${(j.created?.contracts || []).length} договоров`, 'success');
        await loadContracts();
        render();
      } catch (e) {
        toast(e.message, 'error');
      }
    });

    root.querySelector('#mlsp_hist_go')?.addEventListener('click', async () => {
      const qq = root.querySelector('#mlsp_hist_q')?.value || '';
      await loadHistory(qq);
      render();
    });

    root.querySelector('#mlsp_hist_import')?.addEventListener('click', async () => {
      const ok = await uiConfirm({
        title: 'Импорт истории',
        html: '<p>Загрузить <b>219</b> строк перелётов из выгрузки Excel Хосе в историю рейсов?</p>',
        okLabel: 'Импортировать'
      });
      if (!ok) return;
      try {
        const j = await api('/history/import-seed', { method: 'POST', body: {} });
        if (j.skipped) toast(`Уже в базе: ${j.existing} строк`, 'info');
        else toast(`Импортировано: ${j.inserted}`, 'success');
        await loadHistory('');
        render();
      } catch (e) {
        toast(e.message, 'error');
      }
    });

    root.querySelector('#mlsp_reglament')?.addEventListener('click', async () => {
      try {
        if (!state.reglament) state.reglament = await api('/reglament');
        const r = state.reglament;
        AsgardUI.showModal({
          title: r.title,
          subtitle: 'Регламент',
          html: `${(r.workflow || []).length
            ? `<h4 style="margin:0 0 8px">Как ведём заявку в CRM</h4>
               <ol class="mlsp-reglament">${r.workflow.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
            : ''}
            <h4 style="margin:16px 0 8px">Регламент с заказчиком</h4>
            <ol class="mlsp-reglament">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
            <p class="mlsp-muted" style="margin-top:12px">Реестр: ${esc(r.statuses.join(' / '))}</p>`
        });
      } catch (e) {
        toast(e.message, 'error');
      }
    });

    root.querySelector('#mlsp_reg_add')?.addEventListener('click', async () => {
      const data = await uiPrompt({
        title: 'Новая строка реестра',
        okLabel: 'Добавить',
        fields: [
          { name: 'request_no', label: '№ заявки у заказчика', placeholder: 'например 26/…' },
          { name: 'status', label: 'Статус', type: 'select', options: REG_STATUSES, value: 'Подана' },
          { name: 'request_date', label: 'Дата заявки', type: 'date', value: todayYmd() }
        ]
      });
      if (!data) return;
      try {
        await api('/registry', {
          method: 'POST',
          body: {
            request_no: data.request_no,
            contract_number: state.form.contract_number || state.meta[0]?.contract_number,
            request_date: data.request_date || todayYmd(),
            curator: state.form.curator,
            responsible_name: 'Хосе',
            status: data.status || 'Подана'
          }
        });
        await loadRegistry();
        await loadPulse();
        render();
      } catch (e) {
        toast(e.message, 'error');
      }
    });

    root.querySelectorAll('[data-reg]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const id = Number(tr.getAttribute('data-reg'));
        const row = state.registry.find((x) => x.id === id);
        if (row) openRegistryDrawer(row);
      });
    });
  }

  function bindPreviewOnly(root) {
    root.querySelector('#mlsp_preview_refresh')?.addEventListener('click', async () => {
      await refreshPreview();
      render();
    });
  }

  function render() {
    const root = document.getElementById('mlsp-page');
    if (!root) return;
    root.className = 'mlsp-page';
    root.innerHTML = `
      <div class="mlsp-hero">
        <div>
          <p class="mlsp-hero__eyebrow">Дружина · шельф</p>
          <h1 class="mlsp-hero__title">МЛСП · пропуска и транспорт</h1>
          <p class="mlsp-hero__sub">Бланк = 1 лист Excel · скачал → «Отправлено» → «Пропуск получен» (МЛСП/ФСБ в Дружину). Реестр SLA +45 · люди из Дружины.</p>
        </div>
        <div class="mlsp-hero__actions">
          <button type="button" class="btn ghost" id="mlsp_refresh">Обновить</button>
        </div>
      </div>
      ${kpiHtml()}
      ${tabsHtml()}
      ${bodyHtml()}
    `;
    root.querySelector('#mlsp_refresh')?.addEventListener('click', async () => {
      await bootData();
      if (state.tab === 'gen') await refreshPreview();
      render();
    });
    bind(root);
  }

  async function bootData() {
    if (!state.form.date_from) state.form.date_from = todayYmd();
    await Promise.all([loadPulse(), loadContracts(), loadBoard(), loadRegistry(), loadApps()]);
  }

  async function renderPage({ layout, title }) {
    await layout('<div id="mlsp-page" class="mlsp-page"><div class="loading">Загрузка модуля МЛСП…</div></div>', { title: title || 'МЛСП · пропуска' });
    try {
      await bootData();
      render();
    } catch (e) {
      const el = document.getElementById('mlsp-page');
      if (el) {
        el.className = 'mlsp-page';
        el.innerHTML = `<div class="mlsp-alert mlsp-alert--block"><h4>Не удалось загрузить</h4><div>${esc(e.message)}</div><div class="mlsp-muted" style="margin-top:8px">Проверьте миграцию V477 и перезапуск сервиса.</div></div>`;
      }
    }
  }

  return { render: renderPage };
})();
