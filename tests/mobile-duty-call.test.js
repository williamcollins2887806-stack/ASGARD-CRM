'use strict';
/**
 * Звонок на мобильный: тихий баннер в CRM + перевод.
 *
 * Что проверяем:
 *  1) buildRingNotifyPayload помечает GSM-цель как via='mobile' — по этому
 *     признаку фронт показывает баннер без рингтона, а не рингующий попап;
 *  2) for webrtc-цели via остаётся null (обычный сценарий не сломан);
 *  3) дежурная цель пробрасывает is_duty;
 *  4) pbx_uid есть в payload всегда — без него перевод невозможен.
 *
 * Инвариант «никто на линии → пустой план» НЕ меняем: дежурный должен стоять
 * на линии с receive_mode='mobile', это настройка данных, а не кода.
 */
const assert = require('assert');
const { buildRingNotifyPayload } = require('../src/pbx/call-lifecycle');

const tests = [];
function test(name, fn) { tests.push({ name: 'mobile-banner: ' + name, run: fn }); }

const BASE = { pbxUid: '1794485040.143', caller: '74959551815', lookup: { name: 'ООО Тест' }, channel: 'PJSIP/mango-0001', callHistoryId: 3239 };

test('GSM-цель → via=mobile (в CRM тихий баннер)', () => {
  const p = buildRingNotifyPayload({
    ...BASE,
    target: { userId: 3474, targetType: 'mobile', targetAddr: '79160614809', isDuty: true },
  });
  assert.strictEqual(p.event, 'call:incoming');
  assert.strictEqual(p.user_id, 3474);
  assert.strictEqual(p.data.via, 'mobile');
  assert.strictEqual(p.data.is_duty, true);
  assert.strictEqual(p.data.target_type, 'mobile');
});

test('WebRTC-цель → via=null (обычный рингующий сценарий не сломан)', () => {
  const p = buildRingNotifyPayload({
    ...BASE,
    target: { userId: 3461, targetType: 'webrtc', targetAddr: 'u3461' },
  });
  assert.strictEqual(p.data.via, null);
  assert.strictEqual(p.data.is_duty, false);
  assert.strictEqual(p.data.target_type, 'webrtc');
});

test('pbx_uid присутствует для обеих целей — перевод возможен', () => {
  for (const targetType of ['mobile', 'webrtc']) {
    const p = buildRingNotifyPayload({ ...BASE, target: { userId: 1, targetType } });
    assert.strictEqual(p.data.pbx_uid, BASE.pbxUid, 'pbx_uid нужен для transfer без WebRTC');
    assert.strictEqual(p.data.call_id, 'pbx_' + BASE.pbxUid);
  }
});

test('дежурный флаг не протекает на обычную GSM-цель', () => {
  const p = buildRingNotifyPayload({
    ...BASE,
    target: { userId: 7000, targetType: 'mobile', targetAddr: '79001112233', isDuty: false },
  });
  assert.strictEqual(p.data.via, 'mobile');
  assert.strictEqual(p.data.is_duty, false);
});

test('history_id пробрасывается — карточка откроется по ссылке', () => {
  const p = buildRingNotifyPayload({
    ...BASE,
    target: { userId: 3474, targetType: 'mobile', targetAddr: '79160614809', isDuty: true },
  });
  assert.strictEqual(p.data.history_id, 3239);
});

let fail = 0;
for (const t of tests) {
  try {
    t.run();
    console.log('PASS ' + t.name);
  } catch (e) {
    fail += 1;
    console.log('FAIL ' + t.name + ' -> ' + e.message);
  }
}
console.log(`\nИтог: ${tests.length - fail} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
