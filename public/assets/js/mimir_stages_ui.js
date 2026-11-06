/**
 * mimir-stages-ui.js — экраны этапов анализа и просчёта Мимира (C1–C9).
 *
 * Контракт с сервером (src/services/mimir-tender-stages.js):
 *   GET  /api/tkp-quick/sessions/:uid/stage
 *   POST /api/tkp-quick/sessions/:uid/stage           { stage, state, expected_version }
 *   POST /api/tkp-quick/sessions/:uid/stage/answer    { gap_id, text | later | continue_without }
 *   POST /api/tkp-quick/sessions/:uid/stage/patch     { position_id, patch } | { state }
 *
 * Принципы:
 *   • точки входа прежние — карточка реестра и панель канбана; новых меню нет;
 *   • только токены дизайн-системы (стили в mimir-stages.css);
 *   • состояние этапа всегда на сервере: закрыл модалку → вернулся → продолжаешь;
 *   • всё, что показывает Мимир, имеет источник (документ или норма) или честную
 *     пометку «эксперт, нормы нет»;
 *   • клавиатура: Esc закрывает, Tab не уходит за модалку, Enter в поле = действие.
 */
(function () {
  'use strict';

  const STAGE_ORDER = ['intake', 'read', 'clarify', 'dv', 'tech', 'decision', 'done'];
  const CALC_ORDER = ['calc_plan', 'calc_smeta', 'done'];
  const STAGE_LABELS = {
    intake: 'Приём', read: 'Чтение ТЗ', clarify: 'Данные', dv: 'Объёмы',
    tech: 'Технология', decision: 'Решение',
    calc_plan: 'Люди и сроки', calc_smeta: 'Смета', done: 'Итог', nogo: 'Не подаём'
  };

  let _el = null;
  let _state = null;
  let _busy = false;

  // ── утилиты ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function token() {
    try {
      return localStorage.getItem('asgard_token')
        || sessionStorage.getItem('asgard_token')
        || localStorage.getItem('token')
        || '';
    } catch (_) { return ''; }
  }

  async function api(url, opts) {
    const o = opts || {};
    const headers = Object.assign({ Authorization: 'Bearer ' + token() }, o.headers || {});
    let body = o.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch(url, { method: o.method || 'GET', headers, body });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function toast(title, msg, type) {
    if (window.AsgardUI && window.AsgardUI.toast) {
      return window.AsgardUI.toast(title, msg, type || 'info');
    }
    try { console.log('[MimirStages]', title, msg); } catch (_) {}
  }

  function fmtMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return '—';
    return n.toLocaleString('ru-RU') + ' ₽';
  }

  function fmtDate(v) {
    if (!v) return '—';
    try { return new Date(v).toLocaleDateString('ru-RU'); } catch (_) { return '—'; }
  }

  function q(sel, root) {
    return (root || _el.wrap).querySelector(sel);
  }
  function qa(sel, root) {
    return Array.from((root || _el.wrap).querySelectorAll(sel));
  }

  // ── каркас (C0) ──────────────────────────────────────────────────────────
  function railHtml(stage) {
    // В анализе рельс показывает только этапы анализа. Смета и люди/сроки —
    // это просчёт, отдельный запуск после решения «подаём».
    const isCalc = CALC_ORDER.includes(stage);
    const order = isCalc ? CALC_ORDER : STAGE_ORDER;
    const idx = order.indexOf(stage);
    return order.map((s, i) => {
      const cls = i < idx ? 'is-done' : (i === idx ? 'is-now' : '');
      const disabled = i > idx ? 'disabled' : '';
      return `<button type="button" class="mst-step ${cls}" data-goto="${s}" ${disabled}
        title="${esc(STAGE_LABELS[s])}">` +
        `<span class="mst-step__n">${i + 1}</span>${esc(STAGE_LABELS[s])}</button>`;
    }).join('');
  }

  function progressHtml(stage) {
    const isCalc = CALC_ORDER.includes(stage);
    const order = isCalc ? CALC_ORDER : STAGE_ORDER;
    const idx = Math.max(0, order.indexOf(stage));
    const pct = order.length > 1 ? idx / (order.length - 1) : 0;
    const kind = isCalc ? 'Просчёт' : 'Анализ';
    return `<div class="mst-rail__progress">
      <span>${kind} · этап ${idx + 1} из ${order.length} · ${esc(STAGE_LABELS[stage] || stage)}</span>
      <span class="mst-rail__bar"><b style="transform:scaleX(${pct.toFixed(3)})"></b></span>
    </div>`;
  }

  function statusChip(sc) {
    if (!sc) return '';
    if (sc.kind === 'thinking') return `<span class="mst-chip mst-chip--thinking"><i></i>${esc(sc.text)}</span>`;
    if (sc.kind === 'wait') return `<span class="mst-chip mst-chip--wait"><i></i>${esc(sc.text)}</span>`;
    if (sc.kind === 'done') return `<span class="mst-chip mst-chip--done"><i></i>${esc(sc.text)}</span>`;
    return `<span class="mst-chip">${esc(sc.text)}</span>`;
  }

  function shellHtml() {
    const s = _state;
    const sc = s.statusChip;
    return `<div class="mst-overlay" role="dialog" aria-modal="true" aria-labelledby="mstTitle">
      <div class="mst-modal">
        <div class="mst-head">
          <span class="mst-head__icon" aria-hidden="true">✦</span>
          <div class="mst-head__text">
            <h2 class="mst-head__title" id="mstTitle">${esc(s.title || 'Анализ тендера')}</h2>
            <p class="mst-head__sub">${esc(s.subtitle || '')}</p>
          </div>
          <div class="mst-head__meta">
            ${statusChip(sc)}
            <span class="mst-chip" data-timer>0:00</span>
            <button type="button" class="mst-iconbtn" data-act="close" title="Закрыть (прогресс сохранится)" aria-label="Закрыть">✕</button>
          </div>
        </div>
        <div class="mst-rail" data-rail>${railHtml(s.stage)}</div>
        ${progressHtml(s.stage)}
        <div class="mst-body">
          <div class="mst-main" data-main></div>
          <aside class="mst-side" data-side>
            <div class="mst-side__head">
              Ход работы
              <span class="mst-foot__spacer"></span>
              <button type="button" class="mst-iconbtn mst-side__toggle" data-act="toggle-side" aria-label="Свернуть панель">⌃</button>
            </div>
            <div class="mst-side__live"><p data-live>Мимир ждёт команды.</p></div>
            <div class="mst-side__log" data-log></div>
          </aside>
        </div>
        <div class="mst-foot">
          <div class="mst-foot__left">
            <button type="button" class="mst-btn mst-btn--ghost" data-act="back">← Назад</button>
            <button type="button" class="mst-btn mst-btn--ghost" data-act="close">Сохранить и позже</button>
          </div>
          <span class="mst-foot__spacer"></span>
          <span class="mst-foot__hint" data-foot-hint></span>
          <button type="button" class="mst-btn mst-btn--primary" data-act="next" data-main-action>Дальше</button>
        </div>
      </div>
    </div>`;
  }

  // ── C1–C9: содержимое основного блока ────────────────────────────────────
  function documentsHtml(attachments) {
    const list = Array.isArray(attachments) ? attachments : [];
    if (!list.length) {
      return `<div class="mst-warn">Документов нет. Опишите работы текстом — без объёмов Мимир остановится и спросит.</div>`;
    }
    return `<div class="mst-docs">${list.map((d) => {
      const hasText = Number(d.text_len || d.textLength || 0) > 40;
      const st = hasText ? ['ok', 'текст распознан'] : ['no', 'нет текста'];
      return `<div class="mst-doc">
        <span aria-hidden="true">📄</span>
        <span class="mst-doc__name">${esc(d.original_name || d.filename || d.name || 'документ')}</span>
        <span class="mst-doc__meta">${d.size ? Math.round(Number(d.size) / 1024) + ' KB' : ''}</span>
        <span class="mst-doc__state mst-doc__state--${st[0]}">${st[1]}</span>
      </div>`;
    }).join('')}</div>`;
  }

  function viewIntake() {
    const s = _state;
    return `
      <p class="mst-lead">Мимир прочитает техническое задание, документы и историю заказчика, затем покажет объёмы и технологию.
        Если чего-то не хватит — остановится и спросит.</p>
      ${documentsHtml(s.attachments)}
      <div class="mst-upload">
        <button type="button" class="mst-btn mst-btn--ghost" data-act="pick-files">Приложить документы</button>
        <span class="mst-upload__hint">ТЗ, ведомости, сметы, сканы. Word, Excel, PDF, картинки — до 20 файлов</span>
        <input type="file" data-file-input multiple hidden
               accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.rtf,.jpg,.jpeg,.png,.webp,.zip,.rar,.7z">
      </div>
      <div data-upload-list class="mst-uploadlist"></div>
      <div class="mst-field">
        <label for="mstTz">Описание работ (дополняет документы, не заменяет)</label>
        <textarea class="mst-textarea" id="mstTz" data-field="tz_text"
          placeholder="Например: промывка двух котлов по 2 м³, отложения кальций, работа в две смены"
          maxlength="100000">${esc(s.tzText || '')}</textarea>
        <p class="mst-hint">До 100 000 символов.</p>
      </div>`;
  }

  function viewRead() {
    const docs = _state.readDocs || [];
    if (!docs.length) {
      return `<p class="mst-lead">Читаю ТЗ. Если документов нет — сразу перейду к вопросам.</p>
        <div class="mst-skeleton"><div class="mst-skel" style="width:70%"></div>
        <div class="mst-skel" style="width:92%"></div><div class="mst-skel" style="width:55%"></div></div>`;
    }
    return `<p class="mst-lead">Прочитано документов: <b>${docs.length}</b>.</p>
      <div class="mst-readlist">${docs.map((d) => `<div class="mst-readcard">
        <b>${esc(d.name || 'документ')}</b>
        ${d.kb ? ` · распознано ${d.kb} KB` : ''}
        ${d.facts ? `<p class="mst-readcard__facts">${esc(d.facts)}</p>` : ''}
      </div>`).join('')}</div>`;
  }

  function viewClarify() {
    const gaps = (_state.state && _state.state.gaps) || [];
    if (!gaps.length) {
      return `<div class="mst-empty"><b>Всё есть</b>Можно переходить к объёмам.</div>`;
    }
    const items = gaps.map((g) => {
      const cls = ['mst-gap'];
      if (!g.blocking) cls.push('is-optional');
      if (g.resolved) cls.push('is-resolved');
      return `<div class="${cls.join(' ')}" data-gap="${esc(g.id)}">
        <div class="mst-gap__head">
          <span aria-hidden="true">${g.blocking ? '⚠' : 'ℹ'}</span>
          <span class="mst-gap__title">${esc(g.label)}</span>
          <span class="mst-gap__tag">${g.blocking ? 'обязательно' : 'необязательно'}</span>
        </div>
        <p class="mst-gap__why">${esc(g.why || '')}</p>
        ${g.resolved
          ? `<div class="mst-gap__answer">${g.waived ? 'Продолжаем без этого — уйдёт в риски' : 'Ответ: ' + esc(g.answer || '')}</div>`
          : `<textarea class="mst-textarea" data-gap-input="${esc(g.id)}"
               placeholder="${esc(g.hint || 'Ваш ответ...')}" style="min-height:58px"></textarea>
             <div class="mst-gap__actions">
               <button type="button" class="mst-btn mst-btn--primary mst-btn--sm" data-act="answer-gap" data-gap="${esc(g.id)}">Ответить</button>
               <button type="button" class="mst-btn mst-btn--ghost mst-btn--sm" data-act="later-gap" data-gap="${esc(g.id)}">Позже</button>
               ${g.blocking ? '' : `<button type="button" class="mst-btn mst-btn--ghost mst-btn--sm" data-act="waive-gap" data-gap="${esc(g.id)}">Продолжить без этого</button>`}
             </div>`}
      </div>`;
    }).join('');
    const blocking = gaps.filter((g) => g.blocking && !g.resolved).length;
    return `<p class="mst-lead">Мимир остановился: не хватает данных. Закройте обязательные пункты —
      остальные можно пропустить, они уйдут в риски.</p>
      ${blocking ? `<div class="mst-warn">Осталось обязательных: <b>${blocking}</b></div>` : ''}
      <div class="mst-gaps" style="margin-top:10px">${items}</div>`;
  }

  function viewDv() {
    const positions = (_state.state && _state.state.positions) || [];
    if (!positions.length) {
      return `<div class="mst-empty"><b>Позиций пока нет</b>Запустите анализ — Мимир заполнит ведомость объёмов.
        Можно добавить позицию вручную.</div>
        <div class="mst-row" style="margin-top:12px">
          <button type="button" class="mst-btn" data-act="add-position">Добавить позицию</button>
        </div>`;
    }
    const rows = positions.map((p) => {
      const cls = [p.approved ? 'is-approved' : '', p.needs_classification ? 'is-blocked' : ''].join(' ');
      const status = p.needs_classification
        ? `<span class="mst-status mst-status--bad" title="${esc((p.problems || []).join('; '))}">нужен метод</span>`
        : (p.tech_status === 'rp'
          ? `<span class="mst-status mst-status--rp">правка РП</span>`
          : `<span class="mst-status mst-status--ok">${p.approved ? 'согласовано' : 'проверено'}</span>`);
      // Ячейки в режиме просмотра, но по клику превращаются в поля: так таблица
      // остаётся читаемой, пока её не начали править.
      return `<tr class="${cls}" data-pos="${esc(p.id)}">
        <td class="mst-table__name">
          <input class="mst-inline-text" data-pos-field="name" value="${esc(p.name || '')}" aria-label="Название позиции">
        </td>
        <td class="mst-table__src">${esc((p.objects || []).map((o) => o.tag).filter(Boolean).join(', ') || '—')}</td>
        <td class="mst-table__num"><input class="mst-inline-num" data-pos-field="volume"
           value="${p.volume != null ? p.volume : ''}" inputmode="decimal" aria-label="Объём"></td>
        <td><input class="mst-inline-text mst-inline-text--short" data-pos-field="unit"
             value="${esc(p.unit || '')}" aria-label="Единица"></td>
        <td>
          <select class="mst-select mst-select--inline" data-pos-field="method" aria-label="Метод">
            ${methodOptions(p.category_code, p.method_code)}
          </select>
        </td>
        <td>
          <select class="mst-select mst-select--inline" data-pos-field="fouling" aria-label="Отложения">
            <option value="">—</option>
            <option value="light" ${p.fouling === 'light' ? 'selected' : ''}>лёгкие</option>
            <option value="medium" ${p.fouling === 'medium' ? 'selected' : ''}>средние</option>
            <option value="heavy" ${p.fouling === 'heavy' ? 'selected' : ''}>тяжёлые</option>
          </select>
        </td>
        <td class="mst-table__tech">
          <textarea class="mst-inline-text" data-pos-field="tech_equip" rows="1"
            aria-label="Технология">${esc(p.tech_equip || '')}</textarea>
        </td>
        <td class="mst-table__src" title="${esc((p.source_ref && (p.source_ref.fragment || p.source_ref.document)) || '')}">
          ${esc((p.source_ref && (p.source_ref.document || p.source_ref.fragment)) || '—')}</td>
        <td class="mst-table__acts">
          ${status}
          <div class="mst-rowacts">
            <button type="button" class="mst-iconbtn mst-iconbtn--sm" data-act="approve-pos"
              data-pos="${esc(p.id)}" title="${p.approved ? 'Снять согласование' : 'Согласовать'}">
              ${p.approved ? '↺' : '✓'}</button>
            <button type="button" class="mst-iconbtn mst-iconbtn--sm mst-iconbtn--danger" data-act="delete-pos"
              data-pos="${esc(p.id)}" title="Удалить позицию">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    const blocked = positions.filter((p) => p.needs_classification).length;
    const approved = positions.filter((p) => p.approved).length;
    return `<p class="mst-lead">Ведомость объёмов — как строки сметы. Меняйте объём, единицу, метод и технологию
      прямо в таблице: сохраняется сразу. Каждую строку можно согласовать отдельно.</p>
      <div class="mst-summary">
        <div class="mst-metric"><div class="mst-metric__label">Позиций</div>
          <div class="mst-metric__value">${positions.length}</div></div>
        <div class="mst-metric mst-metric--gold"><div class="mst-metric__label">Согласовано</div>
          <div class="mst-metric__value">${approved} / ${positions.length}</div></div>
        ${blocked ? `<div class="mst-metric mst-metric--warn"><div class="mst-metric__label">Без метода</div>
          <div class="mst-metric__value">${blocked}</div></div>` : ''}
      </div>
      ${blocked ? `<div class="mst-warn">Позиций без метода: <b>${blocked}</b>. Выберите метод в колонке «Метод», иначе расчёт по ним не пойдёт.</div>` : ''}
      <div class="mst-tablewrap" style="margin-top:10px">
        <table class="mst-table mst-table--dv">
          <thead><tr>
            <th>Позиция</th><th>Аппараты</th><th>Объём</th><th>Ед.</th>
            <th>Метод</th><th>Отложения</th><th>Технология</th><th>Источник</th><th>Статус</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="mst-row" style="margin-top:10px">
        <button type="button" class="mst-btn mst-btn--ghost mst-btn--sm" data-act="add-position">Добавить позицию</button>
        <button type="button" class="mst-btn mst-btn--ghost mst-btn--sm" data-act="approve-all">Согласовать все проверенные</button>
      </div>`;
  }

  /** Список методов: только существующие в справочнике, без выдуманных кодов. */
  function methodOptions(categoryCode, current) {
    const cat = (_state.categories || []).find((c) => c.code === categoryCode) || null;
    // methods_json может прийти строкой (jsonb сериализован) — разбираем.
    let methods = [];
    if (cat) {
      if (Array.isArray(cat.methods_json)) methods = cat.methods_json;
      else if (typeof cat.methods_json === 'string') {
        try { methods = JSON.parse(cat.methods_json) || []; } catch (_) { methods = []; }
      }
    }
    // Собираем список из категорий, но если метод уже сохранён — обязательно
    // добавляем его, иначе select «теряет» значение, которого нет в options.
    const codes = new Set(methods.map((m) => m.code));
    if (current && !codes.has(current)) {
      methods = methods.concat([{ code: current, label: current }]);
    }
    if (!methods.length) {
      return `<option value="">— нет методов —</option>`;
    }
    const opts = methods.map((m) =>
      `<option value="${esc(m.code)}" ${m.code === current ? 'selected' : ''}>${esc(m.label || m.code)}</option>`
    ).join('');
    const empty = current ? '' : `<option value="" selected>— выбрать метод —</option>`;
    return empty + opts;
  }

  function viewTech() {
    const positions = (_state.state && _state.state.positions) || [];
    if (!positions.length) {
      return `<div class="mst-empty"><b>Нет позиций</b>Сначала заполните ведомость объёмов.</div>`;
    }
    const items = positions.map((p, i) => {
      const open = i === 0 ? 'is-open' : '';
      const norm = p.norm || null;
      return `<div class="mst-tech ${open}" data-tech="${esc(p.id)}">
        <button type="button" class="mst-tech__head" data-act="toggle-tech" aria-expanded="${i === 0}">
          <span class="mst-tech__chev" aria-hidden="true">›</span>
          <span>${esc(p.name)}</span>
          <span class="mst-foot__spacer"></span>
          <span class="mst-status ${p.tech_equip ? 'mst-status--ok' : 'mst-status--bad'}">
            ${p.tech_equip ? (p.tech_status === 'rp' ? 'правка РП' : 'заполнено') : 'нужна технология'}</span>
        </button>
        <div class="mst-tech__body">
          <div class="mst-field">
            <label>Чем работаем: технология и оснастка</label>
            <textarea class="mst-textarea" data-tech-input="${esc(p.id)}"
              placeholder="Например: станция промывки, кислота с ингибитором, 2 цикла; или инвертор 250 А, электроды, режим сварки"
              >${esc(p.tech_equip || '')}</textarea>
          </div>
          ${norm ? `<div class="mst-normcard">
            Норма справочника: <b>${esc(norm.code || '—')}</b>
            ${norm.work_days ? ` → <b>${norm.work_days} сут</b>` : ''}
            ${norm.crew ? ` · бригада ${norm.crew.master || 0}м+${norm.crew.exec || 0}сл` : ''}
            ${Array.isArray(norm.trace) && norm.trace.length
              ? `<ul>${norm.trace.slice(0, 5).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
          </div>` : `<p class="mst-hint">Нормы в справочнике нет — срок будет оценкой Мимира, он отметит это в предупреждениях.</p>`}
        </div>
      </div>`;
    }).join('');

    const blocked = positions.filter((p) => !String(p.tech_equip || '').trim()).length;
    return `<p class="mst-lead">Чем работаем по каждой позиции. Без технологии анализ не закрыть.</p>
      ${blocked ? `<div class="mst-warn">Без технологии: <b>${blocked}</b> из ${positions.length}</div>` : ''}
      <div class="mst-techlist" style="margin-top:10px">${items}</div>`;
  }

  function viewDecision() {
    const s = _state;
    const state = s.state || {};
    const dl = state.decision || {};
    const positions = state.positions || [];
    const checklist = s.checklist || { items: [], answered: 0, total: 0 };
    const rows = positions.map((p) => `<div class="mst-readcard">
      <b>${esc(p.name)}</b> — ${p.volume != null ? p.volume : '—'} ${esc(p.unit || '')},
      ${esc((p.category_name || p.category_code || '—') + (p.method_name ? ' · ' + p.method_name : ''))}
      ${p.tech_equip ? `<div class="mst-readcard__facts">${esc(p.tech_equip)}</div>` : ''}
    </div>`).join('');

    const clItems = (checklist.items || []).map((it, i) => {
      const done = String(it.answer || '').trim().length > 0;
      return `<div class="mst-check ${done ? 'is-done' : 'is-missing'}" data-check="${esc(it.id)}">
        <span class="mst-check__n">${done ? '✓' : i + 1}</span>
        <div>
          <div class="mst-check__q">${esc(it.text)}</div>
          <input class="mst-input mst-check__a" data-check-input="${esc(it.id)}"
            value="${esc(it.answer || '')}" placeholder="Что ответил клиент...">
        </div>
      </div>`;
    }).join('');

    return `
      ${callBlockHtml()}

      <div class="mst-decide">
        <button type="button" class="mst-decide__card ${dl.go === true ? 'is-go' : ''}" data-act="decide" data-go="1">
          <span class="mst-decide__title">Подаём</span>
          <span class="mst-decide__sub">Объёмы и технология понятны, ресурсов хватает.</span>
        </button>
        <button type="button" class="mst-decide__card ${dl.go === false ? 'is-nogo' : ''}" data-act="decide" data-go="0">
          <span class="mst-decide__title">Не подаём</span>
          <span class="mst-decide__sub">Не наша специализация, нет ресурсов или сроков.</span>
        </button>
      </div>

      <div class="mst-callnote">
        <b>Смета на этом этапе не считается.</b> Анализ закрывается решением «подаём / не подаём».
        Люди, сроки и смета — в отдельном просчёте после решения.
      </div>

      <div class="mst-block">
        <h3 class="mst-block__title">Что собрали</h3>
        ${rows || '<span class="mst-hint">Позиций нет</span>'}
      </div>

      <div class="mst-block">
        <h3 class="mst-block__title">Чек-лист звонка клиенту · ${checklist.answered || 0}/${checklist.total || 0}</h3>
        <p class="mst-hint" style="margin-top:0">Заполняется здесь же — иначе анализ не закрыть.
          Вопросы собраны из шаблона и уточнены по вашему ТЗ.</p>
        <div class="mst-checklist">${clItems || '<span class="mst-hint">Шаблон чек-листа не загружен</span>'}</div>
      </div>

      ${dl.go === false ? `<div class="mst-field">
        <label for="mstReject">Причина отказа (обязательна)</label>
        <textarea class="mst-textarea" id="mstReject" data-field="reject_reason"
          placeholder="Например: нет допуска НАКС на объекте, сроки 5 дней нереальны">${esc(dl.reason || '')}</textarea>
      </div>` : ''}`;
  }

  /**
   * Блок «позвонить клиенту»: телефон, часы приёма и вопросы, которые Мимир
   * собрал из ТЗ. Вопросы конкретные — по объёмам, срокам, доступам, а не общие.
   */
  function callBlockHtml() {
    const s = _state;
    const c = s.contact || {};
    // Вопросы приходят с сервера (callQuestions) либо из ответа анализа.
    const questions = s.callQuestions || s.call_questions || [];
    const phone = c.phone || '';
    const phoneHref = phone.replace(/[^+\d]/g, '');
    return `<div class="mst-callout">
      <div class="mst-callout__head">
        <span class="mst-callout__icon" aria-hidden="true">☎</span>
        <div class="mst-callout__body">
          <div class="mst-callout__title">Позвоните клиенту до решения</div>
          <div class="mst-callout__sub">${c.name ? esc(c.name) : 'Контакт из технического задания'}${phone ? ' · ' + esc(phone) : ' · телефон в документах не указан'}
            ${c.window ? ' · ' + esc(c.window) : ''}</div>
        </div>
        ${phone ? `<a class="mst-btn mst-btn--primary mst-btn--sm" href="tel:${esc(phoneHref)}">Позвонить</a>` : ''}
      </div>
      ${questions.length ? `<ol class="mst-callout__list">
        ${questions.slice(0, 8).map((q) => `<li>${esc(q)}</li>`).join('')}
      </ol>` : `<p class="mst-hint">Вопросы появятся, когда Мимир прочитает техническое задание.</p>`}
    </div>`;
  }

  function viewCalcPlan() {
    const plan = _state.plan || (_state.state && _state.state.calc) || {};
    const positions = plan.positions || [];
    if (!positions.length) {
      return `<div class="mst-empty"><b>Плана пока нет</b>Нажмите «Дальше» — Мимир разложит работы по аппаратам.</div>`;
    }
    const rows = positions.map((p) => {
      const src = p.source || 'expert';
      const srcLabel = src === 'norm' ? 'норма' : src === 'expert' ? 'эксперт' : (src === 'analog' ? 'аналог' : 'история');
      const srcTitle = p.source_ref || p.explain || '';
      return `<tr data-calc="${esc(p.id)}">
        <td class="mst-table__name">${esc(p.name)}</td>
        <td class="mst-table__src">${esc(p.apparatus || '—')}</td>
        <td class="mst-table__num"><input class="mst-inline-num" data-calc-field="people"
          value="${p.people != null ? p.people : ''}" inputmode="numeric" aria-label="Люди"></td>
        <td class="mst-table__num"><input class="mst-inline-num" data-calc-field="days"
          value="${p.days != null ? p.days : ''}" inputmode="decimal" aria-label="Сутки"></td>
        <td class="mst-table__num">${p.shifts != null ? p.shifts : '—'}</td>
        <td class="mst-table__tech">${esc((p.equipment || []).map((e) => e.name).filter(Boolean).join(', ') || '—')}</td>
        <td><span class="mst-src mst-src--${esc(src)}" title="${esc(srcTitle)}">${esc(srcLabel)}</span></td>
      </tr>`;
    }).join('');

    const warn = (plan.warnings || []).map((w) => `<div class="mst-warn">${esc(w)}</div>`).join('');
    const window = _state.dateWindow;

    return `<div class="mst-summary">
        <div class="mst-metric"><div class="mst-metric__label">Срок</div>
          <div class="mst-metric__value">${plan.work_days != null ? plan.work_days + ' сут' : '—'}</div></div>
        <div class="mst-metric mst-metric--gold"><div class="mst-metric__label">Человеко-часы</div>
          <div class="mst-metric__value">${plan.man_hours != null ? plan.man_hours : '—'}</div></div>
        <div class="mst-metric"><div class="mst-metric__label">Людей в смену</div>
          <div class="mst-metric__value">${plan.people_total != null ? plan.people_total : '—'}</div></div>
        ${window && window.checked ? `<div class="mst-metric ${window.ok ? '' : 'mst-metric--warn'}">
          <div class="mst-metric__label">Окно дат</div>
          <div class="mst-metric__value">${window.required} / ${window.available}</div></div>` : ''}
      </div>
      ${warn}
      <p class="mst-lead" style="margin-top:10px">Люди и сроки по каждой позиции. Цифры можно поправить —
        итог пересчитается, отклонение от нормы подсветится.</p>
      <div class="mst-tablewrap">
        <table class="mst-table mst-table--plan">
          <thead><tr>
            <th>Позиция</th><th>Аппарат</th><th>Люди</th><th>Сутки</th>
            <th>Смен</th><th>Оборудование</th><th>Источник</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function viewSmeta() {
    const calib = _state.calibration || [];
    return `<p class="mst-lead">Предварительная смета собрана. Ниже — что изменится в справочнике норм
      после сохранения.</p>
      ${_state.smetaHtml || `<div class="mst-empty"><b>Смета считается на сервере</b>
        Нажмите «Дальше», чтобы собрать и посмотреть её.</div>`}
      <div class="mst-block" style="margin-top:12px">
        <h3 class="mst-block__title">Калибровка справочника</h3>
        ${calib.length ? `<div class="mst-calib">${calib.map((c) => `<div class="mst-calibrow">
          <label><input type="checkbox" data-calib="${esc(c.code)}" ${c.train ? 'checked' : ''}></label>
          <span class="mst-calibrow__code">${esc(c.code)}</span>
          <span class="mst-calibrow__delta ${c.delta_pct > 0 ? 'mst-calibrow__delta--up' : 'mst-calibrow__delta--down'}">
            ${c.delta_pct > 0 ? '+' : ''}${c.delta_pct}%</span>
        </div>`).join('')}</div>`
          : '<p class="mst-hint">Норм для калибровки нет: расчёт шёл без справочника.</p>'}
      </div>`;
  }

  function viewNogo() {
    const d = (_state.state && _state.state.decision) || {};
    return `<div class="mst-terminal">
        <h3 class="mst-terminal__title">Не подаём</h3>
        <p class="mst-terminal__text">${esc(d.reason || 'Причина не указана')}</p>
        <p class="mst-hint">Тендер остаётся в реестре — в архив его переводит ТО, не Мимир.</p>
      </div>`;
  }

  function viewDone() {
    return `<div class="mst-empty" style="padding:40px 20px">
      <b style="font-size:16px">Анализ закрыт</b>
      Объёмы, технология и сроки сохранены в карточке. Просчёт можно начать отдельной кнопкой.
    </div>`;
  }

  const VIEW = {
    intake: viewIntake,
    read: viewRead,
    clarify: viewClarify,
    dv: viewDv,
    tech: viewTech,
    decision: viewDecision,
    calc_plan: viewCalcPlan,
    calc_smeta: viewSmeta,
    done: viewDone,
    nogo: viewNogo
  };

  // ── действия этапов ──────────────────────────────────────────────────────
  function mainActionFor(stage) {
    return {
      intake: 'Запустить анализ',
      read: 'К объёмам',
      clarify: 'Продолжить анализ',
      dv: 'Согласовать и дальше',
      tech: 'К решению',
      decision: 'Закрыть анализ',
      calc_plan: 'Проверить и к смете',
      calc_smeta: 'Сохранить и обучить',
      done: 'Закрыть',
      nogo: 'Закрыть'
    }[stage] || 'Дальше';
  }

  function nextStageOf(stage) {
    const map = {
      intake: 'read', read: 'dv', clarify: 'read', dv: 'tech',
      tech: 'decision', decision: 'calc_plan', calc_plan: 'calc_smeta',
      calc_smeta: 'done', done: 'done', nogo: 'nogo'
    };
    return map[stage] || stage;
  }

  // ── рендер ───────────────────────────────────────────────────────────────
  function render() {
    if (!_el) return;
    const s = _state;
    q('[data-rail]').innerHTML = railHtml(s.stage);
    const prog = _el.wrap.querySelector('.mst-rail__progress');
    if (prog) prog.outerHTML = progressHtml(s.stage);
    q('[data-main]').innerHTML = (VIEW[s.stage] || viewDone)();
    const btn = q('[data-main-action]');
    btn.textContent = mainActionFor(s.stage);
    // Терминальные этапы: кнопка «Закрыть» остаётся активной, «Назад» — нет.
    btn.disabled = false;
    const hint = q('[data-foot-hint]');
    hint.textContent = s.footHint || '';
    const backBtn = q('[data-act="back"]');
    backBtn.disabled = s.stage === 'intake' || s.stage === 'done' || s.stage === 'nogo';
    bindView();
    if (s.stage === 'intake') {
      const tz = q('#mstTz');
      if (tz && document.activeElement !== tz) tz.value = s.tzText || '';
    }
  }

  function bindView() {
    const s = _state;
    // Поля ввода этапа
    qa('[data-field]').forEach((inp) => {
      inp.addEventListener('input', () => {
        s.draft = s.draft || {};
        s.draft[inp.dataset.field] = inp.value;
      });
    });
    // Загрузка документов файлом прямо в модалке.
    const fileBtn = q('[data-act="pick-files"]');
    const fileInput = q('[data-file-input]');
    if (fileBtn && fileInput) {
      fileBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => uploadFiles(fileInput.files));
    }

    // Пробелы
    qa('[data-act="answer-gap"]').forEach((b) => {      b.addEventListener('click', async () => {
        const gapId = b.dataset.gap;
        const input = q(`[data-gap-input="${gapId}"]`);
        const text = input ? input.value.trim() : '';
        if (!text) { input && input.focus(); return; }
        await answerGap(gapId, { text });
      });
    });
    qa('[data-act="later-gap"]').forEach((b) => {
      b.addEventListener('click', () => answerGap(b.dataset.gap, { later: true }));
    });
    qa('[data-act="waive-gap"]').forEach((b) => {
      b.addEventListener('click', () => answerGap(b.dataset.gap, { continue_without: true }));
    });
    // ДВ: правка любого поля строки
    qa('[data-pos-field]').forEach((inp) => {
      // Текстовое поле технологии растягиваем по содержимому.
      if (inp.tagName === 'TEXTAREA') {
        inp.addEventListener('input', () => {
          inp.style.height = 'auto';
          inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
        });
      }
      inp.addEventListener('change', async () => {
        const tr = inp.closest('[data-pos]');
        if (!tr) return;
        const field = inp.dataset.posField;
        let value = inp.value;
        if (field === 'volume') {
          const n = Number(String(value).replace(',', '.'));
          value = Number.isFinite(n) && n > 0 ? n : null;
        }
        await patchPosition(tr.dataset.pos, { [field]: value });
      });
    });
    // Согласовать / снять согласование позиции
    qa('[data-act="approve-pos"]').forEach((b) => {
      b.addEventListener('click', () => {
        const p = (_state.state.positions || []).find((x) => x.id === b.dataset.pos);
        if (p) patchPosition(p.id, { approved: !p.approved });
      });
    });
    // Удалить позицию
    qa('[data-act="delete-pos"]').forEach((b) => {
      b.addEventListener('click', () => deletePosition(b.dataset.pos));
    });
    // Добавить позицию вручную
    qa('[data-act="add-position"]').forEach((b) => {
      b.addEventListener('click', () => addPosition());
    });
    // Согласовать все, у которых метод определён
    qa('[data-act="approve-all"]').forEach((b) => {
      b.addEventListener('click', () => approveAll());
    });
    // Технология: аккордеон + правка
    qa('[data-act="toggle-tech"]').forEach((b) => {
      b.addEventListener('click', () => {
        const card = b.closest('[data-tech]');
        if (!card) return;
        const open = card.classList.toggle('is-open');
        b.setAttribute('aria-expanded', String(open));
      });
    });
    qa('[data-tech-input]').forEach((ta) => {
      ta.addEventListener('change', () => {
        patchPosition(ta.dataset.techInput, { tech_equip: ta.value.trim() });
      });
    });
    // Решение
    qa('[data-act="decide"]').forEach((b) => {
      b.addEventListener('click', () => {
        s.state = s.state || {};
        s.state.decision = Object.assign({}, s.state.decision || {}, { go: b.dataset.go === '1' });
        render();
      });
    });
    qa('[data-check-input]').forEach((inp) => {
      inp.addEventListener('change', () => {
        s.checklistAnswers = s.checklistAnswers || {};
        s.checklistAnswers[inp.dataset.checkInput] = inp.value.trim();
        const box = inp.closest('.mst-check');
        if (box) {
          const done = inp.value.trim().length > 0;
          box.classList.toggle('is-done', done);
          box.classList.toggle('is-missing', !done);
          box.querySelector('.mst-check__n').textContent = done ? '✓' : box.querySelector('.mst-check__n').textContent;
        }
      });
    });
    // План: люди/сутки
    qa('[data-calc-field]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const tr = inp.closest('[data-calc]');
        if (!tr) return;
        const v = Number(String(inp.value).replace(',', '.'));
        patchCalc(tr.dataset.calc, inp.dataset.calcField, Number.isFinite(v) && v > 0 ? v : null);
      });
    });
    // Калибровка: чекбоксы
    qa('[data-calib]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const row = (_state.calibration || []).find((c) => c.code === cb.dataset.calib);
        if (row) row.train = cb.checked;
      });
    });
  }

  // ── сеть ─────────────────────────────────────────────────────────────────
  /** Загрузить выбранные файлы в сессию и показать, что распозналось. */
  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const list = q('[data-upload-list]');
    if (list) list.innerHTML = files.map((f) =>
      `<div class="mst-uploadrow" data-pending="${esc(f.name)}">
         <span class="mst-uploadrow__name">${esc(f.name)}</span>
         <span class="mst-uploadrow__state">загружаю…</span>
       </div>`).join('');

    for (const f of files) {
      try {
        const fd = new FormData();
        fd.append('file', f, f.name);
        const res = await fetch(
          `/api/tkp-quick/sessions/${encodeURIComponent(_state.uid)}/stage/files`,
          { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: fd }
        );
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || d.message || ('HTTP ' + res.status));
        const row = q(`[data-pending="${CSS.escape(f.name)}"]`);
        if (row) {
          const st = row.querySelector('.mst-uploadrow__state');
          st.textContent = d.file && d.file.has_text ? 'текст распознан' : 'нет текста — опишите объёмы';
          row.classList.add(d.file && d.file.has_text ? 'is-ok' : 'is-warn');
        }
        if (d.attachments) {
          _state.attachments = d.attachments;
          pushLog(`Документ приложен: ${f.name}`);
        }
      } catch (e) {
        const row = q(`[data-pending="${CSS.escape(f.name)}"]`);
        if (row) {
          row.classList.add('is-err');
          row.querySelector('.mst-uploadrow__state').textContent = e.message;
        }
      }
    }
    // Перерисовываем список документов, чтобы приложенные были видны в шапке этапа.
    if (_state.stage === 'intake') render();
  }

  async function loadStage() {
    const d = await api(`/api/tkp-quick/sessions/${encodeURIComponent(_state.uid)}/stage`);
    _state.stage = d.stage || 'intake';
    _state.state = d.state || {};
    _state.version = d.version || 0;
    _state.canFinishTech = d.can_finish_tech || null;
    _state.categories = d.categories || [];
    // Вопросы для звонка и контакт считаются на сервере по сохранённым объёмам
    // и ТЗ — так они есть и при возврате к этапу, а не только сразу после анализа.
    if (d.call_questions) _state.callQuestions = d.call_questions;
    if (d.contact) _state.contact = d.contact;
    return d;
  }

  async function saveStage(stage, state) {
    const d = await api(`/api/tkp-quick/sessions/${encodeURIComponent(_state.uid)}/stage`, {
      method: 'POST',
      body: { stage: stage || _state.stage, state: state || _state.state, expected_version: _state.version }
    });
    _state.stage = d.stage;
    _state.state = d.state;
    _state.version = d.version;
    return d;
  }

  async function answerGap(gapId, body) {
    if (_busy) return;
    _busy = true;
    try {
      const d = await api(`/api/tkp-quick/sessions/${encodeURIComponent(_state.uid)}/stage/answer`, {
        method: 'POST',
        body: Object.assign({ gap_id: gapId, expected_version: _state.version }, body)
      });
      _state.stage = d.stage;
      _state.state = d.state;
      _state.version = d.version;
      pushLog(body.later ? 'Отложено — можно вернуться' : 'Ответ принят');
      render();
    } catch (e) {
      handleError(e);
    } finally {
      _busy = false;
    }
  }

  async function patchPosition(positionId, patch) {
    try {
      const cur = (_state.state.positions || []).find((p) => p.id === positionId);
      const merged = Object.assign({}, cur || {}, patch);
      const positions = (_state.state.positions || []).map((p) => (p.id === positionId ? merged : p));
      const d = await api(`/api/tkp-quick/sessions/${encodeURIComponent(_state.uid)}/stage/patch`, {
        method: 'POST',
        body: { state: Object.assign({}, _state.state, { positions }), expected_version: _state.version }
      });
      _state.state = d.state;
      _state.version = d.version;
      _state.canFinishTech = d.can_finish_tech || _state.canFinishTech;
      pushLog(`Позиция обновлена: ${merged.name || positionId}`);
      render();
    } catch (e) {
      handleError(e);
    }
  }

  /** Добавить позицию вручную: пустая строка, которую заполняет РП. */
  async function addPosition() {
    const positions = (_state.state.positions || []).slice();
    const id = 'p' + (positions.length + 1) + '-' + Date.now().toString(36).slice(-4);
    positions.push({
      id, name: 'Новая позиция', category_code: null, method_code: null,
      volume: null, unit: '', fouling: null, tech_equip: null,
      tech_status: 'rp', approved: false, needs_classification: true,
      problems: ['категория не определена'], objects: [], source_ref: null
    });
    try {
      const d = await api(`/api/tkp-quick/sessions/${encodeURIComponent(_state.uid)}/stage/patch`, {
        method: 'POST',
        body: { state: Object.assign({}, _state.state, { positions }), expected_version: _state.version }
      });
      _state.state = d.state;
      _state.version = d.version;
      pushLog('Добавлена позиция — заполните объём и метод');
      render();
      // Сразу ставим курсор в название новой строки.
      const row = q(`[data-pos="${id}"] [data-pos-field="name"]`);
      if (row) { row.focus(); row.select(); }
    } catch (e) { handleError(e); }
  }

  async function deletePosition(positionId) {
    const positions = (_state.state.positions || []).filter((p) => p.id !== positionId);
    try {
      const d = await api(`/api/tkp-quick/sessions/${encodeURIComponent(_state.uid)}/stage/patch`, {
        method: 'POST',
        body: { state: Object.assign({}, _state.state, { positions }), expected_version: _state.version }
      });
      _state.state = d.state;
      _state.version = d.version;
      pushLog('Позиция удалена');
      render();
    } catch (e) { handleError(e); }
  }

  /** Согласовать все позиции, у которых метод и объём заполнены. */
  async function approveAll() {
    const positions = (_state.state.positions || []).map((p) => (
      (!p.needs_classification && p.method_code && Number(p.volume) > 0)
        ? Object.assign({}, p, { approved: true })
        : p
    ));
    const n = positions.filter((p) => p.approved).length;
    try {
      const d = await api(`/api/tkp-quick/sessions/${encodeURIComponent(_state.uid)}/stage/patch`, {
        method: 'POST',
        body: { state: Object.assign({}, _state.state, { positions }), expected_version: _state.version }
      });
      _state.state = d.state;
      _state.version = d.version;
      pushLog(`Согласовано позиций: ${n}`);
      render();
    } catch (e) { handleError(e); }
  }

  function patchCalc(calcId, field, value) {
    const plan = _state.plan || (_state.state && _state.state.calc);
    if (!plan || !Array.isArray(plan.positions)) return;
    plan.positions = plan.positions.map((p) => (p.id === calcId ? Object.assign({}, p, { [field]: value }) : p));
    _state.plan = plan;
    _state.state = Object.assign({}, _state.state, { calc: plan });
    // Пересчёт итога на клиенте — чтобы не ждать сервер на каждую цифру.
    const groups = {};
    plan.positions.forEach((p) => {
      if (!(Number(p.days) > 0)) return;
      const g = p.parallel_group != null ? String(p.parallel_group) : '0';
      groups[g] = Math.max(groups[g] || 0, Number(p.days));
    });
    plan.work_days = Math.round(Object.values(groups).reduce((s, d) => s + d, 0) * 100) / 100;
    plan.man_hours = Math.round(plan.positions.reduce(
      (s, p) => s + (Number(p.people) || 0) * (Number(p.days) || 0)
        * (Number(p.shifts) || 2) * (Number(p.shift_hours) || 12), 0
    ));
    render();
  }

  function handleError(e) {
    if (e && e.status === 409) {
      toast('Мимир', 'Этап изменён в другой вкладке — обновляю', 'warn');
      loadStage().then(render).catch(() => {});
      return;
    }
    toast('Мимир', e.message || 'Ошибка', 'err');
    pushLog('Ошибка: ' + (e.message || 'неизвестно'));
  }

  // ── панель «Ход работы» ──────────────────────────────────────────────────
  function pushLog(text) {
    if (!_el) return;
    const log = q('[data-log]');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'mst-logline';
    div.innerHTML = `<b>✓</b><span>${esc(text)}</span>`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function setLive(text, streaming) {
    if (!_el) return;
    const p = q('[data-live]');
    if (!p) return;
    p.textContent = text || '';
    p.classList.toggle('is-stream', !!streaming);
  }

  function startTimer() {
    if (!_el) return;
    const started = Date.now();
    _el.timer = setInterval(() => {
      const el = q('[data-timer]');
      if (!el) return;
      const s = Math.floor((Date.now() - started) / 1000);
      el.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }, 1000);
  }

  // ── основной вход ────────────────────────────────────────────────────────
  /**
   * open({ sessionUid, title, subtitle, tenderId, phase })
   * phase: 'analysis' | 'calc' — влияет только на подписи и набор этапов.
   */
  async function open(opts) {
    const o = opts || {};
    if (!o.sessionUid) {
      toast('Мимир', 'Нет сессии — начните анализ из карточки тендера', 'err');
      return;
    }
    _el = {};
    _state = {
      uid: o.sessionUid,
      tenderId: o.tenderId,
      phase: o.phase === 'calc' ? 'calc' : 'analysis',
      stage: 'intake',
      state: {},
      version: 0,
      title: o.title || (o.phase === 'calc' ? 'Просчёт тендера' : 'Анализ тендера'),
      subtitle: o.subtitle || '',
      tzText: o.tzText || '',
      attachments: o.attachments || []
    };

    const holder = document.createElement('div');
    holder.innerHTML = shellHtml();
    const wrap = holder.firstElementChild;
    _el.wrap = wrap;
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';

    // Закрытие: Esc, клик по оверлею, крестик.
    const close = () => {
      clearInterval(_el.timer);
      try { wrap.remove(); } catch (_) {}
      document.body.style.overflow = '';
      _el = null;
      _state = null;
      if (typeof o.onClose === 'function') o.onClose();
    };
    _el.close = close;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab') {
        const f = qa('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
          .filter((x) => !x.disabled && x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    wrap.addEventListener('keydown', onKey);

    const overlay = wrap;
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });

    q('[data-act="close"]').addEventListener('click', close);
    qa('[data-act="close"]').forEach((b) => b.addEventListener('click', close));

    q('[data-act="toggle-side"]').addEventListener('click', () => {
      const side = q('[data-side]');
      // На узком экране (≤560) сворачиваем/разворачиваем целиком, на широком
      // панель остаётся колонкой и кнопка просто скрывает содержимое.
      const narrow = window.matchMedia('(max-width: 560px)').matches;
      side.classList.toggle(narrow ? 'is-open' : 'is-collapsed');
    });

    // Навигация по рельсу (только назад)
    wrap.addEventListener('click', async (e) => {
      const step = e.target.closest('[data-goto]');
      if (!step || step.disabled) return;
      const to = step.dataset.goto;
      if (to === _state.stage) return;
      try {
        const d = await saveStage(to, _state.state);
        _state.stage = d.stage;
        render();
      } catch (err) { handleError(err); }
    });

    q('[data-act="back"]').addEventListener('click', async () => {
      const idx = STAGE_ORDER.indexOf(_state.stage);
      if (idx <= 0) return;
      const to = STAGE_ORDER[idx - 1];
      try {
        const d = await saveStage(to, _state.state);
        _state.stage = d.stage;
        render();
      } catch (err) { handleError(err); }
    });

    q('[data-act="next"]').addEventListener('click', () => onNext(o));

    startTimer();
    render();

    // Подтягиваем состояние этапа с сервера: продолжение с места.
    // ВАЖНО: после loadStage обязательно render — иначе кнопка и экран остаются
    // от начального stage='intake', хотя сервер уже на другом этапе.
    try {
      await loadStage();
      render();
      updateStatusChip();
      if (_state.stage === 'clarify') {
        setLive('Жду ответа на вопросы — без них считать нельзя.', false);
      } else if (_state.stage === 'intake') {
        setLive('Готов начать: прочитаю ТЗ и покажу объёмы.', false);
      } else {
        setLive(`Этап: ${STAGE_LABELS[_state.stage] || _state.stage}`, false);
      }
    } catch (e) {
      handleError(e);
    }
  }

  /** Статус-чип в шапке обновляется вместе с этапом. */
  function updateStatusChip() {
    const meta = q('.mst-head__meta');
    if (!meta) return;
    const old = meta.querySelector('.mst-chip');
    const map = {
      clarify: { kind: 'wait', text: 'Ждёт вас' },
      done: { kind: 'done', text: 'Готово' },
      nogo: { kind: 'wait', text: 'Не подаём' },
      read: { kind: 'thinking', text: 'Думает' }
    };
    const sc = map[_state.stage] || null;
    const html = statusChip(sc) || `<span class="mst-chip"><i></i>${esc(STAGE_LABELS[_state.stage] || _state.stage)}</span>`;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const fresh = tmp.firstElementChild;
    if (old && fresh) old.replaceWith(fresh);
    else if (fresh) meta.insertBefore(fresh, meta.firstChild);
  }

  async function onNext(opts) {
    const s = _state;
    if (!s || _busy) return;

    // Кнопка «Закрыть» на терминальных экранах.
    if (s.stage === 'done' || s.stage === 'nogo') {
      _el.close();
      return;
    }

    // C1: запуск анализа
    if (s.stage === 'intake') {
      const tz = (s.draft && s.draft.tz_text) || s.tzText || '';
      _busy = true;
      setLive('Отправляю ТЗ в анализ…', true);
      try {
        if (typeof opts.onStart === 'function') {
          await opts.onStart({ tz_text: tz, attachments: s.attachments });
        }
        await saveStage('read', s.state);
        render();
        setLive('Читаю документы и вытаскиваю объёмы…', true);
        if (typeof opts.onAnalyze === 'function') {
          const res = await opts.onAnalyze({ tz_text: tz });
          if (res && res.state) { s.state = res.state; s.stage = res.stage || 'dv'; }
          if (res && res.attachments) s.attachments = res.attachments;
          if (res && res.checklist) s.checklist = res.checklist;
          if (res && res.plan) s.plan = res.plan;
          if (res && res.calibration) s.calibration = res.calibration;
          if (res && res.smetaHtml) s.smetaHtml = res.smetaHtml;
          if (res && res.dateWindow) s.dateWindow = res.dateWindow;
          // Вопросы для звонка и контакт клиента из ТЗ.
          if (res && res.call_questions) s.callQuestions = res.call_questions;
          if (res && res.contact) s.contact = res.contact;
        }
        await loadStage();
        render();
        setLive(s.stage === 'clarify'
          ? 'Остановился: не хватает данных.'
          : 'Готово, проверьте объёмы.', false);
      } catch (e) {
        handleError(e);
      } finally {
        _busy = false;
      }
      return;
    }

    // C3: продолжить после закрытых пробелов
    if (s.stage === 'clarify') {
      const blocking = ((s.state && s.state.gaps) || []).filter((g) => g.blocking && !g.resolved);
      if (blocking.length) {
        toast('Мимир', `Закройте обязательные пункты: ${blocking.length}`, 'warn');
        return;
      }
      try {
        const d = await saveStage('read', s.state);
        s.stage = d.stage;
        render();
        if (typeof opts.onAnalyze === 'function') {
          setLive('Продолжаю с того места, где остановился…', true);
          const res = await opts.onAnalyze({ tz_text: (s.draft && s.draft.tz_text) || s.tzText });
          if (res && res.state) s.state = res.state;
          if (res && res.stage) s.stage = res.stage;
          render();
        }
      } catch (e) { handleError(e); }
      return;
    }

    // C4 → C5: нельзя дальше, если есть позиции без метода
    if (s.stage === 'dv') {
      const bad = ((s.state && s.state.positions) || []).filter((p) => p.needs_classification);
      if (bad.length) {
        toast('Мимир', `Позиций без метода: ${bad.length}. Укажите метод.`, 'warn');
        return;
      }
      try {
        const d = await saveStage('tech', s.state);
        s.stage = d.stage;
        render();
      } catch (e) { handleError(e); }
      return;
    }

    // C5 → C6: нельзя без технологии
    if (s.stage === 'tech') {
      const bad = ((s.state && s.state.positions) || []).filter((p) => !String(p.tech_equip || '').trim());
      if (bad.length) {
        toast('Мимир', `Без технологии: ${bad.length}. Заполните, иначе анализ не закрыть.`, 'warn');
        return;
      }
      try {
        const d = await saveStage('decision', s.state);
        s.stage = d.stage;
        render();
        if (typeof opts.onChecklist === 'function') {
          const cl = await opts.onChecklist();
          if (cl) { s.checklist = cl; render(); }
        }
      } catch (e) { handleError(e); }
      return;
    }

    // C6 → закрытие анализа. Смета на этом этапе НЕ считается: анализ
    // заканчивается решением «подаём / не подаём», просчёт идёт отдельно.
    if (s.stage === 'decision') {
      const d = (s.state && s.state.decision) || {};
      if (d.go == null) {
        toast('Мимир', 'Выберите: подаём или не подаём', 'warn');
        return;
      }
      if (d.go === false) {
        const reason = (s.draft && s.draft.reject_reason) || d.reason || '';
        if (reason.trim().length < 5) {
          toast('Мимир', 'Укажите причину отказа', 'warn');
          return;
        }
        s.state.decision = { go: false, reason: reason.trim() };
        try {
          if (typeof opts.onDecide === 'function') {
            await opts.onDecide({ go: false, reason: reason.trim(), state: s.state });
          }
          const out = await saveStage('nogo', s.state);
          s.stage = out.stage;
          render();
        } catch (e) { handleError(e); }
        return;
      }

      // Обязательный чек-лист: анализ не закрывается без ответов.
      const answers = s.checklistAnswers || {};
      const missing = ((s.checklist && s.checklist.items) || [])
        .filter((it) => it.required !== false && !String(answers[it.id] || it.answer || '').trim());
      if (missing.length) {
        toast('Мимир', `Чек-лист: не заполнено ${missing.length}`, 'warn');
        return;
      }
      try {
        if (typeof opts.onDecide === 'function') {
          await opts.onDecide({ go: true, answers, state: s.state });
        }
        const out = await saveStage('done', s.state);
        s.stage = out.stage;
        render();
        setLive('Анализ закрыт: решение «подаём» зафиксировано. Просчёт — отдельным запуском.', false);
      } catch (e) { handleError(e); }
      return;
    }

    // C7 → C8: план
    if (s.stage === 'calc_plan') {
      const plan = s.plan || {};
      const bad = (plan.positions || []).filter((p) => !(Number(p.people) > 0) || !(Number(p.days) > 0));
      if (bad.length) {
        toast('Мимир', `Без людей или срока: ${bad.length}`, 'warn');
        return;
      }
      const expertUnconfirmed = (plan.positions || []).filter((p) => p.source === 'expert' && !p.approved);
      if (expertUnconfirmed.length) {
        toast('Мимир', `Подтвердите экспертную оценку: ${expertUnconfirmed.length}`, 'warn');
        return;
      }
      try {
        s.state = Object.assign({}, s.state, { calc: plan });
        await saveStage('calc_smeta', s.state);
        s.stage = 'calc_smeta';
        setLive('Собираю предварительную смету…', true);
        if (typeof opts.onSmeta === 'function') {
          const res = await opts.onSmeta({ state: s.state, plan });
          if (res && res.calibration) s.calibration = res.calibration;
          if (res && res.smetaHtml) s.smetaHtml = res.smetaHtml;
        }
        render();
      } catch (e) { handleError(e); }
      return;
    }

    // C8 → done: сохранение и обучение
    if (s.stage === 'calc_smeta') {
      _busy = true;
      setLive('Сохраняю и обучаю справочник…', true);
      try {
        if (typeof opts.onSave === 'function') {
          const res = await opts.onSave({
            state: s.state,
            plan: s.plan,
            train: (s.calibration || []).filter((c) => c.train).map((c) => c.code)
          });
          if (res && res.normLearning) {
            const nl = res.normLearning;
            pushLog(nl.kind === 'created'
              ? `Норма создана: ${nl.rate_code}`
              : (nl.rate_code ? `Норма обновлена: ${nl.rate_code}` : 'Калибровка пропущена'));
          }
        }
        const out = await saveStage('done', s.state);
        s.stage = out.stage;
        render();
        setLive('Готово. Анализ закрыт и сохранён.', false);
      } catch (e) { handleError(e); }
      finally { _busy = false; }
    }
  }

  window.AsgardMimirStages = {
    open,
    close: () => { if (_el && _el.close) _el.close(); },
    STAGE_ORDER,
    STAGE_LABELS,
    _internals: { esc, mainActionFor, nextStageOf }
  };
})();
