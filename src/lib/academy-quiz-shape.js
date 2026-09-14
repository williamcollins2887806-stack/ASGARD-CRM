'use strict';

/**
 * Единая нормализация/валидация quiz options для field + office academy.
 * Запрещает публикацию уроков с options как массивом строк / без is_correct.
 */

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Fisher–Yates shuffle (in-place), returns same array. */
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Перемешивает варианты ответа и переназначает id a/b/c/d по новому порядку.
 * Нужно: LLM почти всегда ставит is_correct на второй вариант (как в примере промпта).
 */
function shuffleQuizOptions(options) {
  const arr = Array.isArray(options) ? options.slice() : [];
  if (arr.length < 2) return arr;
  shuffleInPlace(arr);
  return arr.map((o, idx) => ({
    ...o,
    id: LETTERS[idx] || String(idx + 1),
  }));
}

function normalizeQuizOptions(rawOptions, questionType) {
  const arr = Array.isArray(rawOptions) ? rawOptions : [];
  if (arr.length === 0) return [];

  const mapped = arr.map((o, idx) => {
    if (typeof o === 'string') {
      return {
        id: LETTERS[idx] || String(idx + 1),
        text: o.trim(),
        is_correct: false,
      };
    }
    if (o && typeof o === 'object') {
      const text = String(o.text || o.label || o.value || '').trim();
      const id = String(o.id != null && o.id !== '' ? o.id : (LETTERS[idx] || String(idx + 1)));
      const is_correct = o.is_correct === true || o.is_correct === 'true' || o.is_correct === 1;
      return { id, text, is_correct };
    }
    return { id: LETTERS[idx] || String(idx + 1), text: '', is_correct: false };
  }).filter((o) => o.text.length > 0);

  const correctCount = mapped.filter((o) => o.is_correct).length;
  if (correctCount > 1) {
    let seen = false;
    for (const o of mapped) {
      if (o.is_correct) {
        if (seen) o.is_correct = false;
        else seen = true;
      }
    }
  }
  // truefalse оставляем как есть (Верно/Неверно) — порядок не критичен и привычен
  if (questionType === 'truefalse') return mapped;
  return shuffleQuizOptions(mapped);
}

/**
 * @param {object} q
 * @param {{ requireId?: boolean }} [opts] — field scoring uses option id; office uses index
 */
function assertQuizQuestionShape(q, opts = {}) {
  const requireId = opts.requireId !== false;
  const reasons = [];
  if (!q || !String(q.question_text || '').trim()) reasons.push('пустой question_text');
  if (!Array.isArray(q.options) || q.options.length < 2) reasons.push('options < 2');
  else {
    if (q.options.some((o) => typeof o === 'string')) reasons.push('options — строки (нужны объекты)');
    if (q.options.some((o) => o && typeof o === 'object' && !String(o.text || '').trim())) {
      reasons.push('пустой text в option');
    }
    if (requireId && q.options.some((o) => o && typeof o === 'object' && (o.id == null || String(o.id) === ''))) {
      reasons.push('нет id у option');
    }
    const correct = q.options.filter((o) => o && o.is_correct === true).length;
    if (correct !== 1) reasons.push(`is_correct count=${correct} (нужен 1)`);
  }
  if (q.question_type === 'truefalse' && Array.isArray(q.options) && q.options.length !== 2) {
    reasons.push('truefalse != 2 options');
  }
  return reasons;
}

function normalizeQuestions(rawQuestions) {
  return (Array.isArray(rawQuestions) ? rawQuestions : [])
    .map((q, i) => {
      const question_type = q.question_type || 'choice';
      return {
        sort_order: q.sort_order || (i + 1),
        question_type,
        question_text: String(q.question_text || q.text || q.question || '').trim(),
        options: normalizeQuizOptions(q.options || [], question_type),
        correct_explanation: q.correct_explanation || q.explanation || '',
      };
    })
    .filter((q) => q.question_text.length > 0);
}

function assertAllQuestions(questions, opts = {}) {
  const fails = [];
  for (const q of questions) {
    const r = assertQuizQuestionShape(q, opts);
    if (r.length) fails.push(`q${q.sort_order}: ${r.join(', ')}`);
  }
  return fails;
}

/** Option text for UI (string | {text}). */
function optionDisplayText(opt) {
  if (typeof opt === 'string') return opt;
  return String(opt?.text || opt?.label || '').trim();
}

/** Sanitize for client GET: strip is_correct, coerce string options. */
function sanitizeOptionsForClient(options) {
  return (Array.isArray(options) ? options : []).map((o, idx) => {
    if (typeof o === 'string') {
      return { text: o, id: LETTERS[idx] || String(idx + 1) };
    }
    return {
      text: o?.text || '',
      id: o?.id || LETTERS[idx] || String(idx + 1),
    };
  }).filter((o) => o.text);
}

/**
 * SQL-фрагмент: published урок с битым квизом.
 * Используется в health-check.
 */
const BROKEN_QUIZ_SQL = `
  SELECT DISTINCT al.id, al.title, al.status
  FROM academy_lessons al
  JOIN academy_quiz_questions aq ON aq.lesson_id = al.id
  WHERE al.status = 'published'
    AND (
      aq.options IS NULL
      OR jsonb_typeof(aq.options) IS DISTINCT FROM 'array'
      OR jsonb_array_length(aq.options) < 2
      OR COALESCE(NULLIF(trim(aq.question_text), ''), NULL) IS NULL
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(aq.options) o
        WHERE jsonb_typeof(o) = 'string'
           OR COALESCE(NULLIF(trim(o->>'text'), ''), NULL) IS NULL
           OR (o->>'id') IS NULL OR trim(o->>'id') = ''
      )
      OR (
        SELECT COUNT(*) FROM jsonb_array_elements(aq.options) o
        WHERE (o->>'is_correct') IN ('true','t','1')
           OR (o->>'is_correct')::boolean IS TRUE
      ) <> 1
    )
`;

const BROKEN_OFFICE_QUIZ_SQL = `
  SELECT DISTINCT al.id, al.title, al.status, al.track
  FROM office_academy_lessons al
  JOIN office_academy_quiz_questions aq ON aq.lesson_id = al.id
  WHERE al.status = 'published'
    AND (
      aq.options IS NULL
      OR jsonb_typeof(aq.options) IS DISTINCT FROM 'array'
      OR jsonb_array_length(aq.options) < 2
      OR COALESCE(NULLIF(trim(aq.question_text), ''), NULL) IS NULL
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(aq.options) o
        WHERE jsonb_typeof(o) = 'string'
           OR COALESCE(NULLIF(trim(o->>'text'), ''), NULL) IS NULL
      )
      OR (
        SELECT COUNT(*) FROM jsonb_array_elements(aq.options) o
        WHERE (o->>'is_correct') IN ('true','t','1')
           OR (o->>'is_correct')::boolean IS TRUE
      ) <> 1
    )
`;

module.exports = {
  normalizeQuizOptions,
  shuffleQuizOptions,
  assertQuizQuestionShape,
  normalizeQuestions,
  assertAllQuestions,
  sanitizeOptionsForClient,
  optionDisplayText,
  BROKEN_QUIZ_SQL,
  BROKEN_OFFICE_QUIZ_SQL,
};
