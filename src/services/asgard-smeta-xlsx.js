'use strict';

/**
 * Excel-выгрузка параметрической сметы Асгарда (формулы + синяя заливка params).
 * Структура как СМЕТА_СЕГЕЖСКИЙ_ЦБК_v1.xlsx.
 */

const ExcelJS = require('exceljs');
const smeta = require('./asgard-smeta');

const BLUE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
const SECTION_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6DCE4' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const COST_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
const PRICE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
const THIN = { style: 'thin', color: { argb: 'FF8FAADC' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function moneyFmt() { return '#,##0.00'; }

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
    { width: 8 }, { width: 62 }, { width: 14 }, { width: 10 }, { width: 16 }, { width: 16 }
  ];

  // ── Шапка ──
  ws.mergeCells('A1:F1');
  ws.getCell('A1').value = 'СМЕТА — расчёт себестоимости';
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = HEADER_FILL;
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  ws.mergeCells('A2:F2');
  ws.getCell('A2').value = meta.title || 'Просчёт ТКП';
  ws.getCell('A2').font = { bold: true, size: 11 };
  ws.getCell('A2').alignment = { wrapText: true };
  ws.getRow(2).height = 32;

  const metaRows = [
    [4, 'Заказчик:', meta.customer || '—'],
    [5, 'Объект:', meta.object || '—'],
    [6, 'Исполнитель:', meta.executor || 'ООО «АСГАРД-Сервис»'],
    [7, 'Срок работ:', meta.work_schedule || '—'],
    [8, 'Оплата / гарантия:', meta.terms || '—']
  ];
  for (const [row, label, val] of metaRows) {
    ws.mergeCells(`A${row}:B${row}`);
    ws.getCell(`A${row}`).value = label;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.mergeCells(`C${row}:F${row}`);
    ws.getCell(`C${row}`).value = val;
    ws.getCell(`C${row}`).alignment = { wrapText: true };
  }

  // ── Params ──
  ws.mergeCells('A10:F10');
  ws.getCell('A10').value = '1. ИСХОДНЫЕ ПАРАМЕТРЫ (синие — редактируемые)';
  ws.getCell('A10').font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A10').fill = HEADER_FILL;

  ws.getCell('A11').value = 'Параметр';
  ws.getCell('C11').value = 'Значение';
  ws.getCell('D11').value = 'Ед.';
  ws.getCell('E11').value = 'Примечание';
  ['A11', 'C11', 'D11', 'E11'].forEach((a) => {
    ws.getCell(a).font = { bold: true };
    ws.getCell(a).fill = SECTION_FILL;
  });

  // Param keys in fixed order → Excel rows 12..31
  const paramOrder = smeta.PARAM_LABELS;
  const paramCell = {}; // key → 'C12'
  paramOrder.forEach((metaP, i) => {
    const row = 12 + i;
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
    ws.mergeCells(`E${row}:F${row}`);
    ws.getCell(`E${row}`).value = metaP.note || '';
    paramCell[metaP.key] = `C${row}`;
  });

  const lastParamRow = 11 + paramOrder.length;
  const calcStart = lastParamRow + 2;

  ws.mergeCells(`A${calcStart}:F${calcStart}`);
  ws.getCell(`A${calcStart}`).value = '2. КАЛЬКУЛЯЦИЯ СЕБЕСТОИМОСТИ (без НДС)';
  ws.getCell(`A${calcStart}`).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getCell(`A${calcStart}`).fill = HEADER_FILL;

  const headRow = calcStart + 1;
  ['№', 'Статья затрат', 'Кол-во', 'Ед.', 'Цена/ставка, ₽', 'Сумма, ₽'].forEach((h, i) => {
    const c = ws.getCell(headRow, i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };
    c.border = BORDER;
  });

  // Map row ids to Excel row numbers for formulas
  const excelRow = {};
  let r = headRow + 1;
  const lineRowsBySection = { A: [], B: [], C: [], D: [], E: [] };

  for (const row of est.rows || []) {
    if (row.kind === 'section') {
      ws.mergeCells(`A${r}:F${r}`);
      ws.getCell(`A${r}`).value = row.name;
      ws.getCell(`A${r}`).font = { bold: true };
      ws.getCell(`A${r}`).fill = SECTION_FILL;
      excelRow[row.id] = r;
      r += 1;
      continue;
    }

    if (row.kind === 'line') {
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
      ws.getCell(`F${r}`).value = { formula: `C${r}*E${r}` };
      ws.getCell(`F${r}`).numFmt = moneyFmt();
      ws.getCell(`F${r}`).border = BORDER;
      excelRow[row.id] = r;
      if (lineRowsBySection[row.section]) lineRowsBySection[row.section].push(r);
      r += 1;
      continue;
    }

    if (row.kind === 'subtotal') {
      ws.mergeCells(`A${r}:E${r}`);
      ws.getCell(`A${r}`).value = row.name;
      ws.getCell(`A${r}`).font = { bold: true };
      ws.getCell(`A${r}`).fill = TOTAL_FILL;
      const lines = lineRowsBySection[row.section] || [];
      if (lines.length) {
        ws.getCell(`F${r}`).value = { formula: `SUM(${lines.map((n) => `F${n}`).join(',')})` };
      } else {
        ws.getCell(`F${r}`).value = 0;
      }
      ws.getCell(`F${r}`).numFmt = moneyFmt();
      ws.getCell(`F${r}`).font = { bold: true };
      ws.getCell(`F${r}`).fill = TOTAL_FILL;
      excelRow[row.id] = r;
      r += 1;
      continue;
    }

    if (row.kind === 'rollup') {
      ws.mergeCells(`A${r}:E${r}`);
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
      const directRow = excelRow.r_direct;
      const ohRow = excelRow.r_oh;
      const contRow = excelRow.r_cont;
      const costRow = excelRow.r_cost;
      const priceRow = excelRow.r_price;

      if (row.sumExpr === 'fot_tax' && fotRow) {
        formula = `F${fotRow}*${paramCell.fot_tax}`;
      } else if (row.sumExpr === 'personnel' && fotRow && taxRow) {
        formula = `F${fotRow}+F${taxRow}`;
      } else if (row.sumExpr === 'direct' && aTot && bTot && cTot && dTot && eTot) {
        formula = `F${aTot}+F${bTot}+F${cTot}+F${dTot}+F${eTot}`;
      } else if (row.sumExpr === 'overhead' && directRow) {
        formula = `F${directRow}*${paramCell.overhead}`;
      } else if (row.sumExpr === 'contingency' && directRow && ohRow) {
        formula = `(F${directRow}+F${ohRow})*${paramCell.contingency}`;
      } else if (row.sumExpr === 'cost' && directRow && ohRow && contRow) {
        formula = `F${directRow}+F${ohRow}+F${contRow}`;
      } else if (row.sumExpr === 'price_no_vat' && costRow && eTot) {
        formula = `F${eTot}*${paramCell.material_markup}+(F${costRow}-F${eTot})*${paramCell.markup}`;
      } else if (row.sumExpr === 'vat_amount' && priceRow) {
        formula = `F${priceRow}*${paramCell.vat}`;
      } else if (row.sumExpr === 'price_with_vat' && priceRow) {
        formula = `F${priceRow}*(1+${paramCell.vat})`;
      } else {
        ws.getCell(`F${r}`).value = numOr(row.sum, 0);
      }

      if (formula) {
        ws.getCell(`F${r}`).value = { formula };
      }
      excelRow[row.id] = r;

      ws.getCell(`F${r}`).numFmt = moneyFmt();
      ws.getCell(`F${r}`).font = { bold: true };
      if (row.sumExpr === 'cost') {
        ws.getCell(`A${r}`).fill = COST_FILL;
        ws.getCell(`F${r}`).fill = COST_FILL;
      } else if (row.sumExpr === 'price_with_vat' || row.sumExpr === 'price_no_vat') {
        ws.getCell(`A${r}`).fill = PRICE_FILL;
        ws.getCell(`F${r}`).fill = PRICE_FILL;
      } else {
        ws.getCell(`A${r}`).fill = TOTAL_FILL;
        ws.getCell(`F${r}`).fill = TOTAL_FILL;
      }
      r += 1;
    }
  }

  // Ensure a_fot etc. mapped — subtotals use id from skeleton
  // skeleton ids: a_fot, a_tax, a_tot, b_tot, c_tot, d_tot, e_tot, r_*

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

module.exports = { buildAsgardSmetaXlsx };
