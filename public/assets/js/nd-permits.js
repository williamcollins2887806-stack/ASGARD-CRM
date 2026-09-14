/**
 * ASGARD ND — электронные наряды (конструктор WYSIWYG + справочник)
 * AsgardNdPermits.renderCatalog / renderFieldTab / openEditor
 */
window.AsgardNdPermits = (function () {
  'use strict';

  const CSS_VER = '1.3.0';
  const ROLE_OPTS = [
    { v: 'member', t: 'Член бригады' },
    { v: 'producer', t: 'Производитель' },
    { v: 'admitter', t: 'Допускающий' },
    { v: 'observer', t: 'Наблюдающий' },
    { v: 'issuer', t: 'Выдающий' },
  ];
  const CAT_OPTS = [
    { v: 'general', t: 'Общее' },
    { v: 'heat', t: 'Тепло' },
    { v: 'fire', t: 'Огневые' },
    { v: 'gas', t: 'Газоопасные' },
    { v: 'height', t: 'Высота' },
    { v: 'loto', t: 'Отключения' },
    { v: 'electrical', t: 'Электро' },
    { v: 'chem', t: 'Химия' },
    { v: 'pressure', t: 'Давление' },
  ];
  const FIELD_PH = {
    role: 'Роль',
    fio: 'ФИО',
    note: 'Примечание',
    title: 'Мероприятие',
    done: 'вып.',
    device: 'Оборудование',
    action: 'Отключение',
    lock: 'Блокировка',
    item: 'СИЗ / система',
    anchor: 'Анкер',
    at: 'Время',
    place: 'Место',
    component: 'Компонент',
    value: 'Значение',
  };
  const STATUS = {
    draft: { label: 'Черновик', color: '#94a3b8' },
    issued: { label: 'Утверждён', color: '#16a34a' },
    active: { label: 'Действует', color: '#ca8a04' },
    extended: { label: 'Продлён', color: '#0284c7' },
    closed: { label: 'Закрыт', color: '#64748b' },
    cancelled: { label: 'Аннулирован', color: '#dc2626' },
  };

  function ensureStyles() {
    if (document.getElementById('nd-styles-link')) return;
    const link = document.createElement('link');
    link.id = 'nd-styles-link';
    link.rel = 'stylesheet';
    link.href = 'assets/css/nd-permits.css?v=' + CSS_VER;
    document.head.appendChild(link);
  }

  function hdr() {
    const t = localStorage.getItem('asgard_token') || localStorage.getItem('auth_token');
    return { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' };
  }

  async function api(path, opts) {
    const r = await fetch('/api/nd' + path, { headers: hdr(), ...opts });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.message || 'HTTP ' + r.status);
    return data;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function roleLabel(v) {
    const o = ROLE_OPTS.find((x) => x.v === v);
    return o ? o.t : v || 'Член бригады';
  }

  function catRu(c) {
    const o = CAT_OPTS.find((x) => x.v === c);
    return o ? o.t : c || 'Общее';
  }

  /** User-facing text: strip English jargon (LOTO etc.) */
  function ruText(s) {
    return String(s == null ? '' : s)
      .replace(/Отключения\s*\/\s*LOTO/gi, 'Отключения и блокировки')
      .replace(/\bLOTO\s*:/gi, 'Блокировка:')
      .replace(/\bLOTO\b/gi, 'блокировка')
      .replace(/\bPPE\b/gi, 'СИЗ')
      .trim();
  }

  function blockTitle(b) {
    return ruText(b && (b.title || b.id)) || 'Блок';
  }

  function matchQuery(q, ...parts) {
    if (!q) return true;
    const hay = parts
      .filter((x) => x != null && x !== '')
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  }

  function catSelectHtml(id, val) {
    const cur = val || 'general';
    return `<select class="nd-select" id="${id}">${CAT_OPTS.map(
      (o) => `<option value="${o.v}" ${o.v === cur ? 'selected' : ''}>${o.t}</option>`
    ).join('')}</select>`;
  }

  function toast(msg, ok) {
    if (window.AsgardUI && AsgardUI.toast) AsgardUI.toast(msg, ok === false ? 'error' : 'ok');
    else alert(msg);
  }

  function stamp(status) {
    const s = STATUS[status] || { label: status, color: '#888' };
    return `<span class="nd-stamp" style="--nd-c:${s.color}">${esc(s.label)}</span>`;
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function fromLocalInput(v) {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (_) {
      return '—';
    }
  }

  function parseSchema(tpl) {
    if (!tpl) return { blocks: [], default_risk_codes: [] };
    const s = tpl.schema_json;
    if (!s) return { blocks: [], default_risk_codes: [] };
    if (typeof s === 'string') {
      try {
        return JSON.parse(s);
      } catch (_) {
        return { blocks: [], default_risk_codes: [] };
      }
    }
    return s;
  }

  function defaultEnabled(schema) {
    return (schema.blocks || []).filter((b) => b.default_on !== false).map((b) => b.id);
  }

  function normalizeSections(raw, schema) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const enabled =
      Array.isArray(src.enabled_blocks) && src.enabled_blocks.length
        ? src.enabled_blocks.map(String)
        : defaultEnabled(schema);
    return {
      enabled_blocks: enabled,
      persons: Array.isArray(src.persons) ? src.persons : [],
      prep: Array.isArray(src.prep) ? src.prep : [],
      gas_analysis: Array.isArray(src.gas_analysis) ? src.gas_analysis : [],
      fire_watch: src.fire_watch && typeof src.fire_watch === 'object' ? src.fire_watch : {},
      atmosphere: Array.isArray(src.atmosphere) ? src.atmosphere : [],
      loto: Array.isArray(src.loto) ? src.loto : [],
      height_gear: Array.isArray(src.height_gear) ? src.height_gear : [],
      daily_rows: Array.isArray(src.daily_rows) ? src.daily_rows : [],
      extension_rows: Array.isArray(src.extension_rows) ? src.extension_rows : [],
      acks_rows: Array.isArray(src.acks_rows) ? src.acks_rows : [],
      closing: src.closing && typeof src.closing === 'object' ? src.closing : {},
    };
  }

  function blockOn(sec, id) {
    return (sec.enabled_blocks || []).includes(id);
  }

  function checkHtml(attrs, labelHtml) {
    return `<label class="nd-check"><input type="checkbox" ${attrs}/><span class="nd-check-box" aria-hidden="true"></span><span>${labelHtml}</span></label>`;
  }

  function roleSelect(val, dis, dataAttr) {
    return `<select class="nd-select nd-role" ${dataAttr || ''} ${dis}>${ROLE_OPTS.map(
      (o) => `<option value="${o.v}" ${o.v === (val || 'member') ? 'selected' : ''}>${o.t}</option>`
    ).join('')}</select>`;
  }

  function paperTable(headers, rows, yellowAll) {
    const body =
      (rows && rows.length ? rows : [headers.map(() => '')])
        .map(
          (row) =>
            `<tr>${row
              .map((c) => `<td class="${yellowAll ? 'nd-y' : ''}">${esc(c == null || c === '' ? ' ' : c)}</td>`)
              .join('')}</tr>`
        )
        .join('') || '';
    return `<table class="nd-ptbl"><thead><tr>${headers
      .map((h) => `<th>${esc(h)}</th>`)
      .join('')}</tr></thead><tbody>${body}</tbody></table>`;
  }

  // ── Catalog page ─────────────────────────────────────────────────────
  async function renderCatalog({ layout, title }) {
    ensureStyles();
    const html = `
      <div class="nd-page">
        <div class="nd-hazard"></div>
        <div class="nd-hero">
          <div>
            <div class="nd-kicker">ОХРАНА ТРУДА · ПРОМБЕЗОПАСНОСТЬ</div>
            <h1>${esc(title || 'Электронные наряды')}</h1>
            <p>Госформы 924н / 528 / ОЗП, каталог рисков и барьеров. Конструктор — во вкладке «Наряды» работы. Утверждает мастер в PWA.</p>
          </div>
        </div>
        <div class="nd-grid2">
          <section class="nd-panel" id="ndTplPanel"><div class="help">Загрузка форм…</div></section>
          <section class="nd-panel" id="ndRiskPanel"><div class="help">Загрузка рисков…</div></section>
        </div>
        <section class="nd-panel" id="ndCrudPanel" style="margin-top:14px"></section>
      </div>`;
    await layout(html, { title: title || 'Наряды-допуски' });
    await paintCatalogPanels();
  }

  async function paintCatalogPanels() {
    const [tpl, risks, measures] = await Promise.all([api('/templates'), api('/risks'), api('/measures')]);
    let activeForm = '';
    let riskQuery = '';
    let measureQuery = '';

    const tplPanel = document.getElementById('ndTplPanel');
    const riskPanel = document.getElementById('ndRiskPanel');
    const crud = document.getElementById('ndCrudPanel');

    function formBadge(code) {
      if (!code) return 'Форма';
      if (String(code).indexOf('924') >= 0) return 'Форма 924н';
      if (String(code).indexOf('528') >= 0) return 'Форма 528';
      if (String(code).indexOf('903') >= 0) return 'Форма 903н';
      if (code === 'ozp') return 'ОЗП';
      if (code === 'height') return 'Работы на высоте';
      return 'Тип наряда';
    }

    function riskMatchesForm(r, code) {
      if (!code) return true;
      const fc = r.form_codes || r.forms || [];
      if (!fc.length) return true;
      return fc.map(String).includes(String(code));
    }

    function paintTpl() {
      tplPanel.innerHTML = `
      <h3>Типы нарядов <span class="nd-muted">${(tpl.templates || []).length}</span></h3>
      <div class="nd-hint" style="margin-bottom:10px">Нажмите тип — справа отфильтруются риски этой формы</div>
      <div class="nd-cards">
        ${(tpl.templates || [])
          .map((t) => {
            const sch = parseSchema(t);
            const n = (sch.blocks || []).length;
            const defs = (sch.default_risk_codes || []).length;
            const active = activeForm === t.code ? ' nd-card-active' : '';
            return `
          <div class="nd-card ${t.template_ready ? '' : 'nd-card-dim'}${active}" data-form="${esc(t.code)}" role="button" tabindex="0">
            <div class="nd-card-badge">${esc(formBadge(t.code))}</div>
            <div class="nd-card-title">${esc(ruText(t.title))}</div>
            <div class="nd-card-meta">${esc(ruText(t.legal_basis || ''))}</div>
            <div class="nd-card-foot">${t.template_ready ? 'Готов' : 'В подготовке'} · ${n} блоков · ${defs} базовых рисков · до ${t.max_days} сут.</div>
          </div>`;
          })
          .join('')}
      </div>
      <div id="ndTplDetail" class="nd-tpl-detail" style="display:none"></div>`;

      tplPanel.querySelectorAll('.nd-card[data-form]').forEach((card) => {
        const open = () => {
          activeForm = card.dataset.form;
          const t = (tpl.templates || []).find((x) => x.code === activeForm);
          paintTpl();
          const detail = document.getElementById('ndTplDetail');
          const sch = parseSchema(t);
          if (detail && t) {
            detail.style.display = 'block';
            detail.innerHTML = `<strong>${esc(ruText(t.title))}</strong><br>
              ${esc(ruText(t.legal_basis || ''))}<br><br>
              Блоки бланка: ${(sch.blocks || []).map((b) => esc(blockTitle(b))).join(' · ') || '—'}<br>
              Базовых рисков: ${(sch.default_risk_codes || []).length}<br>
              <span class="nd-muted">Создание наряда — во вкладке «Наряды» карточки работы. Здесь тип фильтрует справочник рисков.</span>`;
          }
          paintRiskList();
          toast('Показаны риски: ' + ruText(t && t.title));
        };
        card.onclick = open;
        card.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        };
      });
    }

    function paintRiskList() {
      const list = (risks.risks || []).filter(
        (r) =>
          riskMatchesForm(r, activeForm) &&
          matchQuery(riskQuery, r.title, r.description, catRu(r.category), ...(r.measures || []).map((m) => m.title))
      );
      riskPanel.innerHTML = `
      <h3>Риски и меры <span class="nd-muted">${list.length}${activeForm ? ' · фильтр формы' : ''}</span></h3>
      <input class="nd-search" id="ndRiskSearch" type="search" placeholder="Поиск по рискам и мерам…" value="${esc(riskQuery)}" />
      ${
        activeForm
          ? `<button type="button" class="nd-btn nd-btn-ghost nd-btn-sm" id="ndClearFormFilter" style="margin-bottom:8px">Сбросить фильтр типа</button>`
          : ''
      }
      <div class="nd-risk-list nd-risk-list-tall">
        ${
          list
            .map((r) => {
              const ms = (r.measures || []).map((m) => ruText(m.title)).join(' · ') || '—';
              return `<div class="nd-risk-row" data-risk-id="${r.id}">
              <strong>${esc(ruText(r.title))}</strong>
              <div class="nd-muted">${esc(catRu(r.category))}</div>
              <div class="nd-muted">${esc(ms)}</div>
              <div class="nd-risk-row-actions">
                <button type="button" class="nd-btn nd-btn-ghost nd-btn-sm" data-edit-risk="${r.id}">Изменить</button>
                <button type="button" class="nd-btn nd-btn-danger nd-btn-sm" data-del-risk="${r.id}">Скрыть</button>
              </div>
            </div>`;
            })
            .join('') || '<div class="nd-empty-kit">Ничего не найдено</div>'
        }
      </div>`;

      const search = document.getElementById('ndRiskSearch');
      if (search) {
        search.oninput = () => {
          riskQuery = search.value.trim().toLowerCase();
          paintRiskList();
          const el = document.getElementById('ndRiskSearch');
          if (el) {
            el.focus();
            const len = el.value.length;
            el.setSelectionRange(len, len);
          }
        };
      }
      const clr = document.getElementById('ndClearFormFilter');
      if (clr) {
        clr.onclick = () => {
          activeForm = '';
          paintTpl();
          paintRiskList();
        };
      }
      riskPanel.querySelectorAll('[data-edit-risk]').forEach((btn) => {
        btn.onclick = () => {
          const r = (risks.risks || []).find((x) => x.id === Number(btn.dataset.editRisk));
          if (r) fillCrudRisk(r);
        };
      });
      riskPanel.querySelectorAll('[data-del-risk]').forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm('Скрыть риск из справочника?')) return;
          try {
            await api('/risks/' + btn.dataset.delRisk, { method: 'DELETE' });
            toast('Риск скрыт');
            paintCatalogPanels();
          } catch (e) {
            toast(e.message, false);
          }
        };
      });
    }

    function paintMeasuresList() {
      const wrap = document.getElementById('ndMeasuresList');
      if (!wrap) return;
      const list = (measures.measures || []).filter((m) =>
        matchQuery(measureQuery, m.title, m.description, catRu(m.category))
      );
      wrap.innerHTML =
        list
          .map(
            (m) =>
              `<div class="nd-risk-row"><strong>${esc(ruText(m.title))}</strong>
                <div class="nd-muted">${esc(catRu(m.category))}</div>
                <div class="nd-risk-row-actions">
                  <button type="button" class="nd-btn nd-btn-ghost nd-btn-sm" data-edit-m="${m.id}">Изменить</button>
                  <button type="button" class="nd-btn nd-btn-danger nd-btn-sm" data-del-m="${m.id}">Скрыть</button>
                </div>
              </div>`
          )
          .join('') || '<div class="nd-muted">Ничего не найдено</div>';
      wrap.querySelectorAll('[data-edit-m]').forEach((btn) => {
        btn.onclick = () => {
          const m = (measures.measures || []).find((x) => x.id === Number(btn.dataset.editM));
          if (!m) return;
          document.getElementById('cmEditId').value = m.id;
          document.getElementById('cmCode').value = m.code || '';
          document.getElementById('cmCode').disabled = true;
          document.getElementById('cmTitle').value = m.title || '';
          document.getElementById('cmCat').value = m.category || 'general';
          document.getElementById('cmDesc').value = m.description || '';
          document.getElementById('cmSave').textContent = 'Обновить меру';
          document.getElementById('ndCrudPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
      });
      wrap.querySelectorAll('[data-del-m]').forEach((btn) => {
        btn.onclick = async () => {
          if (!confirm('Скрыть меру?')) return;
          try {
            await api('/measures/' + btn.dataset.delM, { method: 'DELETE' });
            toast('Мера скрыта');
            paintCatalogPanels();
          } catch (e) {
            toast(e.message, false);
          }
        };
      });
    }

    function fillCrudRisk(r) {
      document.getElementById('crEditId').value = r.id;
      document.getElementById('crCode').value = r.code || '';
      document.getElementById('crCode').disabled = true;
      document.getElementById('crTitle').value = r.title || '';
      document.getElementById('crCat').value = r.category || 'general';
      document.getElementById('crDesc').value = r.description || '';
      const ids = new Set((r.measures || []).map((m) => m.id));
      document.querySelectorAll('#crMeasures input[data-mid]').forEach((el) => {
        el.checked = ids.has(Number(el.dataset.mid));
      });
      document.getElementById('crSaveRisk').textContent = 'Обновить риск';
      crud.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    paintTpl();
    paintRiskList();

    crud.innerHTML = `
      <h3>Добавить в справочник</h3>
      <div class="nd-grid2">
        <div class="nd-crud-form" id="ndCrudRisk">
          <div class="nd-side-sec-h">Риск</div>
          <input class="nd-field" id="crCode" placeholder="Служебный код (латиница)" />
          <input class="nd-field" id="crTitle" placeholder="Название риска" />
          <label class="nd-lbl">Категория</label>
          ${catSelectHtml('crCat', 'general')}
          <textarea class="nd-textarea" id="crDesc" rows="2" placeholder="Описание"></textarea>
          <label class="nd-lbl">Связанные меры</label>
          <input class="nd-search" id="crMeasuresSearch" type="search" placeholder="Поиск мер…" />
          <div class="nd-check-list nd-risk-list-tall" style="max-height:min(40vh,360px)" id="crMeasures">
            ${(measures.measures || [])
              .map((m) => {
                const mf = esc((ruText(m.title) + ' ' + catRu(m.category)).toLowerCase());
                return (
                  '<div data-mfilter="' +
                  mf +
                  '">' +
                  checkHtml(
                    'data-mid="' + m.id + '"',
                    '<span>' +
                      esc(ruText(m.title)) +
                      ' <span class="nd-muted">' +
                      esc(catRu(m.category)) +
                      '</span></span>'
                  ) +
                  '</div>'
                );
              })
              .join('') || '<div class="nd-muted">Сначала создайте меры</div>'}
          </div>
          <input type="hidden" id="crEditId" value="" />
          <div class="nd-crud-actions">
            <button type="button" class="nd-btn nd-btn-primary" id="crSaveRisk">Сохранить риск</button>
            <button type="button" class="nd-btn nd-btn-ghost" id="crResetRisk">Сброс</button>
          </div>
        </div>
        <div class="nd-crud-form">
          <div class="nd-side-sec-h">Мера</div>
          <input type="hidden" id="cmEditId" value="" />
          <input class="nd-field" id="cmCode" placeholder="Служебный код (латиница)" />
          <input class="nd-field" id="cmTitle" placeholder="Название меры" />
          <label class="nd-lbl">Категория</label>
          ${catSelectHtml('cmCat', 'general')}
          <textarea class="nd-textarea" id="cmDesc" rows="2" placeholder="Описание"></textarea>
          <div class="nd-crud-actions">
            <button type="button" class="nd-btn nd-btn-primary" id="cmSave">Сохранить меру</button>
            <button type="button" class="nd-btn nd-btn-ghost" id="cmReset">Сброс</button>
          </div>
          <div class="nd-muted" style="margin-top:8px">Всего мер: ${(measures.measures || []).length}</div>
          <input class="nd-search" id="ndMeasureSearch" type="search" placeholder="Поиск по мерам…" value="${esc(measureQuery)}" />
          <div class="nd-risk-list nd-risk-list-tall" id="ndMeasuresList"></div>
        </div>
      </div>`;

    document.getElementById('crMeasuresSearch').oninput = (e) => {
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('#crMeasures [data-mfilter]').forEach((row) => {
        row.style.display = !q || row.dataset.mfilter.includes(q) ? '' : 'none';
      });
    };

    document.getElementById('ndMeasureSearch').oninput = (e) => {
      measureQuery = e.target.value.trim().toLowerCase();
      paintMeasuresList();
      const el = document.getElementById('ndMeasureSearch');
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    };

    paintMeasuresList();

    document.getElementById('crResetRisk').onclick = () => {
      document.getElementById('crEditId').value = '';
      document.getElementById('crCode').disabled = false;
      document.getElementById('crCode').value = '';
      document.getElementById('crTitle').value = '';
      document.getElementById('crCat').value = 'general';
      document.getElementById('crDesc').value = '';
      document.querySelectorAll('#crMeasures input').forEach((el) => {
        el.checked = false;
      });
      document.getElementById('crSaveRisk').textContent = 'Сохранить риск';
    };

    document.getElementById('crSaveRisk').onclick = async () => {
      try {
        const editId = document.getElementById('crEditId').value;
        const measure_ids = [...document.querySelectorAll('#crMeasures input:checked')].map((el) =>
          Number(el.dataset.mid)
        );
        const body = {
          code: document.getElementById('crCode').value.trim(),
          title: document.getElementById('crTitle').value.trim(),
          category: document.getElementById('crCat').value.trim() || 'general',
          description: document.getElementById('crDesc').value.trim() || null,
          form_codes: [],
          measure_ids,
        };
        if (!editId && !body.form_codes.length) {
          body.form_codes = ['924n_rpo', '528_gas', '528_fire', '528_repair', 'ozp', 'height', 'electrical_903n'];
        }
        if (!body.title || (!editId && !body.code)) throw new Error('Код и название обязательны');
        if (editId) {
          await api('/risks/' + editId, {
            method: 'PUT',
            body: JSON.stringify({
              title: body.title,
              category: body.category,
              description: body.description,
              measure_ids,
            }),
          });
        } else {
          await api('/risks', { method: 'POST', body: JSON.stringify(body) });
        }
        toast('Риск сохранён');
        paintCatalogPanels();
      } catch (e) {
        toast(e.message, false);
      }
    };

    document.getElementById('cmReset').onclick = () => {
      document.getElementById('cmEditId').value = '';
      document.getElementById('cmCode').disabled = false;
      document.getElementById('cmCode').value = '';
      document.getElementById('cmTitle').value = '';
      document.getElementById('cmCat').value = 'general';
      document.getElementById('cmDesc').value = '';
      document.getElementById('cmSave').textContent = 'Сохранить меру';
    };

    document.getElementById('cmSave').onclick = async () => {
      try {
        const editId = document.getElementById('cmEditId').value;
        const body = {
          code: document.getElementById('cmCode').value.trim(),
          title: document.getElementById('cmTitle').value.trim(),
          category: document.getElementById('cmCat').value.trim() || 'general',
          description: document.getElementById('cmDesc').value.trim() || null,
        };
        if (!body.title || (!editId && !body.code)) throw new Error('Код и название обязательны');
        if (editId) {
          await api('/measures/' + editId, {
            method: 'PUT',
            body: JSON.stringify({
              title: body.title,
              category: body.category,
              description: body.description,
            }),
          });
        } else {
          await api('/measures', { method: 'POST', body: JSON.stringify(body) });
        }
        toast('Мера сохранена');
        paintCatalogPanels();
      } catch (e) {
        toast(e.message, false);
      }
    };
  }


  // ── Field tab ────────────────────────────────────────────────────────
  async function renderFieldTab(container, work) {
    ensureStyles();
    container.innerHTML = '<div class="help">Загрузка нарядов…</div>';
    let data;
    try {
      data = await api('/works/' + work.id);
    } catch (e) {
      container.innerHTML = `<div class="help" style="color:var(--red,#ef4444)">${esc(e.message)}</div>`;
      return;
    }
    container.innerHTML = '';
    const top = document.createElement('div');
    top.className = 'nd-tab-top';
    top.innerHTML = `
      <div>
        <div class="nd-hazard" style="margin-bottom:10px;max-width:220px"></div>
        <div class="nd-kicker">ЭЛЕКТРОННЫЙ НАРЯД-ДОПУСК</div>
        <div style="font-weight:800;font-size:16px;margin-top:4px;color:#f5e6c8">Конструктор РП</div>
        <div class="nd-muted" style="margin-top:4px;max-width:420px">Превью = Word. Блоки включаются переключателями. Мастер утверждает в PWA.</div>
      </div>`;
    const btn = document.createElement('button');
    btn.className = 'nd-btn nd-btn-primary';
    btn.textContent = '+ Новый наряд';
    btn.onclick = () => openEditor({ work, onSaved: () => renderFieldTab(container, work) });
    top.appendChild(btn);
    container.appendChild(top);

    if (!data.permits || !data.permits.length) {
      container.insertAdjacentHTML(
        'beforeend',
        '<div class="nd-empty-kit"><strong style="color:#f5e6c8;display:block;margin-bottom:6px">Нарядов пока нет</strong>Создайте черновик — мастер утвердит в полевом приложении.</div>'
      );
      return;
    }

    const list = document.createElement('div');
    list.className = 'nd-list';
    for (const p of data.permits) {
      const card = document.createElement('div');
      card.className = 'nd-list-card';
      card.innerHTML = `
        <div>
          <div class="nd-list-num">${esc(p.number || 'черновик #' + p.id)}</div>
          <div class="nd-list-title">${esc(p.form_title || p.form_code)}</div>
          <div class="nd-list-meta">${esc((p.work_content || '').slice(0, 120) || 'Без содержания')}<br>
            ${fmtDate(p.starts_at)} → ${fmtDate(p.ends_at)} · бригада ${p.crew_count || 0} · рисков ${p.risks_count || 0}
          </div>
          <div style="margin-top:8px">${stamp(p.status)}</div>
        </div>
        <div class="nd-list-actions"></div>`;
      const actions = card.querySelector('.nd-list-actions');
      const openBtn = document.createElement('button');
      openBtn.className = 'nd-btn nd-btn-ghost nd-btn-sm';
      openBtn.textContent = p.status === 'draft' ? 'Править' : 'Открыть';
      openBtn.onclick = () => openEditor({ work, permitId: p.id, onSaved: () => renderFieldTab(container, work) });
      actions.appendChild(openBtn);
      const dl = document.createElement('button');
      dl.className = 'nd-btn nd-btn-ghost nd-btn-sm';
      dl.textContent = 'Word';
      dl.onclick = () => downloadDocx(p.id);
      actions.appendChild(dl);
      if (p.status === 'draft') {
        const del = document.createElement('button');
        del.className = 'nd-btn nd-btn-danger nd-btn-sm';
        del.textContent = 'Удалить';
        del.onclick = async () => {
          if (!confirm('Удалить черновик?')) return;
          try {
            await api('/' + p.id, { method: 'DELETE' });
            toast('Черновик удалён');
            renderFieldTab(container, work);
          } catch (e) {
            toast(e.message, false);
          }
        };
        actions.appendChild(del);
      }
      list.appendChild(card);
    }
    container.appendChild(list);
  }

  async function downloadDocx(id) {
    try {
      const r = await fetch('/api/nd/' + id + '/docx', { headers: hdr() });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || 'Не удалось скачать Word');
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'naryad_' + id + '.docx';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(e.message, false);
    }
  }

  function buildRiskState(permitRisks, catalog, defaultCodes) {
    const map = new Map();
    const byCode = new Map((catalog || []).map((r) => [r.code, r]));
    const byId = new Map((catalog || []).map((r) => [r.id, r]));
    const open = new Set();

    if (permitRisks && permitRisks.length) {
      for (const pr of permitRisks) {
        const id = pr.risk_id || pr.id;
        const cat = byId.get(id);
        const mids = Array.isArray(pr.measure_ids) ? pr.measure_ids.map(Number) : [];
        const custom = (pr.measure_titles || []).filter((t) => {
          if (!cat) return true;
          return !(cat.measures || []).some((m) => m.title === t);
        });
        map.set(id, {
          on: true,
          measureIds: mids.length
            ? mids
            : (cat && cat.measures ? cat.measures.map((m) => m.id) : []),
          custom,
          open: false,
        });
      }
    } else if (defaultCodes && defaultCodes.length) {
      for (const code of defaultCodes) {
        const r = byCode.get(code);
        if (!r) continue;
        map.set(r.id, {
          on: true,
          measureIds: (r.measures || []).map((m) => m.id),
          custom: [],
          open: false,
        });
      }
    }
    return { map, open };
  }

  async function openEditor({ work, permitId, onSaved }) {
    ensureStyles();
    const [tplData, riskData, crewData, eqData] = await Promise.all([
      api('/templates'),
      api('/risks'),
      api('/works/' + work.id + '/crew-options').catch(() => ({ crew: [] })),
      api('/works/' + work.id + '/equipment-options').catch(() => ({ equipment: [] })),
    ]);
    let permit = null;
    if (permitId) {
      const d = await api('/' + permitId);
      permit = d.permit;
      if (permit.form_code) {
        const rd = await api('/risks?form_code=' + encodeURIComponent(permit.form_code));
        riskData.risks = rd.risks;
      }
    }

    const overlay = document.createElement('div');
    overlay.className = 'nd-modal-bg';
    // Ensure above current modal stack even if CSS cache is stale
    let topZ = 12050;
    document.querySelectorAll('.cr-m-overlay--visible, .nd-modal-bg, .cr-confirm-overlay').forEach((el) => {
      const z = parseInt(el.style.zIndex || getComputedStyle(el).zIndex, 10);
      if (Number.isFinite(z) && z >= topZ) topZ = z + 10;
    });
    overlay.style.zIndex = String(topZ);
    overlay.innerHTML = `<div class="nd-modal" role="dialog" aria-modal="true">
      <div class="nd-modal-head">
        <div>
          <div class="nd-kicker">НАРЯД-ДОПУСК · КОНСТРУКТОР</div>
          <h2>${permit ? esc(permit.number || 'Черновик #' + permit.id) : 'Новый наряд'}</h2>
        </div>
        <button type="button" class="nd-btn nd-btn-ghost nd-btn-sm nd-close" aria-label="Закрыть">✕</button>
      </div>
      <div class="nd-modal-body">
        <div class="nd-canvas" id="ndCanvas"></div>
        <div class="nd-side" id="ndSide"></div>
      </div>
      <div class="nd-modal-foot" id="ndFoot"></div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.nd-close').onclick = close;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);

    let formCode =
      permit?.form_code || (tplData.templates[0] && tplData.templates[0].code) || '924n_rpo';
    let schema = parseSchema((tplData.templates || []).find((t) => t.code === formCode));
    let sections = normalizeSections(permit?.sections_json, schema);
    const riskBundle = buildRiskState(
      permit?.risks,
      riskData.risks,
      !permit ? schema.default_risk_codes : null
    );

    const state = {
      form_code: formCode,
      work_content: permit?.work_content || '',
      work_place:
        permit?.work_place ||
        [work.object_name, work.city, work.address].filter(Boolean).join(', '),
      ppe_text:
        permit?.ppe_text ||
        'Химстойкий костюм/фартук, сапоги, перчатки, очки и щиток, каска, респиратор по паспорту безопасности; для АВД — водостойкая одежда и защита слуха.',
      emergency_text:
        permit?.emergency_text ||
        'Остановить насос, перекрыть арматуру, удалить людей, локализовать пролив. При попадании реагента — промывать водой ≥15 мин. При газе/дыме — прекратить работы, сообщить допускающему.',
      starts_at: toLocalInput(permit?.starts_at) || toLocalInput(new Date().toISOString()),
      ends_at:
        toLocalInput(permit?.ends_at) ||
        toLocalInput(new Date(Date.now() + 7 * 86400000).toISOString()),
      crewAssigned: (permit?.crew || [])
        .filter((c) => c.employee_id)
        .map((c) => ({
          employee_id: c.employee_id,
          fio: c.fio,
          profession: c.profession,
          role_in_permit: c.role_in_permit || 'member',
        })),
      crewManual: (permit?.crew || [])
        .filter((c) => !c.employee_id)
        .map((c) => ({
          fio: c.fio,
          profession: c.profession || 'подряд',
          role_in_permit: c.role_in_permit || 'member',
        })),
      eqAssigned: (permit?.equipment || [])
        .filter((e) => e.equipment_id)
        .map((e) => ({
          equipment_id: e.equipment_id,
          name: e.name,
          qty: e.qty || '1',
          note: e.note || '',
        })),
      eqManual: (permit?.equipment || [])
        .filter((e) => !e.equipment_id)
        .map((e) => ({ name: e.name, qty: e.qty || '1', note: e.note || '' })),
      riskMap: riskBundle.map,
      status: permit?.status || 'draft',
      readonly: !!(permit && permit.status !== 'draft'),
      number: permit?.number || null,
      work_title: permit?.work_title || work.work_title || work.title || '',
      customer_name: permit?.customer_name || work.customer_name || '',
    };

    function fullCrew() {
      return [...state.crewAssigned, ...state.crewManual];
    }
    function fullEq() {
      return [...state.eqAssigned, ...state.eqManual];
    }

    function selectedRisksPayload() {
      const byId = new Map((riskData.risks || []).map((r) => [r.id, r]));
      const out = [];
      for (const [id, st] of state.riskMap.entries()) {
        if (!st.on) continue;
        const r = byId.get(id);
        if (!r) continue;
        const titles = [
          ...(r.measures || []).filter((m) => st.measureIds.map(Number).includes(Number(m.id))).map((m) => m.title),
          ...(st.custom || []),
        ];
        out.push({
          risk_id: r.id,
          risk_title: r.title,
          measure_ids: st.measureIds.slice(),
          measure_titles: titles,
        });
      }
      return out;
    }

    function ensureRiskEntry(id) {
      if (!state.riskMap.has(id)) {
        const r = (riskData.risks || []).find((x) => x.id === id);
        state.riskMap.set(id, {
          on: false,
          measureIds: r ? (r.measures || []).map((m) => m.id) : [],
          custom: [],
          open: false,
        });
      }
      return state.riskMap.get(id);
    }

    function applyDefaultRisks() {
      state.riskMap = new Map();
      const codes = schema.default_risk_codes || [];
      const byCode = new Map((riskData.risks || []).map((r) => [r.code, r]));
      for (const code of codes) {
        const r = byCode.get(code);
        if (!r) continue;
        state.riskMap.set(r.id, {
          on: true,
          measureIds: (r.measures || []).map((m) => m.id),
          custom: [],
          open: false,
        });
      }
    }

    function paintCanvas() {
      const tpl = (tplData.templates || []).find((t) => t.code === state.form_code) || {};
      const crew = fullCrew();
      const eq = fullEq();
      const risks = selectedRisksPayload();
      const sec = sections;
      const on = (id) => blockOn(sec, id);
      let n = 0;
      const next = () => ++n;
      const parts = [];

      parts.push(`
        <div class="nd-sheet-org">
          <div class="nd-sheet-org-l">ООО «АСГАРД-СЕРВИС»<br>электронный наряд-допуск<br>${esc(
            state.customer_name || ''
          )} · ${esc(state.work_title || '')}</div>
          ${stamp(state.status)}
        </div>
        <div class="nd-sheet-top">
          <div class="nd-sheet-title">НАРЯД-ДОПУСК</div>
          <div class="nd-sheet-sub">${esc(ruText(tpl.title || state.form_code))}</div>
          <div class="nd-sheet-num">${esc(state.number || '№ будет присвоен при утверждении')}</div>
          <div class="nd-legal">${esc(tpl.legal_basis || '')}</div>
        </div>`);

      if (on('persons')) {
        const rows = (sec.persons || []).map((p) => [p.role || '', p.fio || '', p.note || '']);
        while (rows.length < 4) rows.push(['', '', '']);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Ответственные лица</span></div>${paperTable(
          ['Роль', 'ФИО', 'Примечание'],
          rows,
          true
        )}</div>`);
      }
      if (on('work')) {
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Место производства работ</span></div><div class="nd-sec-b" style="background:#fff2a8;padding:6px 8px">${esc(
          state.work_place || '—'
        )}</div></div>`);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Содержание и объём работ</span></div><div class="nd-sec-b nd-pre" style="background:#fff2a8;padding:6px 8px">${esc(
          state.work_content || '—'
        )}</div></div>`);
      }
      if (on('dates')) {
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Сроки</span></div>${paperTable(
          ['Начать', 'Окончить'],
          [[fmtDate(fromLocalInput(state.starts_at)), fmtDate(fromLocalInput(state.ends_at))]],
          true
        )}</div>`);
      }
      if (on('crew')) {
        const rows = crew.map((c, i) => [
          String(i + 1),
          c.fio || '',
          c.profession || '',
          roleLabel(c.role_in_permit || 'member'),
        ]);
        if (!rows.length) rows.push(['', '', '', '']);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Состав бригады</span></div>${paperTable(
          ['№', 'ФИО', 'Профессия', 'Роль'],
          rows,
          true
        )}</div>`);
      }
      if (on('equipment')) {
        const rows = eq.map((e, i) => [String(i + 1), e.name || '', e.qty || '1', e.note || '']);
        if (!rows.length) rows.push(['', '', '', '']);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Оборудование и материалы</span></div>${paperTable(
          ['№', 'Наименование', 'Кол-во', 'Примечание'],
          rows,
          true
        )}</div>`);
      }
      if (on('prep')) {
        const rows = (sec.prep || []).map((p, i) => [String(i + 1), p.title || p.text || '', p.done ? 'да' : '']);
        while (rows.length < 3) rows.push([String(rows.length + 1), '', '']);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Подготовка РМ</span></div>${paperTable(
          ['№', 'Мероприятие', 'Выполнено'],
          rows,
          true
        )}</div>`);
      }
      if (on('loto')) {
        const rows = (sec.loto || []).map((p, i) => [
          String(i + 1),
          p.device || '',
          p.action || '',
          p.lock || '',
        ]);
        while (rows.length < 2) rows.push(['', '', '', '']);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Отключения и блокировки</span></div>${paperTable(
          ['№', 'Оборудование', 'Отключение', 'Блокировка'],
          rows,
          true
        )}</div>`);
      }
      if (on('height_gear')) {
        const rows = (sec.height_gear || []).map((p, i) => [
          String(i + 1),
          p.item || '',
          p.anchor || '',
          p.note || '',
        ]);
        while (rows.length < 2) rows.push(['', '', '', '']);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">СИЗ от падения</span></div>${paperTable(
          ['№', 'СИЗ / система', 'Анкер', 'Примечание'],
          rows,
          true
        )}</div>`);
      }
      if (on('risks')) {
        const rows = risks.map((r, i) => [
          String(i + 1),
          ruText(r.risk_title || ''),
          ruText((r.measure_titles || []).join('; ') || '—'),
          'открыт',
        ]);
        if (!rows.length) rows.push(['', '', '', '']);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Опасные факторы и меры</span></div>${paperTable(
          ['№', 'Опасный фактор', 'Мероприятия', 'Статус'],
          rows,
          true
        )}</div>`);
      }
      if (on('gas_analysis')) {
        const rows = (sec.gas_analysis || []).map((g) => [
          g.at || '',
          g.place || '',
          g.component || '',
          g.value || '',
          g.fio || '',
        ]);
        while (rows.length < 2) rows.push(['', '', '', '', '']);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Анализ ГВС</span></div>${paperTable(
          ['Дата/время', 'Место', 'Компонент', 'Значение', 'ФИО'],
          rows,
          true
        )}</div>`);
      }
      if (on('fire_watch')) {
        const fw = sec.fire_watch || {};
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Постовой огневой охраны</span></div>${paperTable(
          ['Постовой', 'Средства тушения', 'Наблюдение'],
          [[fw.person || '', fw.extinguishers || '', fw.watch_hours || '']],
          true
        )}</div>`);
      }
      if (on('atmosphere')) {
        const rows = (sec.atmosphere || []).map((a) => [
          a.at || '',
          a.o2 || '',
          a.lel || '',
          a.co || '',
          a.h2s || '',
          a.fio || '',
        ]);
        while (rows.length < 2) rows.push(['', '', '', '', '', '']);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Атмосфера ОЗП</span></div>${paperTable(
          ['Время', 'O₂', 'LEL', 'CO', 'H₂S', 'ФИО'],
          rows,
          true
        )}</div>`);
      }
      if (on('ppe')) {
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">СИЗ</span></div><div class="nd-sec-b nd-pre" style="background:#fff2a8;padding:6px 8px">${esc(
          state.ppe_text || '—'
        )}</div></div>`);
      }
      if (on('emergency')) {
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Действия при аварии</span></div><div class="nd-sec-b nd-pre" style="background:#fff2a8;padding:6px 8px">${esc(
          state.emergency_text || '—'
        )}</div></div>`);
      }
      if (on('daily')) {
        const rows = (sec.daily_rows || []).map((d) => [
          d.date || '',
          d.start || '',
          d.end || '',
          d.producer || '',
          d.admitter || '',
        ]);
        while (rows.length < 2) rows.push(['', '', '', '', '']);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Ежедневный допуск</span></div>${paperTable(
          ['Дата', 'Начало', 'Окончание', 'Производитель', 'Допускающий'],
          rows,
          true
        )}</div>`);
      }
      if (on('extension')) {
        const rows = (sec.extension_rows || []).map((e) => [e.until || '', e.status || '', e.note || '']);
        while (rows.length < 1) rows.push(['', '', '']);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Продление</span></div>${paperTable(
          ['Продлить до', 'Статус', 'Примечание'],
          rows,
          true
        )}</div>`);
      }
      if (on('acks')) {
        const rows = (sec.acks_rows || []).map((a) => [a.fio || '', a.at || '', a.sign || '']);
        while (rows.length < 3) rows.push(['', '', '']);
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Ознакомление бригады</span></div>${paperTable(
          ['ФИО', 'Дата/время', 'Подпись'],
          rows,
          true
        )}</div>`);
      }
      if (on('closing')) {
        const cl = sec.closing || {};
        parts.push(`<div class="nd-sec"><div class="nd-sec-h"><span class="nd-sec-n">${next()}.</span><span class="nd-sec-t">Закрытие / сдача РМ</span></div>${paperTable(
          ['Работы окончены', 'РМ сдано', 'Примечание'],
          [[cl.finished_at || '', cl.handed_over || '', cl.note || '']],
          true
        )}</div>`);
      }

      parts.push(`
        <div class="nd-sign-row">
          <div>Выдал (РП)<div class="nd-sign-line"></div></div>
          <div>Утвердил (мастер)<div class="nd-sign-line"></div></div>
        </div>`);

      overlay.querySelector('#ndCanvas').innerHTML = `<div class="nd-sheet">${parts.join('')}</div>`;
    }

    function syncCoreFields() {
      const side = overlay.querySelector('#ndSide');
      if (!side) return;
      const formEl = side.querySelector('#ndForm');
      if (formEl) state.form_code = formEl.value;
      const c = side.querySelector('#ndContent');
      if (c) state.work_content = c.value;
      const p = side.querySelector('#ndPlace');
      if (p) state.work_place = p.value;
      const s = side.querySelector('#ndStart');
      if (s) state.starts_at = s.value;
      const e = side.querySelector('#ndEnd');
      if (e) state.ends_at = e.value;
      const ppe = side.querySelector('#ndPpe');
      if (ppe) state.ppe_text = ppe.value;
      const em = side.querySelector('#ndEmer');
      if (em) state.emergency_text = em.value;
    }

    function syncCrewRoles() {
      const side = overlay.querySelector('#ndSide');
      side.querySelectorAll('#ndCrewList [data-emp]').forEach((el) => {
        if (!el.checked) return;
        const roleEl = side.querySelector(`select[data-crew-role="${el.dataset.emp}"]`);
        const existing = state.crewAssigned.find((x) => Number(x.employee_id) === Number(el.dataset.emp));
        const row = {
          employee_id: Number(el.dataset.emp),
          fio: el.dataset.fio,
          profession: el.dataset.prof || '',
          role_in_permit: roleEl ? roleEl.value : 'member',
        };
        if (existing) Object.assign(existing, row);
        else state.crewAssigned.push(row);
      });
      state.crewAssigned = state.crewAssigned.filter((c) =>
        side.querySelector(`#ndCrewList input[data-emp="${c.employee_id}"]:checked`)
      );
    }

    function syncEq() {
      const side = overlay.querySelector('#ndSide');
      state.eqAssigned = [...side.querySelectorAll('input[data-eq]:checked')].map((el) => {
        const qtyEl = side.querySelector(`input[data-eq-qty="${el.dataset.eq}"]`);
        return {
          equipment_id: Number(el.dataset.eq),
          name: el.dataset.name,
          qty: qtyEl ? qtyEl.value || '1' : '1',
          note: '',
        };
      });
    }

    function syncSectionTables() {
      const side = overlay.querySelector('#ndSide');
      // persons
      sections.persons = [...side.querySelectorAll('[data-person-row]')].map((row) => ({
        role: row.querySelector('[data-k=role]')?.value || '',
        fio: row.querySelector('[data-k=fio]')?.value || '',
        note: row.querySelector('[data-k=note]')?.value || '',
      }));
      sections.prep = [...side.querySelectorAll('[data-prep-row]')].map((row) => ({
        title: row.querySelector('[data-k=title]')?.value || '',
        done: !!row.querySelector('[data-k=done]')?.checked,
      }));
      sections.gas_analysis = [...side.querySelectorAll('[data-gas-row]')].map((row) => ({
        at: row.querySelector('[data-k=at]')?.value || '',
        place: row.querySelector('[data-k=place]')?.value || '',
        component: row.querySelector('[data-k=component]')?.value || '',
        value: row.querySelector('[data-k=value]')?.value || '',
        fio: row.querySelector('[data-k=fio]')?.value || '',
      }));
      sections.loto = [...side.querySelectorAll('[data-loto-row]')].map((row) => ({
        device: row.querySelector('[data-k=device]')?.value || '',
        action: row.querySelector('[data-k=action]')?.value || '',
        lock: row.querySelector('[data-k=lock]')?.value || '',
      }));
      sections.height_gear = [...side.querySelectorAll('[data-hg-row]')].map((row) => ({
        item: row.querySelector('[data-k=item]')?.value || '',
        anchor: row.querySelector('[data-k=anchor]')?.value || '',
        note: row.querySelector('[data-k=note]')?.value || '',
      }));
      sections.atmosphere = [...side.querySelectorAll('[data-atm-row]')].map((row) => ({
        at: row.querySelector('[data-k=at]')?.value || '',
        o2: row.querySelector('[data-k=o2]')?.value || '',
        lel: row.querySelector('[data-k=lel]')?.value || '',
        co: row.querySelector('[data-k=co]')?.value || '',
        h2s: row.querySelector('[data-k=h2s]')?.value || '',
        fio: row.querySelector('[data-k=fio]')?.value || '',
      }));
      sections.daily_rows = [...side.querySelectorAll('[data-daily-row]')].map((row) => ({
        date: row.querySelector('[data-k=date]')?.value || '',
        start: row.querySelector('[data-k=start]')?.value || '',
        end: row.querySelector('[data-k=end]')?.value || '',
        producer: row.querySelector('[data-k=producer]')?.value || '',
        admitter: row.querySelector('[data-k=admitter]')?.value || '',
      }));
      sections.extension_rows = [...side.querySelectorAll('[data-ext-row]')].map((row) => ({
        until: row.querySelector('[data-k=until]')?.value || '',
        status: row.querySelector('[data-k=status]')?.value || '',
        note: row.querySelector('[data-k=note]')?.value || '',
      }));
      sections.acks_rows = [...side.querySelectorAll('[data-ack-row]')].map((row) => ({
        fio: row.querySelector('[data-k=fio]')?.value || '',
        at: row.querySelector('[data-k=at]')?.value || '',
        sign: row.querySelector('[data-k=sign]')?.value || '',
      }));
      const fw = side.querySelector('#ndFireWatch');
      if (fw) {
        sections.fire_watch = {
          person: fw.querySelector('[data-k=person]')?.value || '',
          extinguishers: fw.querySelector('[data-k=extinguishers]')?.value || '',
          watch_hours: fw.querySelector('[data-k=watch_hours]')?.value || '',
        };
      }
      const cl = side.querySelector('#ndClosing');
      if (cl) {
        sections.closing = {
          finished_at: cl.querySelector('[data-k=finished_at]')?.value || '',
          handed_over: cl.querySelector('[data-k=handed_over]')?.value || '',
          note: cl.querySelector('[data-k=note]')?.value || '',
        };
      }
    }

    function addRow(key, empty) {
      syncSectionTables();
      if (!Array.isArray(sections[key])) sections[key] = [];
      sections[key].push(empty);
      paintSide();
      paintCanvas();
    }

    function paintSide() {
      const side = overlay.querySelector('#ndSide');
      const dis = state.readonly ? 'disabled' : '';
      const blocks = schema.blocks || [];

      const blockSwitches = blocks
        .map((b) => {
          const on = blockOn(sections, b.id);
          return `<div class="nd-switch-row">
            <div>
              <div class="nd-switch-title">${esc(blockTitle(b))}</div>
              ${b.hint ? `<div class="nd-switch-hint">${esc(ruText(b.hint))}</div>` : ''}
            </div>
            <label class="nd-switch">
              <input type="checkbox" data-block="${esc(b.id)}" ${on ? 'checked' : ''} ${dis}/>
              <span class="nd-switch-track"></span>
            </label>
          </div>`;
        })
        .join('');

      const riskAccAll = riskData.risks || [];
      const riskAcc = riskAccAll
        .map((r) => {
          const st = ensureRiskEntry(r.id);
          const cnt = (st.measureIds || []).length + (st.custom || []).length;
          const measures = (r.measures || [])
            .map((m) =>
              checkHtml(
                `data-risk-m="${r.id}" data-mid="${m.id}" ${st.measureIds.map(Number).includes(Number(m.id)) ? 'checked' : ''} ${dis}`,
                esc(ruText(m.title))
              )
            )
            .join('');
          const customs = (st.custom || [])
            .map(
              (t, i) =>
                `<span class="nd-chip">${esc(ruText(t))} <button type="button" data-rm-custom="${r.id}" data-i="${i}" ${dis}>×</button></span>`
            )
            .join('');
          const hay = [r.title, r.description, catRu(r.category), ...(r.measures || []).map((m) => m.title)]
            .join(' ')
            .toLowerCase();
          return `<div class="nd-acc ${st.open ? 'open' : ''}" data-acc="${r.id}" data-risk-q="${esc(hay)}">
            <div class="nd-acc-h">
              ${checkHtml(
                `data-risk="${r.id}" ${st.on ? 'checked' : ''} ${dis}`,
                `<span class="nd-acc-title">${esc(ruText(r.title))}</span>`
              )}
              <span class="nd-acc-count">${cnt} мер</span>
              <span class="nd-acc-chev">▸</span>
            </div>
            <div class="nd-acc-b">
              ${measures || '<div class="nd-muted">Нет мер в справочнике</div>'}
              <div class="nd-chips" style="margin-top:6px">${customs}</div>
              <div class="nd-acc-custom">
                <input class="nd-field" data-custom-in="${r.id}" placeholder="Своя мера" ${dis}/>
                <button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" data-add-custom="${r.id}" ${dis}>+</button>
              </div>
            </div>
          </div>`;
        })
        .join('');

      function rowsEditor(list, attr, fields, cols) {
        const arr = list && list.length ? list : [Object.fromEntries(fields.map((f) => [f, '']))];
        return arr
          .map((row, idx) => {
            const inputs = fields
              .map((f) => {
                if (f === 'done') {
                  return checkHtml(`data-k="done" ${row.done ? 'checked' : ''} ${dis}`, 'вып.');
                }
                return `<input class="nd-field" data-k="${f}" value="${esc(row[f] || '')}" placeholder="${esc(
                  FIELD_PH[f] || f
                )}" ${dis}/>`;
              })
              .join('');
            return `<div class="nd-table-ed-row cols-${cols}" ${attr} data-i="${idx}">${inputs}
              <button type="button" class="nd-btn nd-btn-danger nd-btn-sm" data-rm-row="${attr}" data-i="${idx}" ${dis}>×</button></div>`;
          })
          .join('');
      }

      side.innerHTML = `
        <label class="nd-lbl">Тип наряда</label>
        <select id="ndForm" class="nd-select" ${dis}>
          ${(tplData.templates || [])
            .map(
              (t) =>
                `<option value="${esc(t.code)}" ${t.code === state.form_code ? 'selected' : ''}>${esc(t.title)}${
                  t.template_ready ? '' : ' · скоро'
                }</option>`
            )
            .join('')}
        </select>
        <div class="nd-hint">При смене типа подставляется базовый пакет рисков формы</div>

        <div class="nd-side-sec">
          <div class="nd-side-sec-h">Блоки бланка</div>
          <div class="nd-blocks-box">${blockSwitches || '<div class="nd-muted">Нет схемы блоков</div>'}</div>
        </div>

        <label class="nd-lbl">Содержание работ *</label>
        <textarea id="ndContent" class="nd-textarea" rows="3" ${dis} placeholder="Что делаем, оборудование, объём">${esc(
          state.work_content
        )}</textarea>
        <div class="nd-hint">Кратко и по делу — попадёт в Word жёлтым полем</div>
        <label class="nd-lbl">Место</label>
        <input id="ndPlace" class="nd-field" ${dis} value="${esc(state.work_place)}" />
        <div class="nd-row2 dates">
          <div><label class="nd-lbl">Начать</label><input type="datetime-local" id="ndStart" class="nd-field" ${dis} value="${esc(
        state.starts_at
      )}" /></div>
          <div><label class="nd-lbl">Окончить</label><input type="datetime-local" id="ndEnd" class="nd-field" ${dis} value="${esc(
        state.ends_at
      )}" /></div>
        </div>

        ${
          blockOn(sections, 'persons')
            ? `<div class="nd-side-sec"><div class="nd-side-sec-h">Ответственные</div>
          <div class="nd-table-ed" id="ndPersonsEd">${rowsEditor(
            sections.persons,
            'data-person-row',
            ['role', 'fio', 'note'],
            4
          )}</div>
          <button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" id="ndAddPerson" ${dis}>+ строка</button></div>`
            : ''
        }

        <label class="nd-lbl">Бригада с работы</label>
        <div class="nd-check-list" id="ndCrewList">
          ${(crewData.crew || [])
            .map((c) => {
              const checked = state.crewAssigned.some((x) => Number(x.employee_id) === Number(c.employee_id));
              const role =
                (state.crewAssigned.find((x) => Number(x.employee_id) === Number(c.employee_id)) || {})
                  .role_in_permit || 'member';
              return `<div style="display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;margin-bottom:4px">
                ${checkHtml(
                  `data-emp="${c.employee_id}" data-fio="${esc(c.fio)}" data-prof="${esc(
                    c.field_role || c.role_tag || ''
                  )}" ${checked ? 'checked' : ''} ${dis}`,
                  `${esc(c.fio)} <span class="nd-muted">${esc(c.field_role || '')}</span>`
                )}
                ${roleSelect(role, dis, `data-crew-role="${c.employee_id}"`)}
              </div>`;
            })
            .join('') || '<div class="nd-muted">Нет назначенных на работу</div>'}
        </div>
        <label class="nd-lbl">+ ФИО вручную</label>
        <div class="nd-row2"><input id="ndManualFio" class="nd-field" placeholder="Подрядчик ФИО" ${dis}/><button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" id="ndAddFio" ${dis}>+</button></div>
        <div class="nd-chips" id="ndManualCrewChips"></div>

        <label class="nd-lbl">Оборудование</label>
        <div class="nd-check-list">
          ${(eqData.equipment || [])
            .map((e) => {
              const checked = state.eqAssigned.some((x) => Number(x.equipment_id) === Number(e.equipment_id));
              const name = e.name + (e.inventory_number ? ' · ' + e.inventory_number : '');
              const qty =
                (state.eqAssigned.find((x) => Number(x.equipment_id) === Number(e.equipment_id)) || {}).qty ||
                '1';
              return `<div style="display:grid;grid-template-columns:1fr 64px;gap:6px;align-items:center">
                ${checkHtml(
                  `data-eq="${e.equipment_id}" data-name="${esc(name)}" ${checked ? 'checked' : ''} ${dis}`,
                  esc(name)
                )}
                <input class="nd-field" data-eq-qty="${e.equipment_id}" value="${esc(qty)}" ${dis} title="Кол-во"/>
              </div>`;
            })
            .join('') || '<div class="nd-muted">Нет ТМЦ — добавьте вручную</div>'}
        </div>
        <label class="nd-lbl">+ Оборудование вручную</label>
        <div class="nd-row2"><input id="ndManualEq" class="nd-field" placeholder="Насос / рукава / АВД" ${dis}/><button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" id="ndAddEq" ${dis}>+</button></div>
        <div class="nd-chips" id="ndManualEqChips"></div>

        ${
          blockOn(sections, 'prep')
            ? `<div class="nd-side-sec"><div class="nd-side-sec-h">Подготовка РМ</div>
          <div class="nd-table-ed">${rowsEditor(sections.prep, 'data-prep-row', ['title', 'done'], 3)}</div>
          <button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" data-add-key="prep" ${dis}>+ строка</button></div>`
            : ''
        }
        ${
          blockOn(sections, 'loto')
            ? `<div class="nd-side-sec"><div class="nd-side-sec-h">Отключения и блокировки</div>
          <div class="nd-table-ed">${rowsEditor(sections.loto, 'data-loto-row', ['device', 'action', 'lock'], 4)}</div>
          <button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" data-add-key="loto" ${dis}>+ строка</button></div>`
            : ''
        }
        ${
          blockOn(sections, 'height_gear')
            ? `<div class="nd-side-sec"><div class="nd-side-sec-h">СИЗ от падения</div>
          <div class="nd-table-ed">${rowsEditor(
            sections.height_gear,
            'data-hg-row',
            ['item', 'anchor', 'note'],
            4
          )}</div>
          <button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" data-add-key="height_gear" ${dis}>+ строка</button></div>`
            : ''
        }

        <div class="nd-side-sec">
          <div class="nd-side-sec-h">Риски и меры *</div>
          <div class="nd-hint" style="margin-bottom:8px">Галочка — в бланк; стрелка — правки мер</div>
          <input class="nd-search" id="ndSideRiskSearch" type="search" placeholder="Поиск по рискам и мерам…" ${dis} />
          <div class="nd-risk-box" id="ndSideRiskBox">${riskAcc || '<div class="nd-muted">Нет рисков для формы</div>'}</div>
        </div>

        ${
          blockOn(sections, 'gas_analysis')
            ? `<div class="nd-side-sec"><div class="nd-side-sec-h">Анализ ГВС</div>
          <div class="nd-table-ed">${rowsEditor(
            sections.gas_analysis,
            'data-gas-row',
            ['at', 'place', 'component', 'value', 'fio'],
            5
          )}</div>
          <button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" data-add-key="gas_analysis" ${dis}>+ строка</button></div>`
            : ''
        }
        ${
          blockOn(sections, 'fire_watch')
            ? `<div class="nd-side-sec" id="ndFireWatch"><div class="nd-side-sec-h">Постовой огневой</div>
          <input class="nd-field" data-k="person" placeholder="ФИО постового" value="${esc(
            (sections.fire_watch || {}).person || ''
          )}" ${dis}/>
          <input class="nd-field" data-k="extinguishers" placeholder="Средства тушения" value="${esc(
            (sections.fire_watch || {}).extinguishers || ''
          )}" ${dis} style="margin-top:6px"/>
          <input class="nd-field" data-k="watch_hours" placeholder="Наблюдение (часы)" value="${esc(
            (sections.fire_watch || {}).watch_hours || ''
          )}" ${dis} style="margin-top:6px"/></div>`
            : ''
        }
        ${
          blockOn(sections, 'atmosphere')
            ? `<div class="nd-side-sec"><div class="nd-side-sec-h">Атмосфера ОЗП</div>
          <div class="nd-table-ed">${rowsEditor(
            sections.atmosphere,
            'data-atm-row',
            ['at', 'o2', 'lel', 'co', 'h2s', 'fio'],
            5
          )}</div>
          <button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" data-add-key="atmosphere" ${dis}>+ строка</button></div>`
            : ''
        }
        ${
          blockOn(sections, 'daily')
            ? `<div class="nd-side-sec"><div class="nd-side-sec-h">Ежедневный допуск</div>
          <div class="nd-table-ed">${rowsEditor(
            sections.daily_rows,
            'data-daily-row',
            ['date', 'start', 'end', 'producer', 'admitter'],
            5
          )}</div>
          <button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" data-add-key="daily_rows" ${dis}>+ строка</button></div>`
            : ''
        }
        ${
          blockOn(sections, 'extension')
            ? `<div class="nd-side-sec"><div class="nd-side-sec-h">Продление</div>
          <div class="nd-table-ed">${rowsEditor(
            sections.extension_rows,
            'data-ext-row',
            ['until', 'status', 'note'],
            4
          )}</div>
          <button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" data-add-key="extension_rows" ${dis}>+ строка</button></div>`
            : ''
        }
        ${
          blockOn(sections, 'acks')
            ? `<div class="nd-side-sec"><div class="nd-side-sec-h">Ознакомление</div>
          <div class="nd-table-ed">${rowsEditor(sections.acks_rows, 'data-ack-row', ['fio', 'at', 'sign'], 4)}</div>
          <button type="button" class="nd-btn nd-btn-secondary nd-btn-sm" data-add-key="acks_rows" ${dis}>+ строка</button></div>`
            : ''
        }
        ${
          blockOn(sections, 'closing')
            ? `<div class="nd-side-sec" id="ndClosing"><div class="nd-side-sec-h">Закрытие</div>
          <input class="nd-field" data-k="finished_at" placeholder="Работы окончены" value="${esc(
            (sections.closing || {}).finished_at || ''
          )}" ${dis}/>
          <input class="nd-field" data-k="handed_over" placeholder="РМ сдано" value="${esc(
            (sections.closing || {}).handed_over || ''
          )}" ${dis} style="margin-top:6px"/>
          <input class="nd-field" data-k="note" placeholder="Примечание" value="${esc(
            (sections.closing || {}).note || ''
          )}" ${dis} style="margin-top:6px"/></div>`
            : ''
        }

        <label class="nd-lbl">СИЗ</label>
        <textarea id="ndPpe" class="nd-textarea" rows="2" ${dis}>${esc(state.ppe_text)}</textarea>
        <label class="nd-lbl">Авария</label>
        <textarea id="ndEmer" class="nd-textarea" rows="2" ${dis}>${esc(state.emergency_text)}</textarea>
        <div class="nd-err" id="ndErr"></div>
      `;

      bindSide();
      paintChips();
    }

    function paintChips() {
      const crewBox = overlay.querySelector('#ndManualCrewChips');
      const eqBox = overlay.querySelector('#ndManualEqChips');
      if (crewBox) {
        crewBox.innerHTML = state.crewManual
          .map(
            (c, i) =>
              `<span class="nd-chip">${esc(c.fio)} · ${esc(roleLabel(c.role_in_permit || 'member'))} <button type="button" data-rm-crew="${i}">×</button></span>`
          )
          .join('');
        crewBox.querySelectorAll('[data-rm-crew]').forEach((btn) => {
          btn.onclick = () => {
            state.crewManual.splice(Number(btn.dataset.rmCrew), 1);
            paintChips();
            paintCanvas();
          };
        });
      }
      if (eqBox) {
        eqBox.innerHTML = state.eqManual
          .map(
            (e, i) =>
              `<span class="nd-chip">${esc(e.name)} ×${esc(e.qty || '1')} <button type="button" data-rm-eq="${i}">×</button></span>`
          )
          .join('');
        eqBox.querySelectorAll('[data-rm-eq]').forEach((btn) => {
          btn.onclick = () => {
            state.eqManual.splice(Number(btn.dataset.rmEq), 1);
            paintChips();
            paintCanvas();
          };
        });
      }
    }

    function bindSide() {
      const side = overlay.querySelector('#ndSide');
      const live = () => {
        syncCoreFields();
        syncSectionTables();
        paintCanvas();
      };

      const riskSearch = side.querySelector('#ndSideRiskSearch');
      if (riskSearch) {
        riskSearch.oninput = () => {
          const q = riskSearch.value.trim().toLowerCase();
          side.querySelectorAll('#ndSideRiskBox .nd-acc').forEach((row) => {
            const hay = (row.dataset.riskQ || '').toLowerCase();
            row.style.display = !q || hay.includes(q) ? '' : 'none';
          });
        };
      }

      side.querySelector('#ndForm').onchange = async () => {
        syncCoreFields();
        syncSectionTables();
        schema = parseSchema((tplData.templates || []).find((t) => t.code === state.form_code));
        sections = normalizeSections({ enabled_blocks: defaultEnabled(schema) }, schema);
        const rd = await api('/risks?form_code=' + encodeURIComponent(state.form_code));
        riskData.risks = rd.risks;
        applyDefaultRisks();
        paintSide();
        paintCanvas();
        paintFoot();
      };

      side.querySelectorAll('[data-block]').forEach((el) => {
        el.onchange = () => {
          syncSectionTables();
          const id = el.dataset.block;
          const set = new Set(sections.enabled_blocks);
          if (el.checked) set.add(id);
          else set.delete(id);
          sections.enabled_blocks = [...set];
          paintSide();
          paintCanvas();
        };
      });

      ['#ndContent', '#ndPlace', '#ndPpe', '#ndEmer'].forEach((sel) => {
        const el = side.querySelector(sel);
        if (el) el.oninput = live;
      });
      side.querySelector('#ndStart').onchange = live;
      side.querySelector('#ndEnd').onchange = live;
      side.querySelectorAll('.nd-field, .nd-textarea, .nd-select').forEach((el) => {
        if (el.id === 'ndForm') return;
        el.addEventListener('change', live);
        el.addEventListener('input', live);
      });

      side.querySelectorAll('#ndCrewList input[data-emp]').forEach((el) => {
        el.onchange = () => {
          syncCrewRoles();
          paintCanvas();
        };
      });
      side.querySelectorAll('select[data-crew-role]').forEach((el) => {
        el.onchange = () => {
          syncCrewRoles();
          paintCanvas();
        };
      });
      side.querySelectorAll('input[data-eq]').forEach((el) => {
        el.onchange = () => {
          syncEq();
          paintCanvas();
        };
      });

      side.querySelectorAll('.nd-acc-h').forEach((h) => {
        h.addEventListener('click', (e) => {
          if (e.target.closest('input') || e.target.closest('label.nd-check')) return;
          const acc = h.closest('.nd-acc');
          const id = Number(acc.dataset.acc);
          const st = ensureRiskEntry(id);
          st.open = !st.open;
          acc.classList.toggle('open', st.open);
        });
      });

      side.querySelectorAll('input[data-risk]').forEach((el) => {
        el.onchange = () => {
          const st = ensureRiskEntry(Number(el.dataset.risk));
          st.on = el.checked;
          if (st.on) st.open = true;
          paintCanvas();
          const acc = side.querySelector(`.nd-acc[data-acc="${el.dataset.risk}"]`);
          if (acc) acc.classList.toggle('open', st.open);
        };
      });
      side.querySelectorAll('input[data-risk-m]').forEach((el) => {
        el.onchange = () => {
          const rid = Number(el.dataset.riskM);
          const mid = Number(el.dataset.mid);
          const st = ensureRiskEntry(rid);
          if (el.checked) {
            if (!st.measureIds.includes(mid)) st.measureIds.push(mid);
          } else {
            st.measureIds = st.measureIds.filter((x) => x !== mid);
          }
          paintCanvas();
          const cnt = side.querySelector(`.nd-acc[data-acc="${rid}"] .nd-acc-count`);
          if (cnt) cnt.textContent = st.measureIds.length + (st.custom || []).length + ' мер';
        };
      });
      side.querySelectorAll('[data-add-custom]').forEach((btn) => {
        btn.onclick = () => {
          const rid = Number(btn.dataset.addCustom);
          const inp = side.querySelector(`[data-custom-in="${rid}"]`);
          const v = (inp && inp.value.trim()) || '';
          if (!v) return;
          const st = ensureRiskEntry(rid);
          st.custom = st.custom || [];
          st.custom.push(v);
          st.on = true;
          paintSide();
          paintCanvas();
        };
      });
      side.querySelectorAll('[data-rm-custom]').forEach((btn) => {
        btn.onclick = () => {
          const st = ensureRiskEntry(Number(btn.dataset.rmCustom));
          st.custom.splice(Number(btn.dataset.i), 1);
          paintSide();
          paintCanvas();
        };
      });

      const addFio = side.querySelector('#ndAddFio');
      if (addFio) {
        addFio.onclick = () => {
          const v = side.querySelector('#ndManualFio').value.trim();
          if (!v) return;
          state.crewManual.push({ fio: v, profession: 'подряд', role_in_permit: 'member' });
          side.querySelector('#ndManualFio').value = '';
          paintChips();
          paintCanvas();
        };
      }
      const addEq = side.querySelector('#ndAddEq');
      if (addEq) {
        addEq.onclick = () => {
          const v = side.querySelector('#ndManualEq').value.trim();
          if (!v) return;
          state.eqManual.push({ name: v, qty: '1', note: '' });
          side.querySelector('#ndManualEq').value = '';
          paintChips();
          paintCanvas();
        };
      }
      const addPerson = side.querySelector('#ndAddPerson');
      if (addPerson) {
        addPerson.onclick = () => addRow('persons', { role: '', fio: '', note: '' });
      }
      side.querySelectorAll('[data-add-key]').forEach((btn) => {
        btn.onclick = () => {
          const key = btn.dataset.addKey;
          const empty =
            {
              prep: { title: '', done: false },
              loto: { device: '', action: '', lock: '' },
              height_gear: { item: '', anchor: '', note: '' },
              gas_analysis: { at: '', place: '', component: '', value: '', fio: '' },
              atmosphere: { at: '', o2: '', lel: '', co: '', h2s: '', fio: '' },
              daily_rows: { date: '', start: '', end: '', producer: '', admitter: '' },
              extension_rows: { until: '', status: '', note: '' },
              acks_rows: { fio: '', at: '', sign: '' },
            }[key] || {};
          addRow(key, empty);
        };
      });
      side.querySelectorAll('[data-rm-row]').forEach((btn) => {
        btn.onclick = () => {
          syncSectionTables();
          const attr = btn.dataset.rmRow;
          const map = {
            'data-person-row': 'persons',
            'data-prep-row': 'prep',
            'data-loto-row': 'loto',
            'data-hg-row': 'height_gear',
            'data-gas-row': 'gas_analysis',
            'data-atm-row': 'atmosphere',
            'data-daily-row': 'daily_rows',
            'data-ext-row': 'extension_rows',
            'data-ack-row': 'acks_rows',
          };
          const key = map[attr];
          if (!key) return;
          sections[key].splice(Number(btn.dataset.i), 1);
          paintSide();
          paintCanvas();
        };
      });
    }

    function paintFoot() {
      const foot = overlay.querySelector('#ndFoot');
      foot.innerHTML = '';
      if (!state.readonly) {
        const save = document.createElement('button');
        save.className = 'nd-btn nd-btn-primary';
        save.textContent = permitId ? 'Сохранить черновик' : 'Создать черновик';
        save.onclick = async () => {
          try {
            syncCoreFields();
            syncCrewRoles();
            syncEq();
            syncSectionTables();
            const errEl = overlay.querySelector('#ndErr');
            if (!String(state.work_content || '').trim()) {
              errEl.textContent = 'Укажите содержание работ';
              return;
            }
            if (!fullCrew().length) {
              errEl.textContent = 'Добавьте хотя бы одного человека в бригаду';
              return;
            }
            const risks = selectedRisksPayload();
            if (!risks.length) {
              errEl.textContent = 'Выберите хотя бы один риск';
              return;
            }
            errEl.textContent = '';
            const payload = {
              work_id: work.id,
              form_code: state.form_code,
              work_content: state.work_content,
              work_place: state.work_place,
              ppe_text: state.ppe_text,
              emergency_text: state.emergency_text,
              starts_at: fromLocalInput(state.starts_at),
              ends_at: fromLocalInput(state.ends_at),
              crew: fullCrew(),
              equipment: fullEq(),
              risks,
              sections_json: sections,
            };
            if (permitId) await api('/' + permitId, { method: 'PUT', body: JSON.stringify(payload) });
            else await api('/', { method: 'POST', body: JSON.stringify(payload) });
            toast('Черновик сохранён — мастер увидит в PWA');
            document.removeEventListener('keydown', onKey);
            close();
            if (onSaved) onSaved();
          } catch (e) {
            const errEl = overlay.querySelector('#ndErr');
            if (errEl) errEl.textContent = e.message;
            toast(e.message, false);
          }
        };
        foot.appendChild(save);
      }
      if (permitId) {
        const w = document.createElement('button');
        w.className = 'nd-btn nd-btn-ghost';
        w.textContent = 'Скачать Word';
        w.onclick = () => downloadDocx(permitId);
        foot.appendChild(w);
      }
    }

    paintSide();
    paintCanvas();
    paintFoot();
  }

  return { renderCatalog, renderFieldTab, openEditor };
})();
