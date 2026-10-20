/**
 * ASGARD CRM — Pre-Tender Service
 * Общая логика создания/анализа предварительных заявок
 * Используется из routes/pre_tenders.js и services/imap.js
 */

'use strict';

const db = require('./db');
const aiProvider = require('./ai-provider');
const fs = require('fs');
const path = require('path');

// ── System prompt для AI-анализа заявок ──────────────────────────────

const SYSTEM_PROMPT = `Ты — старший аналитик тендерного отдела ООО "Асгард Сервис".

ПРОФИЛЬ КОМПАНИИ:
- Обслуживание трубопроводов (химическая чистка, диагностика, ремонт, гидроиспытания)
- HVAC системы (вентиляция, кондиционирование, отопление, дымоудаление)
- Работы на нефтегазовых объектах (НПЗ, ГПЗ, МЛСП, КС)
- Монтажные и пусконаладочные работы (технологические трубопроводы, металлоконструкции)
- Сервисное обслуживание промышленного оборудования
- Антикоррозионная защита, теплоизоляция
- Работы на высоте, в ограниченных пространствах

ОПЫТ: Арктическая платформа "Приразломная", Хабаровский НПЗ, Омский НПЗ,
объекты Роскосмос, "Газпром нефть", "Лукойл", промышленные предприятия по всей России.

ЗАДАЧА: Проанализировать входящую заявку и дать структурированную рекомендацию.

ФОРМАТ ОТВЕТА (строго JSON, без markdown):
{
  "work_title": "Короткое название работы, 3-8 слов, без кавычек и переносов. Например: «Химическая промывка теплообменника»",
  "work_type": "Тип работ из списка ниже или null",
  "summary": "Развёрнутый отчёт по заявке (3-5 предложений)",
  "color": "green|yellow|red",
  "recommendation": "Конкретная рекомендация 2-3 предложения",
  "work_match_score": 0-100,
  "workload_warning": "Предупреждение о загрузке или null",
  "confidence": 0.0-1.0,
  "urgency": "high|medium|low",
  "auto_suggestion": "accept_green|review|reject_red|need_info",
  "risk_factors": ["фактор 1", "фактор 2"],
  "required_specialists": ["сварщик НАКС", "монтажник", "инженер ПНР"],
  "scope_items": [
    { "name": "Промывка теплообменника", "volume": 12, "unit": "м³" }
  ],
  "extracted_data": {
    "customer_name": "полное название организации",
    "customer_short_name": "сокращение или null",
    "customer_inn": "... или null",
    "contact_person": "... или null",
    "contact_phone": "... или null",
    "contact_phone2": "... или null",
    "work_description": "Что именно нужно сделать — 2-4 предложения деловым языком, НЕ копия письма",
    "work_location": "... или null",
    "work_deadline": "YYYY-MM-DD или null (крайний срок подачи КП)",
    "work_start_plan": "YYYY-MM-DD или null (начало работ)",
    "work_end_plan": "YYYY-MM-DD или null (окончание работ)",
    "estimated_sum": число или null
  }
}

ПРАВИЛА work_title:
- Это ЗАГОЛОВОК карточки в канбане. 3-8 слов. Без «Здравствуйте», без подписей,
  без цитат переписки, без адресов почты, без «Отправлено из мобильной Яндекс Почты».
- Формула: [тип работ] [объект/оборудование]. Пример: «Травление сосуда 6301С18».
- Пиши с заглавной буквы, без точки в конце.

ПРАВИЛА extracted_data.work_description:
- Перескажи задачу своими словами деловым языком: что за оборудование, что с ним
  сделать, какие условия (срок, место, особые требования).
- НЕ копируй тело письма и служебные строки пересылки. Если данных мало —
  напиши то, что понятно, не выдумывай.

ПРАВИЛА scope_items (объёмы работ):
- Ищи объём ВЕЗДЕ: в тексте письма, в ТЗ, в спецификации, в ведомости объёмов,
  в чертежах (в т.ч. внутри ZIP-архива с КД), в карточке клиента, в паспорте оборудования.
- Если в заявке названа МОДЕЛЬ оборудования (например «котёл Viessmann Vitomax 100HS
  тип М33А 1,3 т/ч», «АВО АВГ-75», «КУ-101») и объёма нет — ПОСЧИТАЙ его по
  характеристикам этой модели из блока «СПРАВКА ПО ОБОРУДОВАНИЮ»:
  площадь поверхности нагрева (м²), объём воды (м³), количество секций.
  В поле name допиши «(по паспорту модели)», чтобы РП видел, что это оценка.
- ВАЖНО: создавай ОТДЕЛЬНУЮ позицию на КАЖДЫЙ измеримый объём. Для промывки котла
  это минимум ДВЕ строки: «Химическая промывка поверхностей нагрева — N м²
  (по паспорту)» и «Промывка/заполнение водяного объёма — N м³ (по паспорту)».
  Не сворачивай всё в одну строку «компл.» — тогда РП не видит объём и не может
  оценить трудозатраты.
- «компл.» допустим только как ДОПОЛНИТЕЛЬНАЯ строка (например «Промывочная
  установка — 1 компл.»), но не вместо измеримых м²/м³.
- Перечисли КАЖДУЮ работу отдельной позицией со СВОЕЙ единицей измерения.
  Чистка ёмкости — м³. Мойка/травление поверхности — м². Сварка — стыков.
  Трубы — п.м. Оборудование — шт/компл. Люди — чел·смен. Котёл целиком — компл.
- volume — ЧИСЛО (например 400), unit — единица («м²»).
- volume: null ТОЛЬКО если объёма нет нигде и модель не опознана. Не ставь 0.
- Если объём не назван и модель не опознана — верни пустой массив [].

ПРАВИЛА СРОКОВ (extracted_data.work_deadline / work_start_plan / work_end_plan):
- work_deadline — крайний срок подачи КП/оценки (формат YYYY-MM-DD).
  Фразы «в срок до 20.10.2026», «предоставить до …» → это work_deadline.
- work_start_plan / work_end_plan — сроки ВЫПОЛНЕНИЯ работ, если названы.
- Даты бери из текста письма и вложений. Ничего не выдумывай: нет даты — null.

ПРАВИЛА КОНТАКТОВ:
- contact_phone — основной телефон заказчика. Если в письме/карточке их
  несколько — бери городской рабочий, а мобильный укажи в contact_phone2.
- contact_person — ФИО контактного лица (не форвардера-сотрудника).
- customer_name — НАЗВАНИЕ ОРГАНИЗАЦИИ из карточки клиента/подписи/ИНН-блока.
  НЕ ФИО отправителя. Если есть полная форма («Общество с ограниченной
  ответственностью «ДМИТРОВСКИЙ БЕЛКОВЫЙ КОМБИНАТ»») — используй её, а
  сокращение («ООО «ДБК»») укажи в customer_short_name.

ПРАВИЛА ТИПОВ РАБОТ (поле ai_work_type определяется из scope_items):
используй термины профиля: «Химическая промывка», «Гидромеханическая очистка»,
«Очистка теплообменников», «Очистка резервуаров», «Очистка трубопроводов»,
«Травление», «Пассивация», «Очистка АВО», «Очистка котлов», «Промывка систем отопления»,
«Вентиляция и кондиционирование», «Монтажные работы», «Сварочные работы (НАКС)»,
«Антикоррозионная обработка», «Теплоизоляция», «ПНР», «Диагностика», «Другое».

ПРАВИЛА МАРКИРОВКИ:
🟢 GREEN (work_match_score >= 70): Точно наш профиль, есть опыт и специалисты
🟡 YELLOW (work_match_score 30-69): Частично наш профиль, есть риски или нужна доп.информация
🔴 RED (work_match_score < 30): Не наш профиль, невыполнимо, или нерентабельно

ПРАВИЛА СРОЧНОСТИ (urgency):
- high: дедлайн менее 14 дней ИЛИ указано "срочно/urgent"
- medium: дедлайн 14-45 дней
- low: дедлайн более 45 дней или не указан

ПРАВИЛА AUTO_SUGGESTION:
- accept_green: confidence >= 0.85 и color = green → можно сразу принимать
- reject_red: confidence >= 0.85 и color = red → можно сразу отклонять
- need_info: не хватает данных для оценки (нет ТЗ, суммы, сроков)
- review: все остальные случаи → нужен ручной разбор

В summary укажи:
1. Что за работа и для кого
2. Наш ли это профиль (конкретные пересечения)
3. Есть ли подобный опыт на аналогичных объектах
4. Риски и сложности
5. Какие специалисты потребуются`;

// ── Создание заявки из письма ────────────────────────────────────────

async function createPreTenderFromEmail(emailId, options = {}) {
  // Проверяем что ещё нет заявки для этого email
  const exists = await db.query('SELECT id FROM pre_tender_requests WHERE email_id = $1', [emailId]);
  if (exists.rows.length) return { exists: true, id: exists.rows[0].id };

  // Получаем данные письма + связанный inbox_application (для определения настоящего клиента
  // в случае corporate_forward: forwarder не должен быть customer_name, нужен original_sender).
  // Симметрично логике в /api/inbox-applications/:id/to-pre-tender (Wave B fix).
  // extracted_customer_* — структурированные реквизиты клиента (название компании, ИНН и т.д.),
  // вытащенные AI-анализатором из карточки/подписи/печати. Используем их в первую очередь —
  // «АО НАК Азот» в customer_name полезнее, чем «karina@eurochem.ru».
  const emailRes = await db.query(`
    SELECT e.*,
           ia.source_kind, ia.source_email, ia.source_name,
           ia.original_sender_email, ia.original_sender_name,
           ia.extracted_customer_name, ia.extracted_customer_inn,
           ia.extracted_customer_contact_email, ia.extracted_customer_contact_person,
           ia.extracted_customer_phone, ia.extracted_customer_address,
           ia.ai_raw_json,
           -- D-287: без этих полей заголовок карточки падал в имя клиента,
           -- а тип работы и срок не доезжали до заявки вовсе.
           ia.ai_work_type, ia.ai_estimated_days, ia.ai_summary, ia.ai_color,
           ia.ai_recommendation, ia.ai_keywords
    FROM emails e
    LEFT JOIN inbox_applications ia ON ia.email_id = e.id
    WHERE e.id = $1
  `, [emailId]);
  if (!emailRes.rows.length) return null;
  const email = emailRes.rows[0];

  // Resolve customer (симметрично /api/inbox-applications/:id/to-pre-tender):
  // НИКОГДА не подставляем форвардера/внутреннего сотрудника как заказчика.
  // 30.06.2026 bug #3: у пересланных писем from_name/source_name — это наш
  // получатель (напр. Мохарин), а не клиент (ООО «СВС-Н»).
  const INTERNAL_DOMAINS = ['asgard-service.com', 'asgard-crm.ru', 'asgard-service.ru'];
  const isInternalEmail = (e) => {
    if (!e) return false;
    const at = String(e).toLowerCase().split('@')[1] || '';
    return INTERNAL_DOMAINS.some(d => at === d || at.endsWith('.' + d));
  };
  const isForward = email.source_kind === 'corporate_forward';

  // Внешний original_sender (не наш домен).
  const extSenderName  = isInternalEmail(email.original_sender_email) ? null : email.original_sender_name;
  const extSenderEmail = isInternalEmail(email.original_sender_email) ? null : email.original_sender_email;

  // original_sender_company AI кладёт только в ai_raw_json.
  let origCompany = null;
  try {
    const raw = typeof email.ai_raw_json === 'string' ? JSON.parse(email.ai_raw_json) : (email.ai_raw_json || null);
    origCompany = raw && raw.original_sender_company ? String(raw.original_sender_company).trim() : null;
  } catch (_) { /* битый json — игнор */ }

  // Имя заказчика: extracted → company из подписи → внешний original_sender →
  // (для НЕ-форварда) source_name/from_name.
  let customerName = email.extracted_customer_name
    || origCompany
    || extSenderName
    || (isForward ? '' : (email.source_name || email.from_name || ''));
  // Email: extracted contact → внешний original_sender →
  // (для НЕ-форварда и НЕ внутреннего) source_email/from_email.
  let customerEmail = email.extracted_customer_contact_email
    || extSenderEmail
    || (isForward || isInternalEmail(email.source_email || email.from_email)
        ? ''
        : (email.source_email || email.from_email || ''));
  let customerInn = email.extracted_customer_inn || null;

  // Добиваем официальное название через Dadata, если так и не определили
  // (есть только ИНН / корпоративная почта). Non-fatal: ошибка → оставляем как есть.
  if (!customerName) {
    try {
      const dadata = require('./dadata');
      const hit = await dadata.resolveCustomer({
        inn: customerInn,
        email: customerEmail,
        hint: origCompany
      });
      if (hit && hit.name) {
        customerName = hit.name;
        if (!customerInn && hit.inn) customerInn = hit.inn;
        console.log(`[pre-tender-service] email #${emailId}: customer resolved via Dadata → "${hit.name}" (inn=${hit.inn})`);
      }
    } catch (ddErr) {
      console.warn(`[pre-tender-service] Dadata resolve failed for email #${emailId}:`, ddErr.message);
    }
  }

  // Создаём заявку с данными из письма
  const assignedTo = options.assignedTo || null;

  // D-204: work_description раньше брался строго из body_text. У писем, которые
  // приходят только в HTML (Яндекс/Fwd), body_text пуст — и карточка РП получала
  // пустое «что делать». Теперь: body_text → текст из body_html → AI-конспект.
  const { bestEmailText } = require('./email-text');
  const workDescription = (
    bestEmailText(email)
    || email.ai_summary
    || ''
  ).slice(0, 2000);

  // V416: заголовок карточки — короткий, от ИИ. Раньше в title уезжал весь
  // work_description (до 2000 знаков) и «Отправлено из мобильной Яндекс Почты».
  //
  // D-287 (прод 19.10.2026, письмо #4894): заголовок стал «ООО «Велесстрой»» —
  // просто ИМЯ КЛИЕНТА вместо того, что за работа. Причина: `email.work_title`
  // в письмах не существует (он есть только в pre_tender_requests), поэтому
  // выражение падало в `[ai_work_type, customerName].join(' · ')`, где
  // ai_work_type тоже не пришёл с уровня письма — оставался только клиент.
  // Теперь: приоритет — ai_work_type из РАЗБОРА письма, затем заявка, затем
  // название клиента как последний резерв (лучше хоть что-то, чем пусто).
  const aiWorkType = String(email.ai_work_type || email.work_type || '').trim();
  const subjectClean = String(email.subject || '')
    .replace(/^\s*(Fwd?|Переслано|Re)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const workTitle = (email.work_title || '').trim()
    || aiWorkType.slice(0, 200)
    || subjectClean.slice(0, 200)
    || customerName
    || null;

  const ins = await db.query(`
    INSERT INTO pre_tender_requests (
      email_id, source_type,
      customer_name, customer_email, customer_inn,
      contact_person, contact_phone,
      work_description,
      ai_summary, ai_color, ai_recommendation,
      has_documents,
      status, created_by, assigned_to,
      work_title, ai_work_type
    ) VALUES (
      $1, 'email',
      $2, $3, $4,
      $5, $6,
      $7,
      $8, $9, $10,
      $11,
      'new', $12, $13,
      $14, $15
    )
    RETURNING id
  `, [
    emailId,
    customerName,
    customerEmail,
    customerInn,
    email.extracted_customer_contact_person || null,
    email.extracted_customer_phone || null,
    workDescription,
    email.ai_summary || null,
    email.ai_color || 'yellow',
    email.ai_recommendation || null,
    email.has_attachments || false,
    email.sent_by_user_id || null,
    assignedTo,
    workTitle,
    email.ai_work_type ? String(email.ai_work_type).slice(0, 200) : null
  ]);

  const preTenderId = ins.rows[0].id;

  const { ensureDocumentFolders } = require('./pre-tender-doc-folders');
  await db.query(
    'UPDATE pre_tender_requests SET document_folders = $1 WHERE id = $2',
    [JSON.stringify(ensureDocumentFolders(null)), preTenderId]
  );

  if (assignedTo && !options.skipKanban) {
    try {
      await assignPreTenderToPm(preTenderId, assignedTo, options.assignedBy || null, options.assignNote);
    } catch (kbErr) {
      console.warn(`[PreTender] kanban card for #${preTenderId} → PM #${assignedTo} failed:`, kbErr.message);
    }
  }

  // Обратная ссылка
  await db.query('UPDATE emails SET pre_tender_id = $1 WHERE id = $2', [preTenderId, emailId]);

  console.log(`[PreTender] Created pre-tender #${preTenderId} from email #${emailId}`);
  return { exists: false, id: preTenderId };
}

// ── Извлечение текста из вложений (PDF, DOCX) ───────────────────────

const MAX_TEXT_PER_FILE = 10000;  // chars per file
const MAX_TEXT_TOTAL = 45000;     // D-292: было 30000 — ТЗ с объёмами не влезало в контекст
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB for vision
// D-292: ZIP с КД/ТЗ — 13 МБ и больше. Раньше такой архив МОЛЧА выкидывался
// (size > MAX_FILE_SIZE → null), и AI не видел объёмов, которые лежат внутри.
const MAX_ZIP_SIZE = 40 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 8;
const MAX_ZIP_ENTRY_TEXT = 7000;

// Типы файлов, поддерживающие мультимодальную отправку (изображения)
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function extractTextFromFile(filePath, mimeType) {
  try {
    const absPath = path.join(__dirname, '..', '..', filePath);
    if (!fs.existsSync(absPath)) return null;
    const stats = fs.statSync(absPath);
    const isZip = mimeType === 'application/zip' || String(filePath || '').toLowerCase().endsWith('.zip');
    // D-292: ZIP до 40 МБ (КД с чертежами), остальное — прежний лимит 10 МБ.
    if (stats.size > (isZip ? MAX_ZIP_SIZE : MAX_FILE_SIZE)) {
      console.warn(`[PreTender] skip attachment (too big): ${filePath} ${stats.size} b`);
      return null;
    }

    const buf = fs.readFileSync(absPath);
    const lc = (filePath || '').toLowerCase();

    // PDF
    if (mimeType === 'application/pdf' || lc.endsWith('.pdf')) {
      const pdfParse = require('pdf-parse');
      const result = await pdfParse(buf);
      return result.text ? result.text.slice(0, MAX_TEXT_PER_FILE) : null;
    }

    // DOCX — mammoth (быстро, без внешних процессов).
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || lc.endsWith('.docx')) {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ buffer: buf });
        if (result && result.value) return result.value.slice(0, MAX_TEXT_PER_FILE);
      } catch (e) {
        // битый docx — пробуем LibreOffice ниже
        console.warn('[PreTender] mammoth failed, fallback to libreoffice:', e.message);
      }
    }

    // D-297: старый .doc / .rtf / .odt. mammoth умеет ТОЛЬКО .docx — на .doc он
    // падал с «Could not find the body element: are you sure this is a docx file?»
    // и карточка клиента (название, ИНН, телефон) не читалась вообще.
    // Конвертируем через LibreOffice: --convert-to txt.
    if (mimeType === 'application/msword' || lc.endsWith('.doc')
        || lc.endsWith('.rtf') || lc.endsWith('.odt')) {
      return extractTextViaLibreOffice(absPath, 'txt:Text');
    }

    // XLSX / XLS — извлекаем данные из таблиц
    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        || mimeType === 'application/vnd.ms-excel'
        || lc.endsWith('.xlsx') || lc.endsWith('.xls')) {
      try {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buf);
        const lines = [];
        workbook.eachSheet((sheet, sheetId) => {
          if (sheetId > 3) return; // max 3 sheets
          lines.push(`[Лист: ${sheet.name}]`);
          let rowCount = 0;
          sheet.eachRow((row, rowNum) => {
            if (rowCount++ > 200) return; // max 200 rows
            const vals = [];
            row.eachCell((cell) => {
              const v = cell.text || cell.value;
              if (v !== null && v !== undefined && v !== '') vals.push(String(v).trim());
            });
            if (vals.length) lines.push(vals.join(' | '));
          });
        });
        const text = lines.join('\n');
        return text ? text.slice(0, MAX_TEXT_PER_FILE) : null;
      } catch (xlErr) {
        console.warn('[PreTender] XLSX extraction error:', xlErr.message);
        return null;
      }
    }

    // D-292: ZIP (КД, ТЗ, чертежи). Раньше архив вообще не читался — AI получал
    // только имя файла, поэтому объёмы из чертежей не попадали в карточку.
    if (mimeType === 'application/zip' || lc.endsWith('.zip')) {
      return await extractTextFromZip(buf);
    }

    return null;
  } catch (err) {
    console.warn('[PreTender] Text extraction error:', filePath, err.message);
    return null;
  }
}

/**
 * D-297: извлечь текст старых форматов (.doc/.rtf/.odt) через LibreOffice.
 * Отдельно от OfficeToPdf, потому что здесь нужен txt, а не PDF.
 * Возвращает null при любой проблеме — вызывающий не падает.
 */
function extractTextViaLibreOffice(absPath, filter) {
  const { spawnSync } = require('child_process');
  const tmpDir = `/tmp/pkdoc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    const r = spawnSync('libreoffice',
      ['--headless', `--convert-to`, filter || 'txt:Text', '--outdir', tmpDir, absPath],
      { timeout: 60000, windowsHide: true, env: { ...process.env, HOME: '/tmp' } });
    if (r.status !== 0) {
      console.warn('[PreTender] libreoffice text convert failed:', (r.stderr || '').toString().slice(0, 200));
      return null;
    }
    const baseNoExt = path.basename(absPath, path.extname(absPath));
    let outFile = path.join(tmpDir, baseNoExt + '.txt');
    if (!fs.existsSync(outFile)) {
      const list = fs.readdirSync(tmpDir).filter((f) => /\.txt$/i.test(f));
      if (!list.length) return null;
      outFile = path.join(tmpDir, list[0]);
    }
    const text = fs.readFileSync(outFile, 'utf8');
    // LibreOffice иногда пишет BOM — срезаем.
    const clean = text.replace(/^\uFEFF/, '').trim();
    return clean ? clean.slice(0, MAX_TEXT_PER_FILE) : null;
  } catch (e) {
    console.warn('[PreTender] libreoffice text convert error:', e.message);
    return null;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

/**
 * D-292: текст из ZIP — по первым N файлам.
 * Берём только извлекаемые расширения (PDF/DOCX/XLSX/TXT). Имена из CP866
 * (русские архивы Windows) декодируются, иначе в промпт уходил мусор.
 */
async function extractTextFromZip(buf) {
  let AdmZip;
  try { AdmZip = require('adm-zip'); } catch (_) { return null; }

  // Имя записи в cp866 (Windows-архивы без UTF-8-флага) → читаемый текст.
  const decodeName = (entry) => {
    const raw = entry.rawEntryName;
    const flags = (entry.header && entry.header.flags) || 0;
    if (raw && raw.length && !(flags & 0x800) && raw.some((b) => b >= 0x80)) {
      try {
        const d = new TextDecoder('ibm866').decode(raw);
        if (d && !d.includes('\uFFFD')) return d;
      } catch (_) { /* нет cp866 — оставляем как есть */ }
    }
    return entry.entryName || '';
  };

  try {
    const zip = new AdmZip(buf);
    const entries = zip.getEntries()
      .filter((e) => !e.isDirectory)
      .map((e) => ({ e, name: decodeName(e) }))
      .filter((x) => /\.(pdf|docx?|xlsx?|txt|csv|md)$/i.test(x.name))
      .filter((x) => ((x.e.header && x.e.header.size) || 0) <= MAX_FILE_SIZE)
      .slice(0, MAX_ZIP_ENTRIES);

    const chunks = [];
    for (const { e, name } of entries) {
      try {
        const data = e.getData();
        const ext = String(path.extname(name) || '').toLowerCase();
        let text = null;

        if (ext === '.pdf') {
          const pdfParse = require('pdf-parse');
          const parsed = await pdfParse(data);
          text = parsed && parsed.text ? parsed.text : null;
        } else if (ext === '.docx') {
          const mammoth = require('mammoth');
          const parsed = await mammoth.extractRawText({ buffer: data });
          text = parsed && parsed.value ? parsed.value : null;
        } else if (ext === '.xlsx' || ext === '.xls') {
          const XLSX = require('xlsx');
          const wb = XLSX.read(data, { type: 'buffer' });
          const lines = [];
          wb.SheetNames.slice(0, 3).forEach((sn) => {
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false });
            rows.slice(0, 150).forEach((r) => {
              const line = (r || []).map((c) => (c == null ? '' : String(c))).join(' ').trim();
              if (line) lines.push(line);
            });
          });
          text = lines.length ? lines.join('\n') : null;
        } else {
          text = data.toString('utf8');
        }

        if (text && text.trim()) {
          chunks.push(`--- «${name}» ---\n${String(text).slice(0, MAX_ZIP_ENTRY_TEXT)}`);
        }
      } catch (inner) {
        console.warn('[PreTender] ZIP entry extract failed:', name, inner.message);
      }
    }

    return chunks.length ? chunks.join('\n\n').slice(0, MAX_TEXT_PER_FILE) : null;
  } catch (e) {
    console.warn('[PreTender] ZIP extract failed:', e.message);
    return null;
  }
}

/**
 * Подготовить изображения для мультимодального AI-запроса (Claude Vision)
 * Возвращает массив content blocks для messages API
 */
function prepareImageBlocks(filePath, mimeType) {
  try {
    const absPath = path.join(__dirname, '..', '..', filePath);
    if (!fs.existsSync(absPath)) return null;
    const stats = fs.statSync(absPath);
    if (stats.size > MAX_IMAGE_SIZE) return null;
    if (!IMAGE_MIMES.includes(mimeType)) return null;

    const buf = fs.readFileSync(absPath);
    const base64 = buf.toString('base64');
    return {
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: base64 }
    };
  } catch (err) {
    console.warn('[PreTender] Image preparation error:', filePath, err.message);
    return null;
  }
}

// ── AI-анализ заявки ─────────────────────────────────────────────────

async function analyzePreTender(preTenderId) {
  const ptRes = await db.query(`
    SELECT pt.*, e.subject, e.body_text, e.from_email, e.from_name, e.email_date, e.email_type
    FROM pre_tender_requests pt
    LEFT JOIN emails e ON e.id = pt.email_id
    WHERE pt.id = $1
  `, [preTenderId]);

  if (!ptRes.rows.length) throw new Error('Заявка не найдена');
  const pt = ptRes.rows[0];

  // Получаем вложения и извлекаем текст из PDF/DOCX + изображения для Vision
  let attachmentTexts = 'Вложений нет';
  const extractedTexts = [];
  const imageBlocks = []; // для мультимодального запроса Claude Vision
  let totalExtracted = 0;

  if (pt.email_id) {
    const attRes = await db.query(
      'SELECT original_filename, mime_type, size, file_path FROM email_attachments WHERE email_id = $1',
      [pt.email_id]
    );
    if (attRes.rows.length) {
      const parts = [];
      for (const a of attRes.rows) {
        parts.push(`${a.original_filename} (${a.mime_type}, ${Math.round((a.size || 0) / 1024)} КБ)`);
        if (a.file_path) {
          // Изображения — собираем для мультимодального запроса
          if (IMAGE_MIMES.includes(a.mime_type) && imageBlocks.length < 5) {
            const imgBlock = prepareImageBlocks(a.file_path, a.mime_type);
            if (imgBlock) imageBlocks.push(imgBlock);
          }
          // Текстовые документы — извлекаем текст
          if (totalExtracted < MAX_TEXT_TOTAL && !IMAGE_MIMES.includes(a.mime_type)) {
            const text = await extractTextFromFile(a.file_path, a.mime_type);
            if (text) {
              extractedTexts.push(`--- Содержимое «${a.original_filename}» ---\n${text}`);
              totalExtracted += text.length;
            }
          }
        }
      }
      attachmentTexts = parts.join('\n');
    }
  }

  // Также проверяем вручную загруженные документы
  const manualDocs = Array.isArray(pt.manual_documents) ? pt.manual_documents : [];
  for (const doc of manualDocs) {
    if (doc.path) {
      // Изображения
      if (IMAGE_MIMES.includes(doc.mime_type) && imageBlocks.length < 5) {
        const imgBlock = prepareImageBlocks(doc.path, doc.mime_type);
        if (imgBlock) imageBlocks.push(imgBlock);
      }
      // Текстовые документы
      if (totalExtracted < MAX_TEXT_TOTAL && !IMAGE_MIMES.includes(doc.mime_type)) {
        const text = await extractTextFromFile(doc.path, doc.mime_type);
        if (text) {
          extractedTexts.push(`--- Содержимое «${doc.original_name || doc.filename}» ---\n${text}`);
          totalExtracted += text.length;
        }
      }
    }
  }

  // Получаем загрузку
  const workloadInfo = await getWorkloadInfo();

  // D-298: обогащение данными об оборудовании. Заявка часто содержит только
  // модель («котёл Viessmann Vitomax 100HS», «АВО АВГ-75»), а объёмы (площадь
  // поверхности нагрева, объём воды) есть в паспорте — его можно найти по модели.
  // Раньше AI видел только текст письма и писал «объём не указан».
  const equipResearch = await researchEquipment(pt);

  // Формируем сообщение
  const emailType = pt.email_type === 'direct_request' ? 'Прямой запрос' : 'Тендерная площадка';
  const userMessage = `ВХОДЯЩАЯ ЗАЯВКА:

От: ${pt.from_name || pt.customer_name || '?'} <${pt.from_email || pt.customer_email || '?'}>
Тема: ${pt.subject || '(без темы)'}
Дата: ${pt.email_date || pt.created_at || '?'}
Тип: ${emailType}

ТЕКСТ ПИСЬМА:
${pt.body_text || pt.work_description || 'Текст отсутствует'}

ВЛОЖЕНИЯ:
${attachmentTexts}
${extractedTexts.length ? '\nСОДЕРЖИМОЕ ВЛОЖЕНИЙ:\n' + extractedTexts.join('\n\n') : ''}
${equipResearch ? '\nСПРАВКА ПО ОБОРУДОВАНИЮ (найдено в открытых источниках):\n' + equipResearch + '\n' : ''}
ЗАГРУЗКА КОМПАНИИ:
${workloadInfo}`;

  // Вызываем AI.
  // ВАЖНО: НЕ проверяем здесь aiProvider.getConfig().has*Key — ключи грузятся
  // ЛЕНИВО из settings.ai_config при первом complete(), поэтому до первого вызова
  // getConfig() всегда отдаёт false. Из-за этой проверки разбор ВСЕГДА уходил в
  // fallback («нет ИИ разбора» на карточке РП). Пусть решает complete():
  // нет ключей → он сам вернёт demo-ответ, и мы отдадим fallback.
  try {
    // Ключи грузятся ЛЕНИВО из settings.ai_config. До первого complete() getConfig()
    // отдаёт has*Key=false, из-за чего разбор всегда падал в fallback («нет ИИ»).
    await aiProvider._loadKeysFromDB();
    const hasAnthropic = aiProvider.getConfig().hasAnthropicKey;

    // Формируем content: текст + (опционально) изображения для Vision
    let messageContent;
    if (imageBlocks.length > 0 && hasAnthropic) {
      // Мультимодальный запрос: текст + изображения (только Anthropic поддерживает Vision)
      messageContent = [
        { type: 'text', text: userMessage },
        ...imageBlocks.map((img, i) => ({
          ...img,
          // Подпись для каждого изображения
        }))
      ];
      // Добавляем инструкцию по изображениям
      messageContent[0].text += '\n\nК заявке приложены изображения (чертежи, фото, сканы). Проанализируй их содержимое и учти в оценке.';
    } else {
      messageContent = userMessage;
    }

    const response = await aiProvider.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: messageContent }],
      maxTokens: 4096,
      temperature: 0.3,
      // V416: модель по умолчанию — reasoning-модель. Без отключения reasoning она
      // весь бюджет тратит на chain-of-thought и отдаёт content="" (finish=length),
      // из-за чего карточка оставалась БЕЗ разбора ИИ. Отключаем reasoning и даём
      // запас токенов под JSON со scope_items.
      reasoning: { enabled: false }
    });

    const result = parseAIResult(response.text);

    // Обновляем заявку (включая новые AI-поля)
    await db.query(`
      UPDATE pre_tender_requests SET
        ai_summary = $1,
        ai_color = $2,
        ai_recommendation = $3,
        ai_work_match_score = $4,
        ai_workload_warning = $5,
        ai_confidence = $6,
        ai_urgency = $7,
        ai_auto_suggestion = $8,
        ai_risk_factors = $9,
        ai_required_specialists = $10,
        ai_processed_at = NOW(),
        work_title = COALESCE(NULLIF($20, ''), work_title),
        ai_scope_items = COALESCE($21::jsonb, ai_scope_items),
        ai_work_type = COALESCE(NULLIF($22, ''), ai_work_type),
        work_volume = COALESCE($25, work_volume),
        work_volume_unit = COALESCE(NULLIF($26, ''), work_volume_unit),
        customer_name = COALESCE(NULLIF($11, ''), customer_name),
        customer_inn = COALESCE(NULLIF($12, ''), customer_inn),
        contact_person = COALESCE(NULLIF($13, ''), contact_person),
        contact_phone = COALESCE(NULLIF($14, ''), contact_phone),
        work_description = COALESCE(NULLIF($15, ''), work_description),
        work_location = COALESCE(NULLIF($16, ''), work_location),
        work_deadline = COALESCE($17::date, work_deadline),
        work_start_plan = COALESCE($23::date, work_start_plan),
        work_end_plan = COALESCE($24::date, work_end_plan),
        estimated_sum = COALESCE($18, estimated_sum),
        updated_at = NOW()
      WHERE id = $19
    `, [
      result.summary,
      result.color,
      result.recommendation,
      result.work_match_score,
      result.workload_warning,
      result.confidence,
      result.urgency,
      result.auto_suggestion,
      JSON.stringify(result.risk_factors),
      JSON.stringify(result.required_specialists),
      result.extracted_data?.customer_name || '',
      result.extracted_data?.customer_inn || '',
      result.extracted_data?.contact_person || '',
      result.extracted_data?.contact_phone || '',
      result.extracted_data?.work_description || '',
      result.extracted_data?.work_location || '',
      result.extracted_data?.work_deadline || null,
      result.extracted_data?.estimated_sum || null,
      preTenderId,
      result.work_title || '',
      result.scope_items && result.scope_items.length ? JSON.stringify(result.scope_items) : null,
      result.work_type || '',
      // D-292: сроки ВЫПОЛНЕНИЯ работ (раньше терялись — РП видел пустые поля).
      result.extracted_data?.work_start_plan || null,
      result.extracted_data?.work_end_plan || null,
      // Итоговый объём дублируем в work_volume/work_volume_unit — по ним
      // «Объём (итого)» заполняется сразу, без ручного ввода.
      result.volume_total != null ? result.volume_total : null,
      result.volume_unit || null
    ]);

    // V416: телефон/ИНН, если ИИ не нашёл — достаём регэкспом из текста письма
    // и справочника контрагентов. Иначе РП видел пустой телефон, хотя он есть в подписи.
    await applyContactFallbacks(preTenderId, pt, result, db);

    // Логируем
    await db.query(`
      INSERT INTO ai_analysis_log (entity_type, entity_id, analysis_type, model, provider, duration_ms, output_json)
      VALUES ('pre_tender', $1, 'pre_tender_analysis', $2, $3, $4, $5)
    `, [preTenderId, response.model, response.provider, response.durationMs, JSON.stringify(result)]);

    return result;
  } catch (err) {
    console.error('[PreTender] AI analysis error:', err.message);
    return fallbackAnalysis(pt);
  }
}

// ── Парсинг ответа AI ────────────────────────────────────────────────

function parseAIResult(text) {
  if (!text) return fallbackResult();
  let clean = text.trim();
  if (clean.startsWith('```json')) clean = clean.slice(7);
  if (clean.startsWith('```')) clean = clean.slice(3);
  if (clean.endsWith('```')) clean = clean.slice(0, -3);
  clean = clean.trim();

  try {
    const p = JSON.parse(clean);
    const color = ['green', 'yellow', 'red'].includes(p.color) ? p.color : 'yellow';
    const confidence = Math.max(0, Math.min(1, parseFloat(p.confidence) || 0.5));
    // V416: перечень объёмов — у каждой работы своя единица.
    const scopeItems = Array.isArray(p.scope_items)
      ? p.scope_items
          .filter((it) => it && (it.name || it.volume != null))
          .slice(0, 30)
          .map((it) => ({
            name: String(it.name || '').trim().slice(0, 200) || null,
            volume: Number.isFinite(Number(it.volume)) && Number(it.volume) > 0 ? Number(it.volume) : null,
            unit: it.unit ? String(it.unit).trim().slice(0, 30) : null
          }))
      : [];
    // D-292: итоговый объём тоже не должен превращаться в 0 — это выглядит как
    // «объём посчитан и равен нулю», хотя данных нет.
    const firstVol = scopeItems.find((it) => it.volume != null);
    return {
      work_title: p.work_title ? String(p.work_title).trim().slice(0, 200) : null,
      work_type: p.work_type ? String(p.work_type).trim().slice(0, 200) : null,
      scope_items: scopeItems,
      volume_total: firstVol ? firstVol.volume : null,
      volume_unit: firstVol ? firstVol.unit : null,
      summary: p.summary || '',
      color,
      recommendation: p.recommendation || '',
      work_match_score: Math.max(0, Math.min(100, parseInt(p.work_match_score) || 50)),
      workload_warning: p.workload_warning || null,
      confidence,
      urgency: ['high', 'medium', 'low'].includes(p.urgency) ? p.urgency : 'medium',
      auto_suggestion: ['accept_green', 'review', 'reject_red', 'need_info'].includes(p.auto_suggestion)
        ? p.auto_suggestion : 'review',
      risk_factors: Array.isArray(p.risk_factors) ? p.risk_factors : [],
      required_specialists: Array.isArray(p.required_specialists) ? p.required_specialists : [],
      extracted_data: p.extracted_data || {}
    };
  } catch (e) {
    console.error('[PreTender] AI JSON parse error:', e.message);
    return fallbackResult();
  }
}

function fallbackResult() {
  return {
    work_title: null,
    work_type: null,
    scope_items: [],
    summary: 'Автоматический анализ недоступен. Требуется ручная проверка.',
    color: 'yellow',
    recommendation: 'Просмотрите заявку вручную.',
    work_match_score: 50,
    workload_warning: null,
    confidence: 0,
    urgency: 'medium',
    auto_suggestion: 'review',
    risk_factors: [],
    required_specialists: [],
    extracted_data: {}
  };
}

function fallbackAnalysis(pt) {
  const text = ((pt.subject || '') + ' ' + (pt.work_description || '') + ' ' + (pt.body_text || '')).toLowerCase();
  const ourKeywords = ['промывк', 'химическ', 'трубопровод', 'монтаж', 'демонтаж', 'сварк', 'изоляц', 'нпз', 'гпз', 'нефт', 'газ', 'вентиляц'];
  const matches = ourKeywords.filter(k => text.includes(k));
  const score = Math.min(100, matches.length * 15 + 10);
  const color = score >= 70 ? 'green' : score >= 30 ? 'yellow' : 'red';

  return {
    work_title: null,
    work_type: null,
    scope_items: [],
    summary: `Обнаружено ${matches.length} ключевых слов нашего профиля: ${matches.join(', ') || 'нет'}. Требуется ручная проверка.`,
    color,
    recommendation: matches.length > 2 ? 'Рекомендуется рассмотреть заявку.' : 'Требуется детальное изучение.',
    work_match_score: score,
    workload_warning: null,
    confidence: 0.3,
    urgency: 'medium',
    auto_suggestion: 'review',
    risk_factors: [],
    required_specialists: [],
    extracted_data: {}
  };
}

/**
 * V416/D-297: дотягиваем контакты, которые ИИ не выделил.
 *  1. Телефоны — регэкспом из текста письма. Берём ДО ДВУХ: раньше
 *     сохранялся только первый, и «Телефон 2» оставался пустым, хотя номер
 *     есть (мобильный в подписи, городской в карточке клиента).
 *  2. ИНН — из справочника customers по нормализованному названию.
 * Пишем только если поле пустое: ручные правки РП не перетираем.
 */
async function applyContactFallbacks(preTenderId, pt, result, dbc = db) {
  try {
    const text = String(pt.body_text || '') + '\n' + String(pt.work_description || '');
    // Телефоны: +7 (495) 123-45-67, 8-800-555-35-35, +7 (916) 598-08-61
    const phoneRe = /(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/g;
    const phoneMatches = text.match(phoneRe) || [];
    // Отсекаем НАШИ номера (подпись Асгарда в пересылаемом письме), иначе клиенту
    // доставался телефон менеджера, а не заказчика.
    const OWN_PHONE_RE = /^(?:\+?7|8)?(?:499|495|800|812)\d{7}$/;
    const normPhone = (p) => {
      const n = String(p).replace(/[^\d+]/g, '');
      return n.startsWith('8') ? '+7' + n.slice(1) : n;
    };
    const phones = [];
    for (const m of phoneMatches) {
      const p = normPhone(m);
      if (p.replace(/\D/g, '').length < 10) continue;
      if (OWN_PHONE_RE.test(p)) continue;
      if (!phones.includes(p)) phones.push(p);
      if (phones.length >= 2) break;
    }

    const updates = [];
    const vals = [];
    let i = 1;

    const cur = await dbc.query(
      'SELECT contact_phone, customer_inn, work_title FROM pre_tender_requests WHERE id = $1',
      [preTenderId]);
    const row = cur.rows[0] || {};

    // Второй телефон хранится в карточке канбана (contact_phone2 в personal_kanban
    // нет — там meta), поэтому пишем в pre_tender только основной, а лишний
    // отдаём фронту через extracted_data, чтобы РП видел оба номера.
    if (phones.length > 1) {
      result.extracted_data = result.extracted_data || {};
      if (!result.extracted_data.contact_phone2) {
        result.extracted_data.contact_phone2 = phones[1];
      }
    }

    if (!row.contact_phone && !result.extracted_data?.contact_phone && phones.length) {
      updates.push(`contact_phone = $${i++}`);
      vals.push(phones[0].slice(0, 30));
    }

    if (!row.customer_inn && !result.extracted_data?.customer_inn && row.work_title !== undefined) {
      // D-298: пробуем несколько вариантов названия — полное и сокращение
      // («ООО «ДБК»» из письма vs «Общество с ограниченной ответственностью
      // «ДМИТРОВСКИЙ БЕЛКОВЫЙ КОМБИНАТ»» в карточке/справочнике).
      const names = [
        result.extracted_data?.customer_name,
        result.extracted_data?.customer_short_name,
        pt.customer_name,
      ].map((s) => String(s || '').trim()).filter(Boolean);
      const name = names[0] || '';
      if (name) {
        // Названия сравниваем БЕЗ кавычек и регистра: в письмах «ОАО «Волгограднефтемаш»»,
        // в справочнике — ОАО "ВОЛГОГРАДНЕФТЕМАШ". Иначе ИНН никогда не подставлялся.
        const norm = (s) => String(s || '')
          .toLowerCase()
          .replace(/[«»"'`]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const all = await dbc.query(
          `SELECT inn, name FROM customers
            WHERE inn IS NOT NULL AND LENGTH(inn) IN (10,12)`
        );
        const target = norm(name);
        const normAny = (s) => norm(s);
        // Ищем по ВСЕМ вариантам названия: полное, сокращение, из письма.
        const targets = names.map(normAny).filter((t) => t.length >= 4);
        const hit = all.rows.find((r) => targets.includes(normAny(r.name)))
          || all.rows.find((r) => targets.some((t) =>
              t.length > 6 && (normAny(r.name).includes(t) || t.includes(normAny(r.name)))));
        if (hit?.inn) {
          updates.push(`customer_inn = $${i++}`);
          vals.push(hit.inn);
        }
      }
    }

    if (!updates.length) return;
    updates.push('updated_at = NOW()');
    vals.push(preTenderId);
    await dbc.query(
      `UPDATE pre_tender_requests SET ${updates.join(', ')} WHERE id = $${i}`,
      vals);
  } catch (e) {
    console.warn('[PreTender] contact fallback failed:', e.message);
  }
}

/**
 * D-298: справка по оборудованию для промпта.
 * Ищем ТОЛЬКО если в тексте есть узнаваемая модель (латиница+цифры или «марка»).
 *
 * D-299: веб-поиск починен (был MALFORMED_FUNCTION_CALL из-за engine:'native'
 * вместе с system-промптом). Теперь сначала пробуем сеть — там паспортные данные
 * точнее, чем «знания» модели, и только если сеть пуста, спрашиваем модель.
 */
async function researchEquipment(pt) {
  try {
    // D-299: НЕ используем pt.subject — такой колонки у pre_tender_requests НЕТ
    // (она есть только в JOIN с emails). Из-за этого запрос падал, ошибка глушилась
    // catch'ем, и researchEquipment всегда возвращал '' — модель не находилась.
    const text = [pt.subject, pt.body_text, pt.work_description, pt.ai_work_type]
      .filter(Boolean).join(' ');

    // D-299: модель оборудования. Токены — латиница/цифры: «100HS» начинается
    // с цифры, поэтому прежняя регулярка \b[A-Z] его теряла и модель была null.
    const latinTokens = (text.match(/\b[A-Z][A-Za-z0-9-]{2,}\b|\b\d{2,}[A-Za-z][A-Za-z0-9-]*\b/g) || [])
      .filter((w) => !/^(ТКП|КП|ТЗ|ГОСТ|РФ|ИНН|КПП|ЭДО|FWD|RE|Тел|Email|Com|Www|Ru)$/i.test(w));
    // Ищем «марка + модель»: слово с заглавной, за ним 1-3 токена, среди которых
    // хотя бы один содержит цифру.
    let model = null;
    for (let i = 0; i < latinTokens.length; i++) {
      const win = latinTokens.slice(i, i + 4);
      const hasDigit = win.some((w) => /\d/.test(w));
      if (win.length >= 2 && hasDigit) {
        // берём до последнего токена с цифрой включительно
        let end = win.length - 1;
        while (end > 0 && !/\d/.test(win[end])) end--;
        if (end >= 1) {
          model = win.slice(0, end + 1).join(' ');
          break;
        }
      }
    }
    // D-299: кириллические марки (АВГ-75, КУ-101, ВВД-1,6) — до латиницы,
    // иначе «АВО АВГ-75» ловилось как латинский токен и теряло модель.
    const cyrModel = text.match(/\b(\d?[А-ЯЁ]{2,5}[-–]\d+[\d.,/-]*[А-ЯЁA-Za-z]*)\b/);
    if (cyrModel) model = cyrModel[1].trim();
    // Дополняем типом/типоразмером, если он есть в тексте рядом.
    const typeHit = text.match(/(?:тип|модель|типоразмер)\s*[:\s]*([A-ZА-Я][A-ZА-Я0-9-]{1,10})/i);
    if (model && typeHit && !model.includes(typeHit[1])) {
      model += ` ${typeHit[1]}`;
    }
    // Производительность — резко сужает поиск до нужного типоразмера.
    const perfHit = text.match(/(\d+[.,]?\d*)\s*(т\/ч|кВт|Гкал)/i);
    const perf = perfHit ? ` ${perfHit[1]} ${perfHit[2]}` : '';

    if (!model) return '';

    // 1) Сеть: паспорт/характеристики из открытых источников.
    let webFacts = '';
    try {
      const res = await aiProvider.searchWeb({
        query: `${model}${perf} паспорт площадь поверхности нагрева м2 объём воды м3`,
        maxResults: 5
      });
      const answer = String(res && res.answer ? res.answer : '').trim();
      if (answer && answer.length > 80 && !/^\[(пустой|Ошибка)/.test(answer)) {
        webFacts = answer.slice(0, 2500);
      }
    } catch (e) {
      console.warn('[PreTender] web research failed:', e.message);
    }

    // 2) Если сеть пуста — спрашиваем модель по её знаниям (страховка).
    if (!webFacts) {
      try {
        const resp = await aiProvider.complete({
          system: 'Ты инженер-теплотехник. Отвечай ТОЛЬКО фактами из паспортов оборудования. '
            + 'Если точных данных нет — напиши "точных данных нет". Не выдумывай.',
          messages: [{
            role: 'user',
            content: `Паспортные характеристики «${model}» для расчёта промывки/очистки: `
              + 'площадь поверхности нагрева м², объём воды м³, количество секций, производительность. '
              + 'Коротким списком «параметр: значение». Если модель неизвестна — так и напиши.'
          }],
          maxTokens: 600,
          temperature: 0.1,
          reasoning: { enabled: false }
        });
        const answer = String(resp && resp.text ? resp.text : '').trim();
        if (answer && !/^точных данных нет/i.test(answer)) {
          webFacts = answer.slice(0, 1500);
        }
      } catch (e) {
        console.warn('[PreTender] model research failed:', e.message);
      }
    }

    if (!webFacts) return '';
    return `Модель: ${model}\n${webFacts}`;
  } catch (e) {
    console.warn('[PreTender] equipment research skipped:', e.message);
    return '';
  }
}

// ── Информация о загрузке ────────────────────────────────────────────
async function getWorkloadInfo() {
  try {
    const [works, employees] = await Promise.all([
      db.query(`SELECT COUNT(*) as cnt FROM works WHERE work_status IN ('В работе','Мобилизация','Подготовка','На паузе','Подписание акта')`),
      db.query(`SELECT COUNT(*) as cnt FROM employees WHERE is_active = true`)
    ]);
    const activeWorks = parseInt(works.rows[0]?.cnt || 0);
    const freeWorkers = parseInt(employees.rows[0]?.cnt || 0);
    return `Активных работ: ${activeWorks}, Свободных рабочих: ${freeWorkers}`;
  } catch (e) {
    return 'Данные о загрузке недоступны';
  }
}

// Назначить pre_tender РП + создать карточку личного канбана (автоназначение из письма).
async function assignPreTenderToPm(ptId, pmUserId, movedBy, noteText) {
  const personalKanban = require('../routes/personal-kanban');
  await db.query(
    `UPDATE pre_tender_requests SET assigned_to = $1, updated_at = NOW() WHERE id = $2`,
    [pmUserId, ptId]
  );
  const info = await db.query(
    'SELECT customer_name, work_description FROM pre_tender_requests WHERE id=$1', [ptId]);
  const meta = info.rows[0] || {};
  const newSub = await personalKanban.ensureDefaultSubstages(db, pmUserId, 'pre_tender', 'new');
  const cIns = await db.query(
    `INSERT INTO personal_kanban_cards
        (owner_user_id, flow_type, entity_kind, entity_id, current_main_status, current_substage_id)
      VALUES ($1, 'pre_tender', 'pre_tender', $2, 'new', $3)
      ON CONFLICT (owner_user_id, entity_kind, entity_id)
        DO UPDATE SET is_closed=false, last_moved_at=NOW(), updated_at=NOW()
      RETURNING id, (xmax = 0) AS is_new`,
    [pmUserId, ptId, newSub]);
  const cardId = cIns.rows[0]?.id;
  const isNew = cIns.rows[0]?.is_new;
  if (cardId) {
    const finalNote = noteText
      || `${isNew ? 'Создана' : 'Переоткрыта'}: ${meta.customer_name || meta.work_description?.slice(0, 80) || `pre_tender #${ptId}`}`;
    await db.query(
      `INSERT INTO personal_kanban_card_history
          (card_id, to_main_status, moved_by, action, note)
        VALUES ($1, 'new', $2, $3, $4)`,
      [cardId, movedBy || pmUserId, isNew ? 'create' : 'reopen', finalNote]);
  }
  // inbox_application: если есть — тоже назначаем РП
  try {
    await db.query(
      `UPDATE inbox_applications ia
          SET assigned_pm_id = $1, status = 'assigned', assigned_at = NOW(), updated_at = NOW()
        FROM pre_tender_requests pt
       WHERE pt.id = $2 AND ia.email_id = pt.email_id AND ia.assigned_pm_id IS NULL`,
      [pmUserId, ptId]);
  } catch (_) {}
  return { card_id: cardId };
}

module.exports = {
  createPreTenderFromEmail,
  assignPreTenderToPm,
  analyzePreTender,
  getWorkloadInfo,
  SYSTEM_PROMPT,
  // Диагностика: что реально попадает в промпт из вложений (D-292).
  __extractTextForDebug: extractTextFromFile,
  __extractTextFromZip: extractTextFromZip
};
