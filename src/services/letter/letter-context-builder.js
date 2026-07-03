'use strict';

/**
 * src/services/letter/letter-context-builder.js
 *
 * Сборщик контекста для Мимира внутри composer'а официального письма.
 *
 * Контракт (_LETTER_CONTRACT.md §9):
 *   - 4 слоя по приоритету (обрезается с хвоста при превышении бюджета):
 *     1. ДОКУМЕНТЫ РОДИТЕЛЯ (parsed_documents из mimir_artifacts)
 *     2. СТРУКТУРА ПЕРЕПИСКИ (correspondence по той же родительской сущности)
 *     3. ИСТОРИЯ ЧАТА (mimir_messages по conversation_id)
 *     4. ДОГОВОР + СМЕТА (final_estimate_data из mimir_conductor_runs)
 *   - Бюджеты:
 *       gpt-5.5         → 480 000 токенов  (1.1M контекст, оставим 520K для reasoning + output)
 *       gpt-5.4         → 200 000          (400K контекст)
 *       grok-4.20-fast  → 900 000          (2M контекст)
 *   - tokensPerChar ≈ 0.286 (для русского), maxChars = floor(maxTokens / tokensPerChar)
 *
 * Не делает API-вызовов — только SQL на КЛОНЕ. Никаких сайд-эффектов.
 * Возврат: { system, contextBlock, sources[], stats{} }.
 *
 * Использование в src/routes/mimir-letter.js (S-7):
 *   const ctx = await buildLetterContext({ correspondence_id, conversation_id, model, db });
 *   await aiProvider.complete({
 *     system: ctx.system,
 *     messages: [{role:'user', content: instruction + '\n\n' + ctx.contextBlock + '\n\n=== ТЕКУЩИЙ ДОК ===\n' + JSON.stringify(current_doc)}],
 *     maxTokens: 8000, model, temperature: 0.3
 *   });
 *
 * Notes по схеме:
 *   - В контракте §9 упомянуто 'conductor_runs.final_estimate_data', но реальная
 *     таблица — `mimir_conductor_runs` (FK от mimir_artifacts.conductor_run_id).
 *     Если в будущем появится legacy-таблица conductor_runs — этот код её НЕ найдёт,
 *     но graceful degradation: Layer 4 просто будет пустым.
 *   - correspondence.conductor_run_id INTEGER без FK (Conductor чистит сам, см. V252).
 */

const db = require('../db');

// ─── Бюджеты по модели ────────────────────────────────────────────────────
const BUDGETS = {
  'gpt-5.5':        480_000,
  'gpt-5.4':        200_000,
  'grok-4.20-fast': 900_000
};
const DEFAULT_BUDGET = 480_000;       // если модель не указана/неизвестна
const TOKENS_PER_CHAR = 0.286;        // ~1 токен на 3.5 символа для русского

// Лимиты вложенных кусков (защита от мега-документов)
const LAYER1_PREVIEW_PER_DOC_CHARS = 3000;   // на один документ
const LAYER1_MAX_DOCS = 12;                  // не больше 12 документов
const LAYER2_BODY_EXCERPT_CHARS = 500;       // тело письма в треде
const LAYER2_MAX_LETTERS = 20;
const LAYER3_MAX_MESSAGES = 20;
const LAYER3_MSG_CHARS = 2000;               // на одно сообщение в истории
const LAYER4_TOP_ITEMS = 10;                 // топ-N позиций сметы

/**
 * Главная функция.
 *
 * @param {{
 *   correspondence_id: number,
 *   conversation_id?: number|null,
 *   model?: 'gpt-5.5'|'gpt-5.4'|'grok-4.20-fast',
 *   db?: object,                          // опциональный pg-клиент (тестов ради)
 *   userId?: number                       // на будущее — RBAC-фильтр, сейчас не используется
 * }} opts
 * @returns {Promise<{
 *   system: string,
 *   contextBlock: string,
 *   sources: Array<{type:string, id?:number|string, name?:string, chars:number}>,
 *   stats: {chars:number, est_tokens:number, max_tokens:number, layers_included:string[], model:string}
 * }>}
 */
async function buildLetterContext(opts) {
  const {
    correspondence_id,
    conversation_id = null,
    model = 'gpt-5.5',
    db: dbClient
  } = opts || {};

  if (!correspondence_id) {
    throw new Error('buildLetterContext: correspondence_id required');
  }

  const client = dbClient || db;
  const maxTokens = BUDGETS[model] || DEFAULT_BUDGET;
  const maxChars = Math.floor(maxTokens / TOKENS_PER_CHAR);

  // 0) Сама correspondence — нужна и для слоёв, и для system prompt.
  const corr = await loadCorrespondence(client, correspondence_id);
  if (!corr) {
    throw new Error(`buildLetterContext: correspondence #${correspondence_id} not found`);
  }

  // Собираем слои (по contract §9 приоритет = порядок сборки)
  const layers = [];

  const layer1 = await buildLayer1ParentDocs(client, corr);
  if (layer1) layers.push({ priority: 1, header: 'ДОКУМЕНТЫ РОДИТЕЛЯ', ...layer1 });

  const layer2 = await buildLayer2Correspondence(client, corr);
  if (layer2) layers.push({ priority: 2, header: 'СТРУКТУРА ПЕРЕПИСКИ', ...layer2 });

  if (conversation_id) {
    const layer3 = await buildLayer3MimirHistory(client, conversation_id);
    if (layer3) layers.push({ priority: 3, header: 'ИСТОРИЯ ЧАТА', ...layer3 });
  }

  const layer4 = await buildLayer4ContractEstimate(client, corr);
  if (layer4) layers.push({ priority: 4, header: 'ДОГОВОР + СМЕТА', ...layer4 });

  // Стратегия обрезки: суммируем по приоритетам, превышаем — урезаем хвост.
  layers.sort((a, b) => a.priority - b.priority);

  let totalChars = 0;
  const included = [];
  const sources = [];

  for (const part of layers) {
    const partChars = part.content.length;
    if (totalChars + partChars <= maxChars) {
      included.push(part);
      totalChars += partChars;
      sources.push(...(part.sources || []));
    } else {
      const remaining = maxChars - totalChars;
      if (remaining > 1000) {
        const truncated = part.content.slice(0, remaining)
          + '\n\n[...обрезано из-за лимита токенов модели]';
        included.push({ ...part, content: truncated });
        totalChars = maxChars;
        sources.push(...(part.sources || []).map((s) => ({ ...s, chars: Math.min(s.chars, remaining) })));
      }
      break;
    }
  }

  const contextBlock = included
    .map((p) => `═══ ${p.header} ═══\n\n${p.content}\n\n`)
    .join('');

  const system = buildSystemPrompt(corr, included.map((p) => p.header));

  return {
    system,
    contextBlock,
    sources,
    stats: {
      chars:           totalChars,
      est_tokens:      Math.round(totalChars * TOKENS_PER_CHAR),
      max_tokens:      maxTokens,
      layers_included: included.map((p) => p.header),
      model
    }
  };
}

// ─── Loaders ──────────────────────────────────────────────────────────────

async function loadCorrespondence(client, id) {
  const r = await client.query(
    `SELECT id, direction, date, number, subject, body, body_html, body_json,
            counterparty, tender_id, work_id, calc_id, pre_tender_id, conductor_run_id,
            letter_kind, doc_title, doc_sub, header_subline,
            procedure_number, lot_number, lot_title,
            signing_status, version_no, parent_correspondence_id,
            ai_model, ai_thread_id, created_by
       FROM correspondence
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1`,
    [id]
  );
  return r.rows[0] || null;
}

// ─── Layer 1: ДОКУМЕНТЫ РОДИТЕЛЯ (parsed_documents из mimir_artifacts) ────
async function buildLayer1ParentDocs(client, corr) {
  const runId = await resolveConductorRunId(client, corr);
  if (!runId) {
    return { content: '', sources: [{ type: 'parent_docs', chars: 0, name: '(нет linked conductor_run)' }] };
  }

  // Берём parsed_documents (последняя версия — superseded_by IS NULL).
  const r = await client.query(
    `SELECT id, content
       FROM mimir_artifacts
      WHERE conductor_run_id = $1
        AND artifact_type = 'parsed_documents'
        AND superseded_by IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [runId]
  );
  if (!r.rows[0]) {
    // Альтернатива: tz_summary (если parsed_documents нет, но есть analytics).
    const alt = await client.query(
      `SELECT id, content FROM mimir_artifacts
        WHERE conductor_run_id = $1 AND artifact_type = 'tz_summary' AND superseded_by IS NULL
        ORDER BY created_at DESC LIMIT 1`, [runId]);
    if (!alt.rows[0]) {
      return { content: '', sources: [{ type: 'parent_docs', chars: 0, name: '(parsed_documents отсутствует)' }] };
    }
    const text = renderTzSummaryAsText(alt.rows[0].content);
    return {
      content: text,
      sources: [{ type: 'parent_docs', id: alt.rows[0].id, name: 'tz_summary (fallback)', chars: text.length }]
    };
  }

  const content = r.rows[0].content || {};
  const docs = Array.isArray(content.documents) ? content.documents : [];
  const limited = docs.slice(0, LAYER1_MAX_DOCS);

  const parts = limited.map((d, idx) => {
    const name = d.name || d.filename || `doc-${idx + 1}`;
    const body = (d.text || d.content || d.extracted_text || '').slice(0, LAYER1_PREVIEW_PER_DOC_CHARS);
    return `── ${idx + 1}. ${name} (${body.length} симв.) ──\n${body}\n`;
  });

  if (parts.length === 0) {
    return {
      content: `(в parsed_documents нет распарсенных файлов — возможно, документов не было прикреплено)`,
      sources: [{ type: 'parent_docs', id: r.rows[0].id, name: 'parsed_documents (empty)', chars: 0 }]
    };
  }

  const text = parts.join('\n');
  return {
    content: text,
    sources: [{ type: 'parent_docs', id: r.rows[0].id, name: `parsed_documents (${limited.length}/${docs.length})`, chars: text.length }]
  };
}

function renderTzSummaryAsText(content) {
  if (!content || typeof content !== 'object') return '';
  const parts = [];
  if (content.summary) parts.push(`Резюме ТЗ: ${content.summary}`);
  if (Array.isArray(content.gaps) && content.gaps.length) {
    parts.push('Пробелы / вопросы:');
    parts.push(content.gaps.slice(0, 15).map((g, i) => `  ${i + 1}. ${typeof g === 'string' ? g : (g.text || g.question || JSON.stringify(g))}`).join('\n'));
  }
  if (Array.isArray(content.missing_specs) && content.missing_specs.length) {
    parts.push('Недостающие спецификации:');
    parts.push(content.missing_specs.slice(0, 15).map((m, i) => `  ${i + 1}. ${typeof m === 'string' ? m : JSON.stringify(m)}`).join('\n'));
  }
  return parts.join('\n\n');
}

// ─── Layer 2: СТРУКТУРА ПЕРЕПИСКИ ─────────────────────────────────────────
async function buildLayer2Correspondence(client, corr) {
  // Какая сущность — родитель этого письма? Берём первое NOT NULL.
  const entity = corr.tender_id      ? { col: 'tender_id',     val: corr.tender_id }
              : corr.work_id         ? { col: 'work_id',       val: corr.work_id }
              : corr.calc_id         ? { col: 'calc_id',       val: corr.calc_id }
              : corr.pre_tender_id   ? { col: 'pre_tender_id', val: corr.pre_tender_id }
              : null;
  if (!entity) {
    return { content: '', sources: [{ type: 'correspondence_thread', chars: 0, name: '(нет родительской сущности)' }] };
  }

  const r = await client.query(
    `SELECT id, number, direction, date, subject, body, body_html, counterparty, letter_kind, signing_status, version_no
       FROM correspondence
      WHERE ${entity.col} = $1
        AND id <> $2
        AND deleted_at IS NULL
      ORDER BY date DESC, id DESC
      LIMIT $3`,
    [entity.val, corr.id, LAYER2_MAX_LETTERS]
  );
  if (!r.rows.length) {
    return { content: '', sources: [{ type: 'correspondence_thread', chars: 0, name: `(нет писем по ${entity.col}=${entity.val})` }] };
  }

  const lines = r.rows.map((row) => {
    const num = row.number || 'без номера';
    const dir = row.direction || '?';
    const date = row.date ? new Date(row.date).toISOString().slice(0, 10) : '?';
    const subj = row.subject || '(без темы)';
    const body = stripHtml(row.body_html || row.body || '').slice(0, LAYER2_BODY_EXCERPT_CHARS);
    return `№${num} · ${dir} · ${date} · ${row.counterparty || '—'} · v${row.version_no || 1} · ${row.signing_status || '?'}\nТема: ${subj}\n${body}\n`;
  });

  const text = lines.join('\n---\n');
  return {
    content: text,
    sources: [{ type: 'correspondence_thread', name: `correspondence ${entity.col}=${entity.val} (${r.rows.length} писем)`, chars: text.length }]
  };
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── Layer 3: ИСТОРИЯ ЧАТА Мимира ─────────────────────────────────────────
async function buildLayer3MimirHistory(client, conversationId) {
  const r = await client.query(
    `SELECT id, role, content, content_type, created_at
       FROM mimir_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      LIMIT $2`,
    [conversationId, LAYER3_MAX_MESSAGES]
  );
  if (!r.rows.length) {
    return { content: '', sources: [{ type: 'mimir_history', chars: 0, name: `(conversation_id=${conversationId} пусто)` }] };
  }

  const lines = r.rows.map((row) => {
    const text = String(row.content || '').slice(0, LAYER3_MSG_CHARS);
    const marker = text.length >= LAYER3_MSG_CHARS ? ' [...обрезано]' : '';
    return `[${row.role}] ${text}${marker}`;
  });

  const text = lines.join('\n\n');
  return {
    content: text,
    sources: [{ type: 'mimir_history', id: conversationId, name: `mimir_messages (${r.rows.length})`, chars: text.length }]
  };
}

// ─── Layer 4: ДОГОВОР + СМЕТА (mimir_conductor_runs.final_estimate_data) ──
async function buildLayer4ContractEstimate(client, corr) {
  const runId = await resolveConductorRunId(client, corr);
  if (!runId) {
    return { content: '', sources: [{ type: 'estimate', chars: 0, name: '(нет conductor_run)' }] };
  }

  const r = await client.query(
    `SELECT id, contract_value, final_estimate_data, status, completed_at
       FROM mimir_conductor_runs
      WHERE id = $1
      LIMIT 1`,
    [runId]
  );
  if (!r.rows[0] || !r.rows[0].final_estimate_data) {
    return { content: '', sources: [{ type: 'estimate', id: runId, chars: 0, name: '(final_estimate_data пусто)' }] };
  }

  const run = r.rows[0];
  const fe = run.final_estimate_data;
  const parts = [];

  parts.push(`Conductor run #${runId} · статус: ${run.status || '?'}`);
  if (run.contract_value != null) parts.push(`Стоимость контракта (estimate): ${run.contract_value} ₽`);
  if (run.completed_at)           parts.push(`Завершён: ${new Date(run.completed_at).toISOString().slice(0, 19)}`);

  if (fe.totals && typeof fe.totals === 'object') {
    parts.push(`Итоги: ${JSON.stringify(fe.totals).slice(0, 600)}`);
  }
  if (fe.calculation && typeof fe.calculation === 'object') {
    parts.push(`Расчёт: ${JSON.stringify(fe.calculation).slice(0, 800)}`);
  }
  if (fe.crew_breakdown) {
    parts.push(`Состав бригады: ${typeof fe.crew_breakdown === 'string' ? fe.crew_breakdown.slice(0, 600) : JSON.stringify(fe.crew_breakdown).slice(0, 600)}`);
  }
  if (fe.ai_meta && Array.isArray(fe.ai_meta.warnings) && fe.ai_meta.warnings.length) {
    parts.push(`AI-предупреждения (${fe.ai_meta.warnings.length}):`);
    fe.ai_meta.warnings.slice(0, 12).forEach((w, i) => {
      parts.push(`  ${i + 1}. ${typeof w === 'string' ? w : JSON.stringify(w)}`);
    });
  }

  // Top-N позиций (если есть)
  if (Array.isArray(fe.items)) {
    parts.push(`Топ-${LAYER4_TOP_ITEMS} позиций:`);
    fe.items.slice(0, LAYER4_TOP_ITEMS).forEach((it, i) => {
      const name = it.name || it.title || it.id || `item-${i + 1}`;
      const qty = it.quantity != null ? `×${it.quantity}` : '';
      const total = it.total_price || it.total || it.price || '';
      parts.push(`  ${i + 1}. ${name} ${qty} ${total ? '= ' + total + ' ₽' : ''}`);
    });
  }

  const text = parts.join('\n');
  return {
    content: text,
    sources: [{ type: 'estimate', id: runId, name: 'mimir_conductor_runs.final_estimate_data', chars: text.length }]
  };
}

// ─── Резолв conductor_run_id ──────────────────────────────────────────────
/**
 * Найти conductor_run_id для correspondence. Стратегия:
 *   1. corr.conductor_run_id (прямая ссылка, если письмо породил Conductor)
 *   2. pre_tender_requests.id → mimir_conductor_runs WHERE ... (через pre_tender_id)
 *      Прямого FK нет, но Conductor сохраняет ссылку в mimir_conductor_runs.complexity_flags.pre_tender_id
 *      или связь через mimir_conductor_runs.tender_id (если был создан tender).
 *   3. Если corr.tender_id → найти последний mimir_conductor_runs.tender_id = X.
 */
async function resolveConductorRunId(client, corr) {
  if (corr.conductor_run_id) return corr.conductor_run_id;

  if (corr.tender_id) {
    try {
      const r = await client.query(
        `SELECT id FROM mimir_conductor_runs
          WHERE tender_id = $1
          ORDER BY id DESC LIMIT 1`,
        [corr.tender_id]
      );
      if (r.rows[0]) return Number(r.rows[0].id);
    } catch (_) { /* graceful */ }
  }

  if (corr.pre_tender_id) {
    try {
      // pre_tender_requests.created_tender_id → tender_id → mimir_conductor_runs
      const t = await client.query(
        `SELECT created_tender_id FROM pre_tender_requests WHERE id = $1`,
        [corr.pre_tender_id]
      );
      const tid = t.rows[0] && t.rows[0].created_tender_id;
      if (tid) {
        const r2 = await client.query(
          `SELECT id FROM mimir_conductor_runs WHERE tender_id = $1 ORDER BY id DESC LIMIT 1`,
          [tid]
        );
        if (r2.rows[0]) return Number(r2.rows[0].id);
      }
    } catch (_) { /* graceful */ }
  }

  if (corr.work_id) {
    try {
      const r = await client.query(
        `SELECT id FROM mimir_conductor_runs WHERE work_id = $1 ORDER BY id DESC LIMIT 1`,
        [corr.work_id]
      );
      if (r.rows[0]) return Number(r.rows[0].id);
    } catch (_) { /* graceful */ }
  }

  return null;
}

// ─── System prompt builder (по контракту §9) ──────────────────────────────
function buildSystemPrompt(corr, layersIncluded) {
  const layerList = layersIncluded.length
    ? layersIncluded.map((l) => `• ${l}`).join('\n')
    : '• (контекст пуст — действуй на основе только текущего документа)';

  return `Ты — редактор официального русского письма от ООО «Асгард-Сервис».
Текущая задача — внести точечные правки в письмо по запросу пользователя.

ПРАВИЛА:
1. Стиль: деловой, официальный. Без эмодзи, без неформальных оборотов.
2. Возвращай СТРОГО JSON-объект: {ops:[...], summary: '1 строка что изменил', confidence: 0..1}.
3. Никаких пояснений вне JSON.
4. Каждая op — атомарная правка. Допустимые ops: replace_all, insert_at_end, replace_range, replace_text, append_paragraph, wrap_in.
5. Предпочитай replace_text если поисковая строка уникальна.
6. Цитируй пункты договора если они приведены в КОНТЕКСТЕ.

ТЕКУЩЕЕ ПИСЬМО:
• Тип: ${corr.letter_kind || 'free'}
• Заголовок: ${corr.doc_title || '(не указан)'}
• Тема: ${corr.subject || '(не указана)'}
• Адресат: ${corr.counterparty || '—'}
• Статус: ${corr.signing_status || 'draft'} (редакция v${corr.version_no || 1})

ИСПОЛЬЗОВАННЫЕ СЛОИ КОНТЕКСТА:
${layerList}

КОНТЕКСТ (ниже до «=== ТЕКУЩИЙ ДОК ===» от вызывающего):
`;
}

module.exports = {
  buildLetterContext,
  // экспорт для unit-тестов и AUD
  _internal: {
    BUDGETS,
    TOKENS_PER_CHAR,
    loadCorrespondence,
    buildLayer1ParentDocs,
    buildLayer2Correspondence,
    buildLayer3MimirHistory,
    buildLayer4ContractEstimate,
    resolveConductorRunId,
    buildSystemPrompt
  }
};
