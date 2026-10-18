'use strict';

/**
 * academy-fix-content.js — дополнение ТЕКСТА (>=6000) и ВОПРОСОВ (>=15) в существующие лекции.
 *
 * ГЛАВНОЕ ПРАВИЛО: НЕ ломать прогресс рабочих.
 *   • Работаем с СУЩЕСТВУЮЩЕЙ лекцией: UPDATE ... WHERE id=<тот же id>.
 *   • Никаких DELETE / INSERT новых лекций / смены week_number.
 *   • academy_worker_progress (passed, score, достижения) НЕ трогается.
 *   • Вопросы: ДОБАВЛЯЕМ недостающие (существующие id сохраняются, чтобы
 *     сохранённые ответы/passed остались валидными). Если вопросов 0 — добавляем с нуля.
 *
 * Текст: дописываем ДОПОЛНИТЕЛЬНЫЕ блоки (text_block/fact_card/steps) в конец blocks,
 *   НЕ удаляя и не меняя существующие. Так исходный текст сохраняется.
 *
 * Использование:
 *   node tools/academy-fix-content.js --list                 # что нужно дополнить
 *   node tools/academy-fix-content.js --lesson 27 --apply    # одна лекция
 *   node tools/academy-fix-content.js --all --apply          # все нуждающиеся
 *   node tools/academy-fix-content.js --lesson 27 --rollback # вернуть blocks из бэкапа
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
  .split(/\r?\n/).filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
const pool = new Pool({ host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD });

const API_KEY = env.OPENAI_API_KEY;
const CHAT_URL = 'https://routerai.ru/api/v1/chat/completions';
const MODEL = 'deepseek/deepseek-v4.1-flash';   // дешёвый JSON
const MIN_TEXT = 6000;
const MIN_Q = 15;

console.warn = (...a) => console.log(...a);

function textLen(blocks) {
  let n = 0;
  for (const b of blocks || []) {
    if (!b || b.type === 'illustration') continue;
    if (b.text) n += String(b.text).length;
    if (b.title) n += String(b.title).length;
    if (Array.isArray(b.items)) for (const it of b.items) {
      if (typeof it === 'string') n += it.length;
      else if (it) n += String(it.desc || it.label || it.text || '').length;
    }
  }
  return n;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function llm(system, user, maxTokens = 8000) {
  for (let a = 1; a <= 4; a++) {
    try {
      const r = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + API_KEY },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.6, max_tokens: maxTokens, response_format: { type: 'json_object' }, reasoning: { enabled: false } }),
      });
      const j = await r.json();
      let t = (j.choices?.[0]?.message?.content || '').trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
      const m = t.match(/\{[\s\S]*\}/);
      if (!m) { console.log(`  [llm] попытка ${a}: нет JSON`); await sleep(3000); continue; }
      return { json: JSON.parse(m[0]), cost: Number(j.usage?.cost) || 0 };
    } catch (e) { console.log(`  [llm] попытка ${a}: ${e.message}`); await sleep(3000); }
  }
  return null;
}

// ── ТЕКСТ: дописать блоки ────────────────────────────────────────────────────
const TEXT_SYS = `Ты — Мимир, наставник рабочих. Текст урока оказался слишком коротким. ДОПИШИ материал.
Верни СТРОГО JSON: {"blocks":[{"type":"text_block","title":"...","text":"..."}|{"type":"fact_card","icon":"emoji","text":"..."}|{"type":"steps","title":"...","items":["шаг",...]}]}
ТРЕБОВАНИЯ:
- Только русский язык, без латиницы (кроме общепринятых H₂S, CO).
- Конкретика: цифры, нормы, ГОСТ/СП/ПОТ с номерами, реальные примеры.
- НЕ ПОВТОРЯЙ то, что уже есть в уроке — дополняй новыми аспектами.
- text_block: 6-10 предложений. fact_card: реальный случай/факт, 4-6 предложений. steps: 5-7 шагов с пояснениями.
- Дай СТОЛЬКО блоков, чтобы суммарно добавилось не менее {NEED} знаков.`;

async function expandText(lesson, need) {
  const existing = (lesson.blocks || []).filter((b) => b.type !== 'illustration')
    .map((b) => `[${b.type}] ${(b.title || '')} ${String(b.text || '').slice(0, 200)}`).join('\n');
  const user = `Урок: «${lesson.title}» (раздел ${lesson.saga}).
Уже есть блоки:
${existing}

Допиши материал минимум на ${need} знаков. Верни ТОЛЬКО JSON.`;
  const res = await llm(TEXT_SYS.replace('{NEED}', need), user, 8000);
  if (!res || !Array.isArray(res.json.blocks) || !res.json.blocks.length) return null;
  return res;
}

// ── ВОПРОСЫ: добрать до 15 ───────────────────────────────────────────────────
const QUIZ_SYS = `Ты — Мимир. Дополни тест урока новыми вопросами.
Верни СТРОГО JSON: {"questions":[{"sort_order":N,"question_type":"choice|truefalse|scenario","question_text":"...","options":[{"id":"a","text":"...","is_correct":false},...],"correct_explanation":"..."}]}
ТРЕБОВАНИЯ:
- Только русский.
- Ровно ОДИН вариант с is_correct=true; ровно 4 варианта (у truefalse — 2: Верно/Неверно).
- Вопросы сложные: без чтения урока не ответить. Дистракторы правдоподобные, одной длины.
- correct_explanation: 3-4 предложения.
- НЕ ДУБЛИРУЙ уже имеющиеся вопросы по смыслу.
- КРИТИЧНО про позицию правильного ответа: распределяй РАВНОМЕРНО по всем 4 позициям.
  В наборе из N вопросов правильный ответ должен стоять на позиции 0 примерно N/4 раз, на позиции 1 — N/4, на 2 — N/4, на 3 — N/4.
  НЕ ставь правильный ответ вторым по умолчанию. Чередуй: 1-й, 4-й, 2-й, 3-й, 1-й, 3-й...`;

async function addQuestions(lesson, existingQs, need) {
  const list = existingQs.map((q) => `- ${q.question_text}`).join('\n') || '(вопросов нет)';
  const user = `Урок: «${lesson.title}» (раздел ${lesson.saga}).
Уже есть вопросы:
${list}

Добавь ещё ${need} новых вопросов (нумерация sort_order продолжает существующие). Верни ТОЛЬКО JSON.`;
  const res = await llm(QUIZ_SYS, user, 8000);
  if (!res || !Array.isArray(res.json.questions) || !res.json.questions.length) return null;
  return res;
}

/**
 * Выровнять позиции правильных ответов: LLM ставит верный вариант 2-м в ~45%
 * случаев. Персональное перемешивание на клиенте это компенсирует, но ровная
 * база лучше (меньше зависимость от перемешивания, красивее в БД).
 * Переставляем варианты так, чтобы позиция верного ответа чередовалась.
 */
function balanceCorrectPositions(questions) {
  const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
  const out = [];
  let target = 0; // куда хотим поставить верный ответ в этом вопросе
  for (const q of questions) {
    const opts = Array.isArray(q.options) ? q.options.slice() : [];
    if (opts.length < 2) { out.push(q); continue; }
    const ci = opts.findIndex((o) => o && o.is_correct === true);
    if (ci < 0) { out.push(q); continue; }
    const pos = target % opts.length;
    target += 1;
    if (pos !== ci) {
      const correct = opts[ci];
      const rest = opts.filter((_, i) => i !== ci);
      rest.splice(pos, 0, correct);
      q.options = rest.map((o, i) => ({ ...o, id: LETTERS[i] || String(i + 1) }));
    } else {
      q.options = opts.map((o, i) => ({ ...o, id: LETTERS[i] || String(i + 1) }));
    }
    out.push(q);
  }
  return out;
}

// ── Бэкап ────────────────────────────────────────────────────────────────────
async function ensureBackup() {
  await pool.query(`CREATE TABLE IF NOT EXISTS academy_content_backup (
    id SERIAL PRIMARY KEY, lesson_id INTEGER, blocks JSONB, note TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const all = args.includes('--all');
  const li = args.indexOf('--lesson');
  const lessonId = li >= 0 ? Number(args[li + 1]) : null;

  const { rows } = await pool.query(`
    SELECT al.id, al.week_number, al.title, al.saga, al.blocks, al.is_mandatory,
           (SELECT count(*) FROM academy_quiz_questions q WHERE q.lesson_id=al.id)::int AS nq
    FROM academy_lessons al WHERE al.status='published' ORDER BY al.week_number`);
  const need = rows.filter((r) => textLen(r.blocks) < MIN_TEXT || r.nq < MIN_Q);
  console.log('══════════════════════════════════════════════');
  console.log(`Лекций published: ${rows.length}`);
  console.log(`Нужно дополнить: ${need.length} (текст < ${MIN_TEXT} или вопросов < ${MIN_Q})`);
  console.log(`Режим: ${apply ? 'ЗАПИСЬ' : 'dry-run'}`);
  console.log('══════════════════════════════════════════════');

  let targets = need;
  if (lessonId) targets = need.filter((r) => r.id === lessonId);
  if (!all && !lessonId) { console.log('Укажи --lesson N или --all'); await pool.end(); return; }

  let spent = 0, doneOk = 0;
  for (const r of targets) {
    const tl = textLen(r.blocks);
    const needText = Math.max(0, MIN_TEXT - tl);
    const needQ = Math.max(0, MIN_Q - r.nq);
    console.log(`\n── #${r.id} «${r.title.slice(0, 40)}» текст=${tl} (+${needText}), вопросов=${r.nq} (+${needQ}) ──`);
    if (!apply) { console.log('   (dry-run)'); continue; }

    let blocks = r.blocks;
    let addedText = 0, addedQ = 0;
    await ensureBackup();
    await pool.query(`INSERT INTO academy_content_backup (lesson_id, blocks, note) VALUES ($1,$2::jsonb,$3)`,
      [r.id, JSON.stringify(r.blocks), `pre content-expand text<${MIN_TEXT}|q<${MIN_Q}`]);

    // текст
    if (needText > 0) {
      const res = await expandText(r, needText + 400);
      if (res) {
        spent += res.cost;
        const add = res.json.blocks.filter((b) => b && b.type && (b.text || Array.isArray(b.items)));
        blocks = [...blocks, ...add];
        addedText = textLen(add);
        console.log(`   +текст: ${add.length} блоков, +${addedText} знаков (теперь ${textLen(blocks)})`);
      } else console.log('   текст: не удалось');
    }

    // вопросы
    if (needQ > 0) {
      const { rows: exq } = await pool.query(`SELECT question_text, sort_order FROM academy_quiz_questions WHERE lesson_id=$1 ORDER BY sort_order`, [r.id]);
      const res = await addQuestions(r, exq, needQ + 2);
      if (res) {
        spent += res.cost;
        const { normalizeQuestions, assertAllQuestions } = require(path.join(ROOT, 'src', 'lib', 'academy-quiz-shape'));
        let normalized = normalizeQuestions(res.json.questions);
        // выравниваем позиции верных ответов (LLM любит ставить 2-й)
        normalized = balanceCorrectPositions(normalized);
        const maxSo = Math.max(0, ...exq.map((q) => q.sort_order || 0));
        let ok = 0;
        for (const q of normalized) {
          if (assertAllQuestions([q], { requireId: true }).length) continue;
          await pool.query(`INSERT INTO academy_quiz_questions (lesson_id, sort_order, question_type, question_text, options, correct_explanation)
            VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
            [r.id, (q.sort_order || 0) + maxSo, q.question_type, q.question_text, JSON.stringify(q.options), q.correct_explanation]);
          ok++;
        }
        addedQ = ok;
        console.log(`   +вопросов: ${ok}`);
      } else console.log('   вопросы: не удалось');
    }

    if (addedText > 0) await pool.query(`UPDATE academy_lessons SET blocks=$1::jsonb WHERE id=$2`, [JSON.stringify(blocks), r.id]);
    const { rows: chk } = await pool.query(`SELECT (SELECT count(*) FROM academy_quiz_questions WHERE lesson_id=$1)::int q`, [r.id]);
    const finalText = textLen(blocks);
    const okAll = finalText >= MIN_TEXT && chk[0].q >= MIN_Q;
    if (okAll) doneOk++;
    console.log(`   ИТОГ: текст=${finalText}/${MIN_TEXT} ${finalText >= MIN_TEXT ? '✓' : '✗'}, вопросов=${chk[0].q}/${MIN_Q} ${chk[0].q >= MIN_Q ? '✓' : '✗'}`);
  }
  console.log(`\n══════ готово: ${doneOk}/${targets.length}, потрачено ~${spent.toFixed(2)} ₽ ══════`);
  await pool.end();
}

main().catch(async (e) => { console.error('FATAL', e.message); try { await pool.end(); } catch (_) {} process.exit(1); });
