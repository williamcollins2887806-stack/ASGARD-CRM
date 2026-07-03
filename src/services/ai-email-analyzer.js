/**
 * ASGARD CRM — AI Email Analyzer Service
 * Фаза 9: Анализ входящих писем с помощью ИИ
 *
 * Классифицирует входящие письма по:
 *  - Тип заявки (прямой запрос, тендерная площадка, КП, информация)
 *  - Цвет (green/yellow/red) — рекомендация по приоритету
 *  - Краткое резюме и рекомендация
 */

'use strict';

const db = require('./db');
const aiProvider = require('./ai-provider');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Распаковка архивов (ZIP, RAR, 7Z, TAR.GZ) с рекурсией ─────────────

const ARCHIVE_EXTENSIONS = ['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.tar.gz', '.bz2', '.tar.bz2'];
const ARCHIVE_MIMES = [
  'application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed',
  'application/x-rar', 'application/vnd.rar', 'application/x-7z-compressed',
  'application/gzip', 'application/x-gzip', 'application/x-tar',
  'application/x-bzip2', 'application/x-compressed'
];
const MAX_ARCHIVE_DEPTH = 3; // макс. уровень вложенности архивов
const MAX_EXTRACTED_FILES = 30; // макс. файлов из всех архивов суммарно

function isArchiveFile(filename, mimeType) {
  const ext = (filename || '').toLowerCase();
  if (ARCHIVE_MIMES.includes(mimeType)) return true;
  return ARCHIVE_EXTENSIONS.some(e => ext.endsWith(e));
}

/**
 * Рекурсивно извлекает файлы из архива во временную папку.
 * Поддерживает: ZIP (adm-zip), RAR (unrar CLI), 7Z (7z CLI), TAR/GZ (tar CLI).
 * Архивы внутри архивов распаковываются рекурсивно до MAX_ARCHIVE_DEPTH уровней.
 * @returns {Array<{filename: string, absPath: string}>} — список извлечённых файлов
 */
function extractArchiveRecursive(archivePath, originalFilename, depth = 0) {
  if (depth >= MAX_ARCHIVE_DEPTH) {
    console.log(`[Archive] Max depth ${MAX_ARCHIVE_DEPTH} reached, skipping: "${originalFilename}"`);
    return [];
  }

  const ext = (originalFilename || archivePath).toLowerCase();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `archive-d${depth}-`));
  let extracted = [];

  try {
    // ZIP
    if (ext.endsWith('.zip') || ext.endsWith('.jar')) {
      try {
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(archivePath);
        zip.extractAllTo(tmpDir, true);
        console.log(`[Archive] ZIP extracted: "${originalFilename}" → ${tmpDir}`);
      } catch (zipErr) {
        console.error(`[Archive] ZIP error "${originalFilename}":`, zipErr.message);
        cleanupDir(tmpDir);
        return [];
      }
    }
    // RAR
    else if (ext.endsWith('.rar')) {
      try {
        const { execSync } = require('child_process');
        execSync(`unrar x -o+ -y "${archivePath}" "${tmpDir}/"`, { timeout: 60000, stdio: 'pipe' });
        console.log(`[Archive] RAR extracted: "${originalFilename}" → ${tmpDir}`);
      } catch (rarErr) {
        console.error(`[Archive] RAR error "${originalFilename}":`, rarErr.message);
        cleanupDir(tmpDir);
        return [];
      }
    }
    // 7Z
    else if (ext.endsWith('.7z')) {
      try {
        const { execSync } = require('child_process');
        execSync(`7z x -y -o"${tmpDir}" "${archivePath}"`, { timeout: 60000, stdio: 'pipe' });
        console.log(`[Archive] 7Z extracted: "${originalFilename}" → ${tmpDir}`);
      } catch (szErr) {
        console.error(`[Archive] 7Z error "${originalFilename}":`, szErr.message);
        cleanupDir(tmpDir);
        return [];
      }
    }
    // TAR, TAR.GZ, TGZ, TAR.BZ2
    else if (ext.endsWith('.tar') || ext.endsWith('.tar.gz') || ext.endsWith('.tgz')
          || ext.endsWith('.tar.bz2') || ext.endsWith('.gz') || ext.endsWith('.bz2')) {
      try {
        const { execSync } = require('child_process');
        execSync(`tar xf "${archivePath}" -C "${tmpDir}"`, { timeout: 60000, stdio: 'pipe' });
        console.log(`[Archive] TAR extracted: "${originalFilename}" → ${tmpDir}`);
      } catch (tarErr) {
        console.error(`[Archive] TAR error "${originalFilename}":`, tarErr.message);
        cleanupDir(tmpDir);
        return [];
      }
    }
    else {
      cleanupDir(tmpDir);
      return [];
    }

    // Сканируем извлечённые файлы
    const files = listFilesRecursive(tmpDir);
    for (const filePath of files) {
      if (extracted.length >= MAX_EXTRACTED_FILES) break;
      const fname = path.basename(filePath);

      // Если это вложенный архив — рекурсия
      if (isArchiveFile(fname, '')) {
        const nested = extractArchiveRecursive(filePath, fname, depth + 1);
        for (const n of nested) {
          if (extracted.length < MAX_EXTRACTED_FILES) extracted.push(n);
        }
      } else {
        extracted.push({ filename: fname, absPath: filePath, tmpDir });
      }
    }
  } catch (err) {
    console.error(`[Archive] General error extracting "${originalFilename}":`, err.message);
  }

  // НЕ удаляем tmpDir здесь — файлы ещё нужны для чтения. Удалим позже.
  return extracted;
}

function listFilesRecursive(dir) {
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(listFilesRecursive(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch (_) {}
  return results;
}

function cleanupDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ── Фильтрация писем ДО отправки в AI ────────────────────────────────

/**
 * Pre-filter: проверяет, нужно ли пропустить письмо БЕЗ AI-анализа.
 * Возвращает { skip: true/false, reason: string }
 */
function shouldSkipEmail(email) {
  const { fromEmail, subject, bodyText } = email;
  const from = (fromEmail || '').toLowerCase();
  const subj = (subject || '').toLowerCase();
  const body = (bodyText || '').toLowerCase().substring(0, 2000);

  // 1. Skip bounce/non-delivery notifications
  const bouncePatterns = [
    'mailer-daemon', 'postmaster@', 'noreply', 'no-reply',
    'mail delivery', 'delivery status', 'undeliverable',
    'returned mail', 'delivery failure', 'delivery has failed',
    'not delivered', 'could not be delivered', 'unable to deliver',
    'автоматический ответ', 'automatic reply', 'auto-reply',
    'out of office', 'вне офиса'
  ];

  for (const p of bouncePatterns) {
    if (from.includes(p) || subj.includes(p) || body.includes(p.toLowerCase())) {
      return { skip: true, reason: 'bounce_or_auto_reply' };
    }
  }

  // 2. Skip internal emails (from company domain)
  const internalDomains = ['asgard-crm.ru', 'asgard-service.ru', 'asgard-s.ru', 'асгард.рф'];
  for (const d of internalDomains) {
    if (from.includes(d)) {
      return { skip: true, reason: 'internal_email' };
    }
  }

  // 3. Skip system notifications
  const systemPatterns = [
    'notification@', 'alert@', 'system@', 'info@calendar',
    'уведомление', 'системное сообщение'
  ];
  for (const p of systemPatterns) {
    if (from.includes(p) || subj.includes(p)) {
      return { skip: true, reason: 'system_notification' };
    }
  }

  return { skip: false };
}

// ── System prompt для анализа входящих писем ─────────────────────────

const ANALYSIS_SYSTEM_PROMPT = `Ты — AI-ассистент компании АСГАРД СЕРВИС (нефтегазовый сервис).
Компания выполняет промышленные работы на объектах нефтегазовой отрасли:
- Промывка трубопроводов и ёмкостей
- Химическая обработка оборудования
- Монтаж/демонтаж технологического оборудования
- Антикоррозийная защита
- Изоляционные работы
- Сварочные работы (НАКС)
- Работы на высоте
- Такелажные и стропальные работы
- Работы в ограниченных пространствах

Твоя задача — проанализировать входящее письмо и классифицировать его.

Верни ответ СТРОГО в JSON формате:
{
  "classification": "direct_request" | "platform_tender" | "tender_invitation" | "addendum_response" | "commercial_offer" | "information" | "spam" | "personal" | "other",
  "parent_tender_inn": "ИНН отправителя для поиска тендера (только для addendum_response, иначе null)",
  "parent_tender_hint": "номер тендера/название/лот из темы для fuzzy match (только для addendum_response, иначе null)",
  "parent_tender_id": null,
  "color": "green" | "yellow" | "red",
  "summary": "Краткое описание сути письма (1-2 предложения)",
  "recommendation": "Рекомендация действий (1-2 предложения)",
  "work_type": "Тип работ (если определяется) или null",
  "estimated_budget": число или null,
  "estimated_days": число или null,
  "keywords": ["ключевое_слово_1", "ключевое_слово_2"],
  "confidence": 0.0-1.0,
  "is_forwarded": true | false,
  "original_sender_name": "ФИО оригинального клиента (НЕ нашего сотрудника-переслателя) или null",
  "original_sender_email": "email клиента (НЕ переслателя) или null",
  "original_sender_company": "название компании клиента (если есть в подписи или ИНН-блоке) или null",
  "forwarder_name": "ФИО нашего сотрудника, который переслал письмо (если письмо переслано) или null",
  "forwarder_email": "email переслателя (наш сотрудник) или null",
  "extracted_customer_name": "Полное название организации-клиента из карточки/реквизитов/печати/шильдика (например: 'ООО Барилла Рус', 'АО Кордиант', 'ИП Иванов И.И.') или null",
  "extracted_customer_inn": "ИНН клиента 10 или 12 цифр строго (с печати, карточки, реквизитной части) или null",
  "extracted_customer_kpp": "КПП 9 цифр (если есть в карточке) или null",
  "extracted_customer_ogrn": "ОГРН 13 или 15 цифр (если есть) или null",
  "extracted_customer_address": "юридический или фактический адрес клиента (из карточки/реквизитов) или null",
  "extracted_customer_phone": "телефон клиента (из карточки/подписи) +7..., или null",
  "extracted_customer_contact_person": "ФИО контактного лица (директор/менеджер/инженер) из карточки или подписи или null",
  "extracted_customer_contact_email": "email клиента (НЕ нашего домена) из карточки или подписи или null",
  "extracted_equipment": "Описание оборудования из фото шильдика/паспорта (марка, модель, год выпуска, серийный номер, тех.характеристики) или null"
}

Правила цветовой маркировки:
- GREEN: Наш профиль работ, есть потенциал, стоит брать в работу
- YELLOW: Частично наш профиль, нужна дополнительная оценка, сжатые сроки
- RED: Не наш профиль, нет ресурсов, спам, или нерелевантная заявка

Правила классификации:
- direct_request: Прямой запрос на выполнение работ от заказчика
- platform_tender: Тендер с площадки (Закупки44, ЕИС, Сбербанк-АСТ и т.д.)
- tender_invitation: Письмо-приглашение принять участие в тендере от заказчика напрямую (НЕ с площадки ЭТП). Email обычно от организации с реквизитами, содержит описание объёмов работ или НМЦК, требует подачу КП в указанный срок. Триггеры: «Приглашаем принять участие», «Объявляется закупка», «Прошу направить КП на участие в тендере», «Запрос предложений на тендер», «Приглашение к участию в закупке». ОТЛИЧИЕ от direct_request: явная формулировка о тендере/закупке + срок подачи КП. ОТЛИЧИЕ от platform_tender: пришло почтой напрямую, без ссылки на площадку ЕИС/Сбер-АСТ/Roseltorg.
- addendum_response: Продолжение переписки по СУЩЕСТВУЮЩЕМУ тендеру/работе — НЕ создание нового. Дозапрос организатора, уточнение, протокол разногласий, изменение в извещении, дополнительные вопросы по КП, продление сроков, изменение НМЦК. Триггеры: «Дозапрос», «Уточнение по тендеру №», «Протокол разногласий», «Изменение в извещении», «Дополнительные вопросы по КП», «Ваше предложение по тендеру», «Уточнение по нашему запросу», «Продление срока подачи КП», «Изменение НМЦК». ОТЛИЧИЕ от tender_invitation: ссылается на УЖЕ ПОДАННОЕ нами КП или существующий тендер (номер закупки/лота, наша компания упоминается как уже-участник). При этой классификации ЗАПОЛНЯЙ parent_tender_inn (ИНН отправителя), parent_tender_hint (номер/название тендера из темы), parent_tender_id оставляй null (бэк найдёт сам).
- commercial_offer: Входящее коммерческое предложение (нам предлагают)
- information: Информационное письмо, уведомление
- spam: Спам, рассылка
- personal: Личное письмо
- other: Другое

ВАЖНО: Классифицируй как "direct_request" или "platform_tender" ТОЛЬКО те письма, которые ЯВНО содержат:
- Конкретное описание работ (трубопровод, сварка, монтаж, очистка, антикоррозия и т.д.)
- Приглашение на тендер или запрос ценового предложения
- Техническое задание или объем работ

КРИТИЧНО: Если письмо переслано (Fwd:/Fw:/Перенаправлено/Пересылаемое сообщение) нашим
сотрудником с домена @asgard-service.com И во вложении содержится техническое задание
(ТЗ.docx/pdf), смета, чертёж, объём работ или запрос на выполнение работ — это ВСЕГДА
"direct_request", даже если внутреннее сопроводительное сообщение выглядит как простое
информирование («посмотрите», «на проработку», «вот ТЗ»). Наши сотрудники пересылают
клиентские запросы в CRM именно для того, чтобы заявка была заведена. Не классифицируй
такое как "information".

═══════════════════════════════════════════════════════════════════════════════
КРИТИЧНО: ПАРСИНГ ПЕРЕСЛАННОГО ПИСЬМА (Fwd / Fw / Перенаправлено / Пересылаемое)
═══════════════════════════════════════════════════════════════════════════════
Если письмо переслано — поле "is_forwarded" = true и НИКОГДА не путай
ФОРВАРДЕРА (наш сотрудник) с ОРИГИНАЛЬНЫМ ОТПРАВИТЕЛЕМ (клиент).

ФОРВАРДЕР (forwarder) = тот, кто переслал письмо в CRM.
  - Email с доменом @asgard-service.com / @asgard-crm.ru / @asgard-service.ru
  - Это ВНУТРЕННИЙ сотрудник Асгарда (Путков, Андросов, Газретов и т.д.)
  - В header "From:" письма указан ИМЕННО он
  - В JSON-поля forwarder_name / forwarder_email пиши ЕГО

ОРИГИНАЛЬНЫЙ ОТПРАВИТЕЛЬ (original_sender) = НАСТОЯЩИЙ КЛИЕНТ.
  - НИКОГДА не имеет домен @asgard-service.com / @asgard-crm.ru
  - Находится В ТЕЛЕ письма в цитируемом блоке:
      «От: Иванов Сергей <s.ivanov@client.ru>»
      «From: John Doe <john@example.com>»
      «Пересылаемое сообщение / Forwarded message» + блок «От:/From:»
      Yandex-формат: «19.06.2026, 14:30, "Иван Иванов" <i.ivanov@клиент.ру>:»
  - Также может быть в подписи письма клиента (с должностью + телефоном)
  - В JSON-поля original_sender_name / original_sender_email пиши ИМЕННО его (клиента)

Если в теле НЕСКОЛЬКО блоков «От:/From:» (цепочка пересылок) — бери САМЫЙ ГЛУБОКИЙ
(самый ранний в цепочке), это первоначальный клиент.

Если original_sender в теле НЕ найден или там тоже @asgard-service.com (внутренний
пересыл) — оставь original_sender_name = original_sender_email = null
и НЕ подставляй туда forwarder.

ПРИМЕР (правильно):
  Header From: "Никита Андросов" <n.androsov@asgard-service.com>
  Тело письма:
    «На проработку
     -----Original Message-----
     От: Путков Иван <i.putkov@asgard-service.com>
     От: Кордиант ОАО <a.smirnov@kordiant.ru>
     Тема: ТЗ на химическую промывку
     Здравствуйте, прошу подготовить КП по нашему ТЗ...»
  Правильный разбор:
    is_forwarded: true
    forwarder_name: "Никита Андросов" (он переслал в CRM)
    forwarder_email: "n.androsov@asgard-service.com"
    original_sender_name: "Кордиант ОАО / a.smirnov@kordiant.ru" → бери САМЫЙ ГЛУБОКИЙ внешний
    original_sender_email: "a.smirnov@kordiant.ru" (НЕ asgard-домен)
    original_sender_company: "Кордиант ОАО" (если ясно из подписи / ИНН)

ПРИМЕР ОШИБКИ (НЕ делай так):
  ❌ original_sender_email: "n.androsov@asgard-service.com" — это форвардер, не клиент
  ❌ original_sender_name: "Никита Андросов" — это наш сотрудник
  ❌ original_sender_email: "i.putkov@asgard-service.com" — тоже внутренний, не клиент

Если письмо НЕ переслано (прямое от клиента) — is_forwarded=false,
forwarder_* = null, а original_sender_* можешь взять из подписи письма или
из header From (если он внешний).
═══════════════════════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════════════════════
ОБЯЗАТЕЛЬНО: ИЗВЛЕКАЙ КАРТОЧКУ КЛИЕНТА ИЗ ИЗОБРАЖЕНИЙ И ВЛОЖЕНИЙ
═══════════════════════════════════════════════════════════════════════════════

Если в письме есть ИЗОБРАЖЕНИЯ или PDF-документы с РЕКВИЗИТАМИ КОМПАНИИ
(карточка организации, шапка договора, печать, фирменный бланк, шильдик
оборудования с владельцем) — ОБЯЗАТЕЛЬНО ВНИМАТЕЛЬНО ИХ ПРОЧИТАЙ и заполни
поля extracted_customer_*.

Это КРИТИЧНО:
- На фото может быть КАРТОЧКА КЛИЕНТА (название, ИНН, КПП, ОГРН, адрес, телефон, реквизиты).
  Внимательно прочитай и извлеки ВСЁ что найдёшь.
- На ПЕЧАТИ обычно указано полное название организации + ИНН/ОГРН.
- В ШАПКЕ договора или ТЗ — реквизиты обеих сторон. Бери СТОРОНУ ЗАКАЗЧИКА
  (не «Исполнитель», не «Подрядчик», не «Асгард»).
- На ФИРМЕННОМ БЛАНКЕ обычно логотип + название + адрес + телефон.
- На ШИЛЬДИКЕ оборудования может быть «Владелец: ООО ХХХ, г. ...».

Пример правильного извлечения карточки:
  Видишь скан или фото с текстом:
    «Полное наименование: Открытое акционерное общество "Кордиант"
     Сокращённое: АО «Кордиант»
     ИНН 5044022794   КПП 504401001   ОГРН 1085003001234
     Юр. адрес: 141504, Московская обл., г. Солнечногорск, Бутырский тупик, д.1
     Тел. +7 (495) 123-45-67    Эл. почта: info@kordiant.ru»

  Извлеки:
    extracted_customer_name = "АО «Кордиант»"
    extracted_customer_inn = "5044022794"
    extracted_customer_kpp = "504401001"
    extracted_customer_ogrn = "1085003001234"
    extracted_customer_address = "141504, Московская обл., г. Солнечногорск, Бутырский тупик, д.1"
    extracted_customer_phone = "+7 (495) 123-45-67"
    extracted_customer_contact_email = "info@kordiant.ru"

Пример извлечения оборудования с шильдика (отдельное поле extracted_equipment):
  Видишь шильдик с надписями: «DAELIM ROYAL BOILER, model DL-Z-800,
  S/N 2018-A0123, max steam capacity 2000 kg/h, max pressure 1.0 MPa».
  Извлеки:
    extracted_equipment = "Daelim Royal Boiler DL-Z-800, серийный 2018-A0123, паропроизводительность 2000 кг/ч, давление 1.0 МПа"

ВАЖНО:
- НЕ ПУТАЙ карточку клиента с карточкой оборудования (шильдик).
  - Карточка КЛИЕНТА → extracted_customer_*
  - Шильдик ОБОРУДОВАНИЯ → extracted_equipment
- Если на фото нет реквизитов клиента (только шильдик котла) — оставь
  extracted_customer_* = null, заполни только extracted_equipment.
- Если на фото плохо видно (размыто, обрезано) — попробуй извлечь то что
  читается, остальное null.
- ИНН ВСЕГДА 10 цифр (юр.лица) или 12 (ИП). Если в распознанном тексте 9
  или 11 цифр — это ОШИБКА OCR, оставь null.
- НИКОГДА не выдумывай реквизиты. Только то что реально видно на фото/PDF.
═══════════════════════════════════════════════════════════════════════════════

НЕ классифицируй как заявку:
- Внутреннюю переписку между сотрудниками БЕЗ пересланного клиентского запроса/ТЗ
- Уведомления о недоставке писем (bounce, delivery failure)
- Рассылки, рекламу, спам
- Автоматические ответы (out of office, автоответ)
- Переписку без упоминания конкретных работ
- Информационные рассылки и новостные дайджесты

"information" — это уведомления, рассылки, календарные напоминания, корпоративные
новости — то, что НЕ требует ответа клиенту. Пересланное ТЗ — это НЕ "information".

Если сомневаешься — классифицируй как "information" или "other", а НЕ как заявку.

ВАЖНО: Отвечай ТОЛЬКО JSON, без markdown-форматирования, без \`\`\`json блоков.`;

// ── Извлечение текста из вложений для классификации ──────────────────

const MAX_EXTRACT_PER_FILE = 15000; // For classification (short analysis)
const MAX_EXTRACT_PER_FILE_REPORT = 100000; // For reports — full TZ documents (50+ pages)
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * Resolve attachment file path — tries multiple base directories for robustness
 * (handles PM2, Docker, and different cwd scenarios)
 */
function resolveAttachmentPath(filePath) {
  // Candidate base directories
  const bases = [
    path.join(__dirname, '..', '..'),           // src/services/../../ → project root
    process.cwd(),                               // Current working directory (PM2 may change this)
    path.resolve('.'),                           // Explicit resolve of '.'
    '/app',                                      // Docker container path
  ];

  for (const base of bases) {
    const candidate = path.join(base, filePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Also try absolute path as-is (in case file_path is already absolute)
  if (path.isAbsolute(filePath) && fs.existsSync(filePath)) {
    return filePath;
  }

  return null;
}

/**
 * Convert PDF pages to PNG images using pdftoppm (poppler-utils).
 * Returns array of image blocks suitable for Vision API (both OpenAI and Anthropic).
 * Renders first 4 pages at 150 DPI to keep size manageable.
 */
async function convertPdfToImages(pdfPath, filename) {
  const { execSync } = require('child_process');
  const os = require('os');
  const images = [];

  let tmpDir;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-ocr-'));
    const outPrefix = path.join(tmpDir, 'page');

    // Convert first 4 pages at 150 DPI to PNG
    execSync(`pdftoppm -png -r 150 -l 4 "${pdfPath}" "${outPrefix}"`, {
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Read generated page images (sorted)
    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith('page-') && f.endsWith('.png')).sort();
    for (const f of files) {
      const imgBuf = fs.readFileSync(path.join(tmpDir, f));
      // Skip if single image is too large (> 4MB)
      if (imgBuf.length > 4 * 1024 * 1024) continue;
      images.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: imgBuf.toString('base64') }
      });
    }
    console.log(`[AI-Analyzer] pdftoppm: converted "${filename}" → ${files.length} pages, ${images.length} usable images`);
  } catch (err) {
    console.error(`[AI-Analyzer] pdftoppm conversion failed for "${filename}":`, err.message);
  } finally {
    // Cleanup temp directory
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
  return images;
}

async function extractAttachmentTexts(emailId, { maxPerFile = MAX_EXTRACT_PER_FILE } = {}) {
  if (!emailId) {
    console.log('[AI-Analyzer] extractAttachmentTexts: no emailId provided');
    return { texts: [], imageBlocks: [] };
  }
  try {
    const attRes = await db.query(
      'SELECT original_filename, mime_type, size, file_path FROM email_attachments WHERE email_id = $1',
      [emailId]
    );
    console.log(`[AI-Analyzer] Email #${emailId}: found ${attRes.rows.length} attachments in DB`);
    if (!attRes.rows.length) return { texts: [], imageBlocks: [] };

    const texts = [];
    const imageBlocks = [];

    for (const a of attRes.rows) {
      console.log(`[AI-Analyzer] Processing attachment: "${a.original_filename}" mime=${a.mime_type} file_path=${a.file_path}`);
      if (!a.file_path) { console.log(`[AI-Analyzer] SKIP: no file_path for "${a.original_filename}"`); continue; }

      const absPath = resolveAttachmentPath(a.file_path);
      if (!absPath) {
        console.error(`[AI-Analyzer] FILE NOT FOUND for "${a.original_filename}": tried file_path="${a.file_path}", __dirname=${__dirname}, cwd=${process.cwd()}`);
        continue;
      }
      console.log(`[AI-Analyzer] Resolved path: ${absPath} (${fs.statSync(absPath).size} bytes)`);

      // Изображения — готовим для Vision (лимит поднят 3 → 15, чтобы карточка
      // клиента не выпала из батча когда там 8+ фото шильдиков оборудования).
      if (IMAGE_MIMES.includes(a.mime_type) && imageBlocks.length < 15) {
        const stats = fs.statSync(absPath);
        if (stats.size <= 10 * 1024 * 1024) {
          const buf = fs.readFileSync(absPath);
          imageBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: a.mime_type, data: buf.toString('base64') }
          });
          console.log(`[AI-Analyzer] Added image: "${a.original_filename}" (${stats.size} bytes)`);
        }
        continue;
      }

      // XLSX
      if (a.mime_type?.includes('spreadsheet') || a.mime_type?.includes('ms-excel')
          || a.file_path.endsWith('.xlsx') || a.file_path.endsWith('.xls')) {
        try {
          const ExcelJS = require('exceljs');
          const buf = fs.readFileSync(absPath);
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buf);
          const lines = [];
          workbook.eachSheet((sheet, sheetId) => {
            if (sheetId > 2) return;
            lines.push(`[${sheet.name}]`);
            let cnt = 0;
            sheet.eachRow((row) => {
              if (cnt++ > 100) return;
              const vals = [];
              row.eachCell((cell) => {
                const v = cell.text || cell.value;
                if (v != null && v !== '') vals.push(String(v).trim());
              });
              if (vals.length) lines.push(vals.join(' | '));
            });
          });
          if (lines.length) {
            texts.push(`[${a.original_filename}]\n${lines.join('\n').slice(0, maxPerFile)}`);
            console.log(`[AI-Analyzer] Extracted XLSX: "${a.original_filename}" → ${lines.length} lines`);
          }
        } catch (xlsErr) {
          console.error(`[AI-Analyzer] XLSX extraction error for "${a.original_filename}":`, xlsErr.message);
        }
        continue;
      }

      // PDF
      if (a.mime_type === 'application/pdf' || a.file_path.endsWith('.pdf')) {
        const buf = fs.readFileSync(absPath);
        let pdfTextOk = false;

        // Try text extraction first
        try {
          const pdfParse = require('pdf-parse');
          console.log(`[AI-Analyzer] Parsing PDF: "${a.original_filename}" (${buf.length} bytes)`);
          const result = await pdfParse(buf);
          const cleanText = (result.text || '').replace(/\s+/g, ' ').trim();
          if (cleanText.length > 100) {
            texts.push(`[${a.original_filename}]\n${result.text.slice(0, maxPerFile)}`);
            console.log(`[AI-Analyzer] Extracted PDF text: "${a.original_filename}" → ${result.text.length} chars, ${result.numpages || '?'} pages`);
            pdfTextOk = true;
          } else {
            console.warn(`[AI-Analyzer] PDF has too little text (${cleanText.length} chars) — likely scanned/image PDF: "${a.original_filename}"`);
          }
        } catch (pdfErr) {
          console.error(`[AI-Analyzer] PDF text extraction error for "${a.original_filename}":`, pdfErr.message);
        }

        // Fallback: convert scanned PDF pages to PNG images for Vision API
        // Works with both OpenAI (GPT-4o) and Anthropic (Claude)
        if (!pdfTextOk && buf.length <= 30 * 1024 * 1024) {
          const pdfImages = await convertPdfToImages(absPath, a.original_filename);
          if (pdfImages.length > 0) {
            for (const img of pdfImages) {
              if (imageBlocks.length < 5) imageBlocks.push(img); // limit total images
            }
            console.log(`[AI-Analyzer] Converted scanned PDF to ${pdfImages.length} page images: "${a.original_filename}"`);
          } else {
            console.warn(`[AI-Analyzer] Could not convert scanned PDF to images: "${a.original_filename}" — install poppler-utils (apt install poppler-utils)`);
          }
        }
        continue;
      }

      // DOCX
      if (a.file_path.endsWith('.docx') || a.mime_type?.includes('wordprocessingml')) {
        try {
          const mammoth = require('mammoth');
          const buf = fs.readFileSync(absPath);
          const result = await mammoth.extractRawText({ buffer: buf });
          if (result.value) {
            texts.push(`[${a.original_filename}]\n${result.value.slice(0, maxPerFile)}`);
            console.log(`[AI-Analyzer] Extracted DOCX: "${a.original_filename}" → ${result.value.length} chars`);
          }
        } catch (docxErr) {
          console.error(`[AI-Analyzer] DOCX extraction error for "${a.original_filename}":`, docxErr.message);
        }
        continue;
      }

      // TXT, RTF, CSV and other text-based files
      if (a.file_path.endsWith('.txt') || a.file_path.endsWith('.rtf') || a.file_path.endsWith('.csv')
          || a.mime_type?.startsWith('text/') || a.mime_type === 'application/rtf') {
        try {
          const content = fs.readFileSync(absPath, 'utf-8');
          if (content) {
            texts.push(`[${a.original_filename}]\n${content.slice(0, maxPerFile)}`);
            console.log(`[AI-Analyzer] Extracted text: "${a.original_filename}" → ${content.length} chars`);
          }
        } catch (txtErr) {
          console.error(`[AI-Analyzer] Text extraction error for "${a.original_filename}":`, txtErr.message);
        }
        continue;
      }

      // DOC (old Word format) — try reading as text
      if (a.file_path.endsWith('.doc') || a.mime_type === 'application/msword') {
        try {
          const buf = fs.readFileSync(absPath);
          // Extract readable text from binary DOC (basic approach)
          const text = buf.toString('utf-8').replace(/[^\x20-\x7E\u0400-\u04FF\n\r\t]/g, ' ').replace(/\s{3,}/g, ' ').trim();
          if (text.length > 50) {
            texts.push(`[${a.original_filename}]\n${text.slice(0, maxPerFile)}`);
            console.log(`[AI-Analyzer] Extracted DOC: "${a.original_filename}" → ${text.length} chars`);
          }
        } catch (docErr) {
          console.error(`[AI-Analyzer] DOC extraction error for "${a.original_filename}":`, docErr.message);
        }
        continue;
      }

      // АРХИВЫ (ZIP, RAR, 7Z, TAR.GZ) — рекурсивная распаковка
      if (isArchiveFile(a.original_filename, a.mime_type)) {
        console.log(`[AI-Analyzer] Archive detected: "${a.original_filename}" — extracting...`);
        const tmpDirsSet = new Set();
        try {
          const extracted = extractArchiveRecursive(absPath, a.original_filename, 0);
          console.log(`[AI-Analyzer] Archive "${a.original_filename}": ${extracted.length} files extracted`);

          for (const ef of extracted) {
            if (ef.tmpDir) tmpDirsSet.add(ef.tmpDir);
            const efExt = ef.filename.toLowerCase();

            // PDF из архива
            if (efExt.endsWith('.pdf')) {
              try {
                const pdfParse = require('pdf-parse');
                const buf = fs.readFileSync(ef.absPath);
                const result = await pdfParse(buf);
                if (result.text && result.text.trim().length > 50) {
                  texts.push(`[${a.original_filename} → ${ef.filename}]\n${result.text.slice(0, maxPerFile)}`);
                  console.log(`[AI-Analyzer] Archive PDF: "${ef.filename}" → ${result.text.length} chars`);
                }
              } catch (pdfErr) {
                console.error(`[AI-Analyzer] Archive PDF error "${ef.filename}":`, pdfErr.message);
              }
              continue;
            }

            // DOCX из архива
            if (efExt.endsWith('.docx')) {
              try {
                const mammoth = require('mammoth');
                const buf = fs.readFileSync(ef.absPath);
                const result = await mammoth.extractRawText({ buffer: buf });
                if (result.value) {
                  texts.push(`[${a.original_filename} → ${ef.filename}]\n${result.value.slice(0, maxPerFile)}`);
                  console.log(`[AI-Analyzer] Archive DOCX: "${ef.filename}" → ${result.value.length} chars`);
                }
              } catch (docxErr) {
                console.error(`[AI-Analyzer] Archive DOCX error "${ef.filename}":`, docxErr.message);
              }
              continue;
            }

            // XLSX из архива
            if (efExt.endsWith('.xlsx') || efExt.endsWith('.xls')) {
              try {
                const ExcelJS = require('exceljs');
                const buf = fs.readFileSync(ef.absPath);
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(buf);
                const lines = [];
                workbook.eachSheet((sheet, sheetId) => {
                  if (sheetId > 2) return;
                  lines.push(`[${sheet.name}]`);
                  let cnt = 0;
                  sheet.eachRow((row) => {
                    if (cnt++ > 100) return;
                    const vals = [];
                    row.eachCell((cell) => {
                      const v = cell.text || cell.value;
                      if (v != null && v !== '') vals.push(String(v).trim());
                    });
                    if (vals.length) lines.push(vals.join(' | '));
                  });
                });
                if (lines.length) {
                  texts.push(`[${a.original_filename} → ${ef.filename}]\n${lines.join('\n').slice(0, maxPerFile)}`);
                  console.log(`[AI-Analyzer] Archive XLSX: "${ef.filename}" → ${lines.length} lines`);
                }
              } catch (xlsErr) {
                console.error(`[AI-Analyzer] Archive XLSX error "${ef.filename}":`, xlsErr.message);
              }
              continue;
            }

            // DOC из архива
            if (efExt.endsWith('.doc')) {
              try {
                const buf = fs.readFileSync(ef.absPath);
                const text = buf.toString('utf-8').replace(/[^\x20-\x7E\u0400-\u04FF\n\r\t]/g, ' ').replace(/\s{3,}/g, ' ').trim();
                if (text.length > 50) {
                  texts.push(`[${a.original_filename} → ${ef.filename}]\n${text.slice(0, maxPerFile)}`);
                  console.log(`[AI-Analyzer] Archive DOC: "${ef.filename}" → ${text.length} chars`);
                }
              } catch (docErr) {
                console.error(`[AI-Analyzer] Archive DOC error "${ef.filename}":`, docErr.message);
              }
              continue;
            }

            // Текстовые файлы из архива
            if (efExt.endsWith('.txt') || efExt.endsWith('.csv') || efExt.endsWith('.rtf')) {
              try {
                const content = fs.readFileSync(ef.absPath, 'utf-8');
                if (content && content.length > 10) {
                  texts.push(`[${a.original_filename} → ${ef.filename}]\n${content.slice(0, maxPerFile)}`);
                  console.log(`[AI-Analyzer] Archive text: "${ef.filename}" → ${content.length} chars`);
                }
              } catch (txtErr) {
                console.error(`[AI-Analyzer] Archive text error "${ef.filename}":`, txtErr.message);
              }
              continue;
            }

            // Изображения из архива
            if (efExt.endsWith('.jpg') || efExt.endsWith('.jpeg') || efExt.endsWith('.png')) {
              try {
                const stats = fs.statSync(ef.absPath);
                if (stats.size <= 5 * 1024 * 1024 && imageBlocks.length < 5) {
                  const buf = fs.readFileSync(ef.absPath);
                  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
                  const mime = mimeMap[path.extname(efExt)] || 'image/jpeg';
                  imageBlocks.push({
                    type: 'image',
                    source: { type: 'base64', media_type: mime, data: buf.toString('base64') }
                  });
                  console.log(`[AI-Analyzer] Archive image: "${ef.filename}" (${stats.size} bytes)`);
                }
              } catch (_) {}
            }
          }
        } catch (archErr) {
          console.error(`[AI-Analyzer] Archive extraction error "${a.original_filename}":`, archErr.message);
        } finally {
          // Cleanup all temp dirs from archive extraction
          for (const td of tmpDirsSet) cleanupDir(td);
        }
      }
    }

    console.log(`[AI-Analyzer] Email #${emailId}: extracted ${texts.length} text blocks, ${imageBlocks.length} images`);
    return { texts, imageBlocks };
  } catch (err) {
    console.error('[AI-Analyzer] Attachment extraction error:', err.message, err.stack);
    return { texts: [], imageBlocks: [] };
  }
}

// ── Анализ письма ────────────────────────────────────────────────────

async function analyzeEmail({ emailId, subject, bodyText, fromEmail, fromName, attachmentNames }) {
  const startTime = Date.now();
  let result = null;
  let error = null;

  // Pre-filter: пропускаем bounce, internal, system emails БЕЗ обращения к AI
  const skipCheck = shouldSkipEmail({ fromEmail, subject, bodyText });
  if (skipCheck.skip) {
    console.log(`[AI-Analyzer] Skipping email #${emailId}: ${skipCheck.reason} (from: ${fromEmail})`);
    const skippedResult = {
      classification: skipCheck.reason === 'bounce_or_auto_reply' ? 'other' :
                      skipCheck.reason === 'internal_email' ? 'personal' :
                      'other',
      color: 'red',
      summary: `Пропущено автоматически: ${skipCheck.reason}`,
      recommendation: 'Не требует действий',
      work_type: null,
      estimated_budget: null,
      estimated_days: null,
      keywords: [],
      confidence: 0.95,
      _skipped: true,
      _skipReason: skipCheck.reason
    };

    // Логируем пропуск
    await logAnalysis({
      entityType: 'email',
      entityId: emailId || 0,
      analysisType: 'email_classification_skipped',
      inputPreview: `[SKIPPED:${skipCheck.reason}] ${(subject || '').slice(0, 200)}`,
      outputJson: skippedResult
    });

    return skippedResult;
  }

  try {
    // Собираем контекст о загрузке
    const workload = await getWorkloadData();

    // Извлекаем содержимое вложений (текст + изображения)
    const { texts: attachmentTexts, imageBlocks } = await extractAttachmentTexts(emailId);

    const userMessage = buildAnalysisMessage({
      subject, bodyText, fromEmail, fromName, attachmentNames, workload, attachmentTexts
    });

    // Формируем content: текст + (опционально) изображения/документы
    let messageContent;
    if (imageBlocks.length > 0) {
      console.log(`[AI-Analyzer] Including ${imageBlocks.length} image/document blocks in classification request`);
      messageContent = [
        { type: 'text', text: userMessage + '\n\nК письму приложены файлы (изображения/документы). Проанализируй их содержимое при классификации.' },
        ...imageBlocks
      ];
    } else {
      messageContent = userMessage;
    }

    const completeFn = aiProvider.completeAnalytics || aiProvider.complete;
    const response = await completeFn({
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: messageContent }],
      maxTokens: 1024,
      temperature: 0.3
    });

    // Парсим JSON-ответ
    result = parseAIResponse(response.text);

    // Защитный override: AI иногда классифицирует пересланное ТЗ как 'information',
    // хотя summary/recommendation явно указывают на запрос работ или подготовку КП.
    // На проде ловили дважды подряд (письма #2936 и #2937 — Fwd: пропиленгликоль).
    // Триггеримся ТОЛЬКО при color=green (если красное/жёлтое — AI считает не наш профиль).
    if (result.classification === 'information' && result.color === 'green') {
      const text = ((result.summary || '') + ' ' + (result.recommendation || '')).toLowerCase();
      const triggerWords = [
        'тз ', ' тз.', 'тз,', 'тз:', 'тз)', '(тз', 'техническое задание',
        'запрос на работы', 'запрос на работу',
        'подготовить кп', 'коммерческое предложение',
        'взять в проработку', 'взять в работу',
        'наш профиль', 'профильно', 'профильная работа', 'соответствует профилю',
        'предлагаем выполнить', 'готовы выполнить'
      ];
      const hit = triggerWords.find(w => text.includes(w));
      if (hit) {
        console.log(`[AI-Override] Email #${emailId}: information → direct_request (trigger="${hit.trim()}", color=green)`);
        result.classification = 'direct_request';
        result._overridden = { from: 'information', to: 'direct_request', trigger: hit.trim(), reason: 'green+trigger_word' };
      }
    }

    result._raw = {
      model: response.model,
      provider: response.provider,
      usage: response.usage,
      durationMs: response.durationMs
    };

    // Логируем в ai_analysis_log
    await logAnalysis({
      entityType: 'email',
      entityId: emailId || 0,
      analysisType: 'email_classification',
      promptTokens: response.usage?.inputTokens || 0,
      completionTokens: response.usage?.outputTokens || 0,
      model: response.model,
      provider: response.provider,
      durationMs: response.durationMs,
      inputPreview: (subject || '').slice(0, 200),
      outputJson: result
    });

    return result;
  } catch (err) {
    error = err;
    console.error('[AI-Analyzer] Error:', err.message);

    // Логируем ошибку
    await logAnalysis({
      entityType: 'email',
      entityId: emailId || 0,
      analysisType: 'email_classification',
      error: err.message,
      inputPreview: (subject || '').slice(0, 200)
    });

    // Fallback — базовая классификация без AI
    return fallbackClassification({ subject, bodyText, fromEmail });
  }
}

// ── Построение сообщения для AI ──────────────────────────────────────

function buildAnalysisMessage({ subject, bodyText, fromEmail, fromName, attachmentNames, workload, attachmentTexts }) {
  let msg = `ВХОДЯЩЕЕ ПИСЬМО:\n`;
  msg += `От: ${fromName || 'Неизвестно'} <${fromEmail || '?'}>\n`;
  msg += `Тема: ${subject || '(без темы)'}\n\n`;

  if (bodyText) {
    // Ограничиваем длину тела
    const maxLen = 3000;
    const body = bodyText.length > maxLen ? bodyText.slice(0, maxLen) + '...[обрезано]' : bodyText;
    msg += `ТЕКСТ ПИСЬМА:\n${body}\n\n`;
  }

  if (attachmentNames?.length) {
    msg += `ВЛОЖЕНИЯ: ${attachmentNames.join(', ')}\n\n`;
  }

  // Извлечённое содержимое вложений (PDF, DOCX, XLSX)
  if (attachmentTexts?.length) {
    msg += `СОДЕРЖИМОЕ ВЛОЖЕНИЙ:\n${attachmentTexts.join('\n\n').slice(0, 20000)}\n\n`;
  }

  if (workload) {
    msg += `ТЕКУЩАЯ ЗАГРУЗКА КОМПАНИИ:\n`;
    msg += `- Активных работ: ${workload.activeWorks}\n`;
    msg += `- Свободных бригад: ${workload.availableCrews}\n`;
    msg += `- Тендеров в работе: ${workload.activeTenders}\n`;
    if (workload.nextFreeDate) {
      msg += `- Ближайшая свободная дата: ${workload.nextFreeDate}\n`;
    }
    msg += '\n';
  }

  msg += 'Проанализируй письмо и верни JSON с классификацией.';
  return msg;
}

// ── Парсинг ответа AI ────────────────────────────────────────────────

function parseAIResponse(text) {
  if (!text) return fallbackResult();

  // Удаляем markdown-обёртку если есть
  let clean = text.trim();
  if (clean.startsWith('```json')) clean = clean.slice(7);
  if (clean.startsWith('```')) clean = clean.slice(3);
  if (clean.endsWith('```')) clean = clean.slice(0, -3);
  clean = clean.trim();

  try {
    const parsed = JSON.parse(clean);

    // Sanitize Fwd-парсинг: НИКОГДА не возвращать наш внутренний домен как original_sender.
    // Это защита от случая когда AI всё-таки спутал форвардера с клиентом.
    const INTERNAL_DOMAINS_LOWER = ['asgard-crm.ru', 'asgard-service.ru', 'asgard-service.com', 'asgard-s.ru'];
    let origName  = parsed.original_sender_name  || null;
    let origEmail = parsed.original_sender_email || null;
    let origCompany = parsed.original_sender_company || null;
    if (typeof origEmail === 'string') {
      const el = origEmail.toLowerCase();
      if (INTERNAL_DOMAINS_LOWER.some(d => el.includes(d))) {
        console.warn('[AI-Analyzer] AI returned internal domain as original_sender — clearing:', origEmail);
        origEmail = null;
        origName  = null;
      }
    }

    let fwdName  = parsed.forwarder_name  || null;
    let fwdEmail = parsed.forwarder_email || null;

    // Извлечённые из карточки клиента / шильдика — валидация:
    // ИНН только 10 или 12 цифр; контактный email клиента не должен быть нашим.
    const _digits = (s) => String(s || '').replace(/\D/g, '');
    const _validInn = (s) => {
      const d = _digits(s);
      return (d.length === 10 || d.length === 12) ? d : null;
    };
    const _validKpp = (s) => { const d = _digits(s); return d.length === 9 ? d : null; };
    const _validOgrn = (s) => { const d = _digits(s); return (d.length === 13 || d.length === 15) ? d : null; };
    let extrEmail = parsed.extracted_customer_contact_email || null;
    if (typeof extrEmail === 'string') {
      const el = extrEmail.toLowerCase().trim();
      if (INTERNAL_DOMAINS_LOWER.some(d => el.includes(d))) extrEmail = null;
      else extrEmail = el;
    }

    return {
      classification: parsed.classification || 'other',
      color: ['green', 'yellow', 'red'].includes(parsed.color) ? parsed.color : 'yellow',
      summary: parsed.summary || '',
      recommendation: parsed.recommendation || '',
      work_type: parsed.work_type || null,
      estimated_budget: parsed.estimated_budget || null,
      estimated_days: parsed.estimated_days || null,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      // ── Fwd-парсинг ──────────────────────────────────────────────
      is_forwarded: parsed.is_forwarded === true,
      original_sender_name:  origName,
      original_sender_email: origEmail ? String(origEmail).toLowerCase() : null,
      original_sender_company: origCompany,
      forwarder_name:  fwdName,
      forwarder_email: fwdEmail ? String(fwdEmail).toLowerCase() : null,
      _fwd_warning: !!(parsed.is_forwarded === true && !origEmail),
      // ── Карточка клиента из фото/PDF (NEW) ─────────────────────────────
      extracted_customer_name:    parsed.extracted_customer_name || null,
      extracted_customer_inn:     _validInn(parsed.extracted_customer_inn),
      extracted_customer_kpp:     _validKpp(parsed.extracted_customer_kpp),
      extracted_customer_ogrn:    _validOgrn(parsed.extracted_customer_ogrn),
      extracted_customer_address: parsed.extracted_customer_address || null,
      extracted_customer_phone:   parsed.extracted_customer_phone || null,
      extracted_customer_contact_person: parsed.extracted_customer_contact_person || null,
      extracted_customer_contact_email:  extrEmail,
      extracted_equipment:        parsed.extracted_equipment || null
    };
  } catch (e) {
    console.warn('[AI-Analyzer] JSON parse error:', e.message, '| raw:', clean.slice(0, 80));
    return fallbackResult();
  }
}

function fallbackResult() {
  return {
    classification: 'other',
    color: 'yellow',
    summary: 'Не удалось автоматически классифицировать',
    recommendation: 'Требуется ручная проверка',
    work_type: null,
    estimated_budget: null,
    estimated_days: null,
    keywords: [],
    confidence: 0,
    is_forwarded: false,
    original_sender_name: null,
    original_sender_email: null,
    original_sender_company: null,
    forwarder_name: null,
    forwarder_email: null,
    _fwd_warning: false
  };
}

// ── Fallback без AI ──────────────────────────────────────────────────

function fallbackClassification({ subject, bodyText, fromEmail }) {
  const text = ((subject || '') + ' ' + (bodyText || '')).toLowerCase();

  // Приоритет: addendum > invitation > platform_tender > direct_request.
  // addendum выше invitation потому что «дозапрос по тендеру №» содержит слово «тендер»
  // и иначе попадёт в invitation, хотя это продолжение существующего, а не новое приглашение.
  const addendumKeywords = [
    'дозапрос',
    'уточнение по тендеру',
    'уточнение по нашему запросу',
    'протокол разногласий',
    'изменение в извещении',
    'дополнительные вопросы по кп',
    'ваше предложение по тендеру',
    'продление срока подачи кп',
    'изменение нмцк',
    'продление сроков подачи'
  ];
  const isAddendum = addendumKeywords.some(k => text.includes(k));

  const invitationKeywords = [
    'приглашаем принять участие', 'приглашаем вас принять участие',
    'объявляется закупка', 'объявляется тендер',
    'участие в тендере', 'участие в закупке',
    'запрос предложений на тендер', 'запрос предложений на участие',
    'направить кп на участие', 'направить коммерческое на тендер',
    'приглашение к участию в закупке', 'приглашение к участию в тендере'
  ];
  const tenderKeywords = ['тендер', 'конкурс', 'закупк', 'аукцион', 'котировк', 'запрос предложений', 'запрос цен'];
  const workKeywords = ['промывк', 'химическ', 'монтаж', 'демонтаж', 'сварк', 'изоляц', 'антикорроз', 'такелаж', 'строп'];
  const spamKeywords = ['unsubscribe', 'рассылк', 'реклам', 'акция', 'скидк'];

  const isInvitation = invitationKeywords.some(k => text.includes(k));
  const isTender = tenderKeywords.some(k => text.includes(k));
  const isWork = workKeywords.some(k => text.includes(k));
  const isSpam = spamKeywords.some(k => text.includes(k));

  if (isSpam) {
    return { classification: 'spam', color: 'red', summary: 'Возможный спам/рассылка', recommendation: 'Архивировать', work_type: null, estimated_budget: null, estimated_days: null, keywords: [], confidence: 0.3 };
  }
  if (isAddendum) {
    // Попытка вытащить parent_tender_hint из темы — простая эвристика: «№ X» / «лот X»
    let parentHint = null;
    const numMatch = (subject || '').match(/№\s*[\w\d./-]+/i);
    if (numMatch) parentHint = numMatch[0];
    return {
      classification: 'addendum_response',
      color: 'yellow',
      summary: 'Продолжение по существующему тендеру (дозапрос/уточнение/протокол)',
      recommendation: 'Привязать к существующему тендеру',
      work_type: null, estimated_budget: null, estimated_days: null,
      keywords: [],
      confidence: 0.4,
      parent_tender_inn: null,
      parent_tender_hint: parentHint,
      parent_tender_id: null
    };
  }
  if (isInvitation) {
    return { classification: 'tender_invitation', color: 'green', summary: 'Возможное приглашение в тендер от заказчика', recommendation: 'Передать в тендерный отдел', work_type: null, estimated_budget: null, estimated_days: null, keywords: [], confidence: 0.4 };
  }
  if (isTender) {
    return { classification: 'platform_tender', color: 'yellow', summary: 'Возможный тендер', recommendation: 'Проверить условия', work_type: null, estimated_budget: null, estimated_days: null, keywords: [], confidence: 0.3 };
  }
  if (isWork) {
    return { classification: 'direct_request', color: 'green', summary: 'Возможный запрос на работы', recommendation: 'Рассмотреть', work_type: null, estimated_budget: null, estimated_days: null, keywords: [], confidence: 0.3 };
  }

  return fallbackResult();
}

// ── Данные о загрузке ────────────────────────────────────────────────

async function getWorkloadData() {
  try {
    const [worksRes, tendersRes, employeesRes] = await Promise.all([
      db.query(`SELECT COUNT(*) as cnt FROM works WHERE work_status IN ('В работе','Мобилизация','Подготовка','На паузе','Подписание акта')`),
      db.query(`SELECT COUNT(*) as cnt FROM tenders WHERE tender_status IN ('Новый','Отправлено на просчёт','Согласование ТКП','ТКП согласовано','Готово к отправке КП','КП отправлено')`),
      db.query(`SELECT COUNT(*) as cnt FROM employees WHERE is_active = true`)
    ]);

    return {
      activeWorks: parseInt(worksRes.rows[0]?.cnt || 0),
      activeTenders: parseInt(tendersRes.rows[0]?.cnt || 0),
      availableCrews: parseInt(employeesRes.rows[0]?.cnt || 0),
      nextFreeDate: null
    };
  } catch (e) {
    console.error('[AI-Analyzer] Workload query error:', e.message);
    return { activeWorks: 0, activeTenders: 0, availableCrews: 0, nextFreeDate: null };
  }
}

// ── Логирование ──────────────────────────────────────────────────────

async function logAnalysis({ entityType, entityId, analysisType, promptTokens, completionTokens, model, provider, durationMs, inputPreview, outputJson, error }) {
  try {
    await db.query(`
      INSERT INTO ai_analysis_log (
        entity_type, entity_id, analysis_type,
        prompt_tokens, completion_tokens, total_tokens,
        model, provider, duration_ms,
        input_preview, output_json, error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      entityType, entityId, analysisType || 'email_classification',
      promptTokens || 0, completionTokens || 0, (promptTokens || 0) + (completionTokens || 0),
      model || null, provider || null, durationMs || 0,
      inputPreview || '', outputJson ? JSON.stringify(outputJson) : null, error || null
    ]);
  } catch (e) {
    console.error('[AI-Analyzer] Log write error:', e.message);
  }
}

// ── Генерация AI-отчёта ──────────────────────────────────────────────

const { REPORT_SYSTEM_PROMPT } = require('../prompts/report-prompt');

async function generateReport({ emailId, subject, bodyText, fromEmail, fromName, attachmentNames }) {
  console.log(`[AI-Analyzer] generateReport called: emailId=${emailId}, subject="${(subject || '').slice(0, 80)}"`);
  try {
    // Извлекаем содержимое вложений с БОЛЬШИМ лимитом для полного анализа ТЗ
    const { texts: attachmentTexts, imageBlocks } = await extractAttachmentTexts(emailId, { maxPerFile: MAX_EXTRACT_PER_FILE_REPORT });
    console.log(`[AI-Analyzer] Report: got ${attachmentTexts.length} text blocks, ${imageBlocks.length} images for email #${emailId}`);
    if (attachmentTexts.length > 0) {
      console.log(`[AI-Analyzer] Report: attachment text total = ${attachmentTexts.join('').length} chars`);
    } else {
      console.warn(`[AI-Analyzer] Report: NO attachment text extracted for email #${emailId} — report will lack TZ content`);
    }

    let msg = `ВХОДЯЩЕЕ ПИСЬМО:\n`;
    msg += `От: ${fromName || 'Неизвестно'} <${fromEmail || '?'}>\n`;
    msg += `Тема: ${subject || '(без темы)'}\n\n`;

    if (bodyText) {
      const maxLen = 4000;
      const body = bodyText.length > maxLen ? bodyText.slice(0, maxLen) + '...[обрезано]' : bodyText;
      msg += `ТЕКСТ ПИСЬМА:\n${body}\n\n`;
    }

    if (attachmentNames?.length) {
      msg += `ВЛОЖЕНИЯ: ${attachmentNames.join(', ')}\n\n`;
    }

    // Включаем извлечённое содержимое вложений
    if (attachmentTexts?.length) {
      msg += `СОДЕРЖИМОЕ ВЛОЖЕНИЙ (ТЗ, спецификации, документы):\n${attachmentTexts.join('\n\n').slice(0, 80000)}\n\n`;
    }

    msg += 'Составь КРАТКИЙ деловой отчёт (1-2 страницы, не более 3000 символов) по этому запросу.\nОБЯЗАТЕЛЬНО прочитай и проанализируй ВСЕ вложения (ТЗ, спецификации). Выдели из них ключевые работы, объекты, сроки.\nНЕ переписывай ТЗ дословно — только суть и ключевые пункты.';

    // Формируем content: текст + (опционально) изображения/документы
    let messageContent;
    if (imageBlocks.length > 0) {
      console.log(`[AI-Analyzer] Including ${imageBlocks.length} image/document blocks in report request`);
      messageContent = [
        { type: 'text', text: msg },
        ...imageBlocks
      ];
    } else {
      messageContent = msg;
    }

    // Retry up to 3 times
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[AI-Analyzer] Report generation attempt ${attempt}/3`);
        const reportCompleteFn = aiProvider.completeAnalytics || aiProvider.complete;
        const response = await reportCompleteFn({
          system: REPORT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: messageContent }],
          maxTokens: 4096,
          temperature: 0.3
        });
        if (response.text) {
          console.log(`[AI-Analyzer] Report generated on attempt ${attempt}, length=${response.text.length}`);
          return response.text;
        }
        console.warn(`[AI-Analyzer] Report attempt ${attempt} returned empty text`);
        lastErr = new Error('Empty response');
      } catch (retryErr) {
        console.warn(`[AI-Analyzer] Report attempt ${attempt} failed: ${retryErr.message}`);
        lastErr = retryErr;
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    console.error('[AI-Analyzer] Report generation failed after 3 attempts:', lastErr?.message);
    return null;
  } catch (err) {
    console.error('[AI-Analyzer] Report generation error:', err.message);
    return null;
  }
}

module.exports = {
  analyzeEmail,
  generateReport,
  getWorkloadData,
  parseAIResponse,
  shouldSkipEmail,
  ANALYSIS_SYSTEM_PROMPT,
  // S-9: экспорт для unit-тестов addendum-keyword heuristic.
  fallbackClassification
};
