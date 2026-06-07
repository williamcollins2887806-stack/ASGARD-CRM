'use strict';
/**
 * АСГАРД CRM — Импорт документов в КАТАЛОГ (не в заявку).
 * Регистрируется в index.js под префиксом /api/catalog-import.
 *
 * Заявка прошла мимо СРМ → загрузил УПД/счёт/Excel/фото → распарсили → предпросмотр и
 * редактирование → позиции попадают в products (расходники) / equipment (оборудование)
 * + price_records (цены) + supplier (upsert). Excel парсим напрямую, PDF/фото — через AI.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const path = require('path');
const fsp = require('fs').promises;
const { randomUUID } = require('crypto');

const WRITE_ROLES = ['ADMIN', 'PROC', 'WAREHOUSE', 'CHIEF_ENGINEER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'PM', 'HEAD_PM'];

const AI_DOC_PROMPT = `Ты — помощник по закупкам компании «Асгард Сервис».
Из текста счёта/УПД/накладной/КП выдели СПИСОК товарных позиций.
Для каждой: наименование, артикул (если есть), количество (число), единица, цена за единицу (число, ₽).
Также определи поставщика (название) если есть.
Верни СТРОГО валидный JSON без markdown и текста до/после:
{"supplier":"...","items":[{"name":"...","article":"","quantity":1,"unit":"шт","unit_price":0}]}`;

function parseJsonLoose(text) {
  if (!text) return null;
  const cm = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = cm ? cm[1] : text;
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a < 0 || b < 0) return null;
  try { return JSON.parse(raw.substring(a, b + 1)); } catch (_) { return null; }
}

async function routes(fastify) {
  const db = fastify.db;
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  // ── Загрузка Excel → парсинг → draft ──────────────────────────────────────
  fastify.post('/excel', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (req, reply) => {
    const data = await req.file(); if (!data) return bad(reply, 'Файл не загружен');
    // source_doc приходит multipart-полем ДО файла → доступно в data.fields.
    const sd = (data.fields && data.fields.source_doc && data.fields.source_doc.value) || 'other';
    const sourceDoc = ['upd', 'invoice', 'quote', 'other'].includes(sd) ? sd : 'other';
    // Буферизуем один раз: поток нельзя читать дважды (ExcelJS + сохранение файла).
    let buf; try { buf = await data.toBuffer(); } catch (_) { return bad(reply, 'Не удалось прочитать файл'); }
    const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch (_) { return bad(reply, 'Не удалось прочитать Excel'); }
    const ws = wb.worksheets[0]; if (!ws) return bad(reply, 'Пустой файл');
    // Эвристика: ищем колонки наименование/кол-во/ед/цена. Берём строки где есть текст в первой непустой колонке.
    const items = [];
    ws.eachRow((row, idx) => {
      if (idx === 1) return; // заголовок
      const vals = (row.values || []).map(v => (v && v.text) ? v.text : v);
      const name = (vals.find(v => typeof v === 'string' && v.trim().length > 1) || '').toString().trim();
      if (!name) return;
      const nums = vals.filter(v => typeof v === 'number' || (typeof v === 'string' && /^\d/.test(v)));
      const qty = parseFloat(nums[0]) || 1;
      const price = parseFloat(nums[nums.length - 1]) || null;
      items.push({ name, article: '', quantity: qty, unit: 'шт', unit_price: price });
    });
    if (!items.length) return bad(reply, 'Не найдено позиций в таблице');
    // сохраним файл
    const dir = path.join(process.env.UPLOAD_DIR || './uploads', 'catalog-imports');
    await fsp.mkdir(dir, { recursive: true });
    const fn = 'imp_' + randomUUID() + '.xlsx';
    try { await fsp.writeFile(path.join(dir, fn), buf); } catch (e) { fastify.log.warn('[catalog-import] не удалось сохранить файл: ' + e.message); }
    const { rows } = await db.query(
      `INSERT INTO catalog_imports(file_path,file_type,source_doc,parsed_json,created_by) VALUES($1,'excel',$2,$3,$4) RETURNING *`,
      ['/uploads/catalog-imports/' + fn, sourceDoc, JSON.stringify({ items }), req.user.id]);
    return { import: rows[0], items };
  });

  // ── Загрузка PDF/фото → AI-парсинг → draft ────────────────────────────────
  fastify.post('/ai', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (req, reply) => {
    // Принимаем текст документа (извлечённый клиентом) ИЛИ сырой текст. Для фото/PDF —
    // клиент шлёт распознанный/выгруженный текст; здесь AI структурирует в позиции.
    const text = (req.body && req.body.text) || '';
    if (!text.trim()) return bad(reply, 'Пустой текст документа');
    const aiProvider = require('../services/ai-provider');
    let aiResult;
    try {
      aiResult = await aiProvider.complete({ system: AI_DOC_PROMPT,
        messages: [{ role: 'user', content: 'Документ:\n\n' + text.slice(0, 14000) }], maxTokens: 4000, temperature: 0.1 });
    } catch (e) { fastify.log.warn('[catalog-import] ai failed: ' + e.message); return reply.send({ items: [], ai_unavailable: true, message: 'AI временно недоступен' }); }
    const parsed = parseJsonLoose(aiResult && aiResult.text);
    const items = parsed && Array.isArray(parsed.items) ? parsed.items.filter(i => i && i.name && String(i.name).trim()) : [];
    if (!items.length) return reply.send({ items: [], ai_unavailable: !parsed, message: parsed ? 'AI не нашёл позиций' : 'AI вернул неожиданный ответ' });
    const { rows } = await db.query(
      `INSERT INTO catalog_imports(file_type,source_doc,parsed_json,supplier_name,created_by) VALUES('pdf',$1,$2,$3,$4) RETURNING *`,
      [req.body?.source_doc || 'invoice', JSON.stringify({ items }), parsed.supplier || null, req.user.id]);
    return { import: rows[0], items, supplier: parsed.supplier || null };
  });

  // ── Предпросмотр ──────────────────────────────────────────────────────────
  fastify.get('/:id', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (req, reply) => {
    const { rows } = await db.query('SELECT * FROM catalog_imports WHERE id=$1', [req.params.id]);
    if (!rows[0]) return bad(reply, 'Не найден', 404);
    return { import: rows[0], items: (rows[0].parsed_json && rows[0].parsed_json.items) || [] };
  });

  // ── Применить (отредактированные позиции) в каталог/оборудование ──────────
  // body: { items:[{name,article,unit,quantity,unit_price,is_equipment}], supplier_name }
  fastify.post('/:id/apply', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (req, reply) => {
    const impId = parseInt(req.params.id);
    const imp = await db.query("SELECT * FROM catalog_imports WHERE id=$1 AND status='draft'", [impId]);
    if (!imp.rows[0]) return bad(reply, 'Импорт не найден или уже применён', 404);
    const items = (req.body && req.body.items) || (imp.rows[0].parsed_json && imp.rows[0].parsed_json.items) || [];
    const supplierName = req.body?.supplier_name || imp.rows[0].supplier_name || null;
    if (!items.length) return bad(reply, 'Нет позиций');
    const client = await db.pool.connect();
    let toCatalog = 0, toEquipment = 0, prices = 0;
    try {
      await client.query('BEGIN');
      // upsert поставщика
      let supplierId = null;
      if (supplierName && supplierName.trim()) {
        const s = await client.query('SELECT id FROM suppliers WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [supplierName.trim()]);
        if (s.rows[0]) supplierId = s.rows[0].id;
        else { const ns = await client.query("INSERT INTO suppliers(name,category,created_by) VALUES($1,'materials',$2) RETURNING id", [supplierName.trim(), req.user.id]); supplierId = ns.rows[0].id; }
      }
      for (const it of items) {
        const nm = (it.name || '').trim(); if (!nm) continue;
        const price = parseFloat(it.unit_price) || null;
        if (it.is_equipment) {
          // Оборудование — поштучная единица в equipment.
          const qr = randomUUID(); const inv = 'INV-' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 99);
          await client.query(`INSERT INTO equipment(name,inventory_number,quantity,unit,purchase_price,status,qr_uuid,qr_code,notes,created_by)
            VALUES($1,$2,$3,$4,$5,'on_warehouse',$6,$7,$8,$9)`,
            [nm, inv, parseFloat(it.quantity) || 1, it.unit || 'шт', price, qr, qr, 'Импорт документа #' + impId, req.user.id]);
          toEquipment++;
        } else {
          // Расходник/товар — в каталог products (upsert по имени).
          let pid;
          const ex = await client.query('SELECT id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]);
          if (ex.rows[0]) pid = ex.rows[0].id;
          else {
            try { const np = await client.query("INSERT INTO products(name,article,unit,is_consumable,created_from,created_by) VALUES($1,$2,$3,true,'import',$4) RETURNING id", [nm, it.article || null, it.unit || 'шт', req.user.id]); pid = np.rows[0].id; }
            catch (e) { if (e.code === '23505') { const x = await client.query('SELECT id FROM products WHERE lower(name)=lower($1) AND deleted_at IS NULL LIMIT 1', [nm]); pid = x.rows[0]?.id; } else throw e; }
          }
          toCatalog++;
          // цена в price_records
          if (price && price > 0 && pid) {
            await client.query(`INSERT INTO price_records(product_id,item_name,article,unit,supplier_id,supplier_name,unit_price,source,recorded_by)
              VALUES($1,$2,$3,$4,$5,$6,$7,'quote',$8)`,
              [pid, nm, it.article || null, it.unit || 'шт', supplierId, supplierName || null, price, req.user.id]);
            prices++;
          }
        }
      }
      await client.query("UPDATE catalog_imports SET status='applied', applied_count=$1, supplier_id=$2, applied_at=NOW() WHERE id=$3", [toCatalog + toEquipment, supplierId, impId]);
      await client.query('COMMIT');
      return { success: true, to_catalog: toCatalog, to_equipment: toEquipment, prices };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  fastify.delete('/:id', { preHandler: [fastify.requireRoles(WRITE_ROLES)] }, async (req, reply) => {
    const { rows } = await db.query("UPDATE catalog_imports SET status='discarded' WHERE id=$1 AND status='draft' RETURNING id", [req.params.id]);
    if (!rows[0]) return bad(reply, 'Не найден', 404); return { success: true };
  });
}

module.exports = routes;
