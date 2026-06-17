/**
 * API-клиент страницы /estimate-report.
 * Источник: vanilla estimate_report.js (1702 строки).
 */
import { api } from '@/api/client';

export const APPROVAL_STATUSES = {
  draft:    { label: 'Черновик',     tone: 'draft' },
  sent:     { label: 'На согласовании', tone: 'sent' },
  approved: { label: 'Согласовано',  tone: 'approved' },
  rework:   { label: 'На доработке', tone: 'question' },
  question: { label: 'Вопрос',       tone: 'question' },
  rejected: { label: 'Отклонено',    tone: 'rejected' }
};

export const COST_BLOCKS = [
  { key: 'personnel',   label: 'ФОТ',         color: 'var(--gold)' },
  { key: 'current',     label: 'Расходники',  color: 'var(--cyan)' },
  { key: 'travel',      label: 'Командиров.', color: 'var(--purple)' },
  { key: 'transport',   label: 'Транспорт',   color: 'var(--info)' },
  { key: 'chemistry',   label: 'Химия',       color: 'var(--orange)' },
  { key: 'contingency', label: 'Резерв',      color: 'var(--amber)' }
];

// Vanilla `estimate_report.js:38..45` — 6 блоков себестоимости.
// Используется в PositionsTable (редактируемой таблице) и парсере calcData.
export const BLOCK_META = {
  personnel:   { id: 'personnel',   name: 'Персонал и ФОТ',       color: '#AFA9EC', icon: '👷' },
  current:     { id: 'current',     name: 'Текущие расходы',      color: '#5DCAA5', icon: '🧰' },
  travel:      { id: 'travel',      name: 'Командировочные',      color: '#85B7EB', icon: '✈' },
  transport:   { id: 'transport',   name: 'Транспорт',            color: '#F0997B', icon: '🚛' },
  chemistry:   { id: 'chemistry',   name: 'Химия и утилизация',   color: '#FAC775', icon: '🧪' },
  contingency: { id: 'contingency', name: 'Непредвиденные',       color: '#B4B2A9', icon: '🛟' }
};

export const BLOCK_ORDER = ['personnel', 'current', 'travel', 'transport', 'chemistry', 'contingency'];

const JSON_FIELD = {
  personnel:   'personnel_json',
  current:     'current_costs_json',
  travel:      'travel_json',
  transport:   'transport_json',
  chemistry:   'chemistry_json'
};

export function loadEstimate(id) {
  return api(`/api/estimates/${id}`);
}

/**
 * Загружает данные расчёта и сразу парсит их в формат blocks-with-rows
 * (как в vanilla `estimate_report.js:197..265 parseCalcData`).
 * Возвращает: { blocks[], summary{}, raw, version_no }.
 * blocks[] — 6 блоков (personnel/current/travel/transport/chemistry/contingency)
 * с rows[]={item,qty,rate,days,volume_m3,percent,total,source,editable[]}.
 */
export async function loadCalculation(id) {
  try {
    const resp = await api(`/api/estimates/${id}/calculation`);
    return parseCalcData(resp);
  } catch {
    return parseCalcData(null);
  }
}

function _toRows(raw) {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  return Array.isArray(raw) ? raw : [];
}

/**
 * Пересчёт строки по правилам vanilla `estimate_report.js:1505..1525 recalcRow`.
 * Учитывает несколько вариантов формулы (qty*rate*days, qty*rate, volume*rate, kg*rate, km*rate*round_trip,
 * percent*base). Если editable=['total'] — total задан вручную, формула не применяется.
 */
export function recalcRow(r) {
  if (!r) return 0;
  const ed = Array.isArray(r.editable) ? r.editable : [];
  // editable=['total'] — total задаётся пользователем, не вычисляем.
  if (ed.length === 1 && ed[0] === 'total') return Number(r.total) || 0;

  const num = (v) => (v == null || v === '' || isNaN(+v) ? null : +v);
  const qty = num(r.qty);
  const rate = num(r.rate);
  const days = num(r.days);
  const vol = num(r.volume_m3);
  const rateM3 = num(r.rate_m3);
  const qtyKg = num(r.qty_kg);
  const rateKg = num(r.rate_kg);
  const distKm = num(r.distance_km);
  const rateKm = num(r.rate_km);
  const percent = num(r.percent);
  const base = num(r.base);

  let total = null;
  if (qty != null && rate != null && days != null) total = qty * rate * days;
  else if (qty != null && rate != null) total = qty * rate;
  else if (vol != null && rateM3 != null) total = vol * rateM3;
  else if (qtyKg != null && rateKg != null) total = qtyKg * rateKg;
  else if (distKm != null && rateKm != null) total = (r.round_trip === false) ? distKm * rateKm : distKm * 2 * rateKm;
  else if (percent != null && base != null) total = base * percent / 100;
  else if (percent != null) total = Number(r.total) || 0; // contingency сам пересчитывается отдельным проходом
  else total = Number(r.total) || 0;

  r.total = total;
  return total;
}

export function recalcBlock(block) {
  if (!block) return 0;
  const rows = block.rows || [];
  rows.forEach(recalcRow);
  block.subtotal = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
  return block.subtotal;
}

/**
 * Применяет правильный пересчёт contingency-блока (% от суммы остальных блоков)
 * и обновляет summary (cost/markup/price/margin).
 */
export function recalcAll(parsed) {
  if (!parsed || !parsed.blocks) return parsed;
  let base = 0;
  for (const b of parsed.blocks) {
    if (b.id === 'contingency') continue;
    recalcBlock(b);
    base += b.subtotal || 0;
  }
  const cont = parsed.blocks.find((b) => b.id === 'contingency');
  let contPct = 5;
  if (cont) {
    const row0 = cont.rows?.[0];
    if (row0 && row0.percent != null) contPct = Number(row0.percent) || 0;
    if (row0) row0.total = base * contPct / 100;
    cont.subtotal = base * contPct / 100;
  }
  const total = base + (cont?.subtotal || 0);
  const marginPct = Number(parsed.summary?.margin_pct) || 0;
  const markup = marginPct > 0 ? (1 + marginPct / 100) : Number(parsed.summary?.markup) || 1;
  const price = total * markup;
  parsed.summary = {
    ...(parsed.summary || {}),
    cost_no_vat: total,
    markup,
    price_no_vat: price,
    margin_rub: price - total,
    margin_pct: marginPct
  };
  return parsed;
}

/**
 * Парсит ответ /api/estimates/:id/calculation в формат blocks-with-rows.
 * Источник: vanilla `estimate_report.js:197..265 parseCalcData`.
 */
export function parseCalcData(resp) {
  const calc = resp?.calculation || resp || null;
  const versionNo = resp?.version_no || null;

  // Если backend уже отдал готовый calculation_json (новый формат) — используем его.
  if (calc && calc.calculation_json) {
    try {
      const obj = typeof calc.calculation_json === 'string' ? JSON.parse(calc.calculation_json) : calc.calculation_json;
      if (obj && obj.blocks) return recalcAll({ ...obj, raw: calc, version_no: versionNo });
    } catch { /* ignore */ }
  }

  if (!calc) {
    return { blocks: BLOCK_ORDER.map((id) => ({ ...BLOCK_META[id], rows: [], subtotal: 0 })), summary: {}, raw: null, version_no: versionNo };
  }

  const blocks = [];
  for (const id of BLOCK_ORDER) {
    if (id === 'contingency') continue;
    const rows = _toRows(calc[JSON_FIELD[id]]);
    blocks.push({ ...BLOCK_META[id], rows, subtotal: 0 });
  }

  // Contingency — отдельный блок с одной строкой «Буфер N%».
  const subtotalBase = blocks.reduce((s, b) => s + b.rows.reduce((ss, r) => ss + (Number(r.total) || 0), 0), 0);
  const contPct = Number(calc.contingency_pct) || 5;
  blocks.push({
    ...BLOCK_META.contingency,
    rows: [{ item: 'Буфер ' + contPct + '%', percent: contPct, total: subtotalBase * contPct / 100, editable: ['percent'] }],
    subtotal: subtotalBase * contPct / 100
  });

  const parsed = {
    blocks,
    summary: {
      cost_no_vat: Number(calc.total_cost) || subtotalBase + (subtotalBase * contPct / 100),
      markup: Number(calc.total_with_margin) && Number(calc.total_cost) ? Number(calc.total_with_margin) / Number(calc.total_cost) : 1,
      price_no_vat: Number(calc.total_with_margin) || 0,
      margin_pct: Number(calc.margin_pct) || 0,
      margin_rub: (Number(calc.total_with_margin) || 0) - (Number(calc.total_cost) || 0)
    },
    notes: calc.notes || '',
    raw: calc,
    version_no: versionNo
  };
  return recalcAll(parsed);
}

/**
 * Сериализует blocks-with-rows обратно в формат backend
 * (PUT /api/estimates/:id/calculation ожидает personnel_json/current_costs_json/...).
 * Источник: vanilla `estimate_report.js:1527..1554 saveCalculation`.
 */
export function serializeCalcData(parsed) {
  const findBlock = (id) => parsed.blocks?.find((b) => b.id === id);
  const rowsOf = (id) => (findBlock(id)?.rows || []).map((r) => {
    const out = { ...r };
    delete out._key;
    return out;
  });
  const cont = findBlock('contingency');
  const contPct = Number(cont?.rows?.[0]?.percent) || 5;
  return {
    personnel_json: rowsOf('personnel'),
    current_costs_json: rowsOf('current'),
    travel_json: rowsOf('travel'),
    transport_json: rowsOf('transport'),
    chemistry_json: rowsOf('chemistry'),
    contingency_pct: contPct,
    margin_pct: Number(parsed.summary?.margin_pct) || 0,
    notes: parsed.notes || ''
  };
}

export function loadComments(id) {
  return api(`/api/approval/estimates/${id}/comments`).then((d) => d.comments || d.items || []).catch(() => []);
}

export function loadAnalogs(id) {
  return api(`/api/estimates/${id}/analogs`).then((d) => d.analogs || d.items || []).catch(() => []);
}

export function loadDiff(id) {
  return api(`/api/estimates/${id}/diff`).catch(() => null);
}

export function postComment(id, body) {
  return api(`/api/approval/estimates/${id}/comments`, { method: 'POST', body });
}

export function postAction(id, action, body = {}) {
  return api(`/api/approval/estimates/${id}/${action}`, { method: 'POST', body });
}

export function approveFinalize(id, body = {}) {
  return api(`/api/estimates/${id}/approve-finalize`, { method: 'POST', body });
}

export function saveCalculation(id, body) {
  // Если передали распарсенный объект — сериализуем.
  const payload = body && body.blocks ? serializeCalcData(body) : body;
  return api(`/api/estimates/${id}/calculation`, { method: 'PUT', body: payload });
}

export function calcOverride(id, body) {
  return api(`/api/estimates/${id}/calc-override`, { method: 'POST', body });
}

export function autoCalculate(id, body = {}) {
  return api(`/api/estimates/${id}/auto-calculate`, { method: 'POST', body });
}

export function sendForApproval(id, body = {}) {
  return api(`/api/approval/estimates/${id}/send`, { method: 'POST', body });
}

export function resubmit(id, body = {}) {
  return api(`/api/approval/estimates/${id}/resubmit`, { method: 'POST', body });
}

export function mimirChat(body) {
  if (body.work_id || body.tender_id) {
    return api('/api/mimir/auto-estimate-chat', { method: 'POST', body });
  }
  return api('/api/mimir/chat', { method: 'POST', body });
}

export function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '—';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n)) + ' ₽';
}

export function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU') : '—';
}

export function calcMargin(price, cost) {
  const p = +price, c = +cost;
  if (!Number.isFinite(p) || !Number.isFinite(c) || c <= 0) return null;
  return ((p - c) / c) * 100;
}

/* ─── Wrapper под скачивание файла ─── */
// Vanilla estimate_report.js:504 — `/api/files/download/' + encodeURIComponent(doc.filename)`
// Используется секцией Прикреплённых документов в отчёте.
export function fileDownloadUrl(doc) {
  if (!doc) return '#';
  const name = doc.filename || doc.original_name || doc.id;
  return '/api/files/download/' + encodeURIComponent(name);
}

/* ─── Извлечение mimir_suggestions из calcData (vanilla:1060..1069 _getMimirSuggestions) ─── */
export function getMimirSuggestions(calcData) {
  if (!calcData) return null;
  const raw = calcData.raw || calcData._rawCalc || calcData._calc || null;
  if (!raw) return null;
  const ms = raw.mimir_suggestions;
  if (!ms) return null;
  try {
    return typeof ms === 'string' ? JSON.parse(ms) : ms;
  } catch { return null; }
}

/* ─── Lazy-loader SheetJS (CDN) — паттерн из WorkReport/api.js:107..118 ─── */
export async function ensureXlsx() {
  if (typeof window !== 'undefined' && window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.async = true;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Не удалось загрузить библиотеку Excel'));
    document.head.appendChild(s);
  });
}

/* ─── Полноценный экспорт в XLSX (8 листов) ─────────────────────────────
 * Заменяет CSV. Vanilla estimate_report.js:1214..1291 (2 листа); тут — 8:
 *   Итог, Персонал, Расходы, Командировки, Транспорт, Химия, Резерв, Мимир-анализ.
 * Лениво подгружает SheetJS из CDN, если не загружен.
 * ────────────────────────────────────────────────────────────────────── */
export async function exportEstimateToXlsx(est, calcData, filename) {
  const XLSX = await ensureXlsx();
  const blocks = (calcData?.blocks) || [];
  const s = calcData?.summary || {};
  const wb = XLSX.utils.book_new();
  const total = Number(s.cost_no_vat) || blocks.reduce((sum, b) => sum + (Number(b.subtotal) || 0), 0);

  // 1. Итог
  const summaryAoa = [
    ['Просчёт #' + est.id + ' v' + (est.current_version_no || est.version_no || 1)],
    ['Дата экспорта', new Date().toLocaleDateString('ru-RU')],
    [],
    ['Заказчик', est.customer_name || est.customer || est.tender_name || '—'],
    ['Статус', (APPROVAL_STATUSES[est.approval_status] || {}).label || est.approval_status || '—'],
    ['РП', est.pm_name || '—'],
    ['Город', est.object_city || '—'],
    ['Расстояние', est.object_distance_km ? est.object_distance_km + ' км' : '—'],
    ['Тип работ', est.work_type || '—'],
    ['Бригада', est.crew_count ? est.crew_count + ' чел.' : '—'],
    ['Рабочих дней', est.work_days || '—'],
    ['Дней дороги', est.road_days || '—'],
    ['Дедлайн', est.deadline ? new Date(est.deadline).toLocaleDateString('ru-RU') : '—'],
    [],
    ['ФИНАНСЫ'],
    ['Себестоимость без НДС', Number(s.cost_no_vat) || 0],
    ['Наценка', '×' + (Number(s.markup) || 1).toFixed(2)],
    ['Цена клиенту без НДС', Number(s.price_no_vat) || 0],
    ['Маржа ₽', Number(s.margin_rub) || 0],
    ['Маржа %', (Number(s.margin_pct) || 0).toFixed(1) + '%'],
    [],
    ['СТРУКТУРА СЕБЕСТОИМОСТИ'],
    ['Блок', 'Сумма ₽', '% от total']
  ];
  for (const b of blocks) {
    const sub = Number(b.subtotal) || 0;
    const pct = total > 0 ? ((sub / total) * 100).toFixed(1) : '0';
    summaryAoa.push([b.name || b.id, sub, pct + '%']);
  }
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
  wsSummary['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Итог');

  // 2..7 — листы по блокам (по одному на каждый из 6)
  // Маппинг id блока на лейбл листа (max 31 символ).
  const SHEET_NAMES = {
    personnel: 'Персонал',
    current: 'Расходы',
    travel: 'Командировки',
    transport: 'Транспорт',
    chemistry: 'Химия',
    contingency: 'Резерв'
  };
  for (const id of BLOCK_ORDER) {
    const b = blocks.find((x) => x.id === id);
    const sheetName = SHEET_NAMES[id] || id;
    const aoa = [
      [b?.name || sheetName],
      [],
      ['Позиция', 'Источник', 'Кол-во', 'Ставка', 'Дни/Объём/%', 'Итого ₽']
    ];
    const rows = b?.rows || [];
    if (!rows.length) {
      aoa.push(['(пусто)', '', '', '', '', 0]);
    } else {
      for (const r of rows) {
        const col4 = r.days || r.volume_m3 || (r.percent != null ? r.percent + '%' : '') || '';
        const rate = r.rate || r.rate_m3 || r.rate_kg || r.rate_km || '';
        aoa.push([
          r.item || '',
          r.source || '',
          r.qty != null ? r.qty : '',
          rate,
          col4,
          Number(r.total) || 0
        ]);
      }
    }
    aoa.push([]);
    aoa.push(['Итого', '', '', '', '', Number(b?.subtotal) || 0]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 38 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // 8. Мимир-анализ
  const ms = getMimirSuggestions(calcData) || {};
  const mimirAoa = [['Анализ Мимира']];
  if (ms.mimir_notes?.cheatsheet) {
    mimirAoa.push([], ['Шпаргалка'], [String(ms.mimir_notes.cheatsheet)]);
  }
  if (ms.recommended_crew?.length) {
    mimirAoa.push([], ['Рекомендованный состав бригады'], ['Имя', 'Роль', 'Город', 'Обоснование']);
    for (const p of ms.recommended_crew) {
      mimirAoa.push([p.name || '', p.role || '', p.city || '', p.reason || '']);
    }
  }
  if (ms.equipment_status?.from_warehouse?.length || ms.equipment_status?.to_purchase?.length) {
    mimirAoa.push([], ['Оборудование']);
    if (ms.equipment_status.from_warehouse?.length) {
      mimirAoa.push(['Со склада:'], ['Позиция', 'Кол-во', 'Состояние']);
      for (const r of ms.equipment_status.from_warehouse) {
        mimirAoa.push([r.item || '', r.quantity || 1, r.condition || '']);
      }
    }
    if (ms.equipment_status.to_purchase?.length) {
      mimirAoa.push(['Нужно купить:'], ['Позиция', 'Кол-во', 'Цена', 'Поставщик']);
      for (const r of ms.equipment_status.to_purchase) {
        mimirAoa.push([r.item || '', r.quantity || 1, Number(r.total || r.price_estimate || 0), r.supplier_hint || '']);
      }
    }
  }
  if (ms.permits_status?.available_crew?.length) {
    mimirAoa.push([], ['Допуска'], ['Допуск', 'Нужно', 'Доступно', 'Статус']);
    for (const p of ms.permits_status.available_crew) {
      mimirAoa.push([p.permit || '', p.needed || '', p.available || '', p.enough ? 'Хватает' : 'Не хватает']);
    }
  }
  if (ms.route_plan?.legs?.length) {
    mimirAoa.push([], ['Маршрут'], ['Этап', 'Откуда', 'Куда', 'Транспорт', 'Дней', '₽/чел']);
    ms.route_plan.legs.forEach((leg, i) => {
      mimirAoa.push([i + 1, leg.from || '', leg.to || '', leg.transport || '', leg.duration_days || '', Number(leg.cost_per_person) || '']);
    });
  }
  if (ms.scenarios?.length) {
    mimirAoa.push([], ['Сценарии расчёта'], ['Сценарий', 'Срок (дн)', 'Себестоимость', 'Цена', 'Маржа %', 'Комментарий']);
    for (const sc of ms.scenarios) {
      mimirAoa.push([sc.name || '', sc.duration_days || '', Number(sc.cost) || 0, Number(sc.price) || 0, Number(sc.margin_pct) || '', sc.note || '']);
    }
  }
  if (ms.warnings?.length) {
    mimirAoa.push([], ['Предупреждения'], ['Уровень', 'Заголовок', 'Текст']);
    for (const w of ms.warnings) {
      mimirAoa.push([w.level || '', w.title || '', w.text || '']);
    }
  }
  if (mimirAoa.length > 1) {
    const wsM = XLSX.utils.aoa_to_sheet(mimirAoa);
    wsM['!cols'] = [{ wch: 36 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 38 }];
    XLSX.utils.book_append_sheet(wb, wsM, 'Мимир-анализ');
  }

  const fn = filename || `Просчёт_${est.id}_v${est.current_version_no || est.version_no || 1}.xlsx`;
  XLSX.writeFile(wb, fn);
}

/* ─── Экспорт CSV (G-15) ────────────────────────────────────────────────
 * Vanilla estimate_report.js:1206..1290 — `exportToExcel(est, calcData)`
 * формировал .xlsx через SheetJS (2 листа: «Расчёт» + «Сводка»). В v2
 * мы выводим объединённую CSV с BOM (Excel автоматически открывает в
 * правильной кодировке) — без зависимости от SheetJS. Если нужен честный
 * .xlsx — добавить lazy-import XLSX по аналогии с BankImport/ExportPanel.
 * ────────────────────────────────────────────────────────────────────── */
export function exportEstimateToCsv(est, calcData, filename) {
  const blocks = (calcData?.blocks) || (calcData?.cost?.blocks) || [];
  const s = calcData?.summary || {};
  const total = Number(s.cost_no_vat || s.cost_total || s.total || 0);
  const rows = [];

  // Шапка
  rows.push(['Просчёт', '#' + est.id + ' v' + (est.current_version_no || est.version_no || 1)]);
  rows.push(['Заказчик', est.customer_name || est.tender_name || '']);
  rows.push(['Статус', (APPROVAL_STATUSES[est.approval_status] || {}).label || est.approval_status || '']);
  rows.push([]);

  // Сводка
  rows.push(['СВОДКА']);
  rows.push(['Показатель', 'Значение']);
  rows.push(['Себестоимость', total]);
  rows.push(['Наценка',       '×' + Number(s.markup || 1).toFixed(2)]);
  rows.push(['Цена клиенту',  Number(s.price_no_vat || 0)]);
  rows.push(['Маржа ₽',       Number(s.margin_rub || 0)]);
  rows.push(['Маржа %',       Number(s.margin_pct || 0).toFixed(1) + '%']);
  rows.push([]);

  // Структура себестоимости
  rows.push(['СТРУКТУРА СЕБЕСТОИМОСТИ']);
  rows.push(['Блок', 'Сумма ₽', '% от total']);
  for (const b of blocks) {
    const sub = Number(b.subtotal || 0);
    const pct = total > 0 ? ((sub / total) * 100).toFixed(1) : '0';
    rows.push([b.name || b.label || b.id, sub, pct + '%']);
  }

  // Позиции — детально по блокам (для парности с vanilla XLSX-листом «Расчёт»).
  let hasAnyRows = blocks.some((b) => (b.rows || []).length);
  if (hasAnyRows) {
    rows.push([]);
    rows.push(['ПОЗИЦИИ ПО БЛОКАМ']);
    rows.push(['Блок', 'Позиция', 'Кол-во', 'Ставка', 'Дни/Объём', 'Итого ₽']);
    for (const b of blocks) {
      for (const r of (b.rows || [])) {
        const col2 = r.qty != null ? r.qty : '';
        const col3 = r.rate || r.rate_m3 || r.rate_kg || r.rate_km || '';
        const col4 = r.days || r.volume_m3 || (r.percent != null ? r.percent + '%' : '') || '';
        rows.push([b.name || b.id, r.item || '', col2, col3, col4, Number(r.total) || 0]);
      }
    }
  }

  const esc = (v) => {
    const x = String(v ?? '');
    if (x.includes(';') || x.includes('"') || x.includes('\n')) {
      return '"' + x.replace(/"/g, '""') + '"';
    }
    return x;
  };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `Просчёт_${est.id}_v${est.current_version_no || est.version_no || 1}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
