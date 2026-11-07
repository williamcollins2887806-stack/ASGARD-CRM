'use strict';

/**
 * src/services/obs-letter-registry.js
 *
 * V473: сохранение письма для оплаты через ОБС — ОДНОЙ транзакцией.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ.
 * Раньше генерация была размазана по роуту: PDF писался на диск, потом
 * вставлялась строка в `doc_registry`, потом обновлялся счёт. Если на любом
 * шаге что-то падало, оставались полуфабрикаты: письмо без счёта, счёт со
 * ссылкой на несуществующее письмо, «съеденный» исходящий номер.
 *
 * Теперь сохранение — атомарный сценарий:
 *   1. проверка строки и лимита договора;
 *   2. выдача исходящего номера (сквозная корреспондентская нумерация);
 *   3. рендер PDF + DOCX;
 *   4. `correspondence` — письмо в переписке (иначе ИСХ теряется: до V473
 *      9 писем лежали только в реестре счетов и в переписке отсутствовали);
 *   5. `documents` с `correspondence_id` — вложение переписки;
 *   6. `doc_registry` — строка письма (на неё ссылается `obs_letter_doc_id`);
 *   7. обновление счёта: контур `obs`, статус письма, ссылки.
 *
 * ПРЕДПРОСМОТР ЗДЕСЬ НЕ ЖИВЁТ. Он не должен ничего писать в БД и не должен
 * тратить номер — см. `renderObsLetterPdf` в obs-letter.js.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const obsLetter = require('./obs-letter');
const obsLetterDocx = require('./obs-letter-docx');
const correspondence = require('./correspondence');
const _shared = require('./letter/_shared');

const UPLOAD_ROOT = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');

function httpError(status, message, extra) {
  const e = new Error(message);
  e.statusCode = status;
  if (extra) Object.assign(e, extra);
  return e;
}

function money(n) {
  return Number(n || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/**
 * Проверить лимит существенности по договору.
 *
 * Лимит — условие договора, а не пожелание: письмо под него пишется. Если
 * остатка не хватает, письмо всё равно можно составить (бухгалтерия решает
 * сама), но мы обязаны сказать точно, сколько не хватает, — иначе человек
 * узнает об этом уже после оплаты.
 *
 * @returns {Promise<null|{number:string, limit:number, remaining:number, short_by:number}>}
 */
async function checkLimit(client, subcontractId, docId, amount) {
  if (!subcontractId) return null;
  const r = await client.query(
    `SELECT a.number, a.limit_amount, s.spent_amount, s.remaining, s.exhausted
       FROM subcontract_agreements a, subcontract_limit_state(a.id, $2) s
      WHERE a.id = $1`, [subcontractId, docId]);
  const row = r.rows[0];
  if (!row) return null;
  const remaining = Number(row.remaining) || 0;
  const limit = Number(row.limit_amount) || 0;
  if (remaining >= amount) return null;
  return {
    number: row.number,
    limit,
    remaining,
    short_by: Number((amount - remaining).toFixed(2)),
  };
}

/**
 * Записать письмо: PDF и DOCX — в uploads/doc-hub/obs-letters, копия PDF в
 * корень uploads для `documents` (этот путь отдаёт `/api/files/download/:name`,
 * как у всех существующих вложений переписки).
 *
 * @returns {{publicUrl:string, filePath:string, fileName:string, docxPath:string, docxName:string, size:number}}
 */
function writeLetterFiles(buffer, docxBuffer, baseName) {
  const dir = obsLetter.STORAGE_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const pdfName = `${baseName}.pdf`;
  const pdfPath = path.join(dir, pdfName);
  fs.writeFileSync(pdfPath, buffer);

  const docxName = `${baseName}.docx`;
  const docxPath = path.join(dir, docxName);
  try { fs.writeFileSync(docxPath, docxBuffer); } catch (_) { /* Word не критичен */ }

  // Копия для вложений переписки: `/api/files/download/<uuid>.pdf` умеет
  // отдавать только файлы из корня uploads (см. resolveStoredFilePath в
  // src/routes/files.js), поэтому вложению нужен собственный файл.
  const attachName = `${crypto.randomUUID()}.pdf`;
  const attachPath = path.join(UPLOAD_ROOT, attachName);
  fs.writeFileSync(attachPath, buffer);

  return {
    publicUrl: `${'/uploads/doc-hub/obs-letters'}/${encodeURIComponent(pdfName)}`,
    filePath: pdfPath,
    fileName: pdfName,
    docxPath,
    docxName,
    attachName,
    attachPath,
    size: buffer.length,
  };
}

/**
 * Сохранить письмо для ОБС.
 *
 * @param {object} db — fastify.db (есть .transaction)
 * @param {number} docId — строка doc_registry (счёт)
 * @param {object} payload — поля из модалки
 * @param {object} opts — { userId, force, onAudit }
 * @returns {Promise<{
 *   letter_doc_id:number, correspondence_id:number, number:string, date:string,
 *   file_url:string, attach_url:string, obs_account_id:number|null,
 *   subcontract_id:number|null, created:boolean, reused:boolean
 * }>}
 */
async function saveObsLetter(db, docId, payload, opts = {}) {
  const p = payload || {};
  const userId = opts.userId || null;

  // Внутренний клиент — когда мы уже внутри транзакции (recreate). Открывать
  // вторую нельзя: пул выдаст другое соединение, и оно встанет в блокировку
  // на строке, которую держит первая (D-397, FAIL верификатора 07.11.2026).
  const run = opts.internalClient
    ? (fn) => fn(opts.internalClient)
    : (fn) => db.transaction(fn);

  // D-397 (MINOR верификатора 07.11.2026): файлы пишутся ВНУТРИ транзакции,
  // до коммита. Если следующий шаг упадёт, на диске остались бы три сироты
  // (PDF, DOCX, uuid.pdf). Убираем их из catch: данные и так откатываются,
  // но диск не должен пухнуть от неудачных попыток.
  const createdFiles = [];
  const cleanupFiles = () => {
    for (const f of createdFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) { /* не критично */ }
    }
  };

  try {
    return await run(async (client) => {
    const found = await client.query(
      `SELECT d.*, pi.line_items_json AS pi_lines, pi.created_by AS pi_created_by
         FROM doc_registry d
         LEFT JOIN payment_invoices pi ON pi.id = d.payment_invoice_id
        WHERE d.id = $1 AND d.deleted_at IS NULL
        FOR UPDATE OF d`,
      [docId]);
    const doc = found.rows[0];
    if (!doc) throw httpError(404, 'Счёт не найден');

    // ── Идемпотентность. Повторный клик «Сохранить» не должен выпускать
    // второе письмо: иначе на один счёт будет два исходящих номера.
    if (!opts.force && doc.obs_letter_doc_id) {
      const live = await client.query(
        `SELECT id FROM doc_registry
          WHERE id=$1 AND deleted_at IS NULL AND package_type='letter'`, [doc.obs_letter_doc_id]);
      if (live.rows[0]) {
        const corr = await client.query(
          `SELECT id, number, date FROM correspondence
            WHERE obs_invoice_doc_id=$1 AND deleted_at IS NULL
            ORDER BY id DESC LIMIT 1`, [docId]);
        const c = corr.rows[0] || null;
        const att = await client.query(
          `SELECT attachments FROM doc_registry WHERE id=$1`, [doc.obs_letter_doc_id]);
        let url = null;
        try { url = (JSON.parse(att.rows[0].attachments || '[]')[0] || {}).url || null; } catch (_) { url = null; }
        return {
          letter_doc_id: doc.obs_letter_doc_id,
          correspondence_id: c ? c.id : null,
          number: c ? c.number : null,
          date: c ? c.date : null,
          file_url: url,
          attach_url: null,
          obs_account_id: doc.obs_account_id || null,
          subcontract_id: doc.subcontract_id || null,
          created: false,
          reused: true,
        };
      }
    }

    // ── Сумма. Письмо без суммы бессмысленно: это основание платежа.
    const amountFromPayload = p.amount_gross !== undefined && p.amount_gross !== null && p.amount_gross !== ''
      ? Number(p.amount_gross)
      : Number(doc.amount_gross);
    if (!Number.isFinite(amountFromPayload) || amountFromPayload <= 0) {
      throw httpError(400, 'Сумма счёта должна быть больше нуля', { field: 'amount_gross' });
    }

    // Договор, по которому пишется письмо. Человек без права менять договор
    // (не BUH) не может подставить произвольный: берём тот, что уже стоит в
    // карточке. Иначе получалось, что письмо ссылается на один договор, а
    // лимит расходуется по другому — и «недостача лимита» считалась бы не по
    // тому основанию.
    const canSetContourEarly = opts.canSetContour === true;
    let subcontractId;
    if (p.subcontract_id !== undefined && p.subcontract_id !== null && p.subcontract_id !== ''
        && canSetContourEarly) {
      subcontractId = Number(p.subcontract_id);
    } else {
      subcontractId = doc.subcontract_id || null;
    }

    const obsAccountId = p.obs_account_id !== undefined && p.obs_account_id !== null && p.obs_account_id !== ''
      ? Number(p.obs_account_id)
      : (doc.obs_account_id || null);

    // Если ОБС-счёт выбран — он должен существовать и быть активным.
    if (obsAccountId) {
      const oa = await client.query(
        'SELECT id FROM obs_accounts WHERE id=$1 AND is_active', [obsAccountId]);
      if (!oa.rows[0]) throw httpError(400, 'ОБС-счёт не найден или отключён', { field: 'obs_account_id' });
    }

    // ── Лимит существенности проверяем ДО выдачи номера: иначе на отказ
    // придётся «возвращать» номер, а дыр в нумерации быть не должно.
    const short = await checkLimit(client, subcontractId, docId, amountFromPayload);
    if (short) {
      throw httpError(409,
        `Лимита по договору ${short.number} не хватает на этот счёт: недостаёт ${money(short.short_by)} ₽`,
        { limit: short, field: 'subcontract_id' });
    }

    // ── Номер исходящего: сквозной, как у всей переписки.
    const letterDate = p.letter_date ? new Date(p.letter_date) : new Date();
    const allocation = await correspondence.allocateOutgoingNumber(client, {
      date: letterDate,
    });
    const number = allocation.number;

    // ── Данные и рендер. Рендерим внутри транзакции: если рендер упал,
    // номер вернётся вместе с откатом.
    const data = await obsLetter.buildLetterDataFromPayload(client, docId, Object.assign({}, p, {
      subcontract_id: subcontractId === null ? '' : subcontractId,
      obs_account_id: obsAccountId,
    }));

    const pdf = await obsLetter.renderObsLetterPdf(client, docId, Object.assign({}, p, {
      preview_number: number,
      letter_date: letterDate,
      subcontract_id: subcontractId === null ? '' : subcontractId,
      obs_account_id: obsAccountId,
      amount_gross: amountFromPayload,
    }), {});
    const docx = await obsLetter.renderObsLetterDocx(client, docId, Object.assign({}, p, {
      preview_number: number,
      letter_date: letterDate,
      subcontract_id: subcontractId === null ? '' : subcontractId,
      obs_account_id: obsAccountId,
      amount_gross: amountFromPayload,
    }), {});

    const safeNo = String(data.doc.invoice_number || docId)
      .replace(/[^\p{L}\p{N}-]+/gu, '_').slice(0, 40);
    const baseName = `ОБС_${safeNo}_${String(number).replace(/[^\w.-]+/g, '_')}`;
    const files = writeLetterFiles(pdf.buffer, docx, baseName);
    createdFiles.push(files.filePath, files.docxPath, files.attachPath);

    const gendir = await _shared.loadAsgardGendir(client);
    const signerSnapshot = {
      name: gendir.name,
      full_name: gendir.full_name,
      position: gendir.position,
      org: gendir.org,
      finalized_at: new Date().toISOString(),
      finalized_by: userId,
    };

    const counterparty = data.doc.counterparty_name || 'ОБС';
    const subject = `Письмо для оплаты через ОБС по счёту № ${data.doc.invoice_number || docId}`
      + (data.doc.counterparty_name ? ` (${data.doc.counterparty_name})` : '');

    // ── Письмо в переписке. Именно этого не хватало: ИСХ должен жить там,
    // где его ищут, — в реестре переписки, с номером и вложением.
    const corrIns = await client.query(
      `INSERT INTO correspondence (
         direction, date, number, doc_type, subject, body, content, counterparty,
         status, created_by, created_at, updated_at, work_id,
         letter_kind, doc_title, doc_sub,
         signer_snapshot, signature_on, stamp_on,
         signing_status, version_no, is_current, finalized_at,
         file_path, obs_account_id, obs_invoice_doc_id
       ) VALUES (
         'outgoing', $1::date, $2, 'letter', $3, $4, $4, $5,
         'sent', $6, NOW(), NOW(), $7,
         'obs_payment', $8, $9,
         $10::jsonb, true, true,
         'finalized', 1, true, NOW(),
         $11, $12, $13
       ) RETURNING id, number, date`,
      [
        letterDate.toISOString().slice(0, 10),
        number,
        subject,
        (obsLetter.buildLetterParagraphs
          ? obsLetter.buildLetterParagraphs(data, { number, dateText: pdf.dateText }).join('\n\n')
          : subject),
        counterparty,
        userId,
        doc.work_id || null,
        'Письмо для оплаты через ОБС',
        `по счёту № ${data.doc.invoice_number || 'б/н'}`
          + (data.doc.invoice_date ? ` от ${String(data.doc.invoice_date).slice(0, 10)}` : ''),
        JSON.stringify(signerSnapshot),
        files.publicUrl,
        obsAccountId,
        docId,
      ]
    );
    const corr = corrIns.rows[0];

    // ── Вложение переписки: свой файл в корне uploads, чтобы штатный
    // `/api/files/download/:name` его отдал (он не ходит по подкаталогам).
    await client.query(
      `INSERT INTO documents (
         filename, original_name, mime_type, size, type,
         work_id, correspondence_id, uploaded_by, download_url, created_at
       ) VALUES ($1, $2, 'application/pdf', $3, 'Письмо', $4, $5, $6, $7, NOW())`,
      [files.attachName, files.fileName, files.size, doc.work_id || null,
        corr.id, userId, `/api/files/download/${files.attachName}`]
    );

    // ── Строка письма в реестре документов. На неё ссылается obs_letter_doc_id,
    // из неё реестр берёт файл письма.
    const letterIns = await client.query(
      `INSERT INTO doc_registry (
         dir, package_type, ops_status, pay_status, counterparty_name,
         amount_gross, amount_net, vat_amount, vat_rate, has_vat,
         spend_kind, doc_owner_id, created_by, updated_by, receive_channel, comment_text,
         invoice_number, invoice_date, attachments, work_id,
         obs_account_id, subcontract_id, payment_source
       ) VALUES (
         'out','letter','done','n_a',$1,
         0,0,0,0,false,
         $2,$3,$4,$4,'manual',$5,
         $6,$7::date,$8::jsonb,$9,
         $10,$11,'obs'
       ) RETURNING id`,
      [
        counterparty,
        doc.spend_kind || 'other',
        doc.doc_owner_id || userId,
        userId,
        subject,
        `Исх. ${number}`,
        letterDate.toISOString().slice(0, 10),
        JSON.stringify([{ name: files.fileName, url: files.publicUrl, kind: 'obs_letter' }]),
        doc.work_id || null,
        obsAccountId,
        subcontractId,
      ]
    );
    const letterDocId = letterIns.rows[0].id;

    // ── Обновление счёта: контур, статус, ссылки.
    //
    // D-397 (FAIL верификатора 07.11.2026): `payment_source` и `subcontract_id`
    // здесь ставились БЕЗУСЛОВНО. А право создать письмо шире права менять
    // контур: PM/РП/грант тоже могут писать письмо — и через этот путь молча
    // переводили счёт на ОБС и меняли договор, обходя монополию бухгалтерии
    // (PATCH /payment-source и PATCH /subcontract разрешены только BUH).
    //
    // Правило: контур и договор пишем, если их меняет тот, кому это можно.
    // Флаг приходит из роута (он знает роль) — здесь второй проверки прав нет,
    // чтобы не расходились два источника истины.
    const canSetContour = opts.canSetContour === true;
    // Письмо по ОБС-счёту обязано перевести контур, иначе документ и учёт
    // расходятся: письмо есть, а расход считается «с расчётного» и лимит
    // договора его не видит. Это не ручное переключение (оно у бухгалтерии),
    // а следствие самого факта письма: без него состояние противоречиво.
    const setObs = canSetContour || opts.forceObsContour === true;

    // D-397c (FAIL третьего верификатора 07.11.2026): ДОГОВОР — отдельный флаг.
    // Раньше `subcontract_id` гейтился тем же `$6`, что и контур, а контур
    // теперь выставляется и без права (см. `setObs`). В итоге PM с грантом,
    // создав письмо, подставлял ЛЮБОЙ `subcontract_id` из payload в обход
    // `PATCH /:id/subcontract` (только BUH). Лимит существенности — условие
    // договора, а не свойство письма: менять его может только бухгалтерия.
    const setSubcontract = canSetContour;

    await client.query(
      `UPDATE doc_registry
          SET payment_source = CASE WHEN $6 THEN 'obs' ELSE payment_source END,
              obs_letter_status='ready',
              obs_letter_doc_id=$2,
              obs_letter_error=NULL,
              obs_account_id=$3,
              subcontract_id = CASE WHEN $7 THEN $4 ELSE subcontract_id END,
              updated_by=$5,
              updated_at=NOW()
        WHERE id=$1`,
      [docId, letterDocId, obsAccountId, subcontractId, userId, setObs, setSubcontract]);

    // ── Номер и дата счёта в карточке: если человек их поправил в модалке —
    // сохраняем, чтобы письмо и карточка не расходились. Пустые значения не
    // затирают то, что уже есть.
    const patch = [];
    const vals = [docId];
    if (p.invoice_number !== undefined && String(p.invoice_number || '').trim()) {
      vals.push(String(p.invoice_number).trim());
      patch.push(`invoice_number=$${vals.length}`);
    }
    if (p.invoice_date) {
      vals.push(p.invoice_date);
      patch.push(`invoice_date=$${vals.length}::date`);
    }
    if (p.amount_gross !== undefined && Number.isFinite(Number(p.amount_gross))) {
      vals.push(Number(p.amount_gross));
      patch.push(`amount_gross=$${vals.length}`);
    }
    if (patch.length) {
      await client.query(
        `UPDATE doc_registry SET ${patch.join(', ')}, updated_at=NOW() WHERE id=$1`, vals);
    }

    if (typeof opts.onAudit === 'function') {
      try {
        await opts.onAudit(client, docId, userId, 'obs_letter_saved', {
          letter_doc_id: letterDocId,
          correspondence_id: corr.id,
          number,
        });
      } catch (_) { /* аудит не должен ломать сохранение */ }
    }

    return {
      letter_doc_id: letterDocId,
      correspondence_id: corr.id,
      number,
      date: corr.date,
      file_url: files.publicUrl,
      attach_url: `/api/files/download/${files.attachName}`,
      obs_account_id: obsAccountId,
      subcontract_id: subcontractId,
      created: true,
      reused: false,
    };
    });
  } catch (e) {
    // Транзакция откатилась (или упал рендер) — файлы, успевшие лечь на диск,
    // больше никому не принадлежат. Убираем.
    cleanupFiles();
    throw e;
  }
}

/**
 * Пересоздать письмо: старое мягко удаляется (остаётся в переписке как
 * неактуальная редакция), новое выпускается с новым номером.
 *
 * Зачем: в письме могут оказаться неверные дата/сумма/перечень. Исправлять
 * файл на диске нельзя — исходящий документ с номером уже мог уйти. Поэтому
 * честная новая редакция.
 *
 * D-397 (FAIL верификатора 07.11.2026): здесь был ВЛОЖЕННЫЙ вызов
 * `saveObsLetter`, который сам открывает `db.transaction`. С реальным пулом
 * внешняя транзакция уже держала блокировку строки счёта, а внутренняя брала
 * `SELECT ... FOR UPDATE` ДРУГИМ соединением → взаимная блокировка на 30 с
 * (statement_timeout) и откат. Роут «Пересоздать» физически не работал.
 *
 * Теперь подготовка (гашение старого письма) и сохранение идут в ОДНОЙ
 * транзакции: `saveObsLetter` принимает уже открытого клиента.
 */
async function recreateObsLetter(db, docId, payload, opts = {}) {
  const p = payload || {};
  return db.transaction(async (client) => {
    const cur = await client.query(
      `SELECT id, obs_letter_doc_id FROM doc_registry WHERE id=$1 AND deleted_at IS NULL`,
      [docId]);
    const doc = cur.rows[0];
    if (!doc) throw httpError(404, 'Счёт не найден');

    if (doc.obs_letter_doc_id) {
      await client.query(
        `UPDATE doc_registry SET deleted_at=NOW(), updated_by=$2, updated_at=NOW()
          WHERE id=$1 AND deleted_at IS NULL`, [doc.obs_letter_doc_id, opts.userId || null]);
      await client.query(
        `UPDATE correspondence SET is_current=false, updated_at=NOW()
          WHERE obs_invoice_doc_id=$1 AND deleted_at IS NULL`, [docId]);
    }
    // Снимаем ссылки на прежнее письмо ДО сохранения — это часть той же
    // транзакции, поэтому промежуточное состояние наружу не видно.
    await client.query(
      `UPDATE doc_registry
          SET obs_letter_doc_id=NULL, obs_letter_status='none', updated_at=NOW()
        WHERE id=$1`, [docId]);

    // internalClient — уже открытая транзакция; saveObsLetter не открывает
    // вторую, а работает внутри этой.
    return saveObsLetter(db, docId, p, Object.assign({}, opts, {
      force: true,
      internalClient: client,
    }));
  });
}

module.exports = {
  saveObsLetter,
  recreateObsLetter,
  checkLimit,
  writeLetterFiles,
};
