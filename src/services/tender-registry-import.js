/**
 * Import tender registry from Excel (final stage)
 * Uses xlsx if available, otherwise returns instructions
 */
const path = require('path');
const fs = require('fs');

const DEFAULT_XLSX = path.join(process.env.HOME || process.env.USERPROFILE || '', 'Downloads', 'Тендеры_сводная.xlsx');

const STATUS_MAP = {
  'рассмотрение': 'рассмотрение',
  'готовим': 'готовим',
  'подались': 'подались',
  'проиграли': 'проиграли',
  'отмена': 'отмена',
  'выиграли': 'выиграли'
};

async function spawnImport(db, opts = {}) {
  const filePath = opts.file_path || DEFAULT_XLSX;
  const dryRun = opts.dry_run !== false;

  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `Файл не найден: ${filePath}`, dry_run: dryRun };
  }

  let XLSX;
  try { XLSX = require('xlsx'); } catch (_) {
    return { ok: false, error: 'Установите пакет xlsx: npm install xlsx', dry_run: dryRun };
  }

  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const users = await db.query(`SELECT id, name FROM users WHERE is_active IS DISTINCT FROM false`);
  const userByName = new Map(users.rows.map(u => [String(u.name).trim().toLowerCase(), u.id]));

  let created = 0, skipped = 0, customersUpserted = 0;

  for (const row of rows) {
    const customer_name = String(row['Заказчик'] || row.customer_name || '').trim();
    const tender_title = String(row['Наименование'] || row['Тендер'] || row.tender_title || '').trim();
    if (!customer_name && !tender_title) { skipped++; continue; }

    const registry_status = STATUS_MAP[String(row['Статус'] || row.status || 'рассмотрение').trim().toLowerCase()] || 'рассмотрение';
    const customer_inn = String(row['ИНН'] || row.customer_inn || '').replace(/\D/g, '') || null;
    const createdByName = String(row['Добавил'] || row.created_by || '').trim().toLowerCase();
    const created_by = userByName.get(createdByName) || null;

    if (customer_inn) {
      if (!dryRun) {
        await db.query(`
          INSERT INTO customers (inn, name, full_name, created_at, updated_at)
          VALUES ($1, $2, $2, NOW(), NOW())
          ON CONFLICT (inn) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
        `, [customer_inn, customer_name]).catch(() => {});
      }
      customersUpserted++;
    }

    if (dryRun) { created++; continue; }

    await db.query(`
      INSERT INTO tenders (
        customer_name, customer_inn, tender_title, tender_price, docs_deadline, purchase_url,
        registry_status, tender_status, reject_reason, comment_to, source_kind, created_by, period, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual',$11,
        to_char(NOW(),'YYYY-MM'), NOW())
    `, [
      customer_name || null,
      customer_inn,
      tender_title || null,
      row['НМЦ'] || row.tender_price || null,
      row['Срок подачи'] || row.docs_deadline || null,
      row['Ссылка на площадку'] || row.purchase_url || null,
      registry_status,
      registry_status === 'выиграли' ? 'Выиграли' : registry_status === 'проиграли' ? 'Проиграли' : registry_status === 'отмена' ? 'Не подходит' : 'Новый',
      row['Причины отказа'] || row.reject_reason || null,
      row['Комментарий'] || row.comment_to || null,
      created_by
    ]);
    created++;
  }

  return { ok: true, dry_run: dryRun, file: filePath, rows: rows.length, created, skipped, customersUpserted };
}

module.exports = { spawnImport };
