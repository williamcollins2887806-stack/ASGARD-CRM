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
  "extracted_data": {
    "customer_name": "...",
    "customer_inn": "... или null",
    "contact_person": "... или null",
    "contact_phone": "... или null",
    "work_description": "...",
    "work_location": "... или null",
    "work_deadline": "YYYY-MM-DD или null",
    "estimated_sum": число или null
  }
}

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

async function createPreTenderFromEmail(emailId) {
  // Проверяем что ещё нет заявки для этого email
  const exists = await db.query('SELECT id FROM pre_tender_requests WHERE email_id = $1', [emailId]);
  if (exists.rows.length) return { exists: true, id: exists.rows[0].id };

  // Получаем данные письма
  const emailRes = await db.query('SELECT * FROM emails WHERE id = $1', [emailId]);
  if (!emailRes.rows.length) return null;
  const email = emailRes.rows[0];

  // Создаём заявку с данными из письма
  const ins = await db.query(`
    INSERT INTO pre_tender_requests (
      email_id, source_type,
      customer_name, customer_email,
      work_description,
      ai_summary, ai_color, ai_recommendation,
      has_documents,
      status, created_by
    ) VALUES (
      $1, 'email',
      $2, $3,
      $4,
      $5, $6, $7,
      $8,
      'new', $9
    )
    RETURNING id
  `, [
    emailId,
    email.from_name || email.from_email || '',
    email.from_email || '',
    (email.body_text || '').slice(0, 2000),
    email.ai_summary || null,
    email.ai_color || 'yellow',
    email.ai_recommendation || null,
    email.has_attachments || false,
    email.sent_by_user_id || null
  ]);

  const preTenderId = ins.rows[0].id;

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

  // Вызываем AI
  const config = aiProvider.getConfig();
  if (!config.hasAnthropicKey && !config.hasOpenAIKey) {
    return fallbackAnalysis(pt);
  }

  try {
    // Формируем content: текст + (опционально) изображения для Vision
    let messageContent;
    if (imageBlocks.length > 0 && config.hasAnthropicKey) {
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
      maxTokens: 2048,
      temperature: 0.3
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
      preTenderId
    ]);

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
    return {
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

// ── Информация о загрузке ────────────────────────────────────────────

async function getWorkloadInfo() {
  try {
    const [works, employees] = await Promise.all([
      db.query(`SELECT COUNT(*) as cnt FROM works WHERE work_status IN ('В работе','Мобилизация','На объекте')`),
      db.query(`SELECT COUNT(*) as cnt FROM employees WHERE status = 'Свободен' AND is_active = true`)
    ]);
    const activeWorks = parseInt(works.rows[0]?.cnt || 0);
    const freeWorkers = parseInt(employees.rows[0]?.cnt || 0);
    return `Активных работ: ${activeWorks}, Свободных рабочих: ${freeWorkers}`;
  } catch (e) {
    return 'Данные о загрузке недоступны';
  }
}

module.exports = {
  createPreTenderFromEmail,
  analyzePreTender,
  getWorkloadInfo,
  SYSTEM_PROMPT
};
