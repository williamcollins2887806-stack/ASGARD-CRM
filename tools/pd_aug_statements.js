#!/usr/bin/env node
'use strict';
process.chdir('/var/www/asgard-crm');
const fs = require('fs');
const ExcelJS = require('/var/www/asgard-crm/node_modules/exceljs');
const { Client } = require('/var/www/asgard-crm/node_modules/pg');
const { getPerDiemDays, getPerDiemAccruedMap } = require('/var/www/asgard-crm/src/lib/worker-per-diem-days');

function r0(x) { return Math.round(Number(x) || 0); }

(async () => {
  const db = new Client({
    user: 'asgard', password: '123456789', database: 'asgard_crm', host: '127.0.0.1',
  });
  await db.connect();

  const { rows: pool } = await db.query(`
    SELECT e.id, COALESCE(e.fio, e.full_name) AS fio
    FROM employees e
    WHERE e.id IN (
      SELECT employee_id FROM field_checkins
      WHERE status='completed' AND date BETWEEN '2026-08-01' AND '2026-08-31'
      UNION
      SELECT employee_id FROM field_trip_stages
      WHERE COALESCE(status,'active') NOT IN ('cancelled','rejected')
        AND date_from <= '2026-08-31' AND COALESCE(date_to, date_from) >= '2026-08-01'
    )
    ORDER BY e.id
  `);
  if (pool.length < 10) throw new Error('not enough people ' + pool.length);
  const step = Math.max(1, Math.floor(pool.length / 10));
  const picked = [];
  for (let i = 0; i < 10; i++) picked.push(pool[Math.min(i * step, pool.length - 1)]);
  // unique
  const seen = new Set();
  const people = [];
  for (const p of picked) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    people.push(p);
  }
  while (people.length < 10) {
    const extra = pool.find((x) => !seen.has(x.id));
    if (!extra) break;
    seen.add(extra.id);
    people.push(extra);
  }

  const ids = people.map((p) => p.id);
  const accMap = await getPerDiemAccruedMap(db, ids, 2026, 8);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'АСГАРД CRM';
  const overview = wb.addWorksheet('Сводка 10');
  overview.columns = [
    { header: 'ФИО', width: 36 },
    { header: 'Заработано ФОТ ₽', width: 18 },
    { header: 'Суточные начисл. ₽', width: 20 },
    { header: 'Суточные выплачено ₽', width: 22 },
    { header: 'Долг суточных ₽', width: 16 },
    { header: 'Объекты августа', width: 50 },
  ];

  for (const p of people) {
    const ws = wb.addWorksheet(String(p.fio).slice(0, 28));
    const pd = await getPerDiemDays(db, p.id, { year: 2026, month: 8 });
    const acc = accMap[p.id] || { accrued: 0, days: 0 };

    const { rows: fot } = await db.query(`
      SELECT COALESCE(SUM(amount_earned),0)::numeric AS fot,
             COUNT(*)::int AS shifts
      FROM field_checkins
      WHERE employee_id=$1 AND status='completed' AND date BETWEEN '2026-08-01' AND '2026-08-31'
    `, [p.id]);

    const { rows: works } = await db.query(`
      SELECT DISTINCT w.id, left(w.work_title, 70) AS title
      FROM (
        SELECT work_id FROM field_checkins
        WHERE employee_id=$1 AND status='completed' AND date BETWEEN '2026-08-01' AND '2026-08-31'
        UNION
        SELECT work_id FROM field_trip_stages
        WHERE employee_id=$1 AND COALESCE(status,'active') NOT IN ('cancelled','rejected')
          AND date_from <= '2026-08-31' AND COALESCE(date_to, date_from) >= '2026-08-01'
      ) x
      JOIN works w ON w.id = x.work_id
    `, [p.id]);

    const { rows: paid } = await db.query(`
      SELECT COALESCE(SUM(amount),0)::numeric AS paid
      FROM worker_payments
      WHERE employee_id=$1 AND type='per_diem' AND status IN ('paid','confirmed')
        AND CASE
              WHEN pay_year IS NOT NULL AND pay_month IS NOT NULL THEN pay_year*100+pay_month
              WHEN period_from IS NOT NULL THEN EXTRACT(YEAR FROM period_from)::int*100+EXTRACT(MONTH FROM period_from)::int
              ELSE EXTRACT(YEAR FROM (paid_at AT TIME ZONE 'Europe/Moscow'))::int*100
                 + EXTRACT(MONTH FROM (paid_at AT TIME ZONE 'Europe/Moscow'))::int
            END = 202608
    `, [p.id]);

    const fotAmt = r0(fot[0].fot);
    const pdAcc = r0(acc.accrued);
    const pdPaid = r0(paid[0].paid);
    const worksTxt = works.map((w) => `${w.id} ${w.title}`).join('; ') || '—';

    overview.addRow([p.fio, fotAmt, pdAcc, pdPaid, Math.max(0, pdAcc - pdPaid), worksTxt]);

    ws.getCell('A1').value = p.fio;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A2').value = 'Выписка август 2026 — CRM табель';
    ws.getCell('A4').value = 'Заработано (смены, ₽)';
    ws.getCell('B4').value = fotAmt;
    ws.getCell('A5').value = 'Смен completed';
    ws.getCell('B5').value = fot[0].shifts;
    ws.getCell('A6').value = 'Суточные начислено (SSoT, ₽)';
    ws.getCell('B6').value = pdAcc;
    ws.getCell('A7').value = 'Дней суточных';
    ws.getCell('B7').value = acc.days;
    ws.getCell('A8').value = 'Суточные выплачено (₽)';
    ws.getCell('B8').value = pdPaid;
    ws.getCell('A9').value = 'Долг суточных (₽)';
    ws.getCell('B9').value = Math.max(0, pdAcc - pdPaid);
    ws.getCell('A10').value = 'Что показывает колонка табеля';
    ws.getCell('B10').value = pdAcc;
    ws.getCell('A11').value = 'Объекты';
    ws.getCell('B11').value = worksTxt;

    ws.getCell('A13').value = 'Дни суточных (источник)';
    ws.getRow(14).values = ['Дата', 'Источник', 'Тип', 'Объект', 'Ставка'];
    let row = 15;
    for (const d of pd.days || []) {
      ws.getRow(row).values = [d.day, d.source, d.stage_type, d.work_id, d.rate];
      row += 1;
    }

    const { rows: daysCi } = await db.query(`
      SELECT fc.date::text, fc.shift, fc.amount_earned, left(w.work_title,50) title
      FROM field_checkins fc
      LEFT JOIN works w ON w.id = fc.work_id
      WHERE fc.employee_id=$1 AND fc.status='completed' AND fc.date BETWEEN '2026-08-01' AND '2026-08-31'
      ORDER BY fc.date
    `, [p.id]);
    ws.getCell(`A${row + 1}`).value = 'Смены августа';
    row += 2;
    ws.getRow(row).values = ['Дата', 'Смена', 'Сумма', 'Объект'];
    row += 1;
    for (const c of daysCi) {
      ws.getRow(row).values = [c.date, c.shift, c.amount_earned, c.title];
      row += 1;
    }
    ws.getColumn(1).width = 36;
    ws.getColumn(2).width = 16;
    ws.getColumn(5).width = 44;
  }

  const out = '/tmp/выписки_суточные_август_10.xlsx';
  await wb.xlsx.writeFile(out);
  console.log(JSON.stringify({ file: out, people: people.map((p) => ({ id: p.id, fio: p.fio })) }));
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
