'use strict';

/**
 * src/services/vacation-docx.js
 *
 * Генерация кадровых документов по отпускам:
 *   • generateVacationApplication(data)  — заявление сотрудника (DOCX)
 *   • generateOrderT6(data)              — приказ о предоставлении отпуска, форма Т-6
 *                                           (код по ОКУД 0301005) (DOCX)
 *   • generateScheduleT7(data)           — график отпусков, форма Т-7
 *                                           (код по ОКУД 0301020, 10 граф) (DOCX)
 *   • generateScheduleT7Xlsx(data)       — тот же график в XLSX (exceljs)
 *
 * Шаблоны (templates/):
 *   vacation-application-tpl.docx   — заявление, плейсхолдеры как в образце заказчика;
 *   vacation-order-t6-tpl.docx      — бланк Т-6 с тегами в ячейках;
 *   vacation-schedule-t7-tpl.docx   — бланк Т-7; тело графика — строка-цикл
 *                                     {#employees}…{/employees}.
 *
 * Почему шаблоны, а не сборка с нуля:
 *   Формы унифицированные (Госкомстат № 1 от 05.01.2004), их вёрстку — рамки,
 *   объединения ячеек шапки, шрифты — надо сохранить 1:1. В docxtemplater
 *   размножение строк таблицы работает, когда теги цикла стоят в одной <w:tr>
 *   (проверено: 13 → N строк, шапка не рушится). Обратная сборка DOCX «вручную»
 *   без библиотеки `docx` (её в зависимостях нет) дала бы xml-конструктор
 *   на сотни строк и риск разъехавшейся формы.
 *
 * Контракт data (все поля необязательны, приводятся к безопасному виду):
 *
 *   organization   string | { name }        — наименование организации
 *   employee       {
 *                    full_name, position, department, personnel_number, short_name
 *                  }
 *   period         { date_from, date_to, days }      — период отпуска заявления
 *   work_period    { date_from, date_to }            — «за период работы с … по …»
 *   main           { days, date_from, date_to }      — Т-6 п. А (основной отпуск)
 *   additional     { days, date_from, date_to }      — Т-6 п. Б (дополнительный)
 *   total          { days, date_from, date_to }      — Т-6 п. В (всего)
 *   order          { number, date }                  — реквизиты приказа
 *   manager        { position, full_name }           — руководитель
 *   hr             { position, full_name }           — кадровик
 *   acknowledged   { date }                          — дата ознакомления
 *   year           number                            — год графика (Т-7)
 *   schedule       { number, date, approve_date }    — реквизиты графика (Т-7)
 *   employees      Array<{
 *                    department, position, full_name, personnel_number,
 *                    days, planned_date, actual_date, transfer_basis,
 *                    presumed_date, note
 *                  }>                                 — строки Т-7
 *
 * Даты принимаются строками 'YYYY-MM-DD' (формат DATE из PostgreSQL), объектом
 * Date либо уже готовой строкой — нормализуются в 'дд.мм.гггг'.
 */

const fs = require('fs');
const path = require('path');

// ─── Lazy require docxtemplater / pizzip / exceljs ────────────────────────
// Как в src/services/letter/docx-letter.js: ошибка отсутствующего модуля
// возникает на первом вызове генератора, а не при require роутов.
let _Docxtemplater = null;
let _PizZip = null;
let _ExcelJS = null;

function _loadDocxLibs() {
  if (_Docxtemplater && _PizZip) return { Docxtemplater: _Docxtemplater, PizZip: _PizZip };
  try {
    _Docxtemplater = require('docxtemplater');
    _PizZip = require('pizzip');
  } catch (e) {
    const missing = e.message && e.message.match(/'([^']+)'/);
    throw new Error(
      '[vacation-docx] Не установлены docxtemplater/pizzip' +
      (missing ? ` (отсутствует: ${missing[1]})` : '') +
      '. Выполните: npm install docxtemplater pizzip'
    );
  }
  return { Docxtemplater: _Docxtemplater, PizZip: _PizZip };
}

function _loadExcelLibs() {
  if (_ExcelJS) return { ExcelJS: _ExcelJS };
  try {
    _ExcelJS = require('exceljs');
  } catch (e) {
    throw new Error('[vacation-docx] Не установлен exceljs. Выполните: npm install exceljs');
  }
  return { ExcelJS: _ExcelJS };
}

// ─── Resolve templates ────────────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..', '..');
const TPL = {
  application: path.join(ROOT, 'templates', 'vacation-application-tpl.docx'),
  orderT6: path.join(ROOT, 'templates', 'vacation-order-t6-tpl.docx'),
  scheduleT7: path.join(ROOT, 'templates', 'vacation-schedule-t7-tpl.docx')
};

// ─── Хелперы нормализации ─────────────────────────────────────────────────
function _s(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

/** Организация: строка или { name }. */
function _orgName(organization) {
  if (!organization) return '';
  if (typeof organization === 'string') return organization;
  return _s(organization.name || organization.name_full || organization.name_short);
}

/** Привести дату к { d, m, y } (двузначный день, месяц, 4-значный год). */
function _parts(value) {
  if (!value) return { d: '', m: '', y: '' };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { d: '', m: '', y: '' };
    return {
      d: String(value.getDate()).padStart(2, '0'),
      m: String(value.getMonth() + 1).padStart(2, '0'),
      y: String(value.getFullYear())
    };
  }
  const s = _s(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);       // YYYY-MM-DD
  if (m) return { d: m[3], m: m[2], y: m[1] };
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);          // DD.MM.YYYY
  if (m) return { d: m[1], m: m[2], y: m[3] };
  return { d: '', m: '', y: '' };
}

/** Дата строкой 'дд.мм.гггг'. */
function _dot(value) {
  const p = _parts(value);
  return p.d ? `${p.d}.${p.m}.${p.y}` : '';
}

/** Год двумя цифрами: '2026' → '26'. Бланки Т-6/Т-7 печатают «20__ г.». */
function _yy(y) {
  const s = _s(y);
  return s.length === 4 && /^\d{4}$/.test(s) ? s.slice(2) : s;
}

/** «Иванов Иван Иванович» → «Иванов И. И.». */
function _shortName(fio) {
  const s = _s(fio).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  const parts = s.split(' ');
  if (parts.length === 1) return parts[0];
  const initials = parts.slice(1)
    .map((w) => (w ? w[0].toUpperCase() + '.' : ''))
    .filter(Boolean)
    .join(' ');
  return `${parts[0]} ${initials}`;
}

/** Число дней: number | строка; '' для пустого. */
function _days(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : _s(v);
}

function _pick(obj, key, fallback) {
  if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  return fallback;
}

/**
 * Развернуть плоскую пару date_from/date_to в шесть тегов.
 * Год — ДВУМЯ цифрами: в бланках Т-6/Т-7 литерал «20» стоит отдельной ячейкой
 * («с “01” 06 20 26 г.»), поэтому 4-значный год дал бы «202026».
 * @returns {{[key:string]:string}}
 */
function _dateFields(prefix, range) {
  const from = _parts(range && range.date_from);
  const to = _parts(range && range.date_to);
  const out = {};
  out[prefix + 'СД'] = from.d;
  out[prefix + 'СМ'] = from.m;
  out[prefix + 'СГ'] = _yy(from.y);
  out[prefix + 'ПоД'] = to.d;
  out[prefix + 'ПоМ'] = to.m;
  out[prefix + 'ПоГ'] = _yy(to.y);
  return out;
}

/** Реквизиты организации + год/номер для шапок. */
function _common(data) {
  const org = _orgName(_pick(data, 'organization', ''));
  const emp = _pick(data, 'employee', {}) || {};
  return {
    ОрганизацияНазвание: org,
    СотрудникФИО: _s(_pick(emp, 'full_name', _pick(data, 'employee_full_name', ''))),
    Должность: _s(_pick(emp, 'position', '')),
    Подразделение: _s(_pick(emp, 'department', _pick(emp, 'subdivision', ''))),
    // алиасы под имена тегов образца заявления заказчика
    СотрудникДолжность: _s(_pick(emp, 'position', '')),
    СотрудникПодразделение: _s(_pick(emp, 'department', _pick(emp, 'subdivision', ''))),
    ТабельныйНомер: _s(_pick(emp, 'personnel_number', _pick(emp, 'tab_number', ''))),
    СотрудникФамилияИнициалы: _s(_pick(emp, 'short_name', _shortName(_pick(emp, 'full_name', ''))))
  };
}

// ─── Рендер DOCX из шаблона ───────────────────────────────────────────────
function _render(templatePath, data) {
  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `[vacation-docx] Шаблон не найден: ${templatePath}. ` +
      'Положите .docx в templates/ (см. tools/_build_vacation_templates.py).'
    );
  }
  const { Docxtemplater, PizZip } = _loadDocxLibs();
  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => ''
  });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function _maybeSave(buf, options) {
  if (options && options.save_to) {
    fs.writeFileSync(options.save_to, buf);
    return options.save_to;
  }
  return buf;
}

// ─── 1. Заявление ─────────────────────────────────────────────────────────
/**
 * Заявление сотрудника на ежегодный оплачиваемый отпуск.
 * @param {object} data — см. контракт в шапке файла.
 * @param {object} [options] — { save_to }
 * @returns {Buffer|string}
 */
function generateVacationApplication(data, options) {
  const d = data || {};
  const period = _pick(d, 'period', {}) || {};
  const manager = _pick(d, 'manager', _pick(d, 'director', {})) || {};
  const emp = _pick(d, 'employee', {}) || {};

  const ctx = Object.assign({}, _common(d), {
    // Адресат
    РуководительФИО: _s(_pick(manager, 'full_name', _pick(d, 'director_name', ''))),
    РуководительДолжность: _s(_pick(manager, 'position', '')),
    // Тело
    ДатаНачала: _dot(period.date_from),
    ДатаОкончания: _dot(period.date_to),
    КоличествоДнейОтпуска: _days(_pick(period, 'days', _pick(d, 'days', ''))),
    // Подпись
    СотрудникФамилияИнициалы: _s(_pick(emp, 'short_name', _shortName(_pick(emp, 'full_name', '')))),
    Дата: _dot(_pick(d, 'application_date', _pick(d, 'date', new Date())))
  });

  return _maybeSave(_render(TPL.application, ctx), options);
}

// ─── 2. Приказ Т-6 ────────────────────────────────────────────────────────
/**
 * Приказ (распоряжение) о предоставлении отпуска работнику, форма Т-6 (0301005).
 * @param {object} data
 * @param {object} [options] — { save_to }
 * @returns {Buffer|string}
 */
function generateOrderT6(data, options) {
  const d = data || {};
  const order = _pick(d, 'order', {}) || {};
  const manager = _pick(d, 'manager', _pick(d, 'director', {})) || {};
  const ack = _pick(d, 'acknowledged', {}) || {};

  // Пункты А/Б/В: если явных main/total нет — берём period как основной и «всего».
  const period = _pick(d, 'period', {}) || {};
  const main = _pick(d, 'main', {}) || {};
  const additional = _pick(d, 'additional', {}) || {};
  const total = _pick(d, 'total', {}) || {};

  const mainDays = _pick(main, 'days', _pick(period, 'days', ''));
  const mainFrom = _pick(main, 'date_from', period.date_from);
  const mainTo = _pick(main, 'date_to', period.date_to);

  const hasAdditional = !!(additional.date_from || additional.date_to || _days(additional.days));

  const totalDays = _pick(total, 'days', hasAdditional ? (Number(_days(mainDays) || 0) + Number(_days(_pick(additional, 'days', 0)) || 0)) : mainDays);
  const totalFrom = _pick(total, 'date_from', mainFrom);
  const totalTo = _pick(total, 'date_to', hasAdditional ? _pick(additional, 'date_to', mainTo) : mainTo);

  const ctx = Object.assign({}, _common(d),
    // Реквизиты приказа
    {
      НомерДокумента: _s(_pick(order, 'number', _pick(d, 'order_number', ''))),
      ДатаСоставления: _dot(_pick(order, 'date', _pick(d, 'order_date', new Date())))
    },
    // «за период работы с … по …»
    _dateFields('Работа', _pick(d, 'work_period', {})),
    // Пункт А — основной отпуск
    { ОсновнойДней: _days(mainDays) },
    _dateFields('Основной', { date_from: mainFrom, date_to: mainTo }),
    // Пункт Б — дополнительный отпуск
    { ДопДней: hasAdditional ? _days(_pick(additional, 'days', '')) : '' },
    _dateFields('Доп', { date_from: _pick(additional, 'date_from', ''), date_to: _pick(additional, 'date_to', '') }),
    // Пункт В — всего
    { ВсегоДней: _days(totalDays) },
    _dateFields('Всего', { date_from: totalFrom, date_to: totalTo }),
    // Подпись руководителя
    {
      РуководительДолжность: _s(_pick(manager, 'position', '')),
      РуководительФИО: _s(_pick(manager, 'full_name', _pick(manager, 'short_name', '')))
    },
    // Ознакомление работника — ОДНА дата «“d” m 20 y г.» (не диапазон)
    _singleDateFields('Ознакомлен', _pick(ack, 'date', _pick(d, 'acknowledged_date', '')))
  );

  // Если дополнительного отпуска нет — «Б.» остаётся пустым (шаблон так и задуман).
  if (!hasAdditional) {
    ctx.ДопСД = ''; ctx.ДопСМ = ''; ctx.ДопСГ = '';
    ctx.ДопПоД = ''; ctx.ДопПоМ = ''; ctx.ДопПоГ = '';
  }

  return _maybeSave(_render(TPL.orderT6, ctx), options);
}

// ─── 3. График Т-7 ────────────────────────────────────────────────────────
/** Строки Т-7 → массив для цикла {#employees}…{/employees}. */
function _employeeRows(data) {
  const d = data || {};
  const list = Array.isArray(d.employees) ? d.employees : [];
  return list.map((e) => {
    const emp = e || {};
    const person = _pick(emp, 'employee', {}) || emp;
    // Роут передаёт periods:[{date_from,date_to,days,status}] — берём основной период
    // (14-дневный, иначе первый неотклонённый). Без этого графы 5–9 были пустыми.
    const periods = Array.isArray(emp.periods) ? emp.periods.filter((p) => p && p.status !== 'rejected' && p.status !== 'cancelled') : [];
    const main = periods.filter((p) => Number(p.cal_days || 0) >= 14)[0] || periods[0] || null;
    const rest = periods.filter((p) => p !== main);

    // Срок отпуска: период → explicit days → по датам.
    let days = _pick(emp, 'days', '');
    const from = _pick(emp, 'date_from', main ? (main.date_from || main.from || '') : '');
    const to = _pick(emp, 'date_to', main ? (main.date_to || main.to || '') : '');
    if ((days === '' || days === null || days === undefined) && main) {
      days = _pick(main, 'days', _pick(main, 'cal_days', ''));
    }
    if ((days === '' || days === null || days === undefined) && from && to) {
      const a = _parts(from), b = _parts(to);
      if (a.y && b.y) {
        const t1 = Date.UTC(Number(a.y), Number(a.m) - 1, Number(a.d));
        const t2 = Date.UTC(Number(b.y), Number(b.m) - 1, Number(b.d));
        days = String(Math.round((t2 - t1) / 86400000) + 1);
      }
    }
    const shortName = _s(_pick(person, 'short_name', _shortName(_pick(person, 'full_name', ''))));
    const pend = periods.some((p) => p.status === 'pending');
    return {
      Подразделение: _s(_pick(person, 'department', _pick(emp, 'department', _pick(person, 'subdivision', '')))),
      Должность: _s(_pick(person, 'position', _pick(emp, 'position', ''))),
      ФИО: _s(_pick(person, 'full_name', _pick(emp, 'full_name', shortName))),
      ТабельныйНомер: _s(_pick(person, 'personnel_number', _pick(emp, 'personnel_number', ''))),
      Дней: _days(days),
      ДатаЗапланированная: _dot(_pick(emp, 'planned_date', from)),
      ДатаФактическая: _dot(_pick(emp, 'actual_date', '')),
      ОснованиеПереноса: _s(_pick(emp, 'transfer_basis',
        rest.length ? rest.map((p) => `${_pick(p, 'days', '')} дн. с ${_dot(p.date_from || '')}`).join('; ') : '')),
      ДатаПредполагаемая: _dot(_pick(emp, 'presumed_date', rest[0] ? (rest[0].date_from || '') : '')),
      Примечание: _s(_pick(emp, 'note', pend ? 'на согласовании' : (periods.length ? '' : 'нет отпуска')))
    };
  });
}

/**
 * График отпусков, форма Т-7 (0301020), 10 граф.
 * @param {object} data
 * @param {object} [options] — { save_to }
 * @returns {Buffer|string}
 */
function generateScheduleT7(data, options) {
  const d = data || {};
  const schedule = _pick(d, 'schedule', {}) || {};
  const manager = _pick(d, 'manager', _pick(d, 'director', {})) || {};
  const hr = _pick(d, 'hr', _pick(d, 'hr_manager', {})) || {};

  const year = _pick(d, 'year', new Date().getFullYear());
  const scheduleDate = _pick(schedule, 'date', _pick(d, 'schedule_date', ''));
  const approveDate = _pick(schedule, 'approve_date', scheduleDate);

  const ctx = Object.assign({}, _common(d),
    {
      Год: _s(year),
      НомерДокумента: _s(_pick(schedule, 'number', _pick(d, 'schedule_number', ''))),
      // Верхний блок «УТВЕРЖДАЮ от “d” m 20y г. № n от …»
      УтвержденНомер: _s(_pick(schedule, 'approve_number', _pick(schedule, 'number', ''))),
      РуководительДолжность: _s(_pick(manager, 'position', '')),
      РуководительФИО: _s(_pick(manager, 'full_name', _pick(manager, 'short_name', ''))),
      // Шапка «Дата составления»
      ДатаСоставления: _dot(scheduleDate),
      // Подпись кадровой службы
      КадровикДолжность: _s(_pick(hr, 'position', '')),
      КадровикФИО: _s(_pick(hr, 'full_name', _pick(hr, 'short_name', ''))),
      employees: _employeeRows(d)
    },
    // Одиночная дата «от “d” m 20y г.» — верхний блок УТВЕРЖДАЮ
    _singleDateFields('Утвержден', approveDate),
    // «дата составления» в таблице под ГРАФИК ОТПУСКОВ
    _singleDateFields('Дата', scheduleDate)
  );

  return _maybeSave(_render(TPL.scheduleT7, ctx), options);
}

/** Одиночная дата → {prefix+Д, +М, +Г}. Год — двумя цифрами (см. _dateFields). */
function _singleDateFields(prefix, value) {
  const p = _parts(value);
  return {
    [prefix + 'Д']: p.d,
    [prefix + 'М']: p.m,
    [prefix + 'Г']: _yy(p.y)
  };
}

// ─── 4. XLSX-выгрузка Т-7 ─────────────────────────────────────────────────
const T7_HEADER = [
  'Структурное подразделение',
  'Должность (специальность, профессия) по штатному расписанию',
  'Фамилия, имя, отчество',
  'Табельный номер',
  'Количество календарных дней',
  'Дата запланированная',
  'Дата фактическая',
  'Основание (документ)',
  'Дата предполагаемого отпуска',
  'Примечание'
];

/**
 * График Т-7 в XLSX. Лист «График отпусков», 10 граф как в форме.
 * @param {object} data
 * @param {object} [options] — { save_to }
 * @returns {Promise<Buffer|string>}
 */
async function generateScheduleT7Xlsx(data, options) {
  const d = data || {};
  const { ExcelJS } = _loadExcelLibs();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ASGARD CRM';
  wb.created = new Date();

  const schedule = _pick(d, 'schedule', {}) || {};
  const year = _pick(d, 'year', new Date().getFullYear());
  const ws = wb.addWorksheet('График отпусков', {
    views: [{ state: 'frozen', ySplit: 4 }]
  });

  // Шапка: строка 1 — реквизиты, строка 2 — заголовок формы, строки 3–4 — графы.
  ws.mergeCells(1, 1, 1, 10);
  const c1 = ws.getCell(1, 1);
  c1.value = _orgName(_pick(d, 'organization', '')) || 'График отпусков';
  c1.font = { bold: true };
  c1.alignment = { horizontal: 'center' };

  ws.mergeCells(2, 1, 2, 10);
  const c2 = ws.getCell(2, 1);
  const num = _s(_pick(schedule, 'number', _pick(d, 'schedule_number', '')));
  const dt = _dot(_pick(schedule, 'date', ''));
  c2.value = `ГРАФИК ОТПУСКОВ на ${year} год` +
    (num ? `  № ${num}` : '') +
    (dt ? ` от ${dt}` : '');
  c2.font = { bold: true };
  c2.alignment = { horizontal: 'center' };

  // Строка 3 — нумерация граф 1..10 (как в форме Т-7).
  const numbering = ws.getRow(3);
  for (let i = 0; i < 10; i++) numbering.getCell(i + 1).value = i + 1;
  // Строка 4 — названия граф.
  const head = ws.getRow(4);
  T7_HEADER.forEach((h, i) => { head.getCell(i + 1).value = h; });

  [3, 4].forEach((r) => {
    const row = ws.getRow(r);
    row.font = { bold: true };
    row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    for (let i = 1; i <= 10; i++) {
      row.getCell(i).border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
      };
    }
  });

  // Тело: по строке на сотрудника.
  _employeeRows(d).forEach((e) => {
    const row = ws.addRow([
      e.Подразделение,
      e.Должность,
      e.ФИО,
      e.ТабельныйНомер,
      e.Дней,
      e.ДатаЗапланированная,
      e.ДатаФактическая,
      e.ОснованиеПереноса,
      e.ДатаПредполагаемая,
      e.Примечание
    ]);
    row.alignment = { vertical: 'middle', wrapText: true };
    for (let i = 1; i <= 10; i++) {
      row.getCell(i).border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
      };
    }
  });

  // Ширины граф.
  const widths = [22, 30, 28, 12, 14, 16, 14, 22, 18, 20];
  ws.columns.forEach((col, i) => { col.width = widths[i] || 14; });

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return _maybeSave(buf, options);
}

module.exports = {
  generateVacationApplication,
  generateOrderT6,
  generateScheduleT7,
  generateScheduleT7Xlsx,
  // экспортируем хелперы и пути — удобно для тестов/роутов
  TPL,
  T7_HEADER,
  _shortName,
  _dot
};
