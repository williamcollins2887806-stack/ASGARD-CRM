/**
 * Office Academy Cron — генерация уроков каждое 1-е число месяца
 * Каждый трек (pm/hr/finance/procurement/management/all) получает новый урок-драфт.
 * Mimir генерирует title + blocks + quiz questions.
 * Урок остаётся в статусе draft до ручного одобрения администратором.
 */

'use strict';

const cron = require('node-cron');
const db = require('./db');

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

// Считаем глобальный номер месяца от 2026-01-01
function getMonthNumber() {
  const base = new Date('2026-01-01');
  const now = new Date();
  return (now.getFullYear() - base.getFullYear()) * 12 + (now.getMonth() - base.getMonth()) + 1;
}

async function generateLesson(trackInfo, monthNumber) {
  if (!aiProvider) return null;

  const systemPrompt = `Ты — корпоративный тренер Асгард. Создаёшь образовательный урок для сотрудников.
Формат ответа: строго JSON, без markdown-обёртки.
Структура:
{
  "title": "Заголовок урока (до 80 символов)",
  "estimated_minutes": <число 15-25>,
  "tags": ["тег1", "тег2", "тег3"],
  "blocks": [
    {"type":"heading","text":"Заголовок раздела"},
    {"type":"text","content":"Текст параграфа..."},
    {"type":"list","items":["Пункт 1","Пункт 2","Пункт 3"]},
    {"type":"highlight","text":"Ключевая мысль или важное правило"},
    {"type":"quote","text":"Цитата или принцип","author":"Источник"}
  ],
  "questions": [
    {
      "question_text": "Вопрос?",
      "question_type": "choice",
      "options": [
        {"text":"Вариант 1","is_correct":false},
        {"text":"Вариант 2","is_correct":true},
        {"text":"Вариант 3","is_correct":false},
        {"text":"Вариант 4","is_correct":false}
      ],
      "correct_explanation": "Объяснение правильного ответа"
    }
  ]
}
Требования:
- 12-18 блоков, разнообразие типов (heading, text, list, highlight, quote)
- 5-7 вопросов quiz (4 варианта, 1 правильный)
- Всё на русском языке
- Практический, применимый контент для офисных сотрудников строительной компании
- Никаких общих фраз — конкретные инструменты, правила, примеры из практики`;

  const userPrompt = `Месяц ${monthNumber}. Трек: "${trackInfo.label}".
Серия: "${trackInfo.saga}".
Напиши новый урок — тему выбери сам, она должна быть свежей и практически полезной.
Не повторяй базовые вводные темы — это ${monthNumber}-й месяц обучения.`;

  try {
    const result = await aiProvider.complete({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 3000,
    });

    const text = (result.content || result.text || '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error(`[OfficAcademyCron] AI error for track ${trackInfo.track}:`, e.message);
    return null;
  }
}

async function runGeneration() {
  console.log('[OfficAcademyCron] Starting monthly lesson generation...');
  const monthNumber = getMonthNumber();

  for (const trackInfo of TRACKS) {
    try {
      // Проверяем, нет ли уже урока за этот месяц
      const { rows: existing } = await db.query(
        `SELECT id FROM office_academy_lessons WHERE month_number = $1 AND track = $2`,
        [monthNumber, trackInfo.track]
      );
      if (existing.length > 0) {
        console.log(`[OfficAcademyCron] Lesson already exists: month=${monthNumber} track=${trackInfo.track}`);
        continue;
      }

      const releaseDate = new Date();
      releaseDate.setDate(1); // 1-е число текущего месяца

      // Генерируем через AI
      const generated = await generateLesson(trackInfo, monthNumber);

      let title, blocks, tags, estimatedMinutes, questions;

      if (generated) {
        title = generated.title;
        blocks = generated.blocks || [];
        tags = generated.tags || [];
        estimatedMinutes = generated.estimated_minutes || 20;
        questions = generated.questions || [];
      } else {
        // Заглушка если AI недоступен
        title = `${trackInfo.label}: Месяц ${monthNumber}`;
        blocks = [{ type: 'text', content: 'Урок готовится. Контент будет добавлен администратором.' }];
        tags = [trackInfo.track];
        estimatedMinutes = 20;
        questions = [];
      }

      // Создаём урок
      const { rows: [lesson] } = await db.query(`
        INSERT INTO office_academy_lessons
          (month_number, track, title, saga, cover_icon, cover_color, blocks, estimated_minutes, tags,
           is_mandatory, status, generated_by, release_date, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, true,'draft','mimir',$10,NOW())
        RETURNING id
      `, [
        monthNumber, trackInfo.track, title, trackInfo.saga,
        trackInfo.icon, trackInfo.color,
        JSON.stringify(blocks), estimatedMinutes, tags,
        releaseDate,
      ]);

      // Создаём вопросы quiz
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        await db.query(`
          INSERT INTO office_academy_quiz_questions
            (lesson_id, sort_order, question_type, question_text, options, correct_explanation)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [
          lesson.id, i + 1,
          q.question_type || 'choice',
          q.question_text,
          JSON.stringify(q.options || []),
          q.correct_explanation || '',
        ]);
      }

      console.log(`[OfficAcademyCron] Created lesson #${lesson.id}: month=${monthNumber} track=${trackInfo.track} "${title}" (${questions.length} questions)`);
    } catch (e) {
      console.error(`[OfficAcademyCron] Error for track ${trackInfo.track}:`, e.message);
    }

    // Пауза между треками — не спамим AI
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log('[OfficAcademyCron] Done.');
}

let cronTask = null;

function start() {
  // 1-е число каждого месяца в 06:00 MSK (03:00 UTC)
  cronTask = cron.schedule('0 3 1 * *', () => {
    runGeneration().catch((e) => console.error('[OfficAcademyCron] Unhandled error:', e.message));
  }, { timezone: 'UTC' });

  console.log('[OfficAcademyCron] Scheduled: 1st of month at 06:00 MSK');
}

function stop() {
  if (cronTask) { cronTask.stop(); cronTask = null; }
}

module.exports = { start, stop, runGeneration };
