/**
 * ASGARD CRM — Pre-Tender Service
 * Общая логика создания/анализа предварительных заявок
 */

'use strict';

const db = require('./db');
const aiProvider = require('./ai-provider');
const fs = require('fs');
const path = require('path');

const SYSTEM_PROMPT = `Ты — аналитик тендерного отдела ООО "Асгард Сервис".
Компания специализируется на:
- Обслуживание трубопроводов (химическая чистка, диагностика, ремонт)
- HVAC системы (вентиляция, кондиционирование, отопление)
- Работы на нефтегазовых объектах (НПЗ, ГПЗ, МЛСП)
- Монтажные и пусконаладочные работы
- Сервисное обслуживание промышленного оборудования

Твоя задача — проанализировать входящую заявку и дать рекомендацию.

ФОРМАТ ОТВЕТА (строго JSON, без markdown):
{
  "summary": "Развёрнутый отчёт по заявке...",
  "color": "green|yellow|red",
  "recommendation": "Краткая рекомендация 2-3 предложения",
  "work_match_score": 0-100,
  "workload_warning": "Предупреждение или null",
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
GREEN (work_match_score >= 70): Наша работа, специалисты свободны
YELLOW (work_match_score 30-69): Частично наш профиль или есть риски
RED (work_match_score < 30): Не наш профиль или невыполнимо`;

async function createPreTenderFromEmail(emailId) {
  const exists = await db.query('SELECT id FROM pre_tender_requests WHERE email_id = $1', [emailId]);
  if (exists.rows.length) return { exists: true, id: exists.rows[0].id };

  const emailRes = await db.query('SELECT * FROM emails WHERE id = $1', [emailId]);
  if (!emailRes.rows.length) return null;
  const email = emailRes.rows[0];

  const ins = await db.query(`
    INSERT INTO pre_tender_requests (
      email_id, source_type, customer_name, customer_email, work_description,
      ai_summary, ai_color, ai_recommendation, has_documents, status, created_by
    ) VALUES ($1, 'email', $2, $3, $4, $5, $6, $7, $8, 'new', $9)
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
  await db.query('UPDATE emails SET pre_tender_id = $1 WHERE id = $2', [preTenderId, emailId]);
  console.log(`[PreTender] Created pre-tender #${preTenderId} from email #${emailId}`);
  return { exists: false, id: preTenderId };
}

const MAX_TEXT_PER_FILE = 5000;
const MAX_TEXT_TOTAL = 15000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

async function extractTextFromFile(filePath, mimeType) {
  try {
    const absPath = path.join(__dirname, '..', '..', filePath);
    if (!fs.existsSync(absPath)) return null;
    const stats = fs.statSync(absPath);
    if (stats.size > MAX_FILE_SIZE) return null;
    const buf = fs.readFileSync(absPath);
    const lc = (filePath || '').toLowerCase();
    if (mimeType === 'application/pdf' || lc.endsWith('.pdf')) {
      const pdfParse = require('pdf-parse');
      const result = await pdfParse(buf);
      return result.text ? result.text.slice(0, MAX_TEXT_PER_FILE) : null;
    }
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        || lc.endsWith('.docx') || mimeType === 'application/msword' || lc.endsWith('.doc')) {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value ? result.value.slice(0, MAX_TEXT_PER_FILE) : null;
    }
    return null;
  } catch (err) {
    console.warn('[PreTender] Text extraction error:', filePath, err.message);
    return null;
  }
}

async function analyzePreTender(preTenderId) {
  const ptRes = await db.query(`
    SELECT pt.*, e.subject, e.body_text, e.from_email, e.from_name, e.email_date, e.email_type
    FROM pre_tender_requests pt
    LEFT JOIN emails e ON e.id = pt.email_id
    WHERE pt.id = $1
  `, [preTenderId]);

  if (!ptRes.rows.length) throw new Error('Заявка не найдена');
  const pt = ptRes.rows[0];

  let attachmentTexts = 'Вложений нет';
  const extractedTexts = [];
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
        if (a.file_path && totalExtracted < MAX_TEXT_TOTAL) {
          const text = await extractTextFromFile(a.file_path, a.mime_type);
          if (text) { extractedTexts.push(`--- Содержимое «${a.original_filename}» ---\n${text}`); totalExtracted += text.length; }
        }
      }
      attachmentTexts = parts.join('\n');
    }
  }

  const manualDocs = Array.isArray(pt.manual_documents) ? pt.manual_documents : [];
  for (const doc of manualDocs) {
    if (doc.path && totalExtracted < MAX_TEXT_TOTAL) {
      const text = await extractTextFromFile(doc.path, doc.mime_type);
      if (text) { extractedTexts.push(`--- Содержимое «${doc.original_name || doc.filename}» ---\n${text}`); totalExtracted += text.length; }
    }
  }

  const workloadInfo = await getWorkloadInfo();

  const emailType = pt.email_type === 'direct_request' ? 'Прямой запрос' : 'Тендерная площадка';
  const userMessage = `ВХОДЯЩАЯ ЗАЯВКА:\nОт: ${pt.from_name || pt.customer_name || '?'} <${pt.from_email || pt.customer_email || '?'}>\nТема: ${pt.subject || '(без темы)'}\nДата: ${pt.email_date || pt.created_at || '?'}\nТип: ${emailType}\n\nТЕКСТ ПИСЬМА:\n${pt.body_text || pt.work_description || 'Текст отсутствует'}\n\nВЛОЖЕНИЯ:\n${attachmentTexts}\n${extractedTexts.length ? '\nСОДЕРЖИМОЕ ВЛОЖЕНИЙ:\n' + extractedTexts.join('\n\n') : ''}\nЗАГРУЗКА КОМПАНИИ:\n${workloadInfo}`;

  const config = aiProvider.getConfig();
  if (!config.hasAnthropicKey && !config.hasOpenAIKey) return fallbackAnalysis(pt);

  try {
    const response = await aiProvider.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 2048, temperature: 0.3
    });

    const result = parseAIResult(response.text);

    await db.query(`
      UPDATE pre_tender_requests SET
        ai_summary = $1, ai_color = $2, ai_recommendation = $3,
        ai_work_match_score = $4, ai_workload_warning = $5, ai_processed_at = NOW(),
        customer_name = COALESCE(NULLIF($6, ''), customer_name),
        customer_inn = COALESCE(NULLIF($7, ''), customer_inn),
        contact_person = COALESCE(NULLIF($8, ''), contact_person),
        contact_phone = COALESCE(NULLIF($9, ''), contact_phone),
        work_description = COALESCE(NULLIF($10, ''), work_description),
        work_location = COALESCE(NULLIF($11, ''), work_location),
        work_deadline = COALESCE($12, work_deadline),
        estimated_sum = COALESCE($13, estimated_sum),
        updated_at = NOW()
      WHERE id = $14
    `, [
      result.summary, result.color, result.recommendation, result.work_match_score, result.workload_warning,
      result.extracted_data?.customer_name || '', result.extracted_data?.customer_inn || '',
      result.extracted_data?.contact_person || '', result.extracted_data?.contact_phone || '',
      result.extracted_data?.work_description || '', result.extracted_data?.work_location || '',
      result.extracted_data?.work_deadline || null, result.extracted_data?.estimated_sum || null,
      preTenderId
    ]);

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

function parseAIResult(text) {
  if (!text) return fallbackResult();
  let clean = text.trim();
  if (clean.startsWith('```json')) clean = clean.slice(7);
  if (clean.startsWith('```')) clean = clean.slice(3);
  if (clean.endsWith('```')) clean = clean.slice(0, -3);
  clean = clean.trim();
  try {
    const p = JSON.parse(clean);
    return {
      summary: p.summary || '', color: ['green', 'yellow', 'red'].includes(p.color) ? p.color : 'yellow',
      recommendation: p.recommendation || '',
      work_match_score: Math.max(0, Math.min(100, parseInt(p.work_match_score) || 50)),
      workload_warning: p.workload_warning || null, extracted_data: p.extracted_data || {}
    };
  } catch (e) {
    console.error('[PreTender] AI JSON parse error:', e.message);
    return fallbackResult();
  }
}

function fallbackResult() {
  return { summary: 'Автоматический анализ недоступен.', color: 'yellow', recommendation: 'Просмотрите заявку вручную.', work_match_score: 50, workload_warning: null, extracted_data: {} };
}

function fallbackAnalysis(pt) {
  const text = ((pt.subject || '') + ' ' + (pt.work_description || '') + ' ' + (pt.body_text || '')).toLowerCase();
  const ourKeywords = ['промывк', 'химическ', 'трубопровод', 'монтаж', 'демонтаж', 'сварк', 'изоляц', 'нпз', 'гпз', 'нефт', 'газ', 'вентиляц'];
  const matches = ourKeywords.filter(k => text.includes(k));
  const score = Math.min(100, matches.length * 15 + 10);
  const color = score >= 70 ? 'green' : score >= 30 ? 'yellow' : 'red';
  return {
    summary: `Обнаружено ${matches.length} ключевых слов нашего профиля: ${matches.join(', ') || 'нет'}.`,
    color, recommendation: matches.length > 2 ? 'Рекомендуется рассмотреть заявку.' : 'Требуется детальное изучение.',
    work_match_score: score, workload_warning: null, extracted_data: {}
  };
}

// ИСПРАВЛЕНО: используем users вместо employees
async function getWorkloadInfo() {
  try {
    const [works, users] = await Promise.all([
      db.query(`SELECT COUNT(*) as cnt FROM works WHERE work_status IN ('В работе','Мобилизация','На объекте')`).catch(() => ({ rows: [{ cnt: 0 }] })),
      db.query(`SELECT COUNT(*) as cnt FROM users WHERE is_active = true AND role IN ('WORKER','FOREMAN','MASTER')`).catch(() => ({ rows: [{ cnt: 0 }] }))
    ]);
    const activeWorks = parseInt(works.rows[0]?.cnt || 0);
    const freeWorkers = parseInt(users.rows[0]?.cnt || 0);
    return `Активных работ: ${activeWorks}, Свободных рабочих: ${freeWorkers}`;
  } catch (e) {
    return 'Данные о загрузке недоступны';
  }
}

module.exports = { createPreTenderFromEmail, analyzePreTender, getWorkloadInfo, SYSTEM_PROMPT };
