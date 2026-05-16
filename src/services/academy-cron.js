/**
 * Academy Cron — Чертоги Мимира
 * Воскресенье 20:00 → Мимир генерирует Руну следующей недели (DRAFT)
 * Ежедневно 07:00 → Мимир генерирует Факт дня (auto-publish)
 * Уведомление PM/ADMIN → "Новая Руна готова к проверке"
 */

'use strict';

const cron = require('node-cron');
const db = require('./db');
const pushService = require('./pushService');

let aiProvider;
try { aiProvider = require('./ai-provider'); } catch (e) {}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY FACT GENERATION
// ═══════════════════════════════════════════════════════════════════════════

const FACT_CATEGORIES = [
  'construction', 'history', 'health', 'tool', 'law',
  'science', 'geography', 'viking', 'general'
];

const FACT_PROMPT = `Ты — Мимир, хранитель мудрости для рабочих строительных компаний.
Сгенерируй ОДИН интересный факт дня для рабочих.

Темы можно выбирать любые — не только техника безопасности:
- Интересные факты о строительных материалах
- История знаменитых сооружений
- Полезные советы для здоровья физически работающих людей
- Права рабочих, важные законы
- Интересная наука или география
- Факты о инструментах и технологиях
- Викинги и Norse мифология (в духе компании)
- Что-то удивительное из жизни

Требования:
- Факт должен быть НЕОЖИДАННЫМ и ИНТЕРЕСНЫМ, не скучным
- Не повторяй очевидные вещи
- Пиши для человека без высшего образования, но умного
- Длина: 2-4 предложения максимум
- Тон: уважительный, интересный, иногда с лёгким юмором

Верни ТОЛЬКО JSON без markdown:
{
  "title": "Заголовок факта (до 60 символов)",
  "body": "Текст факта (2-4 предложения)",
  "icon": "одно подходящее emoji",
  "category": "одно из: construction|history|health|tool|law|science|geography|viking|general"
}`;

async function generateDailyFact(targetDate) {
  if (!aiProvider) throw new Error('AI provider not available');

  const today = targetDate || new Date().toISOString().split('T')[0];

  // Проверить — факт на этот день уже есть?
  const { rows: existing } = await db.query(
    `SELECT id FROM academy_daily_facts WHERE fact_date = $1`, [today]
  );
  if (existing.length > 0) {
    console.log(`[AcademyCron] Daily fact for ${today} already exists, skipping`);
    return;
  }

  // Получить последние 30 заголовков чтобы Мимир не повторялся
  const { rows: recent } = await db.query(
    `SELECT title FROM academy_daily_facts ORDER BY fact_date DESC LIMIT 30`
  );
  const recentTitles = recent.map(r => r.title).join('\n');
  const avoidPrompt = recentTitles ? `\n\nИзбегай этих недавних тем:\n${recentTitles}` : '';

  const response = await aiProvider.complete({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: FACT_PROMPT + avoidPrompt },
      { role: 'user', content: `Сгенерируй факт на ${today}` }
    ],
    temperature: 0.9,
    max_tokens: 300,
  });

  let text = response.choices?.[0]?.message?.content?.trim() || '';
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  const fact = JSON.parse(text);

  await db.query(`
    INSERT INTO academy_daily_facts (fact_date, title, body, icon, category, generated_by, status)
    VALUES ($1, $2, $3, $4, $5, 'mimir', 'published')
    ON CONFLICT (fact_date) DO NOTHING
  `, [today, fact.title, fact.body, fact.icon || '⚡', fact.category || 'general']);

  console.log(`[AcademyCron] Daily fact generated for ${today}: "${fact.title}"`);
}

// ═══════════════════════════════════════════════════════════════════════════
// WEEKLY LESSON GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function getNextWeekNumber() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const currentWeek = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return currentWeek + 1;
}

const LESSON_BLOCKS_FORMAT = `
Структура блоков (массив JSON):
1. {"type":"cover","icon":"emoji","title":"...","subtitle":"..."}
2. {"type":"intro","text":"вводный абзац"}
3. {"type":"icon_grid","title":"заголовок","items":[{"icon":"emoji","label":"...","desc":"..."},...]} — 4-6 элементов 2x2 или 3x2
4. {"type":"warning","level":"danger|warning","text":"..."}
5. {"type":"steps","title":"...","items":["шаг 1","шаг 2",...]}
6. {"type":"text_block","title":"...","text":"..."}
7. {"type":"fact_card","icon":"emoji","text":"интересный факт"}

Используй 6-8 блоков. Чередуй типы для визуального разнообразия.
Начинай с cover, затем intro, потом mix других типов, заканчивай fact_card.
`;

const LESSON_SYSTEM_PROMPT = `Ты — Мимир, хранитель мудрости для рабочих строительных компаний.
Создай образовательный урок (Руну) для рабочих.

ВАЖНО: Темы НЕ ограничиваются техникой безопасности. Может быть что угодно полезное:
- Техника безопасности (ТБ, СИЗ, работа на высоте, газ, замкнутые пространства)
- Строительные материалы и технологии (бетон, металл, дерево, изоляция)
- Инструменты и оборудование (как правильно использовать, обслуживать)
- Здоровье рабочего (спина, суставы, питание при физической работе)
- Права рабочего (трудовой договор, больничный, сверхурочные, ТК РФ)
- Интересные строительные факты и история
- Практические лайфхаки для работы

Тон: уважительный, по-деловому, но не занудный. Рабочий — профессионал, не школьник.
Язык: русский, понятный без профессионального образования.

${LESSON_BLOCKS_FORMAT}

Для испытания создай 10-12 вопросов:
- 4-6 вопросов типа 'choice' (4 варианта)
- 2-3 вопроса типа 'truefalse'
- 2-3 вопроса типа 'scenario' (разбор ситуации)
- Проходной балл 80%
- Каждый вопрос должен иметь объяснение правильного ответа

Верни ТОЛЬКО JSON:
{
  "saga": "название раздела (2-3 слова)",
  "title": "название Руны (4-6 слов)",
  "cover_icon": "emoji",
  "cover_color": "#hex цвет фона обложки (тёмный)",
  "estimated_minutes": число,
  "tags": ["тег1","тег2"],
  "blocks": [...],
  "questions": [
    {
      "sort_order": 1,
      "question_type": "choice|truefalse|scenario",
      "question_text": "...",
      "options": [
        {"id":1,"text":"...","is_correct":false},
        {"id":2,"text":"...","is_correct":true},
        {"id":3,"text":"...","is_correct":false},
        {"id":4,"text":"...","is_correct":false}
      ],
      "correct_explanation": "Объяснение почему этот ответ правильный"
    }
  ]
}`;

async function generateWeeklyLesson() {
  if (!aiProvider) throw new Error('AI provider not available');

  const nextWeek = getNextWeekNumber();

  // Проверить — урок уже есть?
  const { rows: existing } = await db.query(
    `SELECT id FROM academy_lessons WHERE week_number = $1`, [nextWeek]
  );
  if (existing.length > 0) {
    console.log(`[AcademyCron] Lesson for week ${nextWeek} already exists, skipping`);
    return;
  }

  // Получить последние 12 тем чтобы не повторяться 3 месяца
  const { rows: recent } = await db.query(
    `SELECT title, saga, tags FROM academy_lessons ORDER BY week_number DESC LIMIT 12`
  );
  const recentTopics = recent.map(r => `${r.saga}: ${r.title} [${(r.tags||[]).join(',')}]`).join('\n');
  const avoidPrompt = recentTopics
    ? `\n\nИзбегай этих недавних тем (не повторяй минимум 3 месяца):\n${recentTopics}`
    : '';

  console.log(`[AcademyCron] Generating lesson for week ${nextWeek}...`);

  const response = await aiProvider.complete({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: LESSON_SYSTEM_PROMPT + avoidPrompt },
      { role: 'user', content: `Создай Руну для недели ${nextWeek}. Выбери интересную тему.` }
    ],
    temperature: 0.8,
    max_tokens: 4000,
  });

  let text = response.choices?.[0]?.message?.content?.trim() || '';
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  const lesson = JSON.parse(text);

  // Вставить урок
  const { rows: [inserted] } = await db.query(`
    INSERT INTO academy_lessons
      (week_number, saga, title, cover_icon, cover_color, estimated_minutes, tags, status, generated_by, blocks)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', 'mimir', $8)
    RETURNING id
  `, [
    nextWeek,
    lesson.saga || 'Знания Севера',
    lesson.title,
    lesson.cover_icon || '📖',
    lesson.cover_color || '#1a1a2e',
    lesson.estimated_minutes || 7,
    lesson.tags || [],
    JSON.stringify(lesson.blocks || []),
  ]);

  const lessonId = inserted.id;

  // Вставить вопросы
  for (const q of (lesson.questions || [])) {
    await db.query(`
      INSERT INTO academy_quiz_questions
        (lesson_id, sort_order, question_type, question_text, options, correct_explanation)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      lessonId, q.sort_order || 0, q.question_type || 'choice',
      q.question_text, JSON.stringify(q.options || []),
      q.correct_explanation || '',
    ]);
  }

  console.log(`[AcademyCron] Lesson "${lesson.title}" created (draft), id=${lessonId}`);

  // Уведомить PM и ADMIN
  await notifyAdmins(lesson.title, lessonId);

  return lessonId;
}

async function notifyAdmins(lessonTitle, lessonId) {
  try {
    const { rows: admins } = await db.query(`
      SELECT u.id FROM users u
      WHERE u.role IN ('ADMIN', 'PM', 'HEAD_PM', 'HR')
        AND u.is_active = true
      LIMIT 20
    `);

    for (const admin of admins) {
      await pushService.sendToUser(admin.id, {
        title: '🏛️ Мимир создал новую Руну',
        body: `«${lessonTitle}» — проверь и опубликуй перед понедельником`,
        data: { type: 'academy_lesson', lesson_id: lessonId, url: '/?page=academy-admin' },
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[AcademyCron] Failed to notify admins:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CRON SCHEDULES
// ═══════════════════════════════════════════════════════════════════════════

function init() {
  // Ежедневно в 07:00 MSK — факт дня
  cron.schedule('0 4 * * *', async () => {
    console.log('[AcademyCron] Generating daily fact...');
    try {
      await generateDailyFact();
    } catch (e) {
      console.error('[AcademyCron] Daily fact error:', e.message);
    }
  }, { timezone: 'Europe/Moscow' });

  // Каждое воскресенье в 20:00 MSK — урок следующей недели
  cron.schedule('0 17 * * 0', async () => {
    console.log('[AcademyCron] Generating weekly lesson...');
    try {
      await generateWeeklyLesson();
    } catch (e) {
      console.error('[AcademyCron] Weekly lesson error:', e.message);
    }
  }, { timezone: 'Europe/Moscow' });

  console.log('[AcademyCron] Scheduled: daily fact 07:00, weekly lesson Sunday 20:00 MSK');
}

module.exports = { init, generateDailyFact, generateWeeklyLesson };
