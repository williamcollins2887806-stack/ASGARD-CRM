/**
 * ASGARD CRM — МЛСП · пропуска и транспорт
 * #/mlsp-passes
 */
window.AsgardMlspPassesPage = (function () {
  const TYPES = [
    { id: 'flight', name: 'Перелёт', desc: 'Авиазаявка ГПН-Снабжение · Архангельск–Варандей–МЛСП' },
    { id: 'ship', name: 'Корабль', desc: 'Список пассажиров МЛСП ↔ порт' },
    { id: 'pass_35srz', name: 'Пропуск 35 СРЗ', desc: 'Проход и проезд на территорию СРЗ' },
    { id: 'pass_mmrp', name: 'Пропуск ММРП', desc: 'Порт / пункт пропуска · Аврора Логистика' },
    { id: 'pass_mlsp', name: 'Пропуск МЛСП', desc: 'Приразломная · исходящий 141603/NN' },
    { id: 'pass_fsb', name: 'Пропуск ФСБ', desc: 'Погранзона Варандей · черновик пр. 102', draft: true }
  ];

  const TABS = [
    { id: 'today', label: 'Сегодня' },
    { id: 'board', label: 'Сводка' },
    { id: 'gen', label: 'Генератор' },
    { id: 'registry', label: 'Реестр МЛСП' },
    { id: 'history', label: 'История' },
    { id: 'base', label: 'База' }
  ];

  let state = {
    tab: 'today',
    pulse: null,
    appType: 'flight',
    contracts: [],
    meta: [],
    selected: [], // employee objects
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
      pass_kind: '',
      accept_warnings: false
    },
    validation: null,
    peopleQ: '',
    peopleHits: [],
    board: null,
    registry: [],
    history: [],
    reglament: null,
    draftApp: null,
    busy: false
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

  function addDaysYmd(ymd, n) {
    const d = new Date(ymd + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function fmtRu(ymd) {
    if (!ymd) return '—';
    const s = String(ymd).slice(0, 10);
    if (s.length < 10) return s;
    return s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4);
  }

  function metaByNumber(num) {
    return (state.meta || []).find((m) => m.contract_number === num) || null;
  }

  function applyContract(num) {
    state.form.contract_number = num || '';
    const m = metaByNumber(num);
    if (m) {
      state.form.curator = m.curator || state.form.curator;
      state.form.ship_curator = m.ship_curator || state.form.ship_curator;
      state.form.mvz = m.mvz || state.form.mvz;
      if (m.end_date && !state.form.date_to) {
        state.form.date_to = String(m.end_date).slice(0, 10);
      }
    }
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
    const from = todayYmd();
    const to = addDaysYmd(from, 45);
    state.board = await api('/board?from=' + from + '&to=' + to);
  }

  async function loadRegistry() {
    const j = await api('/registry');
    state.registry = j.items || [];
  }

  async function loadHistory(q) {
    const j = await api('/history' + (q ? ('?q=' + encodeURIComponent(q)) : ''));
    state.history = j.items || [];
  }

  async function searchPeople(q) {
    state.peopleQ = q;
    const j = await api('/people?q=' + encodeURIComponent(q || '') + '&limit=30');
    state.peopleHits = j.items || [];
  }

  async function runValidate() {
    try {
      const j = await api('/validate', {
        method: 'POST',
        body: {
          app_type: state.appType,
          employee_ids: state.selected.map((p) => p.id),
          contract_number: state.form.contract_number,
          date_from: state.form.date_from || todayYmd(),
          date_to: state.form.date_to || state.form.date_from || todayYmd(),
          direction: state.form.direction,
          mvz: state.form.mvz,
          curator: state.form.curator
        }
      });
      state.validation = j;
    } catch (e) {
      state.validation = { ok: false, blocks: [{ message: e.message }], warnings: [], summary: {} };
    }
  }

  function defaultRoute() {
    const d = fmtRu(state.form.date_from || todayYmd());
    if (state.appType === 'ship') {
      return state.form.direction === 'outbound'
        ? `Маршрут: МЛСП - Порт\nДаты: ${d} - ${fmtRu(state.form.date_to || state.form.date_from)}`
        : `Маршрут: Порт - МЛСП\nДаты: ${d} - ${fmtRu(state.form.date_to || state.form.date_from)}`;
    }
    if (state.form.direction === 'outbound') {
      return `ДАТА: ${d} МЛСП - ВАРАНДЕЙ - АРХАНГЕЛЬСК`;
    }
    return `ДАТА: ${d} АРХАНГЕЛЬСК - ВАРАНДЕЙ - МЛСП`;
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
        const ok = confirm(
          `Есть предупреждения (${v.warnings.length}). Выгрузить всё равно?`
        );
        if (!ok) return;
        state.form.accept_warnings = true;
      }

      const body = {
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
        accept_warnings: true,
        force: !!opts.force
      };
      const created = await api('/applications', { method: 'POST', body });
      state.draftApp = created.item;
      const id = created.item.id;
      const forceQ = (!created.validation?.ok || opts.force) ? '?force=1' : '';
      const resp = await fetch('/api/mlsp-passes/applications/' + id + '/excel' + forceQ, {
        headers: { Authorization: 'Bearer ' + token() }
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw Object.assign(new Error(j.error || 'Не удалось скачать'), { payload: j });
      }
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (state.appType || 'mlsp') + '_' + (state.form.date_from || todayYmd()) + '.xlsx';
      a.click();
      URL.revokeObjectURL(a.href);

      if (state.appType === 'flight' || state.appType === 'ship') {
        await api('/applications/' + id + '/publish-legs', { method: 'POST', body: {} });
        await loadBoard();
      }
      if (state.appType === 'pass_mlsp') {
        const want = confirm('Записать исходящий номер и строку в реестр пропусков?');
        if (want) {
          const reg = await api('/applications/' + id + '/register-pass', {
            method: 'POST',
            body: { responsible_name: 'Хосе' }
          });
          toast('Исх. ' + reg.outgoing + ' · в реестре', 'success');
          await loadRegistry();
          await loadPulse();
        }
      }
      toast('Excel готов', 'success');
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
      <div class="mlsp-kpi__card is-ok"><div class="mlsp-kpi__label">След. исх.№</div><div class="mlsp-kpi__value" style="font-size:18px">${esc(p.next_outgoing || '—')}</div></div>
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

  function blankPreviewHtml() {
    const t = TYPES.find((x) => x.id === state.appType);
    const people = state.selected;
    return `<div class="mlsp-blank">
      <div class="mlsp-blank__title">${esc(t?.name || 'Бланк')}</div>
      <div class="mlsp-blank__meta">
        ${esc(state.form.contract_number || 'Договор не выбран')} ·
        ${esc(state.form.curator || 'куратор —')} ·
        ${fmtRu(state.form.date_from || todayYmd())}
        ${state.appType === 'pass_fsb' ? '<br><span style="color:var(--warn-t)">Форма ФСБ — черновик по приказу 102, подтвердить у режима</span>' : ''}
      </div>
      <div class="mlsp-blank__meta">${esc(state.form.route_text || defaultRoute())}</div>
      <table>
        <thead><tr><th>№</th><th>ФИО</th><th>Должность</th><th>Паспорт</th><th>Телефон</th></tr></thead>
        <tbody>
          ${people.length ? people.map((p, i) => `<tr>
            <td>${i + 1}</td>
            <td>${esc(p.fio)}</td>
            <td>${esc(p.position || '')}</td>
            <td>${esc([p.passport_series, p.passport_number].filter(Boolean).join(' '))}</td>
            <td>${esc(p.phone || '')}</td>
          </tr>`).join('') : '<tr><td colspan="5" style="color:var(--t3)">Выберите сотрудников из Дружины</td></tr>'}
        </tbody>
      </table>
    </div>`;
  }

  function genHtml() {
    const contractOpts = (state.meta || []).map((m) =>
      `<option value="${esc(m.contract_number)}"${state.form.contract_number === m.contract_number ? ' selected' : ''}>${esc(m.contract_number)}${m.mvz ? ' · МВЗ ' + esc(m.mvz) : ''}</option>`
    ).join('');

    return `<div class="mlsp-panel">
      <div class="mlsp-type-grid">
        ${TYPES.map((t) => `<button type="button" class="mlsp-type${state.appType === t.id ? ' is-on' : ''}" data-type="${t.id}">
          <div class="mlsp-type__name">${esc(t.name)}</div>
          <div class="mlsp-type__desc">${esc(t.desc)}</div>
          ${t.draft ? '<div class="mlsp-type__badge">черновик формы</div>' : ''}
        </button>`).join('')}
      </div>
    </div>
    <div class="mlsp-split" style="margin-top:16px">
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
          }).join('') || '<div style="color:var(--t3);font-size:13px">Начните ввод ФИО</div>'}
        </div>
        <div style="margin-top:14px">
          <div style="font-size:12px;font-weight:700;color:var(--t2);margin-bottom:8px">В заявке · ${state.selected.length}</div>
          <div class="mlsp-people" style="max-height:180px">
            ${state.selected.map((p) => `<div class="mlsp-person">
              <div class="mlsp-person__name">${esc(p.fio)}</div>
              <button type="button" class="btn ghost mini" data-rm-person="${p.id}">×</button>
            </div>`).join('') || '<div style="color:var(--t3);font-size:13px">Пусто</div>'}
          </div>
        </div>
        ${validationHtml()}
        <div class="mlsp-toolbar" style="margin-top:12px">
          <button type="button" class="btn ghost" id="mlsp_validate">Проверить</button>
          <button type="button" class="btn primary" id="mlsp_download" ${ (state.validation && !state.validation.ok) ? 'disabled' : '' }>
            Скачать Excel
          </button>
          ${state.validation && !state.validation.ok
            ? ''
            : ((state.validation?.warnings || []).length
              ? '<label style="font-size:12px;color:var(--t2);display:flex;gap:6px;align-items:center"><input type="checkbox" id="mlsp_accept_warn"/> принять предупреждения</label>'
              : '')}
        </div>
      </div>
      <div>${blankPreviewHtml()}</div>
    </div>`;
  }

  function boardSection(title, items) {
    if (!items?.length) return '';
    return `<div class="mlsp-board-day">
      <div class="mlsp-board-day__h"><h3>${esc(title)}</h3><span>${items.length} чел.</span></div>
      ${items.map((it) => `<div class="mlsp-leg">
        <div class="mlsp-leg__dir ${it.direction === 'outbound' ? 'is-out' : 'is-in'}">${esc(it.direction_label)}</div>
        <div>
          <div class="mlsp-leg__fio">${esc(it.fio)}</div>
          <div class="mlsp-leg__meta">${fmtRu(it.leg_date)} · ${esc(it.transport_label)} · ${esc(it.route_text || '')}</div>
        </div>
        <a class="btn ghost mini" href="#/employee?id=${it.employee_id || it.emp_id || ''}">Карточка</a>
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
        ? '<div style="color:var(--t3)">Пока нет рейсов в горизонте. Соберите заявку в генераторе и опубликуйте ноги рейса.</div>'
        : ''}
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
            ${(state.registry || []).map((r) => `<tr data-reg="${r.id}" style="cursor:pointer">
              <td>${esc(r.request_no || '—')}</td>
              <td>${esc(r.responsible_name || '')}</td>
              <td>${esc(r.contract_number || '')}</td>
              <td>${fmtRu(r.request_date)}</td>
              <td>${fmtRu(r.planned_ready)}</td>
              <td>${esc(r.curator || '')}</td>
              <td>${esc(r.status)}</td>
              <td><span class="mlsp-sig is-${esc(r.signal)}">${esc(r.signal_label)}</span></td>
              <td>${esc((r.comment || '').slice(0, 80))}</td>
            </tr>`).join('') || '<tr><td colspan="9" style="color:var(--t3)">Пусто</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function historyHtml() {
    return `<div class="mlsp-panel">
      <div class="mlsp-toolbar">
        <div class="grow"><input class="mlsp-search" id="mlsp_hist_q" placeholder="ФИО, маршрут, договор…"/></div>
        <button type="button" class="btn ghost" id="mlsp_hist_go">Найти</button>
      </div>
      <div class="mlsp-table-wrap">
        <table class="mlsp-table">
          <thead><tr><th>Дата</th><th>Направление</th><th>ФИО</th><th>Транспорт</th><th>Маршрут</th><th>Договор</th><th>Источник</th></tr></thead>
          <tbody>
            ${(state.history || []).slice(0, 200).map((h) => `<tr>
              <td>${fmtRu(h.leg_date)}</td>
              <td>${h.direction === 'outbound' ? 'С МЛСП' : 'На МЛСП'}</td>
              <td>${esc(h.fio)}</td>
              <td>${esc(h.transport)}</td>
              <td>${esc(h.route_text || '')}</td>
              <td>${esc(h.contract_number || '')}</td>
              <td>${esc(h.source || '')}</td>
            </tr>`).join('') || '<tr><td colspan="7" style="color:var(--t3)">Нет записей</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function baseHtml() {
    return `<div class="mlsp-split">
      <div class="mlsp-panel">
        <h3 style="margin:0 0 12px;font-size:15px">Договоры ГНШ</h3>
        <div class="mlsp-toolbar">
          <button type="button" class="btn primary" id="mlsp_ensure_cp">Добавить в CRM, если нет</button>
        </div>
        <div class="mlsp-table-wrap">
          <table class="mlsp-table">
            <thead><tr><th>Договор</th><th>МВЗ</th><th>Куратор</th><th>Окончание</th><th>В CRM</th></tr></thead>
            <tbody>
              ${(state.meta || []).map((m) => {
                const inCrm = (state.contracts || []).some((c) => c.number === m.contract_number);
                return `<tr>
                  <td>${esc(m.contract_number)}</td>
                  <td>${esc(m.mvz || '—')}</td>
                  <td>${esc(m.curator || '—')}</td>
                  <td>${m.end_date ? fmtRu(m.end_date) : '<span style="color:var(--warn-t)">нет</span>'}</td>
                  <td>${inCrm ? '<span class="mlsp-chip is-ok">есть</span>' : '<span class="mlsp-chip is-warn">нет</span>'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="mlsp-panel">
        <h3 style="margin:0 0 8px;font-size:15px">Пакет допусков МЛСП</h3>
        <p style="margin:0 0 12px;color:var(--t3);font-size:13px;line-height:1.45">
          BLOCK — паспорт, медицина, BOSIET и аттестации пакета «Шельф». WARN — ФСБ и пропуск МЛСП (можно выгрузить с подтверждением).
        </p>
        <div id="mlsp_pack_list" style="color:var(--t3);font-size:13px">Загрузка…</div>
      </div>
    </div>`;
  }

  function todayHtml() {
    const breach = (state.registry || []).filter((r) => r.signal === 'breach');
    const noconf = (state.registry || []).filter((r) => r.signal === 'no_confirm');
    const due = (state.registry || []).filter((r) => r.signal === 'due_soon');
    const g = state.board?.groups || {};
    return `<div class="mlsp-split">
      <div class="mlsp-panel">
        <h3 style="margin:0 0 12px;font-size:15px">Пульс реестра</h3>
        ${breach.length ? `<div class="mlsp-alert mlsp-alert--block"><h4>Срыв</h4><ul>${breach.map((r) => `<li>#${esc(r.request_no)} · ${esc(r.contract_number)} · ${esc(r.signal_label)}</li>`).join('')}</ul></div>` : ''}
        ${noconf.length ? `<div class="mlsp-alert mlsp-alert--warn"><h4>Нет подтверждения куратора</h4><ul>${noconf.map((r) => `<li>#${esc(r.request_no)} · ${esc(r.curator || '')}</li>`).join('')}</ul></div>` : ''}
        ${due.length ? `<div class="mlsp-alert mlsp-alert--warn"><h4>До срока ≤7 дней</h4><ul>${due.map((r) => `<li>#${esc(r.request_no)} · ${esc(r.signal_label)}</li>`).join('')}</ul></div>` : ''}
        ${!(breach.length || noconf.length || due.length) ? '<div style="color:var(--t3)">Критичных сигналов нет</div>' : ''}
      </div>
      <div class="mlsp-panel">
        <h3 style="margin:0 0 12px;font-size:15px">Кто едет / летит</h3>
        ${boardSection('Сегодня', g.today)}
        ${boardSection('7 дней', g.week)}
        ${!(g.today?.length || g.week?.length) ? '<div style="color:var(--t3)">Ближайших рейсов нет</div>' : ''}
        <div class="mlsp-toolbar" style="margin-top:12px">
          <button type="button" class="btn primary" data-tab="gen">Открыть генератор</button>
        </div>
      </div>
    </div>`;
  }

  function bodyHtml() {
    switch (state.tab) {
      case 'board': return boardHtml();
      case 'gen': return genHtml();
      case 'registry': return registryHtml();
      case 'history': return historyHtml();
      case 'base': return baseHtml();
      default: return todayHtml();
    }
  }

  function bind(root) {
    root.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', async () => {
        state.tab = b.getAttribute('data-tab');
        if (state.tab === 'board') await loadBoard();
        if (state.tab === 'registry') await loadRegistry();
        if (state.tab === 'history') await loadHistory('');
        if (state.tab === 'gen') {
          if (!state.peopleHits.length) await searchPeople('');
          await runValidate();
        }
        if (state.tab === 'base') {
          await loadContracts();
          try {
            const pack = await api('/pack');
            const el = document.getElementById('mlsp_pack_list');
            if (el) {
              el.innerHTML = `<div class="mlsp-table-wrap"><table class="mlsp-table"><thead><tr><th>Код</th><th>Название</th><th>Уровень</th></tr></thead><tbody>${
                (pack.items || []).map((p) => `<tr><td>${esc(p.code)}</td><td>${esc(p.label)}</td><td><span class="mlsp-chip ${p.severity === 'block' ? 'is-err' : 'is-warn'}">${esc(p.severity)}</span></td></tr>`).join('')
              }</tbody></table></div>`;
            }
          } catch (_) { /* ignore */ }
        }
        render();
      });
    });

    root.querySelectorAll('[data-type]').forEach((b) => {
      b.addEventListener('click', async () => {
        state.appType = b.getAttribute('data-type');
        if (state.appType === 'ship') state.form.transport = 'ship';
        await runValidate();
        render();
      });
    });

    const contract = root.querySelector('#mlsp_contract');
    contract?.addEventListener('change', async () => {
      applyContract(contract.value);
      await runValidate();
      render();
    });

    ['mlsp_mvz', 'mlsp_curator', 'mlsp_ship_curator', 'mlsp_from', 'mlsp_to', 'mlsp_dir', 'mlsp_tr', 'mlsp_route'].forEach((id) => {
      const el = root.querySelector('#' + id);
      if (!el) return;
      el.addEventListener('change', async () => {
        const map = {
          mlsp_mvz: 'mvz', mlsp_curator: 'curator', mlsp_ship_curator: 'ship_curator',
          mlsp_from: 'date_from', mlsp_to: 'date_to', mlsp_dir: 'direction',
          mlsp_tr: 'transport', mlsp_route: 'route_text'
        };
        state.form[map[id]] = el.value;
        await runValidate();
        if (id === 'mlsp_from' || id === 'mlsp_dir') render();
      });
    });

    let tSearch;
    root.querySelector('#mlsp_people_q')?.addEventListener('input', (e) => {
      clearTimeout(tSearch);
      tSearch = setTimeout(async () => {
        await searchPeople(e.target.value);
        render();
      }, 250);
    });

    root.querySelectorAll('[data-add-person]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.getAttribute('data-add-person'));
        const hit = state.peopleHits.find((p) => p.id === id);
        if (!hit) return;
        const idx = state.selected.findIndex((p) => p.id === id);
        if (idx >= 0) state.selected.splice(idx, 1);
        else state.selected.push(hit);
        await runValidate();
        render();
      });
    });
    root.querySelectorAll('[data-rm-person]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.getAttribute('data-rm-person'));
        state.selected = state.selected.filter((p) => p.id !== id);
        await runValidate();
        render();
      });
    });

    root.querySelector('#mlsp_validate')?.addEventListener('click', async () => {
      await runValidate();
      render();
    });
    root.querySelector('#mlsp_accept_warn')?.addEventListener('change', (e) => {
      state.form.accept_warnings = !!e.target.checked;
    });
    root.querySelector('#mlsp_download')?.addEventListener('click', () => createAndDownload());

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
      const q = root.querySelector('#mlsp_hist_q')?.value || '';
      await loadHistory(q);
      render();
    });

    root.querySelector('#mlsp_reglament')?.addEventListener('click', async () => {
      if (!state.reglament) state.reglament = await api('/reglament');
      const r = state.reglament;
      if (window.AsgardUI?.showModal) {
        AsgardUI.showModal({
          title: r.title,
          body: `<ol style="margin:0;padding-left:18px;line-height:1.5">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
            <p style="margin-top:12px;color:var(--t2)">Статусы: ${esc(r.statuses.join(' / '))}</p>`
        });
      } else {
        alert(r.steps.join('\n'));
      }
    });

    root.querySelector('#mlsp_reg_add')?.addEventListener('click', async () => {
      const request_no = prompt('№ заявки у заказчика');
      if (request_no == null) return;
      try {
        await api('/registry', {
          method: 'POST',
          body: {
            request_no,
            contract_number: state.form.contract_number || state.meta[0]?.contract_number,
            request_date: todayYmd(),
            curator: state.form.curator,
            responsible_name: 'Хосе',
            status: 'Подана'
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
      tr.addEventListener('click', async () => {
        const id = Number(tr.getAttribute('data-reg'));
        const row = state.registry.find((x) => x.id === id);
        if (!row) return;
        const status = prompt('Статус (Подана/Подтверждена/В работе/Готова/Сорвана)', row.status);
        if (status == null) return;
        try {
          await api('/registry/' + id, { method: 'PATCH', body: { status } });
          await loadRegistry();
          await loadPulse();
          render();
        } catch (e) {
          toast(e.message, 'error');
        }
      });
    });
  }

  function render() {
    const root = document.getElementById('mlsp-page');
    if (!root) return;
    root.innerHTML = `
      <div class="mlsp-hero">
        <div>
          <p class="mlsp-hero__eyebrow">Дружина · шельф</p>
          <h1 class="mlsp-hero__title">МЛСП · пропуска и транспорт</h1>
          <p class="mlsp-hero__sub">Генератор бланков, реестр SLA +45, сводка рейсов. Люди из Дружины, договоры ГНШ из карточек контрагента.</p>
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
      render();
    });
    bind(root);
  }

  async function bootData() {
    if (!state.form.date_from) state.form.date_from = todayYmd();
    await Promise.all([loadPulse(), loadContracts(), loadBoard(), loadRegistry()]);
  }

  async function renderPage({ layout, title }) {
    await layout('<div id="mlsp-page"><div class="loading">Загрузка модуля МЛСП…</div></div>', { title: title || 'МЛСП · пропуска' });
    try {
      await bootData();
      render();
    } catch (e) {
      const el = document.getElementById('mlsp-page');
      if (el) el.innerHTML = `<div class="mlsp-alert mlsp-alert--block"><h4>Не удалось загрузить</h4><div>${esc(e.message)}</div><div style="margin-top:8px;font-size:12px">Проверьте миграцию V477 и перезапуск сервиса.</div></div>`;
    }
  }

  return { render: renderPage };
})();
