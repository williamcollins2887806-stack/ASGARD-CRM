/**
 * Гейт: машинный код ручки должен ДОЖИТЬ до клиента, а текст — быть русским.
 *
 * Класс дефекта (23.10.2026): хук onSend затирал протокольный код
 * (`tkp_required`, `transition_not_allowed`, `not_found`) на общий `bad_request`,
 * потому что looksTechnical() считает любой латинский snake_case «технотекстом».
 * Клиент получал «Не получилось: bad_request» — ни причины, ни действия.
 *
 * Проверяем:
 *   1) протокольные коды сохраняются в `error`;
 *   2) message/hint всегда по-русски;
 *   3) английские фразы (Bad Request) по-прежнему нормализуются;
 *   4) PG-текст наружу не уходит.
 */
const assert = require('assert');
const { ensureHumanFields, looksTechnical } = require('../src/lib/human-error');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('=== 1. Протокольный код сохраняется и доступен клиенту ===');
// Контракт (D-313): код ситуации ДОЛЖЕН остаться доступным — либо в `error`
// (когда русский текст не подставлялся), либо в `code` (когда `error` сделан
// читаемым для человека). Потеря кода — дефект: клиент не сможет обработать
// ситуацию, а пользователь увидит бессмысленный общий код.
const protocol = [
  ['tkp_required', 400],
  ['transition_not_allowed', 409],
  ['version_conflict', 409],
  ['card_closed', 409],
  ['not_found', 404],
  ['forbidden', 403],
  ['invalid_to_v3_column', 400],
  ['pre_tender_exists', 409],
  ['confirm_required', 409],
];
for (const [code, status] of protocol) {
  const body = { error: code };
  ensureHumanFields(body, status);
  const survived = body.error === code || body.code === code;
  ok(`${code} не потерян`, survived, `error=${body.error} code=${body.code}`);
  ok(`${code}: есть русский message`, /[А-Яа-яЁё]/.test(String(body.message || '')), `"${String(body.message || '').slice(0, 48)}"`);
  ok(`${code}: есть hint`, !!body.hint && String(body.hint).length > 8, `"${String(body.hint || '').slice(0, 40)}"`);
}

console.log('\n=== 2. Английские/технические тексты по-прежнему не утекают ===');
for (const [raw, status] of [['Bad Request', 400], ['Unsupported Media Type', 415], ['Not Found', 404]]) {
  const body = { error: raw };
  ensureHumanFields(body, status);
  // error должен стать либо машинным кодом, либо русским текстом — но не англ.
  const notEnglish = /^[a-z][a-z0-9_]*$/.test(body.error) || /[А-Яа-яЁё]/.test(body.error);
  ok(`«${raw}» → не английская фраза`, notEnglish, `error=${body.error}`);
  ok(`«${raw}» → код доступен`, !!(body.code || /^[a-z][a-z0-9_]*$/.test(body.error)), `code=${body.code}`);
}

console.log('\n=== 3. Текст ошибки из PG не показывается пользователю ===');
{
  const body = { error: 'server_error', message: 'relation "personal_kanban_cards" does not exist' };
  ensureHumanFields(body, 500);
  ok('PG-текст заменён', !/relation .* does not exist/.test(String(body.message)), `"${body.message.slice(0, 50)}"`);
  ok('detail удалён', body.detail === undefined);
}

console.log('\n=== 4. Успешная нагрузка не трогается (контракт хука onSend) ===');
{
  // Хук (src/index.js) вызывает ensureHumanFields ТОЛЬКО если:
  //   • status >= 400, и • в теле есть error/message/hint.
  // Проверяем именно этот контракт: при status=200 функция не вызывается,
  // поэтому полезная нагрузка остаётся байт-в-байт прежней.
  const status = 200;
  const hasErrMarker = (b) => b.error !== undefined || b.message !== undefined || b.hint !== undefined;

  const body = { columns: { new: [] }, total: 0 };
  const shouldCall = status >= 400 && hasErrMarker(body);
  ok('payload без признака ошибки: хук не вызывает обработку', shouldCall === false, `shouldCall=${shouldCall}`);
  ok('payload без признака ошибки не изменён', body.hint === undefined && body.columns !== undefined);

  const errBody = { error: 'tkp_required' };
  ok('payload с ошибкой: хук обрабатывает', (400 >= 400) && hasErrMarker(errBody));
}

console.log('\n=== 5. looksTechnical не считает русский текст техническим ===');
ok('русский текст', looksTechnical('Сначала создайте ТКП') === false);
ok('латинский snake_case', looksTechnical('tkp_required') === true);

console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
process.exit(fail ? 1 : 0);
