'use strict';

/**
 * Тесты: дашборд директора не показывает просрочки, которых нет.
 *
 * ── Жалоба директора 09.11.2026 ────────────────────────────────────────────
 * «Мне кажется, там показываются просрочки, которых нет».
 *
 * ── Найденный корень ───────────────────────────────────────────────────────
 * Запрос сводки по тендерам делал `LEFT JOIN tender_rp_reviews` и считал
 * `COUNT(*)`. У тендера бывает несколько просчётов (пересчёт, разные РП),
 * поэтому одна карточка учитывалась 2–3 раза. Отсюда завышенные счётчики
 * и «просрочки», которых нет.
 *
 * Просрочка по определению считается по ТЕНДЕРУ (у него один дедлайн), а не
 * по строке просчёта. Значит COUNT(DISTINCT t.id).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROUTE = path.join(__dirname, '..', 'src', 'routes', 'director-analytics.js');
const src = fs.readFileSync(ROUTE, 'utf8');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('FAIL ' + name + ' — ' + e.message);
  }
}

// ── 1. Счётчики по уникальным тендерам ─────────────────────────────────────
check('счётчики считают уникальные тендеры, а не строки джойна', () => {
  // Ищем блок сводки по тендерам.
  const block = /COUNT\(DISTINCT t\.id\)[\s\S]{0,600}?overdue_count/.exec(src);
  assert.ok(block, 'нет подсчёта по DISTINCT t.id вместе с overdue_count');
});

check('просрочки считаются по DISTINCT t.id', () => {
  // 'подались' — терминальный статус (заявка ушла), в просрочку не входит.
  const m = /COUNT\(DISTINCT t\.id\) FILTER \(\s*WHERE t\.registry_status IN \('рассмотрение','готовим'\)[\s\S]{0,240}?docs_deadline::date < CURRENT_DATE\s*\)::int AS overdue_count/.exec(src);
  assert.ok(m, 'overdue_count всё ещё считается по COUNT(*), а не по тендерам');
});

check('цена работ не складывает строки джойна', () => {
  // SUM(tr.work_price) по джойну завышал сумму так же, как счётчики.
  // Проверяем реальный SQL, а не упоминание в комментарии: ищем строку,
  // где SUM(tr.work_price) стоит в SELECT (а не в пояснении).
  const lines = src.split('\n');
  const offenders = lines.filter((l) => {
    const t = l.trim();
    if (t.startsWith('--')) return false;      // комментарий
    return /SUM\(tr\.work_price\)\s*[,)]/.test(t) && !/^\s*--/.test(t);
  });
  assert.strictEqual(offenders.length, 0,
    'SUM(tr.work_price) в SQL: ' + offenders.slice(0, 2).join(' | '));
  assert.ok(/DISTINCT ON \(tr2\.tender_id\)/.test(src),
    'нет выборки одного просчёта на тендер');
});

// ── 2. Ответ использует уникальное поле ────────────────────────────────────
check('ответ отдаёт total по уникальным тендерам', () => {
  assert.ok(/total:\s*Number\(tSum\.total_unique/.test(src),
    'total берётся из старого задублированного поля');
});

// ── 3. Логика просрочки корректна ──────────────────────────────────────────
check('просрочка требует активного статуса и заполненного дедлайна', () => {
  const m = /COUNT\(DISTINCT t\.id\) FILTER \([\s\S]{0,300}?\)::int AS overdue_count/.exec(src);
  assert.ok(m, 'не найден блок просрочки');
  const b = m[0];
  assert.ok(/registry_status IN \('рассмотрение','готовим'\)/.test(b),
    'нет фильтра по активным статусам: закрытые тендеры не могут быть просрочены');
  assert.ok(/docs_deadline IS NOT NULL/.test(b),
    'нет проверки на заполненный дедлайн');
  assert.ok(/docs_deadline::date < CURRENT_DATE/.test(b),
    'нет сравнения с текущей датой');
});

check('завершённые тендеры не попадают в просрочку', () => {
  // 'выиграли'/'проиграли' — не активные: у них дедлайн уже неважен.
  const m = /COUNT\(DISTINCT t\.id\) FILTER \([\s\S]{0,300}?\)::int AS overdue_count/.exec(src);
  const b = m ? m[0] : '';
  assert.ok(!/'выиграли'/.test(b), 'выигранные считаются просроченными');
  assert.ok(!/'проиграли'/.test(b), 'проигранные считаются просроченными');
});

// ── 4. Архивные исключены ──────────────────────────────────────────────────
check('архивные тендеры исключены из сводки', () => {
  const idx = src.indexOf('AS overdue_count');
  assert.ok(idx > 0, 'не найден overdue_count');
  const after = src.slice(idx, idx + 400);
  assert.ok(/archived_at IS NULL/.test(after), 'архивные попадают в сводку');
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
