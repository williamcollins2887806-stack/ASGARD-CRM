'use strict';

/**
 * payment_invoices — standalone ТО + волна из закупки.
 * DIR/BUH работают здесь / в #/approval-payment, не в модалке заявки.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const paymentMail = require('../services/payment-mail');
const { createNotification } = require('../services/notify');
const { stampExpiry } = require('../services/doc-approval-ttl');
const { normalizeUploadUrl, uploadFsPath } = require('../utils/upload-url');
const { enrichCatalogFromLines } = require('../services/catalog-from-invoice');

const DIR_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];
const CREATE_ROLES = ['PROC', 'ADMIN', 'PM', 'HEAD_PM', 'HEAD_TO', 'TO', ...DIR_ROLES];
const BUH_ROLES = ['BUH', 'ADMIN'];
const FILE_ROLES = [...new Set([...DIR_ROLES, ...BUH_ROLES, 'PROC', 'PM', 'HEAD_PM', 'HEAD_TO', 'TO'])];

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function statusLabel(status, paymentStatus, payTiming) {
  // D-316: черновик инициатора — ещё НЕ отправлен директору.
  if (status === 'draft') return 'Черновик';
  if (status === 'paid' || paymentStatus === 'paid') return 'Оплачен';
  if (status === 'rejected') return 'Отклонён';
  if (status === 'rework') return 'На доработке';
  if (paymentStatus === 'pending_payment' || status === 'pending_payment') {
    return payTiming === 'deferred' ? 'Одобрен, ждёт даты оплаты' : 'Ожидает оплаты';
  }
  if (status === 'awaiting_dir') return 'Ожидает директора';
  return status || '—';
}

async function ensureUploadDir() {
  const dir = path.join(process.cwd(), 'uploads', 'payment-invoices');
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function buildLineItemsFromImport(db, procurementId, importId) {
  const { rows } = await db.query(
    `SELECT pi.id, pi.name, pi.quantity, pi.unit_price, pi.total_price
     FROM procurement_items pi
     WHERE pi.procurement_id=$1 AND pi.invoice_import_id=$2
       AND COALESCE(pi.item_status,'pending')<>'cancelled'
     ORDER BY pi.id`,
    [procurementId, importId]
  );
  return rows.map(r => ({
    item_id: r.id,
    name: r.name,
    qty: num(r.quantity),
    unit_price: num(r.unit_price),
    total: num(r.total_price)
  }));
}

async function createFromProcurementWave(db, {
  procurementId, importId, actorId, basisText, payTiming
}) {
  const pack = await db.query(
    `SELECT ii.*, pr.work_id, pr.title AS proc_title
     FROM procurement_invoice_imports ii
     JOIN procurement_requests pr ON pr.id = ii.procurement_id
     WHERE ii.id=$1 AND ii.procurement_id=$2`,
    [importId, procurementId]
  );
  const imp = pack.rows[0];
  if (!imp) throw Object.assign(new Error('Счёт не найден'), { statusCode: 404 });

  const filePath = normalizeUploadUrl(imp.file_path);
  if (!filePath) {
    throw Object.assign(new Error('Сначала загрузите файл счёта'), { statusCode: 400 });
  }

  const existing = await db.query(
    `SELECT id FROM payment_invoices WHERE invoice_import_id=$1 AND status NOT IN ('rejected') LIMIT 1`,
    [importId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const lines = await buildLineItemsFromImport(db, procurementId, importId);
  const amount = num(imp.total_sum) || lines.reduce((s, l) => s + (l.total || l.unit_price * l.qty), 0);
  const basis = basisText || `Закупка #${procurementId}${imp.proc_title ? ': ' + imp.proc_title : ''}`;
  const timing = payTiming === 'deferred' ? 'deferred' : 'immediate';

  const { rows } = await db.query(
    `INSERT INTO payment_invoices(
       status, supplier_name, supplier_id, amount, due_date, file_path, file_name,
       basis_type, basis_text, work_id, procurement_id, invoice_import_id,
       line_items_json, requires_payment, created_by, pay_timing
     ) VALUES(
       'awaiting_dir', $1, $2, $3, NULL, $4, $5,
       'work', $6, $7, $8, $9,
       $10::jsonb, true, $11, $12
     ) RETURNING *`,
    [
      imp.supplier_name || null,
      imp.supplier_id || null,
      amount,
      filePath,
      imp.file_name || null,
      basis,
      imp.work_id || null,
      procurementId,
      importId,
      JSON.stringify(lines),
      actorId,
      timing
    ]
  );
  // V398: TTL согласования директора (72ч) — на каждую новую заявку.
  if (rows[0] && rows[0].status === 'awaiting_dir') {
    try { await stampExpiry(db, rows[0].id); } catch (_) { /* не критично */ }
  }
  return rows[0];
}

async function afterPaid(db, payment) {
  if (payment.invoice_import_id) {
    await db.query(
      `UPDATE procurement_invoice_imports SET approval_status='paid', paid_at=NOW() WHERE id=$1`,
      [payment.invoice_import_id]
    );
  }
  if (payment.procurement_id) {
    const open = await db.query(
      `SELECT COUNT(*)::int n FROM procurement_invoice_imports
       WHERE procurement_id=$1 AND approval_status IN ('draft','pm_returned','awaiting_pm','pm_approved','awaiting_dir','dir_approved')`,
      [payment.procurement_id]
    );
    const uncovered = await db.query(
      `SELECT COUNT(*)::int n FROM procurement_items
       WHERE procurement_id=$1 AND parent_item_id IS NULL AND COALESCE(item_status,'pending')<>'cancelled'
         AND invoice_import_id IS NULL`,
      [payment.procurement_id]
    );
    if (open.rows[0].n === 0 && uncovered.rows[0].n === 0) {
      await db.query(
        `UPDATE procurement_requests SET status='paid', updated_at=NOW() WHERE id=$1 AND status NOT IN ('delivered','closed','partially_delivered')`,
        [payment.procurement_id]
      );
    }
  }
  let docRow = null;
  try {
    const { upsertFromPaymentInvoice } = require('../services/doc-registry-upsert');
    docRow = await upsertFromPaymentInvoice(db, payment);
  } catch (e) {
    console.warn('[payment-invoices] doc_registry upsert:', e && e.message);
  }
  await autoWorkExpense(db, payment, docRow);
  return docRow;
}

/**
 * E5 (21.09.2026, D-236). «Оплатили → расход у проекта» раньше требовало ручного шага:
 * после оплаты счёта в расходах работы (`work_expenses`) ничего не появлялось, хотя реестр
 * карточку уже получал. Здесь досоздаём расход, если счёт привязан к работе.
 *
 * Идемпотентность — на стороне `insertWorkExpense`: upsert по (`source_table`, `source_key`)
 * = ('payment_invoices', '<id>'), плюс unique-индекс V071:20. Повторное срабатывание
 * `afterPaid` (например, ре-подтверждение оплаты) обновит ту же строку, а не создаст вторую.
 * Умышленно НЕ трогаем расход, если по этой карточке реестра он уже заведён вручную
 * (`doc_registry.work_expense_id`) — ручная запись главнее, у неё своя категория.
 */
async function autoWorkExpense(db, payment, docRow) {
  if (!payment || !payment.work_id) return null; // без работы расход некуда писать — карточка остаётся «неполной»
  if (docRow && docRow.work_expense_id) return docRow.work_expense_id; // ручная запись уже есть
  try {
    const { insertWorkExpense } = require('../services/work-expense-writer');

    // D-328 (заказчик 21.10.2026): «проверь, что все счета идут в расходы по
    // проектам, сверяясь с дублями, чтобы не занести два раза одно и то же».
    //
    // Защита по source_key ловит только ПОВТОР того же счёта. Но на проде нашлись
    // 4 пары, где по ОДНОМУ счёту в реестре есть ДВЕ строки (разные id, напр.
    // #505 и #506, счет №5560) — каждая даёт свой source_key, и расход
    // создавался дважды: 166 398 ₽ лишних. Поэтому перед вставкой проверяем
    // «уже есть расход по этому объекту с тем же номером документа и суммой».
    const invNo = docRow && docRow.invoice_number ? String(docRow.invoice_number).trim() : '';
    const amt = num(payment.amount);
    if (invNo && amt > 0) {
      const dup = await db.query(
        `SELECT id FROM work_expenses
          WHERE work_id = $1
            AND lower(trim(coalesce(doc_number,''))) = lower($2)
            AND abs(amount - $3) < 0.01
            AND COALESCE(status,'') <> 'rejected'
          LIMIT 1`,
        [payment.work_id, invNo, amt]
      );
      if (dup.rows[0]) {
        // Расход уже есть — связываем карточку с ним, второй не создаём.
        if (docRow && docRow.id) {
          await db.query(
            `UPDATE doc_registry SET work_expense_id=$2, updated_at=NOW()
              WHERE id=$1 AND work_expense_id IS NULL`, [docRow.id, dup.rows[0].id]);
        }
        return dup.rows[0].id;
      }
    }

    // ЕДИНЫЙ ключ расхода по счёту (expense-dedup-object, 17.10.2026): до этого
    // link-expense писал 'doc_registry:<id>', а здесь — '<payId>' → один счёт давал
    // ДВА расхода по объекту. Когда есть карточка реестра — ключ по её id.
    const dedupKey = docRow && docRow.id ? `invoice:${docRow.id}` : `payment:${payment.id}`;
    // Категория по умолчанию — «материалы (безнал)»: счёт поставщику. Это ВИД расхода, а не основание
    // (основание — work_id, см. блок G). Бухгалтер правит категорию в расходах, если закупка иная.
    const expense = await insertWorkExpense(db, {
      work_id: payment.work_id,
      category: 'materials',
      subcategory: 'other',
      amount: num(payment.amount),
      date: payment.buh_acted_at ? String(payment.buh_acted_at).slice(0, 10) : new Date().toISOString().slice(0, 10),
      description: `Оплата счёта #${payment.id}${payment.supplier_name ? ': ' + payment.supplier_name : ''}`,
      supplier: payment.supplier_name || null,
      doc_number: docRow && docRow.invoice_number ? docRow.invoice_number : null,
      payment_method: 'bank',
      source_table: 'doc_registry',
      source_id: docRow && docRow.id ? docRow.id : null,
      source_key: dedupKey,
      created_by: payment.buh_id || payment.dir_approved_by || payment.created_by || null
    });
    if (docRow && docRow.id && expense && expense.id) {
      await db.query(
        `UPDATE doc_registry SET work_expense_id=$2, updated_at=NOW() WHERE id=$1 AND work_expense_id IS NULL`,
        [docRow.id, expense.id]
      );
    }
    return expense && expense.id;
  } catch (e) {
    // Оплата уже состоялась и откатывать её из-за ошибки расхода нельзя — фиксируем и идём дальше.
    console.warn('[payment-invoices] auto work_expense:', e && e.message);
    return null;
  }
}

function decoratePayment(row) {
  if (!row) return row;
  const file_path = normalizeUploadUrl(row.file_path);
  const has_file = !!(row.file_path || row.file_name);
  return {
    ...row,
    file_path,
    has_file,
    // D1 (21.09): `file_url` — ТОЛЬКО когда файл реально есть. Раньше URL проставлялся всегда,
    // и модалка счёта БЕЗ вложения строила /file, получала 404 (ошибка в консоли), а превью
    // показывало «не удалось загрузить» вместо честного «файл не приложен».
    file_url: has_file && row.id ? `/api/payment-invoices/${row.id}/file` : null,
    status_label: statusLabel(row.status, row.payment_status, row.pay_timing)
  };
}

async function routes(fastify) {
  const db = fastify.db;

  fastify.get('/', { preHandler: [fastify.authenticate] }, async (req) => {
    const status = req.query.status || null;
    // 17.10: initiator_name в списке — мобильному и директору видно «от кого счёт».
    const base = `SELECT pi.*, u.name AS initiator_name, s.inn AS supplier_inn
                    FROM payment_invoices pi
                    LEFT JOIN users u ON u.id = pi.created_by
                    LEFT JOIN suppliers s ON s.id = pi.supplier_id`;
    const q = status
      ? await db.query(`${base} WHERE pi.status=$1 ORDER BY pi.id DESC LIMIT 200`, [status])
      : await db.query(`${base} ORDER BY pi.id DESC LIMIT 200`);
    return { items: q.rows.map(decoratePayment) };
  });

  /**
   * V411: «Мои счета на оплату» — для ИНИЦИАТОРА (любая роль).
   * Заказчик 18.10.2026: сотрудник должен видеть, что стало с его счётом:
   * у директора → согласован → у бухгалтерии → оплачен / возвращён.
   * Раньше бэк был, а списка для инициатора НЕ было — он не знал результата.
   */
  fastify.get('/my', { preHandler: [fastify.authenticate] }, async (req) => {
    const r = String(req.user.role || '');
    const isPriv = ['ADMIN', 'BUH', 'PROC', 'HEAD_PM', 'HEAD_TO'].includes(r) || /^DIRECTOR/.test(r);
    // Привилегированные видят все (им нужна сводка), остальные — только свои.
    const all = String((req.query && req.query.all) || '') === '1' && isPriv;
    const params = [];
    let where = '';
    if (!all) { params.push(req.user.id); where = ` WHERE pi.created_by = $1`; }
    const { rows } = await db.query(
      `SELECT pi.id, pi.supplier_name, pi.amount, pi.status, pi.payment_status, pi.pay_timing,
              pi.due_date, pi.created_at, pi.updated_at, pi.invoice_number, pi.invoice_date,
              pi.basis_text, pi.file_path, pi.file_name, pi.doc_registry_id,
              pi.contract_basis_number, pi.contract_missing, pi.work_hint, pi.vat_amount, pi.vat_rate, pi.amount_net,
              pi.initiator_intent, pi.pp_number, pi.payee_requisites,
              pi.approval_expires_at, pi.dir_approved_at, pi.buh_acted_at,
              pi.batch_id,
              u.name AS initiator_name,
              d.work_id AS registry_work_id, w.work_title AS work_title,
              (SELECT count(*)::int FROM price_records pr WHERE pr.doc_registry_id = pi.doc_registry_id) AS lines_count
         FROM payment_invoices pi
         LEFT JOIN users u ON u.id = pi.created_by
         LEFT JOIN doc_registry d ON d.id = pi.doc_registry_id
         LEFT JOIN works w ON w.id = d.work_id
         ${where}
        ORDER BY
          CASE pi.status WHEN 'awaiting_dir' THEN 0 WHEN 'pending_payment' THEN 1
                         WHEN 'rejected' THEN 2 WHEN 'paid' THEN 3 ELSE 4 END,
          pi.id DESC
        LIMIT 200`, params);
    // Человеческий статус для карточки инициатора.
    const stage = (x) => {
      if (x.status === 'awaiting_dir') return { code: 'dir', label: 'У директора', cls: 'warn' };
      if (x.status === 'rejected') return { code: 'rejected', label: 'Возвращён', cls: 'err' };
      if (x.status === 'expired' || x.status === 'archived') return { code: 'expired', label: 'В архиве (не согласован)', cls: 'muted' };
      if (x.payment_status === 'paid' || x.status === 'paid') return { code: 'paid', label: 'Оплачен', cls: 'ok' };
      if (x.status === 'pending_payment') return { code: 'buh', label: 'У бухгалтерии', cls: 'info' };
      return { code: 'other', label: x.status || '—', cls: 'muted' };
    };
    return {
      items: rows.map((x) => ({
        ...decoratePayment(x),
        stage: stage(x),
        work_title: x.work_title || null,
        lines_count: x.lines_count || 0,
        is_mine: Number(x.created_by) === Number(req.user.id)
      })),
      total: rows.length
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // V411/V412: превью счёта — ОБЪЯВЛЕНО ДО '/:id', иначе Fastify примет
  // «preview» за id (роут '/:id' перехватывает и отдаёт 404 «не найдено»).
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.get('/preview/:id', async (req, reply) => {
    // Авторизация: заголовок ИЛИ ?token (для <img src>, который не шлёт заголовки).
    let user = req.user;
    if (!user) {
      const qt = String((req.query && req.query.token) || '');
      if (qt) { try { user = fastify.jwt.verify(qt); } catch (_) { user = null; } }
    }
    if (!user) return reply.code(401).send({ error: 'Token required' });
    if (!FILE_ROLES.includes(user.role)) return reply.code(403).send({ error: 'Нет доступа' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const row = (await db.query('SELECT file_path, file_name, created_by FROM payment_invoices WHERE id=$1', [id])).rows[0];
    if (!row || !row.file_path) return reply.code(404).send({ error: 'Файл не приложен' });
    const { uploadFsPath } = require('../utils/upload-url');
    const full = uploadFsPath(row.file_path);
    if (!full || !fs.existsSync(full)) return reply.code(404).send({ error: 'Файл не найден на диске' });
    const ocrPdf = require('../services/pdf-ocr');
    const ext = String(full).toLowerCase().split('.').pop();
    // Картинка — отдаём как есть (это уже превью).
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      reply.header('Cache-Control', 'private, max-age=60');
      return reply.type(ext === 'png' ? 'image/png' : 'image/jpeg').send(fsp.createReadStream(full));
    }
    // PDF — рендерим первую страницу в PNG через тот же poppler, что и OCR.
    try {
      const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pv-'));
      const prefix = path.join(tmpDir, 'p');
      const { execFile } = require('child_process');
      // pdftoppm на Windows лежит в пакете poppler — берём путь из pdf-ocr,
      // иначе ENOENT и превью «недоступно».
      const bin = ocrPdf.PDFTOPPM_BIN || process.env.PDFTOPPM_BIN || 'pdftoppm';
      await new Promise((resolve, reject) => {
        execFile(bin, ['-png', '-r', '110', '-f', '1', '-l', '1', full, prefix],
          { timeout: 25000 }, (err) => (err ? reject(err) : resolve()));
      });
      const files = (await fsp.readdir(tmpDir)).filter((f) => f.endsWith('.png')).sort();
      if (!files.length) throw new Error('нет страниц');
      const png = await fsp.readFile(path.join(tmpDir, files[0]));
      fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      reply.header('Cache-Control', 'private, max-age=60');
      return reply.type('image/png').send(png);
    } catch (e) {
      fastify.log.warn('[preview] render failed: ' + e.message);
      return reply.code(415).send({ error: 'Не удалось построить превью', hint: 'откройте оригинал' });
    }
  });

  fastify.get('/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const { rows } = await db.query('SELECT * FROM payment_invoices WHERE id=$1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const pay = rows[0];
    // Доступ к карточке: автор заявки, директора, бухгалтерия, ADMIN (V411).
    // Раньше карточку мог открыть любой авторизованный — теперь по принадлежности.
    const r = String(req.user.role || '');
    const isPriv = ['ADMIN', 'BUH', 'PROC', 'HEAD_PM', 'HEAD_TO'].includes(r) || /^DIRECTOR/.test(r);
    if (!isPriv && Number(pay.created_by) !== Number(req.user.id)) {
      return reply.code(403).send({ error: 'Нет доступа к этой заявке' });
    }
    // 17.10: «от кого счёт» + связь с реестром/поставщиком — бухгалтеру и директору
    // нужно видеть больше: кто инициатор, что за счёт, реквизиты контрагента.
    const out = decoratePayment(rows[0]);
    try {
      if (rows[0].created_by) {
        const u = await db.query(`SELECT name, role FROM users WHERE id=$1`, [rows[0].created_by]);
        out.initiator_name = u.rows[0] ? u.rows[0].name : null;
        out.initiator_role = u.rows[0] ? u.rows[0].role : null;
      }
      if (rows[0].supplier_id) {
        const s = await db.query(`SELECT inn, kpp, ogrn, phone, email, address, bik, bank_name, rs, ks FROM suppliers WHERE id=$1`, [rows[0].supplier_id]);
        out.supplier = s.rows[0] || null;
      }
      if (rows[0].doc_registry_id) {
        const d = await db.query(`SELECT id, invoice_number, invoice_date, counterparty_inn, sf_basis, service_done_at, payment_kind FROM doc_registry WHERE id=$1`, [rows[0].doc_registry_id]);
        out.registry_doc = d.rows[0] || null;
      }
      // Название привязанной работы — модалка инициатора показывает, что уже выбрано.
      if (rows[0].work_id) {
        const w = await db.query(`SELECT id, work_title, object_name, city, address FROM works WHERE id=$1`, [rows[0].work_id]);
        if (w.rows[0]) {
          out.work_label = w.rows[0].work_title || w.rows[0].object_name || ('Работа #' + w.rows[0].id);
          out.work_obj = w.rows[0];
        }
      }
    } catch (_) { /* доп. данные не критичны */ }
    return out;
  });

  /**
   * Поиск работ (объектов) для выбора вручную — когда автоподбор не сработал.
   * Заказчик 18.10.2026: «показывать инициатору список работ на выбор — да».
   *
   * ВАЖНО: объявлен ДО `/:id`, иначе Fastify примет «work-search» за id.
   * Если передан `hint` (подсказка из счёта) — работаем тем же сопоставителем
   * (`matchWork`), что и авто-привязка: он вернёт либо единственную работу,
   * либо список кандидатов с оценкой. Это гарантирует, что ручной выбор и
   * автопривязка видят ОДНИ и те же варианты.
   */
  fastify.get('/work-search', { preHandler: [fastify.authenticate] }, async (req) => {
    const q = String((req.query && req.query.q) || '').trim();
    const hint = String((req.query && req.query.hint) || '').trim();
    const limit = Math.min(parseInt((req.query && req.query.limit) || '20', 10) || 20, 50);
    const { matchWork } = require('../services/contract-match');
    const map = (w) => {
      // D-332b (заказчик 21.10.2026): «откуда эти работы? почему пропал
      // нормальный список?». Часть работ получила мусорное `work_title` от
      // ТОР-парсера: «Сроки работ: 2026-10-16 — 2026-10-18\n\nОбъём: 0.03 м³\n\n
      // Пасивация маслопровода». В списке выбора это нечитаемо.
      // Берём ПОСЛЕДНЮЮ содержательную строку (там и есть суть работы).
      const clean = (v) => {
        const raw = String(v || '');
        if (!raw) return '';
        const parts = raw.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
        const meaningful = parts.filter((x) => !/^(сроки работ|объём|объем|стоимость|итого)\s*[:\-]/i.test(x));
        const pick = meaningful.length ? meaningful[meaningful.length - 1] : raw;
        return pick.replace(/\s+/g, ' ').trim();
      };
      const title = clean(w.work_title);
      const obj = clean(w.object_name);
      // object_name часто = город в нижнем регистре («краснодар») — это НЕ
      // название. Предпочитаем work_title; объект — только если он содержательный.
      const objLooksLikeName = obj.length >= 12 || /[А-ЯЁA-Z]/.test(obj.slice(0, 1));
      return {
        id: w.id,
        label: title || (objLooksLikeName ? obj : '') || ('Работа #' + w.id),
        object_name: obj || null,
        address: w.address || w.object_address || null,
        city: w.city || null,
        customer: w.customer_name || null,
        status: w.work_status || null,
        score: w._score != null ? w._score : undefined
      };
    };

    // 1. Подсказка из счёта: используем тот же движок, что и авто-привязка.
    if (hint) {
      const m = await matchWork(db, hint).catch(() => ({ found: false, candidates: [] }));
      const cands = m.found ? [m.work, ...(m.candidates || [])] : (m.candidates || []);
      if (cands.length) {
        return {
          items: cands.map(map),
          suggested_id: m.found && m.work ? m.work.id : null,
          reason: m.reason
        };
      }
      // Ничего похожего — падаем в обычный поиск по строке подсказки.
      q2Search(hint.replace(/^объект[а-яё]*\s*[:\-—]?\s*/i, '').trim());
    }
    // 2. Свободный поиск по строке.
    const { rows } = await q2Search(q, limit);
    return { items: rows.map(map), suggested_id: null };

    async function q2Search(term, lim = limit) {
      const t = String(term || '').trim();
      const params = [];
      let where = 'deleted_at IS NULL';
      if (t) {
        params.push('%' + t + '%');
        where += ` AND (work_title ILIKE $1 OR object_name ILIKE $1 OR address ILIKE $1
                   OR object_address ILIKE $1 OR customer_name ILIKE $1 OR city ILIKE $1 OR work_number ILIKE $1)`;
      }
      const r = await db.query(
        `SELECT id, work_title, object_name, address, object_address, city, customer_name, work_status
           FROM works WHERE ${where}
          ORDER BY (work_status = 'active') DESC NULLS LAST, id DESC
          LIMIT ${lim}`, params
      ).catch(() => ({ rows: [] }));
      return r;
    }
  });

  /**
   * Привязать объект (работу) к заявке — когда автоподбор не сработал.
   * Заказчик (18.10.2026): показывать инициатору список работ на выбор.
   * Права: инициатор заявки, PROC/TO/PROC-пул или привилегированные роли.
   * Менять можно только до решения директора (awaiting_dir): после согласования
   * объект влияет на расходы — там уже нельзя молча перевешивать.
   */
  fastify.post('/:id/work', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const b = req.body || {};
    const { rows } = await db.query('SELECT * FROM payment_invoices WHERE id=$1', [id]);
    const pay = rows[0];
    if (!pay) return reply.code(404).send({ error: 'Не найдено' });
    const r = String(req.user.role || '');
    const isOwner = Number(pay.created_by) === Number(req.user.id);
    const isPriv = ['ADMIN', 'BUH', 'PROC', 'HEAD_PM', 'HEAD_TO'].includes(r) || /^DIRECTOR/.test(r);
    if (!isOwner && !isPriv) return reply.code(403).send({ error: 'Привязать объект может инициатор счёта или закупки' });
    if (pay.status !== 'awaiting_dir') {
      return reply.code(409).send({ error: 'Счёт уже рассмотрен директором — объект не меняем', status: pay.status });
    }
    const workId = b.work_id == null || b.work_id === '' ? null : parseInt(b.work_id, 10);
    if (workId != null && !Number.isFinite(workId)) return reply.code(400).send({ error: 'Неверный work_id' });
    if (workId != null) {
      const w = await db.query('SELECT id, work_title, object_name FROM works WHERE id=$1 AND deleted_at IS NULL', [workId]);
      if (!w.rows[0]) return reply.code(404).send({ error: 'Объект не найден' });
    }
    const { rows: upd } = await db.query(
      `UPDATE payment_invoices SET work_id=$2, updated_at=NOW() WHERE id=$1 RETURNING *`, [id, workId]);
    // Синхронизируем карточку реестра (иначе расход по объекту не создастся).
    if (pay.doc_registry_id) {
      await db.query(`UPDATE doc_registry SET work_id=$2, updated_at=NOW() WHERE id=$1`, [pay.doc_registry_id, workId]).catch(() => {});
    }
    return { ok: true, work_id: upd[0].work_id, payment: decoratePayment(upd[0]) };
  });

  /**
   * V410 (заказчик 19.10.2026): переназначить ОТВЕТСТВЕННОГО за счёт.
   * Зачем: счета шлют десятки сотрудников с разных (в т.ч. личных) почт. Если
   * отправитель не опознан — заявка висит на офис-менеджере (Тумаевой), и она
   * ставит верного сотрудника ОДНИМ действием. При этом почта отправителя
   * ЗАПОМИНАЕТСЯ как алиас (user_email_aliases) — следующее письмо с неё
   * подтянет владельца само, без ручной работы.
   * Права: офис-менеджер, ADMIN, директора, бухгалтерия.
   */
  fastify.post('/:id/owner', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const r = String(req.user.role || '');
    const canReassign = ['ADMIN', 'BUH', 'OFFICE_MANAGER', 'PROC'].includes(r) || /^DIRECTOR/.test(r);
    if (!canReassign) return reply.code(403).send({ error: 'Переназначить ответственного может офис-менеджер, бухгалтерия или директор' });
    const newOwnerId = parseInt((req.body && req.body.user_id), 10);
    if (!Number.isFinite(newOwnerId)) return reply.code(400).send({ error: 'Неверный user_id' });
    const u = await db.query('SELECT id, name, role FROM users WHERE id=$1', [newOwnerId]);
    if (!u.rows[0]) return reply.code(404).send({ error: 'Пользователь не найден' });

    const { rows } = await db.query('SELECT * FROM payment_invoices WHERE id=$1', [id]);
    const pay = rows[0];
    if (!pay) return reply.code(404).send({ error: 'Не найдено' });
    const prevOwner = pay.created_by;

    await db.query('UPDATE payment_invoices SET created_by=$2, updated_at=NOW() WHERE id=$1', [id, newOwnerId]);
    if (pay.doc_registry_id) {
      await db.query('UPDATE doc_registry SET doc_owner_id=$2, created_by=$2, updated_by=$2, updated_at=NOW() WHERE id=$1',
        [pay.doc_registry_id, newOwnerId]).catch(() => {});
    }

    // Выучить алиас: почта отправителя письма → назначенный сотрудник.
    // Д-3 (верификатор 19.10.2026): НЕ перезаписываем достоверные привязки.
    // Учим ТОЛЬКО когда адрес ни в users.email, ни в employees.email не найден
    // (иначе подделанный `From` навсегда перевесит живого владельца корп. адреса).
    // И только INSERT — существующую запись не трогаем (DO NOTHING).
    let learned = null;
    try {
      const src = pay.source_email_id
        ? (await db.query('SELECT from_email FROM emails WHERE id=$1', [pay.source_email_id])).rows[0]
        : null;
      if (src && src.from_email) {
        const m = String(src.from_email).match(/<([^>]+)>/);
        const addr = String((m ? m[1] : src.from_email)).trim().toLowerCase();
        if (addr.includes('@')) {
          const known = await db.query(
            `SELECT 1 FROM users WHERE lower(email)=$1 AND is_active IS NOT FALSE
             UNION ALL
             SELECT 1 FROM employees e JOIN users u ON u.id=e.user_id
              WHERE lower(e.email)=$1 AND u.is_active IS NOT FALSE
             LIMIT 1`, [addr]);
          if (!known.rows.length) {
            const ins = await db.query(
              `INSERT INTO user_email_aliases(email, user_id, source, label, created_by)
               VALUES($1,$2,'learned',$3,$4)
               ON CONFLICT (lower(email)) DO NOTHING
               RETURNING id`,
              [addr, newOwnerId, u.rows[0].name || null, req.user.id]).catch(() => ({ rows: [] }));
            if (ins.rows && ins.rows.length) learned = addr;
          }
        }
      }
    } catch (_) { /* алиас — не блокер */ }

    // Уведомить нового ответственного и офис-менеджера (кто и что перевесил).
    try {
      const { createNotification } = require('../services/notify');
      Promise.resolve(createNotification(db, {
        user_id: newOwnerId,
        title: `Счёт #${id}: вы назначены ответственным`,
        message: `${pay.supplier_name || ''} — ${pay.amount || ''}`,
        type: 'payment_invoice_owner_changed',
        link: `#/my-procurement`
      })).catch(() => {});
      if (prevOwner && Number(prevOwner) !== Number(req.user.id)) {
        Promise.resolve(createNotification(db, {
          user_id: prevOwner,
          title: `Счёт #${id}: ответственный изменён`,
          message: `Теперь за счёт отвечает ${u.rows[0].name || ('#' + newOwnerId)}`,
          type: 'payment_invoice_owner_changed',
          link: `#/my-procurement`
        })).catch(() => {});
      }
    } catch (_) { /* уведомления не критичны */ }

    return { ok: true, owner_id: newOwnerId, prev_owner_id: prevOwner, learned_alias: learned };
  });

  // Auth-gated file stream
  fastify.get('/:id/file', { preHandler: [fastify.requireRoles(FILE_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const { rows } = await db.query('SELECT file_path, file_name, created_by, status, pay_timing, payment_status FROM payment_invoices WHERE id=$1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    // D-226/#4 (21.09, независимый верификатор): право на ФАЙЛ не шире права видеть САМ счёт.
    // Раньше файл раздавался широкому списку ролей (в т.ч. PM), хотя очередь директора им
    // отдаёт 403 — то есть роль, которой счёт не виден, могла выкачать его реквизиты.
    // Разрешаем: директор/бухгалтер/ADMIN (решают и платят), инициатор счёта, либо роль из FILE_ROLES
    // только если счёт в публичной очереди (ждёт решения/оплаты) — т.е. реально «виден» в своём разделе.
    const r = String(req.user.role || '');
    const isDir = DIR_ROLES.includes(r);
    const isBuh = BUH_ROLES.includes(r);
    const isOwner = Number(rows[0].created_by) === Number(req.user.id);
    const visible = rows[0].status === 'awaiting_dir' || rows[0].payment_status === 'pending_payment';
    if (!isDir && !isBuh && !isOwner && !(FILE_ROLES.includes(r) && visible)) {
      return reply.code(403).send({ error: 'Нет доступа к файлу счёта' });
    }
    const fsPath = uploadFsPath(rows[0].file_path);
    if (!fsPath || !fs.existsSync(fsPath)) {
      return reply.code(404).send({ error: 'Файл счёта не найден на диске' });
    }
    const name = rows[0].file_name || path.basename(fsPath);
    // D-220 (20.09): тип — по расширению РЕАЛЬНОГО файла на диске (а не по имени из БД),
    // неизвестное/исполняемое → attachment/octet-stream. Иначе `.html` исполнялся inline.
    const ext = path.extname(fsPath).toLowerCase();
    const { safeContentType } = require('../lib/upload-ext');
    const ct = safeContentType(ext, null);
    reply.header('Content-Type', ct);
    if (ct === 'application/octet-stream') {
      reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    } else {
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    }
    return reply.send(fs.createReadStream(fsPath));
  });

  // Standalone create (ТО / закупщик)
  fastify.post('/', { preHandler: [fastify.requireRoles(CREATE_ROLES)] }, async (req, reply) => {
    const b = req.body || {};
    const amount = num(b.amount);
    // V412: разрешаем создать карточку с нулевой суммой, когда есть ФАЙЛ.
    // Это потоковая загрузка (модалка партии): файл загружен → карточка создана →
    // OCR заполнит сумму. Раньше требовалось amount>0, и загрузка падала.
    const allowZeroAmount = !!(b.file_path || b.file_name);
    if (amount <= 0 && !(b.line_items && b.line_items.length) && !allowZeroAmount) {
      return reply.code(400).send({ error: 'Укажите сумму или позиции' });
    }
    const filePath = normalizeUploadUrl(b.file_path);
    if (!filePath) {
      return reply.code(400).send({ error: 'Прикрепите файл счёта' });
    }
    if (!(b.supplier_name || b.supplier_id)) {
      // V412: при потоковой загрузке поставщик ещё не распознан — ставим заглушку,
      // OCR заменит её. Иначе загрузка падала бы на пустом поле.
      if (!allowZeroAmount) return reply.code(400).send({ error: 'Укажите поставщика' });
      b.supplier_name = 'Распознаётся…';
    }
    const lines = Array.isArray(b.line_items) ? b.line_items : [];
    const sum = amount > 0 ? amount : lines.reduce((s, l) => s + num(l.unit_price) * num(l.qty || l.quantity || 1), 0);
    const timing = b.pay_timing === 'deferred' ? 'deferred' : 'immediate';
    // V404: автоподбор договора-основания из реестра + объект/работа.
    // Заказчик: «договора в счёте нет в CRM — как подсветится?» → помечаем
    // contract_missing, договор молча НЕ создаём.
    let contractId = b.contract_id || null;
    let contractMissing = false;
    if (!contractId && b.contract_basis_number) {
      try {
        const { matchContract, matchWork } = require('../services/contract-match');
        const cm = await matchContract(db, { number: b.contract_basis_number, counterpartyName: b.supplier_name });
        if (cm.found) contractId = cm.contract.id; else contractMissing = true;
        if (!b.work_id && b.work_hint) {
          const wm = await matchWork(db, b.work_hint);
          if (wm.found) b.work_id = wm.work.id;
        }
      } catch (e) { fastify.log.warn('[payment-invoices] contract match: ' + e.message); }
    }
    const { rows } = await db.query(
      `INSERT INTO payment_invoices(
         status, supplier_name, supplier_id, amount, due_date, file_path, file_name,
         basis_type, basis_text, work_id, contract_id, line_items_json, requires_payment, created_by, pay_timing,
         contract_basis_number, contract_missing, work_hint, invoice_number, invoice_date,
         draft_updated_at
       ) VALUES(
         'draft', $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11::jsonb, true, $12, $13,
         $14, $15, $16, $17, $18,
         NOW()
       ) RETURNING *`,
      [
        b.supplier_name || null,
        b.supplier_id || null,
        sum,
        b.due_date || null,
        filePath,
        b.file_name || null,
        b.basis_type || 'other',
        b.basis_text || null,
        b.work_id || null,
        contractId,
        JSON.stringify(lines),
        req.user.id,
        timing,
        b.contract_basis_number || null,
        contractMissing,
        b.work_hint || null,
        b.invoice_number || null,
        b.invoice_date || null
      ]
    );
    const pay = rows[0];
    // D-322 (заказчик 21.10.2026): «когда человек на вкладке согласования
    // отправляет заявку — должен добавить поставщика, если такого нет».
    // Если поставщик не выбран из справочника, а имя/ИНН есть — находим или
    // заводим карточку сразу, иначе в платёжке не будет реквизитов.
    if (!pay.supplier_id) {
      try {
        const { ensureSupplier } = require('../services/supplier-resolve');
        const dcOwn = require('../services/doc-classifier');
        const ownInnStr2 = await dcOwn.ownInn(db).catch(() => '');
        const sup = await ensureSupplier(db, {
          inn: b.counterparty_inn || null,
          counterparty_name: b.supplier_name || null
        }, { ownInn: ownInnStr2, createdBy: req.user.id });
        if (sup.id) {
          await db.query('UPDATE payment_invoices SET supplier_id=$2, updated_at=NOW() WHERE id=$1', [pay.id, sup.id]);
          pay.supplier_id = sup.id;
          if (sup.created) fastify.log.info(`[payment-invoices] заведён поставщик #${sup.id} «${b.supplier_name}»`);
        }
      } catch (e) {
        fastify.log.warn('[payment-invoices] ensureSupplier on create: ' + (e && e.message));
      }
    }
    // D-316 (заказчик 20.10.2026): «почему я закрыл и вышел, а счета ушли
    // директору без подтверждения?». Здесь РАНЬШЕ было:
    //   • stampExpiry() — TTL согласования 72ч
    //   • paymentMail.sendDirectorMail() — письмо директору
    //   • createNotification() — уведомления всем директорам
    // То есть загрузка файла == отправка директору, а кнопка «Отправить»
    // была бутафорией. Теперь карточка создаётся ЧЕРНОВИКОМ (status='draft'):
    // ни письма, ни TTL, ни уведомлений. Отправка — POST /:id/submit после
    // явного подтверждения пользователя.
    try {
      await enrichCatalogFromLines(db, {
        lines: lines.length ? lines : [],
        supplierName: pay.supplier_name,
        supplierId: pay.supplier_id,
        userId: req.user.id,
        source: 'quote',
        headerAmount: lines.length ? 0 : sum,
        headerLabel: pay.basis_text || `Счёт #${pay.id}`
      });
    } catch (e) {
      fastify.log.warn('[payment-invoices] catalog enrich: ' + e.message);
    }

    // D-320 (заказчик 21.10.2026): «что за "Распознаётся…"? Если счёт не успел
    // распознаться до отправки — распознавать в фоне и добирать данные, а не
    // показывать его сырым».
    //
    // Раньше карточка с файлом создавалась с заглушкой «Распознаётся…»/0 ₽, и
    // если инициатор сразу нажимал «Отправить», директор видел мусор в очереди.
    // Теперь OCR+разбор запускаются СРАЗУ после создания (не блокируя ответ) и
    // добирают поставщика, ИНН, сумму, номер, дату, срок и объект.
    // Отправка директору без ключевых полей блокируется отдельно (см. /submit).
    if (!b.supplier_name || b.supplier_name === 'Распознаётся…' || !(sum > 0)) {
      scheduleRecognize(fastify, pay.id);
    }
    return { ...decoratePayment(pay), mail: { sent: false, reason: 'draft' }, recognizing: true };
  });

  /**
   * D-320: фоновое распознавание только что загруженного счёта.
   * Не блокирует HTTP-ответ, ошибки не ломают создание карточки.
   * Идемпотентно: повторный запуск перезаписывает только «пустые»/заглушечные поля.
   */
  function scheduleRecognize(fastify, paymentId) {
    const run = async () => {
      try {
        await recognizeAndFill(db, fastify.log, paymentId);
      } catch (e) {
        fastify.log.warn('[payment-invoices] background recognize #' + paymentId + ': ' + (e && e.message));
      }
    };
    // setImmediate: ответ уходит пользователю первым, OCR — после.
    if (typeof setImmediate === 'function') setImmediate(() => { run(); });
    else setTimeout(() => { run(); }, 0);
  }

  /**
   * Распознать файл заявки и добрать данные. Используется и в фоне, и из
   * POST /:id/recognize (кнопка «Распознать заново»).
   * @returns {Promise<{ok:boolean, fields?:object, reason?:string}>}
   */
  async function recognizeAndFill(db, log, paymentId) {
    const pay = (await db.query('SELECT * FROM payment_invoices WHERE id=$1', [paymentId])).rows[0];
    if (!pay) return { ok: false, reason: 'not_found' };
    if (!pay.file_path) return { ok: false, reason: 'no_file' };

    // Текст файла: тот же конвейер, что у почтового intake (PDF → OCR/слой, картинки → OCR).
    let text = '';
    try {
      const nodePath = require('node:path');
      const fs = require('fs');
      const baseUploads = nodePath.resolve(process.env.UPLOAD_DIR || process.env.UPLOADS_DIR || nodePath.join(process.cwd(), 'uploads'));
      // D-320: путь бывает абсолютным (/uploads/…), относительным (uploads/…) или
      // без префикса — пробуем все варианты, иначе файл «не находится».
      const rawPath = String(pay.file_path || '');
      const rel = rawPath.replace(/^\/?uploads\//i, '').replace(/^[\\/]+/, '');
      const candidates = [
        rawPath,
        nodePath.join(process.cwd(), rawPath.replace(/^\/+/, '')),
        nodePath.join(baseUploads, rel),
        nodePath.join(process.cwd(), 'public', rawPath.replace(/^\/+/, ''))
      ];
      const full = candidates.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
      if (!full) return { ok: false, reason: 'file_missing' };
      const ocr = require('../services/pdf-ocr');
      const mime = String(pay.file_name || '').toLowerCase();
      if (/\.pdf$/i.test(mime) || /pdf/i.test(mime)) {
        const res = await ocr.ocrPdfPath(full, pay.file_name);
        text = (res && res.text) || '';
      } else if (/\.(png|jpe?g|webp)$/i.test(mime)) {
        const res = await ocr.ocrImageBuffer(fs.readFileSync(full), 'image/jpeg', pay.file_name);
        text = (res && res.text) || '';
      } else {
        return { ok: false, reason: 'unsupported_type' };
      }
    } catch (e) {
      return { ok: false, reason: 'ocr_error: ' + (e && e.message) };
    }
    if (!String(text).trim()) return { ok: false, reason: 'no_text' };

    // Тип документа: наше исходящее письмо счётом не считаем (D-319).
    const dc = require('../services/doc-classifier');
    const ownInnStr = await dc.ownInn(db).catch(() => '');
    const cls = dc.classifyDocument(text, { ownInn: ownInnStr });
    if (cls.kind === 'letter') {
      // Помечаем карточку: это не счёт. Отправлять директору её нельзя.
      await db.query(
        `UPDATE payment_invoices SET supplier_name=COALESCE(NULLIF(supplier_name,'Распознаётся…'),
            'Документ без счёта (письмо)'), updated_at=NOW() WHERE id=$1`, [paymentId]);
      return { ok: false, reason: 'not_invoice', kind: cls.kind, fields: {} };
    }

    const { extractInvoice } = require('../services/invoice-extract');
    let parsed = extractInvoice(text, { ownInn: ownInnStr });
    // ИИ-разбор — как в почтовом intake (основной путь), если доступен.
    try {
      const aiEx = require('../services/invoice-ai-extract');
      const ai = await aiEx.extractByAI(text, { db });
      if (ai && ai.ok && ai.data) {
        const merged = aiEx.mergeWithRegex(ai.data, parsed);
        parsed = merged.parsed;
      }
    } catch (_) { /* регулярки уже дали что смогли */ }

    // Добираем ТОЛЬКО пустые/заглушечные поля: ручные правки не затираем.
    const isStub = !pay.supplier_name || pay.supplier_name === 'Распознаётся…';
    const patch = [];
    const vals = [];
    const setIf = (col, val, cast) => {
      if (val == null || val === '') return;
      vals.push(val);
      patch.push(`${col}=$${vals.length}${cast || ''}`);
    };
    if (isStub && parsed.counterparty_name) setIf('supplier_name', parsed.counterparty_name);
    if (!(Number(pay.amount) > 0) && parsed.amount_gross != null) setIf('amount', parsed.amount_gross, '::numeric');
    if (!pay.invoice_number && parsed.invoice_number) setIf('invoice_number', parsed.invoice_number);
    if (!pay.invoice_date && parsed.invoice_date) setIf('invoice_date', parsed.invoice_date, '::date');
    if (!pay.due_date && parsed.payment_due_at) setIf('due_date', parsed.payment_due_at, '::date');
    if (pay.vat_amount == null && parsed.vat_amount != null) setIf('vat_amount', parsed.vat_amount, '::numeric');
    if (pay.vat_rate == null && parsed.vat_rate != null) setIf('vat_rate', parsed.vat_rate, '::numeric');
    if (pay.amount_net == null && parsed.amount_net != null) setIf('amount_net', parsed.amount_net, '::numeric');
    if (!pay.contract_basis_number && parsed.contract_basis && parsed.contract_basis.number) {
      setIf('contract_basis_number', parsed.contract_basis.number);
    }
    if (!pay.work_hint && parsed.work_hint) setIf('work_hint', parsed.work_hint);

    // Поставщик по ИНН (если он есть и это не наш ИНН — D-319).
    // D-322 (заказчик 21.10.2026): «если поставщика нет — пусть он заводит
    // карточку сам». Раньше при отсутствии карточки supplier_id оставался пуст,
    // и в платёжке не было реквизитов (бухгалтерия вбивала руками). Теперь
    // создаём карточку из распознанных реквизитов счёта.
    if (parsed.inn && String(parsed.inn) !== String(ownInnStr || '')) {
      try {
        const { ensureSupplier } = require('../services/supplier-resolve');
        const sup = await ensureSupplier(db, parsed, { ownInn: ownInnStr, createdBy: pay.created_by });
        if (sup.id && !pay.supplier_id) setIf('supplier_id', sup.id, '::int');
        if (sup.created) log?.info?.(`[recognize] #${paymentId}: заведён поставщик #${sup.id} «${parsed.counterparty_name}»`);
      } catch (e) {
        log?.warn?.('[payment-invoices] ensureSupplier: ' + (e && e.message));
      }
    }

    // Объект и договор — тем же сопоставителем, что в intake.
    try {
      const { matchWork, matchContract } = require('../services/contract-match');
      const hint = pay.work_hint || parsed.work_hint;
      if (!pay.work_id && hint) {
        const wm = await matchWork(hint);
        if (wm.found && wm.work) setIf('work_id', wm.work.id, '::int');
      }
      const cnum = pay.contract_basis_number || (parsed.contract_basis && parsed.contract_basis.number);
      if (!pay.contract_id && cnum) {
        const cm = await matchContract(db, {
          number: cnum,
          counterpartyInn: parsed.inn,
          counterpartyName: parsed.counterparty_name || pay.supplier_name
        });
        if (cm.found && cm.contract) setIf('contract_id', cm.contract.id, '::int');
      }
    } catch (_) { /* не критично */ }

    if (patch.length) {
      vals.push(paymentId);
      await db.query(`UPDATE payment_invoices SET ${patch.join(', ')}, updated_at=NOW() WHERE id=$${vals.length}`, vals);
    }
    log?.info?.(`[recognize] #${paymentId}: обновлено полей ${patch.length}, текст ${String(text).length} симв.`);
    return { ok: true, fields: parsed, updated: patch.length, engine: parsed._ai_used ? 'ai' : 'regex' };
  }

  /**
   * D-316: отправить черновик (или пачку черновиков) директору.
   * Единственная точка, где уходит письмо. Явное действие пользователя.
   */
  fastify.post('/submit', { preHandler: [fastify.requireRoles(CREATE_ROLES)] }, async (req, reply) => {
    const b = req.body || {};
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map((x) => parseInt(x, 10)).filter(Number.isFinite);
    if (!ids.length) return reply.code(400).send({ error: 'Передайте id или ids — что отправлять' });
    const role = String(req.user.role || '');
    const isPriv = ['ADMIN', 'BUH', 'PROC'].includes(role) || /^DIRECTOR/.test(role);
    // Только свои черновики (или привилегированные роли).
    const found = await db.query(
      `SELECT * FROM payment_invoices
        WHERE id = ANY($1::int[]) AND ($2::bool OR created_by = $3)`,
      [ids, isPriv, req.user.id]
    );
    if (!found.rows.length) return reply.code(404).send({ error: 'Черновики не найдены' });

    const submitted = [];
    const skipped = [];
    const recognizing = [];
    for (const pay of found.rows) {
      if (pay.status !== 'draft') { skipped.push({ id: pay.id, reason: 'not_draft' }); continue; }
      // Без файла директору отправлять нечего — это была ошибка UX, а не смысл.
      if (!pay.file_path && !pay.file_name && !(Array.isArray(pay.line_items_json) && pay.line_items_json.length)) {
        skipped.push({ id: pay.id, reason: 'no_file' });
        continue;
      }
      // D-320 (заказчик 21.10.2026): не показывать директору «Распознаётся…» и 0 ₽.
      // Если ключевые поля пусты — НЕ отправляем, а сначала распознаём в фоне.
      // Директор получает только счёт с поставщиком и суммой.
      const stub = !pay.supplier_name || pay.supplier_name === 'Распознаётся…' || !(Number(pay.amount) > 0);
      if (stub) {
        scheduleRecognize(fastify, pay.id);
        recognizing.push(pay.id);
        skipped.push({ id: pay.id, reason: 'recognizing' });
        continue;
      }
      await db.query(
        `UPDATE payment_invoices
            SET status='awaiting_dir', submitted_at=NOW(), updated_at=NOW()
          WHERE id=$1 AND status='draft'`, [pay.id]);
      try { await stampExpiry(db, pay.id); } catch (_) { /* не критично */ }
      // D-317: расписание эскалации — первое напоминание через 12 ч без решения.
      try {
        const esc = require('../services/approval-escalation');
        await esc.scheduleForInvoice(db, pay.id);
      } catch (_) { /* расписание не должно ломать отправку */ }
      submitted.push(pay.id);
    }

    // Письмо: одно на партию (директору удобнее), как и раньше.
    let mail = { sent: false, reason: 'nothing_to_send' };
    if (submitted.length) {
      try {
        mail = submitted.length > 1
          ? await paymentMail.sendDirectorMailBatch(db, submitted)
          : await paymentMail.sendDirectorMail(db, submitted[0]);
      } catch (e) {
        fastify.log.warn('[payment-invoices] submit mail: ' + e.message);
        mail = { sent: false, reason: 'mail_error', error: e.message };
      }
      const dirs = await db.query(`SELECT id FROM users WHERE role IN('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active=true`);
      const agg = await db.query(
        `SELECT COALESCE(SUM(amount),0)::numeric AS total, count(*)::int AS n,
                string_agg(DISTINCT COALESCE(supplier_name,'поставщик'), ', ') AS sups
           FROM payment_invoices WHERE id = ANY($1::int[])`, [submitted]);
      const a = agg.rows[0] || { total: 0, n: 0, sups: '' };
      for (const d of dirs.rows) {
        try {
          await createNotification(db, {
            user_id: d.id,
            title: submitted.length > 1
              ? `Счета к согласованию: ${a.n} шт.`
              : `Счёт #${submitted[0]} к согласованию`,
            message: `${a.total} ₽ · ${a.sups || 'поставщик'}`,
            type: 'payment',
            link: submitted.length > 1
              ? `#/payment-invoices?batch=${submitted[0]}`
              : `#/payment-invoices?id=${submitted[0]}`
          });
        } catch (_) { /* уведомление не критично */ }
      }
    }
    return {
      ok: submitted.length > 0, submitted, skipped, mail,
      // D-320: эти счёта распознаются в фоне — отправятся, когда появятся
      // поставщик и сумма (пользователю показываем «распознаём, подождите»).
      recognizing
    };
  });

  /**
   * D-316: сохранить правки черновика (без отправки).
   * Раньше PATCH-роута не было ВООБЩЕ — модалка партии звала PATCH
   * `/api/payment-invoices/:id` с намерением «сохранить правки», получала 404,
   * а ошибку глотала `.catch(() => {})`. Пользователь правил сумму/поставщика
   * «успешно», а в базу уходило распознанное.
   */
  fastify.patch('/:id', { preHandler: [fastify.requireRoles(CREATE_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const b = req.body || {};
    const { rows } = await db.query('SELECT * FROM payment_invoices WHERE id=$1', [id]);
    const pay = rows[0];
    if (!pay) return reply.code(404).send({ error: 'Счёт не найден' });
    const role = String(req.user.role || '');
    const isPriv = ['ADMIN', 'BUH', 'PROC'].includes(role) || /^DIRECTOR/.test(role);
    if (!isPriv && Number(pay.created_by) !== Number(req.user.id)) {
      return reply.code(403).send({ error: 'Можно править только свои счета' });
    }
    // Правим ТОЛЬКО черновик: согласованный счёт — через корректировку, чтобы
    // не переписать то, что директор уже видел и подписал.
    if (pay.status !== 'draft') {
      return reply.code(409).send({
        error: 'Счёт уже отправлен — правка недоступна',
        hint: 'Согласованный счёт меняется через корректировку у бухгалтерии.'
      });
    }

    const FIELDS = ['amount', 'supplier_name', 'supplier_id', 'invoice_number', 'invoice_date',
      'due_date', 'vat_amount', 'vat_rate', 'amount_net', 'basis_type', 'basis_text',
      'contract_basis_number', 'work_id', 'work_hint', 'pay_timing', 'comment_text',
      'file_path', 'file_name', 'contract_id'];    const sets = [];
    const params = [];
    for (const k of FIELDS) {
      if (b[k] === undefined) continue;
      params.push(b[k]);
      const cast = (k === 'invoice_date' || k === 'due_date') ? '::date'
        : (k === 'amount' || k === 'vat_amount' || k === 'vat_rate' || k === 'amount_net') ? '::numeric'
          : (k === 'supplier_id' || k === 'work_id' || k === 'contract_id') ? '::int' : '';
      sets.push(`${k}=$${params.length}${cast}`);
    }
    if (!sets.length) return decoratePayment(pay);
    params.push(id);
    const upd = await db.query(
      `UPDATE payment_invoices SET ${sets.join(', ')}, draft_updated_at=NOW(), updated_at=NOW()
        WHERE id=$${params.length} AND status='draft' RETURNING *`, params);
    return decoratePayment(upd.rows[0]);
  });

  /** D-316: удалить черновик (только свой и только неотправленный). */
  fastify.delete('/:id', { preHandler: [fastify.requireRoles(CREATE_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const { rows } = await db.query('SELECT id, status, created_by FROM payment_invoices WHERE id=$1', [id]);
    const pay = rows[0];
    if (!pay) return reply.code(404).send({ error: 'Счёт не найден' });
    const role = String(req.user.role || '');
    const isPriv = ['ADMIN', 'BUH', 'PROC'].includes(role) || /^DIRECTOR/.test(role);
    if (!isPriv && Number(pay.created_by) !== Number(req.user.id)) {
      return reply.code(403).send({ error: 'Можно удалять только свои счета' });
    }
    if (pay.status !== 'draft') {
      return reply.code(409).send({
        error: 'Счёт уже отправлен — удалить нельзя',
        hint: 'Отправленный счёт можно только отклонить решением директора.'
      });
    }
    await db.query('DELETE FROM payment_invoices WHERE id=$1 AND status=$2', [id, 'draft']);
    return { ok: true, deleted: id };
  });

  /** D-316: мои черновики — «сохранил, вышел, вернулся». */
  fastify.get('/drafts', { preHandler: [fastify.authenticate] }, async (req) => {
    const role = String(req.user.role || '');
    const isPriv = ['ADMIN', 'BUH', 'PROC'].includes(role) || /^DIRECTOR/.test(role);
    const showAll = String((req.query && req.query.all) || '') === '1' && isPriv;
    const { rows } = await db.query(
      `SELECT pi.*, u.name AS initiator_name
         FROM payment_invoices pi LEFT JOIN users u ON u.id=pi.created_by
        WHERE pi.status='draft' ${showAll ? '' : 'AND pi.created_by=$1'}
        ORDER BY pi.draft_updated_at DESC NULLS LAST, pi.id DESC LIMIT 200`,
      showAll ? [] : [req.user.id]);
    return { items: rows.map(decoratePayment) };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // V411: ПАРТИЯ счетов на согласование (заказчик 19.10.2026).
  // «10 счетов — 10 заявок или одна?» → ОДНА заявка (партия), но директор решает
  // по КАЖДОМУ счёту выборочно. Статус по счёту живёт в payment_invoices.status,
  // поэтому «часть согласовал, часть отклонил» работает бесплатно.
  // ═══════════════════════════════════════════════════════════════════════════

  /** Создать партию из N счетов (уже загруженных, суммы могут быть 0 до OCR). */
  fastify.post('/batches', { preHandler: [fastify.requireRoles(CREATE_ROLES)] }, async (req, reply) => {
    const b = req.body || {};
    const ids = Array.isArray(b.invoice_ids) ? b.invoice_ids.map((x) => parseInt(x, 10)).filter(Number.isFinite) : [];
    if (!ids.length) return reply.code(400).send({ error: 'Передайте invoice_ids — счета для партии' });
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Проверяем, что счета существуют и принадлежат отправителю (или он привилегированный).
      const role = String(req.user.role || '');
      const isPriv = ['ADMIN', 'BUH', 'PROC'].includes(role) || /^DIRECTOR/.test(role);
      const own = await client.query(
        `SELECT id, amount FROM payment_invoices
          WHERE id = ANY($1::int[]) AND ($2::bool OR created_by = $3)`,
        [ids, isPriv, req.user.id]);
      if (!own.rows.length) return reply.code(404).send({ error: 'Счета не найдены' });
      const total = own.rows.reduce((s, r) => s + Number(r.amount || 0), 0);
      const ttl = await db.query(`SELECT value_json FROM settings WHERE key='doc_approval_ttl_hours' LIMIT 1`).catch(() => ({ rows: [] }));
      let hours = 72;
      if (ttl.rows[0]) { try { hours = parseInt(JSON.parse(ttl.rows[0].value_json), 10) || 72; } catch (_) {} }
      const batch = (await client.query(
        `INSERT INTO payment_batches(created_by, title, comment_text, total_amount, invoices_count, expires_at)
         VALUES($1,$2,$3,$4,$5, NOW() + ($6 || ' hours')::interval) RETURNING *`,
        [req.user.id, b.title || null, b.comment_text || null, total, own.rows.length, String(hours)])).rows[0];
      await client.query(
        `UPDATE payment_invoices SET batch_id=$1, updated_at=NOW()
          WHERE id = ANY($2::int[]) AND batch_id IS NULL`,
        [batch.id, own.rows.map((r) => r.id)]);
      await client.query('COMMIT');
      return { ok: true, batch, invoice_ids: own.rows.map((r) => r.id) };
    } catch (e) {
      await client.query('ROLLBACK');
      fastify.log.error('[payment-invoices] batch create: ' + e.message);
      return reply.code(500).send({ error: 'Не удалось создать партию' });
    } finally {
      client.release();
    }
  });

  /** Партия целиком: шапка + все счета с их статусами (экран директора/бухгалтера). */
  fastify.get('/batches/:id', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const b = (await db.query(
      `SELECT b.*, u.name AS initiator_name, u.role AS initiator_role
         FROM payment_batches b LEFT JOIN users u ON u.id = b.created_by WHERE b.id=$1`, [id])).rows[0];
    if (!b) return reply.code(404).send({ error: 'Партия не найдена' });
    const r = String(req.user.role || '');
    const isPriv = ['ADMIN', 'BUH', 'PROC'].includes(r) || /^DIRECTOR/.test(r);
    if (!isPriv && Number(b.created_by) !== Number(req.user.id)) {
      return reply.code(403).send({ error: 'Нет доступа к партии' });
    }
    const items = (await db.query(
      `SELECT pi.*, d.counterparty_inn, d.work_id AS reg_work_id, w.work_title
         FROM payment_invoices pi
         LEFT JOIN doc_registry d ON d.id = pi.doc_registry_id
         LEFT JOIN works w ON w.id = d.work_id
        WHERE pi.batch_id=$1 ORDER BY pi.id`, [id])).rows;
    // Сводка решений: сколько уже согласовано/отклонено (для индикатора выборочности).
    const summary = {
      total: items.length,
      approved: items.filter((x) => x.status === 'pending_payment' || x.payment_status === 'paid').length,
      rejected: items.filter((x) => x.status === 'rejected').length,
      pending: items.filter((x) => x.status === 'awaiting_dir').length
    };
    return { batch: b, items: items.map(decoratePayment), summary };
  });

  /**
   * ВЫБОРОЧНОЕ решение директора по партии: { approve: [id], reject: [id], comment }.
   * Счета вне списков остаются awaiting_dir (директор решит позже).
   */
  fastify.post('/batches/:id/decide', { preHandler: [fastify.requireRoles(DIR_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const b = req.body || {};
    const toArr = (v) => (Array.isArray(v) ? v.map((x) => parseInt(x, 10)).filter(Number.isFinite) : []);
    const approveIds = toArr(b.approve);
    const rejectIds = toArr(b.reject);
    if (!approveIds.length && !rejectIds.length) {
      return reply.code(400).send({ error: 'Отметьте счета: approve[] и/или reject[]' });
    }
    const batch = (await db.query('SELECT * FROM payment_batches WHERE id=$1', [id])).rows[0];
    if (!batch) return reply.code(404).send({ error: 'Партия не найдена' });
    const timing = b.pay_timing === 'deferred' ? 'deferred' : 'immediate';
    const actor = { id: req.user.id, name: req.user.name || 'Директор', role: req.user.role };
    const { applyDecision } = require('../services/payment-mail');
    const dbp = { query: (t, p) => db.query(t, p), pool: db, connect: () => db.connect() };
    const done = { approved: [], rejected: [], skipped: [] };
    for (const pid of approveIds) {
      const pay = (await db.query('SELECT * FROM payment_invoices WHERE id=$1 AND batch_id=$2', [pid, id])).rows[0];
      if (!pay || pay.status !== 'awaiting_dir') { done.skipped.push(pid); continue; }
      try {
        // Применяем как обычное согласование директора — единая логика (расходы, реестр, бух).
        await db.query(`UPDATE payment_invoices SET pay_timing=$2 WHERE id=$1`, [pid, timing]);
        const res = await applyDecision(dbp, pay, 'approve', actor);
        if (res && res.status === 'pending_payment') done.approved.push(pid); else done.skipped.push(pid);
      } catch (e) { fastify.log.error('[batch decide approve] ' + e.message); done.skipped.push(pid); }
    }
    for (const pid of rejectIds) {
      const pay = (await db.query('SELECT * FROM payment_invoices WHERE id=$1 AND batch_id=$2', [pid, id])).rows[0];
      if (!pay || pay.status !== 'awaiting_dir') { done.skipped.push(pid); continue; }
      try {
        await applyDecision(dbp, pay, 'reject', actor);
        done.rejected.push(pid);
      } catch (e) { fastify.log.error('[batch decide reject] ' + e.message); done.skipped.push(pid); }
    }
    // Пересчитываем статус партии по факту решений по счетам.
    const after = (await db.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status='awaiting_dir')::int AS pending,
         count(*) FILTER (WHERE status='pending_payment' OR payment_status='paid')::int AS approved,
         count(*) FILTER (WHERE status='rejected')::int AS rejected
       FROM payment_invoices WHERE batch_id=$1`, [id])).rows[0];
    let bstatus = 'awaiting_dir';
    if (after.pending === 0) {
      if (after.approved && after.rejected) bstatus = 'mixed';
      else if (after.approved) bstatus = 'approved';
      else bstatus = 'rejected';
    } else if (after.approved || after.rejected) {
      bstatus = 'partially_approved';
    }
    // D-308: касты обязательны. $2 связан дважды (SET status=$2 и CASE-сравнение),
    // поэтому без ::text Postgres падал на 42P08 «inconsistent types deduced for
    // parameter $2» (text vs varchar). Ошибка пряталась в .catch(()=>{}) — партии
    // счетов молча не обновлялись: status и dir_approved_by оставались прежними.
    try {
      await db.query(
        `UPDATE payment_batches SET status=$2::varchar,
                dir_approved_at=CASE WHEN $2::text <> 'awaiting_dir' THEN NOW() ELSE NULL END,
                dir_approved_by=CASE WHEN $2::text <> 'awaiting_dir' THEN $3::int ELSE NULL END,
                updated_at=NOW()
          WHERE id=$1`, [id, bstatus, req.user.id]);
    } catch (err) {
      req.log.error({ err, batchId: id }, '[payment-batches] статус партии не обновлён');
      throw err;
    }
    return { ok: true, batch_status: bstatus, ...done, summary: after };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // V411: ПРЕВЬЮ и РАСПОЗНАВАНИЕ загруженного счёта (заказчик 19.10.2026).
  // «Превью недоступно — скачайте или откройте. Надо видеть что загрузил».
  // «Хочу видеть загрузку 0-100%, когда 100% — счёт распознан».
  // Решение: PDF рендерим в PNG первой страницы (стабильно в любом браузере),
  // распознаём тем же OCR-контуром, что и почта — единая логика.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Распознать загруженный счёт и вернуть ПОЛЯ для автозаполнения формы
   * (номер/дата/сумма/НДС/поставщик/договор/срок/позиции).
   * Не создаёт заявку — только разбор: фронт подставляет значения, человек правит.
   */
  fastify.post('/:id/recognize', { preHandler: [fastify.requireRoles(CREATE_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Неверный ID' });
    const row = (await db.query('SELECT id, file_path, file_name, status, created_by FROM payment_invoices WHERE id=$1', [id])).rows[0];
    if (!row) return reply.code(404).send({ error: 'Счёт не найден' });
    if (!row.file_path) return reply.code(400).send({ error: 'Файл не приложен' });
    try {
      const { uploadFsPath } = require('../utils/upload-url');
      const ocr = require('../services/pdf-ocr');
      // file_path хранится как «/uploads/payment-invoices/...» → нужен абсолютный путь.
      const full = uploadFsPath(row.file_path);
      if (!full || !fs.existsSync(full)) return reply.code(404).send({ error: 'Файл не найден', path: row.file_path });
      let text = '';
      if (/\.pdf$/i.test(full)) {
        const r = await ocr.ocrPdfPath(full, row.file_name || 'invoice.pdf');
        text = (r && r.text) || '';
      } else {
        const buf = await fsp.readFile(full);
        const mime = /\.png$/i.test(full) ? 'image/png' : 'image/jpeg';
        const r = await ocr.ocrImageBuffer(buf, mime, row.file_name || 'invoice.jpg');
        text = (r && r.text) || '';
      }
      // ИИ-разбор (основной путь) + фолбэк на регулярки — тот же контур, что у почты.
      const { extractInvoice } = require('../services/invoice-extract');
      const aiEx = require('../services/invoice-ai-extract');
      let parsed = extractInvoice(text || '');
      let aiUsed = false;
      try {
        const ai = await aiEx.extractByAI(text || '');
        if (ai && ai.ok && ai.data) {
          parsed = aiEx.mergeWithRegex(ai.data, parsed).parsed;
          aiUsed = true;
        }
      } catch (_) { /* фолбэк на регулярки */ }
      // Обновляем счёт распознанными полями (сумма/№/дата/НДС), НЕ трогая ручные правки
      // статуса. Человек всё равно может поправить через PATCH.
      try {
        await db.query(
          `UPDATE payment_invoices SET
             amount = COALESCE(NULLIF($2,0), amount),
             supplier_name = COALESCE(NULLIF($3,''), supplier_name),
             invoice_number = COALESCE(NULLIF($4,''), invoice_number),
             invoice_date = COALESCE($5::date, invoice_date),
             due_date = COALESCE($6::date, due_date),
             vat_amount = COALESCE($7, vat_amount),
             vat_rate = COALESCE($9, vat_rate),
             amount_net = COALESCE($10, amount_net),
             contract_basis_number = COALESCE(NULLIF($8,''), contract_basis_number),
             updated_at = NOW()
           WHERE id=$1`,
          [id, parsed.amount_gross || 0, parsed.counterparty_name || '',
            parsed.invoice_number || '', parsed.invoice_date || null,
            parsed.payment_due_at || null, parsed.vat_amount != null ? parsed.vat_amount : null,
            (parsed.contract_basis && parsed.contract_basis.number) || '',
            parsed.vat_rate != null ? parsed.vat_rate : null,
            parsed.amount_net != null ? parsed.amount_net : null]).catch(() => {});
      } catch (_) { /* запись полей — не блокер */ }
      return {
        ok: true,
        engine: aiUsed ? 'ai' : 'regex',
        confidence: parsed.confidence || 0,
        fields: {
          supplier_name: parsed.counterparty_name || null,
          inn: parsed.inn || null,
          kpp: parsed.kpp || null,
          amount: parsed.amount_gross || null,
          amount_net: parsed.amount_net || null,
          vat_amount: parsed.vat_amount != null ? parsed.vat_amount : null,
          vat_rate: parsed.vat_rate != null ? parsed.vat_rate : null,
          has_vat: parsed.has_vat,
          invoice_number: parsed.invoice_number || null,
          invoice_date: parsed.invoice_date || null,
          payment_due_at: parsed.payment_due_at || null,
          contract_number: (parsed.contract_basis && parsed.contract_basis.number) || null,
          bank_name: parsed.bank_name || null,
          bik: parsed.bik || null,
          rs: parsed.rs || null,
          ks: parsed.ks || null,
          lines: Array.isArray(parsed.lines) ? parsed.lines : []
        },
        text_preview: (text || '').slice(0, 1200)
      };
    } catch (e) {
      fastify.log.error('[recognize] #' + id + ' ' + (e && e.stack ? e.stack.slice(0, 400) : e.message));
      return reply.code(500).send({ error: 'Не удалось распознать', detail: String((e && e.message) || e).slice(0, 200) });
    }
  });

  // multipart upload file for standalone
  fastify.post('/upload', { preHandler: [fastify.requireRoles(CREATE_ROLES)] }, async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'Нет файла' });
    const dir = await ensureUploadDir();
    // D-220 (20.09): расширение из белого списка (MIME → каноничный ext), а не из имени клиента.
    // `uploads/payment-invoices/*` раздаётся статикой → `.html` исполнялся в домене CRM.
    const { safeStoredExt } = require('../lib/upload-ext');
    const ext = safeStoredExt(data.mimetype, data.filename, { allow: 'doc' });
    if (!ext) return reply.code(415).send({ error: 'Недопустимый тип файла' });
    const stem = String(data.filename || 'invoice').replace(/[^\w.\-а-яА-ЯёЁ]+/gi, '_').replace(/\.[^.]*$/, '').slice(0, 110) || 'invoice';
    const fname = `${Date.now()}_${stem}${ext}`;
    const full = path.join(dir, fname);
    await fsp.writeFile(full, await data.toBuffer());
    const file_path = normalizeUploadUrl(`uploads/payment-invoices/${fname}`);
    return { file_path, file_name: data.filename || fname };
  });

  // Director can set pay_timing on approve
  fastify.post('/:id/dir-approve', { preHandler: [fastify.requireRoles(DIR_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return reply.code(404).send({ error: 'Не найдено' });
    const { rows } = await db.query('SELECT * FROM payment_invoices WHERE id=$1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    if (rows[0].status !== 'awaiting_dir') return reply.code(409).send({ error: 'Счёт не на согласовании директора' });
    const timing = (req.body && req.body.pay_timing) || rows[0].pay_timing;
    if (timing === 'deferred' || timing === 'immediate') {
      await db.query(`UPDATE payment_invoices SET pay_timing=$2, updated_at=NOW() WHERE id=$1`, [id, timing]);
      rows[0].pay_timing = timing;
    }
    // D1 (21.09): комментарий директора сохраняем — он летит в письмо/аудит и объясняет решение.
    const dirComment = req.body && typeof req.body.comment === 'string' ? req.body.comment.trim().slice(0, 1000) : '';
    if (dirComment) {
      await db.query(`UPDATE payment_invoices SET dir_comment=$2, updated_at=NOW() WHERE id=$1`, [id, dirComment]);
      rows[0].dir_comment = dirComment;
    }
    const result = await paymentMail.applyDecision(db, rows[0], 'approve', req.user);
    return result;
  });

  fastify.post('/:id/dir-reject', { preHandler: [fastify.requireRoles(DIR_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return reply.code(404).send({ error: 'Не найдено' });
    const { rows } = await db.query('SELECT * FROM payment_invoices WHERE id=$1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    if (rows[0].status !== 'awaiting_dir') return reply.code(409).send({ error: 'Счёт не на согласовании директора' });
    // D1 (21.09): комментарий при возврате — иначе инициатор не понимает, что исправить.
    const dirComment = req.body && typeof req.body.comment === 'string' ? req.body.comment.trim().slice(0, 1000) : '';
    if (dirComment) {
      await db.query(`UPDATE payment_invoices SET dir_comment=$2, updated_at=NOW() WHERE id=$1`, [id, dirComment]);
      rows[0].dir_comment = dirComment;
    }
    const result = await paymentMail.applyDecision(db, rows[0], 'reject', req.user);
    return result;
  });

  // BUH pay with optional payment slip
  fastify.post('/:id/pay-bank', { preHandler: [fastify.requireRoles(BUH_ROLES)] }, async (req, reply) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return reply.code(404).send({ error: 'Не найдено' });
    const { rows } = await db.query('SELECT * FROM payment_invoices WHERE id=$1', [id]);
    if (!rows[0]) return reply.code(404).send({ error: 'Не найдено' });
    const pay = rows[0];
    if (pay.payment_status !== 'pending_payment') {
      return reply.code(409).send({ error: 'Счёт не в очереди оплаты' });
    }
    const comment = (req.body && req.body.comment) || null;
    const documentId = (req.body && req.body.document_id) || null;
    const skipPp = !!(req.body && req.body.skip_pp);
    // V401: № и дата платёжного поручения — бухгалтерия вводит при оплате.
    const ppNumber = (req.body && req.body.pp_number) ? String(req.body.pp_number).slice(0, 40) : null;
    const ppDate = (req.body && req.body.pp_date) ? String(req.body.pp_date).slice(0, 10) : null;
    if (!documentId && !skipPp && !(req.body && req.body.allow_no_pp)) {
      // soft: still allow if comment explains; UI should send skip_pp
    }
    // V401: снимок реквизитов получателя на момент оплаты (для истории/повторов).
    let payeeRequisites = null;
    try {
      const d = await db.query(
        `SELECT COALESCE(pi.supplier_name, d.counterparty_name) AS name,
                COALESCE(s.inn, d.counterparty_inn) AS inn, s.kpp, s.bik, s.bank_name, s.rs, s.ks
           FROM payment_invoices pi
           LEFT JOIN doc_registry d ON d.id = pi.doc_registry_id
           LEFT JOIN suppliers s ON s.id = pi.supplier_id
          WHERE pi.id = $1`, [id]);
      if (d.rows[0]) payeeRequisites = d.rows[0];
    } catch (_) { /* реквизиты не критичны для оплаты */ }
    const upd = await db.query(
      `UPDATE payment_invoices SET
         status='paid', payment_method='bank_transfer', payment_status='paid',
         payment_comment=$1, payment_doc_id=$2, buh_id=$3, buh_acted_at=NOW(),
         pp_number=COALESCE($5, pp_number), pp_date=COALESCE($6::date, pp_date),
         payee_requisites=COALESCE($7::jsonb, payee_requisites), updated_at=NOW()
       WHERE id=$4 AND payment_status='pending_payment'`,
      [comment, documentId, req.user.id, id, ppNumber, ppDate, payeeRequisites ? JSON.stringify(payeeRequisites) : null]
    );
    // S5: побочные эффекты (расход, карточка Doc Hub, уведомления) — ТОЛЬКО при
    // реальном переходе. Иначе 8 параллельных запросов плодят дубли.
    if (!upd.rowCount) return { success: true, already: true, status: 'paid' };
    await afterPaid(db, pay);
    if (pay.created_by && pay.created_by !== req.user.id) {
      createNotification(db, {
        user_id: pay.created_by,
        title: `Счёт #${id} оплачен`,
        message: comment || 'Оплата через ПП',
        type: 'payment',
        link: pay.procurement_id ? `#/procurement?id=${pay.procurement_id}` : `#/payment-invoices?id=${id}`
      });
    }
    return { success: true, status: 'paid' };
  });

  fastify.decorate('createPaymentInvoiceFromWave', async (opts) => {
    const pay = await createFromProcurementWave(db, opts);
    await db.query(
      `UPDATE procurement_invoice_imports SET approval_status='awaiting_dir', sent_to_dir_at=NOW() WHERE id=$1`,
      [opts.importId]
    );
    const mail = await paymentMail.sendDirectorMail(db, pay.id);
    const dirs = await db.query("SELECT id FROM users WHERE role IN('DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV') AND is_active=true");
    for (const d of dirs.rows) {
      createNotification(db, {
        user_id: d.id,
        title: `Счёт #${pay.id} к согласованию`,
        message: `${pay.amount} ₽ · заявка #${opts.procurementId}`,
        type: 'payment',
        link: `#/payment-invoices?id=${pay.id}`
      });
    }
    return { payment: decoratePayment(pay), mail };
  });

  routes.createFromProcurementWave = createFromProcurementWave;
  routes.afterPaid = afterPaid;
}

routes.createFromProcurementWave = createFromProcurementWave;
routes.afterPaid = afterPaid;
routes.sendDirectorMail = (db, id) => paymentMail.sendDirectorMail(db, id);
routes.normalizeUploadUrl = normalizeUploadUrl;

module.exports = routes;
