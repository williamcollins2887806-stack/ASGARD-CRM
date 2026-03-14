/**
 * Import 280 rows (with price) into CRM as tenders only.
 * NO works created. All data from Excel included except employees.
 */
const { Client } = require('pg');
const fs = require('fs');

const DB = {
  host: 'localhost', port: 5432,
  database: 'asgard_crm', user: 'asgard', password: '123456789',
};

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

function parseINN(val) {
  if (!val) return null;
  const s = String(val).replace(/\s/g, '').replace(/\.0$/, '').substring(0, 20);
  return s || null;
}

function parseDateDMY(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
}

async function main() {
  const client = new Client(DB);
  await client.connect();

  // Verify DB is clean
  const { rows: [check] } = await client.query('SELECT count(*) as cnt FROM tenders');
  console.log('Тендеров в БД сейчас: ' + check.cnt);
  if (parseInt(check.cnt) > 0) {
    console.log('ВНИМАНИЕ: В БД уже есть тендеры. Продолжаю добавление.');
  }

  // Load data
  const allData = JSON.parse(fs.readFileSync('tenders_projects.json', 'utf8'));
  const rows = Array.isArray(allData) ? allData : allData['Тендеры и Проекты'];

  // Filter only rows with price > 0
  const withPrice = rows.filter(r => r['Сумма'] && r['Сумма'] > 0);
  console.log('Строк с суммой: ' + withPrice.length);

  let imported = 0;
  let errors = 0;
  const unmappedStatuses = {};

  for (const row of withPrice) {
    const customer = String(row['Заказчик'] || '').trim();
    const inn = parseINN(row['ИНН']);
    const title = String(row['Название'] || '').trim();
    const year = String(row['Год'] || '').trim();
    const price = row['Сумма'];
    const contractSum = row['Сумма договора'] || null;
    const contractNo = String(row['№ договора'] || '').trim() || null;
    const contractDateRaw = String(row['Дата договора'] || '').trim() || null;
    const workDatesRaw = String(row['Даты работ'] || '').trim() || null;
    const pmName = String(row['Руководитель проекта'] || '').trim();
    const rawStatus = String(row['Статус'] || '').trim();
    const status = TENDER_STATUS_MAP[rawStatus] || rawStatus || 'Новый';
    const link = String(row['Ссылка'] || '').trim() || null;
    const commentRaw = String(row['Комментарий'] || '').trim() || null;
    const source = String(row['Источник'] || '').trim(); // Тендер или Проект

    if (rawStatus && TENDER_STATUS_MAP[rawStatus] === undefined) {
      unmappedStatuses[rawStatus] = (unmappedStatuses[rawStatus] || 0) + 1;
    }

    // PM mapping
    const pmId = pmName ? (PM_MAP[pmName] || null) : null;

    // Parse dates
    const workDates = workDatesRaw ? workDatesRaw.match(/(\d{1,2}\.\d{1,2}\.\d{4})/g) : null;
    const workStartPlan = workDates && workDates[0] ? parseDateDMY(workDates[0]) : null;
    const workEndPlan = workDates && workDates[1] ? parseDateDMY(workDates[1]) : null;

    // Build comment: include contract info, dates, etc.
    const commentParts = [];
    if (source) commentParts.push('Источник: ' + source);
    if (contractNo) commentParts.push('№ договора: ' + contractNo);
    if (contractDateRaw) commentParts.push('Дата договора: ' + contractDateRaw);
    if (contractSum && contractSum !== price) commentParts.push('Сумма договора: ' + contractSum);
    if (workDatesRaw) commentParts.push('Даты работ: ' + workDatesRaw);
    if (commentRaw) commentParts.push(commentRaw);
    const comment = commentParts.length > 0 ? commentParts.join('\n') : null;

    try {
      await client.query(`
        INSERT INTO tenders (
          customer_name, customer_inn, inn,
          tender_title, tender_type, tender_price, estimated_sum,
          tender_status, period, year,
          responsible_pm_id,
          link, comment_to,
          tender_number, cost_plan,
          work_start_plan, work_end_plan,
          source,
          created_at, updated_at
        ) VALUES (
          $1, $2, $2,
          $3, 'Прямой запрос', $4, $4,
          $5, $6, $7,
          $8,
          $9, $10,
          $11, $12,
          $13, $14,
          $15,
          NOW(), NOW()
        )
      `, [
        customer,                                 // $1 customer_name
        inn,                                      // $2 customer_inn & inn
        title,                                    // $3 tender_title
        price,                                    // $4 tender_price & estimated_sum
        status,                                   // $5 tender_status
        String(year).substring(0, 20),            // $6 period
        parseInt(year) || null,                   // $7 year
        pmId,                                     // $8 responsible_pm_id
        link,                                     // $9 link
        comment,                                  // $10 comment_to
        contractNo ? contractNo.substring(0, 255) : null, // $11 tender_number
        contractSum || null,                      // $12 cost_plan (contract sum)
        workStartPlan,                            // $13 work_start_plan
        workEndPlan,                              // $14 work_end_plan
        source === 'Проект' ? 'Проект' : 'Тендер', // $15 source
      ]);
      imported++;
    } catch (e) {
      errors++;
      console.error('ERROR #' + row['№'] + ' "' + title + '": ' + e.message);
    }
  }

  console.log('\n=== РЕЗУЛЬТАТ ===');
  console.log('Импортировано: ' + imported);
  console.log('Ошибок: ' + errors);

  if (Object.keys(unmappedStatuses).length > 0) {
    console.log('Незамапленные статусы:');
    for (const [s, cnt] of Object.entries(unmappedStatuses)) {
      console.log('  "' + s + '": ' + cnt);
    }
  }

  // Stats
  const { rows: [stats] } = await client.query(`
    SELECT count(*) as total,
      count(CASE WHEN tender_price > 0 THEN 1 END) as with_price,
      count(CASE WHEN customer_inn IS NOT NULL AND trim(customer_inn) != '' THEN 1 END) as with_inn,
      count(CASE WHEN responsible_pm_id IS NOT NULL THEN 1 END) as with_pm,
      count(CASE WHEN cost_plan > 0 THEN 1 END) as with_contract_sum,
      count(CASE WHEN tender_number IS NOT NULL THEN 1 END) as with_contract_no,
      count(CASE WHEN link IS NOT NULL AND trim(link) != '' THEN 1 END) as with_link
    FROM tenders
  `);
  console.log('\nВ БД тендеров: ' + stats.total);
  console.log('  С ценой: ' + stats.with_price);
  console.log('  С ИНН: ' + stats.with_inn);
  console.log('  С РП: ' + stats.with_pm);
  console.log('  С суммой договора: ' + stats.with_contract_sum);
  console.log('  С № договора: ' + stats.with_contract_no);
  console.log('  Со ссылкой: ' + stats.with_link);

  const { rows: statusDist } = await client.query(`
    SELECT tender_status, count(*) as cnt FROM tenders GROUP BY tender_status ORDER BY cnt DESC
  `);
  console.log('  Статусы:');
  for (const s of statusDist) console.log('    ' + s.tender_status + ': ' + s.cnt);

  const { rows: sourceDist } = await client.query(`
    SELECT source, count(*) as cnt FROM tenders GROUP BY source ORDER BY cnt DESC
  `);
  console.log('  Источники:');
  for (const s of sourceDist) console.log('    ' + (s.source || '(пусто)') + ': ' + s.cnt);

  await client.end();
  console.log('\nГотово!');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
