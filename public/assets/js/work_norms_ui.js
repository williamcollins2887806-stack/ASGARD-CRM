/**
 * Справочник норм Асгарда — вкладка в #/pm-calculations?tab=norms
 * Раскладка как карточка дружины: слева направления, справа большая панель.
 */
window.AsgardWorkNormsUi = (function () {
  const { esc, toast, showModal, hideModal } = AsgardUI;

  const SERVICE_TABS = [
    { id: 'experience', label: 'Опыт с объектов' },
    { id: 'globals', label: 'Общие ставки' },
    { id: 'chemistry', label: 'Цены на химию' },
    { id: 'equipment', label: 'Оборудование' },
    { id: 'history', label: 'История' }
  ];

  const WRITE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO'];

  const CALC_KIND_RU = {
    per_unit_shift: 'выработка за смену',
    days_per_unit: 'сутки на единицу',
    min_per_unit: 'минуты на единицу',
    mh_per_unit: 'чел·ч на единицу',
    kg_per_m: 'кг реагента на метр',
    fixed_days: 'фиксированные сутки',
    hours_per_cycle: 'часы на цикл'
  };

  const STATUS_RU = {
    draft: 'черновик',
    confirmed: 'подтверждён',
    published: 'в нормах',
    rejected: 'отклонён'
  };

  const WN_CSS = `
.wn-wrap { display: flex; flex-direction: column; gap: 12px; min-height: 520px; }
.wn-intro {
  margin: 0; padding: 10px 14px; font-size: 12.5px; line-height: 1.45; color: var(--t2);
  background: var(--bg2); border: 1px solid var(--brd); border-radius: 12px;
  border-left: 3px solid var(--gold);
}
.wn-layout {
  display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 14px; align-items: start;
}
@media (max-width: 900px) {
  .wn-layout { grid-template-columns: 1fr; }
  .wn-nav {
    display: flex; flex-direction: row; flex-wrap: nowrap; overflow-x: auto;
    gap: 6px; padding: 8px; position: sticky; top: 0; z-index: 5;
  }
  .wn-nav-group { display: flex; flex-direction: row; gap: 4px; flex-shrink: 0; }
  .wn-nav-label { display: none; }
  .wn-nav-item { white-space: nowrap; flex-shrink: 0; }
  .wn-nav-sep { width: 1px; align-self: stretch; margin: 0 4px; }
  .wn-nav-foot { display: none; }
}
.wn-nav {
  display: flex; flex-direction: column; gap: 4px;
  position: sticky; top: 8px;
  background: var(--bg2); border: 1px solid var(--brd); border-radius: 12px; padding: 10px 8px;
  max-height: calc(100vh - 140px); overflow-y: auto;
}
.wn-nav-label {
  font-size: 10px; font-weight: 700; letter-spacing: .45px; text-transform: uppercase;
  color: var(--t3); padding: 6px 10px 4px;
}
.wn-nav-sep {
  height: 1px; background: var(--brd-m); margin: 8px 6px;
}
.wn-nav-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; text-align: left; padding: 9px 12px; border-radius: 8px;
  border: 1px solid transparent; background: transparent; color: var(--t2);
  cursor: pointer; font: inherit; font-size: 13px; font-weight: 600;
}
.wn-nav-item:hover { background: var(--bg3); color: var(--t1); }
.wn-nav-item.is-active {
  background: color-mix(in srgb, var(--gold) 18%, transparent);
  border-color: color-mix(in srgb, var(--gold) 40%, var(--brd));
  color: var(--gold);
}
.wn-nav-foot { margin-top: 8px; padding: 4px 6px 2px; }
.wn-nav-foot .btn { width: 100%; }
.wn-main {
  background: var(--bg2); border: 1px solid var(--brd); border-radius: 12px;
  padding: 16px 18px; min-height: 420px;
}
.wn-panel-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  margin-bottom: 14px; flex-wrap: wrap;
}
.wn-panel-title {
  margin: 0; font-weight: 800; font-size: 16px; color: var(--t1);
  display: flex; align-items: center; gap: 8px;
}
.wn-panel-title .bar {
  width: 3px; height: 16px; border-radius: 2px; background: var(--gold); flex-shrink: 0;
}
.wn-panel-notes { margin: 6px 0 0; font-size: 12.5px; color: var(--t3); line-height: 1.45; max-width: 64ch; }
.wn-methods {
  display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px;
  padding-bottom: 12px; border-bottom: 1px solid var(--brd-m);
}
.wn-method {
  border: 1px solid var(--brd); background: var(--bg3); color: var(--t2);
  border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 600;
  cursor: pointer; font: inherit;
}
.wn-method:hover { border-color: var(--gold); color: var(--gold); }
.wn-method.is-active {
  border-color: var(--gold);
  color: var(--gold);
  background: color-mix(in srgb, var(--gold) 14%, var(--bg3));
}
.wn-calc {
  background: var(--bg3); border: 1px solid var(--brd-m); border-radius: 10px;
  padding: 14px; margin-bottom: 16px;
}
.wn-calc-title {
  margin: 0 0 10px; font-size: 13px; font-weight: 700; color: var(--t1);
  display: flex; align-items: baseline; gap: 8px;
}
.wn-calc-title span { font-weight: 400; font-size: 11.5px; color: var(--t3); }
.wn-calc-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px 12px; align-items: end; margin-bottom: 10px;
}
.wn-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--t2); }
.wn-field .inp { width: 100%; }
.wn-coeffs {
  display: flex; flex-wrap: wrap; gap: 10px 14px; margin-bottom: 10px;
  font-size: 12px; color: var(--t2);
}
.wn-calc-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.wn-preview {
  margin-top: 12px; padding: 12px 14px; border-radius: 8px;
  background: color-mix(in srgb, var(--gold) 8%, var(--bg2));
  border: 1px solid color-mix(in srgb, var(--gold) 28%, var(--brd));
  font-size: 13px; color: var(--t1); min-height: 28px;
}
.wn-preview:empty { display: none; }
.wn-preview .muted { color: var(--t3); }
.wn-rate-grid { display: grid; gap: 10px; }
.wn-rate {
  background: var(--bg1, var(--bg)); border: 1px solid var(--brd-m); border-radius: 10px;
  padding: 12px 14px;
}
.wn-rate.is-empty { border-left: 3px solid var(--warn, #c90); }
.wn-rate-top { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
.wn-rate-name { font-weight: 700; font-size: 14.5px; color: var(--t1); }
.wn-rate-meta { font-size: 12px; color: var(--t3); margin-top: 3px; }
.wn-foul-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.wn-foul {
  display: inline-flex; flex-direction: column; gap: 2px;
  padding: 6px 10px; border-radius: 8px; min-width: 72px;
  border: 1px solid var(--brd-m); background: var(--bg3);
}
.wn-foul.soft { background: color-mix(in srgb, var(--ok, #4a8) 14%, var(--bg3)); }
.wn-foul.hard { background: color-mix(in srgb, var(--err, #c44) 12%, var(--bg3)); }
.wn-foul.mid { background: color-mix(in srgb, var(--gold) 12%, var(--bg3)); }
.wn-foul .lbl { font-size: 10.5px; color: var(--t3); text-transform: uppercase; letter-spacing: .3px; }
.wn-foul strong { font-size: 14px; color: var(--t1); font-variant-numeric: tabular-nums; }
.wn-dia { margin-top: 8px; font-size: 12px; color: var(--t3); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.wn-dia .pill { margin: 0; }
.wn-section-note { margin: 0 0 12px; font-size: 12.5px; color: var(--t3); line-height: 1.45; }
.wn-exp-grid { display: grid; gap: 10px; }
.wn-exp {
  background: var(--bg1, var(--bg)); border: 1px solid var(--brd-m); border-radius: 10px;
  padding: 12px 14px;
}
.wn-exp-top { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.wn-table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid var(--brd-m); }
.wn-table-wrap .tnd-table { margin: 0; }
.wn-empty { margin: 24px 0; text-align: center; color: var(--t3); font-size: 13px; }
`;

  function ensureCss() {
    if (document.getElementById('wn-ui-css')) return;
    const s = document.createElement('style');
    s.id = 'wn-ui-css';
    s.textContent = WN_CSS;
    document.head.appendChild(s);
  }

  function calcKindPhrase(kind, unit) {
    const base = CALC_KIND_RU[kind] || kind || 'норма';
    if (kind === 'days_per_unit') return 'Считаем: сутки на секцию/единицу' + (unit ? ' (' + unit + ')' : '');
    if (kind === 'min_per_unit') return 'Считаем: минуты на трубку/единицу' + (unit ? ' (' + unit + ')' : '');
    if (kind === 'per_unit_shift') return 'Считаем: выработка за смену исполнителя' + (unit ? ' (' + unit + ')' : '');
    if (kind === 'hours_per_cycle') return 'Считаем: часы на цикл/контур' + (unit ? ' (' + unit + ')' : '');
    return 'Считаем: ' + base + (unit ? ' · ' + unit : '');
  }

  function foulingCell(label, val, tone) {
    if (val == null || val === '') return '';
    return '<span class="wn-foul ' + esc(tone || 'mid') + '"><span class="lbl">' + esc(label) +
      '</span><strong>' + esc(String(val)) + '</strong></span>';
  }

  function token() {
    return localStorage.getItem('asgard_token') || '';
  }

  async function api(path, opts) {
    opts = opts || {};
    const r = await fetch(path, {
      method: opts.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + token(),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (path.endsWith('.xlsx') && r.ok) return r;
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || d.message || ('HTTP ' + r.status));
    return d;
  }

  function askComment(placeholder) {
    return new Promise((resolve) => {
      showModal({
        title: 'Комментарий',
        html:
          '<p class="muted" style="margin-bottom:8px">Обязателен (мин. 5 символов).</p>' +
          '<textarea id="wnComment" class="inp" rows="3" style="width:100%" placeholder="' +
          esc(placeholder || 'Напр.: по факту Апатит — 1.6 сут/секция') + '"></textarea>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
          '<button type="button" class="btn mini ghost" id="wnCnl">Отмена</button>' +
          '<button type="button" class="btn mini" id="wnOk">OK</button></div>',
        onMount: () => {
          document.getElementById('wnCnl')?.addEventListener('click', () => { hideModal(); resolve(null); });
          document.getElementById('wnOk')?.addEventListener('click', () => {
            const v = (document.getElementById('wnComment')?.value || '').trim();
            if (v.length < 5) { toast('Короткий комментарий', 'Минимум 5 символов', 'err'); return; }
            hideModal();
            resolve(v);
          });
        }
      });
    });
  }

  /**
   * @param {{ mountEl: HTMLElement, canWrite?: boolean }} opts
   */
  async function mount(opts) {
    ensureCss();
    const root = opts.mountEl;
    const canWrite = !!opts.canWrite;
    let catalog = null;
    let chip = null;
    let method = null;
    let preview = null;
    let experiences = [];
    /** Черновик полей калькулятора между re-render */
    let calcDraft = { inputs: {}, fouling: 'medium', posts: 2, coeffs: [] };

    async function load() {
      catalog = await api('/api/work-norms/catalog');
      experiences = catalog.experiences || [];
      if (!chip) chip = (catalog.categories && catalog.categories[0] && catalog.categories[0].code) || 'experience';
      await render();
    }

    function currentCategory() {
      return (catalog.categories || []).find((c) => c.code === chip) || null;
    }

    function methodsOf(cat) {
      const m = cat && cat.methods_json;
      return Array.isArray(m) ? m : [];
    }

    function fieldsFor(cat, methodCode) {
      const schema = cat && cat.input_schema_json;
      if (!schema || !schema.methods) return [];
      const m = schema.methods[methodCode] || schema.methods[Object.keys(schema.methods)[0]];
      return (m && m.fields) || [];
    }

    function experienceFieldsFor(cat, methodCode) {
      const schema = cat && cat.experience_schema_json;
      if (!schema || !schema.methods) return [];
      const m = schema.methods[methodCode] || schema.methods[Object.keys(schema.methods)[0]];
      return (m && m.fields) || [];
    }

    function experienceMeta(cat, methodCode) {
      const schema = cat && cat.experience_schema_json;
      if (!schema || !schema.methods) return {};
      return schema.methods[methodCode] || schema.methods[Object.keys(schema.methods)[0]] || {};
    }

    function primaryRateCode(cat, methodCode) {
      const methods = methodsOf(cat);
      const m = methods.find((x) => x.code === methodCode);
      return (m && m.primary_rate_code) || null;
    }

    function ratesFor(catCode, methodCode) {
      return (catalog.rates || []).filter((r) => {
        if (r.category_code !== catCode) return false;
        if (!methodCode) return true;
        return !r.method_code || r.method_code === methodCode;
      });
    }

    function snapshotCalc() {
      const inputs = {};
      root.querySelectorAll('.wn-in').forEach((inp) => {
        if (inp.type === 'checkbox') {
          inputs[inp.dataset.key] = inp.checked ? 1 : 0;
        } else if (inp.value !== '') {
          inputs[inp.dataset.key] = inp.value;
        }
      });
      const coeffs = [];
      root.querySelectorAll('.wn-coeff:checked').forEach((c) => coeffs.push(c.value));
      calcDraft = {
        inputs,
        fouling: document.getElementById('wnFouling')?.value || calcDraft.fouling || 'medium',
        posts: document.getElementById('wnPosts')?.value || calcDraft.posts || 2,
        coeffs
      };
    }

    function panelTitle(title) {
      return '<h3 class="wn-panel-title"><span class="bar"></span>' + esc(title) + '</h3>';
    }

    function renderNav() {
      const cats = (catalog.categories || []).map((c) =>
        '<button type="button" class="wn-nav-item' + (chip === c.code ? ' is-active' : '') +
        '" data-chip="' + esc(c.code) + '"><span>' + esc(c.title) + '</span></button>'
      ).join('');
      const svc = SERVICE_TABS.map((t) =>
        '<button type="button" class="wn-nav-item' + (chip === t.id ? ' is-active' : '') +
        '" data-chip="' + esc(t.id) + '"><span>' + esc(t.label) + '</span></button>'
      ).join('');
      return '<nav class="wn-nav" aria-label="Справочник норм">' +
        '<div class="wn-nav-label">Направления</div>' +
        '<div class="wn-nav-group">' + cats + '</div>' +
        '<div class="wn-nav-sep"></div>' +
        '<div class="wn-nav-label">Справочник</div>' +
        '<div class="wn-nav-group">' + svc + '</div>' +
        '<div class="wn-nav-foot"><button type="button" class="btn mini ghost" id="wnExport">Excel ↓</button></div>' +
        '</nav>';
    }

    function renderMethodTabs(cat) {
      const methods = methodsOf(cat);
      if (!methods.length) return '';
      if (!method || !methods.some((m) => m.code === method)) method = methods[0].code;
      return '<div class="wn-methods">' +
        methods.map((m) =>
          '<button type="button" class="wn-method' + (method === m.code ? ' is-active' : '') +
          '" data-method="' + esc(m.code) + '">' + esc(m.label) + '</button>'
        ).join('') + '</div>';
    }

    function renderCalc(cat) {
      const fields = fieldsFor(cat, method);
      const coeffs = catalog.coeffs || [];
      const d = calcDraft || {};
      const foul = d.fouling || 'medium';
      const primary = primaryRateCode(cat, method);
      return '<div class="wn-calc">' +
        '<div class="wn-calc-title">Мини-калькулятор <span>только математика · объём → сутки / бригада' +
        (primary ? ' · норма <code>' + esc(primary) + '</code>' : '') +
        '</span></div>' +
        '<div class="wn-calc-grid">' +
        fields.map((f) => {
          const v = d.inputs && d.inputs[f.key] != null ? d.inputs[f.key] : '';
          if (f.type === 'checkbox') {
            const on = v === 1 || v === '1' || v === true || v === 'true';
            return '<label class="wn-field" style="flex-direction:row;align-items:center;gap:8px;padding-top:18px">' +
              '<input class="wn-in" data-key="' + esc(f.key) + '" type="checkbox"' + (on ? ' checked' : '') + '/> ' +
              esc(f.label) + '</label>';
          }
          return '<label class="wn-field">' + esc(f.label) +
            (f.unit ? ' <span class="muted">(' + esc(f.unit) + ')</span>' : '') +
            (f.optional ? ' <span class="muted">опц.</span>' : '') +
            '<input class="inp wn-in" data-key="' + esc(f.key) + '" type="number" step="any" value="' + esc(String(v)) + '"/></label>';
        }).join('') +
        '<label class="wn-field">Отложения<select class="inp" id="wnFouling">' +
        '<option value="loose"' + (foul === 'loose' ? ' selected' : '') + '>лёгкие</option>' +
        '<option value="medium"' + (foul === 'medium' ? ' selected' : '') + '>средние</option>' +
        '<option value="hard"' + (foul === 'hard' ? ' selected' : '') + '>тяжёлые</option>' +
        '</select></label>' +
        '<label class="wn-field">Постов<input class="inp" id="wnPosts" type="number" min="1" max="6" value="' +
        esc(String(d.posts != null ? d.posts : 2)) + '"/></label>' +
        '</div>' +
        (coeffs.length
          ? '<div class="wn-coeffs">' +
            coeffs.map((c) => {
              const on = (d.coeffs || []).indexOf(c.coeff_code) >= 0;
              return '<label><input type="checkbox" class="wn-coeff" value="' + esc(c.coeff_code) + '"' +
                (on ? ' checked' : '') + '/> ' + esc(c.label) + ' (×' + esc(String(c.multiplier)) + ')</label>';
            }).join('') + '</div>'
          : '') +
        '<div class="wn-calc-actions"><button type="button" class="btn mini" id="wnCalc">Рассчитать</button></div>' +
        '<div id="wnPreview" class="wn-preview"></div>' +
        '</div>';
    }

    function diameterChips(params) {
      const by = params && params.by_diameter;
      if (!by || typeof by !== 'object') return '';
      const keys = Object.keys(by).sort((a, b) => Number(a) - Number(b));
      if (!keys.length) return '';
      return '<div class="wn-dia"><span class="muted">По диаметру:</span> ' +
        keys.map((d) => '<span class="pill">Ø' + esc(d) + ' → ' + esc(String(by[d])) + '</span>').join(' ') +
        '</div>';
    }

    function renderRateCards(cat) {
      const rows = ratesFor(cat.code, method);
      const primary = primaryRateCode(cat, method);
      if (!rows.length) {
        return '<p class="wn-empty">Нет норм — внесите опыт с объекта или добавьте норму.</p>';
      }
      return '<div class="wn-rate-grid">' +
        rows.map((r) => {
          const empty = r.rate_default == null && r.rate_medium == null;
          const isPrimary = primary && r.code === primary;
          const crew = r.crew_json || {};
          const crewTxt = (crew.master != null || crew.exec != null)
            ? (crew.master || 0) + ' мастер + ' + (crew.exec || 0) + ' слесарь'
            : '';
          return '<article class="wn-rate' + (empty ? ' is-empty' : '') +
            (isPrimary ? '" style="border-color:color-mix(in srgb, var(--gold) 50%, var(--brd))' : '') + '">' +
            '<div class="wn-rate-top">' +
            '<div><div class="wn-rate-name">' + esc(r.name) +
            (isPrimary ? ' <span class="pill">основная</span>' : '') +
            (empty ? ' <span class="pill warn">заполнить</span>' : '') + '</div>' +
            '<div class="wn-rate-meta">' + esc(calcKindPhrase(r.calc_kind, r.unit)) +
            (crewTxt ? ' · бригада ' + esc(crewTxt) : '') + '</div></div>' +
            (canWrite
              ? '<button type="button" class="btn mini ghost wn-edit-rate" data-id="' + r.id + '">Изменить</button>'
              : '') +
            '</div>' +
            '<div class="wn-foul-row">' +
            foulingCell('Лёгкие', r.rate_loose, 'soft') +
            foulingCell('Средние', r.rate_medium != null ? r.rate_medium : r.rate_default, 'mid') +
            foulingCell('Тяжёлые', r.rate_hard, 'hard') +
            (r.rate_default != null && r.rate_medium == null
              ? foulingCell('База', r.rate_default, 'mid')
              : '') +
            '</div>' +
            diameterChips(r.params_json) +
            (r.notes ? '<div class="muted" style="font-size:12px;margin-top:8px">' + esc(r.notes) + '</div>' : '') +
            '</article>';
        }).join('') +
        '</div>';
    }

    function formatPreview(p) {
      if (!p || p.error) {
        return '<span style="color:var(--danger,#c44)">' + esc((p && p.error) || 'ошибка') + '</span>';
      }
      const r = p.results || {};
      const days = r.work_days;
      let human = '';
      if (days != null) {
        human = 'На объект примерно <strong>' + days + ' календарных суток</strong>';
        if (r.person_shifts != null) human += ' · ' + r.person_shifts + ' чел·смен';
        if (r.man_hours != null) human += ' · ' + r.man_hours + ' чел·ч';
        if (r.reagent_kg != null) human += ' · реагент ' + r.reagent_kg + ' кг';
      }
      return '<div style="font-size:14px">' + human + '</div>' +
        '<div class="muted" style="margin-top:6px;font-size:12px">' +
        (p.trace || []).map((t) => esc(t)).join('<br/>') + '</div>';
    }

    function renderGlobals() {
      const rows = catalog.globalsRows || [];
      return '<p class="wn-section-note">Ставки, ФОТ%, накладные и прочие общие параметры для расчётов РП и Мимира.</p>' +
        '<div class="wn-table-wrap"><table class="tnd-table asg" style="width:100%;font-size:13px"><thead><tr>' +
        '<th>Параметр</th><th>Значение</th><th>Ед.</th><th></th></tr></thead><tbody>' +
        rows.map((r) =>
          '<tr><td>' + esc(r.label) + '</td>' +
          '<td><strong>' + (r.value_num != null ? r.value_num : esc(r.value_text || '—')) + '</strong></td>' +
          '<td>' + esc(r.unit || '') + '</td>' +
          '<td>' + (canWrite
            ? '<button type="button" class="btn mini ghost wn-edit-global" data-key="' + esc(r.key) + '">✎</button>'
            : '') + '</td></tr>'
        ).join('') +
        '</tbody></table></div>';
    }

    function renderChemistry() {
      return '<p class="wn-section-note">Прайс реагентов для химической очистки (₽/кг и расход).</p>' +
        '<div class="wn-table-wrap"><table class="tnd-table asg" style="width:100%;font-size:13px"><thead><tr>' +
        '<th>Название</th><th>₽/кг</th><th>кг/м²</th><th>кг/м³</th><th></th></tr></thead><tbody>' +
        (catalog.chemistry || []).map((c) =>
          '<tr><td>' + esc(c.name) + '</td><td>' + (c.price_kg ?? '—') + '</td>' +
          '<td>' + (c.kg_per_m2 ?? '—') + '</td><td>' + (c.kg_per_m3 ?? '—') + '</td>' +
          '<td>' + (canWrite
            ? '<button type="button" class="btn mini ghost wn-edit-chem" data-id="' + c.id + '">✎</button>'
            : '') + '</td></tr>'
        ).join('') +
        '</tbody></table></div>';
    }

    function renderEquipment() {
      return '<p class="wn-section-note">Типовое оборудование и доля CAPEX в себестоимости.</p>' +
        '<div class="wn-table-wrap"><table class="tnd-table asg" style="width:100%;font-size:13px"><thead><tr>' +
        '<th>Направление</th><th>Название</th><th>Цена stub</th><th>CAPEX%</th><th></th></tr></thead><tbody>' +
        (catalog.equipment || []).map((e) =>
          '<tr><td>' + esc(e.category_code || '—') + '</td><td>' + esc(e.name) + '</td>' +
          '<td>' + (e.stub_price_rub != null ? Number(e.stub_price_rub).toLocaleString('ru-RU') : '—') + '</td>' +
          '<td>' + (e.capex_in_cost_pct ?? '—') + '</td>' +
          '<td>' + (canWrite
            ? '<button type="button" class="btn mini ghost wn-edit-equip" data-id="' + e.id + '">✎</button>'
            : '') + '</td></tr>'
        ).join('') +
        '</tbody></table></div>';
    }

    async function renderHistory() {
      const h = await api('/api/work-norms/history?limit=80');
      const items = h.items || [];
      if (!items.length) return '<p class="wn-empty">Пока нет правок</p>';
      return '<p class="wn-section-note">Каждое изменение нормы — с комментарием РП.</p>' +
        '<div class="wn-table-wrap"><table class="tnd-table asg" style="width:100%;font-size:12px"><thead><tr>' +
        '<th>Когда</th><th>Кто</th><th>Что</th><th>Комментарий</th></tr></thead><tbody>' +
        items.map((it) =>
          '<tr><td>' + esc(String(it.created_at || '').slice(0, 19).replace('T', ' ')) + '</td>' +
          '<td>' + esc(it.user_name || '—') + '</td>' +
          '<td>' + esc(it.action) + ' ' + esc(it.entity_type) +
          (it.category_code ? ' <code>' + esc(it.category_code) + '</code>' : '') + '</td>' +
          '<td>' + esc(it.comment) + '</td></tr>'
        ).join('') +
        '</tbody></table></div>';
    }

    function expStatusPill(st) {
      const map = { draft: '', confirmed: 'ok', published: 'ok', rejected: 'warn' };
      return '<span class="pill ' + (map[st] || '') + '">' + esc(STATUS_RU[st] || st) + '</span>';
    }

    function renderExperience() {
      const list = experiences || [];
      const cats = catalog.categories || [];
      return '<div class="wn-panel-head"><div>' + panelTitle('Банк опыта с объектов') +
        '<p class="wn-panel-notes">РП фиксирует факт → система выводит норму → подтверждаете и публикуете. ИИ только предлагает карточку.</p></div>' +
        (canWrite
          ? '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<button type="button" class="btn mini" id="wnExpManual">Внести опыт</button>' +
            '<button type="button" class="btn mini ghost" id="wnExpAi">2–3 предложения (ИИ)</button></div>'
          : '<p class="muted">Только просмотр</p>') +
        '</div>' +
        (list.length
          ? '<div class="wn-exp-grid">' + list.map((e) => {
            const catTitle = (cats.find((c) => c.code === e.category_code) || {}).title || e.category_code;
            const bits = [
              e.customer_name || e.object_name,
              e.object_label,
              e.qty != null ? e.qty + ' ед.' : null,
              e.volume_value != null ? e.volume_value + ' ' + (e.volume_unit || '') : null,
              e.diameter_mm != null ? 'Ø' + e.diameter_mm : null,
              e.calendar_days != null ? e.calendar_days + ' сут' : null,
              (e.crew_masters != null || e.crew_exec != null)
                ? (e.crew_masters || 0) + 'м+' + (e.crew_exec || 0) + 'сл'
                : null
            ].filter(Boolean);
            return '<article class="wn-exp">' +
              '<div class="wn-exp-top">' +
              '<div><strong>' + esc(catTitle) + '</strong> ' + expStatusPill(e.status) +
              '<div style="margin-top:4px;font-size:13px;color:var(--t2)">' + esc(bits.join(' · ') || 'без деталей') + '</div>' +
              (e.derived_value != null
                ? '<div style="margin-top:6px;font-size:14px">→ <strong>' + esc(String(e.derived_value)) +
                  ' ' + esc(e.derived_unit || '') + '</strong>' +
                  (e.derived_trace ? ' <span class="muted" style="font-size:11px">(' + esc(e.derived_trace) + ')</span>' : '') +
                  '</div>'
                : '') +
              (e.story_text ? '<div class="muted" style="font-size:12px;margin-top:6px">' + esc(String(e.story_text).slice(0, 220)) +
                (e.story_text.length > 220 ? '…' : '') + '</div>' : '') +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start">' +
              (canWrite && e.status === 'draft'
                ? '<button type="button" class="btn mini ghost wn-exp-confirm" data-id="' + e.id + '">Подтвердить</button>'
                : '') +
              (canWrite && (e.status === 'confirmed' || e.status === 'published')
                ? '<button type="button" class="btn mini wn-exp-publish" data-id="' + e.id + '">В нормы</button>'
                : '') +
              '</div></div></article>';
          }).join('') + '</div>'
          : '<p class="wn-empty">Пока нет записей опыта. Добавьте первый факт с объекта.</p>');
    }

    function catOptions(selected) {
      return (catalog.categories || []).map((c) =>
        '<option value="' + esc(c.code) + '"' + (c.code === selected ? ' selected' : '') + '>' +
        esc(c.title) + '</option>'
      ).join('');
    }

    function methodOptions(catCode, selected) {
      const cat = (catalog.categories || []).find((c) => c.code === catCode);
      const methods = methodsOf(cat);
      if (!methods.length) return '<option value="">—</option>';
      return methods.map((m) =>
        '<option value="' + esc(m.code) + '"' + (m.code === selected ? ' selected' : '') + '>' +
        esc(m.label) + '</option>'
      ).join('');
    }

    function experienceVolumeFieldsHtml(catCode, methodCode, pre) {
      pre = pre || {};
      const cat = (catalog.categories || []).find((c) => c.code === catCode);
      const fields = experienceFieldsFor(cat, methodCode);
      const extras = pre.extras_json || {};
      if (!fields.length) {
        // fallback legacy
        return '<div style="display:flex;gap:8px;flex-wrap:wrap" id="exDynFields">' +
          '<label>Кол-во ед.<input class="inp ex-dyn" data-role="qty" id="exQty" type="number" step="any" value="' + (pre.qty ?? '') + '" style="width:90px"/></label>' +
          '<label>Объём<input class="inp ex-dyn" data-role="volume" id="exVol" type="number" step="any" value="' + (pre.volume_value ?? '') + '" style="width:100px"/></label>' +
          '<label>Ед.<input class="inp" id="exVolU" value="' + esc(pre.volume_unit || '') + '" style="width:90px"/></label>' +
          '<label>Ø мм<input class="inp ex-dyn" data-role="diameter" id="exDia" type="number" step="any" value="' + (pre.diameter_mm ?? '') + '" style="width:80px"/></label>' +
          '</div>';
      }
      return '<div style="display:flex;gap:8px;flex-wrap:wrap" id="exDynFields">' +
        fields.map((f) => {
          let val = '';
          if (f.role === 'qty') val = pre.qty ?? extras[f.key] ?? '';
          else if (f.role === 'volume') val = pre.volume_value ?? extras[f.key] ?? '';
          else if (f.role === 'diameter') val = pre.diameter_mm ?? extras[f.key] ?? '';
          else if (f.role === 'length') val = pre.length_m ?? extras[f.key] ?? '';
          else val = extras[f.key] ?? pre[f.key] ?? '';
          return '<label>' + esc(f.label) +
            (f.unit ? ' <span class="muted">(' + esc(f.unit) + ')</span>' : '') +
            '<input class="inp ex-dyn" data-key="' + esc(f.key) + '" data-role="' + esc(f.role || 'extra') +
            '" type="number" step="any" value="' + esc(String(val)) + '" style="width:110px"/></label>';
        }).join('') +
        '<input type="hidden" id="exVolU" value="' + esc((experienceMeta(cat, methodCode).volume_unit) || pre.volume_unit || '') + '"/>' +
        '</div>';
    }

    function experienceFormHtml(pre) {
      pre = pre || {};
      const catCode = pre.category_code || ((catalog.categories || [])[0] || {}).code || '';
      const methodCode = pre.method_code || '';
      return '<div style="display:grid;gap:8px;max-height:70vh;overflow:auto;padding-right:4px">' +
        '<label>Направление<select class="inp" id="exCat" style="width:100%">' + catOptions(catCode) + '</select></label>' +
        '<label>Метод / поднаправление<select class="inp" id="exMethod" style="width:100%">' +
        methodOptions(catCode, methodCode) + '</select></label>' +
        '<label>Рассказ / суть<textarea class="inp" id="exStory" rows="3" style="width:100%" placeholder="Факт с объекта: объём, срок, бригада, условия…">' +
        esc(pre.story_text || '') + '</textarea></label>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<label>Заказчик<input class="inp" id="exCust" value="' + esc(pre.customer_name || '') + '" style="width:160px"/></label>' +
        '<label>Объект<input class="inp" id="exObj" value="' + esc(pre.object_name || pre.object_label || '') + '" style="width:160px"/></label>' +
        '<label>ID работы<input class="inp" id="exWork" type="number" value="' + (pre.source_work_id || '') + '" style="width:100px" placeholder="опц."/></label>' +
        '<button type="button" class="btn mini ghost" id="exLoadWork" style="align-self:end">Подтянуть из работы</button>' +
        '</div>' +
        '<div class="muted" style="font-size:12px">Поля объёма для выбранного направления:</div>' +
        experienceVolumeFieldsHtml(catCode, methodCode || undefined, pre) +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<label>Отложения<select class="inp" id="exFoul">' +
        '<option value="">—</option>' +
        '<option value="light"' + (pre.fouling === 'light' ? ' selected' : '') + '>лёгкие</option>' +
        '<option value="medium"' + (pre.fouling === 'medium' ? ' selected' : '') + '>средние</option>' +
        '<option value="heavy"' + (pre.fouling === 'heavy' ? ' selected' : '') + '>тяжёлые</option></select></label>' +
        '<label>Уточнение<input class="inp" id="exFoulN" value="' + esc(pre.fouling_note || '') + '" placeholder="бетон / кокс…" style="width:140px"/></label>' +
        '<label>Сутки<input class="inp" id="exDays" type="number" step="any" value="' + (pre.calendar_days ?? '') + '" style="width:80px"/></label>' +
        '<label>Смен/сут<select class="inp" id="exShift"><option value="2"' +
        (Number(pre.shift_mode) !== 1 ? ' selected' : '') + '>2</option><option value="1"' +
        (Number(pre.shift_mode) === 1 ? ' selected' : '') + '>1</option></select></label>' +
        '<label>Мастеров<input class="inp" id="exMas" type="number" value="' + (pre.crew_masters ?? '') + '" style="width:70px"/></label>' +
        '<label>Слесарей<input class="inp" id="exExec" type="number" value="' + (pre.crew_exec ?? '') + '" style="width:70px"/></label>' +
        '</div>' +
        '<label>Оборудование<textarea class="inp" id="exEquip" rows="1" style="width:100%">' + esc(pre.equipment_text || '') + '</textarea></label>' +
        '<div id="exDerived" class="muted" style="font-size:13px"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">' +
        '<button type="button" class="btn mini ghost" id="wnCancel">Отмена</button>' +
        '<button type="button" class="btn mini ghost" id="exDerive">Пересчитать норму</button>' +
        '<button type="button" class="btn mini" id="wnSave">Сохранить черновик</button></div></div>';
    }

    function readExpForm() {
      const extras = {};
      let qty = null;
      let volume_value = null;
      let diameter_mm = null;
      let length_m = null;
      document.querySelectorAll('.ex-dyn').forEach((inp) => {
        const role = inp.dataset.role;
        const key = inp.dataset.key;
        const raw = inp.value;
        if (raw === '') return;
        const num = Number(raw);
        if (role === 'qty') qty = num;
        else if (role === 'volume') volume_value = num;
        else if (role === 'diameter') diameter_mm = num;
        else if (role === 'length') length_m = num;
        else if (key) extras[key] = num;
      });
      // qty/volume могут быть и в extras-ключах
      if (qty == null && extras.qty != null) qty = extras.qty;
      if (volume_value == null && extras.volume_value != null) volume_value = extras.volume_value;
      if (diameter_mm == null && extras.diameter_mm != null) diameter_mm = extras.diameter_mm;
      if (length_m == null && extras.length_m != null) length_m = extras.length_m;
      return {
        category_code: document.getElementById('exCat')?.value,
        method_code: document.getElementById('exMethod')?.value || null,
        story_text: document.getElementById('exStory')?.value,
        customer_name: document.getElementById('exCust')?.value || null,
        object_name: document.getElementById('exObj')?.value || null,
        object_label: document.getElementById('exObj')?.value || null,
        source_work_id: document.getElementById('exWork')?.value
          ? Number(document.getElementById('exWork').value) : null,
        qty,
        volume_value,
        volume_unit: document.getElementById('exVolU')?.value || null,
        diameter_mm,
        length_m,
        fouling: document.getElementById('exFoul')?.value || null,
        fouling_note: document.getElementById('exFoulN')?.value || null,
        calendar_days: document.getElementById('exDays')?.value !== '' ? Number(document.getElementById('exDays').value) : null,
        shift_mode: Number(document.getElementById('exShift')?.value) || 2,
        crew_masters: document.getElementById('exMas')?.value !== '' ? Number(document.getElementById('exMas').value) : null,
        crew_exec: document.getElementById('exExec')?.value !== '' ? Number(document.getElementById('exExec').value) : null,
        equipment_text: document.getElementById('exEquip')?.value || null,
        extras_json: extras
      };
    }

    function refreshExpDynFields() {
      const catCode = document.getElementById('exCat')?.value;
      const methodCode = document.getElementById('exMethod')?.value;
      const wrap = document.getElementById('exDynFields');
      if (!wrap) return;
      const html = experienceVolumeFieldsHtml(catCode, methodCode, {});
      // replace parent content of dyn fields — experienceVolumeFieldsHtml returns the whole div
      wrap.outerHTML = html;
    }

    async function showDerive() {
      const body = readExpForm();
      try {
        const r = await api('/api/work-norms/experiences/derive', { method: 'POST', body });
        const d = r.derived || {};
        const el = document.getElementById('exDerived');
        if (!el) return;
        let html = d.derived_value != null
          ? '<strong>Вывод:</strong> ' + esc(String(d.derived_value)) + ' ' + esc(d.derived_unit || '') +
            '<br/><span class="muted">' + esc(d.derived_trace || '') + '</span>'
          : '<span class="muted">Пока не хватает данных для формулы</span>';
        if (d.questions?.length) html += '<br/>❓ ' + d.questions.map(esc).join('; ');
        if (d.clarifications?.length) html += '<br/>⚠ ' + d.clarifications.map(esc).join('; ');
        el.innerHTML = html;
      } catch (e) {
        toast('Вывод', e.message || '', 'err');
      }
    }

    function openManualForm(prefill) {
      showModal({
        title: 'Внести опыт с объекта',
        html: experienceFormHtml(prefill),
        onMount: () => {
          document.getElementById('wnCancel')?.addEventListener('click', hideModal);
          document.getElementById('exDerive')?.addEventListener('click', showDerive);
          document.getElementById('exCat')?.addEventListener('change', () => {
            const catCode = document.getElementById('exCat')?.value;
            const methodSel = document.getElementById('exMethod');
            if (methodSel) methodSel.innerHTML = methodOptions(catCode, '');
            refreshExpDynFields();
            showDerive();
          });
          document.getElementById('exMethod')?.addEventListener('change', () => {
            refreshExpDynFields();
            showDerive();
          });
          document.getElementById('exLoadWork')?.addEventListener('click', async () => {
            const id = Number(document.getElementById('exWork')?.value);
            if (!id) { toast('ID работы', 'Укажите номер', 'err'); return; }
            try {
              const r = await api('/api/work-norms/works/' + id + '/hint');
              const h = r.hint || {};
              if (h.customer_name) document.getElementById('exCust').value = h.customer_name;
              if (h.object_name) document.getElementById('exObj').value = h.object_name;
              if (h.calendar_days != null) document.getElementById('exDays').value = h.calendar_days;
              if (h.crew_exec != null) document.getElementById('exExec').value = h.crew_exec;
              if (h.equipment_text) document.getElementById('exEquip').value = h.equipment_text;
              toast('Работа', h.note || 'Подтянуты дни и бригада. Объём укажите сами.', 'ok');
              await showDerive();
            } catch (e) {
              toast('Работа', e.message || '', 'err');
            }
          });
          document.getElementById('wnSave')?.addEventListener('click', async () => {
            const body = readExpForm();
            if (!body.story_text || body.story_text.trim().length < 10) {
              toast('Рассказ', 'Минимум 10 символов', 'err');
              return;
            }
            body.comment = 'Черновик опыта с объекта';
            try {
              await api('/api/work-norms/experiences', { method: 'POST', body });
              hideModal();
              toast('Опыт', 'Сохранён черновик', 'ok');
              chip = 'experience';
              await load();
            } catch (e) {
              toast('Ошибка', e.message || '', 'err');
            }
          });
          showDerive();
        }
      });
    }

    function openAiPropose() {
      showModal({
        title: 'Рассказ → карточка опыта (ИИ предлагает)',
        html:
          '<p class="muted" style="font-size:12px;margin:0 0 8px">ИИ не пишет в нормы. Вы проверяете и подтверждаете.</p>' +
          '<label>Направление (опц.)<select class="inp" id="aiCat" style="width:100%"><option value="">— авто —</option>' +
          catOptions() + '</select></label>' +
          '<label style="display:block;margin-top:8px">ID закрытой работы (опц.)' +
          '<input class="inp" id="aiWork" type="number" style="width:100%" placeholder="подтянет дни/бригаду"/></label>' +
          '<label style="display:block;margin-top:8px">2–3 предложения<textarea class="inp" id="aiStory" rows="4" style="width:100%" ' +
          'placeholder="На Апатите чистили 4 ТО по 1700 трубок Ø32, бетонные отложения, Вулкан, ~2 месяца, 2 мастера и 16 слесарей"></textarea></label>' +
          '<div id="aiOut" class="muted" style="margin-top:8px;font-size:13px"></div>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
          '<button type="button" class="btn mini ghost" id="wnCancel">Отмена</button>' +
          '<button type="button" class="btn mini" id="aiGo">Разобрать</button></div>',
        onMount: () => {
          document.getElementById('wnCancel')?.addEventListener('click', hideModal);
          document.getElementById('aiGo')?.addEventListener('click', async () => {
            const story_text = document.getElementById('aiStory')?.value || '';
            const out = document.getElementById('aiOut');
            if (out) out.textContent = 'Думаю…';
            try {
              const r = await api('/api/work-norms/experiences/propose', {
                method: 'POST',
                body: {
                  story_text,
                  category_code: document.getElementById('aiCat')?.value || null,
                  source_work_id: document.getElementById('aiWork')?.value
                    ? Number(document.getElementById('aiWork').value) : null
                }
              });
              if (!r.ok && !r.proposal) {
                if (out) out.innerHTML = '<span style="color:var(--danger,#c44)">' +
                  esc((r.questions || []).join('; ') || 'не разобрано') + '</span>';
                return;
              }
              const p = r.proposal || {};
              let msg = '';
              if (r.needs_clarification) {
                msg += '<div style="color:var(--warn,#c90);margin-bottom:6px">Нужны уточнения: ' +
                  esc((r.questions || []).concat(r.clarifications || []).join('; ')) + '</div>';
              }
              if (p.derived_value != null) {
                msg += '<div>Предлагаемая норма: <strong>' + esc(String(p.derived_value)) + ' ' +
                  esc(p.derived_unit || '') + '</strong><br/><span class="muted">' +
                  esc(p.derived_trace || '') + '</span></div>';
              }
              msg += '<div style="margin-top:8px"><button type="button" class="btn mini" id="aiOpenForm">Открыть в форме и править</button></div>';
              if (out) out.innerHTML = msg;
              document.getElementById('aiOpenForm')?.addEventListener('click', () => {
                hideModal();
                openManualForm(p);
              });
            } catch (e) {
              if (out) out.textContent = e.message || 'ошибка';
            }
          });
        }
      });
    }

    function serviceTitle(id) {
      return (SERVICE_TABS.find((t) => t.id === id) || {}).label || id;
    }

    async function renderMainBody() {
      const cat = currentCategory();
      if (cat) {
        return '<div class="wn-panel-head"><div>' + panelTitle(cat.title) +
          (cat.notes ? '<p class="wn-panel-notes">' + esc(cat.notes) + '</p>' : '') +
          '</div>' +
          '<button type="button" class="btn mini ghost" id="wnExportTop">Excel ↓</button></div>' +
          renderMethodTabs(cat) + renderCalc(cat) +
          '<h4 style="margin:0 0 10px;font-size:13px;color:var(--t2);font-weight:700">Нормы направления</h4>' +
          renderRateCards(cat);
      }
      if (chip === 'experience') return renderExperience();
      const title = serviceTitle(chip);
      let inner = '';
      if (chip === 'globals') inner = renderGlobals();
      else if (chip === 'chemistry') inner = renderChemistry();
      else if (chip === 'equipment') inner = renderEquipment();
      else if (chip === 'history') inner = await renderHistory();
      else inner = '<p class="wn-empty">Раздел не найден</p>';
      return '<div class="wn-panel-head"><div>' + panelTitle(title) + '</div>' +
        '<button type="button" class="btn mini ghost" id="wnExportTop">Excel ↓</button></div>' + inner;
    }

    async function render() {
      if (!catalog) {
        root.innerHTML = '<p class="muted">Загрузка справочника…</p>';
        return;
      }
      snapshotCalc();
      const body = await renderMainBody();
      root.innerHTML =
        '<div class="wn-wrap">' +
        '<p class="wn-intro">Нормы Асгарда на человеческом языке. Слева — направление, справа — калькулятор и карточки. Опыт с объектов калибрует справочник; Мимир читает те же таблицы.</p>' +
        '<div class="wn-layout">' + renderNav() + '<div class="wn-main">' + body + '</div></div></div>';

      if (preview && document.getElementById('wnPreview')) {
        document.getElementById('wnPreview').innerHTML = formatPreview(preview);
      }
      bind();
    }

    function bindExport(el) {
      el?.addEventListener('click', async () => {
        try {
          const r = await fetch('/api/work-norms/export.xlsx', {
            headers: { Authorization: 'Bearer ' + token() }
          });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const blob = await r.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'work_norms.xlsx';
          a.click();
          URL.revokeObjectURL(a.href);
        } catch (e) {
          toast('Excel', e.message || 'Ошибка', 'err');
        }
      });
    }

    function bind() {
      root.querySelectorAll('[data-chip]').forEach((b) => {
        b.addEventListener('click', () => {
          snapshotCalc();
          chip = b.dataset.chip;
          method = null;
          preview = null;
          calcDraft = { inputs: {}, fouling: 'medium', posts: 2, coeffs: [] };
          render();
        });
      });
      root.querySelectorAll('[data-method]').forEach((b) => {
        b.addEventListener('click', () => {
          snapshotCalc();
          method = b.dataset.method;
          preview = null;
          render();
        });
      });

      bindExport(document.getElementById('wnExport'));
      bindExport(document.getElementById('wnExportTop'));

      document.getElementById('wnCalc')?.addEventListener('click', async () => {
        const cat = currentCategory();
        if (!cat) return;
        snapshotCalc();
        const inputs = {};
        root.querySelectorAll('.wn-in').forEach((inp) => {
          if (inp.type === 'checkbox') {
            if (inp.checked) inputs[inp.dataset.key] = 1;
          } else if (inp.value !== '') {
            inputs[inp.dataset.key] = Number(inp.value);
          }
        });
        const coeffs = [];
        root.querySelectorAll('.wn-coeff:checked').forEach((c) => coeffs.push(c.value));
        try {
          preview = await api('/api/work-norms/preview-calc', {
            method: 'POST',
            body: {
              category_code: cat.code,
              method_code: method,
              rate_code: primaryRateCode(cat, method) || undefined,
              inputs,
              fouling: document.getElementById('wnFouling')?.value || 'medium',
              posts: Number(document.getElementById('wnPosts')?.value) || 2,
              coeffs
            }
          });
          const el = document.getElementById('wnPreview');
          if (el) el.innerHTML = formatPreview(preview);
        } catch (e) {
          toast('Расчёт', e.message || 'Ошибка', 'err');
        }
      });

      document.getElementById('wnExpManual')?.addEventListener('click', () => openManualForm());
      document.getElementById('wnExpAi')?.addEventListener('click', openAiPropose);

      root.querySelectorAll('.wn-exp-confirm').forEach((b) => {
        b.addEventListener('click', async () => {
          const comment = await askComment('Подтверждаю факты и вывод нормы');
          if (!comment) return;
          try {
            await api('/api/work-norms/experiences/' + b.dataset.id + '/confirm', {
              method: 'POST', body: { comment }
            });
            toast('Опыт', 'Подтверждён', 'ok');
            await load();
          } catch (e) {
            toast('Ошибка', e.message || '', 'err');
          }
        });
      });

      root.querySelectorAll('.wn-exp-publish').forEach((b) => {
        b.addEventListener('click', () => {
          showModal({
            title: 'Публикация в справочник норм',
            html:
              '<p class="muted" style="font-size:12px">Как обновить существующую норму?</p>' +
              '<label><input type="radio" name="wnPubMode" value="replace" checked/> Заменить значение</label><br/>' +
              '<label><input type="radio" name="wnPubMode" value="average"/> Усреднить со старым</label><br/>' +
              '<label><input type="radio" name="wnPubMode" value="note_only"/> Только заметка (цифру не трогать)</label>' +
              '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
              '<button type="button" class="btn mini ghost" id="wnCancel">Отмена</button>' +
              '<button type="button" class="btn mini" id="wnPubGo">Далее…</button></div>',
            onMount: () => {
              document.getElementById('wnCancel')?.addEventListener('click', hideModal);
              document.getElementById('wnPubGo')?.addEventListener('click', async () => {
                const mode = document.querySelector('input[name="wnPubMode"]:checked')?.value || 'replace';
                hideModal();
                const comment = await askComment('Публикую опыт в нормы: …');
                if (!comment) return;
                try {
                  await api('/api/work-norms/experiences/' + b.dataset.id + '/publish', {
                    method: 'POST', body: { comment, mode }
                  });
                  toast('Нормы', 'Опыт опубликован в справочник', 'ok');
                  await load();
                } catch (e) {
                  toast('Ошибка', e.message || '', 'err');
                }
              });
            }
          });
        });
      });

      root.querySelectorAll('.wn-edit-rate').forEach((b) => {
        b.addEventListener('click', () => editRate(Number(b.dataset.id)));
      });
      root.querySelectorAll('.wn-edit-global').forEach((b) => {
        b.addEventListener('click', () => editGlobal(b.dataset.key));
      });
      root.querySelectorAll('.wn-edit-chem').forEach((b) => {
        b.addEventListener('click', () => editChem(Number(b.dataset.id)));
      });
      root.querySelectorAll('.wn-edit-equip').forEach((b) => {
        b.addEventListener('click', () => editEquip(Number(b.dataset.id)));
      });
    }

    function editRate(id) {
      const r = (catalog.rates || []).find((x) => Number(x.id) === id);
      if (!r) return;
      showModal({
        title: r.name,
        html:
          '<p class="muted" style="font-size:12px;margin:0 0 8px">' + esc(calcKindPhrase(r.calc_kind, r.unit)) + '</p>' +
          '<label>База<input class="inp" id="wnRd" type="number" step="any" value="' + (r.rate_default ?? '') + '" style="width:100%"/></label>' +
          '<div style="display:flex;gap:8px;margin-top:8px">' +
          '<label>Лёгкие<input class="inp" id="wnRl" type="number" step="any" value="' + (r.rate_loose ?? '') + '"/></label>' +
          '<label>Средние<input class="inp" id="wnRm" type="number" step="any" value="' + (r.rate_medium ?? '') + '"/></label>' +
          '<label>Тяжёлые<input class="inp" id="wnRh" type="number" step="any" value="' + (r.rate_hard ?? '') + '"/></label></div>' +
          '<label style="display:block;margin-top:8px">Заметки<textarea class="inp" id="wnNotes" rows="2" style="width:100%">' + esc(r.notes || '') + '</textarea></label>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
          '<button type="button" class="btn mini ghost" id="wnCancel">Отмена</button>' +
          '<button type="button" class="btn mini" id="wnSave">Сохранить…</button></div>',
        onMount: () => {
          document.getElementById('wnCancel')?.addEventListener('click', hideModal);
          document.getElementById('wnSave')?.addEventListener('click', async () => {
            const body = {
              rate_default: document.getElementById('wnRd')?.value === '' ? null : Number(document.getElementById('wnRd')?.value),
              rate_loose: document.getElementById('wnRl')?.value === '' ? null : Number(document.getElementById('wnRl')?.value),
              rate_medium: document.getElementById('wnRm')?.value === '' ? null : Number(document.getElementById('wnRm')?.value),
              rate_hard: document.getElementById('wnRh')?.value === '' ? null : Number(document.getElementById('wnRh')?.value),
              notes: document.getElementById('wnNotes')?.value
            };
            hideModal();
            const comment = await askComment();
            if (!comment) return;
            try {
              await api('/api/work-norms/rates/' + id, { method: 'PUT', body: { ...body, comment } });
              toast('Норма', 'Обновлена', 'ok');
              await load();
            } catch (e) {
              toast('Ошибка', e.message || '', 'err');
            }
          });
        }
      });
    }

    function editGlobal(key) {
      const r = (catalog.globalsRows || []).find((x) => x.key === key);
      if (!r) return;
      showModal({
        title: r.label,
        html:
          '<label>Значение<input class="inp" id="wnGv" type="number" step="any" value="' + (r.value_num ?? '') + '" style="width:100%"/></label>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
          '<button type="button" class="btn mini ghost" id="wnCancel">Отмена</button>' +
          '<button type="button" class="btn mini" id="wnSave">Сохранить…</button></div>',
        onMount: () => {
          document.getElementById('wnCancel')?.addEventListener('click', hideModal);
          document.getElementById('wnSave')?.addEventListener('click', async () => {
            const value_num = Number(document.getElementById('wnGv')?.value);
            hideModal();
            const comment = await askComment();
            if (!comment) return;
            try {
              await api('/api/work-norms/globals/' + encodeURIComponent(key), {
                method: 'PUT', body: { value_num, comment }
              });
              toast('Globals', 'Сохранено', 'ok');
              await load();
            } catch (e) {
              toast('Ошибка', e.message || '', 'err');
            }
          });
        }
      });
    }

    function editChem(id) {
      const c = (catalog.chemistry || []).find((x) => Number(x.id) === id);
      if (!c) return;
      showModal({
        title: c.name,
        html:
          '<label>₽/кг<input class="inp" id="wnCp" type="number" step="any" value="' + (c.price_kg ?? '') + '" style="width:100%"/></label>' +
          '<label style="margin-top:8px;display:block">кг/м²<input class="inp" id="wnCm2" type="number" step="any" value="' + (c.kg_per_m2 ?? '') + '" style="width:100%"/></label>' +
          '<label style="margin-top:8px;display:block">кг/м³<input class="inp" id="wnCm3" type="number" step="any" value="' + (c.kg_per_m3 ?? '') + '" style="width:100%"/></label>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
          '<button type="button" class="btn mini ghost" id="wnCancel">Отмена</button>' +
          '<button type="button" class="btn mini" id="wnSave">Сохранить…</button></div>',
        onMount: () => {
          document.getElementById('wnCancel')?.addEventListener('click', hideModal);
          document.getElementById('wnSave')?.addEventListener('click', async () => {
            const body = {
              price_kg: Number(document.getElementById('wnCp')?.value),
              kg_per_m2: Number(document.getElementById('wnCm2')?.value),
              kg_per_m3: Number(document.getElementById('wnCm3')?.value)
            };
            hideModal();
            const comment = await askComment();
            if (!comment) return;
            try {
              await api('/api/work-norms/chemistry/' + id, { method: 'PUT', body: { ...body, comment } });
              toast('Химия', 'Сохранено', 'ok');
              await load();
            } catch (e) {
              toast('Ошибка', e.message || '', 'err');
            }
          });
        }
      });
    }

    function editEquip(id) {
      const e = (catalog.equipment || []).find((x) => Number(x.id) === id);
      if (!e) return;
      showModal({
        title: e.name,
        html:
          '<label>Цена stub, ₽<input class="inp" id="wnEp" type="number" step="any" value="' + (e.stub_price_rub ?? '') + '" style="width:100%"/></label>' +
          '<label style="margin-top:8px;display:block">CAPEX в себес %<input class="inp" id="wnEc" type="number" step="any" value="' + (e.capex_in_cost_pct ?? '') + '" style="width:100%"/></label>' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
          '<button type="button" class="btn mini ghost" id="wnCancel">Отмена</button>' +
          '<button type="button" class="btn mini" id="wnSave">Сохранить…</button></div>',
        onMount: () => {
          document.getElementById('wnCancel')?.addEventListener('click', hideModal);
          document.getElementById('wnSave')?.addEventListener('click', async () => {
            const body = {
              stub_price_rub: Number(document.getElementById('wnEp')?.value),
              capex_in_cost_pct: Number(document.getElementById('wnEc')?.value)
            };
            hideModal();
            const comment = await askComment();
            if (!comment) return;
            try {
              await api('/api/work-norms/equipment/' + id, { method: 'PUT', body: { ...body, comment } });
              toast('Оборудование', 'Сохранено', 'ok');
              await load();
            } catch (err) {
              toast('Ошибка', err.message || '', 'err');
            }
          });
        }
      });
    }

    root.innerHTML = '<p class="muted">Загрузка справочника…</p>';
    try {
      await load();
    } catch (e) {
      root.innerHTML = '<div class="alert warn">Не удалось загрузить справочник: ' + esc(e.message || String(e)) +
        '. Проверьте миграции V309–V312.</div>';
    }
  }

  return { mount, WRITE_ROLES };
})();
