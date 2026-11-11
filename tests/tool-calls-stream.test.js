'use strict';
/**
 * Проверка сборки tool_calls из SSE-стрима.
 *
 * Зачем тест: tool-calling в стриме приходит ДЕЛЬТАМИ (имя один раз,
 * аргументы кусками). Если сборка сломана, модель «просит склад», вызов
 * теряется, и МТР остаётся нулевым при живом складе.
 */

const path = require('path');
const ap = require(path.join(__dirname, '..', 'src', 'services', 'ai-provider'));

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log('PASS ' + name); }
  catch (e) { fail += 1; console.log('FAIL ' + name + ' — ' + e.message); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ` expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

/** Собирает фейковый Response с нужными чанками SSE. */
function streamOf(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    body: {
      getReader() {
        return {
          read: async () => (i >= chunks.length ? { done: true } : { done: false, value: enc.encode(chunks[i++]) }),
          releaseLock() {}
        };
      }
    }
  };
}

async function collect(chunks) {
  const evs = [];
  for await (const ev of ap.parseStream(streamOf(chunks), 'openai')) evs.push(ev);
  return evs;
}

(async () => {
  // ── 1. tool_calls кусками ────────────────────────────────────────────────
  const parts = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_warehouse","arguments":""}}]}}]}\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\":\\"шланг\\"}"}}]}}]}\n',
    'data: {"choices":[{"finish_reason":"tool_calls"}]}\n',
    'data: [DONE]\n'
  ];
  const evs = await collect(parts);
  check('tool_calls собираются из дельт', () => {
    const tc = evs.find((e) => e.type === 'tool_calls');
    if (!tc) throw new Error('нет события tool_calls; были: ' + evs.map((e) => e.type).join(','));
    eq(tc.toolCalls.length, 1);
    eq(tc.toolCalls[0].function.name, 'search_warehouse');
  });

  check('аргументы склеены в валидный JSON', () => {
    const tc = evs.find((e) => e.type === 'tool_calls');
    const args = JSON.parse(tc.toolCalls[0].function.arguments);
    eq(args.query, 'шланг');
  });

  check('done приходит после tool_calls', () => {
    const types = evs.map((e) => e.type);
    if (types.indexOf('tool_calls') > types.indexOf('done')) throw new Error('порядок: ' + types.join(','));
    eq(evs.find((e) => e.type === 'done').stopReason, 'tool_calls');
  });

  // ── 2. Обычный текст не ломается ─────────────────────────────────────────
  const plain = await collect([
    'data: {"choices":[{"delta":{"content":"Готово "}}]}\n',
    'data: {"choices":[{"delta":{"content":"— 5 позиций"}}]}\n',
    'data: {"choices":[{"finish_reason":"stop"}]}\n'
  ]);
  check('обычный текст собирается', () => {
    const text = plain.filter((e) => e.type === 'text').map((e) => e.content).join('');
    eq(text, 'Готово — 5 позиций');
  });

  check('без tool_calls события tool_calls нет', () => {
    if (plain.some((e) => e.type === 'tool_calls')) throw new Error('ложное событие');
  });

  // ── 3. Два вызова в одном ответе ─────────────────────────────────────────
  const two = await collect([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"search_warehouse","arguments":"{}"}}]}}]}\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"b","function":{"name":"web_search","arguments":"{\\"query\\":\\"цена\\"}"}}]}}]}\n',
    'data: {"choices":[{"finish_reason":"tool_calls"}]}\n'
  ]);
  check('два вызова различаются по index', () => {
    const tc = two.find((e) => e.type === 'tool_calls');
    eq(tc.toolCalls.length, 2);
    eq(tc.toolCalls[0].function.name, 'search_warehouse');
    eq(tc.toolCalls[1].function.name, 'web_search');
  });

  // ── 4. Битый JSON не валит поток ─────────────────────────────────────────
  const broken = await collect([
    'data: {не json}\n',
    'data: {"choices":[{"delta":{"content":"после мусора"}}]}\n',
    'data: {"choices":[{"finish_reason":"stop"}]}\n'
  ]);
  check('битый чанк пропускается, текст доходит', () => {
    const text = broken.filter((e) => e.type === 'text').map((e) => e.content).join('');
    eq(text, 'после мусора');
  });

  console.log('\nитог: ' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
