'use strict';

/**
 * ASGARD CRM — Document Generator (Мимир, фаза «Артефакты после расчёта»)
 *
 * После любого AI-расчёта (Quick / Conductor / Auto-Estimate) генерируем 3 файла:
 *   1. Смета.xlsx        — программно через ExcelJS, по структуре эталона
 *                          `templates/smeta-template.xlsx`, с Excel-формулами
 *                          (юзер может менять входные параметры и пересчёт идёт сам).
 *   2. Отчёт директору.docx — docxtemplater + `templates/director-report-tpl.docx`,
 *                             на оф. бланке ООО «Асгард-Сервис».
 *   3. Письмо клиенту.docx — docxtemplater + `templates/customer-letter-tpl.docx`,
 *                            оф. бланк, вопросы списком.
 *
 * Файлы складываются на диск (`uploads/<entity>/<id>/...`) и регистрируются в
 * JSONB-поле сущности (для pre_tender — `pre_tender_requests.manual_documents`,
 * для work — `works.manual_documents`; для tender хранится в общей таблице
 * `documents` где есть колонка `tender_id`).
 *
 * Зависимости:
 *   - exceljs           — уже установлен (используется в mimir-auto-estimate.js).
 *   - docxtemplater     — НОВЫЙ (нужен npm install).
 *   - pizzip            — НОВЫЙ (нужен npm install, peer от docxtemplater).
 *
 * См. отчёт по фиче и список TODO (UI-кнопки скачать, libreoffice для pdf, и т.п.).
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

// docxtemplater и pizzip — НОВЫЕ зависимости. Lazy-require, чтобы тесты на
// окружении без install не падали при загрузке модуля.
let _Docxtemplater = null;
let _PizZip = null;
function _loadDocxLibs() {
  if (_Docxtemplater && _PizZip) return { Docxtemplater: _Docxtemplater, PizZip: _PizZip };
  try {
    _Docxtemplater = require('docxtemplater');
    _PizZip = require('pizzip');
  } catch (e) {
    throw new Error(
      'document-generator: не установлены docxtemplater/pizzip. ' +
      'Выполните: npm install docxtemplater pizzip'
    );
  }
  return { Docxtemplater: _Docxtemplater, PizZip: _PizZip };
}

const ROOT = path.resolve(__dirname, '..', '..');
const TPL_DIR = path.join(ROOT, 'templates');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const TPL_DIRECTOR = path.join(TPL_DIR, 'director-report-tpl.docx');
const TPL_CUSTOMER = path.join(TPL_DIR, 'customer-letter-tpl.docx');

// ─── Утилиты ─────────────────────────────────────────────────────────────
function _num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _fmtMoney(n) {
  return (Math.round(_num(n) * 100) / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 0, maximumFractionDigits: 0
  }) + ' ₽';
}

function _fmtMillions(n) {
  const v = _num(n) / 1_000_000;
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' млн ₽';
}

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];
function _fmtRuDate(d) {
  const dt = d instanceof Date ? d : new Date(d || Date.now());
  return `${String(dt.getDate()).padStart(2, '0')} ${RU_MONTHS[dt.getMonth()]} ${dt.getFullYear()} г.`;
}

/** «18» июня 2026 г. — формат, принятый для исходящих писем ГНШ. */
function _fmtRuDateShort(d) {
  const dt = d instanceof Date ? d : new Date(d || Date.now());
  return `«${String(dt.getDate()).padStart(2, '0')}» ${RU_MONTHS[dt.getMonth()]} ${dt.getFullYear()} г.`;
}

function _shortContact(fullName) {
  const s = String(fullName || '').trim();
  if (!s) return 'коллеги';
  const parts = s.split(/\s+/);
  if (parts.length >= 2) return parts[0] + ' ' + parts[1].slice(0, 1) + '.';
  return parts[0];
}

// ═════════════════════════════════════════════════════════════════════════
// 1. СМЕТА — programmatic ExcelJS (структура 1-в-1 с эталоном smeta-template.xlsx)
// ═════════════════════════════════════════════════════════════════════════

const STYLE = {
  // золотая шапка
  goldHeader: {
    font: { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF3A2A00' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4A843' } },
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  },
  sectionHeader: {
    font: { name: 'Calibri', size: 11, bold: true },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E7E7' } },
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  },
  subHeader: {
    font: { name: 'Calibri', size: 10, bold: true },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } },
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  },
  input: {
    font: { name: 'Calibri', size: 10 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4FF' } },
    alignment: { vertical: 'middle', horizontal: 'right', wrapText: true },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  },
  textCell: {
    font: { name: 'Calibri', size: 10 },
    alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  },
  money: {
    font: { name: 'Calibri', size: 10 },
    alignment: { vertical: 'middle', horizontal: 'right' },
    numFmt: '# ##0 " ₽"',
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  },
  moneyBold: {
    font: { name: 'Calibri', size: 11, bold: true },
    alignment: { vertical: 'middle', horizontal: 'right' },
    numFmt: '# ##0 " ₽"',
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4D6' } },
    border: { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } }
  }
};

function _applyStyle(cell, style) {
  if (!cell || !style) return;
  if (style.font) cell.font = style.font;
  if (style.fill) cell.fill = style.fill;
  if (style.alignment) cell.alignment = style.alignment;
  if (style.numFmt) cell.numFmt = style.numFmt;
  if (style.border) cell.border = style.border;
}

/**
 * Из estimate.calculation вытащить параметры расчёта (как Inputs для Excel).
 * Возвращает плоский набор полей с разумными дефолтами.
 */
function _extractInputs(estimate, project) {
  const calc = (estimate && estimate.calculation) || {};
  const est = (estimate && estimate.estimate) || {};
  const totals = (estimate && estimate.totals) || {};
  const settings = (estimate && estimate.settings) || {};

  const personnel = calc.personnel || [];
  // Тариф рабочего/мастера — средний по уже посчитанным позициям AI.
  const findRate = (re) => {
    const row = personnel.find(p => re.test(String(p.role || p.item || '').toLowerCase()));
    return row ? _num(row.rate_per_day || row.rate || row.price, 0) : 0;
  };

  // Шаг 2 рефакторинга (20.06.2026): убраны 5 «теплоноситель»-параметров
  // (volume_kg / material_price / afflux_dosage / afflux_price / util_rate).
  // Они были привязаны к одному типу работ (замена ПГ) и появлялись в смете
  // даже для гидромех. очистки, ремонта котла и т.п. Теперь параметры —
  // только универсальные (бригада/сроки/ставки/налоги/наценки).
  // Материалы/химия выписываются как отдельные строки раздела E из массива
  // calculation.chemistry, у каждой свои qty и цена.
  return {
    shifts_per_day: _num(est.shifts_per_day || (est.shift_mode === '24/7' ? 2 : 1), 2),
    workers_per_shift: _num(est.workers_per_shift || est.crew_count, 4),
    foremen_per_shift: _num(est.foremen_per_shift, 1),
    work_days: _num(est.work_days, 5),
    road_days: _num(est.road_days, 1),
    mob_days: _num(est.mob_days || est.mobdemob_days, 2),
    rate_worker: findRate(/рабоч/) || 5500,
    rate_foreman: findRate(/мастер/) || 7000,
    rate_itr: _num(settings.itr_rate_per_day, 10000),
    rate_road: 3000,
    per_diem: _num(settings.per_diem_per_day, 1000),
    accommodation: 1500,
    siz: 25000,
    fot_tax_pct: _num(settings.fot_tax_pct, 55) / 100,
    overhead_pct: _num(settings.overhead_pct, 15) / 100,
    contingency_pct: _num(totals.contingency_pct, _num(settings.contingency_pct, 12)) / 100,
    markup: _num(est.markup_multiplier || totals.markup_multiplier, 2.2),
    material_markup: 1.25,
    vat_pct: _num(totals.vat_pct, _num(settings.vat_pct, 22)) / 100
  };
}

/**
 * Нормализатор одной позиции из AI-массивов calculation.{personnel,chemistry,…}.
 * Поля бывают разные: name/item/description, qty/count/days, price/rate/rate_per_day, total/amount, unit.
 * Возвращаем {name, qty, unit, price, total}.
 */
function _normalizeCalcRow(row) {
  if (!row || typeof row !== 'object') return null;
  const name = String(row.name || row.item || row.description || row.role || '').trim();
  if (!name) return null;
  const priceRaw = row.price != null ? row.price : (row.rate != null ? row.rate : (row.rate_per_day != null ? row.rate_per_day : (row.unit_price != null ? row.unit_price : null)));
  const totalRaw = row.total != null ? row.total : (row.amount != null ? row.amount : (row.sum != null ? row.sum : null));
  // 21.06.2026 ФИКС критичной ошибки: qty = count*days (а не count или days по отдельности).
  // AI Quick кладёт personnel-строки как {count, rate_per_day, days, total}. Раньше qty=count=1 →
  // F=C*E=1*rate=недосчёт в days раз. Теперь: если есть И count И days — qty = count*days; иначе
  // одно из них; иначе 1. (Старая логика приоритизировала qty/count над days — это и был баг.)
  let qty;
  if (row.qty != null) {
    qty = _num(row.qty, NaN);
  } else if (row.count != null && row.days != null) {
    qty = _num(row.count, 1) * _num(row.days, 1);
  } else if (row.count != null) {
    qty = _num(row.count, NaN);
  } else if (row.days != null) {
    qty = _num(row.days, NaN);
  } else {
    qty = NaN;
  }
  let price = priceRaw === null ? NaN : _num(priceRaw, NaN);
  let total = totalRaw === null ? NaN : _num(totalRaw, NaN);
  // Если есть только total — qty=1, price=total. Чтобы F=C*E=total в смете.
  if (Number.isFinite(total) && !Number.isFinite(price)) { price = total; qty = Number.isFinite(qty) ? qty : 1; }
  if (!Number.isFinite(qty))   qty = 1;
  if (!Number.isFinite(price)) price = 0;
  // 21.06.2026: если row.total задан и НЕ равен qty*price — доверяем total (он от AI).
  //   подгоняем qty так, чтобы C*E = total. Лучше иметь правильный итог за счёт некрасивого qty.
  if (Number.isFinite(total) && total > 0 && price > 0) {
    const expected = qty * price;
    if (Math.abs(expected - total) > 1) {
      qty = total / price;
    }
  }
  if (!Number.isFinite(total)) total = qty * price;
  const unit  = String(row.unit || row.units || row.measure || '').trim() || '—';
  return { name, qty, unit, price, total };
}

/** Применить нормализатор к массиву + отфильтровать пустые. */
function _normalizeCalcArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(_normalizeCalcRow).filter(Boolean);
}

/**
 * Сгенерировать смету.xlsx как Buffer.
 * Структура соответствует эталону /templates/smeta-template.xlsx.
 *
 * @param {object} estimate — recomputed-объект (см. mimir-auto-estimate.validateAndRecomputeMath).
 *                            Или legacy estimate Quick (см. mimir-tkp-quick._composeLegacyEstimate.ai_meta).
 * @param {object} project — { subject, object, deadline, schedule, ... }.
 * @param {object} customer — { name, inn, address }.
 * @param {object} [opts] — опциональные параметры; backwards-compat: если передан объект без
 *                          ключей author/workCategory/assumptions/warnings, но с name/phone/email —
 *                          трактуется как author.
 *   .author       — { name, phone, email } для блока «Контакты для уточнений» в секции 5.
 *   .workCategory — 'ground' | 'mlsp' | ... (используется в принципах расчёта).
 *   .assumptions  — string[]; если не пусто — используется вместо дефолтных допущений.
 *   .warnings     — Array<{title, text}>; перечисляется в «Замечаниях».
 *   .priceSource  — string (источник цен материалов, по умолчанию «рыночная оценка / аналоги»).
 * @returns {Promise<Buffer>}
 */
async function generateSmetaXlsx(estimate, project, customer, opts) {
  // backwards-compat: если 4-й аргумент похож на author (name/phone/email и нет наших ключей).
  let _opts = opts || {};
  if (_opts && (_opts.name || _opts.phone || _opts.email)
      && !_opts.author && !_opts.workCategory && !_opts.assumptions && !_opts.warnings) {
    _opts = { author: _opts };
  }
  const author = _opts.author || {};
  const workCategory = _opts.workCategory || '';
  const optAssumptions = Array.isArray(_opts.assumptions) ? _opts.assumptions.filter(Boolean) : [];
  const optWarnings = Array.isArray(_opts.warnings) ? _opts.warnings : [];
  const priceSource = _opts.priceSource || 'рыночная оценка / аналоги / уточнить у дилера';
  const analysisObj = (estimate && estimate.analysis) || {};
  const estAssumptions = Array.isArray(analysisObj.assumptions) ? analysisObj.assumptions.filter(Boolean) : [];
  const estWarnings = Array.isArray(analysisObj.warnings) ? analysisObj.warnings : [];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ASGARD CRM — Мимир';
  wb.created = new Date();

  const ws = wb.addWorksheet('Смета', {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true,
      fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
      printArea: 'A1:F99'
    },
    properties: { defaultRowHeight: 16 }
  });

  ws.columns = [
    { width: 5 }, { width: 50 }, { width: 13 }, { width: 10 }, { width: 14 }, { width: 17 }
  ];

  const I = _extractInputs(estimate || {}, project || {});
  // ──────── ЗАГОЛОВОК (короткое человеческое название проекта) ────────
  // Приоритет:
  //   1. project.title_short / title (AI отдаёт короткое имя)
  //   2. estimate.estimate.title (если AI прописал в самой смете)
  //   3. project.subject — обрабатываем: strip мусорных префиксов,
  //      если осталось коротким (≤120 симв) — берём.
  //   4. Дефолт.
  // Раньше R2 содержал «Письмо содержит закупку/запрос…» — это шум от AI-парсера письма.
  const _stripJunkPrefix = (s) => {
    if (!s) return s;
    let v = String(s).trim();
    // Рекурсивно срезаем мусорные префиксы пока они есть.
    // Покрытие: «Письмо содержит запрос на выполнению гидромеханической очистки…» → «гидромеханической очистки…»
    const re = /^(письмо\s+(содержит|с|про|об|о|по|от|включает)|содержит\s+(запрос|закупку|кп|тз)?|переслан(а|о|ы)?\s+(клиентский\s+)?(запрос|письмо|тз|кп|заявк[ауи]|документы)?(\s+с\s+тз)?|пересланны[йе]\s+(запрос|письмо|тз|документы)|fwd|fw|re|форвард|запрос(\s+на|\s+по)?|закупк[ауи](\s*\/\s*\w+)?(\s+на|\s+по)?|кп(\s+от|\s+на|\s+по)?|коммерческое\s+предложение(\s+на|\s+по)?|заявк[ауи](\s+на|\s+по)?|приглашени[ея](\s+на|\s+к)?|тз(\s+на|\s+по)?|заказчик\s+(прислал|просит|интересует|запрашивает|обратился)|выполнени[еюя]|проведени[еюя]|выполнить|провести|оценк[ауи]|по\s+выполнению|по\s+оценке|по\s+проведению|на\s+выполнение|на\s+проведение)\s*[:,—\-/]?\s*/i;
    let safety = 5;
    while (safety-- > 0 && re.test(v)) {
      const before = v;
      v = v.replace(re, '').trim();
      if (v === before) break;
    }
    // Капитализируем первую букву (если было обрезание).
    if (v && v[0] === v[0].toLowerCase() && v[0] !== v[0].toUpperCase()) {
      v = v[0].toUpperCase() + v.slice(1);
    }
    return v;
  };
  const _shortenTitle = (s) => {
    if (!s) return null;
    let str = _stripJunkPrefix(String(s).trim().replace(/\s+/g, ' '));
    if (!str) return null;
    if (str.length <= 120) return str;
    // Берём первое предложение/первую часть до точки/вопроса/перевода
    const m = str.match(/^[^.!?\n]{20,120}[.!?]/);
    if (m) return m[0].replace(/[.!?]$/, '');
    // Иначе — обрезка по запятой/тире/двоеточию в диапазоне 60-120
    const sep = str.slice(0, 120).search(/[,;:—–]\s/);
    if (sep > 30) return str.slice(0, sep);
    // Fallback: 100 симв + «…»
    return str.slice(0, 100).replace(/\s+\S*$/, '') + '…';
  };
  const title = _shortenTitle(project && project.title_short)
    || _shortenTitle(project && project.title)
    || _shortenTitle(estimate && estimate.estimate && estimate.estimate.title)
    || _shortenTitle(project && project.subject)
    || 'Расчёт себестоимости';
  const customerName = (customer && customer.name) || '—';
  const customerAddress = (customer && customer.address) || '';
  const objectName = (project && project.object) || '—';

  // ──────── СРОК РАБОТ (всегда непустой) ────────
  // Если AI/PRE дали явную строку — берём её. Иначе строим из дней:
  // mob_days (склад) + work_days (на объекте) + road_days*2 (туда+обратно) = окно.
  // Если есть estimate.estimate.date_start / date_end — формат «25.06.2026 – 22.07.2026 (X к.д.)».
  // Если есть только окно дней — «работы X смен + дорога Y дн (окно Z к.д.)».
  // Без даты ничего из БД — берём today+mob → today+mob+work+road*2 (расчётное окно).
  const _deriveDeadline = () => {
    if (project && project.deadline) return project.deadline;
    const est = (estimate && estimate.estimate) || {};
    if (est.date_start && est.date_end) {
      const ds = new Date(est.date_start);
      const de = new Date(est.date_end);
      const window = Math.round((de - ds) / 86400000) + 1;
      return `${ds.toLocaleDateString('ru-RU')} – ${de.toLocaleDateString('ru-RU')} (${window} к.д.)`;
    }
    const w = Number(I.work_days) || 0;
    const r = Number(I.road_days) || 0;
    const m = Number(I.mob_days) || 0;
    const totalWindow = m + w + r * 2;
    if (totalWindow > 0) {
      return `${w} рабочих смен + ${r * 2} дн дороги + ${m} дн подготовки (окно ${totalWindow} к.д.)`;
    }
    return 'по согласованию с заказчиком';
  };
  const deadlineStr = _deriveDeadline();

  // ─── Строка 1: заголовок ───
  ws.mergeCells('A1:F1');
  const r1 = ws.getCell('A1');
  r1.value = 'СМЕТА — расчёт себестоимости';
  _applyStyle(r1, STYLE.goldHeader);
  r1.font = { ...STYLE.goldHeader.font, size: 14, bold: true };
  r1.alignment = { vertical: 'middle', horizontal: 'center' };
  ws.getRow(1).height = 22;

  ws.mergeCells('A2:F2');
  const r2 = ws.getCell('A2');
  r2.value = title;
  _applyStyle(r2, STYLE.goldHeader);
  r2.alignment = { vertical: 'middle', horizontal: 'center' };

  // ─── Карточка проекта (строки 4..8) ───
  const card = [
    ['Заказчик:', customerName + (customerAddress ? ', ' + customerAddress : '')],
    ['Объект:', objectName],
    ['Исполнитель:', 'ООО «АСГАРД-Сервис»'],
    ['Срок работ:', deadlineStr],
    ['Оплата / гарантия:', 'отсрочка 60 к.д.; гарантия 12 мес.; дата сметы ' + _fmtRuDate(new Date())]
  ];
  card.forEach((row, idx) => {
    const r = 4 + idx;
    ws.mergeCells(`A${r}:B${r}`);
    ws.getCell(`A${r}`).value = row[0];
    _applyStyle(ws.getCell(`A${r}`), STYLE.subHeader);
    ws.mergeCells(`C${r}:F${r}`);
    ws.getCell(`C${r}`).value = row[1];
    _applyStyle(ws.getCell(`C${r}`), STYLE.textCell);
  });

  // ─── 1. ИСХОДНЫЕ ПАРАМЕТРЫ (строки 10..35) ───
  let r = 10;
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = '1. ИСХОДНЫЕ ПАРАМЕТРЫ (синие — редактируемые)';
  _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  r++;
  // Заголовки колонок: A-B='Параметр', C='Значение', D='Ед.', E-F='Примечание'.
  ws.mergeCells(`A${r}:B${r}`);
  ws.getCell(`A${r}`).value = 'Параметр';
  _applyStyle(ws.getCell(`A${r}`), STYLE.subHeader);
  ws.getCell(`C${r}`).value = 'Значение';
  _applyStyle(ws.getCell(`C${r}`), STYLE.subHeader);
  ws.getCell(`D${r}`).value = 'Ед.';
  _applyStyle(ws.getCell(`D${r}`), STYLE.subHeader);
  ws.mergeCells(`E${r}:F${r}`);
  ws.getCell(`E${r}`).value = 'Примечание';
  _applyStyle(ws.getCell(`E${r}`), STYLE.subHeader);
  r++;

  // Адреса ячеек параметров (Inputs) — фиксируем для формул раздела 2.
  // 19 универсальных параметров (без material-specific полей).
  const I_ROWS = {
    shifts_per_day:   r,
    workers_per_shift:r + 1,
    foremen_per_shift:r + 2,
    work_days:        r + 3,
    road_days:        r + 4,
    mob_days:         r + 5,
    rate_worker:      r + 6,
    rate_foreman:     r + 7,
    rate_itr:         r + 8,
    rate_road:        r + 9,
    per_diem:         r + 10,
    accommodation:    r + 11,
    siz:              r + 12,
    fot_tax_pct:      r + 13,
    overhead_pct:     r + 14,
    contingency_pct:  r + 15,
    markup:           r + 16,
    material_markup:  r + 17,
    vat_pct:          r + 18
  };
  const inputsList = [
    ['Смен в сутки', I.shifts_per_day, 'смен', I.shifts_per_day >= 2 ? '24/7 (день + ночь)' : 'дневной режим', 'shifts_per_day'],
    ['Рабочих в смене', I.workers_per_shift, 'чел', 'универсал = монтаж/промывка/такелаж', 'workers_per_shift'],
    ['Мастеров в смене', I.foremen_per_shift, 'чел', 'ответственный по наряду-допуску', 'foremen_per_shift'],
    ['Рабочие смены (work_days)', I.work_days, 'сут', 'эффективное время на объекте', 'work_days'],
    ['Дни дороги (road_days)', I.road_days, 'дн', I.road_days > 0 ? 'в одну сторону, ×2 в расчёте' : 'локальный объект (МО/МСК)', 'road_days'],
    ['Дни мобилизации/демоб.', I.mob_days, 'дн', 'комплектация на складе + сборка', 'mob_days'],
    ['Ставка рабочего', I.rate_worker, '₽/смена', 'тариф', 'rate_worker'],
    ['Ставка мастера', I.rate_foreman, '₽/смена', 'тариф', 'rate_foreman'],
    ['Ставка ИТР/РП', I.rate_itr, '₽/смена', 'норматив Асгарда', 'rate_itr'],
    ['Ставка дня дороги', I.rate_road, '₽/чел', '6 баллов × 500 ₽', 'rate_road'],
    ['Пайковые', I.per_diem, '₽/чел·дн', 'норматив', 'per_diem'],
    ['Проживание', I.accommodation, '₽/чел·ночь', 'аренда квартиры; 0 если местные', 'accommodation'],
    ['СИЗ + спецодежда', I.siz, '₽/чел', 'норматив-минимум Асгарда', 'siz'],
    ['Налог на ФОТ', I.fot_tax_pct, 'доля', 'параметр; касса ~55%', 'fot_tax_pct'],
    ['Накладные расходы', I.overhead_pct, 'доля', 'от прямых затрат', 'overhead_pct'],
    ['Непредвиденные', I.contingency_pct, 'доля', 'буфер 12–15%', 'contingency_pct'],
    ['Наценка стандартная (markup)', I.markup, '×', 'Мимир: новый клиент 2.0–2.3', 'markup'],
    ['Наценка на материал', I.material_markup, '×', 'для раздельного сценария', 'material_markup'],
    ['НДС', I.vat_pct, 'доля', 'ФЗ-425 с 01.01.2026', 'vat_pct']
  ];
  inputsList.forEach((row, idx) => {
    const cr = r + idx;
    ws.mergeCells(`A${cr}:B${cr}`);
    ws.getCell(`A${cr}`).value = row[0];
    _applyStyle(ws.getCell(`A${cr}`), STYLE.textCell);
    const valCell = ws.getCell(`C${cr}`);
    valCell.value = row[1];
    _applyStyle(valCell, STYLE.input);
    if (typeof row[1] === 'number' && row[2] === 'доля') valCell.numFmt = '0.00%';
    else if (typeof row[1] === 'number' && row[2] === '×') valCell.numFmt = '0.00';
    else if (typeof row[1] === 'number') valCell.numFmt = '#,##0.##';
    ws.getCell(`D${cr}`).value = row[2];
    _applyStyle(ws.getCell(`D${cr}`), STYLE.textCell);
    ws.mergeCells(`E${cr}:F${cr}`);
    ws.getCell(`E${cr}`).value = row[3];
    _applyStyle(ws.getCell(`E${cr}`), STYLE.textCell);
  });

  // helper: получить адрес ячейки параметра.
  const $C = (key) => `C${I_ROWS[key]}`;

  // ─── 2. КАЛЬКУЛЯЦИЯ СЕБЕСТОИМОСТИ ───
  r = 11 + inputsList.length + 2; // отступ
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = '2. КАЛЬКУЛЯЦИЯ СЕБЕСТОИМОСТИ (без НДС)';
  _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  r++;
  // Заголовки колонок секции 2.
  const cols2 = ['№', 'Статья затрат', 'Кол-во', 'Ед.', 'Цена/ставка, ₽', 'Сумма, ₽'];
  cols2.forEach((v, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = v;
    _applyStyle(cell, STYLE.subHeader);
  });
  r++;

  const sumRows = []; // запоминаем строки итогов разделов A..E

  // A. ПЕРСОНАЛ ────────────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = 'A. Персонал (24/7, 2 смены)';
  _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  r++;

  // КРИТИЧНЫЙ ФИКС 20.06.2026 (TDZ):
  //   _toCellValue / _pushItem ОБЪЯВЛЯЕМ ДО раздела A (раньше были в B → TDZ при использовании в A).
  //   $C('siz') возвращает строку 'C29' — это ссылка на ячейку для Excel-формулы.
  //   ExcelJS требует обёртки { formula: 'C29' } чтобы понять что это формула.
  const _toCellValue = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'object') return v;
    if (typeof v === 'string') {
      if (/^[A-Z]{1,3}[0-9]{1,6}([\+\-\*\/][A-Z0-9\(\)\.\s]+)*$/.test(v.trim())) {
        return { formula: v };
      }
    }
    return v;
  };
  const _pushItem = (code, name, qty, unit, price, accumulator) => {
    ws.getCell(`A${r}`).value = code; _applyStyle(ws.getCell(`A${r}`), STYLE.textCell);
    ws.getCell(`B${r}`).value = name; _applyStyle(ws.getCell(`B${r}`), STYLE.textCell);
    const qv = _toCellValue(qty);
    ws.getCell(`C${r}`).value = qv; _applyStyle(ws.getCell(`C${r}`), STYLE.input);
    if (typeof qty === 'number') ws.getCell(`C${r}`).numFmt = '#,##0.##';
    ws.getCell(`D${r}`).value = unit; _applyStyle(ws.getCell(`D${r}`), STYLE.textCell);
    const pv = _toCellValue(price);
    ws.getCell(`E${r}`).value = pv; _applyStyle(ws.getCell(`E${r}`), STYLE.input);
    ws.getCell(`F${r}`).value = { formula: `C${r}*E${r}` }; _applyStyle(ws.getCell(`F${r}`), STYLE.money);
    if (accumulator) accumulator.push(r);
    r++;
  };

  // A1 ИТР: qty = work_days + road_days*2 + mob_days, rate = rate_itr
  const A_rows = [];
  const pushLine = (code, name, qtyFormula, unit, rateFormula) => {
    ws.getCell(`A${r}`).value = code;       _applyStyle(ws.getCell(`A${r}`), STYLE.textCell);
    ws.getCell(`B${r}`).value = name;       _applyStyle(ws.getCell(`B${r}`), STYLE.textCell);
    ws.getCell(`C${r}`).value = { formula: qtyFormula };  _applyStyle(ws.getCell(`C${r}`), STYLE.money);
    ws.getCell(`C${r}`).numFmt = '#,##0.##';
    ws.getCell(`D${r}`).value = unit;       _applyStyle(ws.getCell(`D${r}`), STYLE.textCell);
    ws.getCell(`E${r}`).value = { formula: rateFormula }; _applyStyle(ws.getCell(`E${r}`), STYLE.money);
    ws.getCell(`F${r}`).value = { formula: `C${r}*E${r}` }; _applyStyle(ws.getCell(`F${r}`), STYLE.money);
    A_rows.push(r);
    r++;
  };
  // Опус-рефактор 20.06.2026: А. Персонал тоже динамизируем — если AI вернул calculation.personnel,
  // выписываем его строки (там реально посчитаны ИТР/мастер/рабочий/наблюдающий/подготовка/дорога
  // с конкретными qty и rate под этот проект). Если AI ничего не вернул — fallback на формулы
  // (как в эталоне) с пересчётом из C-параметров.
  const calcEarly = (estimate && estimate.calculation) || {};
  const personnelRows = _normalizeCalcArray(calcEarly.personnel);
  if (personnelRows.length) {
    personnelRows.forEach((row, idx) => {
      _pushItem('A' + (idx + 1), row.name, row.qty, row.unit || 'чел-см', row.price, A_rows);
    });
  } else {
    pushLine('A1', 'ИТР / руководитель работ (весь период)',
      `${$C('work_days')}+${$C('road_days')}*2+${$C('mob_days')}`, 'смена', $C('rate_itr'));
    pushLine('A2', 'Мастера (по 1 на смену)',
      `${$C('foremen_per_shift')}*${$C('shifts_per_day')}*${$C('work_days')}`, 'чел-см', $C('rate_foreman'));
    pushLine('A3', 'Рабочие-исполнители (по сменам)',
      `${$C('workers_per_shift')}*${$C('shifts_per_day')}*${$C('work_days')}`, 'чел-см', $C('rate_worker'));
    pushLine('A4', 'Подготовка на складе (комплектация)',
      `${$C('mob_days')}*(${$C('workers_per_shift')}+${$C('foremen_per_shift')})`, 'чел-см', $C('rate_worker'));
    pushLine('A5', 'Дни дороги',
      `${$C('road_days')}*2*((${$C('workers_per_shift')}+${$C('foremen_per_shift')})*${$C('shifts_per_day')}+1)`, 'чел-дн', $C('rate_road'));
  }

  // ФОТ итого
  ws.getCell(`A${r}`).value = '';  _applyStyle(ws.getCell(`A${r}`), STYLE.subHeader);
  ws.mergeCells(`B${r}:E${r}`);
  ws.getCell(`B${r}`).value = 'ФОТ, итого'; _applyStyle(ws.getCell(`B${r}`), STYLE.subHeader);
  ws.getCell(`F${r}`).value = { formula: `SUM(F${A_rows[0]}:F${A_rows[A_rows.length - 1]})` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.moneyBold);
  const fotRow = r; r++;

  // Налог ФОТ
  ws.mergeCells(`B${r}:E${r}`);
  ws.getCell(`B${r}`).value = 'Налог / взносы на ФОТ'; _applyStyle(ws.getCell(`B${r}`), STYLE.textCell);
  ws.getCell(`F${r}`).value = { formula: `F${fotRow}*${$C('fot_tax_pct')}` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.money);
  const taxRow = r; r++;

  // Персонал, итого
  ws.mergeCells(`B${r}:E${r}`);
  ws.getCell(`B${r}`).value = 'Персонал, итого'; _applyStyle(ws.getCell(`B${r}`), STYLE.sectionHeader);
  ws.getCell(`F${r}`).value = { formula: `F${fotRow}+F${taxRow}` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.moneyBold);
  sumRows.push(r); r++;

  // B. ТЕКУЩИЕ ────────────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = 'B. Текущие расходы';
  _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  r++;

  const B_rows = [];
  // Backward-compat: старый pushFixed пишет в B_rows. _pushItem объявлен выше (до раздела A).
  const pushFixed = (code, name, qty, unit, price) => _pushItem(code, name, qty, unit, price, B_rows);
  // Опус-рефактор 20.06.2026: вместо хардкода берём строки из ai_meta.calculation.current_costs.
  // Если AI ничего не вернул — fallback на универсальные строки B1-B5 (СИЗ/расходники/оборудование/освещение/связь).
  // ВАЖНО: «Освещение/связь» имеют смысл для 24/7; их код держим, но для дневной смены AI не положит освещение.
  const calc = (estimate && estimate.calculation) || {};
  const currentCostsRows = _normalizeCalcArray(calc.current_costs);
  if (currentCostsRows.length) {
    currentCostsRows.forEach((row, idx) => {
      pushFixed('B' + (idx + 1), row.name, row.qty, row.unit || 'компл.', row.price);
    });
  } else {
    // Универсальный fallback (НЕ привязанный к work_type)
    pushFixed('B1', 'СИЗ + спецодежда (на бригаду)',
      { formula: `(${$C('workers_per_shift')}+${$C('foremen_per_shift')})*${$C('shifts_per_day')}+1` }, 'чел', $C('siz'));
    pushFixed('B2', 'Расходники по проекту', 1, 'компл.', 80000);
    pushFixed('B3', 'Оборудование и инструмент (использование)', 1, 'компл.', 120000);
    pushFixed('B4', 'Освещение (прожекторы, ночь)', { formula: `${$C('work_days')}` }, 'сут', 3000);
    pushFixed('B5', 'Связь (рации мастера + ИТР)', { formula: `${$C('foremen_per_shift')}*${$C('shifts_per_day')}+1` }, 'шт', 1500);
  }

  ws.mergeCells(`B${r}:E${r}`);
  ws.getCell(`B${r}`).value = 'Текущие расходы, итого'; _applyStyle(ws.getCell(`B${r}`), STYLE.sectionHeader);
  ws.getCell(`F${r}`).value = { formula: `SUM(F${B_rows[0]}:F${B_rows[B_rows.length - 1]})` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.moneyBold);
  sumRows.push(r); r++;

  // C. КОМАНДИРОВОЧНЫЕ ────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = 'C. Командировочные';
  _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  r++;
  const C_rows = [];
  // Командировочные = travel массив (если есть). Содержит пайковые/проживание/билеты от AI.
  const travelRows = _normalizeCalcArray(calc.travel);
  if (travelRows.length) {
    travelRows.forEach((row, idx) => {
      _pushItem('C' + (idx + 1), row.name, row.qty, row.unit || 'чел·дн', row.price, C_rows);
    });
  } else {
    _pushItem('C1', 'Пайковые',
      { formula: `((${$C('workers_per_shift')}+${$C('foremen_per_shift')})*${$C('shifts_per_day')}+1)*(${$C('work_days')}+${$C('road_days')}*2)` },
      'чел·дн', $C('per_diem'), C_rows);
    _pushItem('C2', 'Проживание',
      { formula: `((${$C('workers_per_shift')}+${$C('foremen_per_shift')})*${$C('shifts_per_day')}+1)*${$C('work_days')}` },
      'чел-ноч', $C('accommodation'), C_rows);
    _pushItem('C3', 'Билеты (если применимо)', 0, '—', 0, C_rows);
  }

  ws.mergeCells(`B${r}:E${r}`);
  ws.getCell(`B${r}`).value = 'Командировочные, итого'; _applyStyle(ws.getCell(`B${r}`), STYLE.sectionHeader);
  ws.getCell(`F${r}`).value = { formula: `SUM(F${C_rows[0]}:F${C_rows[C_rows.length - 1]})` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.moneyBold);
  sumRows.push(r); r++;

  // D. ЛОГИСТИКА ──────────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = 'D. Логистика / транспорт';
  _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  r++;
  const D_rows = [];
  // Логистика = transport массив (если есть). Доставка оборудования, такси и т.п.
  const transportRows = _normalizeCalcArray(calc.transport);
  if (transportRows.length) {
    transportRows.forEach((row, idx) => {
      _pushItem('D' + (idx + 1), row.name, row.qty, row.unit || 'рейс', row.price, D_rows);
    });
  } else {
    _pushItem('D1', 'Доставка оборудования', 1, 'рейс', 35000, D_rows);
    _pushItem('D2', 'Доставка инструмента (Газель)', 2, 'рейс', 12000, D_rows);
    _pushItem('D3', 'Такси / служебный транспорт', { formula: `${$C('work_days')}` }, 'дн', 2000, D_rows);
  }

  ws.mergeCells(`B${r}:E${r}`);
  ws.getCell(`B${r}`).value = 'Транспорт, итого'; _applyStyle(ws.getCell(`B${r}`), STYLE.sectionHeader);
  ws.getCell(`F${r}`).value = { formula: `SUM(F${D_rows[0]}:F${D_rows[D_rows.length - 1]})` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.moneyBold);
  sumRows.push(r); r++;

  // E. МАТЕРИАЛЫ ──────────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = 'E. Материалы и реагенты';
  _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  r++;
  const E_rows = [];

  // Опус-рефактор 20.06.2026: вместо 4 захардкоженных строк (Теплоноситель/Реагент/Утилизация/Лаб)
  // выписываем строки из ai_meta.calculation.chemistry — там AI положил именно те материалы,
  // которые нужны для конкретной работы. Для гидромех. очистки массив будет пуст
  // (нет реагентов) — тогда показываем одну строку-заглушку, чтобы раздел E
  // оставался в шаблоне (единая структура смет независимо от типа работы).
  const chemistryRows = _normalizeCalcArray(calc.chemistry);
  if (chemistryRows.length) {
    chemistryRows.forEach((row, idx) => {
      _pushItem('E' + (idx + 1), row.name, row.qty, row.unit || 'компл.', row.price, E_rows);
    });
  } else {
    // Заглушка: одна строка чтобы раздел E оставался в шаблоне (единая структура смет).
    _pushItem('E1', 'Материалы по проекту — отсутствуют (см. состав работ)', 0, '—', 0, E_rows);
  }

  ws.mergeCells(`B${r}:E${r}`);
  ws.getCell(`B${r}`).value = 'Материалы и реагенты, итого'; _applyStyle(ws.getCell(`B${r}`), STYLE.sectionHeader);
  ws.getCell(`F${r}`).value = { formula: `SUM(F${E_rows[0]}:F${E_rows[E_rows.length - 1]})` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.moneyBold);
  sumRows.push(r); r++;

  // ─── ПРЯМЫЕ ЗАТРАТЫ, ИТОГО ───
  r++;
  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = 'ПРЯМЫЕ ЗАТРАТЫ, ИТОГО'; _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  ws.getCell(`F${r}`).value = { formula: sumRows.map(rr => `F${rr}`).join('+') };
  _applyStyle(ws.getCell(`F${r}`), STYLE.moneyBold);
  const directTotalRow = r; r++;

  // Накладные
  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = '+ Накладные расходы'; _applyStyle(ws.getCell(`A${r}`), STYLE.textCell);
  ws.getCell(`F${r}`).value = { formula: `F${directTotalRow}*${$C('overhead_pct')}` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.money);
  const overheadRow = r; r++;

  // Непредвиденные
  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = '+ Непредвиденные'; _applyStyle(ws.getCell(`A${r}`), STYLE.textCell);
  ws.getCell(`F${r}`).value = { formula: `(F${directTotalRow}+F${overheadRow})*${$C('contingency_pct')}` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.money);
  const contRow = r; r++;

  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = 'СЕБЕСТОИМОСТЬ (без НДС)'; _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  ws.getCell(`F${r}`).value = { formula: `F${directTotalRow}+F${overheadRow}+F${contRow}` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.moneyBold);
  const costRow = r; r++;

  // ─── 3. ЦЕНА ДЛЯ ЗАКАЗЧИКА ───
  r++;
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = '3. ЦЕНА ДЛЯ ЗАКАЗЧИКА — стандартная наценка';
  _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  r++;

  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = 'Цена без НДС (стандартная наценка)';
  _applyStyle(ws.getCell(`A${r}`), STYLE.textCell);
  ws.getCell(`F${r}`).value = { formula: `F${costRow}*${$C('markup')}` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.money);
  const priceStdNoVatRow = r; r++;

  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = 'НДС'; _applyStyle(ws.getCell(`A${r}`), STYLE.textCell);
  ws.getCell(`F${r}`).value = { formula: `F${priceStdNoVatRow}*${$C('vat_pct')}` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.money);
  const vatStdRow = r; r++;

  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = 'ЦЕНА ЗАКАЗЧИКУ (с НДС, стандарт)'; _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  ws.getCell(`F${r}`).value = { formula: `F${priceStdNoVatRow}+F${vatStdRow}` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.moneyBold);
  r++;

  // Раздельная: материалы × material_markup + работы × markup
  // материалы = sumRows[4] (Материалы), работы = себестоимость - материалы.
  r++;
  ws.mergeCells(`A${r}:F${r}`);
  ws.getCell(`A${r}`).value = '3a. РАЗДЕЛЬНАЯ НАЦЕНКА (материалы × material_markup + работы × markup)';
  _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  r++;

  const materialsRow = sumRows[4]; // итог раздела E
  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = 'Цена без НДС (раздельная наценка)'; _applyStyle(ws.getCell(`A${r}`), STYLE.textCell);
  ws.getCell(`F${r}`).value = { formula: `F${materialsRow}*${$C('material_markup')}+(F${costRow}-F${materialsRow})*${$C('markup')}` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.money);
  const priceSepNoVatRow = r; r++;

  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = 'НДС'; _applyStyle(ws.getCell(`A${r}`), STYLE.textCell);
  ws.getCell(`F${r}`).value = { formula: `F${priceSepNoVatRow}*${$C('vat_pct')}` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.money);
  const vatSepRow = r; r++;

  ws.mergeCells(`A${r}:E${r}`);
  ws.getCell(`A${r}`).value = 'ЦЕНА ЗАКАЗЧИКУ (с НДС, раздельная)'; _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  ws.getCell(`F${r}`).value = { formula: `F${priceSepNoVatRow}+F${vatSepRow}` };
  _applyStyle(ws.getCell(`F${r}`), STYLE.moneyBold);
  r++;

  // ═════════════════════════════════════════════════════════════════════════
  // 4. СРАВНЕНИЕ СЦЕНАРИЕВ НАЦЕНКИ
  // ═════════════════════════════════════════════════════════════════════════
  r++;
  // Расширяем рабочий диапазон до колонки H (для широкой таблицы сценариев).
  if (!ws.getColumn(7).width || ws.getColumn(7).width < 14) ws.getColumn(7).width = 14;
  if (!ws.getColumn(8).width || ws.getColumn(8).width < 38) ws.getColumn(8).width = 38;

  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = '4. СРАВНЕНИЕ СЦЕНАРИЕВ НАЦЕНКИ';
  _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  r++;

  // Заголовки колонок A..H.
  const scnHeaders = ['Сценарий', 'Описание', 'Множитель', 'Цена без НДС', 'Цена с НДС', 'Прибыль', 'Маржа, %', 'Комментарий'];
  scnHeaders.forEach((v, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = v;
    _applyStyle(cell, STYLE.subHeader);
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  ws.getRow(r).height = 28;
  r++;

  // Стили строк сценариев.
  const SCN_STYLE = {
    text: {
      font: { name: 'Calibri', size: 10 },
      alignment: { vertical: 'middle', horizontal: 'left', wrapText: true },
      border: { top: { style: 'thin', color: { argb: 'FFBFBFBF' } }, bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } }, left: { style: 'thin', color: { argb: 'FFBFBFBF' } }, right: { style: 'thin', color: { argb: 'FFBFBFBF' } } }
    },
    money: {
      font: { name: 'Calibri', size: 10 },
      alignment: { vertical: 'middle', horizontal: 'right' },
      numFmt: '# ##0 " ₽"',
      border: { top: { style: 'thin', color: { argb: 'FFBFBFBF' } }, bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } }, left: { style: 'thin', color: { argb: 'FFBFBFBF' } }, right: { style: 'thin', color: { argb: 'FFBFBFBF' } } }
    },
    pct: {
      font: { name: 'Calibri', size: 10 },
      alignment: { vertical: 'middle', horizontal: 'right' },
      numFmt: '0.0"%"',
      border: { top: { style: 'thin', color: { argb: 'FFBFBFBF' } }, bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } }, left: { style: 'thin', color: { argb: 'FFBFBFBF' } }, right: { style: 'thin', color: { argb: 'FFBFBFBF' } } }
    },
    mult: {
      font: { name: 'Calibri', size: 10 },
      alignment: { vertical: 'middle', horizontal: 'center' },
      numFmt: '0.00"×"',
      border: { top: { style: 'thin', color: { argb: 'FFBFBFBF' } }, bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } }, left: { style: 'thin', color: { argb: 'FFBFBFBF' } }, right: { style: 'thin', color: { argb: 'FFBFBFBF' } } }
    },
    zebraFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } },
    goldFill:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4A843' } },
    goldFont:  { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF3A2A00' } }
  };

  // Утилита: вставить строку сценария.
  // priceNoVatFormula — формула цены без НДС (ссылается на costRow и/или materialsRow + параметры).
  // multiplierValue — число (для столбца «Множитель») ИЛИ объект {formula:'...'} для раздельной.
  const pushScenario = (name, description, multiplierValue, priceNoVatFormula, comment, opts) => {
    const isGold = !!(opts && opts.gold);
    const isZebra = !!(opts && opts.zebra);

    const applyRow = (cell, baseStyle) => {
      _applyStyle(cell, baseStyle);
      if (isGold) {
        cell.fill = SCN_STYLE.goldFill;
        cell.font = { ...(baseStyle.font || {}), ...SCN_STYLE.goldFont };
      } else if (isZebra) {
        cell.fill = SCN_STYLE.zebraFill;
      }
    };

    // A: Сценарий
    const aCell = ws.getCell(`A${r}`);
    aCell.value = name;
    applyRow(aCell, SCN_STYLE.text);
    aCell.font = { ...aCell.font, bold: true };

    // B: Описание
    const bCell = ws.getCell(`B${r}`);
    bCell.value = description;
    applyRow(bCell, SCN_STYLE.text);

    // C: Множитель
    const cCell = ws.getCell(`C${r}`);
    if (typeof multiplierValue === 'object' && multiplierValue && multiplierValue.formula) {
      cCell.value = { formula: multiplierValue.formula };
      applyRow(cCell, SCN_STYLE.text);
      cCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    } else {
      cCell.value = multiplierValue;
      applyRow(cCell, SCN_STYLE.mult);
    }

    // D: Цена без НДС = формула
    const dCell = ws.getCell(`D${r}`);
    dCell.value = { formula: priceNoVatFormula };
    applyRow(dCell, SCN_STYLE.money);

    // E: Цена с НДС = D*(1+vat_pct)
    const eCell = ws.getCell(`E${r}`);
    eCell.value = { formula: `D${r}*(1+${$C('vat_pct')})` };
    applyRow(eCell, SCN_STYLE.money);

    // F: Прибыль = D - себестоимость
    const fCell = ws.getCell(`F${r}`);
    fCell.value = { formula: `D${r}-F${costRow}` };
    applyRow(fCell, SCN_STYLE.money);

    // G: Маржа, % = F/себестоимость*100
    const gCell = ws.getCell(`G${r}`);
    gCell.value = { formula: `IFERROR(F${r}/F${costRow}*100,0)` };
    applyRow(gCell, SCN_STYLE.pct);

    // H: Комментарий
    const hCell = ws.getCell(`H${r}`);
    hCell.value = comment;
    applyRow(hCell, SCN_STYLE.text);

    ws.getRow(r).height = 30;
    r++;
  };

  pushScenario(
    '×2.0 — агрессивный',
    'Себестоимость × 2.0',
    2.0,
    `F${costRow}*2.0`,
    'Минимально приемлемая для удержания клиента',
    { zebra: false }
  );
  pushScenario(
    '×2.2 — стандартная (Мимир)',
    'Себестоимость × 2.2',
    2.2,
    `F${costRow}*2.2`,
    'Дефолт по политике Асгарда, новый клиент',
    { zebra: true }
  );
  pushScenario(
    '×2.3 — премиум',
    'Себестоимость × 2.3',
    2.3,
    `F${costRow}*2.3`,
    'Для постоянного клиента / низкая конкуренция',
    { zebra: false }
  );
  pushScenario(
    'Раздельная (РЕКОМЕНДУЕТСЯ)',
    'Материалы × material_markup + работы × markup',
    { formula: `"—"` },
    `F${materialsRow}*${$C('material_markup')}+(F${costRow}-F${materialsRow})*${$C('markup')}`,
    'Материалы pass-through, работы со стандартной наценкой',
    { gold: true }
  );

  // ═════════════════════════════════════════════════════════════════════════
  // 5. ПРИМЕЧАНИЯ И ИСТОЧНИКИ
  // ═════════════════════════════════════════════════════════════════════════
  r++;
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = '5. ПРИМЕЧАНИЯ И ИСТОЧНИКИ';
  _applyStyle(ws.getCell(`A${r}`), STYLE.sectionHeader);
  r++;

  const NOTE_TITLE_STYLE = {
    font: { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF333333' } },
    alignment: { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 }
  };
  const NOTE_TEXT_STYLE = {
    font: { name: 'Calibri', size: 10, color: { argb: 'FF555555' } },
    alignment: { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 }
  };

  // Утилита: один блок заметки — заголовок + тело (одна или несколько строк).
  const pushNoteTitle = (text) => {
    ws.mergeCells(`A${r}:H${r}`);
    const cell = ws.getCell(`A${r}`);
    cell.value = text;
    _applyStyle(cell, NOTE_TITLE_STYLE);
    cell.font = NOTE_TITLE_STYLE.font;
    cell.alignment = NOTE_TITLE_STYLE.alignment;
    ws.getRow(r).height = 18;
    r++;
  };
  const pushNoteLine = (text) => {
    ws.mergeCells(`A${r}:H${r}`);
    const cell = ws.getCell(`A${r}`);
    cell.value = text;
    cell.font = NOTE_TEXT_STYLE.font;
    cell.alignment = NOTE_TEXT_STYLE.alignment;
    // Высота — приблизительно по длине строки (wrapText сделает остальное).
    const approxLines = Math.max(1, Math.ceil(String(text).length / 140));
    ws.getRow(r).height = Math.max(16, approxLines * 15);
    r++;
  };

  // 5.1 Принципы расчёта.
  pushNoteTitle('1. Принципы расчёта');
  pushNoteLine(
    `Расчёт по нормативам ООО «АСГАРД-Сервис». Тарифная сетка «${workCategory || '—'}». ` +
    'Состав бригады — Приказы Минтруда №902н, №782н. Режим работ 24/7 (две смены × 12 ч) по умолчанию.'
  );

  // 5.2 Источники цен.
  pushNoteTitle('2. Источники цен');
  pushNoteLine('• Ставки персонала — внутренняя тарифная сетка БД компании.');
  pushNoteLine(`• Цены материалов — ${priceSource}.`);
  pushNoteLine('• Накладные / Непредвиденные — настройки CRM.');

  // 5.3 Допущения.
  pushNoteTitle('3. Допущения');
  const assumptionsToUse = (optAssumptions.length ? optAssumptions
    : (estAssumptions.length ? estAssumptions
      : [
        'Объём — ориентир, уточняется по факту.',
        'НДС 22% от 01.01.2026 (ФЗ-425).',
        'Цены без НДС, опт.'
      ]));
  assumptionsToUse.forEach((a) => pushNoteLine('• ' + String(a)));

  // 5.4 Замечания.
  pushNoteTitle('4. Замечания');
  const warningsToUse = (optWarnings.length ? optWarnings : estWarnings);
  if (warningsToUse.length) {
    warningsToUse.forEach((w) => {
      if (w && typeof w === 'object') {
        const title = String(w.title || w.kind || 'Внимание');
        const text = String(w.text || w.message || w.detail || '');
        pushNoteLine('• ' + title + (text ? ': ' + text : ''));
      } else {
        pushNoteLine('• ' + String(w));
      }
    });
  } else {
    pushNoteLine('(особых замечаний нет)');
  }

  // 5.5 Контакты.
  pushNoteTitle('5. Контакты');
  const authorName  = author.name  || '(автор расчёта)';
  const authorPhone = author.phone || '—';
  const authorEmail = author.email || '—';
  pushNoteLine(
    `По вопросам сметы — ${authorName} тел ${authorPhone} ${authorEmail}. Дата: ${_fmtRuDate(new Date())}.`
  );

  // Сохраняем как Buffer.
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

// ═════════════════════════════════════════════════════════════════════════
// 2. ОТЧЁТ ДИРЕКТОРУ — docxtemplater
// ═════════════════════════════════════════════════════════════════════════

function _renderDocxTemplate(tplPath, data) {
  const { Docxtemplater, PizZip } = _loadDocxLibs();
  const content = fs.readFileSync(tplPath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '—'
  });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Сгенерировать отчёт директору.docx.
 * @param {object} estimate — структура (Quick legacy или recomputed) с calculation/totals.
 * @param {object} project  — { subject, object, deadline, ... }
 * @param {object} customer — { name, address, inn }
 * @param {object} analysis — { warnings:[], recommendations:[] } (опц).
 * @param {object} [opts]
 *   .author       — { name, phone, email } (PM/автор) — переопределяет подпись.
 *   .workCategory — текстовая категория (для будущих расширений).
 *   .assumptions  — string[] — допущения; добавляются к summary если AI их не вернул.
 *   .warnings     — Array<{title,text}> | string[] — внешние замечания (мерджатся с analysis.warnings).
 * @returns {Promise<Buffer>}
 */
async function generateDirectorReportDocx(estimate, project, customer, analysis, opts) {
  const _opts = opts || {};
  const optAuthor = _opts.author || null;
  const optAssumptions = Array.isArray(_opts.assumptions) ? _opts.assumptions.filter(Boolean) : [];
  const optWarnings = Array.isArray(_opts.warnings) ? _opts.warnings : [];
  const est = (estimate && estimate.estimate) || {};
  const calc = (estimate && estimate.calculation) || {};
  const totals = (estimate && estimate.totals) || {};
  const settings = (estimate && estimate.settings) || {};
  const ana = analysis || {};

  // ─── Финансы (раздельные поля) ────────────────────────────────────────
  const cost = _num(totals.total_cost || totals.cost_no_vat, 0);
  const priceStdRaw = _num(totals.total_with_vat || totals.price_standard_vat, 0);
  // Материалы — сумма chemistry; работы — остаток себестоимости.
  const materials = (calc.chemistry || []).reduce(
    (s, it) => s + _num(it.total, _num(it.qty) * _num(it.price)), 0
  );
  const markup = _num(est.markup_multiplier || totals.markup_multiplier, 2.2);
  const matMarkupSrc = _num(est.material_markup || totals.material_markup, 0);
  const matMarkup = matMarkupSrc > 0 ? matMarkupSrc : 1.25;
  const vatPct = _num(totals.vat_pct, _num(settings.vat_pct, 22)) / 100;
  const works = Math.max(0, cost - materials);

  // price_standard: cost × markup × (1 + НДС)
  const priceStandard = priceStdRaw > 0 ? priceStdRaw : cost * markup * (1 + vatPct);
  // price_recommended: раздельная наценка (материал × matMarkup + работы × markup).
  // Опус-фикс 19.06.2026: ВСЕГДА считаем раздельную (даже если matMarkupSrc=0),
  // используя дефолт 1.25. Если материалов нет (materials=0) — формула вернёт = priceStandard,
  // это математически корректно. Раньше при matMarkupSrc=0 раздельная == standard,
  // и в отчёте писалось «3,57 vs 3,57» — что выглядело как баг расчёта.
  const priceRecommended = (materials * matMarkup + works * markup) * (1 + vatPct);
  // Помечаем равны ли цены — для economy_comment ниже.
  const pricesEqual = Math.abs(priceRecommended - priceStandard) < 1; // в пределах 1₽

  const profitStandard = priceStandard - cost * (1 + vatPct);
  const profitRecommended = priceRecommended - cost * (1 + vatPct);

  // ─── Бригада / режим ──────────────────────────────────────────────────
  const crewSize = _num(est.crew_count, 0);
  const foremen = _num(est.foremen_count, 0);
  const workers = _num(est.workers_count, 0);
  const observers = _num(est.observers_count, 0);
  const itr = _num(est.itr_count, 1);
  const shifts = _num(est.shifts_per_day, 1);
  const workDays = _num(est.work_days, 0);
  const roadDays = _num(est.road_days, 0);
  const deadline = (project && project.deadline) || ((workDays || roadDays)
    ? `${workDays} рабочих смен + ${roadDays * 2} дн дороги` : '—');
  const schedule = shifts >= 2 ? 'круглосуточный (2 смены)' : 'дневная смена';
  const scheduleShort = shifts >= 2
    ? 'Круглосуточный (2 смены день/ночь)'
    : 'Дневная смена (1 смена)';

  const crewComposition = (() => {
    const parts = [];
    if (itr > 0) parts.push(`${itr} ИТР/РП`);
    if (foremen > 0) parts.push(`${foremen} мастера`);
    if (workers > 0) parts.push(`${workers} слесарей-универсалов`);
    if (observers > 0) parts.push(`${observers} наблюдающих`);
    return parts.join(' + ') || '—';
  })();

  // ─── AI-summary (1 параграф) ─────────────────────────────────────────
  let summary = ana.summary;
  let section2Text = ana.section_2_text;
  if (!summary || !section2Text) {
    try {
      const aiProvider = require('./ai-provider');
      const projectSubj = project?.subject || project?.title || 'выполнение работ';
      const projectVol = project?.volume || est.volume || '—';

      if (!summary) {
        // Опус-фикс 19.06.2026: ЗАПРЕТ начинать со слова «Резюме» —
        // в шаблоне заголовок уже «Резюме.», AI добавлял «Резюме: …» → двойное слово.
        const summaryPrompt = `Напиши 1 связный параграф (содержание раздела «Резюме») для отчёта директору по проекту "${projectSubj}".\n\n` +
          `Должно содержать:\n` +
          `- что заказал клиент (1 предложение),\n` +
          `- объём работ (${projectVol}),\n` +
          `- режим (${schedule}),\n` +
          `- бригаду (${crewSize} чел.),\n` +
          `- срок (${deadline}),\n` +
          `- себестоимость ${_fmtMillions(cost)} без НДС,\n` +
          `- рекомендуемую цену ${_fmtMillions(priceRecommended)} с НДС.\n\n` +
          `СТРОГО:\n` +
          `- НЕ начинай со слова «Резюме» (заголовок уже есть выше).\n` +
          `- НЕ ставь префиксы «Резюме:», «Кратко:», «Итог:», «Сводка:».\n` +
          `- Начни сразу с фактического описания, например «Заказчик запросил…» или «АО «X» обратилось…».\n` +
          `- Стиль деловой, сжатый, для директора. 4-6 предложений в одном абзаце.`;
        const summaryResult = await aiProvider.complete({
          system: 'Ты пишешь резюме коммерческих отчётов для директора Асгард-Сервис. Никаких префиксов вроде «Резюме:», «Итог:», «Сводка:» — начинай с фактов.',
          messages: [{ role: 'user', content: summaryPrompt }],
          maxTokens: 500
        });
        summary = (summaryResult && (summaryResult.text || summaryResult.content)) || null;
        // Strip любой ведущий префикс «Резюме[.:]» / «Кратко[.:]» / «Сводка[.:]» / «Итог[.:]»
        if (summary) {
          summary = String(summary)
            .replace(/^\s*(резюме|кратко|сводка|итог|итоги|обзор|вывод|выводы)\s*[\.\:\-—–]\s*/i, '')
            .trim();
        }
      }

      if (!section2Text) {
        const section2Prompt = `Напиши 1 параграф «Режим работы и бригада» для отчёта директору. ` +
          `Бригада: ${foremen} мастеров + ${workers} рабочих + ${observers} наблюдающих + ${itr} ИТР. ` +
          `Режим: ${schedule} (${shifts} смен). ` +
          `Особенности: ${ana.special_conditions || 'стандартный режим работы по объекту'}. ` +
          `Стиль — короткий, технический. 3-4 предложения.`;
        const section2Result = await aiProvider.complete({
          system: 'Ты пишешь технические разделы коммерческих отчётов для директора Асгард-Сервис.',
          messages: [{ role: 'user', content: section2Prompt }],
          maxTokens: 400
        });
        section2Text = (section2Result && (section2Result.text || section2Result.content)) || null;
      }
    } catch (e) {
      // AI недоступен — используем fallback.
    }
  }

  if (!summary) {
    summary = `Заказчик запросил ${project?.subject || 'выполнение работ'}, объём ${project?.volume || '—'}. ` +
      `Работа выполняется в режиме ${schedule} бригадой ${crewSize || '—'} чел. в срок ${deadline}. ` +
      `Себестоимость ${_fmtMillions(cost)} без НДС. Рекомендуемая цена для заказчика — ` +
      `${_fmtMillions(priceRecommended)} с НДС (раздельная наценка); по стандартной — ${_fmtMillions(priceStandard)}.`;
  }
  if (!section2Text) {
    section2Text = `Работы ведутся в ${schedule}, состав бригады — ${crewSize || '—'} человек: ${crewComposition}. ` +
      `Срок выполнения на объекте — ${deadline}. Режим работы согласовывается с заказчиком при подписании ППР.`;
  }

  // ─── works_list (состав работ) ───────────────────────────────────────
  let worksList = [];
  if (est.work_scope && Array.isArray(est.work_scope.works)) {
    worksList = est.work_scope.works;
  } else if (Array.isArray(ana.works_list)) {
    worksList = ana.works_list;
  } else if (Array.isArray(calc.works)) {
    worksList = calc.works;
  }
  let worksListTpl = worksList.slice(0, 20).map(w => ({
    title: typeof w === 'string' ? w : String(w.title || w.name || w.text || '')
  })).filter(w => w.title);

  // Опус-фикс 19.06.2026: если состав работ пуст — НЕ ставим заглушку
  // «определяется по ТЗ заказчика» (тавтология). Просим AI извлечь типовой
  // состав из subject (5-7 пунктов). Если AI недоступен — даём цельный fallback.
  if (!worksListTpl.length) {
    try {
      const aiProvider = require('./ai-provider');
      const projectSubj = project?.subject || project?.title || '';
      if (projectSubj && String(projectSubj).length > 10) {
        const r = await aiProvider.complete({
          system: 'Ты технический эксперт по промышленному сервису ООО «Асгард-Сервис». Извлекаешь типовой состав работ для отчёта директору.',
          messages: [{ role: 'user', content:
            `На основе описания проекта ниже сформируй 4-6 пунктов «состав работ» (нумерованный список ШАГОВ выполнения).\n` +
            `Стиль — короткие императивные глаголы, без воды.\n` +
            `НЕ пиши «определяется по ТЗ» — генерируй типовой технологический процесс.\n` +
            `Верни JSON-массив строк: [\"Слив отработанного теплоносителя…\", \"Промывка системы…\", …]\n\n` +
            `Описание проекта:\n${String(projectSubj).slice(0, 1500)}`
          }],
          maxTokens: 600
        });
        const txt = (r && (r.text || r.content)) || '';
        const m = txt.match(/\[[\s\S]*\]/);
        if (m) {
          try {
            const arr = JSON.parse(m[0]);
            if (Array.isArray(arr) && arr.length) {
              worksListTpl = arr.slice(0, 8)
                .map(s => ({ title: String(s).trim() }))
                .filter(w => w.title);
            }
          } catch (_) { /* parse fail — оставим пусто, упадём в fallback ниже */ }
        }
      }
    } catch (_) { /* AI недоступен */ }
  }
  if (!worksListTpl.length) {
    // Цельный fallback (НЕ тавтологичный): типовые шаги промышленного сервиса.
    worksListTpl = [
      { title: 'Подготовка оборудования и площадки (наряд-допуск, безопасность).' },
      { title: 'Выполнение работ по согласованной с заказчиком методике.' },
      { title: 'Контроль качества по объектным журналам и фотофиксация.' },
      { title: 'Сдача работ заказчику с подписанием актов формы КС-2/КС-3.' }
    ];
  }

  // ─── warnings / risks (с дедупликацией) ─────────────────────────────
  // Опус-фикс 19.06.2026: дедуп по hash(title + text). Раньше при передаче
  // analysis.warnings одновременно как 4-й аргумент И в opts.warnings выходил
  // дубль 4+4=8 пунктов («Нет ТЗ. Окно. Цены. ОЗП. Нет ТЗ. Окно. Цены. ОЗП.»).
  let warnings = (estimate?.analysis?.warnings) || ana.warnings || [];
  if (!Array.isArray(warnings)) warnings = [];
  if (optWarnings.length) {
    const extra = optWarnings.map(w => (
      typeof w === 'string' ? { title: 'Внимание', text: w } : w
    ));
    warnings = warnings.concat(extra);
  }
  const _seenW = new Set();
  const warningsTpl = warnings.slice(0, 24).map(w => ({
    title: String((typeof w === 'string' ? 'Внимание' : (w.title || w.kind || 'Внимание'))),
    text: String((typeof w === 'string' ? w : (w.text || w.message || w.detail || '')))
  })).filter(w => {
    if (!w.text) return false;
    // Хэш по нормализованному тексту (lowercase + пробелы свернуты)
    const k = (w.title + '|' + w.text).toLowerCase().replace(/\s+/g, ' ').trim();
    if (_seenW.has(k)) return false;
    _seenW.add(k);
    return true;
  }).slice(0, 12);

  // ─── decisions (с дедупликацией) ────────────────────────────────────
  let decisions = (estimate?.analysis?.recommendations) || ana.recommendations || ana.decisions || [];
  if (!Array.isArray(decisions) || !decisions.length) {
    decisions = [
      'Утвердить схему наценки и итоговую цену для предложения.',
      'Запросить оптовое КП на материалы (теплоноситель, реагент) и утилизацию.',
      'Согласовать с заказчиком: фактический объём, бренд материала, окно остановки линии.',
      'Назначить руководителя работ, проверить наличие оборудования, инициировать ППР.'
    ];
  }
  const _seenD = new Set();
  const decisionsTpl = decisions.slice(0, 24).map(d => ({
    text: typeof d === 'string' ? d : String(d.text || d.title || JSON.stringify(d))
  })).filter(d => {
    if (!d.text) return false;
    const k = d.text.toLowerCase().replace(/\s+/g, ' ').trim();
    if (_seenD.has(k)) return false;
    _seenD.add(k);
    return true;
  }).slice(0, 12);

  // ─── Прочие текстовые поля ──────────────────────────────────────────
  // Опус-фикс 19.06.2026: «—» в полях фактов выглядит некрасиво. Заменяем на «по уточнению»
  // для текстовых полей; для числовых оставляем «—» (или скрываем строку в шаблоне).
  const _dashOr = (v, fallback) => {
    if (v === null || v === undefined || v === '') return fallback;
    const s = String(v).trim();
    if (!s || s === '—' || s === '-' || s.toLowerCase() === 'null') return fallback;
    return s;
  };
  const projectVolumeStr  = _dashOr(project?.volume || est.volume, 'по уточнению заказчика');
  const projectMaterial   = _dashOr(project?.material || est.material, 'по согласованию');
  const paymentTerms      = _dashOr(project?.payment_terms || est.payment_terms, 'Отсрочка по договору; гарантия 12 мес.');
  const contactPerson     = _dashOr(customer && (customer.contact_person || customer.contact), 'не указан');

  // Короткое название проекта (для подзаголовка отчёта). Аналогично смете.
  // Раньше в заголовок шёл сырой work_description на 200+ символов с мусорным префиксом
  // «Письмо содержит закупку/запрос…» от AI-парсера письма.
  const _stripJunkPrefix = (s) => {
    if (!s) return s;
    let v = String(s).trim();
    // Рекурсивно срезаем мусорные префиксы пока они есть.
    // Покрытие: «Письмо содержит запрос на выполнению гидромеханической очистки…» → «гидромеханической очистки…»
    const re = /^(письмо\s+(содержит|с|про|об|о|по|от|включает)|содержит\s+(запрос|закупку|кп|тз)?|переслан(а|о|ы)?\s+(клиентский\s+)?(запрос|письмо|тз|кп|заявк[ауи]|документы)?(\s+с\s+тз)?|пересланны[йе]\s+(запрос|письмо|тз|документы)|fwd|fw|re|форвард|запрос(\s+на|\s+по)?|закупк[ауи](\s*\/\s*\w+)?(\s+на|\s+по)?|кп(\s+от|\s+на|\s+по)?|коммерческое\s+предложение(\s+на|\s+по)?|заявк[ауи](\s+на|\s+по)?|приглашени[ея](\s+на|\s+к)?|тз(\s+на|\s+по)?|заказчик\s+(прислал|просит|интересует|запрашивает|обратился)|выполнени[еюя]|проведени[еюя]|выполнить|провести|оценк[ауи]|по\s+выполнению|по\s+оценке|по\s+проведению|на\s+выполнение|на\s+проведение)\s*[:,—\-/]?\s*/i;
    let safety = 5;
    while (safety-- > 0 && re.test(v)) {
      const before = v;
      v = v.replace(re, '').trim();
      if (v === before) break;
    }
    // Капитализируем первую букву (если было обрезание).
    if (v && v[0] === v[0].toLowerCase() && v[0] !== v[0].toUpperCase()) {
      v = v[0].toUpperCase() + v.slice(1);
    }
    return v;
  };
  const _shortenTitle = (s) => {
    if (!s) return null;
    let str = _stripJunkPrefix(String(s).trim().replace(/\s+/g, ' '));
    if (!str) return null;
    if (str.length <= 120) return str;
    const m = str.match(/^[^.!?\n]{20,120}[.!?]/);
    if (m) return m[0].replace(/[.!?]$/, '');
    const sep = str.slice(0, 120).search(/[,;:—–]\s/);
    if (sep > 30) return str.slice(0, sep);
    return str.slice(0, 100).replace(/\s+\S*$/, '') + '…';
  };
  const projectTitleShort = _shortenTitle(project?.title_short)
    || _shortenTitle(project?.title)
    || _shortenTitle(est.title)
    || _shortenTitle(project?.subject)
    || 'технико-экономическая оценка работ';

  // economy_comment: вместо «×2.2 ко всей себестоимости» — реальный комментарий
  // с разделением материалов/работ И с пояснением если цены сошлись.
  const matSharePct = cost > 0 ? Math.round(materials / cost * 100) : 0;
  const economyComment = ana.economy_comment || (
    pricesEqual
      ? `Стандартная (×${markup.toFixed(1).replace('.', ',')}) и раздельная цена сошлись — материалов в себестоимости ${matSharePct}% (мало, наценка особо не влияет). ` +
        `Детальный расчёт и сценарии цены — в приложении (Excel).`
      : `Стандартная наценка ×${markup.toFixed(1).replace('.', ',')} применяется ко всей себестоимости — ${_fmtMillions(priceStandard)}. ` +
        `Раздельная (материал ×${matMarkup.toFixed(2).replace('.', ',')}, работы ×${markup.toFixed(1).replace('.', ',')}) — ${_fmtMillions(priceRecommended)}, экономия для заказчика ${_fmtMillions(priceStandard - priceRecommended)}. ` +
        `Доля материалов в себестоимости — ${matSharePct}%. Детальный расчёт и сценарии — в приложении (Excel).`
  );

  // markup_label для шаблона. Был хардкод «×2.2» — теперь динамически.
  const markupLabel = `×${markup.toFixed(1).replace('.', ',')}`;

  // ВАЖНО: AI-summary иногда содержит фразу «×2.2», унаследованную от исходной
  // сметы. Если markup изменился (через direct-edit), заменяем «×2.2» в summary
  // на актуальный label, чтобы не было противоречия.
  if (summary && /×\s*2[.,]2/.test(summary) && Math.abs(markup - 2.2) > 0.01) {
    summary = summary.replace(/×\s*2[.,]2/g, markupLabel);
  }
  if (section2Text && /×\s*2[.,]2/.test(section2Text) && Math.abs(markup - 2.2) > 0.01) {
    section2Text = section2Text.replace(/×\s*2[.,]2/g, markupLabel);
  }

  const data = {
    // Шапка
    customer_name: _dashOr(customer?.name, 'заказчик'),
    customer_address: _dashOr(customer?.address, ''),
    project_object: _dashOr(project?.object, 'по уточнению'),
    markup_label: markupLabel,
    // ВАЖНО: project_title_short — короткое, для подзаголовка.
    // project_subject_full — полное описание (для информативных полей).
    project_title_short: projectTitleShort,
    project_subject_full: projectTitleShort, // backward-compat: шаблон ссылается на _full
    project_volume: projectVolumeStr,
    project_material: projectMaterial,
    project_schedule_short: scheduleShort,
    payment_terms: paymentTerms,
    contact_person: contactPerson,
    report_number: ana.report_number || `ПО-${new Date().getFullYear()}/${String(Date.now()).slice(-4)}`,
    report_date: _fmtRuDate(new Date()),

    // Метаданные отчёта (новые поля). Шаблон должен ссылаться на {meta_*}.
    meta_to:        'руководству ООО «Асгард-Сервис»',
    meta_from:      'проектный отдел',
    meta_basis:     ana.report_basis || `запрос ${customer?.name || 'заказчика'}; расчёт по внутренним нормативам Асгарда`,

    // Резюме (AI)
    summary_paragraph: summary,
    section_2_text: section2Text,

    // Финансы — раздельные поля «X,XX млн ₽»
    cost_no_vat_mln: _fmtMillions(cost),
    price_standard_mln: _fmtMillions(priceStandard),
    price_recommended_mln: _fmtMillions(priceRecommended),
    profit_standard_mln: _fmtMillions(profitStandard),
    profit_recommended_mln: _fmtMillions(profitRecommended),
    economy_comment: economyComment,

    // Бригада / срок
    crew_size: crewSize || '—',
    crew_composition: crewComposition,
    deadline_str: deadline,

    // Loops
    works_list: worksListTpl,
    warnings: warningsTpl,
    decisions: decisionsTpl,

    // Подпись (реальный РП/автор, не хардкод).
    // optAuthor приходит из mimir-tkp-quick._loadPmUser → users.name по pt.assigned_to/created_by.
    // Хардкод «Путков Д.В.» убран 19.06.2026 — провоцировал отправку отчёта чужой подписью.
    author_name: (optAuthor && optAuthor.name) || ana.author_name || '(подпись РП)',
    author_position: (optAuthor && optAuthor.position) || ana.author_position || 'Руководитель проектного отдела',
    author_phone: (optAuthor && optAuthor.phone) || '',
    author_email: (optAuthor && optAuthor.email) || '',

    // Backward-compat (старые шаблоны / тесты могут ещё их ждать)
    project_subject: project?.subject || project?.title || '—',
    cost_no_vat: _fmtMillions(cost),
    price_standard_vat: _fmtMillions(priceStandard),
    price_separate_vat: _fmtMillions(priceRecommended),
    assumptions: optAssumptions.slice(0, 12).map(a => ({
      text: typeof a === 'string' ? a : String(a.text || a)
    }))
  };

  return _renderDocxTemplate(TPL_DIRECTOR, data);
}

// ═════════════════════════════════════════════════════════════════════════
// 3. ПИСЬМО КЛИЕНТУ — docxtemplater
// ═════════════════════════════════════════════════════════════════════════

/**
 * Сгенерировать письмо клиенту.docx по структуре ГНШ-шаблона.
 *
 * @param {object} opts
 *   .customer    — { name, full_name, address, inn, recipient_name_short, recipient_note }
 *   .project     — { subject, object, procurement_intro?, procurement_lot? }
 *   .questions   — [{ question_topic, question_text, why_we_ask?, default_assumption?, blocking? }]
 *   .gendir      — { name, position, org }  гендир Асгарда (Кудряшов О.С., Генеральный директор)
 *   .executor    — { name, phone, email }   исп. (PM, который вёл просчёт)
 *   .projectIntro / .projectOutro — string (опц., AI-генерация)
 *   .letterNumber, .letterDate                — из correspondence.allocateOutgoingNumber
 *   .deadlineDate                              — опц., по умолчанию +5 дней
 * @returns {Promise<Buffer>}
 */
async function generateCustomerLetterDocx(opts) {
  const customer = opts.customer || {};
  const project = opts.project || {};
  const gendir = opts.gendir || {};
  const executor = opts.executor || {};
  const rawQuestions = Array.isArray(opts.questions) ? opts.questions : [];

  // Blocking — наверх.
  const sorted = rawQuestions.slice().sort((a, b) => (b.blocking ? 1 : 0) - (a.blocking ? 1 : 0));

  const questions = sorted.map((q, i) => ({
    n: i + 1,
    question_topic: String(q.question_topic || q.topic || 'Уточнение'),
    question_text: String(q.question_text || q.text || q.question || '')
  }));

  const docsCount = _num(opts.documentsCount, 0);
  const projectIntro = String(opts.projectIntro
    || `В рамках подготовки коммерческого предложения по работам «${project.subject || project.title || '—'}» ` +
       `мы провели первичный анализ исходных данных${docsCount > 0 ? ` и ${docsCount} прикреплённых документов` : ''}. ` +
       'Для подготовки точного и корректного расчёта стоимости нам необходимо уточнить следующие вопросы:');

  const projectOutro = opts.projectOutro || '';

  const now = new Date();
  const lettersDate = opts.letterDate || _fmtRuDate(now);
  const lettersDateShort = opts.letterDateShort || _fmtRuDateShort(now);

  const phoneEmailParts = [];
  if (executor.phone) phoneEmailParts.push(`Тел.: ${executor.phone}`);
  if (executor.email) phoneEmailParts.push(`E-mail: ${executor.email}`);
  const executorPhoneEmail = phoneEmailParts.join('   ');

  const data = {
    // Адресат
    customer_full_name: customer.full_name || customer.name || '—',
    recipient_name_short: customer.recipient_name_short || '',
    recipient_note: customer.recipient_note || '',

    // Шапка
    letter_number: opts.letterNumber || `АС-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(Date.now()).slice(-3)}`,
    letter_date: lettersDate,
    letter_date_short: lettersDateShort,
    procurement_intro: project.procurement_intro || '',
    procurement_lot: project.procurement_lot || '',

    // Тело
    project_intro: projectIntro,
    project_outro: projectOutro,
    questions,

    // Подпись
    company_org_short: gendir.org || 'ООО «Асгард-Сервис»',
    gendir_position: gendir.position || 'Генеральный директор',
    gendir_name: gendir.name || 'Кудряшов О.С.',
    executor_name: executor.name || '—',
    executor_phone_email: executorPhoneEmail
  };

  return _renderDocxTemplate(TPL_CUSTOMER, data);
}

// ═════════════════════════════════════════════════════════════════════════
// 4. saveDocumentsForEntity — кладёт файлы на диск и регистрирует в БД.
// ═════════════════════════════════════════════════════════════════════════

const ENTITY_CONFIG = {
  pre_tender: {
    dir: 'pre_tender_docs',
    table: 'pre_tender_requests',
    jsonbField: 'manual_documents',
    extra: ', has_documents=true'
  },
  work: {
    dir: 'work_docs',
    table: 'works',
    jsonbField: 'manual_documents',
    extra: ', has_documents=true'
  },
  tender: {
    dir: 'tender_docs',
    table: 'tenders',
    jsonbField: 'manual_documents',
    extra: ', has_documents=true'
  }
};

/**
 * Сохранить набор сгенерированных документов для сущности.
 *
 * @param {string} entityKind — 'pre_tender' | 'tender' | 'work'.
 * @param {number} entityId
 * @param {Array<{filename:string, buffer:Buffer, mime:string, kind:string}>} docs
 * @param {object} [dbi] — pg connection (для тестов). По умолчанию require('./db').
 * @returns {Promise<{saved:Array, dir:string}>}
 */
async function saveDocumentsForEntity(entityKind, entityId, docs, dbi) {
  const cfg = ENTITY_CONFIG[entityKind];
  if (!cfg) throw new Error(`saveDocumentsForEntity: неизвестный entityKind=${entityKind}`);
  const id = Number(entityId);
  if (!Number.isFinite(id) || id <= 0) throw new Error(`saveDocumentsForEntity: некорректный entityId=${entityId}`);

  const db = dbi || require('./db');

  const entityDir = path.join(UPLOADS_DIR, cfg.dir, String(id));
  fs.mkdirSync(entityDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const saved = [];
  for (const doc of docs || []) {
    const filename = String(doc.filename || `doc_${Date.now()}.bin`).replace(/[^\w.\-а-яА-ЯёЁ ]/gi, '_').slice(0, 220);
    const absPath = path.join(entityDir, filename);
    fs.writeFileSync(absPath, doc.buffer);
    const relPath = `uploads/${cfg.dir}/${id}/${filename}`;
    const entry = {
      filename,
      original_name: doc.filename || filename,
      mime_type: doc.mime || 'application/octet-stream',
      size: doc.buffer.length,
      path: relPath,
      file_path: relPath,
      kind: doc.kind || 'mimir_generated',
      generated_at: generatedAt,
      generated_by: 'mimir'
    };
    saved.push(entry);

    // PDF-конвертация DOCX/XLSX через libreoffice (если установлен).
    // Для XLSX-смет PDF-сиблинг нужен для предпросмотра в браузере и отправки
    // клиенту — живой Excel остаётся как parent, PDF добавляется рядом.
    if (/\.(docx|xlsx)$/i.test(filename)) {
      try {
        const { spawnSync } = require('child_process');
        const r = spawnSync('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', entityDir, absPath], {
          timeout: 60000,
          windowsHide: true
        });
        if (r.status === 0) {
          const pdfFilename = filename.replace(/\.(docx|xlsx)$/i, '.pdf');
          const pdfAbs = path.join(entityDir, pdfFilename);
          if (fs.existsSync(pdfAbs)) {
            const pdfRel = `uploads/${cfg.dir}/${id}/${pdfFilename}`;
            saved.push({
              filename: pdfFilename,
              original_name: pdfFilename,
              mime_type: 'application/pdf',
              size: fs.statSync(pdfAbs).size,
              path: pdfRel,
              file_path: pdfRel,
              kind: (doc.kind || 'mimir_generated') + '_pdf',
              parent_kind: doc.kind || null,
              generated_at: generatedAt,
              generated_by: 'mimir'
            });
          }
        } else if (r.error) {
          console.warn('[document-generator] libreoffice convert failed:', r.error.message);
        }
      } catch (e) {
        console.warn('[document-generator] libreoffice convert failed:', e.message);
      }
    }
  }

  if (saved.length === 0) return { saved: [], dir: entityDir };

  // Грузим существующий JSONB и мержим.
  let existing = [];
  try {
    const cur = await db.query(`SELECT ${cfg.jsonbField} AS docs FROM ${cfg.table} WHERE id = $1`, [id]);
    if (!cur.rows.length) throw new Error(`saveDocumentsForEntity: ${entityKind}#${id} не найден`);
    if (Array.isArray(cur.rows[0].docs)) existing = cur.rows[0].docs;
    else if (cur.rows[0].docs && typeof cur.rows[0].docs === 'object') existing = [cur.rows[0].docs];
  } catch (e) {
    // Не критично — пишем только новые.
    console.warn(`[document-generator] не удалось прочитать ${cfg.table}.${cfg.jsonbField} для #${id}:`, e.message);
  }

  // 22.06.2026: автоудаление старых версий mimir-генерируемых документов.
  // Каждый прогон Quick раньше ДОПИСЫВАЛ smeta_*.xlsx + director_report_*.docx
  // в manual_documents без чистки → накапливалось 50+ файлов в одной карте.
  // Теперь: для каждого затронутого mimir-kind оставляем последние KEEP_VERSIONS-1
  // (последние = по generated_at), плюс свежие из `saved`. Итого KEEP_VERSIONS версий.
  // Пользовательские uploads (kind не из MIMIR_KINDS) — НЕ трогаем.
  const MIMIR_KINDS = new Set(['mimir_smeta', 'mimir_director_report']);
  const KEEP_VERSIONS = 3;
  const isMimirKind = (k) => {
    if (!k) return false;
    const base = String(k).replace(/_pdf$/, '');
    return MIMIR_KINDS.has(base);
  };

  const newMimirKindsTouched = new Set(
    saved.map(d => String(d.kind || '').replace(/_pdf$/, '')).filter(k => MIMIR_KINDS.has(k))
  );

  const purged = [];
  let keptExisting;
  if (newMimirKindsTouched.size === 0) {
    keptExisting = existing;
  } else {
    const byKind = new Map();
    for (const d of existing) {
      const k = String(d.kind || '');
      if (!byKind.has(k)) byKind.set(k, []);
      byKind.get(k).push(d);
    }
    keptExisting = [];
    for (const [k, arr] of byKind.entries()) {
      const baseKind = k.replace(/_pdf$/, '');
      if (isMimirKind(k) && newMimirKindsTouched.has(baseKind)) {
        arr.sort((a, b) => String(a.generated_at || '').localeCompare(String(b.generated_at || '')));
        const keepCount = Math.max(0, KEEP_VERSIONS - 1);
        const keep = arr.slice(-keepCount);
        const drop = arr.slice(0, arr.length - keep.length);
        keptExisting.push(...keep);
        purged.push(...drop);
      } else {
        keptExisting.push(...arr);
      }
    }
  }

  // Best-effort физическое удаление файлов purged-записей с диска.
  for (const p of purged) {
    try {
      const rel = p.file_path || p.path;
      if (!rel) continue;
      const abs = path.isAbsolute(rel) ? rel : path.join(__dirname, '..', '..', rel);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (_) { /* не критично */ }
  }
  if (purged.length) {
    console.log(`[document-generator] saveDocumentsForEntity(${entityKind}#${id}): pruned ${purged.length} старых mimir-версий, оставлено ${keptExisting.length} + ${saved.length} новых`);
  }

  const merged = keptExisting.concat(saved);
  try {
    await db.query(
      `UPDATE ${cfg.table} SET ${cfg.jsonbField} = $1${cfg.extra}, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(merged), id]
    );
  } catch (e) {
    // Некоторые таблицы могут не иметь updated_at — fallback без него.
    try {
      await db.query(
        `UPDATE ${cfg.table} SET ${cfg.jsonbField} = $1${cfg.extra} WHERE id = $2`,
        [JSON.stringify(merged), id]
      );
    } catch (e2) {
      console.error(`[document-generator] UPDATE ${cfg.table}#${id} failed:`, e2.message);
      throw e2;
    }
  }

  return { saved, dir: entityDir };
}

module.exports = {
  generateSmetaXlsx,
  generateDirectorReportDocx,
  generateCustomerLetterDocx,
  saveDocumentsForEntity,
  // exposed для тестов
  _extractInputs,
  _fmtMillions,
  _fmtRuDate,
  TPL_DIRECTOR,
  TPL_CUSTOMER
};
