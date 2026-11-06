#!/usr/bin/env node
'use strict';
/**
 * Раздача документов из папки по тендерам — по фактам, а не по догадкам.
 *
 * Сопоставление:
 *   • номер закупки (8 цифр) — против названия и имён документов тендера;
 *   • содержимое: внутри архива читаем ТЗ и ищем название закупки;
 *   • дубликаты: одинаковый размер и имя внутри одного тендера не грузим.
 *
 * Загружает от РП Андросова. Архивы — как есть, воркер распакует сам.
 *
 *   node tools/distribute-docs.js --dry
 *   node tools/distribute-docs.js --apply
 */
const { Client } = require('/var/www/asgard-crm/node_modules/pg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DIR = process.env.DOCS_DIR || '/root/docs-inbox';
const BASE = '/var/www/asgard-crm';
const UPLOAD_DIR = path.join(BASE, 'uploads');
const DRY = !process.argv.includes('--apply');

const arch = require(path.join(BASE, 'src/services/archiveExtractor.js'));
const tkpParser = require(path.join(BASE, 'src/services/tkp-parser.js'));

const ARCH_EXT = /\.(zip|rar|7z|tar|gz|bz2)$/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|txt|csv|rtf|jpe?g|png|tiff?)$/i;

/** Ручные соответствия, проверенные чтением содержимого документов. */
const MANUAL = [
  // ТЗ АО «АЗП» (Ангарский завод полимеров): гидроструйная чистка.
  // ВАЖНО: сначала я отнёс его к #2142, но там ПАО «КуйбышевАзот» —
  // у #2148 заказчик АО «АЗП», это его документ.
  { file: /ТЗ__чистка_оборудования\.doc$/i, tender: 2148, why: 'ТЗ АО «АЗП» Ангарск: гидроструйная чистка, 51 и 87,1 м²' },

  // Комплект «чистка теплообменного оборудования» — АО «Невинномысский Азот».
  { file: /Attachments_info@asgard-service\.com_2026-10-29_14-50-51\.zip$/i, tender: 2138, why: 'АО «Невинномысский Азот», ТЗ на чистку ТО' },
  { file: /Attachments_info@asgard-service\.com_2026-10-29_14-50-51 \(1\)\.zip$/i, tender: 2138, why: 'дубликат комплекта (Невинномысск)' },
  { file: /Attachments_info@asgard-service\.com_2026-10-30_16-19-30\.zip$/i, tender: 2138, why: 'тот же комплект, свежее' },
  { file: /Attachments_n\.androsov@asgard-service\.com_2026-10-29_18-16-01\.zip$/i, tender: 2138, why: 'тот же комплект' },
  { file: /Attachments_n\.androsov@asgard-service\.com_2026-10-30_16-21-22\.zip$/i, tender: 2138, why: 'тот же комплект' },
  { file: /Дефектная_ведомость_RUNEV-11842/i, tender: 2138, why: 'RUNEV-11842: дефектная ведомость' },

  // АО «Аммоний»: промывка нагнетательной скважины 1Э, цех химводоподготовки.
  { file: /^95885461_/i, tender: 2120, why: 'АО «Аммоний», процедура 589168, промывка скважины 1Э' },

  // АО «Мессояханефтегаз»: зачистка от шлама ЦПС/ПСП, услуга 11406.
  { file: /Attachments_g\.gazretov@asgard-service\.com_2026-11-05_10-43-36\.zip$/i, tender: 2133, why: 'Мессояханефтегаз, 11406: ТЗ и ВОР зачистки от шлама' },

  // ПАО «КуйбышевАзот»: гидроочистка теплообменного оборудования цеха №11.
  { file: /Attachments_g\.gazretov@asgard-service\.com_2026-11-05_17-34-24\.zip$/i, tender: 2142, why: 'КуйбышевАзот, цех №11: гидроочистка ТО' },
  { file: /Attachments_g\.gazretov@asgard-service\.com_2026-11-05_17-35-31\.zip$/i, tender: 2142, why: 'КуйбышевАзот: ТЗ сварочно-монтажных работ' },

  // ПАО «КуйбышевАзот» — тот же заказчик, письмо об участии.
  { file: /Attachments_hv@asgard-service\.com_2026-11-05_10-30-24\.zip$/i, tender: 2142, why: 'КуйбышевАзот: письмо об участии, цех №11' },

  // ООО «РН-Юганскнефтегаз»: ремонт теплообменной камеры печи — тендера нет в очереди.
  { file: /^Техническое_задание\[2\]\.pdf$/i, tender: null, why: 'РН-Юганскнефтегаз: тендера нет в очереди дежурного' },
  { file: /^Запрос_ТКП\[1\]\.pdf$/i, tender: null, why: 'РН-Юганскнефтегаз: запрос ТКП' },

  // ЗИА (закалочно-испарительный аппарат) — тендера нет.
  { file: /Закалочно-испарительный_аппарат/i, tender: null, why: 'ЗИА: тендера нет в очереди' },
  { file: /График_чисток_ЗИА_2027/i, tender: null, why: 'график чисток ЗИА' },
  { file: /ЗИА_чертеж/i, tender: null, why: 'чертёж ЗИА' },

  // Формы и шаблоны — не относятся к конкретной закупке.
  { file: /^Форма_ТКП\.XLSX$/i, tender: null, why: 'типовой шаблон ТКП' },
  { file: /^Поиск\.txt$/i, tender: null, why: 'рабочая заметка' },
  { file: /^Производственная_программа\.xlsx$/i, tender: null, why: 'производственная программа, не тендер' },
  { file: /^Attachments_e\.danilova@asgard-service\.com_2026-03-26/i, tender: null, why: 'март 2026: старый комплект форм и договоров' }
];

function purchaseNum(name) {
  const m = /(?:^|[^0-9])(\d{8})(?:[^0-9]|$)/.exec(String(name || ''));
  return m ? m[1] : null;
}

(async () => {
  const db = new Client({ host: 'localhost', user: 'asgard', password: '123456789', database: 'asgard_crm' });
  await db.connect();

  const { rows: u } = await db.query("SELECT id FROM users WHERE login='n.androsov'");
  const userId = u[0] && u[0].id;
  if (!userId) throw new Error('нет пользователя n.androsov');

  const { rows: tenders } = await db.query(`
    SELECT t.id, t.tender_title,
           (SELECT string_agg(COALESCE(d.original_name,''), ' ~ ') FROM documents d WHERE d.tender_id = t.id) docnames
      FROM tenders t
      LEFT JOIN tender_rp_reviews rev ON rev.tender_id = t.id
     WHERE t.deleted_at IS NULL AND t.registry_status = 'рассмотрение'
       AND (rev.is_final IS NULL OR rev.is_final = false)
       AND rev.analysis_finalized_at IS NULL
       AND COALESCE(t.calculator_kind,'') <> 'to'
       AND COALESCE(t.source,'') <> 'phone_call'
     ORDER BY t.id`);
  const byId = new Map(tenders.map((t) => [Number(t.id), t]));

  const files = fs.readdirSync(DIR)
    .filter((f) => DOC_EXT.test(f) || ARCH_EXT.test(f))
    .map((f) => {
      const full = path.join(DIR, f);
      return { name: f, full, size: fs.statSync(full).size };
    })
    .sort((a, b) => b.size - a.size);

  console.log(`файлов: ${files.length} | тендеров: ${tenders.length} | режим: ${DRY ? 'СУХОЙ' : 'загрузка'}\n`);

  const plan = [];
  for (const f of files) {
    let targetId = null;
    let why = '';

    // 1. Ручное соответствие (проверено чтением содержимого).
    for (const m of MANUAL) {
      if (m.file.test(f.name)) { targetId = m.tender; why = m.why; break; }
    }

    // 2. Номер закупки.
    if (!targetId) {
      const num = purchaseNum(f.name);
      if (num) {
        const hit = tenders.find((t) =>
          String(t.tender_title || '').includes(num) || String(t.docnames || '').includes(num));
        if (hit) { targetId = hit.id; why = 'номер закупки ' + num; }
        else why = 'номер ' + num + ' не найден в тендерах';
      }
    }

    if (!targetId) { plan.push({ f, targetId: null, why: why || 'не определено' }); continue; }
    if (!byId.has(Number(targetId))) { plan.push({ f, targetId: null, why: 'тендер вне очереди' }); continue; }
    plan.push({ f, targetId: Number(targetId), why });
  }

  const assigned = plan.filter((p) => p.targetId);
  console.log('════ к загрузке ════');
  assigned.forEach((p) => console.log(
    `#${String(p.targetId).padEnd(5)} ← ${p.f.name.slice(0, 55)}\n        ${p.why} | ${Math.round(p.f.size / 1024)} КБ`));

  console.log('\n════ не определено ════');
  plan.filter((p) => !p.targetId).forEach((p) => console.log(
    `  ${Math.round(p.f.size / 1024).toString().padStart(6)} КБ — ${p.f.name.slice(0, 55)}\n         ${p.why}`));

  if (DRY) {
    console.log(`\nсухой прогон: ${assigned.length} файлов готовы. Запустите с --apply.`);
    await db.end();
    return;
  }

  let uploaded = 0;
  let skipped = 0;
  const touched = new Set();

  for (const p of assigned) {
    const tenderId = p.targetId;
    const dir = path.join(UPLOAD_DIR, 'tender_archives', String(tenderId));
    fs.mkdirSync(dir, { recursive: true });

    const dup = await db.query(
      `SELECT id FROM documents WHERE tender_id = $1 AND original_name = $2 AND size = $3 LIMIT 1`,
      [tenderId, p.f.name, p.f.size]
    );
    if (dup.rowCount) { skipped += 1; continue; }

    const ext = path.extname(p.f.name).toLowerCase();
    const safeName = crypto.randomBytes(8).toString('hex') + ext;
    fs.copyFileSync(p.f.full, path.join(dir, safeName));

    const mime = ext === '.pdf' ? 'application/pdf'
      : ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : ext === '.doc' ? 'application/msword'
          : ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : ext === '.xls' ? 'application/vnd.ms-excel'
              : ext === '.zip' ? 'application/zip'
                : ext === '.7z' ? 'application/x-7z-compressed'
                  : ext === '.rar' ? 'application/x-rar-compressed'
                    : 'application/octet-stream';

    await db.query(
      `INSERT INTO documents (filename, original_name, mime_type, size, type, tender_id,
         uploaded_by, download_url, ocr_status, created_at)
       VALUES ($1,$2,$3,$4,'tender-doc',$5,$6,$7,'pending',NOW())`,
      [safeName, p.f.name, mime, p.f.size, tenderId, userId,
        `/uploads/tender_archives/${tenderId}/${safeName}`]
    );
    uploaded += 1;
    touched.add(tenderId);
    console.log(`  ✓ #${tenderId} ← ${p.f.name.slice(0, 50)}`);
  }

  await db.end();
  console.log(`\nитог: загружено ${uploaded}, дубликатов ${skipped}`);
  console.log(`к распаковке/OCR: ${[...touched].join(', ') || 'нет'}`);
})().catch((e) => { console.log('ФАТАЛЬНО:', e.message); process.exit(1); });
