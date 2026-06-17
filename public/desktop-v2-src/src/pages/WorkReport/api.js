/**
 * API-клиент страницы /work-report.
 * Источник: vanilla `public/assets/js/work_report.js` (~1177 LOC).
 *
 * Endpoints (бэк):
 *   GET /api/works/:id/financial-summary  → src/routes/works.js:699
 *   GET /api/works                        → список (для выбора)
 *   GET /api/works/:id/report.pdf         → опц. PDF (если есть на бэке)
 */
import { api } from '@/api/client';
import { downloadProtected, openProtected } from '@/api/download';

/* ─── категории расходов (vanilla work_report.js:15..29) ─────────────── */
export const CAT_LABELS = {
  payroll:       { label: 'ФОТ (начислено)',   icon: '👷', color: '#e74c3c' },
  fot:           { label: 'ФОТ (начислено)',   icon: '👷', color: '#e74c3c' },
  cash:          { label: 'Наличные',          icon: '💵', color: '#e67e22' },
  per_diem:      { label: 'Суточные',          icon: '🍽',  color: '#f39c12' },
  logistics:     { label: 'Билеты/логистика',  icon: '🚚', color: '#3498db' },
  accommodation: { label: 'Проживание',        icon: '🏨', color: '#2980b9' },
  transfer:      { label: 'Трансфер',          icon: '🚗', color: '#1abc9c' },
  chemicals:     { label: 'Химия/материалы',   icon: '🧪', color: '#9b59b6' },
  equipment:     { label: 'Оборудование',      icon: '🔧', color: '#8e44ad' },
  materials:     { label: 'Материалы',         icon: '📦', color: '#16a085' },
  subcontract:   { label: 'Субподряд',         icon: '🤝', color: '#d35400' },
  other:         { label: 'Прочие',            icon: '📋', color: '#7f8c8d' },
  tickets:       { label: 'Билеты',            icon: '✈', color: '#2ecc71' }
};

export const CHART_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c',
  '#e67e22', '#2980b9', '#d35400', '#16a085', '#8e44ad', '#7f8c8d'
];

/* ─── загрузка ───────────────────────────────────────────────────────── */
export function loadFinancialSummary(workId) {
  return api(`/api/works/${workId}/financial-summary`);
}

/**
 * Список работ для экрана-выбора, когда id не передан.
 * /api/works отдаёт `{works:[...], items, rows}` — берём первое непустое.
 */
export async function listWorks() {
  try {
    const d = await api('/api/works?limit=300', { silent: true });
    return d?.works || d?.items || d?.rows || [];
  } catch {
    return [];
  }
}

/**
 * Печать PDF — пытаемся открыть report.pdf, если бэк его не отдаёт —
 * вызывающий поймает 404 и переключится на Excel.
 */
export async function printPdf(workId) {
  return openProtected(`/api/works/${workId}/report.pdf`, `work_report_${workId}.pdf`);
}

export async function downloadXlsxFromServer(workId) {
  return downloadProtected(
    `/api/works/${workId}/report.xlsx`,
    `work_report_${workId}.xlsx`
  );
}

/* ─── helpers ────────────────────────────────────────────────────────── */
export function fmtMoney(n) {
  if (!Number.isFinite(+n)) return '0';
  return new Intl.NumberFormat('ru-RU').format(Math.round(+n));
}
export function fmtMoneyR(n) { return fmtMoney(n) + ' ₽'; }
export function fmtDate(s) {
  if (!s) return '—';
  const parts = String(s).split('T')[0].split('-');
  if (parts.length !== 3) return '—';
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}
export function pct(val, total) {
  if (!total) return 0;
  return Math.round((val / total) * 1000) / 10;
}
export function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = new Date(String(a).split('T')[0] + 'T12:00:00');
  const db = new Date(String(b).split('T')[0] + 'T12:00:00');
  return Math.round((db - da) / 86400000);
}

/**
 * Компактный формат для графиков: 1879697 → "1.88М", 276705 → "277К".
 * Vanilla `work_report.js:435..440`.
 */
export function mShort(v) {
  const n = Math.abs(Math.round(v || 0));
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 10e6 ? 1 : 2) + 'М';
  if (n >= 1e3) return Math.round(n / 1e3) + 'К';
  return String(n);
}

/* ─── Excel-экспорт на клиенте (XLSX через CDN) ──────────────────────── */
const TYPE_LABELS = {
  advance: 'Аванс', postpay: 'Постоплата', intermediate: 'Промежуточный', other: 'Прочее'
};

async function ensureXlsx() {
  if (typeof window !== 'undefined' && window.XLSX) return window.XLSX;
  // SheetJS грузим из CDN (sw.js его кеширует). Это тот же файл, что использует vanilla.
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.async = true;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Не удалось загрузить библиотеку Excel'));
    document.head.appendChild(s);
  });
}

/**
 * 10-листовой Excel — точная копия vanilla `work_report.js:813..999 exportExcel`.
 */
export async function exportWorkReportExcel(d) {
  const XLSX = await ensureXlsx();
  const wb = XLSX.utils.book_new();
  const wm = d.work_meta || {};
  const cats = d.expenses?.categories || [];

  // 1. Сводка
  const s1 = [
    ['Финансовый отчёт — Работа #' + d.work_id], [''],
    ['Название', d.work_title || ''],
    ['Заказчик', wm.customer_name || ''],
    ['ИНН', wm.customer_inn || ''],
    ['РП', wm.pm_name || ''],
    ['Город', wm.city || ''],
    ['Объект', wm.object_name || ''],
    ['Статус', wm.work_status || ''], [''],
    ['Выручка с НДС', d.revenue.with_vat],
    ['Выручка без НДС', d.revenue.ex_vat],
    ['Расходы', d.expenses.total],
    ['Налоговая нагрузка', d.taxes.burden],
    ['Расходы с налогами', d.expenses.total_with_tax],
    ['НДС к уплате', d.vat.payable],
    ['Прибыль до налога', d.profit.before_tax],
    ['Налог на прибыль', d.profit.income_tax],
    ['Чистая прибыль', d.profit.net],
    ['Маржа, %', d.profit.margin]
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(s1);
  ws1['!cols'] = [{ wch: 25 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Сводка');

  // 2. Выручка
  const s2 = [
    ['Выручка'], [''],
    ['Показатель', 'Сумма, руб.'],
    ['Выручка с НДС', d.revenue.with_vat],
    ['НДС начисленный', d.vat.charged],
    ['Выручка без НДС', d.revenue.ex_vat]
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(s2);
  ws2['!cols'] = [{ wch: 25 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Выручка');

  // 3. Расходы по категориям
  const s3 = [
    ['Расходы по категориям'], [''],
    ['Категория', 'Кол-во', 'Сумма', 'НДС к вычету', 'Налог ' + d.taxes.rate + '%', 'Итого с налогом']
  ];
  for (const c of cats) {
    const info = CAT_LABELS[c.category] || { label: c.category };
    s3.push([info.label, c.count, c.sum, c.vatDeductible, c.taxBurden, c.sum + c.taxBurden]);
  }
  s3.push(['ИТОГО', '', d.expenses.total, d.vat.deductible, d.taxes.burden, d.expenses.total_with_tax]);
  const ws3 = XLSX.utils.aoa_to_sheet(s3);
  ws3['!cols'] = [{ wch: 22 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Расходы');

  // 4. Детализация расходов
  const s4 = [
    ['Детализация расходов'], [''],
    ['Категория', 'Поставщик', 'Сумма', 'Комментарий', 'Документ', 'Счёт-фактура']
  ];
  for (const c of cats) {
    const info = CAT_LABELS[c.category] || { label: c.category };
    for (const it of (c.items || [])) {
      s4.push([
        info.label, it.supplier || '', parseFloat(it.amount) || 0,
        it.comment || '', it.doc_number || '',
        it.invoice_received ? 'Да' : it.invoice_needed ? 'Ожидается' : 'Нет'
      ]);
    }
  }
  const ws4 = XLSX.utils.aoa_to_sheet(s4);
  ws4['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws4, 'Детали расходов');

  // 5. НДС
  const s5 = [
    ['НДС'], [''],
    ['Показатель', 'Сумма, руб.'],
    ['НДС начисленный', d.vat.charged],
    ['НДС к вычету', d.vat.deductible],
    ['НДС к уплате', d.vat.payable]
  ];
  const ws5 = XLSX.utils.aoa_to_sheet(s5);
  ws5['!cols'] = [{ wch: 22 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws5, 'НДС');

  // 6. Налоги
  const s6 = [
    ['Налоговая нагрузка'], [''],
    ['Ставка, %', d.taxes.rate],
    ['Нагрузка, руб.', d.taxes.burden], [''],
    ['Налог на прибыль, %', d.profit.income_tax_rate],
    ['Налог на прибыль, руб.', d.profit.income_tax]
  ];
  const ws6 = XLSX.utils.aoa_to_sheet(s6);
  ws6['!cols'] = [{ wch: 22 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws6, 'Налоги');

  // 7. Прибыль
  const s7 = [
    ['Прибыль'], [''],
    ['Показатель', 'Сумма, руб.'],
    ['Выручка без НДС', d.revenue.ex_vat],
    ['Расходы + налоги', d.expenses.total_with_tax],
    ['НДС к вычету (+)', d.vat.deductible],
    ['Прибыль до налога', d.profit.before_tax],
    ['Налог на прибыль', d.profit.income_tax],
    ['Чистая прибыль', d.profit.net],
    ['Маржа, %', d.profit.margin]
  ];
  const ws7 = XLSX.utils.aoa_to_sheet(s7);
  ws7['!cols'] = [{ wch: 22 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws7, 'Прибыль');

  // 8. Оплата
  const s8 = [
    ['Оплата заказчиком'], [''],
    ['Тип', 'Описание', 'Сумма', 'Дата', 'Статус']
  ];
  for (const inc of (d.payments?.items || [])) {
    s8.push([
      TYPE_LABELS[inc.type] || inc.type || '',
      inc.comment || '',
      parseFloat(inc.amount) || 0,
      inc.date ? fmtDate(inc.date) : '',
      inc.confirmed ? 'Оплачен' : 'Ожидает'
    ]);
  }
  s8.push(['']);
  s8.push(['Всего получено', '', d.payments?.confirmed || 0]);
  s8.push(['Ожидается', '', d.payments?.pending || 0]);
  s8.push(['Дебиторка', '', d.payments?.receivables || 0]);
  const ws8 = XLSX.utils.aoa_to_sheet(s8);
  ws8['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws8, 'Оплата');

  // 9. Бригада
  const crew = d.crew || [];
  const s9 = [
    ['Бригада'], [''],
    ['ФИО', 'Должность', 'Смены', 'Часы', 'Заработок']
  ];
  for (const c of crew) {
    s9.push([
      c.full_name || '', c.position || '',
      parseInt(c.shifts) || 0,
      Math.round(parseFloat(c.earned || 0) / parseFloat(c.point_value || 500)),
      parseFloat(c.earned) || 0
    ]);
  }
  const ws9 = XLSX.utils.aoa_to_sheet(s9);
  ws9['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws9, 'Бригада');

  // 10. Параметры
  const s10 = [
    ['Параметры'], [''],
    ['Ставка НДС, %', d.vat_pct],
    ['Ставка налог. нагрузки, %', d.taxes.rate],
    ['Ставка налога на прибыль, %', d.profit.income_tax_rate], [''],
    ['Тендер ID', wm.tender_id || ''],
    ['Себест. план', wm.cost_plan || ''],
    ['Себест. факт', wm.cost_fact || '']
  ];
  const ws10 = XLSX.utils.aoa_to_sheet(s10);
  ws10['!cols'] = [{ wch: 28 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws10, 'Параметры');

  const fileName = `Фин_отчёт_работа_${d.work_id}.xlsx`;
  XLSX.writeFile(wb, fileName);
  return fileName;
}
