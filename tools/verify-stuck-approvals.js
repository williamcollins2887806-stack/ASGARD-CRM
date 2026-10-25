/**
 * Гейт D-344: согласование директора снимается при закрытии тендера.
 *
 * Дефект (найден на проде 24.10.2026). Тендер 1939 (АО «ТЮМЕННЕФТЕГАЗ»,
 * 176.5 млн ₽) имел `registry_status = 'отмена'`, но
 * `director_review_status = 'pending'` — висел в очереди директора с 27.07.2026
 * (почти 3 месяца). Заказчик: «если тендер отменён, согласование не нужно,
 * оно просто исчезает».
 *
 * Почему одной правки в коде мало: в `tenders-registry.js` статус меняется
 * ПРЯМЫМИ `UPDATE tenders`, минуя хелпер `applyRegistryStatus`. Поэтому защита
 * сделана на уровне БД — ТРИГГЕРОМ (миграция V436). Этот гейт проверяет:
 *   1. миграция V436 существует и объявляет триггер;
 *   2. триггер реагирует на все три терминальных статуса;
 *   3. запрос очереди директора фильтрует терминальные статусы (вторая линия);
 *   4. счётчик очереди — тоже;
 *   5. на клоне нет зависших согласований.
 *
 * Пункт 5 требует доступной БД клона; если её нет — гейт честно сообщает
 * «не проверено», а не выдумывает PASS.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let fail = 0;
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const ok = (m) => console.log('  OK   ' + m);

const TERMINAL = ['отмена', 'проиграли', 'выиграли'];

// ── 1. Миграция и триггер ─────────────────────────────────────────────────
console.log('=== 1. Миграция V436 и триггер ===');
const MIG = 'migrations/V436__close_director_review_on_terminal.sql';
if (!fs.existsSync(MIG)) {
  bad('нет миграции ' + MIG);
} else {
  const sql = fs.readFileSync(MIG, 'utf8');
  ok('миграция есть');

  if (/CREATE TRIGGER trg_close_director_review/.test(sql)) ok('создаётся триггер trg_close_director_review');
  else bad('триггер не создаётся');

  if (/AFTER UPDATE OF registry_status ON tenders/.test(sql)) {
    ok('триггер слушает именно изменение registry_status');
  } else bad('триггер не привязан к registry_status');

  // WHEN-условие: иначе триггер будет стрелять на каждое обновление тендера.
  if (/WHEN \(OLD\.registry_status IS DISTINCT FROM NEW\.registry_status\)/.test(sql)) {
    ok('есть условие «статус реально изменился»');
  } else bad('нет WHEN-условия — лишние срабатывания');

  for (const st of TERMINAL) {
    if (sql.includes(`'${st}'`)) ok(`«${st}» обрабатывается`);
    else bad(`«${st}» не обрабатывается в миграции`);
  }

  // Трогает только pending — история сохраняется.
  if (/AND director_review_status = 'pending'/.test(sql)) {
    ok('снимает ТОЛЬКО pending (история не переписывается)');
  } else bad('нет условия pending — может перезаписать решённые согласования');

  // Разовая уборка накопившихся.
  if (/UPDATE tender_rp_reviews r[\s\S]{0,200}director_review_status = 'pending'/.test(sql)) {
    ok('есть разовая уборка уже накопившихся зависших');
  } else console.log('  (разовой уборки нет — не критично, но полезно)');
}

// ── 2. Запрос очереди: вторая линия защиты ────────────────────────────────
console.log('\n=== 2. Фильтр в очереди директора (вторая линия) ===');
const pm = fs.readFileSync('src/routes/pm-duty.js', 'utf8');
const queueAt = pm.indexOf("fastify.get('/director-review-queue'");
const countAt = pm.indexOf("'/director-review-queue/count'");

const qBlock = queueAt >= 0 ? pm.slice(queueAt, queueAt + 2000) : '';
const cBlock = countAt >= 0 ? pm.slice(countAt, countAt + 1500) : '';

if (/NOT IN \('проиграли', 'отмена', 'выиграли'\)/.test(qBlock)) {
  ok('очередь исключает терминальные статусы');
} else bad('очередь НЕ исключает закрытые тендеры');
if (/NOT IN \('проиграли', 'отмена', 'выиграли'\)/.test(cBlock)) {
  ok('счётчик исключает терминальные статусы');
} else bad('счётчик НЕ исключает закрытые тендеры (бейдж соврёт)');

// ── 3. Хелпер тоже закрывает согласование ─────────────────────────────────
console.log('\n=== 3. Хелпер applyRegistryStatus ===');
const helper = fs.readFileSync('src/services/tender-registry-helpers.js', 'utf8');
if (/closeAs|closing|CLOSING_STATUSES|director_review_status = \$1/.test(helper)) {
  ok('хелпер закрывает согласование при смене статуса');
} else {
  bad('хелпер не закрывает согласование (защита только в БД — проверить)');
}

// ── 4. Реальные данные клона ──────────────────────────────────────────────
console.log('\n=== 4. Проверка на клоне БД ===');
const PSQL = 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe';
/**
 * ВАЖНО: SQL передаём ФАЙЛОМ, а не аргументом `-c`.
 * На Windows аргументы командной строки кодируются в cp1251, и psql падает на
 * кириллице («invalid byte sequence for encoding UTF8»). Через файл UTF-8
 * доходит корректно — на этом уже спотыкались при аудите прода.
 */
const runSqlFile = (sql, name) => {
  const tmp = path.join(process.cwd(), 'tests', 'reports', `_gate-${name}.sql`);
  fs.writeFileSync(tmp, sql, 'utf8');
  try {
    return execFileSync(PSQL, ['-U', 'asgard', '-h', '127.0.0.1', '-d', 'asgard_crm_test', '-tAf', tmp],
      { encoding: 'utf8', env: { ...process.env, PGPASSWORD: '123456789' } }).trim();
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* не критично */ }
  }
};

let dbOk = false;
try {
  const out = runSqlFile(`
    SELECT COUNT(*)::text FROM tender_rp_reviews r JOIN tenders t ON t.id = r.tender_id
     WHERE r.director_review_status = 'pending'
       AND t.registry_status IN ('отмена','проиграли','выиграли');
  `, 'stuck');
  dbOk = true;
  const stuck = Number(out);
  if (stuck === 0) ok('зависших согласований на клоне нет');
  else bad(`на клоне зависших: ${stuck}`);
} catch (e) {
  console.log('  (БД клона недоступна — НЕ ПРОВЕРЕНО: ' + String(e.message).slice(0, 70) + ')');
  // «Не проверено» — это НЕ «успех»: иначе гейт зелёный на непроверенных данных.
  bad('проверка на БД клона не выполнена — результат неполный');
}

// Триггер установлен в БД клона?
if (dbOk) {
  try {
    const out = runSqlFile(`
      SELECT COUNT(*)::text FROM pg_trigger WHERE tgname = 'trg_close_director_review';
    `, 'trg');
    if (Number(out) === 1) ok('триггер установлен в БД клона');
    else bad('триггер НЕ установлен в БД клона — миграцию надо применить');
  } catch (e) { console.log('  (проверка триггера не удалась)'); }
}

console.log('\n' + (fail === 0
  ? 'ИТОГ: OK — при закрытии тендера согласование снимается (триггер + фильтр), зависших нет'
  : `ИТОГ: FAIL — ${fail} нарушений`));
process.exit(fail === 0 ? 0 : 1);
