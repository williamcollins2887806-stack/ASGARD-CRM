/**
 * ASGARD CRM — техплан: бригада и МТР (vanilla UI).
 * ═══════════════════════════════════════════════════════════════════════════
 * Один модуль рисует техническую часть в трёх местах:
 *   * анализ РП (карточка отчёта) — read-only сводка;
 *   * просчёт (вкладка «Бригада и МТР») — редактирование;
 *   * карточка ТО — короткая сводка.
 *
 * Данные — `report_json.tech_json` (сервер) и `estimate.crew/mtr/schedule`
 * (смета). Это одна и та же структура: правка РП видна всем сразу.
 *
 * Правила, которые нельзя «поправить обратно»:
 *  1. Роли — фиксированный список (CREW_ROLES сервера). Свободный ввод ломает
 *     группировку «сколько кого» и разбивку позиций в ТКП.
 *  2. Склад не назначается сам: показываем кандидата и подсвечиваем кнопку
 *     «Взять со склада». Решение — за РП (урок AP5: автоподбор врал).
 *  3. Деньги здесь не считаются. Суммы живут в смете.
 * ═══════════════════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  const esc = (window.AsgardUI && typeof window.AsgardUI.esc === 'function')
    ? window.AsgardUI.esc
    : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

  /* Синхронизировано с src/services/asgard-smeta.js → CREW_ROLES. */
  const ROLES = [
    { code: 'itr', label: 'ИТР (РП)' },
    { code: 'master', label: 'Мастер / бригадир' },
    { code: 'worker', label: 'Слесарь' },
    { code: 'welder', label: 'Сварщик (НАКС)' },
    { code: 'insulator', label: 'Изолировщик' },
    { code: 'assembler', label: 'Монтажник' },
    { code: 'observer', label: 'Наблюдающий' },
    { code: 'safety', label: 'Специалист ОТ / высота' },
    { code: 'driver', label: 'Водитель' },
    { code: 'chemist', label: 'Химик' },
    { code: 'pto', label: 'ПТО / приёмка' }
  ];

  const MTR_SOURCES = [
    { code: 'warehouse', label: 'Со склада' },
    { code: 'purchase', label: 'Закупка' },
    { code: 'rent', label: 'Аренда' }
  ];

  function num(v, d) {
    const n = Number(String(v == null ? '' : v).replace(',', '.'));
    return Number.isFinite(n) ? n : (d == null ? 0 : d);
  }

  function txt(v) { return String(v == null ? '' : v).trim(); }

  function roleLabel(code, fallback) {
    const hit = ROLES.find((r) => r.code === code);
    return hit ? hit.label : (fallback || 'Роль не выбрана');
  }

  function sourceLabel(code) {
    const hit = MTR_SOURCES.find((s) => s.code === code);
    return hit ? hit.label : 'Закупка';
  }

  /* ─────────────────── нормализация входных данных ─────────────────── */

  /** Достать техплан из отчёта/сметы. Всегда возвращает объект. */
  function readPlan(reportJson, estimate) {
    const rj = reportJson || {};
    const est = estimate || {};
    // ── Пустой объект — это НЕ техплан ─────────────────────────────────────
    // `{}` истинно в JS, поэтому проверка `tj ? … : …` уходила в ветку
    // техплана и возвращала пустоту даже когда смета с бригадой и МТР есть.
    // На проде tech_json = {} у ВСЕХ карточек, и вкладка ТО была пустой
    // (найдено верификатором). Считаем техпланом только объект с данными.
    const tjRaw = (rj.tech_json && typeof rj.tech_json === 'object') ? rj.tech_json : null;
    const tjHasData = !!tjRaw && (
      (Array.isArray(tjRaw.crew) && tjRaw.crew.length > 0)
      || (Array.isArray(tjRaw.mtr) && tjRaw.mtr.length > 0)
      || (tjRaw.schedule && (tjRaw.schedule.work_days || tjRaw.schedule.start_plan || tjRaw.schedule.start_date))
      || tjRaw.man_hours_total != null
    );
    const tj = tjHasData ? tjRaw : null;
    const plan = tj ? {
      schedule: tj.schedule || {},
      crew: Array.isArray(tj.crew) ? tj.crew : [],
      mtr: Array.isArray(tj.mtr) ? tj.mtr : [],
      man_hours_total: tj.man_hours_total != null ? tj.man_hours_total : null
    } : {
      schedule: est.schedule || {},
      crew: Array.isArray(est.crew) ? est.crew : [],
      mtr: Array.isArray(est.mtr) ? est.mtr : [],
      man_hours_total: (est.totals && est.totals.man_hours != null) ? est.totals.man_hours : null
    };

    // ── МТР не должен теряться ──────────────────────────────────────────────
    // tech_json мог быть сохранён раньше, чем в нём появился МТР (сборка сметы
    // из анализа писала mtr: []). Тогда вкладка «Бригада и МТР» показывала
    // «Перечень не заполнен», хотя ведомость материалов уже лежала в смете.
    //
    // ВАЖНО: отличаем «нет данных» (`undefined`/`null`) от «РП очистил
    // перечень» (`[]`). Раньше проверялось только `.length`, и очистка
    // возвращала старые строки из сметы — РП убрал позицию, а она всплывала.
    const mtrDeclared = tj && Object.prototype.hasOwnProperty.call(tj, 'mtr');
    const mtrClearedByRp = mtrDeclared && Array.isArray(tj.mtr) && tj.mtr.length === 0;
    if (!plan.mtr.length && !mtrClearedByRp) {
      const fallback = Array.isArray(est.mtr) ? est.mtr
        : (Array.isArray(rj.mtr) ? rj.mtr
          : (Array.isArray(rj.mtr_suggestions) ? rj.mtr_suggestions : []));
      if (fallback.length) plan.mtr = fallback;
    }
    if (!plan.crew.length && Array.isArray(est.crew) && est.crew.length) {
      plan.crew = est.crew;
    }

    // Фолбэк: если техплана нет, но смета посчитана — показываем то, что
    // реально есть в параметрах, а не пустоту. Пустые поля РП не заполнит.
    if (!plan.crew.length && est.params) {
      plan.schedule = plan.schedule || {};
      if (!num(plan.schedule.work_days, 0) && num(est.params.work_days, 0)) {
        plan.schedule.work_days = num(est.params.work_days);
      }
      if (!num(plan.schedule.shift_mode, 0) && num(est.params.shifts_per_day, 0)) {
        plan.schedule.shift_mode = String(num(est.params.shifts_per_day));
      }
      if (!num(plan.schedule.shift_hours, 0) && num(est.params.shift_hours, 0)) {
        plan.schedule.shift_hours = num(est.params.shift_hours);
      }
      if (!num(plan.schedule.trip_count, 0) && num(est.params.trip_count, 0)) {
        plan.schedule.trip_count = num(est.params.trip_count);
      }
      if (num(est.params.masters_per_shift, 0) > 0) {
        plan.crew.push({ role: 'Мастер / бригадир', role_code: 'master', count: num(est.params.masters_per_shift) });
      }
      if (num(est.params.workers_per_shift, 0) > 0) {
        plan.crew.push({ role: 'Слесарь', role_code: 'worker', count: num(est.params.workers_per_shift) });
      }
      plan.crew.unshift({ role: 'ИТР (РП)', role_code: 'itr', count: 1 });
    }
    return plan;
  }

  /** Человеко-часы по плану (та же формула, что на сервере). */
  function manHours(plan) {
    const sch = (plan && plan.schedule) || {};
    const days = num(sch.work_days, 0);
    const shifts = num(sch.shift_mode, 0) || 1;
    const hours = num(sch.shift_hours, 0) || 12;
    const crew = (plan && plan.crew) || [];
    if (!(days > 0) || !crew.length) return null;
    let total = 0;
    crew.forEach((c) => {
      const rs = num(c.shifts_per_day, 0) || shifts;
      total += num(c.count) * days * rs * hours;
    });
    return Math.round(total * 100) / 100;
  }

  /** Короткие чипы для шапки: срок, бригада, МТР. */
  function chips(plan) {
    const p = plan || {};
    const sch = p.schedule || {};
    const crew = p.crew || [];
    const mtr = p.mtr || [];
    const out = [];
    if (num(sch.work_days, 0) > 0) {
      const trips = num(sch.trip_count, 0);
      out.push('Срок ' + num(sch.work_days) + ' дн' + (trips > 1 ? ' · ' + trips + ' заезда' : ''));
    }
    const head = crew.reduce((s, c) => s + num(c.count), 0);
    if (head > 0) out.push('Бригада ' + head + ' чел');
    else if (num(sch.shift_mode, 0) > 0) out.push('Режим ' + num(sch.shift_mode) + ' см');
    if (mtr.length) {
      const wh = mtr.filter((m) => m.source === 'warehouse').length;
      out.push('МТР ' + mtr.length + (wh ? ' (склад ' + wh + ')' : ''));
    }
    const mh = p.man_hours_total != null ? num(p.man_hours_total) : manHours(p);
    if (mh > 0) out.push(fmtInt(mh) + ' чел-ч');
    return out;
  }

  function fmtInt(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
  }

  function fmtQty(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  }

  /**
   * Деньги в МТР: цена закупки приходит из справочника типовой (не сделка),
   * поэтому копейки не нужны, но и округлять до сотен нельзя — цена может
   * быть точной из счёта. Две значащие цифры после запятой.
   */
  function fmtMoney(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  /* ─────────────────── разметка ─────────────────── */

  function chipsHtml(plan, opts) {
    const list = chips(plan);
    if (!list.length) {
      if (opts && opts.hideEmpty) return '';
      return '<span class="rp-tech-chip rp-tech-chip--empty">Техплан не заполнен</span>';
    }
    return list.map((c) => '<span class="rp-tech-chip">' + esc(c) + '</span>').join('');
  }

  /**
   * Сводный блок (read-only) для карточки анализа и карточки ТО.
   * Именно его видит ТО, когда решает, идти ли на объект.
   */
  function summaryHtml(plan, opts) {
    const p = plan || {};
    const sch = p.schedule || {};
    const crew = p.crew || [];
    const mtr = p.mtr || [];
    const o = opts || {};
    if (!crew.length && !mtr.length && !num(sch.work_days, 0)) {
      if (o.hideEmpty) return '';
      return '<div class="rp-tech-empty">Техплан ещё не заполнен — РП дозаполнит при просчёте.</div>';
    }

    const mh = p.man_hours_total != null ? num(p.man_hours_total) : manHours(p);

    let h = '<div class="rp-tech-grid">';

    // Сроки
    h += '<div class="rp-tech-card"><div class="rp-tech-h">Сроки и заезды</div>';
    h += '<div class="rp-tech-kv">';
    if (sch.start_plan) h += '<div><span>Начало</span><b>' + esc(fmtDate(sch.start_plan)) + '</b></div>';
    if (num(sch.work_days, 0)) h += '<div><span>Рабочих дней</span><b>' + fmtInt(sch.work_days) + '</b></div>';
    if (num(sch.trip_count, 0)) h += '<div><span>Заездов</span><b>' + fmtInt(sch.trip_count) + '</b></div>';
    if (num(sch.shift_mode, 0)) {
      const sm = num(sch.shift_mode);
      h += '<div><span>Режим</span><b>' + (sm === 1 ? '1 смена' : sm + ' смены') + '</b></div>';
    }
    if (num(sch.shift_hours, 0)) h += '<div><span>Смена</span><b>' + fmtInt(sch.shift_hours) + ' ч</b></div>';
    if (mh > 0) h += '<div><span>Человеко-часов</span><b>' + fmtInt(mh) + '</b></div>';
    h += '</div></div>';

    // Бригада
    h += '<div class="rp-tech-card"><div class="rp-tech-h">Бригада</div>';
    if (!crew.length) {
      h += '<div class="rp-tech-note">Состав не заполнен</div>';
    } else {
      h += '<table class="rp-tech-table"><thead><tr><th>Роль</th><th class="num">Чел.</th><th class="num">Смен</th></tr></thead><tbody>';
      crew.forEach((c) => {
        h += '<tr><td>' + esc(c.role || roleLabel(c.role_code)) + '</td>'
          + '<td class="num">' + fmtInt(c.count) + '</td>'
          + '<td class="num">' + (num(c.shifts_per_day, 0) > 0 ? fmtInt(c.shifts_per_day) : '—') + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div>';

    // МТР
    h += '<div class="rp-tech-card rp-tech-card--wide"><div class="rp-tech-h">МТР и оборудование</div>';
    if (!mtr.length) {
      h += '<div class="rp-tech-note">Перечень не заполнен</div>';
    } else {
      h += '<table class="rp-tech-table"><thead><tr>'
        + '<th>Название</th><th>Инв. номер</th><th class="num">Кол-во</th><th>Источник</th>'
        + '</tr></thead><tbody>';
      mtr.forEach((m) => {
        const inv = txt(m.inventory_number) || (m.suggested && txt(m.suggested.inventory_number)) || '—';
        const src = sourceLabel(m.source);
        h += '<tr><td>' + esc(m.name) + '</td>'
          + '<td class="mono">' + esc(inv) + '</td>'
          + '<td class="num">' + fmtQty(m.qty) + ' ' + esc(m.unit || 'шт') + '</td>'
          + '<td>' + esc(src) + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div>';

    h += '</div>';
    return h;
  }

  function fmtDate(v) {
    const s = String(v || '');
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? (m[3] + '.' + m[2] + '.' + m[1]) : s;
  }

  /**
   * Редактор для вкладки просчёта.
   *
   * @param {object} plan — нормализованный план
   * @param {object} opts — { readOnly, stock: [{id,name,inventory_number,quantity,unit}] }
   */
  function editorHtml(plan, opts) {
    const p = plan || {};
    const o = opts || {};
    const ro = !!o.readOnly;
    const sch = p.schedule || {};
    const crew = p.crew || [];
    const mtr = p.mtr || [];
    const stock = Array.isArray(o.stock) ? o.stock : [];
    const mh = p.man_hours_total != null ? num(p.man_hours_total) : manHours(p);
    const dis = ro ? ' disabled' : '';

    let h = '<div class="rp-tech-edit">';

    // ── Сроки
    h += '<div class="rp-tech-card"><div class="rp-tech-h">Сроки и заезды</div>'
      + '<div class="rp-tech-form">'
      + field('Дата начала', '<input type="date" data-tech="schedule.start_plan" value="' + esc(sch.start_plan || '') + '"' + dis + '>')
      + field('Рабочих дней', '<input type="number" min="0" step="1" data-tech="schedule.work_days" value="' + esc(sch.work_days || '') + '"' + dis + '>')
      + field('Заездов', '<input type="number" min="1" step="1" data-tech="schedule.trip_count" value="' + esc(sch.trip_count || 1) + '"' + dis + '>')
      + field('Смен в сутки', '<select data-tech="schedule.shift_mode"' + dis + '>'
        + [1, 2, 3].map((n) => '<option value="' + n + '"' + (String(sch.shift_mode) === String(n) ? ' selected' : '') + '>'
          + n + (n === 1 ? ' смена' : ' смены') + '</option>').join('')
        + '</select>')
      + field('Часов в смене', '<input type="number" min="1" max="24" step="1" data-tech="schedule.shift_hours" value="' + esc(sch.shift_hours || 12) + '"' + dis + '>')
      + '</div>'
      + '<div class="rp-tech-total">Человеко-часов: <b data-tech-manhours>' + (mh > 0 ? fmtInt(mh) : '—') + '</b></div>'
      + '</div>';

    // ── Бригада
    h += '<div class="rp-tech-card rp-tech-card--wide"><div class="rp-tech-h">Бригада '
      + (ro ? '' : '<button type="button" class="rp-tech-add" data-tech-add="crew">+ роль</button>')
      + '</div>';
    h += '<table class="rp-tech-table rp-tech-table--edit"><thead><tr>'
      + '<th>Роль</th><th class="num">Чел.</th><th class="num">Смен</th><th class="num">Чел-ч</th>'
      + '<th>Примечание</th>' + (ro ? '' : '<th></th>') + '</tr></thead><tbody>';
    if (!crew.length) {
      h += '<tr><td colspan="' + (ro ? 5 : 6) + '" class="rp-tech-note">Состав не заполнен</td></tr>';
    }
    crew.forEach((c, i) => {
      const roleShifts = num(c.shifts_per_day, 0) || num(sch.shift_mode, 0) || 1;
      const rowHours = num(c.count) * num(sch.work_days, 0) * roleShifts * (num(sch.shift_hours, 0) || 12);
      h += '<tr data-crew-row="' + i + '">'
        + '<td><select data-crew="' + i + '.role_code"' + dis + '>'
        + '<option value="">— выберите —</option>'
        + ROLES.map((r) => '<option value="' + r.code + '"'
          + (c.role_code === r.code ? ' selected' : '') + '>' + esc(r.label) + '</option>').join('')
        + '</select></td>'
        + '<td class="num"><input type="number" min="0" step="1" style="width:64px" data-crew="' + i + '.count" value="' + esc(c.count || '') + '"' + dis + '></td>'
        + '<td class="num"><input type="number" min="0" step="1" style="width:56px" data-crew="' + i + '.shifts_per_day" value="' + esc(c.shifts_per_day || '') + '" placeholder="' + esc(sch.shift_mode || '') + '"' + dis + '></td>'
        + '<td class="num">' + (rowHours > 0 ? fmtInt(rowHours) : '—') + '</td>'
        + '<td><input type="text" data-crew="' + i + '.note" value="' + esc(c.note || '') + '"' + dis + '></td>'
        + (ro ? '' : '<td><button type="button" class="rp-tech-del" data-crew-del="' + i + '" title="Удалить">✕</button></td>')
        + '</tr>';
    });
    h += '</tbody></table></div>';

    // ── МТР
    h += '<div class="rp-tech-card rp-tech-card--wide"><div class="rp-tech-h">МТР и оборудование '
      + (ro ? '' : '<button type="button" class="rp-tech-add" data-tech-add="mtr">+ позиция</button>')
      + '</div>';
    h += '<table class="rp-tech-table rp-tech-table--edit"><thead><tr>'
      + '<th>Название</th><th>Инв. номер</th><th class="num">Кол-во</th><th>Ед.</th>'
      + '<th>Источник</th><th class="num">Цена, ₽</th><th class="num">В себест., %</th>'
      + '<th>Назначение</th>' + (ro ? '' : '<th></th>') + '</tr></thead><tbody>';
    if (!mtr.length) {
      // Пустой МТР — не ошибка, а отсутствие данных. Раньше здесь стояло
      // сухое «Перечень не заполнен», и РП думал, что не хватает полей
      // (жалоба 09.11.2026). Теперь объясняем, что это и как заполнить.
      h += '<tr><td colspan="' + (ro ? 8 : 9) + '" class="rp-tech-note">'
        + (ro
          ? 'Материалы и оборудование не указаны.'
          : 'Материалы и оборудование не указаны — это не блокирует просчёт. '
            + 'Нажмите «+ позиция», если нужно заложить химию, расходники или технику.')
        + '</td></tr>';
    }
    mtr.forEach((m, i) => {
      const sug = m.suggested || null;
      const srcCode = String(m.source || 'purchase');
      // Склад — наше (цена 0, деньги уже в амортизации). Закупка — деньги
      // в блок G с долей sharePct. Аренда — блок H. Бейдж говорит РП, куда
      // пойдёт строка, не заставляя открывать смету.
      const srcBadge = '<span class="rp-mtr-src rp-mtr-src--' + esc(srcCode) + '">'
        + esc(srcCode === 'warehouse' ? 'склад' : srcCode === 'rent' ? 'аренда' : 'закупка')
        + '</span>';
      // Неподтверждённая цена — пробел: РП видит его, а не ноль.
      const priceGap = m.price != null && m.price_confirmed === false;
      const priceCell = ro
        ? (m.price != null ? fmtMoney(m.price) : '—')
          + (priceGap ? ' <span class="rp-mtr-gap" title="цена типовая, не подтверждена">?</span>' : '')
        : '<input type="number" min="0" step="0.01" style="width:96px"'
            + ' data-mtr="' + i + '.price" value="' + esc(m.price != null ? m.price : '') + '"'
            + ' placeholder="' + (priceGap ? 'уточнить' : '0') + '"' + dis + '>'
          + (priceGap ? ' <span class="rp-mtr-gap" title="цена типовая, не подтверждена">?</span>' : '');
      // Доля в себестоимость — только для закупки: склад не закупаем,
      // аренда входит целиком.
      const shareCell = srcCode === 'purchase'
        ? (ro
          ? esc(String(Math.round(Number(m.sharePct != null ? m.sharePct : 1) * 100)) + ' %')
          : '<input type="number" min="0" max="100" step="1" style="width:64px"'
            + ' data-mtr="' + i + '.sharePct"'
            + ' value="' + esc(Math.round(Number(m.sharePct != null ? m.sharePct : 1) * 100)) + '"' + dis + '>')
        : '<span class="rp-tech-note">—</span>';
      const nameCell = ro
        ? esc(m.name)
        : '<input type="text" list="rpTechStockList" data-mtr="' + i + '.name" value="' + esc(m.name) + '">'
          + (sug ? '<div class="rp-tech-sug">Склад: ' + esc(sug.name)
            + (sug.inventory_number ? ' · ' + esc(sug.inventory_number) : '')
            + ' <button type="button" class="rp-tech-take" data-mtr-take="' + i + '">Взять со склада</button></div>' : '');
      h += '<tr data-mtr-row="' + i + '">'
        + '<td>' + nameCell + '</td>'
        + '<td class="mono"><input type="text" style="width:110px" data-mtr="' + i + '.inventory_number" value="' + esc(m.inventory_number || (sug && sug.inventory_number) || '') + '"' + dis + '></td>'
        + '<td class="num"><input type="number" min="0" step="1" style="width:64px" data-mtr="' + i + '.qty" value="' + esc(m.qty || 1) + '"' + dis + '></td>'
        + '<td><input type="text" style="width:56px" data-mtr="' + i + '.unit" value="' + esc(m.unit || 'шт') + '"' + dis + '></td>'
        + '<td>' + (ro ? srcBadge : '<select data-mtr="' + i + '.source"' + dis + '>'
          + MTR_SOURCES.map((s) => '<option value="' + s.code + '"'
            + (m.source === s.code ? ' selected' : '') + '>' + esc(s.label) + '</option>').join('')
          + '</select>') + '</td>'
        + '<td class="num">' + priceCell + '</td>'
        + '<td class="num">' + shareCell + '</td>'
        + '<td><input type="text" data-mtr="' + i + '.purpose" value="' + esc(m.purpose || '') + '"' + dis + '></td>'
        + (ro ? '' : '<td><button type="button" class="rp-tech-del" data-mtr-del="' + i + '" title="Удалить">✕</button></td>')
        + '</tr>';
    });
    h += '</tbody></table>';

    // Подсказки склада для автодополнения названия.
    if (!ro && stock.length) {
      h += '<datalist id="rpTechStockList">'
        + stock.slice(0, 300).map((s) => '<option value="' + esc(s.name) + '">'
          + esc((s.inventory_number || '') + (s.quantity != null ? ' · остаток ' + fmtQty(s.quantity) : ''))
          + '</option>').join('')
        + '</datalist>';
    }
    h += '</div>';

    h += '</div>';
    return h;
  }

  function field(label, input) {
    return '<label class="rp-tech-f"><span>' + esc(label) + '</span>' + input + '</label>';
  }

  /* ─────────────────── чтение правок из DOM ─────────────────── */

  /** Собрать план из формы. Возвращает новый объект, исходный не мутирует. */
  function collect(root, basePlan) {
    const rootEl = root || document;
    const base = JSON.parse(JSON.stringify(basePlan || { schedule: {}, crew: [], mtr: [] }));
    base.schedule = base.schedule || {};
    base.crew = base.crew || [];
    base.mtr = base.mtr || [];

    rootEl.querySelectorAll('[data-tech]').forEach((el) => {
      const path = el.getAttribute('data-tech');
      const [, key] = path.split('.');
      if (!key) return;
      base.schedule[key] = el.value;
    });

    rootEl.querySelectorAll('[data-crew]').forEach((el) => {
      const [idxStr, key] = el.getAttribute('data-crew').split('.');
      const idx = Number(idxStr);
      if (!Number.isInteger(idx) || !base.crew[idx] || !key) return;
      base.crew[idx][key] = el.value;
    });

    rootEl.querySelectorAll('[data-mtr]').forEach((el) => {
      const [idxStr, key] = el.getAttribute('data-mtr').split('.');
      const idx = Number(idxStr);
      if (!Number.isInteger(idx) || !base.mtr[idx] || !key) return;
      base.mtr[idx][key] = el.value;
    });

    // Нормализация: числа и подписи ролей.
    base.schedule.work_days = num(base.schedule.work_days, 0) || null;
    base.schedule.trip_count = num(base.schedule.trip_count, 0) || 1;
    base.schedule.shift_hours = num(base.schedule.shift_hours, 0) || 12;
    // `shift_mode` — это '1' | '2' | '3' | '24/7'. Через `num()` значение
    // '24/7' превращалось в '' и молча терялось (круглосуточный режим
    // становился «смен не задано»). Нормализуем строкой.
    {
      const raw = String(base.schedule.shift_mode == null ? '' : base.schedule.shift_mode).trim();
      if (raw === '24/7') base.schedule.shift_mode = '24/7';
      else {
        const n = num(raw, 0);
        base.schedule.shift_mode = (n >= 1 && n <= 3) ? String(Math.round(n)) : '';
      }
    }

    base.crew = base.crew.map((c) => {
      const code = txt(c.role_code);
      const rawShifts = num(c.shifts_per_day, 0);
      return Object.assign({}, c, {
        role_code: code,
        role: roleLabel(code, c.role),
        count: num(c.count, 0),
        shifts_per_day: rawShifts || null,
        // РП вписал число в колонку «Смены» — значит это осознанный выбор роли.
        // Без флага правка режима объекта перебивала бы введённое значение,
        // а с ним — наоборот, режим не доезжал до строки (баг 10.11.2026).
        shifts_locked: rawShifts > 0 ? true : undefined
      });
    }).filter((c) => c.count > 0 || c.role_code);

    base.mtr = base.mtr.map((m) => {
      const src = MTR_SOURCES.some((s) => s.code === m.source) ? m.source : 'purchase';
      const priceNum = m.price === '' || m.price == null ? null : num(m.price, 0);
      // Доля приходит из input в процентах (0..100) — переводим в 0..1.
      // Раньше поле не переносилось, и любая закупка считалась за 100 %.
      let sharePct = m.sharePct;
      if (sharePct === '' || sharePct == null) sharePct = 1;
      else {
        const n = num(sharePct, 100);
        sharePct = Math.max(0, Math.min(100, n)) / 100;
      }
      return Object.assign({}, m, {
        name: txt(m.name),
        inventory_number: txt(m.inventory_number),
        qty: num(m.qty, 1) || 1,
        unit: txt(m.unit) || 'шт',
        source: src,
        price: priceNum,
        // Долю держим только у закупки: склад не закупаем, аренда входит целиком.
        sharePct: src === 'purchase' ? sharePct : 1
      });
    }).filter((m) => m.name || m.inventory_number);

    base.man_hours_total = manHours(base);
    base.filled_by = 'rp';
    base.updated_at = new Date().toISOString();
    return base;
  }

  /** Применить кандидата склада к позиции МТР. */
  function takeFromStock(plan, idx) {
    const p = JSON.parse(JSON.stringify(plan || {}));
    const m = p.mtr && p.mtr[idx];
    if (!m || !m.suggested) return p;
    m.equipment_id = m.suggested.equipment_id || null;
    m.inventory_number = m.suggested.inventory_number || '';
    m.source = 'warehouse';
    if (!m.purpose) m.purpose = m.name;
    if (m.suggested.name) m.name = m.suggested.name;
    return p;
  }

  /** Добавить пустую строку. */
  function addRow(plan, kind) {
    const p = JSON.parse(JSON.stringify(plan || { schedule: {}, crew: [], mtr: [] }));
    p.schedule = p.schedule || {};
    if (kind === 'crew') {
      p.crew = p.crew || [];
      p.crew.push({ role_code: '', role: '', count: 1, shifts_per_day: null, note: '' });
    } else if (kind === 'mtr') {
      p.mtr = p.mtr || [];
      p.mtr.push({ name: '', inventory_number: '', qty: 1, unit: 'шт', source: 'purchase', purpose: '' });
    }
    return p;
  }

  /** Удалить строку. */
  function removeRow(plan, kind, idx) {
    const p = JSON.parse(JSON.stringify(plan || { schedule: {}, crew: [], mtr: [] }));
    if (kind === 'crew' && p.crew) p.crew.splice(idx, 1);
    if (kind === 'mtr' && p.mtr) p.mtr.splice(idx, 1);
    return p;
  }

  /* ─────────────────── загрузка склада ─────────────────── */

  /**
   * Склад для подсказок. Кэш на сессию: список меняется медленно, а дёргать
   * его на каждый перерисовщик — лишние запросы в модалке.
   */
  let _stockCache = null;
  let _stockPromise = null;

  async function loadStock() {
    if (_stockCache) return _stockCache;
    if (_stockPromise) return _stockPromise;
    _stockPromise = (async () => {
      try {
        const token = localStorage.getItem('asgard_token') || '';
        const r = await fetch('/api/equipment/available?limit=500', {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (!r.ok) return [];
        const d = await r.json();
        // Бэкенд отдаёт { success: true, equipment: [...] } (equipment.js:325).
        // Раньше читались только items/rows — склад всегда был пуст, автодополнение
        // и кнопка «Взять со склада» не появлялись.
        const rows = Array.isArray(d)
          ? d
          : (d.equipment || d.items || d.rows || []);
        _stockCache = rows.map((e) => ({
          id: e.id,
          name: e.name,
          inventory_number: e.inventory_number,
          quantity: e.quantity,
          unit: e.unit
        }));
        return _stockCache;
      } catch (_) {
        return [];
      } finally {
        _stockPromise = null;
      }
    })();
    return _stockPromise;
  }

  window.AsgardTechPlanUI = {
    ROLES,
    MTR_SOURCES,
    readPlan,
    manHours,
    chips,
    chipsHtml,
    summaryHtml,
    editorHtml,
    collect,
    takeFromStock,
    addRow,
    removeRow,
    loadStock,
    _test: { roleLabel, sourceLabel, fmtDate }
  };
})();
