// UPDATE IMPORT
const { Client } = require('pg');
const fs = require('fs');

const DB = { host: 'localhost', port: 5432, database: 'asgard_crm', user: 'asgard', password: '123456789' };

const PM_MAP = {
  'Зиссер Е.О.': 1226,
  'Трухин А.': 1225,
  'Пантузенко А.В.': 1230,
  'Путков Д.В.': 1231,
  'Погребняков С.В.': 1235,
  'Богданов Д.В.': 1229,
  'Климакин Д.': 1240,
  'Цветков А.В.': 1223,
  'Магомедов Р.Д.': 1234,
  'Коваленко А.А.': 1236,
  'Мараховский А.В.': 1227,
  'Яковлев А.А.': 1241,
  'Андросов Н.А.': 13,
  'Мартыненко Ю.': 1224,
  'Китуашвили Н.С.': 1228,
  'Очнев А.Л.': 1232,
  'Баринов В.А.': 1233,
  'Пономарев А.Е.': 1237,
  'Кузьмин М.М.': 1238,
  'Щедриков Д.С.': 1239,
};

// Status mapping: Excel -> CRM
const TENDER_STATUS_MAP = {
  'Новый': 'Новый',
  'В работе': 'В работе',
  'Выполнен': 'Выполнен',
  'Отказ': 'Клиент отказался',
  'Проиграли': 'Проиграли',
  'ТКП согласовано': 'ТКП согласовано',
  'Согласование ТКП': 'Согласование ТКП',
  'Выиграли': 'Выиграли',
};

const WORK_STATUS_MAP = {
  'Выполнен': 'Закрыт',
  'В работе': 'В работе',
  'Новый': 'Подготовка',
  'ТКП согласовано': 'Подготовка',
  'Согласование ТКП': 'Подготовка',
  'Выиграли': 'В работе',
  'Отказ': 'Отказ',
  'Проиграли': 'Отказ',
};

function parseNumber(val) {
  if (!val && val !== 0) return null;
  if (typeof val === 'number') return val > 0 ? val : null;
  const s = String(val).replace(/\s/g, '');
  // Handle comma as thousands separator when dot present
  let cleaned = s;
  if (cleaned.includes('.') && cleaned.includes(',')) {
    cleaned = cleaned.replace(/,/g, '');
  } else if (/\d,\d{3}(?!\d)/.test(cleaned) && !cleaned.includes('.')) {
    cleaned = cleaned.replace(/,/g, '');
  } else {
    cleaned = cleaned.replace(/,/g, '.');
  }
  const n = parseFloat(cleaned);
  return isNaN(n) || n <= 0 ? null : n;
}

function parseINN(val) {
  if (!val) return null;
  const s = String(val).replace(/\s/g, '').replace(/\.0$/, '').substring(0, 20);
  return s || null;
}


function parseDates(workDates) {
  let startDate = null, endDate = null;
  if (workDates) {
    const dm = workDates.match(/(d{1,2}.d{1,2}.d{4})/g);
    if (dm) {
      if (dm[0]) { const p=dm[0].split("."); startDate=p[2]+"-"+p[1].padStart(2,"0")+"-"+p[0].padStart(2,"0"); }
      if (dm[1]) { const p=dm[1].split("."); endDate=p[2]+"-"+p[1].padStart(2,"0")+"-"+p[0].padStart(2,"0"); }
    }
  }
  return { startDate, endDate };
}

function str(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === "" || s === "null" || s === "None" ? null : s;
}

async function main() {
  const client = new Client(DB);
  await client.connect();
  console.log("Connected to database");

  const allData = JSON.parse(fs.readFileSync("/var/www/asgard-crm/tenders_projects_new.json", "utf8"));
  const sheetName = Object.keys(allData.sheets)[0];
  const rows = allData.sheets[sheetName].data;
  console.log("Total rows: " + rows.length + " (incl header)");
  const dataRows = rows.slice(1);
  console.log("Data rows: " + dataRows.length);

  const { rows: exTenders } = await client.query("SELECT id, tender_title, source FROM tenders");
  const tenderByTitle = {};
  for (const t of exTenders) { const k=(t.tender_title||"").trim().toLowerCase(); if(k) tenderByTitle[k]=t; }
  console.log("Existing tenders: " + exTenders.length);

  const { rows: exWorks } = await client.query("SELECT id, tender_id, work_title FROM works");
  const workByTid = {};
  for (const w of exWorks) { if(w.tender_id) workByTid[w.tender_id]=w; }
  console.log("Existing works: " + exWorks.length);

  let updT=0, newT=0, updW=0, newW=0, mPM=0, skip=0;
  const unmPM = {};

  for (const row of dataRows) {
    const source = str(row[1]) || "Тендер";
    const year = str(row[2]);
    const title = str(row[3]);
    const customer = str(row[4]);
    const inn = parseINN(row[5]);
    const price = parseNumber(row[6]);
    const ctrSum = parseNumber(row[7]);
    const ctrNo = str(row[8]);
    const ctrDate = str(row[9]);
    const wDates = str(row[10]);
    const pmName = str(row[11]);
    const emps = str(row[12]);
    const empCnt = parseNumber(row[13]);
    const link = str(row[14]);
    const rawSt = str(row[15]) || "Новый";
    const comment = str(row[16]);

    if (!title) { skip++; continue; }

    const tStatus = TENDER_STATUS_MAP[rawSt] || rawSt;
    const wStatus = WORK_STATUS_MAP[rawSt] || "В работе";
    const pmId = pmName ? (PM_MAP[pmName] || null) : null;
    if (pmName && pmId) mPM++;
    if (pmName && !pmId) unmPM[pmName] = (unmPM[pmName]||0)+1;

    const custName = customer || (inn ? "ИНН " + inn : "Без заказчика");
    const yearInt = parseInt(year) || null;
    const period = year ? String(year).substring(0,20) : null;
    const titleKey = title.trim().toLowerCase();
    const existing = tenderByTitle[titleKey];
    let tenderId;

    if (existing) {
      await client.query(
        "UPDATE tenders SET customer_name=$1, customer_inn=$2, inn=$2, tender_price=$3, tender_status=$4, period=$5, year=$6, link=$7, comment_to=$8, source=$9, pm_id=COALESCE($10, pm_id), updated_at=NOW() WHERE id=$11",
        [custName, inn, price||ctrSum||null, tStatus, period, yearInt, link, comment, source, pmId, existing.id]
      );
      tenderId = existing.id;
      updT++;
    } else {
      const r = await client.query(
        "INSERT INTO tenders (customer_name, customer_inn, inn, tender_title, tender_type, tender_price, tender_status, period, year, link, comment_to, source, pm_id, created_at, updated_at) VALUES ($1,$2,$2,$3,'Прямой запрос',$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()) RETURNING id",
        [custName, inn, title, price||ctrSum||null, tStatus, period, yearInt, link, comment, source, pmId]
      );
      tenderId = r.rows[0].id;
      newT++;
      tenderByTitle[titleKey] = { id: tenderId };
    }

    if (source === "Проект") {
      const { startDate, endDate } = parseDates(wDates);
      const cSum = ctrSum || price || 0;
      const cp = [];
      if (ctrNo) cp.push("Договор: " + ctrNo);
      if (ctrDate) cp.push("Дата договора: " + ctrDate);
      if (wDates) cp.push("Даты работ: " + wDates);
      if (emps) cp.push("Сотрудники: " + emps);
      if (empCnt) cp.push("Кол-во сотр.: " + empCnt);
      if (comment) cp.push(comment);
      const cFull = cp.length ? cp.join("\n") : null;

      const exW = workByTid[tenderId];
      if (exW) {
        await client.query(
          "UPDATE works SET customer_name=$1, customer_inn=$2, pm_id=COALESCE($3,pm_id), contract_sum=$4, contract_value=$4, status=$5, start_date_plan=COALESCE($6,start_date_plan), end_date_plan=COALESCE($7,end_date_plan), comment=$8, updated_at=NOW() WHERE id=$9",
          [customer||null, (inn||"").substring(0,20)||null, pmId, cSum, wStatus, startDate, endDate, cFull, exW.id]
        );
        updW++;
      } else {
        try {
          const r2 = await client.query(
            "INSERT INTO works (work_title, tender_id, contract_sum, contract_value, status, pm_id, customer_name, customer_inn, start_date_plan, end_date_plan, comment, created_at, updated_at) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING id",
            [title, tenderId, cSum, wStatus, pmId, customer||null, (inn||"").substring(0,20)||null, startDate, endDate, cFull]
          );
          workByTid[tenderId] = r2.rows[0];
          newW++;
        } catch(e) { console.error("ERR work "+title+": "+e.message); }
      }
    }
  }

  console.log("");
  console.log("========== IMPORT SUMMARY ==========");
  console.log("Updated tenders: " + updT);
  console.log("New tenders:     " + newT);
  console.log("Updated works:   " + updW);
  console.log("New works:       " + newW);
  console.log("Matched PMs:     " + mPM);
  console.log("Skipped rows:    " + skip);
  if (Object.keys(unmPM).length) {
    console.log("Unmatched PM names:");
    for (const n in unmPM) console.log("  " + JSON.stringify(n) + " x" + unmPM[n]);
  }

  const r1 = await client.query("SELECT count(*) as c FROM tenders");
  const r2 = await client.query("SELECT count(*) as c FROM works");
  console.log("");
  console.log("Final DB counts:");
  console.log("  Tenders: " + r1.rows[0].c);
  console.log("  Works:   " + r2.rows[0].c);
  await client.end();
  console.log("Done!");
}

main().catch(function(e) { console.error("FATAL:", e); process.exit(1); });