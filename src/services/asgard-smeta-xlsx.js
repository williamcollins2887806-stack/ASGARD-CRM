'use strict';

/**
 * Excel-выгрузка параметрической сметы Асгарда (формулы + синяя заливка params).
 * Структура как СМЕТА_СЕГЕЖСКИЙ_ЦБК_v1.xlsx.
 *
 * Колонки: A № · B Статья · C Кол-во · D Ед. · E Цена/ставка · F Доля, % · G Сумма.
 * F (перечень оборудования) — справочный раздел: без формул, в итоги не входит;
 * G (закупка) — в себестоимость входит долей `C*E*IF(F="";1;F)`; H (аренда) — 1:1.
 */

const ExcelJS = require('exceljs');
const smeta = require('./asgard-smeta');

const BLUE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
const SECTION_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6DCE4' } };
const INFO_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const COST_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
const PRICE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
const THIN = { style: 'thin', color: { argb: 'FF8FAADC' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const LAST_COL = 'G';

function moneyFmt() { return '#,##0.00'; }

function fmtDateRu(v) {
  const s = String(v || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

/**
 * @param {object} estimate — asgard_v1 (будет recalc)
 * @returns {Promise<Buffer>}
 */
async function buildAsgardSmetaXlsx(estimate) {
  const est = smeta.recalcAsgardSmeta(estimate || {});
  const p = est.params;
  const meta = est.meta || {};

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ASGARD CRM';
  wb.created = new Date();
  const ws = wb.addWorksheet('Смета', {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 18 }
  });
  ws.columns = [
    { width: 8 }, { width: 62 }, { width: 10 }, { width: 10 }, { width: 16 }, { width: 10 }, { width: 18 }
  ];

  // ── Шапка ──
  ws.mergeCells(`A1:${LAST_COL}1`);
  ws.getCell('A1').value = 'СМЕТА — расчёт себестоимости';
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = HEADER_FILL;
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  ws.mergeCells(`A2:${LAST_COL}2`);
  ws.getCell('A2').value = meta.title || 'Просчёт ТКП';
  ws.getCell('A2').font = { bold: true, size: 11 };
  ws.getCell('A2').alignment = { wrapText: true };
  ws.getRow(2).height = 32;

  const datesStart = fmtDateRu(meta.work_start_plan);
  const datesEnd = fmtDateRu(meta.work_end_plan_calc);
  const metaRows = [
    [4, 'Заказчик:', meta.customer || '—'],
    [5, 'Объект:', meta.object || '—'],
    [6, 'Исполнитель:', meta.executor || 'ООО «АСГАРД-Сервис»'],
    [7, 'Начало работ (план):', datesStart ? `${datesStart}${datesEnd ? ` — окончание (план) ${datesEnd}` : ''}` : '—'],
    [8, 'Срок работ:', [
      meta.work_duration_days ? `${meta.work_duration_days} сут` : '',
      meta.work_schedule || ''
    ].filter(Boolean).join(' · ') || '—'],
    [9, 'Оплата / гарантия:', meta.terms || '—']
  ];
  for (const [row, label, val] of metaRows) {
    ws.mergeCells(`A${row}:B${row}`);
    ws.getCell(`A${row}`).value = label;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.mergeCells(`C${row}:${LAST_COL}${row}`);
    ws.getCell(`C${row}`).value = val;
    ws.getCell(`C${row}`).alignment = { wrapText: true };
  }

  // ── Params ──
  const paramsHeadRow = 11;
  ws.mergeCells(`A${paramsHeadRow}:${LAST_COL}${paramsHeadRow}`);
  ws.getCell(`A${paramsHeadRow}`).value = '1. ИСХОДНЫЕ ПАРАМЕТРЫ (синие — редактируемые)';
  ws.getCell(`A${paramsHeadRow}`).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getCell(`A${paramsHeadRow}`).fill = HEADER_FILL;

  ws.getCell(`A${paramsHeadRow + 1}`).value = 'Параметр';
  ws.getCell(`C${paramsHeadRow + 1}`).value = 'Значение';
  ws.getCell(`D${paramsHeadRow + 1}`).value = 'Ед.';
  ws.getCell(`E${paramsHeadRow + 1}`).value = 'Примечание';
  [`A${paramsHeadRow + 1}`, `C${paramsHeadRow + 1}`, `D${paramsHeadRow + 1}`, `E${paramsHeadRow + 1}`].forEach((a) => {
    ws.getCell(a).font = { bold: true };
    ws.getCell(a).fill = SECTION_FILL;
  });

  // Param keys in fixed order → rows right after the params header
  const paramOrder = smeta.PARAM_LABELS;
  const paramCell = {}; // key → 'C12'
  paramOrder.forEach((metaP, i) => {
    const row = paramsHeadRow + 2 + i;
    ws.mergeCells(`A${row}:B${row}`);
    ws.getCell(`A${row}`).value = metaP.label;
    ws.getCell(`C${row}`).value = p[metaP.key];
    ws.getCell(`C${row}`).fill = BLUE_FILL;
    ws.getCell(`C${row}`).border = BORDER;
    if (['fot_tax', 'overhead', 'contingency', 'vat'].includes(metaP.key)) {
      ws.getCell(`C${row}`).numFmt = '0.00%';
      // store as ratio already — Excel % format expects 0.55
    } else if (['markup', 'material_markup'].includes(metaP.key)) {
      ws.getCell(`C${row}`).numFmt = '0.00';
    } else {
      ws.getCell(`C${row}`).numFmt = '#,##0.##';
    }
    ws.getCell(`D${row}`).value = metaP.unit || '';
    ws.mergeCells(`E${row}:${LAST_COL}${row}`);
    ws.getCell(`E${row}`).value = metaP.note || '';
    paramCell[metaP.key] = `C${row}`;
  });

  const lastParamRow = paramsHeadRow + 1 + paramOrder.length;
  const calcStart = lastParamRow + 2;

  ws.mergeCells(`A${calcStart}:${LAST_COL}${calcStart}`);
  ws.getCell(`A${calcStart}`).value = '2. КАЛЬКУЛЯЦИЯ СЕБЕСТОИМОСТИ (без НДС)';
  ws.getCell(`A${calcStart}`).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getCell(`A${calcStart}`).fill = HEADER_FILL;

  const headRow = calcStart + 1;
  ['№', 'Статья затрат', 'Кол-во', 'Ед.', 'Цена/ставка, ₽', 'Доля, %', 'Сумма, ₽'].forEach((h, i) => {
    const c = ws.getCell(headRow, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };
    c.border = BORDER;
  });

  // Map row ids to Excel row numbers for formulas
  const excelRow = {};
  let r = headRow + 1;
  const lineRowsBySection = { A: [], B: [], C: [], D: [], E: [], G: [], H: [] };

  for (const row of est.rows || []) {
    if (row.kind === 'section') {
      ws.mergeCells(`A${r}:${LAST_COL}${r}`);
      ws.getCell(`A${r}`).value = row.name;
      ws.getCell(`A${r}`).font = { bold: true };
      ws.getCell(`A${r}`).fill = SECTION_FILL;
      excelRow[row.id] = r;
      r += 1;
      continue;
    }

    if (row.kind === 'info') {
      // Перечень оборудования (раздел F): справочно, без формул и без участия в итогах.
      ws.getCell(`A${r}`).value = row.code || '';
      ws.getCell(`B${r}`).value = row.name || '';
      ws.getCell(`C${r}`).value = numOr(row.qty, 0);
      ws.getCell(`C${r}`).fill = BLUE_FILL;
      ws.getCell(`C${r}`).border = BORDER;
      ws.getCell(`D${r}`).value = row.unit || '—';
      ws.getCell(`E${r}`).value = numOr(row.price, 0);
      ws.getCell(`E${r}`).fill = BLUE_FILL;
      ws.getCell(`E${r}`).border = BORDER;
      ws.getCell(`E${r}`).numFmt = moneyFmt();
      ws.getCell(`F${r}`).value = '—';
      ws.getCell(`F${r}`).alignment = { horizontal: 'center' };
      ws.getCell(`G${r}`).value = Number(row.sum) > 0 ? numOr(row.sum, 0) : 'справочно';
      if (Number(row.sum) > 0) ws.getCell(`G${r}`).numFmt = moneyFmt();
      ws.getCell(`G${r}`).font = { italic: true, color: { argb: 'FF808080' } };
      excelRow[row.id] = r;
      r += 1;
      continue;
    }

    if (row.kind === 'line') {
      const share = row.sharePct == null || row.sharePct === '' ? '' : numOr(row.sharePct, 1);
      const hasShare = share !== '' && Number(share) < 1;
      ws.getCell(`A${r}`).value = row.code || '';
      ws.getCell(`B${r}`).value = row.name || '';
      ws.getCell(`C${r}`).value = numOr(row.qty, 0);
      ws.getCell(`C${r}`).fill = BLUE_FILL;
      ws.getCell(`C${r}`).border = BORDER;
      ws.getCell(`D${r}`).value = row.unit || '—';
      ws.getCell(`E${r}`).value = numOr(row.price, 0);
      ws.getCell(`E${r}`).fill = BLUE_FILL;
      ws.getCell(`E${r}`).border = BORDER;
      ws.getCell(`E${r}`).numFmt = moneyFmt();
      ws.getCell(`F${r}`).value = hasShare ? Number(share) * 100 : (row.section === 'G' ? 100 : null);
      if (row.section === 'G' || hasShare) {
        ws.getCell(`F${r}`).numFmt = '0.##"%"';
        ws.getCell(`F${r}`).fill = BLUE_FILL;
        ws.getCell(`F${r}`).border = BORDER;
      }
      // Доля входит в себестоимость: пусто/100% → вся сумма, иначе только доля.
      ws.getCell(`G${r}`).value = { formula: `C${r}*E${r}*IF(F${r}="",1,F${r}/100)` };
      ws.getCell(`G${r}`).numFmt = moneyFmt();
      ws.getCell(`G${r}`).border = BORDER;
      excelRow[row.id] = r;
      if (lineRowsBySection[row.section]) lineRowsBySection[row.section].push(r);
      r += 1;
      continue;
    }

    if (row.kind === 'subtotal') {
      ws.mergeCells(`A${r}:F${r}`);
      ws.getCell(`A${r}`).value = row.name;
      ws.getCell(`A${r}`).font = { bold: true };
      ws.getCell(`A${r}`).fill = TOTAL_FILL;
      const lines = lineRowsBySection[row.section] || [];
      if (lines.length) {
        ws.getCell(`G${r}`).value = { formula: `SUM(${lines.map((n) => `G${n}`).join(',')})` };
      } else {
        ws.getCell(`G${r}`).value = 0;
      }
      ws.getCell(`G${r}`).numFmt = moneyFmt();
      ws.getCell(`G${r}`).font = { bold: true };
      ws.getCell(`G${r}`).fill = TOTAL_FILL;
      excelRow[row.id] = r;
      r += 1;
      continue;
    }

    if (row.kind === 'rollup') {
      ws.mergeCells(`A${r}:F${r}`);
      ws.getCell(`A${r}`).value = row.name;
      ws.getCell(`A${r}`).font = { bold: true };
      let formula = null;
      const fotRow = excelRow.a_fot;
      const taxRow = excelRow.a_tax;
      const aTot = excelRow.a_tot;
      const bTot = excelRow.b_tot;
      const cTot = excelRow.c_tot;
      const dTot = excelRow.d_tot;
      const eTot = excelRow.e_tot;
      const gTot = excelRow.g_tot;
      const hTot = excelRow.h_tot;
      const directRow = excelRow.r_direct;
      const ohRow = excelRow.r_oh;
      const contRow = excelRow.r_cont;
      const costRow = excelRow.r_cost;
      const priceRow = excelRow.r_price;
      const equipSum = [gTot, hTot].filter(Boolean).map((x) => `G${x}`).join('+');
      // Прямые: A..E + доля закупки (G) + аренда (H). Раздел F справочный — не входит.
      const directParts = [aTot, bTot, cTot, dTot, eTot, gTot, hTot]
        .filter(Boolean).map((x) => `G${x}`);

      if (row.sumExpr === 'fot_tax' && fotRow) {
        // База 55% = ФОТ + пайковые (C1); проживание налогом не облагается.
        const c1Row = excelRow.c1;
        formula = c1Row ? `(G${fotRow}+G${c1Row})*${paramCell.fot_tax}` : `G${fotRow}*${paramCell.fot_tax}`;
      } else if (row.sumExpr === 'personnel' && fotRow && taxRow) {
        formula = `G${fotRow}+G${taxRow}`;
      } else if (row.sumExpr === 'direct' && directParts.length) {
        formula = directParts.join('+');
      } else if (row.sumExpr === 'equipment_purchase' && gTot) {
        formula = `G${gTot}`;
      } else if (row.sumExpr === 'equipment_rental' && hTot) {
        formula = `G${hTot}`;
      } else if (row.sumExpr === 'equipment' && equipSum) {
        formula = equipSum;
      } else if (row.sumExpr === 'overhead' && directRow) {
        formula = `G${directRow}*${paramCell.overhead}`;
      } else if (row.sumExpr === 'contingency' && directRow && ohRow) {
        formula = `(G${directRow}+G${ohRow})*${paramCell.contingency}`;
      } else if (row.sumExpr === 'cost' && directRow && ohRow && contRow) {
        formula = `G${directRow}+G${ohRow}+G${contRow}`;
      } else if (row.sumExpr === 'price_no_vat' && costRow && eTot) {
        // Цена без НДС: материалы по своей наценке, оборудование 1:1 (без наценки),
        // остальная себестоимость — по общей наценке.
        const equipPart = equipSum ? `(G${costRow}-G${eTot}-(${equipSum}))*${paramCell.markup}` : `(G${costRow}-G${eTot})*${paramCell.markup}`;
        formula = `G${eTot}*${paramCell.material_markup}+${equipSum ? `${equipSum}*1+` : ''}${equipPart}`;
      } else if (row.sumExpr === 'vat_amount' && priceRow) {
        formula = `G${priceRow}*${paramCell.vat}`;
      } else if (row.sumExpr === 'price_with_vat' && priceRow) {
        formula = `G${priceRow}*(1+${paramCell.vat})`;
      } else if (row.sumExpr === 'margin_rub' && priceRow && costRow) {
        // Маржа = цена без НДС − себестоимость (D-184).
        formula = `G${priceRow}-G${costRow}`;
      } else if (row.sumExpr === 'income_tax_amount' && priceRow && costRow) {
        formula = `MAX(0,(G${priceRow}-G${costRow}))*${paramCell.income_tax}`;
      } else if (row.sumExpr === 'net_profit' && priceRow && costRow) {
        formula = `(G${priceRow}-G${costRow})-MAX(0,(G${priceRow}-G${costRow}))*${paramCell.income_tax}`;
      } else {
        ws.getCell(`G${r}`).value = numOr(row.sum, 0);
      }

      if (formula) {
        ws.getCell(`G${r}`).value = { formula };
      }
      excelRow[row.id] = r;

      ws.getCell(`G${r}`).numFmt = moneyFmt();
      ws.getCell(`G${r}`).font = { bold: true };
      if (row.sumExpr === 'cost') {
        ws.getCell(`A${r}`).fill = COST_FILL;
        ws.getCell(`G${r}`).fill = COST_FILL;
      } else if (row.sumExpr === 'price_with_vat' || row.sumExpr === 'price_no_vat') {
        ws.getCell(`A${r}`).fill = PRICE_FILL;
        ws.getCell(`G${r}`).fill = PRICE_FILL;
      } else if (row.sumExpr === 'equipment' || row.sumExpr === 'equipment_purchase' || row.sumExpr === 'equipment_rental') {
        ws.getCell(`A${r}`).fill = INFO_FILL;
        ws.getCell(`G${r}`).fill = INFO_FILL;
      } else {
        ws.getCell(`A${r}`).fill = TOTAL_FILL;
        ws.getCell(`G${r}`).fill = TOTAL_FILL;
      }
      r += 1;
    }
  }

  // Ensure a_fot etc. mapped — subtotals use id from skeleton
  // skeleton ids: a_fot, a_tax, a_tot, b_tot, c_tot, d_tot, e_tot, g_tot, h_tot, r_*

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

module.exports = { buildAsgardSmetaXlsx };
