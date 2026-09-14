/**
 * Office Academy Cron — генерация уроков каждое 1-е число месяца
 * Каждый трек (pm/hr/finance/procurement/management/all) получает новый урок.
 * После AI-генерации: hard-gate + review → auto-publish (как Чертоги Мимира),
 * но объём/сложность выше офисного стандарта.
 */

'use strict';

const cron = require('node-cron');
const db = require('./db');
const { MODEL_FAST } = require('./ai-models');
const {
  normalizeQuestions,
  assertAllQuestions,
  BROKEN_OFFICE_QUIZ_SQL,
} = require('../lib/academy-quiz-shape');

let aiProvider;
try {
  aiProvider = require('./ai-provider');
} catch (e) {
  console.warn('[OfficAcademyCron] AI provider not available:', e.message);
}

const TRACKS = [
  { track: 'pm',          label: 'Проектный менеджмент', saga: 'Искусство руководства',  icon: '⚙️',  color: '#1e2840' },
  { track: 'hr',          label: 'HR и кадровое дело',    saga: 'Кадровое дело',           icon: '👥',  color: '#1e3830' },
  { track: 'finance',     label: 'Финансы и учёт',        saga: 'Финансовый щит',          icon: '💰',  color: '#1e2e18' },
  { track: 'procurement', label: 'Закупки и снабжение',   saga: 'Арсенал поставок',        icon: '📦',  color: '#2e1e18' },
  { track: 'management',  label: 'Управление и лидерство', saga: 'Путь лидера',            icon: '🏛️', color: '#1a1830' },
  { track: 'all',         label: 'Общий для всех',        saga: 'Цифровая броня',          icon: '🔒',  color: '#18202e' },
];

function getMonthNumber() {
  const base = new Date('2026-01-01');
  const now = new Date();
  return (now.getFullYear() - base.getFullYear()) * 12 + (now.getMonth() - base.getMonth()) + 1;
}

/** Decode literal \\uXXXX left by broken AI/seed JSON. */
function decodeUnicodeEscapes(str) {
  if (typeof str !== 'string') return str;
  if (!/\\u[0-9a-fA-F]{4}/i.test(str)) return str;
  let out = str.replace(/\\u([0-9a-fA-F]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  out = out.replace(/[\uD800-\uDFFF]/g, '');
  return out;
}

function deepDecode(val) {
  if (typeof val === 'string') return decodeUnicodeEscapes(val);
  if (Array.isArray(val)) return val.map(deepDecode);
  if (val && typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = deepDecode(v);
    return out;
  }
  return val;
}

function repairTruncatedJson(text) {
  let lastClose = text.lastIndexOf('}');
  if (lastClose < 0) return null;
  let candidate = text.slice(0, lastClose + 1);

  let depth = { brace: 0, bracket: 0 };
  let inString = false, escape = false;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth.brace++;
    else if (ch === '}') depth.brace--;
    else if (ch === '[') depth.bracket++;
    else if (ch === ']') depth.bracket--;
  }

  if (inString) return null;
  while (depth.brace < 0 && candidate.length > 0) {
    candidate = candidate.slice(0, candidate.lastIndexOf('}'));
    depth.brace++;
  }
  while (depth.bracket > 0) { candidate += ']'; depth.bracket--; }
  while (depth.brace > 0) { candidate += '}'; depth.brace--; }

  try { JSON.parse(candidate); return candidate; }
  catch { return null; }
}

function textLen(lesson) {
  const parts = [];
  for (const b of lesson.blocks || []) {
    if (!b || typeof b !== 'object') continue;
    if (b.text) parts.push(String(b.text));
    if (b.content) parts.push(String(b.content));
    if (b.title) parts.push(String(b.title));
    if (Array.isArray(b.items)) {
      for (const it of b.items) {
        if (typeof it === 'string') parts.push(it);
        else if (it) parts.push(String(it.desc || it.label || it.text || ''));
      }
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().length;
}

function hardGateOffice(lesson) {
  const blocks = lesson.blocks || [];
  const chars = textLen(lesson);
  const factCards = blocks.filter((b) => b && b.type === 'fact_card').length;
  const takeaways = blocks.filter((b) => b && (b.type === 'key_takeaway' || b.type === 'takeaway')).length;
  const mythFacts = blocks.filter((b) => b && (b.type === 'myth_fact' || b.type === 'myth_vs_fact')).length;
  const questions = normalizeQuestions(lesson.questions || []);
  const qCount = questions.length;
  const reasons = [];
  if (qCount < 8) reasons.push(`вопросов ${qCount} < 8`);
  if (blocks.length < 14) reasons.push(`блоков ${blocks.length} < 14`);
  if (chars < 6000) reasons.push(`текст ${chars} знаков < 6000`);
  if (factCards < 4) reasons.push(`fact_card ${factCards} < 4`);
  if (takeaways < 1) reasons.push('нет key_takeaway');
  if (mythFacts < 1) reasons.push('нет myth_fact');
  if (!lesson.title || String(lesson.title).length < 8) reasons.push('пустой title');
  const shapeFails = assertAllQuestions(questions, { requireId: false });
  if (shapeFails.length) reasons.push(`quiz shape: ${shapeFails.slice(0, 3).join('; ')}`);
  // Mutate so inserts use normalized options (objects + is_correct)
  lesson.questions = questions;
  return {
    ok: reasons.length === 0,
    reasons,
    qCount,
    chars,
    blocks: blocks.length,
    factCards,
    takeaways,
  };
}

async function reviewLessonDraft(lesson) {
  if (!aiProvider) {
    return { verdict: 'OK', score_interest: 8, score_edu: 8, score_depth: 8, reasons: 'no reviewer — gate only' };
  }
  const payload = {
    title: lesson.title,
    estimated_minutes: lesson.estimated_minutes,
    blocks_count: (lesson.blocks || []).length,
    questions_count: (lesson.questions || []).length,
    chars: textLen(lesson),
    blocks_preview: (lesson.blocks || []).slice(0, 12).map((b) => ({
      type: b.type,
      title: b.title || null,
      text: String(b.text || b.content || '').slice(0, 220),
    })),
    questions_preview: (lesson.questions || []).slice(0, 4).map((q) => q.question_text),
  };

  try {
    const response = await aiProvider.complete({
      model: MODEL_FAST,
      system: `Ты ревьюер корпоративных уроков Асгард CRM (офис).
Верни JSON: {"verdict":"OK"|"NOT_OK","score_interest":1-10,"score_edu":1-10,"score_depth":1-10,"reasons":"кратко"}.
OK только если: интересно читать, понятно без канцелярита, есть кейсы/цифры РФ, есть takeaway и myth/fact, quiz на понимание а не trivia.`,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
      temperature: 0.2,
      maxTokens: 1500,
    });
    let text = (response.content || response.text || '').trim();
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const m = text.match(/\{[\s\S]*\}/);
    const review = m ? JSON.parse(m[0]) : {};
    const gate = hardGateOffice(lesson);
    const scoresOk = Number(review.score_interest) >= 7
      && Number(review.score_edu) >= 7
      && Number(review.score_depth) >= 7;
    const verdictOk = String(review.verdict || '').toUpperCase() === 'OK' && scoresOk && gate.ok;
    return {
      verdict: verdictOk ? 'OK' : 'NOT_OK',
      score_interest: Number(review.score_interest) || 0,
      score_edu: Number(review.score_edu) || 0,
      score_depth: Number(review.score_depth) || 0,
      reasons: [review.reasons, ...gate.reasons].filter(Boolean).join('; '),
    };
  } catch (e) {
    const gate = hardGateOffice(lesson);
    return {
      verdict: gate.ok ? 'OK' : 'NOT_OK',
      score_interest: gate.ok ? 7 : 0,
      score_edu: gate.ok ? 7 : 0,
      score_depth: gate.ok ? 7 : 0,
      reasons: gate.ok ? ('reviewer failed, gate ok: ' + e.message) : gate.reasons.join('; '),
    };
  }
}

async function generateLesson(trackInfo, monthNumber, opts = {}) {
  if (!aiProvider) return null;

  const rewriteHint = opts.rewriteOf
    ? `\nЭто ПЕРЕВЫПУСК урока «${opts.rewriteOf}». Сделай заметно интереснее, понятнее и практичнее. Не копируй старый текст.`
    : '';

  const systemPrompt = `Ты — живой наставник коллеге в строительной подрядной компании Асгард (офис).
Пишешь урок, который хочется дочитать: без канцелярита, с крючком, кейсами и «что сделать завтра на работе».

ЦЕЛЬ: сотрудник читает 20–28 минут и реально понимает тему. Язык — простой русский. ЗАПРЕЩЕНО английские слова без нужды.

ТРЕБОВАНИЯ К ОБЪЁМУ (жёстко):
- Минимум 6000 знаков основного текста
- 14–20 блоков, разнообразие типов
- ≥4 fact_card с живыми кейсами (РФ / стройка / B2B)
- ≥1 myth_fact (2–3 пары миф/факт)
- ≥1 key_takeaway (5 буллетов «забери с собой»)
- ≥1 warning + ≥1 chapter + желательно compare или timeline
- 8–10 вопросов quiz: на ПОНИМАНИЕ сценария, не на мелкую цифру из одного абзаца
- Сложность средняя/высокая; дистракторы одинаковой длины; позиция правильного ответа разная
- correct_explanation: 2–3 предложения «почему»
- options — ТОЛЬКО массив объектов {"text":"...","is_correct":false|true}, НИКОГДА массив строк
- Ровно ОДИН вариант с is_correct: true; у truefalse ровно 2 варианта

Структура (порядок желателен):
1. cover — крючок (боль / ошибка / цифра)
2. intro — зачем это в Асгарде
3. myth_fact — 2–3 мифа
4. chapter + стержень (text_block / steps / icon_grid / scenario / compare / timeline)
5. fact_card ×4+
6. warning
7. key_takeaway
8. stat или compare

Формат ответа: строго JSON, без markdown-обёртки.
Кириллица — обычным UTF-8. ЗАПРЕЩЕНО \\uXXXX escapes.
Структура:
{
  "title": "Заголовок (до 80 символов)",
  "estimated_minutes": 22,
  "tags": ["тег1","тег2","тег3"],
  "blocks": [
    {"type":"cover","icon":"emoji","title":"...","subtitle":"крючок"},
    {"type":"intro","text":"4-6 предложений"},
    {"type":"myth_fact","title":"Мифы","items":[{"myth":"...","fact":"..."}]},
    {"type":"chapter","number":1,"title":"Название главы"},
    {"type":"text_block","title":"...","text":"5-9 предложений с примерами"},
    {"type":"fact_card","icon":"emoji","text":"кейс..."},
    {"type":"compare","title":"...","bad_title":"Плохо","good_title":"Хорошо","bad":["..."],"good":["..."]},
    {"type":"timeline","title":"...","items":[{"label":"Этап","text":"..."}]},
    {"type":"warning","level":"danger|warning","text":"..."},
    {"type":"key_takeaway","title":"Забери с собой","items":["...","...","...","...","..."]},
    {"type":"stat","value":"...","label":"..."}
  ],
  "questions": [
    {
      "question_text": "Ситуационный вопрос?",
      "question_type": "choice|truefalse|scenario",
      "options": [
        {"text":"...","is_correct":false},
        {"text":"...","is_correct":true},
        {"text":"...","is_correct":false},
        {"text":"...","is_correct":false}
      ],
      "correct_explanation": "Почему так (2-3 предложения)"
    }
  ]
}

Тон: уважительный наставник-коллега. Запрет воды и общих фраз без действия.`;

  const userPrompt = `Месяц ${monthNumber}. Трек: "${trackInfo.label}".
Серия: "${trackInfo.saga}".
Тема — практически полезная для ${trackInfo.label} в строительной/подрядной компании Асгард.
Не повторяй базовые вводные — это ${monthNumber}-й месяц обучения.${rewriteHint}`;

  try {
    const result = await aiProvider.complete({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 48000,
    });

    let text = (result.content || result.text || '').trim();
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.warn(`[OfficAcademyCron] JSON parse failed for ${trackInfo.track} (${parseErr.message}), trying repair...`);
      const repaired = repairTruncatedJson(jsonMatch[0]);
      if (!repaired) return null;
      parsed = JSON.parse(repaired);
    }
    return deepDecode(parsed);
  } catch (e) {
    console.error(`[OfficAcademyCron] AI error for track ${trackInfo.track}:`, e.message);
    return null;
  }
}

async function notifyAdmins(title, lessonId, track, outcome, review) {
  try {
    const { createNotification } = require('./notify');
    const admins = await db.query(`
      SELECT id FROM users
      WHERE role = ANY($1::text[]) AND COALESCE(is_active, true) = true
    `, [['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'HR', 'HR_MANAGER']]);
    const ok = outcome === 'published';
    const msg = ok
      ? `Офисная академия: опубликован урок «${title}» (${track}).`
      : `Офисная академия: урок «${title}» (${track}) не прошёл проверку: ${String(review?.reasons || '').slice(0, 180)}`;
    for (const u of admins.rows) {
      await createNotification(db, {
        user_id: u.id,
        title: ok ? `Академия: новый урок · #${lessonId}` : `Академия: черновик отклонён · #${lessonId}`,
        message: msg,
        type: 'system',
        link: `#/office-academy`
      });
    }
  } catch (e) {
    console.warn('[OfficAcademyCron] notify failed:', e.message);
  }
}

async function runGeneration() {
  console.log('[OfficAcademyCron] Starting monthly lesson generation...');
  const monthNumber = getMonthNumber();

  for (const trackInfo of TRACKS) {
    try {
      const { rows: existing } = await db.query(
        `SELECT id FROM office_academy_lessons WHERE month_number = $1 AND track = $2 AND status IN ('draft','published')`,
        [monthNumber, trackInfo.track]
      );
      if (existing.length > 0) {
        console.log(`[OfficAcademyCron] Lesson already exists: month=${monthNumber} track=${trackInfo.track}`);
        continue;
      }

      const releaseDate = new Date();
      releaseDate.setDate(1);

      const generated = await generateLesson(trackInfo, monthNumber);
      if (!generated) {
        console.warn(`[OfficAcademyCron] No content for ${trackInfo.track} — skip`);
        continue;
      }

      const title = String(generated.title || `${trackInfo.label}: Месяц ${monthNumber}`).slice(0, 200);
      const blocks = Array.isArray(generated.blocks) ? generated.blocks : [];
      const tags = Array.isArray(generated.tags) ? generated.tags : [trackInfo.track];
      const estimatedMinutes = Number(generated.estimated_minutes) || 20;
      const questions = Array.isArray(generated.questions) ? generated.questions : [];

      const lessonPayload = { title, blocks, questions, estimated_minutes: estimatedMinutes };
      const gate = hardGateOffice(lessonPayload);
      if (!gate.ok) {
        console.warn(`[OfficAcademyCron] Gate fail ${trackInfo.track}: ${gate.reasons.join('; ')}`);
      }

      const review = await reviewLessonDraft(lessonPayload);
      const publish = review.verdict === 'OK';

      const { rows: [lesson] } = await db.query(`
        INSERT INTO office_academy_lessons
          (month_number, track, title, saga, cover_icon, cover_color, blocks, estimated_minutes, tags,
           is_mandatory, status, generated_by, release_date, published_at, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, true,$10,'mimir',$11,$12,NOW())
        RETURNING id
      `, [
        monthNumber, trackInfo.track, title, trackInfo.saga,
        trackInfo.icon, trackInfo.color,
        JSON.stringify(blocks), estimatedMinutes, tags,
        publish ? 'published' : 'draft',
        releaseDate,
        publish ? new Date() : null,
      ]);

      const normQs = Array.isArray(lessonPayload.questions) ? lessonPayload.questions : normalizeQuestions(questions);
      if (publish) {
        const fails = assertAllQuestions(normQs, { requireId: false });
        if (fails.length) {
          console.warn(`[OfficAcademyCron] Publish blocked by quiz shape ${trackInfo.track}: ${fails.slice(0, 3).join('; ')}`);
          await db.query(`UPDATE office_academy_lessons SET status = 'draft', published_at = NULL WHERE id = $1`, [lesson.id]);
        }
      }
      for (let i = 0; i < normQs.length; i++) {
        const q = normQs[i];
        await db.query(`
          INSERT INTO office_academy_quiz_questions
            (lesson_id, sort_order, question_type, question_text, options, correct_explanation)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [
          lesson.id, i + 1,
          q.question_type || 'choice',
          decodeUnicodeEscapes(String(q.question_text || '')),
          JSON.stringify(deepDecode(q.options || [])),
          decodeUnicodeEscapes(String(q.correct_explanation || '')),
        ]);
      }

      console.log(`[OfficAcademyCron] ${publish ? 'PUBLISHED' : 'DRAFT'} #${lesson.id} ${trackInfo.track} "${title}" q=${normQs.length} review=${review.verdict}`);
      await notifyAdmins(title, lesson.id, trackInfo.track, publish ? 'published' : 'draft', review);
    } catch (e) {
      console.error(`[OfficAcademyCron] Error for track ${trackInfo.track}:`, e.message);
    }

    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log('[OfficAcademyCron] Done.');
}

let cronTask = null;
let reminderCronTask = null;

function trackInfoByKey(track) {
  return TRACKS.find((t) => t.track === track) || {
    track: track || 'all',
    label: track || 'Общий',
    saga: 'Перевыпуск',
    icon: '🏛️',
    color: '#1a1830',
  };
}

async function insertLessonWithQuestions({
  monthNumber, trackInfo, title, blocks, tags, estimatedMinutes, questions, publish, rewrittenFromId,
}) {
  const releaseDate = new Date();
  const { rows: [lesson] } = await db.query(`
    INSERT INTO office_academy_lessons
      (month_number, track, title, saga, cover_icon, cover_color, blocks, estimated_minutes, tags,
       is_mandatory, status, generated_by, release_date, published_at, created_at,
       needs_rewrite, rewritten_from_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, true,$10,'mimir',$11,$12,NOW(), false, $13)
    RETURNING id
  `, [
    monthNumber, trackInfo.track, title, trackInfo.saga,
    trackInfo.icon, trackInfo.color,
    JSON.stringify(blocks), estimatedMinutes, tags,
    publish ? 'published' : 'draft',
    releaseDate,
    publish ? new Date() : null,
    rewrittenFromId || null,
  ]);

  const normQs = normalizeQuestions(questions);
  for (let i = 0; i < normQs.length; i++) {
    const q = normQs[i];
    await db.query(`
      INSERT INTO office_academy_quiz_questions
        (lesson_id, sort_order, question_type, question_text, options, correct_explanation)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [
      lesson.id, i + 1,
      q.question_type || 'choice',
      decodeUnicodeEscapes(String(q.question_text || '')),
      JSON.stringify(deepDecode(q.options || [])),
      decodeUnicodeEscapes(String(q.correct_explanation || '')),
    ]);
  }
  return lesson;
}

/**
 * Перевыпуск: архивирует старый урок, публикует новый (или draft если gate fail).
 */
async function rewriteLesson(lessonId, opts = {}) {
  const { rows: [old] } = await db.query(
    `SELECT * FROM office_academy_lessons WHERE id = $1`,
    [lessonId]
  );
  if (!old) return { ok: false, error: 'Урок не найден' };
  if (old.status === 'archived') return { ok: false, error: 'Урок уже в архиве' };

  const trackInfo = trackInfoByKey(old.track);
  const monthNumber = Math.max(Number(old.month_number) || 1, getMonthNumber());
  const generated = await generateLesson(trackInfo, monthNumber, { rewriteOf: old.title });
  if (!generated) return { ok: false, error: 'AI не вернул контент' };

  const title = String(generated.title || `${old.title} (перевыпуск)`).slice(0, 200);
  const blocks = Array.isArray(generated.blocks) ? generated.blocks : [];
  const tags = Array.isArray(generated.tags) ? generated.tags : (old.tags || [old.track]);
  const estimatedMinutes = Number(generated.estimated_minutes) || 22;
  const questions = Array.isArray(generated.questions) ? generated.questions : [];

  const lessonPayload = { title, blocks, questions, estimated_minutes: estimatedMinutes };
  const gate = hardGateOffice(lessonPayload);
  const review = await reviewLessonDraft(lessonPayload);
  const publish = opts.forcePublish || review.verdict === 'OK';

  if (!gate.ok && !opts.forcePublish) {
    return { ok: false, error: `Gate: ${gate.reasons.join('; ')}`, gate, review };
  }

  await db.query(
    `UPDATE office_academy_lessons SET status = 'archived', needs_rewrite = false WHERE id = $1`,
    [lessonId]
  );

  const lesson = await insertLessonWithQuestions({
    monthNumber,
    trackInfo,
    title,
    blocks,
    tags,
    estimatedMinutes,
    questions,
    publish,
    rewrittenFromId: lessonId,
  });

  await notifyAdmins(title, lesson.id, trackInfo.track, publish ? 'published' : 'draft', review);
  console.log(`[OfficAcademyCron] REWRITE #${lessonId} → #${lesson.id} ${publish ? 'PUBLISHED' : 'DRAFT'}`);
  return {
    ok: true,
    old_id: lessonId,
    new_id: lesson.id,
    published: publish,
    title,
    gate,
    review,
  };
}

async function rewriteAllPublished(opts = {}) {
  const onlyNeeds = Boolean(opts.onlyNeedsRewrite);
  const { rows } = await db.query(`
    SELECT id, title, track FROM office_academy_lessons
    WHERE status = 'published'
      AND ($1::boolean = false OR needs_rewrite = true)
    ORDER BY needs_rewrite DESC, id ASC
  `, [onlyNeeds]);

  const results = [];
  for (const row of rows) {
    try {
      const r = await rewriteLesson(row.id, opts);
      results.push({ id: row.id, title: row.title, ...r });
    } catch (e) {
      results.push({ id: row.id, title: row.title, ok: false, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return results;
}

/** ROLE_TRACKS — дубль из routes (для reminder cron) */
const ROLE_TRACKS = {
  PM: ['pm', 'all'], TO: ['pm', 'all'], HEAD_PM: ['pm', 'management', 'all'],
  HEAD_TO: ['pm', 'management', 'all'], CHIEF_ENGINEER: ['pm', 'all'],
  HR: ['hr', 'all'], HR_MANAGER: ['hr', 'all'], BUH: ['finance', 'all'],
  PROC: ['procurement', 'all'], WAREHOUSE: ['procurement', 'all'],
  DIRECTOR_GEN: ['management', 'all'], DIRECTOR_COMM: ['management', 'all'],
  DIRECTOR_DEV: ['management', 'all'], OFFICE_MANAGER: ['management', 'all'],
  ADMIN: ['pm', 'hr', 'finance', 'procurement', 'management', 'all'],
};

async function runLagReminders() {
  console.log('[OfficAcademyCron] Weekly lag reminders…');

  const { rows: users } = await db.query(`
    SELECT id, name, role FROM users
    WHERE COALESCE(is_active, true) = true
      AND role = ANY($1::text[])
  `, [Object.keys(ROLE_TRACKS)]);

  const now = new Date();
  let sent = 0;
  for (const u of users) {
    const tracks = ROLE_TRACKS[u.role] || ['all'];
    const { rows: pending } = await db.query(`
      SELECT l.id, l.title
      FROM office_academy_lessons l
      LEFT JOIN office_academy_user_progress p ON p.lesson_id = l.id AND p.user_id = $1
      WHERE l.status = 'published'
        AND l.is_mandatory = true
        AND l.track = ANY($2::text[])
        AND (l.release_date IS NULL OR l.release_date <= $3)
        AND COALESCE(p.passed, false) = false
      ORDER BY l.release_date ASC NULLS LAST
      LIMIT 5
    `, [u.id, tracks, now]);
    if (!pending.length) continue;

    const week = isoWeekKey(now);
    const dedupKey = `office_lag:${u.id}:${week}`;
    const { rows: recent } = await db.query(`
      SELECT id FROM notifications
      WHERE type = 'academy_office_lag' AND dedup_key = $1
      LIMIT 1
    `, [dedupKey]);
    if (recent.length) continue;

    const titles = pending.map((p) => `«${p.title}»`).join(', ');
    const title = `${u.name || 'Коллега'}, вы отстаёте в Академии`;
    const message = `Не пройдены обязательные уроки (${pending.length}): ${titles}. Загляните в Залы Асгарда.`;
    const link = '#/office-academy';
    try {
      await db.query(`
        INSERT INTO notifications
          (user_id, type, title, message, entity_type, entity_id, link, url, dedup_key, created_at)
        VALUES ($1, 'academy_office_lag', $2, $3, 'user', $4, $5, $5, $6, NOW())
      `, [u.id, title, message, u.id, link, dedupKey]);
      sent++;
    } catch (e) {
      /* ignore per-user */
    }
  }
  console.log(`[OfficAcademyCron] Lag reminders sent: ${sent}`);
}

function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

async function auditPublishedOfficeQuizHealth() {
  const { rows } = await db.query(BROKEN_OFFICE_QUIZ_SQL);
  if (!rows.length) {
    console.log('[OfficAcademyCron] Quiz health OK — no broken published lessons');
    return { archived: 0, ids: [] };
  }
  const ids = rows.map((r) => r.id);
  await db.query(
    `UPDATE office_academy_lessons SET status = 'archived' WHERE id = ANY($1::int[])`,
    [ids]
  );
  console.warn(`[OfficAcademyCron] Quiz health ARCHIVED: ${ids.join(', ')}`);
  try {
    const { createNotification } = require('./notify');
    const admins = await db.query(`
      SELECT id FROM users
      WHERE role = ANY($1::text[]) AND COALESCE(is_active, true) = true
    `, [['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'HR', 'HR_MANAGER']]);
    const titles = rows.map((r) => `#${r.id} «${r.title}» (${r.track})`).join(', ').slice(0, 180);
    for (const u of admins.rows) {
      await createNotification(db, {
        user_id: u.id,
        title: 'Академия: битый квиз убран',
        message: `Архивированы офисные уроки с невалидными options: ${titles}`,
        type: 'system',
        link: '#/office-academy',
      });
    }
  } catch (e) {
    console.warn('[OfficAcademyCron] health notify failed:', e.message);
  }
  return { archived: ids.length, ids };
}

let healthCronTask = null;

function start() {
  // 1-е число каждого месяца в 06:00 MSK (03:00 UTC)
  cronTask = cron.schedule('0 3 1 * *', () => {
    runGeneration().catch((e) => console.error('[OfficAcademyCron] Unhandled error:', e.message));
  }, { timezone: 'UTC' });

  // Понедельник 09:00 MSK = 06:00 UTC
  reminderCronTask = cron.schedule('0 6 * * 1', () => {
    runLagReminders().catch((e) => console.error('[OfficAcademyCron] Lag reminder error:', e.message));
  }, { timezone: 'UTC' });

  // Ежедневно 07:15 MSK = 04:15 UTC — health-check квизов
  healthCronTask = cron.schedule('15 4 * * *', () => {
    auditPublishedOfficeQuizHealth().catch((e) => console.error('[OfficAcademyCron] Quiz health error:', e.message));
  }, { timezone: 'UTC' });

  console.log('[OfficAcademyCron] Scheduled: 1st @06:00 MSK gen; Mon @09:00 lag; daily @07:15 quiz-health');
}

function stop() {
  if (cronTask) { cronTask.stop(); cronTask = null; }
  if (reminderCronTask) { reminderCronTask.stop(); reminderCronTask = null; }
  if (healthCronTask) { healthCronTask.stop(); healthCronTask = null; }
}

module.exports = {
  start,
  stop,
  runGeneration,
  runLagReminders,
  auditPublishedOfficeQuizHealth,
  hardGateOffice,
  deepDecode,
  generateLesson,
  reviewLessonDraft,
  rewriteLesson,
  rewriteAllPublished,
  TRACKS,
  getMonthNumber,
};
