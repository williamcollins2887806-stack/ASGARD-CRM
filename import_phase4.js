/**
 * ASGARD CRM Phase 4: Full Bitrix24 Import
 * Imports: Customers (JSON+DaData), Tenders+TKP, Invoices (Phase 4)
 */
const fs = require('fs');
const { Pool } = require('pg');

const DADATA_TOKEN = 'eca1ca4b8812489034e251028321fedf5ae39967';

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'asgard_crm',
  user: 'asgard',
  password: '123456789'
});

// --- CSV Parser (comma-delimited, double-quoted) ---
function parseCSV(filePath) {
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const lines = raw.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  function parseLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    if (vals.length < 3) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = vals[j] || '';
    }
    rows.push(obj);
  }
  return rows;
}

function cleanCompanyName(raw) {
  if (!raw) return '';
  let name = raw.replace(/,?\s*ИНН\s+\d+/gi, '').trim();
  name = name.replace(/,\s*$/, '').trim();
  return name;
}

function extractINN(raw) {
  const m = (raw || '').match(/ИНН\s+(\d{10,12})/i);
  return m ? m[1] : null;
}

function parseDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return m[3] + '-' + m[2] + '-' + m[1];
}

function parseMoney(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

function mapStage(stage) {
  const m = {
    'Новое': 'Новый',
    'Отправлено клиенту': 'ТКП отправлено',
    'Выиграно': 'Клиент согласился',
    'Проиграно': 'Клиент отказался',
    'Отклонено': 'Клиент отказался'
  };
  return m[stage] || 'Новый';
}

// --- DaData company lookup ---
async function lookupCompany(name) {
  try {
    const res = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Token ' + DADATA_TOKEN
      },
      body: JSON.stringify({ query: name, count: 1 })
    });
    const data = await res.json();
    if (data.suggestions && data.suggestions.length > 0) {
      const s = data.suggestions[0].data;
      return {
        inn: s.inn || null,
        kpp: s.kpp || null,
        ogrn: s.ogrn || null,
        full_name: s.name && s.name.full_with_opf ? s.name.full_with_opf : null,
        address: s.address && s.address.unrestricted_value ? s.address.unrestricted_value : null
      };
    }
  } catch (e) {
    // Silently skip failed lookups
  }
  return null;
}

// Throttle: max ~30 requests/sec to not overload DaData
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const client = await pool.connect();

  try {
    console.log('=== ASGARD CRM — Bitrix24 Import ===\n');

    // 1. Parse files
    console.log('Parsing CSV files...');
    const quotes = parseCSV('/tmp/quotes.csv');
    const invoices = parseCSV('/tmp/invoices.csv');
    console.log('  Quotes: ' + quotes.length + ' rows');
    console.log('  Invoices: ' + invoices.length + ' rows');

    // 2. Extract unique companies
    const companyMap = new Map();

    for (const q of quotes) {
      const name = cleanCompanyName(q['Компания']);
      const inn = extractINN(q['Компания']);
      if (name && !companyMap.has(name)) {
        companyMap.set(name, { name, inn, source: 'quote' });
      }
    }

    for (const inv of invoices) {
      const name = cleanCompanyName(inv['Компания']);
      if (name && !companyMap.has(name)) {
        companyMap.set(name, { name, inn: null, source: 'invoice' });
      }
    }


    // === Pre-cleanup: remove orphaned b24q TKPs ===
    console.log('\n--- Pre-cleanup: Orphaned TKP entries ---');
    const delOrphan = await client.query(
      "DELETE FROM tkp WHERE source LIKE 'b24q_%' AND tender_id IS NULL RETURNING id"
    );
    console.log('  Deleted orphaned TKPs: ' + delOrphan.rowCount);

    // === Step 0: Import customers from counterparties_unified.json ===
    console.log('\n--- Step 0: Customers from counterparties_unified.json ---');
    let cpLoaded = 0, cpCreated = 0, cpUpdated = 0, cpSkipped = 0;
    try {
      const cpRaw = fs.readFileSync('/tmp/counterparties_unified.json', 'utf8');
      const cpData = JSON.parse(cpRaw);
      const cpEntries = Object.entries(cpData);
      cpLoaded = cpEntries.length;
      console.log('  Loaded entries: ' + cpLoaded);

      for (const [inn, cp] of cpEntries) {
        if (!inn || inn === 'null') { cpSkipped++; continue; }

        const cpName = cp.short_name || cp.name || cp.full_name;
        if (!cpName) { cpSkipped++; continue; }

        // Check if customer with this INN already exists
        const existCheck = await client.query('SELECT id, name FROM customers WHERE inn = $1', [inn]);
        if (existCheck.rows.length > 0) {
          // Update existing with enriched data
          await client.query(
            `UPDATE customers SET
              kpp = COALESCE(kpp, $1),
              ogrn = COALESCE(ogrn, $2),
              full_name = COALESCE(full_name, $3),
              address = COALESCE(address, $4),
              phone = COALESCE(phone, $5),
              email = COALESCE(email, $6),
              contact_person = COALESCE(contact_person, $7)
            WHERE inn = $8`,
            [cp.kpp||null, cp.ogrn||null, cp.full_name||null, cp.address||null,
             cp.phone||null, cp.email||null, cp.contact_person||null, inn]
          );
          cpUpdated++;
          continue;
        }

        // Check by name
        const nameCheck = await client.query('SELECT id FROM customers WHERE LOWER(name) = LOWER($1)', [cpName]);
        if (nameCheck.rows.length > 0) {
          await client.query(
            `UPDATE customers SET
              inn = COALESCE(inn, $1),
              kpp = COALESCE(kpp, $2),
              ogrn = COALESCE(ogrn, $3),
              full_name = COALESCE(full_name, $4),
              address = COALESCE(address, $5)
            WHERE id = $6`,
            [inn, cp.kpp||null, cp.ogrn||null, cp.full_name||null, cp.address||null, nameCheck.rows[0].id]
          );
          cpUpdated++;
          continue;
        }

        // Insert new customer
        await client.query(
          `INSERT INTO customers (inn, kpp, ogrn, name, full_name, address, phone, email, contact_person, category, comment, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
           ON CONFLICT (inn) DO NOTHING`,
          [inn, cp.kpp||null, cp.ogrn||null, cpName, cp.full_name||null, cp.address||null,
           cp.phone||null, cp.email||null, cp.contact_person||null,
           'Заказчик', 'Импорт из counterparties_unified.json']
        );
        cpCreated++;
      }
    } catch(e) {
      console.log('  Warning: Could not load counterparties_unified.json: ' + e.message);
    }
    console.log('  From JSON — Created: ' + cpCreated + ', Updated: ' + cpUpdated + ', Skipped: ' + cpSkipped);

    console.log('\n--- Step 1: Customers (with DaData INN lookup) ---');
    console.log('  Unique companies found: ' + companyMap.size);

    // Check existing customers
    const existingCust = await client.query('SELECT inn, name FROM customers');
    const existingNames = new Set(existingCust.rows.map(r => (r.name || '').toLowerCase()));
    const existingInns = new Set(existingCust.rows.map(r => r.inn).filter(Boolean));

    let custCreated = 0, custSkipped = 0, dadataFound = 0, dadataNotFound = 0;
    let idx = 0;
    const total = companyMap.size;

    for (const [name, data] of companyMap) {
      idx++;
      if (existingNames.has(name.toLowerCase())) {
        custSkipped++;
        continue;
      }
      if (data.inn && existingInns.has(data.inn)) {
        custSkipped++;
        continue;
      }

      // Lookup INN via DaData if not present
      let inn = data.inn;
      let kpp = null, ogrn = null, fullName = null, address = null;

      if (!inn) {
        const info = await lookupCompany(name);
        if (info && info.inn) {
          inn = info.inn;
          kpp = info.kpp;
          ogrn = info.ogrn;
          fullName = info.full_name;
          address = info.address;
          dadataFound++;
        } else {
          dadataNotFound++;
        }
        // Throttle DaData requests
        await sleep(40);
      }

      // Skip if we found an INN that already exists
      if (inn && existingInns.has(inn)) {
        custSkipped++;
        continue;
      }

      await client.query(
        `INSERT INTO customers (inn, kpp, ogrn, name, full_name, address, category, comment, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (name) DO UPDATE SET
           inn = COALESCE(customers.inn, EXCLUDED.inn),
           kpp = COALESCE(customers.kpp, EXCLUDED.kpp),
           ogrn = COALESCE(customers.ogrn, EXCLUDED.ogrn),
           full_name = COALESCE(customers.full_name, EXCLUDED.full_name),
           address = COALESCE(customers.address, EXCLUDED.address)`,
        [inn, kpp, ogrn, name, fullName, address, 'Заказчик', 'Импорт из Битрикс24']
      );
      if (inn) existingInns.add(inn);
      existingNames.add(name.toLowerCase());
      custCreated++;

      if (idx % 50 === 0) {
        console.log('  ... ' + idx + '/' + total + ' (создано: ' + custCreated + ', DaData найдено: ' + dadataFound + ')');
      }
    }

    console.log('  Created: ' + custCreated);
    console.log('  Skipped (existing): ' + custSkipped);
    console.log('  DaData — INN found: ' + dadataFound + ', not found: ' + dadataNotFound);

    // 3. Group quotes by number -> tenders
    console.log('\n--- Step 2: Tenders (from quotes) ---');

    const tenderGroups = new Map();
    for (const q of quotes) {
      const num = q['Номер'];
      if (!num) continue;
      if (!tenderGroups.has(num)) {
        tenderGroups.set(num, {
          number: num,
          title: q['Тема'],
          stage: q['Стадия'],
          company: cleanCompanyName(q['Компания']),
          deadline: parseDate(q['Дата завершения']),
          responsible: q['Ответственный'],
          createdAt: parseDate(q['Когда создан']),
          b24id: q['ID'],
          items: []
        });
      }
      const grp = tenderGroups.get(num);
      grp.items.push({
        name: q['Товар'],
        price: parseMoney(q['Цена']),
        qty: parseInt(q['Количество']) || 1,
        sum: parseMoney(q['Сумма'])
      });
    }

    console.log('  Unique tenders from quotes: ' + tenderGroups.size);

    // Check existing tenders by dedup_key
    const existingTendersRes = await client.query(
      "SELECT id, dedup_key FROM tenders WHERE dedup_key IS NOT NULL AND dedup_key LIKE 'b24q_%'"
    );
    const existingDedupKeys = new Set(existingTendersRes.rows.map(r => r.dedup_key));

    let tendCreated = 0, tendSkipped = 0;
    const tenderIdByCompany = new Map();

    for (const [num, t] of tenderGroups) {
      const dedupKey = 'b24q_' + num;

      if (existingDedupKeys.has(dedupKey)) {
        tendSkipped++;
        const existing = existingTendersRes.rows.find(r => r.dedup_key === dedupKey);
        if (existing) {
          if (!tenderIdByCompany.has(t.company)) tenderIdByCompany.set(t.company, []);
          tenderIdByCompany.get(t.company).push({ id: existing.id, title: t.title });
        }
        continue;
      }

      const createdDate = t.createdAt || new Date().toISOString().slice(0, 10);
      const period = createdDate.slice(0, 7);

      let totalPrice = 0;
      for (const item of t.items) {
        if (item.price && item.qty) {
          totalPrice += item.price * item.qty;
        }
      }

      const itemsDesc = t.items.map(function(it, i) {
        var priceStr = it.price ? Number(it.price).toLocaleString('ru-RU') + ' руб.' : '';
        return (i + 1) + '. ' + it.name + ' — ' + priceStr + ' x ' + it.qty;
      }).join('\n');

      const res = await client.query(
        `INSERT INTO tenders (
          tender_number, tender_title, customer_name, tender_type, tender_status,
          tender_price, tender_description, comment_to, period,
          deadline, dedup_key, source, created_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13)
        ON CONFLICT DO NOTHING
        RETURNING id`,
        [
          num,
          t.title,
          t.company,
          'Прямой запрос',
          mapStage(t.stage),
          totalPrice || null,
          itemsDesc,
          'Ответственный: ' + t.responsible + '\nB24 ID: ' + t.b24id,
          period,
          t.deadline,
          dedupKey,
          'bitrix24',
          createdDate
        ]
      );

      if (res.rows[0]) {
        tendCreated++;

        // Create TKP
        const tkpNumber = 'B24-TKP-' + num;
        try {
          const itemsJson = t.items.map((it, i) => ({
            n: i+1, name: it.name, unit: 'шт', qty: it.qty,
            price: it.price || 0, total: (it.price||0) * it.qty
          }));
          await client.query(
            "INSERT INTO tkp (tender_id,number,tkp_number,customer_name,subject,items,total_sum,final_sum," +
            "valid_until,status,source,notes,author_id,created_at) " +
            "VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,1,$13) ON CONFLICT DO NOTHING",
            [res.rows[0].id, tkpNumber, tkpNumber, t.company, t.title,
             JSON.stringify(itemsJson), totalPrice||0, totalPrice||0,
             t.deadline,
             t.stage === 'Отправлено клиенту' ? 'sent' :
             t.stage === 'Принято' ? 'accepted' :
             t.stage === 'Отклонено' ? 'rejected' : 'draft',
             'bitrix24', 'Import B24 KP#' + num, createdDate]);
        } catch(e) { /* skip TKP errors */ }

        if (!tenderIdByCompany.has(t.company)) tenderIdByCompany.set(t.company, []);
        tenderIdByCompany.get(t.company).push({ id: res.rows[0].id, title: t.title });
      }
    }

    console.log('  Created: ' + tendCreated);
    console.log('  Skipped (existing): ' + tendSkipped);

    // 4. Import invoices
    console.log('\n--- Step 3: Invoices ---');

    const existingInvRes = await client.query(
      "SELECT id, invoice_number FROM invoices WHERE invoice_number LIKE 'B24-%'"
    );
    const existingInvNums = new Set(existingInvRes.rows.map(r => r.invoice_number));

    let invCreated = 0, invSkipped = 0, invLinked = 0, invBadRows = 0;

    for (const inv of invoices) {
      const rawNum = (inv['Номер'] || '').trim();
      // Skip malformed rows (HTML bleeding into columns)
      if (!rawNum || !/^\d+$/.test(rawNum)) {
        invBadRows++;
        continue;
      }
      const invNum = 'B24-' + rawNum;
      const amount = parseMoney(inv['Сумма']);
      const vatAmount = parseMoney(inv['Налог']);
      const company = cleanCompanyName(inv['Компания']);
      const description = inv['Тема'];
      const invDate = parseDate(inv['Дата выставления']) || parseDate(inv['Дата создания']);
      const dueDate = parseDate(inv['Срок']);
      const paidDate = parseDate(inv['Дата оплаты']);

      if (existingInvNums.has(invNum)) {
        invSkipped++;
        continue;
      }

      // Try to find matching tender by company + deal
      let workId = null;
      const dealName = inv['Сделка'];

      const companyTenders = tenderIdByCompany.get(company);
      if (companyTenders && dealName) {
        const match = companyTenders.find(t => t.title === dealName);
        if (match) workId = match.id;
        else if (companyTenders.length > 0) workId = companyTenders[0].id;
      } else if (companyTenders && companyTenders.length > 0) {
        workId = companyTenders[0].id;
      }

      if (!workId && company) {
        const dbMatch = await client.query(
          "SELECT id FROM tenders WHERE customer_name = $1 AND source = 'bitrix24' ORDER BY created_at DESC LIMIT 1",
          [company]
        );
        if (dbMatch.rows[0]) workId = dbMatch.rows[0].id;
      }

      
      // Try to link to TKP
      let tkpId = null;
      if (workId) {
        try {
          const tkpMatch = await client.query("SELECT id FROM tkp WHERE tender_id=$1 AND source='bitrix24' LIMIT 1", [workId]);
          if (tkpMatch.rows[0]) tkpId = tkpMatch.rows[0].id;
        } catch(e) {}
      }

      // Map status
      let status = 'Выставлен';
      if (paidDate) status = 'Оплачен';
      const invStatus = (inv['Статус'] || '').trim();
      if (invStatus === 'Счет Оплачен' || invStatus === 'Оплачен' || invStatus === 'Оплачен полностью') status = 'Оплачен';
      if (invStatus === 'Отклонен' || invStatus === 'Не оплачен') status = 'Не оплачен';

      // Find customer_id
      let customerId = null;
      if (company) {
        const custRes = await client.query('SELECT id FROM customers WHERE name = $1 LIMIT 1', [company]);
        if (custRes.rows[0]) customerId = custRes.rows[0].id;
      }

      // Clean HTML from comments
      let comment = inv['Комментарий менеджера'] || '';
      comment = comment.replace(/<[^>]*>/g, '').trim() || null;

      const res = await client.query(
        `INSERT INTO invoices (
          invoice_number, invoice_date, invoice_type, status,
          customer_name, customer_id, amount, vat_amount, total_amount,
          due_date, paid_date, description, notes, comment,
          work_id, tkp_id, source, created_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'bitrix24', 1, NOW())
        RETURNING id`,
        [
          invNum,
          invDate,
          'outgoing',
          status,
          company,
          customerId,
          amount,
          vatAmount,
          amount,
          dueDate,
          paidDate,
          description,
          'Ответственный: ' + inv['Ответственный'] + '\nB24 ID: ' + inv['ID'],
          comment,
          workId,
          tkpId
        ]
      );

      if (res.rows[0]) {
        invCreated++;
        if (workId) invLinked++;
      }
    }

    console.log('  Created: ' + invCreated);
    console.log('  Skipped (existing): ' + invSkipped);
    console.log('  Skipped (malformed): ' + invBadRows);
    console.log('  Linked to tenders: ' + invLinked);

    // 4b. Post-import: update existing B24 invoices with source and tender links
    console.log('\n--- Step 4: Updating existing B24 invoices ---');
    let invUpdSource = 0, invUpdLink = 0;

    // Set source on B24 invoices that don't have it
    const upSrc = await client.query(
      "UPDATE invoices SET source = 'bitrix24' WHERE invoice_number LIKE 'B24-%' AND (source IS NULL OR source = '') RETURNING id"
    );
    invUpdSource = upSrc.rowCount;

    // Link unlinked B24 invoices to tenders by company name
    const unlnk = await client.query(
      "SELECT id, customer_name, description FROM invoices WHERE invoice_number LIKE 'B24-%' AND work_id IS NULL AND customer_name IS NOT NULL"
    );
    for (const inv of unlnk.rows) {
      const companyTenders = tenderIdByCompany.get(inv.customer_name);
      if (companyTenders && companyTenders.length > 0) {
        const match = inv.description ? companyTenders.find(t => t.title === inv.description) : null;
        const tenderId = match ? match.id : companyTenders[0].id;
        let tkpId = null;
        try {
          const tkpR = await client.query("SELECT id FROM tkp WHERE tender_id=$1 AND source='bitrix24' LIMIT 1", [tenderId]);
          if (tkpR.rows[0]) tkpId = tkpR.rows[0].id;
        } catch(e) {}
        await client.query('UPDATE invoices SET work_id=$1, tkp_id=$2 WHERE id=$3', [tenderId, tkpId, inv.id]);
        invUpdLink++;
      }
    }
    console.log('  Updated source: ' + invUpdSource);
    console.log('  Linked to tenders: ' + invUpdLink);

    // Update old b24q TKPs that have tender_id: set source to bitrix24
    const upTkpSrc = await client.query(
      "UPDATE tkp SET source = 'bitrix24' WHERE source LIKE 'b24q_%' AND tender_id IS NOT NULL RETURNING id"
    );
    console.log('  Updated TKP source: ' + upTkpSrc.rowCount);

    // 5. Summary
    const finalCounts = await client.query(
      "SELECT " +
      "(SELECT COUNT(*) FROM customers) as customers, " +
      "(SELECT COUNT(*) FROM customers WHERE inn IS NOT NULL) as customers_with_inn, " +
      "(SELECT COUNT(*) FROM tenders) as tenders, " +
      "(SELECT COUNT(*) FROM tenders WHERE source = 'bitrix24') as tenders_b24, " +
      "(SELECT COUNT(*) FROM invoices) as invoices, " +
      "(SELECT COUNT(*) FROM invoices WHERE invoice_number LIKE 'B24-%') as invoices_b24, " +
      "(SELECT COUNT(*) FROM tkp) as tkps, " +
      "(SELECT COUNT(*) FROM tkp WHERE source = 'bitrix24') as tkps_b24"
    );

    console.log('\n=== ИТОГО ===');
    const s = finalCounts.rows[0];
    console.log('  Контрагентов: ' + s.customers + ' (с ИНН: ' + s.customers_with_inn + ')');
    console.log('  Тендеров всего: ' + s.tenders + ' (из B24: ' + s.tenders_b24 + ')');
    console.log('  Счетов всего: ' + s.invoices + ' (из B24: ' + s.invoices_b24 + ')');
    console.log('  ТКП всего: ' + s.tkps + ' (из B24: ' + s.tkps_b24 + ')');
    console.log('\nPhase 4 complete!');

  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
