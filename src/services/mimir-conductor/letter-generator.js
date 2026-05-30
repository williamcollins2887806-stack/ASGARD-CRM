/**
 * ASGARD CRM — Mimir Conductor: генератор официальных писем заказчику (Сессия 5, Шаг 5.1-5.2)
 * ═══════════════════════════════════════════════════════════════════════════
 * Превращает открытые уточнения канала CUSTOMER в официальное письмо-запрос
 * на разъяснения. Письмо рендерится в DOCX (OOXML через adm-zip) и PDF (pdfkit
 * + кириллический DejaVuSans). Внешних бинарей (libreoffice/unoconv) НЕ требует —
 * оба формата собираются в самом Node, чтобы работать и локально, и на сервере.
 *
 * Зависимости — только уже установленные: adm-zip, pdfkit. package.json НЕ трогаем.
 *
 * Группировка вопросов по темам (groupQuestionsByTopic) уважает stub-режим:
 * в dev (ключ stub-*) баланс НЕ тратится — формулировки берутся детерминированно.
 *
 * Артефакты на диск: storage/letters/<letter_number>.docx / .pdf
 * Запись в БД: mimir_customer_letters (status DRAFTED → пути docx_path/pdf_path).
 *
 * Реальная схема (проверено по information_schema):
 *   mimir_customer_letters(id, conductor_run_id, tender_id, letter_number,
 *     direction, subject_text, body_text, questions_ids[], docx_path, pdf_path,
 *     to_organization, to_person, to_email, status, drafted_at, ...)
 *   tenders(customer_name, customer_inn, inn, tender_title, tender_contact, ...)
 *   users(name, email, phone, login)
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const PDFDocument = require('pdfkit');

const db = require('../db');
const aiProvider = require('../ai-provider');
const cr = require('./conductor-run');
const { parseStrictJson } = require('./agents/_util');

// ─── Реквизиты отправителя (фирменный бланк ООО «Асгард Сервис») ───
const SENDER = {
  org: 'ООО «Асгард Сервис»',
  inn_kpp: 'ИНН/КПП: 6450078801/645001001',
  address: '410012, г. Саратов, ул. Большая Казачья, д. 1',
  phone: '+7 (8452) 00-00-00'
};

const LETTERS_DIR = path.join(process.cwd(), 'storage', 'letters');
const FONT_REGULAR = path.join(process.cwd(), 'public', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(process.cwd(), 'public', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

function ensureDir() {
  if (!fs.existsSync(LETTERS_DIR)) fs.mkdirSync(LETTERS_DIR, { recursive: true });
}

const RU_MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];
function formatRuDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getDate()} ${RU_MONTHS[dt.getMonth()]} ${dt.getFullYear()} г.`;
}
function addDays(d, n) {
  const dt = new Date(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

/**
 * Следующий исходящий номер письма: АС-ГГГГ-ММ/QNNN.
 * Счётчик — по числу уже существующих писем за текущий месяц.
 */
async function nextLetterNumber() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `АС-${yyyy}-${mm}`;
  let seq = 1;
  try {
    const r = await db.query(
      "SELECT COUNT(*)::int AS n FROM mimir_customer_letters WHERE letter_number LIKE $1",
      [`${prefix}/%`]
    );
    seq = (r.rows[0] ? r.rows[0].n : 0) + 1;
  } catch (_) { /* при ошибке стартуем с 1 */ }
  return `${prefix}/Q${String(seq).padStart(3, '0')}`;
}

/**
 * Сгруппировать/переформулировать вопросы по темам.
 * В stub-режиме — детерминированно (без расхода баланса).
 */
async function groupQuestionsByTopic(clars) {
  // Детерминированный фолбэк (stub или ошибка LLM).
  const fallback = () => clars.map((c, i) => ({
    number: i + 1,
    question_topic: topicOf(c),
    question_text: formalize(c.question_ru || '')
  }));

  if (aiProvider.isStubMode()) return fallback();

  const prompt = `Сгруппируй вопросы по темам и переформулируй каждый в формальный деловой язык.

${clars.map((c, i) => `Q${i + 1}. ${c.question_ru}`).join('\n\n')}

Верни СТРОГО JSON-массив:
[{ "number": 1, "question_topic": "По объёму работ", "question_text": "Просим уточнить ..." }]`;

  try {
    const result = await aiProvider.complete({
      system: 'Ты — деловой секретарь. Переводишь технические вопросы в формальные уважительные формулировки. Возвращаешь только JSON.',
      messages: [{ role: 'user', content: prompt }],
      model: 'sonnet-4-6',
      maxTokens: 4000
    });
    const parsed = parseStrictJson(result.text);
    if (Array.isArray(parsed) && parsed.length) return parsed;
    return fallback();
  } catch (_) {
    return fallback();
  }
}

/** Грубая эвристика темы вопроса по ключевым словам категории/текста. */
function topicOf(c) {
  const t = `${c.category || ''} ${c.question_ru || ''}`.toLowerCase();
  if (/объ[её]м|кол-?во|количеств|площад|метр/.test(t)) return 'По объёму работ';
  if (/чертеж|документ|пд|рд|схем/.test(t)) return 'По документации';
  if (/метод|способ|технолог/.test(t)) return 'По методу производства работ';
  if (/доступ|режим|пропуск|допуск|наряд/.test(t)) return 'По доступу и режиму объекта';
  if (/материал|давальч|поставк/.test(t)) return 'По материалам и поставкам';
  if (/срок|дат|график/.test(t)) return 'По срокам';
  return 'Прочие уточнения';
}

/** Минимальная «деловая» оболочка для технического вопроса. */
function formalize(q) {
  const trimmed = String(q || '').trim();
  if (!trimmed) return 'Просим предоставить разъяснения.';
  if (/^просим/i.test(trimmed)) return trimmed;
  return `Просим уточнить: ${trimmed}`;
}

// ─── Сборка контекста письма из БД ───
async function loadLetterContext(runId, pmUserId) {
  const run = await cr.getRun(runId);
  if (!run) throw new Error(`ConductorRun ${runId} не найден`);

  let tender = null;
  if (run.tender_id) {
    const tr = await db.query(
      `SELECT id, tender_title, customer_name, customer, customer_inn, inn, tender_contact
         FROM tenders WHERE id = $1`,
      [run.tender_id]
    );
    tender = tr.rows[0] || null;
  }

  let pm = null;
  if (pmUserId) {
    const ur = await db.query('SELECT id, name, email, phone FROM users WHERE id = $1', [pmUserId]);
    pm = ur.rows[0] || null;
  }

  const fed = run.final_estimate_data || {};
  const projectTitle = fed.title || (tender && tender.tender_title) || `Просчёт #${runId}`;
  const toOrg = (tender && (tender.customer_name || tender.customer)) || '';

  return { run, tender, pm, projectTitle, toOrg };
}

// ─── DOCX-рендер (OOXML минимальный, через adm-zip) ───
function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function docxParagraph(text, opts = {}) {
  const bold = opts.bold ? '<w:b/>' : '';
  const size = opts.size ? `<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>` : '';
  const align = opts.align ? `<w:jc w:val="${opts.align}"/>` : '';
  const lines = String(text == null ? '' : text).split('\n');
  const runs = lines.map((ln, i) =>
    `<w:r><w:rPr>${bold}${size}</w:rPr>${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${escXml(ln)}</w:t></w:r>`
  ).join('');
  return `<w:p><w:pPr>${align}<w:spacing w:after="120"/></w:pPr>${runs}</w:p>`;
}

function buildDocxXml(model) {
  const parts = [];
  parts.push(docxParagraph(SENDER.org, { bold: true, size: 28 }));
  parts.push(docxParagraph(`${SENDER.inn_kpp}\n${SENDER.address}\nТел: ${SENDER.phone}`, { size: 20 }));
  parts.push(docxParagraph(`Кому: ${model.to_organization || '—'}`, { size: 20 }));
  if (model.to_person) parts.push(docxParagraph(`Вниманию: ${model.to_person}`, { size: 20 }));
  parts.push(docxParagraph(`Исх. № ${model.letter_number}    Дата: ${model.date_ru}`, { size: 20 }));
  parts.push(docxParagraph(`Запрос на разъяснения по объекту: ${model.project_title}`, { bold: true, size: 24, align: 'center' }));
  parts.push(docxParagraph(
    `Уважаемый(ая) представитель ${model.to_organization || 'заказчика'}!\n\n` +
    `В рамках подготовки коммерческого предложения по проекту «${model.project_title}» ` +
    'для уточнения существенных параметров расчёта стоимости работ просим Вас ' +
    'предоставить разъяснения по следующим вопросам:',
    { size: 22 }
  ));
  for (const q of model.questions) {
    parts.push(docxParagraph(`${q.number}. ${q.question_topic}`, { bold: true, size: 22 }));
    parts.push(docxParagraph(q.question_text, { size: 22 }));
  }
  parts.push(docxParagraph(
    `Просим направить ответ в адрес ${SENDER.org}:\n` +
    `— электронной почтой: ${model.sender_email || '—'}\n` +
    `— или письмом по адресу: ${SENDER.address}`,
    { size: 22 }
  ));
  parts.push(docxParagraph(`Срок предоставления ответа: до ${model.deadline_date_ru}.`, { size: 22 }));
  parts.push(docxParagraph(
    `С уважением,\nРуководитель проекта    ______________ /${model.sender_name || ''}/\n` +
    `Тел.: ${model.sender_phone || '—'}    E-mail: ${model.sender_email || '—'}    М.П.`,
    { size: 22 }
  ));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${parts.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
}

function renderDocx(model, outPath) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(buildDocxXml(model), 'utf8'));
  zip.writeZip(outPath);
}

// ─── PDF-рендер (pdfkit + DejaVuSans для кириллицы) ───
function renderPdf(model, outPath) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      const stream = fs.createWriteStream(outPath);
      doc.pipe(stream);

      const hasFont = fs.existsSync(FONT_REGULAR);
      if (hasFont) {
        doc.registerFont('ru', FONT_REGULAR);
        if (fs.existsSync(FONT_BOLD)) doc.registerFont('ru-bold', FONT_BOLD);
      }
      const F = hasFont ? 'ru' : 'Helvetica';
      const FB = hasFont && fs.existsSync(FONT_BOLD) ? 'ru-bold' : (hasFont ? 'ru' : 'Helvetica-Bold');

      doc.font(FB).fontSize(14).text(SENDER.org);
      doc.font(F).fontSize(9).text(`${SENDER.inn_kpp}\n${SENDER.address}\nТел: ${SENDER.phone}`);
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Кому: ${model.to_organization || '—'}`);
      if (model.to_person) doc.text(`Вниманию: ${model.to_person}`);
      doc.text(`Исх. № ${model.letter_number}    Дата: ${model.date_ru}`);
      doc.moveDown(0.7);
      doc.font(FB).fontSize(12).text(`Запрос на разъяснения по объекту: ${model.project_title}`, { align: 'center' });
      doc.moveDown(0.7);
      doc.font(F).fontSize(11).text(
        `Уважаемый(ая) представитель ${model.to_organization || 'заказчика'}!\n\n` +
        `В рамках подготовки коммерческого предложения по проекту «${model.project_title}» ` +
        'для уточнения существенных параметров расчёта стоимости работ просим Вас ' +
        'предоставить разъяснения по следующим вопросам:'
      );
      doc.moveDown(0.5);
      for (const q of model.questions) {
        doc.font(FB).fontSize(11).text(`${q.number}. ${q.question_topic}`);
        doc.font(F).fontSize(11).text(q.question_text);
        doc.moveDown(0.4);
      }
      doc.moveDown(0.3);
      doc.text(
        `Просим направить ответ в адрес ${SENDER.org}:\n` +
        `— электронной почтой: ${model.sender_email || '—'}\n` +
        `— или письмом по адресу: ${SENDER.address}`
      );
      doc.moveDown(0.3);
      doc.text(`Срок предоставления ответа: до ${model.deadline_date_ru}.`);
      doc.moveDown(0.7);
      doc.text(
        `С уважением,\nРуководитель проекта    ______________ /${model.sender_name || ''}/\n` +
        `Тел.: ${model.sender_phone || '—'}    E-mail: ${model.sender_email || '—'}    М.П.`
      );

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Главная функция: сформировать письмо по открытым уточнениям к заказчику.
 * @param {{runId:number, clarificationIds:number[], pmUserId:number}} opts
 * @returns {Promise<{letterId:number, letterNumber:string, docxPath:string, pdfPath:string, questions:Array}>}
 */
async function generateClarificationLetter({ runId, clarificationIds, pmUserId }) {
  if (!Array.isArray(clarificationIds) || !clarificationIds.length) {
    throw new Error('Не переданы id вопросов (clarification_ids)');
  }
  ensureDir();

  // 1. Загружаем открытые вопросы к заказчику
  const clars = await db.query(
    "SELECT * FROM mimir_clarifications WHERE id = ANY($1) AND channel = 'CUSTOMER' AND status = 'OPEN'",
    [clarificationIds]
  );
  if (clars.rows.length === 0) throw new Error('Нет открытых вопросов к заказчику среди переданных id');

  const { run, tender, pm, projectTitle, toOrg } = await loadLetterContext(runId, pmUserId);

  // 2. Группируем/переформулируем вопросы
  const groupedQuestions = await groupQuestionsByTopic(clars.rows);

  // 3. Номер исходящего
  const letterNumber = await nextLetterNumber();

  const model = {
    to_organization: toOrg,
    to_person: (tender && tender.tender_contact) || '',
    project_title: projectTitle,
    letter_number: letterNumber,
    date_ru: formatRuDate(new Date()),
    deadline_date_ru: formatRuDate(addDays(new Date(), 5)),
    questions: groupedQuestions,
    sender_name: (pm && pm.name) || '',
    sender_email: (pm && pm.email) || '',
    sender_phone: (pm && pm.phone) || ''
  };

  const subjectText = `Запрос на разъяснения по объекту: ${projectTitle}`;
  const bodyText = groupedQuestions
    .map((q) => `${q.number}. ${q.question_topic}\n${q.question_text}`)
    .join('\n\n');

  // 4. Запись DRAFTED
  const ins = await db.query(
    `INSERT INTO mimir_customer_letters (
        conductor_run_id, tender_id, letter_number, direction,
        subject_text, body_text, questions_ids,
        to_organization, to_person, to_email,
        status, drafted_at, reminders_sent_count
     ) VALUES ($1,$2,$3,'OUTGOING',$4,$5,$6,$7,$8,$9,'DRAFTED',NOW(),0)
     RETURNING id`,
    [
      runId, run.tender_id, letterNumber,
      subjectText, bodyText, clars.rows.map((c) => Number(c.id)),
      toOrg, model.to_person, model.sender_email
    ]
  );
  const letterId = Number(ins.rows[0].id);

  // 5. Рендер DOCX + PDF
  const docxPath = path.join(LETTERS_DIR, `${letterNumber.replace(/[\\/]/g, '_')}.docx`);
  const pdfPath = path.join(LETTERS_DIR, `${letterNumber.replace(/[\\/]/g, '_')}.pdf`);
  renderDocx(model, docxPath);
  await renderPdf(model, pdfPath);

  // 6. Сохраняем пути
  await db.query(
    'UPDATE mimir_customer_letters SET docx_path = $1, pdf_path = $2 WHERE id = $3',
    [docxPath, pdfPath, letterId]
  );

  // Событие в War Room
  try {
    await cr.addEvent(runId, null, 'letter_drafted', {
      letter_id: letterId, letter_number: letterNumber, questions_count: groupedQuestions.length
    });
  } catch (_) { /* событие не критично */ }

  return { letterId, letterNumber, docxPath, pdfPath, questions: groupedQuestions };
}

/** Получить письмо по id (с путями к файлам). */
async function getLetterById(letterId) {
  const r = await db.query('SELECT * FROM mimir_customer_letters WHERE id = $1', [Number(letterId)]);
  return r.rows[0] || null;
}

module.exports = {
  generateClarificationLetter,
  groupQuestionsByTopic,
  getLetterById,
  nextLetterNumber,
  formatRuDate,
  LETTERS_DIR
};
