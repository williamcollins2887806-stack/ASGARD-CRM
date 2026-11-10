'use strict';
/**
 * Удаление ТКП: автор или администратор, с полной уборкой привязок.
 *
 * ── Почему это отдельный тест (10.11.2026) ─────────────────────────────────
 * Прежний DELETE /api/tkp/:id был доступен ТОЛЬКО ADMIN и удалял только
 * `status='draft'`. При этом он не снимал привязки: документ оставался в
 * карточке тендера, `created_tkp_id` заявки указывал на несуществующее ТКП,
 * а Quick-сессия навсегда считалась финализированной. Тест фиксирует:
 *   • права: автор и ADMIN могут, остальные — нет;
 *   • каскад: блоки, документ тендера, ссылка заявки, сессия, файл;
 *   • запрет: ТКП со счётом не удаляется (иначе счёт без основания).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TKP = fs.readFileSync(path.join(ROOT, 'src/routes/tkp.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'public/assets/js/tkp-page.js'), 'utf8');
const KANBAN = fs.readFileSync(path.join(ROOT, 'public/assets/js/personal_kanban.js'), 'utf8');

const results = [];
function check(name, fn) {
  try { fn(); results.push({ ok: true }); console.log('PASS ' + name); }
  catch (e) { results.push({ ok: false }); console.log('FAIL ' + name + ' — ' + e.message); }
}

const deleteBlock = (() => {
  const i = TKP.indexOf("fastify.delete('/:id'");
  const j = TKP.indexOf('// PUT /:id/status', i);
  return i >= 0 ? TKP.slice(i, j > i ? j : i + 6000) : '';
})();

check('роут удаления найден', () => {
  assert.ok(deleteBlock.length > 500, 'DELETE /:id не распознан');
});

check('права: автор ИЛИ администратор, не только ADMIN', () => {
  assert.ok(/const isAdmin = String\(request\.user\.role \|\| ''\) === 'ADMIN'/.test(deleteBlock),
    'нет проверки роли ADMIN');
  assert.ok(/const isAuthor = Number\(tkp\.author_id\) === Number\(request\.user\.id\)/.test(deleteBlock),
    'нет проверки авторства');
  assert.ok(/if \(!isAdmin && !isAuthor\)/.test(deleteBlock),
    'права не сведены в единое условие отказа');
});

check('удаление не ограничено статусом draft', () => {
  assert.ok(!/DELETE FROM tkp WHERE id = \$1 AND status = 'draft'/.test(deleteBlock),
    'осталось ограничение status=draft');
});

check('каскад: блоки конструктора', () => {
  assert.ok(/DELETE FROM tkp_blocks WHERE tkp_id = \$1/.test(deleteBlock), 'блоки не удаляются');
});

check('каскад: документ ТКП из карточки тендера', () => {
  assert.ok(/DELETE FROM documents[\s\S]{0,200}type = 'tkp'/.test(deleteBlock),
    'документ тендера не снимается');
});

check('каскад: ссылка из просчёта на файл', () => {
  assert.ok(/UPDATE tender_rp_reviews SET tkp_file_id = NULL/.test(deleteBlock),
    'tkp_file_id не очищается');
});

check('каскад: обратная ссылка из заявки', () => {
  assert.ok(/UPDATE pre_tender_requests SET created_tkp_id = NULL WHERE created_tkp_id = \$1/.test(deleteBlock),
    'created_tkp_id не снимается');
});

check('каскад: Quick-сессия возвращается в работу', () => {
  assert.ok(/UPDATE tkp_quick_sessions[\s\S]{0,220}tkp_id = NULL/.test(deleteBlock),
    'сессия остаётся привязанной к удалённому ТКП');
  assert.ok(/finalized_at = NULL/.test(deleteBlock), 'сессия остаётся финализированной');
});

check('каскад: файл на диске удаляется после коммита', () => {
  assert.ok(/fsLib\.unlinkSync/.test(deleteBlock), 'файл PDF остаётся на диске');
});

check('запрет: ТКП со счётом не удаляется', () => {
  assert.ok(/FROM invoices WHERE tkp_id = \$1/.test(deleteBlock), 'нет проверки счетов');
  assert.ok(/tkp_has_invoices/.test(deleteBlock), 'нет кода ошибки для связанных счетов');
});

check('удаление в транзакции', () => {
  assert.ok(/BEGIN/.test(deleteBlock) && /COMMIT/.test(deleteBlock) && /ROLLBACK/.test(deleteBlock),
    'нет транзакции — половина привязок может остаться');
});

check('реестр: кнопка удаления и подтверждение', () => {
  assert.ok(/data-action="delete"/.test(PAGE), 'нет кнопки удаления в реестре');
  assert.ok(/function confirmDeleteTkp/.test(PAGE), 'нет обработчика удаления');
  assert.ok(/method: 'DELETE'/.test(PAGE), 'фронт не вызывает DELETE');
});

check('реестр: кнопка только автору или админу', () => {
  assert.ok(/function canDeleteTkp/.test(PAGE), 'нет проверки прав на фронте');
  assert.ok(/canDeleteTkp\(i\) \?/.test(PAGE), 'кнопка показывается всем');
  // КРИТИЧНО: в auth.js экспорт называется getAuth(), а не getUser().
  // С getUser() проверка молча возвращала пустого пользователя, и кнопка
  // не показывалась НИКОМУ, хотя весь остальной код был на месте.
  assert.ok(/AsgardAuth\.getAuth/.test(PAGE), 'used getUser — такого метода нет в auth.js');
  assert.ok(!/AsgardAuth\.getUser/.test(PAGE), 'остался несуществующий getUser()');
});

check('карточка: удаление только автору или админу (getAuth)', () => {
  assert.ok(/_canDeleteTkpRow\(t\) \?/.test(KANBAN), 'кнопка в карточке показывается всем');
  assert.ok(/AsgardAuth\.getAuth/.test(KANBAN), 'в карточке используется getUser вместо getAuth');
  assert.ok(!/AsgardAuth\.getUser/.test(KANBAN), 'в карточке остался несуществующий getUser()');
});

check('карточка канбана: кнопка удаления и обработчик', () => {
  assert.ok(/data-tkp-del=/.test(KANBAN), 'нет кнопки удаления в карточке');
  assert.ok(/function _deleteTkpFromCard/.test(KANBAN), 'нет обработчика удаления в карточке');
  assert.ok(/_loadAndRenderTkpList\(card\)/.test(KANBAN), 'список не перерисовывается после удаления');
});

check('карточка: удаление только автору или админу', () => {
  assert.ok(/_canDeleteTkpRow\(t\) \?/.test(KANBAN), 'кнопка в карточке показывается всем');
});
const failed = results.filter((r) => !r.ok);
console.log('\nитог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
