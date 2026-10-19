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
    "customer_name": "...",
    "customer_inn": "... или null",
    "contact_person": "... или null",
    "contact_phone": "... или null",
    "work_description": "Что именно нужно сделать — 2-4 предложения деловым языком, НЕ копия письма",
    "work_location": "... или null",
    "work_deadline": "YYYY-MM-DD или null",
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
- Перечисли КАЖДУЮ работу отдельной позицией со СВОЕЙ единицей измерения.
  Чистка ёмкости — м³. Мойка поверхности — м². Сварка — стыков. Трубы — п.м.
  Оборудование — шт/компл. Если объём не указан — volume: null.
- Если в письме объём не назван — верни пустой массив [].

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
           ia.ai_raw_json
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
  const workTitle = (email.work_title || '').trim()
    || [email.ai_work_type, customerName].filter(Boolean).join(' · ').slice(0, 200)
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

const MAX_TEXT_PER_FILE = 10000;  // chars per file (increased for detailed analysis)
const MAX_TEXT_TOTAL = 30000;     // total chars for all attachments
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB for vision

// Типы файлов, поддерживающие мультимодальную отправку (изображения)
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

async function extractTextFromFile(filePath, mimeType) {
  try {
    const absPath = path.join(__dirname, '..', '..', filePath);
    if (!fs.existsSync(absPath)) return null;
    const stats = fs.statSync(absPath);
    if (stats.size > MAX_FILE_SIZE) return null;

    const buf = fs.readFileSync(absPath);
    const lc = (filePath || '').toLowerCase();

    // PDF
    if (mimeType === 'application/pdf' || lc.endsWith('.pdf')) {
      const pdfParse = require('pdf-parse');
      const result = await pdfParse(buf);
      return result.text ? result.text.slice(0, MAX_TEXT_PER_FILE) : null;
    }

    // DOCX / DOC
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || lc.endsWith('.docx') || mimeType === 'application/msword' || lc.endsWith('.doc')) {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value ? result.value.slice(0, MAX_TEXT_PER_FILE) : null;
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

    return null;
  } catch (err) {
    console.warn('[PreTender] Text extraction error:', filePath, err.message);
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
        customer_name = COALESCE(NULLIF($11, ''), customer_name),
        customer_inn = COALESCE(NULLIF($12, ''), customer_inn),
        contact_person = COALESCE(NULLIF($13, ''), contact_person),
        contact_phone = COALESCE(NULLIF($14, ''), contact_phone),
        work_description = COALESCE(NULLIF($15, ''), work_description),
        work_location = COALESCE(NULLIF($16, ''), work_location),
        work_deadline = COALESCE($17, work_deadline),
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
      result.work_type || ''
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
    return {
      work_title: p.work_title ? String(p.work_title).trim().slice(0, 200) : null,
      work_type: p.work_type ? String(p.work_type).trim().slice(0, 200) : null,
      scope_items: scopeItems,
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
 * V416: дотягиваем контакты, которые ИИ не выделил.
 *  1. Телефон — регэкспом из тела письма (RU-форматы, +7/8, скобки, дефисы).
 *  2. ИНН — из справочника customers по точному совпадению названия.
 * Пишем только если поле пустое: ручные правки РП не перетираем.
 */
async function applyContactFallbacks(preTenderId, pt, result, dbc = db) {
  try {
    const text = String(pt.body_text || '') + '\n' + String(pt.work_description || '');
    // Телефоны: +7 (495) 123-45-67, 8-800-555-35-35, 3446003396 — только с разделителями
    // или префиксом, чтобы не выхватить ИНН/год/объём из текста.
    const phoneRe = /(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)/g;
    const phoneMatches = text.match(phoneRe) || [];
    // Отсекаем НАШИ номера (подпись Асгарда в пересылаемом письме), иначе клиенту
    // доставался телефон менеджера, а не заказчика.
    const OWN_PHONE_RE = /^(?:\+?7|8)?(?:499|495|800|812)\d{7}$/;
    const firstPhone = phoneMatches
      .map((p) => p.replace(/[^\d+]/g, ''))
      .map((p) => (p.startsWith('8') ? '+7' + p.slice(1) : p))
      .find((p) => p.replace(/\D/g, '').length >= 10 && !OWN_PHONE_RE.test(p)) || null;

    const updates = [];
    const vals = [];
    let i = 1;

    const cur = await dbc.query(
      'SELECT contact_phone, customer_inn, work_title FROM pre_tender_requests WHERE id = $1',
      [preTenderId]);
    const row = cur.rows[0] || {};

    if (!row.contact_phone && !result.extracted_data?.contact_phone && firstPhone) {
      updates.push(`contact_phone = $${i++}`);
      vals.push(firstPhone.slice(0, 30));
    }

    if (!row.customer_inn && !result.extracted_data?.customer_inn && row.work_title !== undefined) {
      const name = String(result.extracted_data?.customer_name || pt.customer_name || '').trim();
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
        const hit = all.rows.find((r) => norm(r.name) === target)
          || all.rows.find((r) => target.length > 6 && (norm(r.name).includes(target) || target.includes(norm(r.name))));
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
  SYSTEM_PROMPT
};
