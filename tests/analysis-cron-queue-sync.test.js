'use strict';

/**
 * Крон напоминаний об анализе: условия совпадают с очередью РП.
 *
 * ── Что тут ловится (верификатор, 09.11.2026) ─────────────────────────────
 * Мутация «вернуть статус только рассмотрение» проходила незамеченной — тестов
 * на крон не было. Из-за рассинхрона условий письмо по тендеру 2121 приходило,
 * а в очереди РП карточки не было.
 *
 * Дополнительно: 33 карточки очередь показывала, а крон не видел никогда —
 * INNER JOIN отбрасывал их, потому что строки в tender_rp_reviews ещё нет.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'src', 'services', 'pm-analysis-stale-cron.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + ' — ' + e.message); }
}

/** SQL выборки кандидатов (первый db.query в findCandidates). */
const candidatesSql = (() => {
  const m = src.match(/async function findCandidates[\s\S]*?const r = await db\.query\(`([\s\S]*?)`\)/);
  return m ? m[1] : '';
})();

check('выборка кандидатов найдена', () => {
  assert.ok(candidatesSql.length > 200, 'SQL findCandidates не распознан');
});

check('крон = очередь анализа: только рассмотрение', () => {
  // analysisQueueSql в pm-duty.js: registry_status = 'рассмотрение'.
  // «готовим» — фаза просчёта, в вкладке анализа её нет. Инцидент 10.11.2026:
  // крон с IN (рассмотрение, готовим) слал Очаково/АИМ, которых РП не видел.
  assert.ok(/registry_status\s*=\s*'рассмотрение'/.test(candidatesSql),
    'крон должен совпадать с analysisQueueSql (= рассмотрение)');
  assert.ok(!/registry_status IN \('рассмотрение',\s*'готовим'\)/.test(candidatesSql),
    'нельзя снова расширять до готовим — дайджест уйдёт мимо очереди');
});

check('LEFT JOIN: карточки без строки ревью не теряются', () => {
  assert.ok(/FROM tenders t/.test(candidatesSql), 'главная таблица должна быть tenders');
  assert.ok(/LEFT JOIN tender_rp_reviews rev/.test(candidatesSql),
    'INNER JOIN выкидывает карточки, которые ещё не открывали');
});

check('условие «чья-то» не тавтология', () => {
  // Тавтология: (a IS NOT NULL OR b IS NOT NULL OR (a IS NULL AND b IS NULL))
  assert.ok(!/IS NULL AND t\.calculator_user_id IS NULL\)\s*$/m.test(candidatesSql),
    'вернулась тавтология «оба NULL»');
  assert.ok(/rev\.id IS NULL/.test(candidatesSql),
    'карточки без ревью должны попадать по rev.id IS NULL');
});

check('фильтры очереди: ТО и звонки исключены', () => {
  assert.ok(/calculator_kind[\s\S]{0,30}<> 'to'/.test(candidatesSql), 'нет исключения ТО');
  assert.ok(/source[\s\S]{0,30}<> 'phone_call'/.test(candidatesSql), 'нет исключения звонков');
});

check('дедупликация работает и без строки ревью', () => {
  // С reviewId=null markSentReview должен падать на tender_id, иначе письмо каждый час.
  assert.ok(/if \(!reviewId\) \{ await markSentTender/.test(src),
    'для карточек без ревью нет дедупликации по tender_id');
});

const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
