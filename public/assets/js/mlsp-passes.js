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
    editingId: null,
    preview: null,
    previewBusy: false,
    previewZoom: null, // null = «по ширине»
    previewZoomPct: 55,
    splitPct: Number(localStorage.getItem('mlsp_split_pct') || 40),
    previewH: localStorage.getItem('mlsp_preview_h') || 'md', // sm|md|lg
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

  function ymdOf(v) {
    if (!v) return '';
    return String(v).slice(0, 10);
  }

  async function startEditApp(id) {
    const app = await api('/applications/' + id);
    if (!app?.can_edit) {
      toast('Эту заявку уже нельзя править', 'error');
      return;
    }
    state.editingId = app.id;
    state.appType = app.app_type;
    state.form = {
      ...state.form,
      contract_number: app.contract_number || '',
      curator: app.curator || '',
      ship_curator: app.ship_curator || '',
      mvz: app.mvz || '',
      date_from: ymdOf(app.date_from) || todayYmd(),
      date_to: ymdOf(app.date_to),
      direction: app.direction || 'inbound',
      transport: app.transport || (app.app_type === 'ship' ? 'ship' : 'plane'),
      route_text: app.route_text || '',
      purpose_text: app.purpose_text || '',
      subject_text: app.subject_text || '',
      pass_kind: app.pass_kind || 'разовый',
      accept_warnings: false
    };
    state.selected = (Array.isArray(app.people) ? app.people : []).map((p) => ({
      id: Number(p.id || p.employee_id),
      fio: p.fio || '',
      phone: p.phone || '',
      position: p.position || '',
      department: p.department || '',
      fsb_doc: p.fsb_doc || '',
      permits_text: p.permits_text || ''
    })).filter((p) => Number.isFinite(p.id) && p.id > 0);
    state.validation = null;
    state.tab = 'gen';
    await refreshPreview();
    toast('Правите заявку #' + app.id + ' — после правок снова скачайте бланк', 'info');
    render();
  }

  function cancelEditApp() {
    state.editingId = null;
    toast('Правка отменена — новая заявка будет создана как обычно', 'info');
    render();
  }

  async function deleteApp(app) {
    if (!app?.can_delete) {
      toast('Удалить может только автор заявки', 'error');
      return;
    }
    const ok = await uiConfirm({
      title: 'Удалить заявку #' + app.id + '?',
      html: `<p>Тип: <b>${esc(app.app_type_label || app.app_type)}</b>, людей: <b>${esc(String(app.people_count || '—'))}</b>.</p>
        <p class="mlsp-muted">Заявка исчезнет из списка. Удалить может только автор.</p>`,
      okLabel: 'Удалить',
      danger: true
    });
    if (!ok) return;
    await api('/applications/' + app.id, { method: 'DELETE' });
    if (state.editingId === app.id) state.editingId = null;
    toast('Заявка #' + app.id + ' удалена', 'success');
    await loadApps();
    await loadPulse();
    render();
  }

  function formatSubjectLine(subject) {
    const s = String(subject || '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    if (/^на оказание\b/i.test(s)) return s;
    return 'на оказание услуг по (' + s + ')';
  }

  function subjectForContract(number) {
    if (!number) return '';
    const m = (state.meta || []).find((x) => x.contract_number === number);
    if (m?.subject_line) return m.subject_line;
    if (m?.subject) return formatSubjectLine(m.subject);
    const c = (state.contracts || []).find((x) => x.number === number)
      || (state.contracts || []).find((x) => String(x.number || '').startsWith(String(number).split(/\s+от\s+/i)[0]));
    return formatSubjectLine(c?.subject || '');
  }

  function applyContract(number) {
    state.form.contract_number = number || '';
    const m = (state.meta || []).find((x) => x.contract_number === number);
    if (m) {
      state.form.mvz = m.mvz || '';
      state.form.curator = m.curator || '';
      state.form.ship_curator = m.ship_curator || m.curator || '';
    }
    // Предмет услуги всегда от выбранного договора (не оставляем текст прошлого)
    state.form.subject_text = subjectForContract(number);
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
    if (!state.selected.length) {
      toast('Добавьте хотя бы одного человека в заявку', 'error');
      return;
    }
    state.busy = true;
    try {
      await runValidate();
      const v = state.validation || { ok: true, blocks: [], warnings: [] };
      // Допуски/паспорт — только WARN: Excel всегда можно; спросим, если есть замечания
      if ((v.warnings || []).length && !state.form.accept_warnings && !opts.force) {
        const ok = await uiConfirm({
          title: 'Замечания · скачать всё равно?',
          html: `<p>Есть замечания: <b>${v.warnings.length}</b>. Бланк всё равно соберём — это не блок.</p>
            <ul class="mlsp-confirm__list">${v.warnings.slice(0, 10).map((w) =>
              `<li>${w.fio ? `<b>${esc(w.fio)}</b> — ` : ''}${esc(w.message)}</li>`
            ).join('')}</ul>`,
          okLabel: 'Скачать бланк'
        });
        if (!ok) return;
        state.form.accept_warnings = true;
      }

      const payload = { ...draftBody(), force: true, accept_warnings: true };
      let item;
      if (state.editingId) {
        const patched = await api('/applications/' + state.editingId, {
          method: 'PATCH',
          body: payload
        });
        item = patched.item;
      } else {
        const created = await api('/applications', { method: 'POST', body: payload });
        item = created.item;
      }
      state.draftApp = item;
      const id = item.id;
      const resp = await fetch('/api/mlsp-passes/applications/' + id + '/excel', {
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
      toast(state.editingId ? ('Заявка #' + id + ' обновлена · бланк скачан') : 'Бланк скачан · 1 лист', 'success');
      state.draftApp = { ...item, status: item.status === 'draft' ? 'exported' : item.status };
      state.editingId = null;
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
    const warns = v.warnings || [];
    if (!warns.length) {
      return `<div class="mlsp-alert mlsp-alert--ok"><h4>Готово к скачиванию</h4><div>Замечаний нет · бланк можно скачать</div></div>`;
    }
    return `<div class="mlsp-alert mlsp-alert--warn"><h4>Замечания · ${warns.length}</h4>
      <div class="mlsp-muted" style="margin-bottom:8px">Не мешают скачать бланк. Допуски сверяются с Дружиной.</div>
      <ul>${warns.slice(0, 16).map((b) =>
        `<li>${b.fio ? `<b>${esc(b.fio)}</b> — ` : ''}${esc(b.message)}</li>`
      ).join('')}</ul></div>`;
  }

  function peopleHitsHtml() {
    return (state.peopleHits || []).map((p) => {
      const on = state.selected.some((s) => s.id === p.id);
      const warns = p.chip_warnings || (p.warnings || []).length || 0;
      return `<div class="mlsp-person" data-hit-row="${p.id}">
        <div>
          <div class="mlsp-person__name">${esc(p.fio)}</div>
          <div class="mlsp-person__meta">${esc(p.position || '')} · ${esc(p.phone || '')}</div>
          <div class="mlsp-chips">
            ${warns ? `<span class="mlsp-chip is-warn">замечаний ${warns}</span>` : '<span class="mlsp-chip is-ok">ок</span>'}
          </div>
        </div>
        <button type="button" class="btn ${on ? 'ghost' : 'primary'} mini" data-add-person="${p.id}">${on ? 'Убрать' : 'В заявку'}</button>
      </div>`;
    }).join('') || '<div class="mlsp-muted">Начните ввод ФИО</div>';
  }

  function selectedHtml() {
    return `<div class="mlsp-selected__h">В заявке · ${state.selected.length}
      ${state.selected.length ? '<button type="button" class="btn ghost mini" id="mlsp_clear_people">Очистить</button>' : ''}
    </div>
    <div class="mlsp-people mlsp-people--compact">
      ${state.selected.map((p) => `<div class="mlsp-person">
        <div>
          <div class="mlsp-person__name">${esc(p.fio)}</div>
          <div class="mlsp-person__meta">${esc(p.position || '')}</div>
        </div>
        <button type="button" class="btn ghost mini" data-rm-person="${p.id}">Убрать</button>
      </div>`).join('') || '<div class="mlsp-muted">Пусто — найдите ФИО выше и нажмите «В заявку»</div>'}
    </div>`;
  }

  function paintPeoplePanel(root) {
    const hits = root.querySelector('#mlsp_people_hits');
    if (hits) hits.innerHTML = peopleHitsHtml();
    const sel = root.querySelector('#mlsp_selected_box');
    if (sel) sel.innerHTML = selectedHtml();
    const val = root.querySelector('#mlsp_validation_box');
    if (val) val.innerHTML = validationHtml();
    bindPeopleActions(root);
  }

  function previewZoomLabel() {
    if (state.previewZoom == null) return 'по ширине';
    return Math.round(state.previewZoom * 100) + '%';
  }

  function sheetPreviewHtml() {
    const sheet = state.preview;
    if (state.previewBusy) {
      return `<div class="mlsp-sheet mlsp-sheet--loading"><div class="mlsp-sheet__hint">Собираю лист из шаблона…</div></div>`;
    }
    if (!sheet || !sheet.html) {
      return `<div class="mlsp-sheet mlsp-sheet--empty">
        <div class="mlsp-sheet__title">Предпросмотр бланка</div>
        <div class="mlsp-sheet__hint">Выберите сотрудников — здесь тот же лист, что уйдёт в Excel. Масштаб и размер окна — справа сверху.</div>
      </div>`;
    }
    const orient = sheet.orientation === 'landscape' ? ' landscape' : '';
    const hClass = state.previewH === 'sm' ? ' is-h-sm' : state.previewH === 'lg' ? ' is-h-lg' : ' is-h-md';
    return `<div class="mlsp-sheet${hClass}" id="mlsp_sheet_root">
      <div class="mlsp-sheet__bar">
        <div class="mlsp-sheet__bar-main">
          <div class="mlsp-sheet__title">${esc(sheet.sheet || 'Лист')}</div>
          <div class="mlsp-sheet__meta">${esc(sheet.source || 'шаблон')} · ${esc(sheet.orientation || 'portrait')}</div>
        </div>
        <div class="mlsp-sheet__tools" role="toolbar" aria-label="Масштаб превью">
          <button type="button" class="mlsp-zbtn" id="mlsp_z_out" title="Уменьшить">−</button>
          <button type="button" class="mlsp-zbtn mlsp-zbtn--label" id="mlsp_z_label" title="Сброс / по ширине">${esc(previewZoomLabel())}</button>
          <button type="button" class="mlsp-zbtn" id="mlsp_z_in" title="Увеличить">+</button>
          <span class="mlsp-sheet__tools-sep" aria-hidden="true"></span>
          <button type="button" class="mlsp-zbtn" id="mlsp_z_fit" title="Вписать по ширине">↔</button>
          <button type="button" class="mlsp-zbtn" id="mlsp_z_100" title="100%">1:1</button>
          <span class="mlsp-sheet__tools-sep" aria-hidden="true"></span>
          <button type="button" class="mlsp-zbtn" id="mlsp_h_cycle" title="Высота окна превью">${state.previewH === 'sm' ? 'низк.' : state.previewH === 'lg' ? 'высок.' : 'средн.'}</button>
          <button type="button" class="btn ghost mini" id="mlsp_preview_refresh">Обновить</button>
        </div>
      </div>
      <div class="mlsp-sheet__hint-bar">Тяните лист мышью · Ctrl + колёсико — масштаб · ручка слева меняет ширину колонки</div>
      <div class="mlsp-sheet__viewport" id="mlsp_sheet_viewport">
        <div class="mlsp-sheet__scaler" id="mlsp_sheet_scaler">
          <div class="mlsp-sheet__paper${orient}" id="mlsp_sheet_paper">${sheet.html}</div>
        </div>
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
    const editBanner = state.editingId
      ? `<div class="mlsp-edit-banner">
          <div>Правите заявку <b>#${state.editingId}</b> — люди, даты, договор. После правок снова нажмите «Скачать бланк».</div>
          <button type="button" class="btn ghost mini" id="mlsp_edit_cancel">Отменить правку</button>
        </div>`
      : '';

    return `<div class="mlsp-panel">${workflowHtml('collect')}</div>
    ${editBanner}
    <div class="mlsp-panel mlsp-panel--types">
      <div class="mlsp-type-grid">
        ${TYPES.map((t) => `<button type="button" class="mlsp-type${state.appType === t.id ? ' is-on' : ''}" data-type="${t.id}">
          <div class="mlsp-type__name">${esc(t.name)}</div>
          <div class="mlsp-type__desc">${esc(t.desc)}</div>
          ${t.draft ? '<div class="mlsp-type__badge">черновик формы</div>' : ''}
        </button>`).join('')}
      </div>
    </div>
    <div class="mlsp-split mlsp-split--gen" id="mlsp_split" style="--mlsp-split:${Math.max(28, Math.min(58, state.splitPct))}%">
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
          <input class="mlsp-search" id="mlsp_people_q" placeholder="ФИО…" value="${esc(state.peopleQ)}" autocomplete="off"/>
        </div>
        <div class="mlsp-people" id="mlsp_people_hits">${peopleHitsHtml()}</div>
        <div class="mlsp-selected" id="mlsp_selected_box">${selectedHtml()}</div>
        <div id="mlsp_validation_box">${validationHtml()}</div>
        <div class="mlsp-toolbar">
          <button type="button" class="btn ghost" id="mlsp_validate">Проверить</button>
          <button type="button" class="btn primary" id="mlsp_download" ${state.busy ? 'disabled' : ''}>
            ${state.busy
              ? 'Собираю…'
              : (state.editingId ? ('Сохранить #' + state.editingId + ' и скачать') : 'Скачать бланк (1 лист)')}
          </button>
        </div>
        <p class="mlsp-muted" style="margin-top:8px">Замечания по допускам не мешают скачать. После скачивания — «Отправлено» → «Пропуск получен».</p>
      </div>
      <div class="mlsp-split__grip" id="mlsp_split_grip" title="Потяните — ширина формы / превью" role="separator" aria-orientation="vertical" tabindex="0"></div>
      <div class="mlsp-preview-host" id="mlsp_preview_host">${sheetPreviewHtml()}</div>
    </div>`;
  }

  function appActionsMenu(a) {
    const items = [];
    if (a.can_edit) {
      items.push(`<button type="button" class="mlsp-menu__item" data-app-edit="${a.id}">Изменить</button>`);
    }
    if (a.can_mark_received) {
      items.push(`<button type="button" class="mlsp-menu__item" data-app-recv="${a.id}">Пропуск получен</button>`);
    }
    items.push(`<button type="button" class="mlsp-menu__item" data-app-dl="${a.id}">Скачать бланк</button>`);
    if (a.can_delete) {
      items.push(`<button type="button" class="mlsp-menu__item is-danger" data-app-del="${a.id}">Удалить</button>`);
    } else if (!a.is_mine) {
      items.push(`<div class="mlsp-menu__hint">Удалить может только автор</div>`);
    }
    return `<details class="mlsp-menu">
      <summary class="btn ghost mini" title="Что сделать с заявкой">⋯</summary>
      <div class="mlsp-menu__panel" role="menu">${items.join('')}</div>
    </details>`;
  }

  function appsHtml() {
    const rows = state.apps || [];
    return `<div class="mlsp-panel">
      ${workflowHtml(rows[0]?.status === 'received' ? 'received' : rows[0]?.status === 'sent' ? 'sent' : rows[0]?.status === 'exported' ? 'exported' : 'collect')}
      <div class="mlsp-section-h" style="margin-top:8px">
        <h2>Мои заявки</h2>
        <button type="button" class="btn ghost mini" id="mlsp_apps_refresh">Обновить</button>
      </div>
      <p class="mlsp-muted">Здесь статусы после скачивания бланка. «Пропуск получен» для МЛСП/ФСБ пишет допуск в карточку сотрудника. Изменить может любой, удалить — только автор заявки.</p>
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
              actions.push(appActionsMenu(a));
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
      <p class="mlsp-muted">ИНН: ГНШ 7725610285 · Снабжение 5501072608 · Аврора 5190087937. Клик по строке — править МВЗ / куратора / <b>предмет услуги</b> / дату окончания (нужна для пропуска МЛСП).</p>
      <div class="mlsp-toolbar" style="margin-top:12px">
        <button type="button" class="btn primary" id="mlsp_ensure_cp">Создать / сверить в CRM</button>
      </div>
      <div class="mlsp-table-wrap" style="margin-top:14px">
        <table class="mlsp-table">
          <thead><tr><th>Договор</th><th>МВЗ</th><th>Услуга / предмет</th><th>Куратор</th><th>Окончание</th><th></th></tr></thead>
          <tbody>
            ${(state.meta || []).map((m) => `<tr data-meta="${m.id}" class="mlsp-row-click">
              <td>${esc(m.contract_number)}</td>
              <td>${esc(m.mvz || '—')}</td>
              <td class="mlsp-muted">${esc(m.subject || '—')}</td>
              <td>${esc(m.curator || '')}</td>
              <td>${m.end_date ? fmtRu(m.end_date) : '<span class="mlsp-chip is-warn">нет даты</span>'}</td>
              <td><button type="button" class="btn ghost mini" data-meta-edit="${m.id}">Править</button></td>
            </tr>`).join('') || '<tr><td colspan="6" class="mlsp-muted">Нет meta — проверьте миграцию V477</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function openMetaEditor(row) {
    if (!window.AsgardUI?.showDrawer) {
      toast('Drawer недоступен', 'error');
      return;
    }
    const end = (row.end_date || '').toString().slice(0, 10);
    AsgardUI.showDrawer({
      title: 'Договор ГНШ',
      width: 'normal',
      html: `<div class="mlsp-drawer">
        <div class="mlsp-drawer__summary">
          <div>
            <div class="mlsp-drawer__summary-kicker">Договор</div>
            <div class="mlsp-drawer__summary-title">${esc(row.contract_number || 'без номера')}</div>
            <div class="mlsp-drawer__summary-sub">${end ? 'Окончание ' + fmtRu(end) : 'Дата окончания не указана'}</div>
          </div>
          <span class="mlsp-chip ${end ? 'is-ok' : 'is-warn'}">${end ? 'дата есть' : 'нет даты'}</span>
        </div>
        <div class="mlsp-field"><label>Номер договора</label>
          <input id="meta_num" value="${esc(row.contract_number || '')}"/></div>
        <div class="mlsp-drawer__grid">
          <div class="mlsp-field"><label>МВЗ</label>
            <input id="meta_mvz" value="${esc(row.mvz || '')}"/></div>
          <div class="mlsp-field"><label>Окончание</label>
            <input type="date" id="meta_end" value="${esc(end)}"/></div>
        </div>
        <div class="mlsp-drawer__grid">
          <div class="mlsp-field"><label>Куратор</label>
            <input id="meta_cur" value="${esc(row.curator || '')}"/></div>
          <div class="mlsp-field"><label>Куратор корабля</label>
            <input id="meta_ship" value="${esc(row.ship_curator || '')}"/></div>
        </div>
        <div class="mlsp-field"><label>Наименование услуги / предмет договора</label>
          <textarea id="meta_subject" rows="3" placeholder="Напр.: СМР по замене оголовка факельного совмещённого (ОФС) на МЛСП «Приразломная»">${esc(row.subject || '')}</textarea></div>
        <div class="mlsp-drawer__hint">Предмет подставится в строку A11 бланка МЛСП при выборе этого договора. Дату окончания ждёт предупреждение в пропуске.</div>
        <div class="mlsp-drawer__foot">
          <button type="button" class="btn ghost" id="meta_cancel">Отмена</button>
          <button type="button" class="btn primary" id="meta_save">Сохранить</button>
        </div>
      </div>`,
      onMount: ({ body }) => {
        body.querySelector('#meta_cancel')?.addEventListener('click', () => AsgardUI.hideDrawer());
        body.querySelector('#meta_save')?.addEventListener('click', async () => {
          try {
            await api('/contracts/meta/' + row.id, {
              method: 'PATCH',
              body: {
                contract_number: body.querySelector('#meta_num')?.value || null,
                mvz: body.querySelector('#meta_mvz')?.value || null,
                curator: body.querySelector('#meta_cur')?.value || null,
                ship_curator: body.querySelector('#meta_ship')?.value || null,
                end_date: body.querySelector('#meta_end')?.value || null,
                subject: body.querySelector('#meta_subject')?.value || null
              }
            });
            AsgardUI.hideDrawer();
            await loadContracts();
            if (state.form.contract_number) applyContract(state.form.contract_number);
            render();
            toast('Договор сохранён', 'success');
          } catch (e) {
            toast(e.message, 'error');
          }
        });
      }
    });
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
    const sigClass = row.signal === 'breach' ? 'is-err'
      : (row.signal === 'no_confirm' || row.signal === 'due_soon') ? 'is-warn' : 'is-ok';
    AsgardUI.showDrawer({
      title: 'Строка реестра',
      width: 'normal',
      html: `<div class="mlsp-drawer">
        <div class="mlsp-drawer__summary">
          <div>
            <div class="mlsp-drawer__summary-kicker">Заявка у заказчика</div>
            <div class="mlsp-drawer__summary-title">№ ${esc(row.request_no || '—')}</div>
            <div class="mlsp-drawer__summary-sub">${esc(row.curator || 'Куратор не указан')}${row.planned_ready ? ' · план ' + fmtRu(row.planned_ready) : ''}</div>
          </div>
          <span class="mlsp-chip ${sigClass}">${esc(row.signal_label || row.status || '')}</span>
        </div>
        <div class="mlsp-drawer__grid">
          <div class="mlsp-field"><label>№ заявки</label>
            <input id="dr_req" value="${esc(row.request_no || '')}"/></div>
          <div class="mlsp-field"><label>Статус</label>
            <select id="dr_status">${REG_STATUSES.map((s) =>
              `<option value="${esc(s)}"${s === row.status ? ' selected' : ''}>${esc(s)}</option>`
            ).join('')}</select></div>
        </div>
        <div class="mlsp-drawer__hint">«Готова» = пропуск получен. Если строка связана с заявкой МЛСП — допуски уйдут в Дружину.</div>
        <div class="mlsp-field"><label>Куратор</label>
          <input id="dr_cur" value="${esc(row.curator || '')}"/></div>
        <div class="mlsp-drawer__grid">
          <div class="mlsp-field"><label>Подтверждение куратора</label>
            <input type="date" id="dr_conf" value="${esc((row.curator_confirm_date || '').slice(0, 10))}"/></div>
          <div class="mlsp-field"><label>Дата выдачи</label>
            <input type="date" id="dr_iss" value="${esc((row.issued_date || '').slice(0, 10))}"/></div>
        </div>
        <div class="mlsp-field"><label>Комментарий</label>
          <textarea id="dr_com" rows="4">${esc(row.comment || '')}</textarea></div>
        <div class="mlsp-drawer__foot">
          <button type="button" class="btn ghost" id="dr_cancel">Отмена</button>
          <button type="button" class="btn primary" id="dr_save">Сохранить</button>
        </div>
      </div>`,
      onMount: ({ body }) => {
        body.querySelector('#dr_cancel')?.addEventListener('click', () => AsgardUI.hideDrawer());
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

    root.querySelectorAll('[data-app-edit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-app-edit'));
        try {
          await startEditApp(id);
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    });

    root.querySelectorAll('[data-app-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-app-del'));
        const app = state.apps.find((x) => x.id === id);
        if (!app) return;
        try {
          await deleteApp(app);
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    });

    root.querySelector('#mlsp_edit_cancel')?.addEventListener('click', () => cancelEditApp());

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
        if (state.tab === 'gen') repaintPreview(root);
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
        const needle = state.peopleQ.trim();
        if (!needle) {
          state.peopleHits = [];
          paintPeoplePanel(root);
          return;
        }
        try {
          const j = await api('/people?q=' + encodeURIComponent(needle));
          // игнор устаревшего ответа, если уже набрали дальше
          if (state.peopleQ.trim() !== needle) return;
          state.peopleHits = j.items || [];
          paintPeoplePanel(root);
          // фокус остаётся в поле — DOM поиска не трогаем целиком
          const qEl = root.querySelector('#mlsp_people_q');
          if (qEl && document.activeElement !== qEl) {
            qEl.focus();
            try { qEl.setSelectionRange(qEl.value.length, qEl.value.length); } catch (_) { /* ignore */ }
          }
        } catch (e) {
          toast(e.message, 'error');
        }
      }, 280);
    });

    bindPeopleActions(root);

    root.querySelector('#mlsp_validate')?.addEventListener('click', async () => {
      await runValidate();
      await refreshPreview();
      paintPeoplePanel(root);
      repaintPreview(root);
    });
    root.querySelector('#mlsp_download')?.addEventListener('click', () => createAndDownload());
    bindPreviewChrome(root);

    root.querySelectorAll('[data-meta-edit]').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = Number(btn.getAttribute('data-meta-edit'));
        const row = (state.meta || []).find((x) => x.id === id);
        if (row) openMetaEditor(row);
      });
    });
    root.querySelectorAll('[data-meta]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const id = Number(tr.getAttribute('data-meta'));
        const row = (state.meta || []).find((x) => x.id === id);
        if (row) openMetaEditor(row);
      });
    });

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

  function bindPeopleActions(root) {
    root.querySelectorAll('[data-add-person]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = Number(btn.getAttribute('data-add-person'));
        const hit = state.peopleHits.find((p) => p.id === id);
        if (!hit) return;
        if (state.selected.some((s) => s.id === id)) {
          state.selected = state.selected.filter((s) => s.id !== id);
        } else {
          state.selected = [...state.selected, hit];
        }
        state.form.accept_warnings = false;
        await runValidate();
        paintPeoplePanel(root);
        await refreshPreview();
        repaintPreview(root);
      });
    });
    root.querySelectorAll('[data-rm-person]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const id = Number(btn.getAttribute('data-rm-person'));
        state.selected = state.selected.filter((s) => s.id !== id);
        state.form.accept_warnings = false;
        await runValidate();
        paintPeoplePanel(root);
        await refreshPreview();
        repaintPreview(root);
      });
    });
    root.querySelector('#mlsp_clear_people')?.addEventListener('click', async () => {
      state.selected = [];
      state.validation = null;
      state.form.accept_warnings = false;
      paintPeoplePanel(root);
      state.preview = null;
      repaintPreview(root);
    });
  }

  function previewHost(root) {
    return root.querySelector('#mlsp_preview_host')
      || root.querySelector('.mlsp-sheet')?.parentElement;
  }

  function repaintPreview(root) {
    const host = previewHost(root);
    if (!host) return false;
    host.innerHTML = sheetPreviewHtml();
    bindPreviewChrome(root);
    return true;
  }

  function applyPreviewZoom(root) {
    const viewport = root.querySelector('#mlsp_sheet_viewport');
    const scaler = root.querySelector('#mlsp_sheet_scaler');
    const paper = root.querySelector('#mlsp_sheet_paper');
    const label = root.querySelector('#mlsp_z_label');
    if (!viewport || !scaler || !paper) return;

    paper.style.transform = 'none';
    scaler.style.width = 'max-content';
    scaler.style.height = 'auto';
    const natW = Math.max(paper.scrollWidth, paper.offsetWidth, 320);
    const natH = Math.max(paper.scrollHeight, paper.offsetHeight, 200);
    const fit = Math.max(0.28, Math.min(1.0, (viewport.clientWidth - 36) / natW));
    const z = state.previewZoom == null ? fit : state.previewZoom;
    state.previewZoomPct = Math.round(z * 100);

    // спейсер = визуальный размер; сам лист масштабируем transform'ом
    scaler.style.width = Math.round(natW * z) + 'px';
    scaler.style.height = Math.round(natH * z) + 'px';
    paper.style.width = natW + 'px';
    paper.style.transformOrigin = 'top left';
    paper.style.transform = `scale(${z})`;

    if (label) {
      label.textContent = state.previewZoom == null
        ? `по ширине · ${state.previewZoomPct}%`
        : `${state.previewZoomPct}%`;
    }
  }

  function bindSplitGrip(root) {
    const split = root.querySelector('#mlsp_split');
    const grip = root.querySelector('#mlsp_split_grip');
    if (!split || !grip || grip.dataset.bound) return;
    grip.dataset.bound = '1';
    let dragging = false;
    const onMove = (ev) => {
      if (!dragging) return;
      const rect = split.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      state.splitPct = Math.max(28, Math.min(58, pct));
      split.style.setProperty('--mlsp-split', state.splitPct + '%');
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('mlsp-resizing');
      try { localStorage.setItem('mlsp_split_pct', String(Math.round(state.splitPct))); } catch (_) { /* ignore */ }
      applyPreviewZoom(root);
    };
    grip.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      dragging = true;
      document.body.classList.add('mlsp-resizing');
    });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function bindPreviewChrome(root) {
    bindSplitGrip(root);

    const bumpZoom = (next) => {
      state.previewZoom = Math.max(0.25, Math.min(1.6, next));
      applyPreviewZoom(root);
    };

    root.querySelector('#mlsp_z_in')?.addEventListener('click', () => {
      const cur = (state.previewZoom == null ? state.previewZoomPct / 100 : state.previewZoom) || 0.55;
      bumpZoom(cur + 0.1);
    });
    root.querySelector('#mlsp_z_out')?.addEventListener('click', () => {
      const cur = (state.previewZoom == null ? state.previewZoomPct / 100 : state.previewZoom) || 0.55;
      bumpZoom(cur - 0.1);
    });
    root.querySelector('#mlsp_z_fit')?.addEventListener('click', () => {
      state.previewZoom = null;
      applyPreviewZoom(root);
    });
    root.querySelector('#mlsp_z_100')?.addEventListener('click', () => bumpZoom(1));
    root.querySelector('#mlsp_z_label')?.addEventListener('click', () => {
      state.previewZoom = null;
      applyPreviewZoom(root);
    });
    root.querySelector('#mlsp_h_cycle')?.addEventListener('click', () => {
      state.previewH = state.previewH === 'sm' ? 'md' : state.previewH === 'md' ? 'lg' : 'sm';
      try { localStorage.setItem('mlsp_preview_h', state.previewH); } catch (_) { /* ignore */ }
      repaintPreview(root);
    });

    root.querySelector('#mlsp_preview_refresh')?.addEventListener('click', async () => {
      await refreshPreview();
      if (!repaintPreview(root)) render();
    });

    const viewport = root.querySelector('#mlsp_sheet_viewport');
    if (viewport) {
      if (state._panAbort) {
        try { state._panAbort.abort(); } catch (_) { /* ignore */ }
      }
      const ac = new AbortController();
      state._panAbort = ac;
      const sig = { signal: ac.signal };
      let pan = false;
      let sx = 0;
      let sy = 0;
      let sl = 0;
      let st = 0;
      viewport.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        if (ev.target.closest('button, a, input, select, textarea')) return;
        pan = true;
        viewport.classList.add('is-panning');
        sx = ev.clientX;
        sy = ev.clientY;
        sl = viewport.scrollLeft;
        st = viewport.scrollTop;
        ev.preventDefault();
      }, sig);
      window.addEventListener('mousemove', (ev) => {
        if (!pan) return;
        viewport.scrollLeft = sl - (ev.clientX - sx);
        viewport.scrollTop = st - (ev.clientY - sy);
      }, sig);
      window.addEventListener('mouseup', () => {
        pan = false;
        viewport.classList.remove('is-panning');
      }, sig);
      viewport.addEventListener('wheel', (ev) => {
        if (!(ev.ctrlKey || ev.metaKey)) return;
        ev.preventDefault();
        const cur = (state.previewZoom == null ? state.previewZoomPct / 100 : state.previewZoom) || 0.55;
        state.previewZoom = Math.max(0.25, Math.min(1.6, cur + (ev.deltaY < 0 ? 0.08 : -0.08)));
        applyPreviewZoom(root);
      }, { passive: false, signal: ac.signal });
    }

    requestAnimationFrame(() => applyPreviewZoom(root));
  }

  function bindPreviewOnly(root) {
    bindPreviewChrome(root);
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
