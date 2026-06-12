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

  const systemPrompt = `Ты — корпоративный тренер Асгард. Создаёшь ГЛУБОКИЙ образовательный урок для офисного сотрудника.
Цель: сотрудник читает 15-20 минут и реально учится, а не пробегает глазами.

ТРЕБОВАНИЯ К ОБЪЁМУ:
- Минимум 4000 знаков основного текста
- 14-18 блоков, разнообразие типов
- Каждый text-блок: 4-7 предложений с цифрами/примерами
- Минимум 2 fact_card с реальными кейсами из практики
- Минимум 1 warning блок об опасностях/ошибках
- 8-10 вопросов quiz (4 варианта), каждый требует знания КОНКРЕТНОГО факта из текста

Формат ответа: строго JSON, без markdown-обёртки.
Структура:
{
  "title": "Заголовок урока (до 80 символов)",
  "estimated_minutes": 18,
  "tags": ["тег1","тег2","тег3"],
  "blocks": [
    {"type":"cover","icon":"emoji","title":"...","subtitle":"подзаголовок-крючок"},
    {"type":"intro","text":"вводный абзац — зачем это знать, риски незнания (4-6 предложений)"},
    {"type":"text_block","title":"...","text":"плотный абзац: определения, цифры (5-9 предложений)"},
    {"type":"icon_grid","title":"...","items":[{"icon":"emoji","label":"короткий","desc":"объяснение 8-15 слов"}]},
    {"type":"steps","title":"...","items":["шаг с конкретикой","..."]},
    {"type":"warning","level":"danger|warning","text":"опасность + последствия + как избежать (3-5 предл)"},
    {"type":"fact_card","icon":"emoji","text":"реальный кейс: год, место, что случилось, причина, урок (4-6 предл)"}
  ],
  "questions": [
    {
      "question_text": "Вопрос на КОНКРЕТНУЮ цифру/факт из текста?",
      "question_type": "choice",
      "options": [
        {"text":"Правдоподобный неверный","is_correct":false},
        {"text":"Правильный","is_correct":true},
        {"text":"Близкий неверный","is_correct":false},
        {"text":"Частое заблуждение","is_correct":false}
      ],
      "correct_explanation": "Объяснение со ссылкой на материал (2-3 предложения)"
    }
  ]
}

ЗАПРЕЩЕНО:
- Вопросы на «здравый смысл» без чтения текста
- Размытые цели типа «улучшить» без цифр
- Общие фразы — только конкретика, нормы, реальные примеры из РФ

Тон: уважительный, как опытный коллега новичку. Язык: русский.`;

  const userPrompt = `Месяц ${monthNumber}. Трек: "${trackInfo.label}".
Серия: "${trackInfo.saga}".
Напиши новый урок — тему выбери сам, она должна быть свежей и практически полезной.
Не повторяй базовые вводные темы — это ${monthNumber}-й месяц обучения.`;

  try {
    const result = await aiProvider.complete({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      // Sonnet 4.6: output до 64K. Берём 48K — урок Академии короче чем
      // Чертоги (8-10 вопросов вместо 12), но всё равно нужен запас на
      // 14-18 блоков + fact_card. JSON repair страхует.
      maxTokens: 48000,
    });

    let text = (result.content || result.text || '').trim();
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      // JSON обрезался по токенам — пробуем repair
      console.warn(`[OfficAcademyCron] JSON parse failed for ${trackInfo.track} (${parseErr.message}), trying repair...`);
      const repaired = repairTruncatedJson(jsonMatch[0]);
      if (!repaired) return null;
      return JSON.parse(repaired);
    }
  } catch (e) {
    console.error(`[OfficAcademyCron] AI error for track ${trackInfo.track}:`, e.message);
    return null;
  }
}

// Восстанавливает обрезанный по лимиту токенов JSON: закрывает недостающие
// массивы и объекты, обрезает незакрытые строки.
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
