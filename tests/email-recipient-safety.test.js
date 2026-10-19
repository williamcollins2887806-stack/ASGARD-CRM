/**
 * Защита рассылок от тестовых ящиков (заказчик 19.10.2026).
 *
 * Дефект: CRM слала ежедневные/еженедельные отчёты по звонкам на
 * test_admin@test.asgard.local, test_director_gen@test.asgard.local и т.п.
 * Домен не существует → Yandex возвращал bounce → в ящике накопилось 653 письма.
 */
const { isSafeRecipient, isTestUserRecord } = require('../src/lib/user-filters');
let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

console.log('=== isSafeRecipient: тестовые адреса запрещены ===');
for (const bad of [
  'test_admin@test.asgard.local',
  'test_director_gen@test.asgard.local',
  'test_head_pm@test.asgard.local',
  'test@example.com',
  'test@stage12.local',
  'bcc-hidden@example.com',
  'test-target@example.com',
  'test_worker@asgard-service.com',
  'test@test.ru',
  'foo@bar.local',
  'no-at-sign',
  ''
]) {
  ok(!isSafeRecipient(bad), 'запрещён: ' + (bad || '(пусто)'));
}

console.log('\n=== isSafeRecipient: реальные адреса разрешены ===');
for (const good of [
  'bv@asgard-service.com',
  'n.androsov@asgard-service.com',
  'hv@asgard-service.com',
  'andr0sov.nikita@yandex.ru',
  'n_krughlov@mail.ru',
  'a.b@sub.domain.ru'
]) {
  ok(isSafeRecipient(good), 'разрешён: ' + good);
}

console.log('\n=== isTestUserRecord: тестовые пользователи ===');
ok(isTestUserRecord({ login: 'test_admin', email: 'test_admin@test.asgard.local' }), 'test_admin — тестовый');
ok(isTestUserRecord({ login: 'x', email: 'foo@test.local' }), 'адрес @test.* — тестовый');
ok(isTestUserRecord({ login: 'x', name: 'Test User' }), 'имя Test — тестовый');
ok(!isTestUserRecord({ login: 'bv', email: 'bv@asgard-service.com', name: 'Баринов Виктор' }), 'bv — реальный');
ok(!isTestUserRecord({ login: 'go', email: 'go@asgard-service.com', name: 'Гажилиев Олег' }), 'go — реальный');

console.log('\nИТОГ защиты рассылок: PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
