'use strict';
const det = require('../src/services/approval-detector');
const th = require('../src/services/approval-thread');

const cases = [
  // separator > (quote marker)
  ['Добро\n> Не платите', 'quote-caret-negative'],
  ['Добро\n\n> Не платите', 'blank+caret-negative'],
  ['Добро\n> заморозьте оплату', 'caret-freeze'],
  ['Добро\n> подожди', 'caret-wait'],
  // underscore separator
  ['Добро\n___\nНе платите', 'underscore-neg'],
  ['Добро\n___\nподожди', 'underscore-wait'],
  // dash separator with negative NOT matching PAY re
  ['Добро\n--\nне сейчас', 'dash-notnow'],
  ['Добро\n--\nподожди', 'dash-wait'],
  ['Добро\n--\nотмена', 'dash-cancel'],
  ['Добро\n--\nпозже', 'dash-later'],
  ['Добро\n--\nдавай потом', 'dash-later2'],
  ['Добро\n--\nстоп', 'dash-stop'],
  // От/Кому markers
  ['Добро\nОт: X\nКому: Y\nНе платите', 'ot-komu-neg'],
  // html tags
  ['<b>Добро</b>', 'html-bold'],
  ['Добро<br>Не платите', 'html-br-neg'],
  ['Добро<!-- не платите -->', 'html-comment-neg'],
  // homoglyph
  ['добро (c latin o)', 'placeholder'],
  // zero width
  ['Добро\u200bНе платите', 'zwsp-neg'],
  ['Доб\u200bро', 'zwsp-inside'],
  ['Добра\u200b, не платите', 'zwsp2'],
  // reversed: negative words that are approve tokens?
  ['можно не оплачивать', 'mozhno-ne'],
  ['оплату не производить', 'oplatu-ne'],
  ['разрешение не даю', 'razr-ne-dayu'],
  ['даю добро на отказ', 'dayu-dobro-otkaz'],
  ['подтверждаю отказ', 'podtv-otkaz'],
  ['согласен на отмену', 'soglasen-otmenu'],
  ['утверждаю отказ от оплаты', 'utv-otkaz'],
  ['оплачивайте, но не сейчас', 'oplat-no-now'],
  ['переведите, но позже', 'perevod-later'],
  ['добро, но не сейчас', 'dobro-no-now'],
  ['добро, но потом', 'dobro-potom'],
  ['добро но не платите', 'dobro-no-plat'],
  ['можно отложить', 'mozhno-otlozhit'],
  ['можно подождать', 'mozhno-podozhdat'],
  ['да, отложить', 'da-otlozhit'],
];

let leaked = [];
for (const [body, label] of cases) {
  if (label === 'placeholder') continue;
  const r = det.detectApproval(body);
  if (r.approve) leaked.push([label, JSON.stringify(body), r.reason || r.word]);
}

// homoglyph explicit (Cyrillic д о б р о vs latin)
const homo = 'добр\u006fr'.normalize('NFKC'); // still mixed
const homo2 = '\u0434\u043e\u0431\u0440\u043e'; // pure cyrillic добро
const homo3 = 'dobro'; // latin
console.log('--- homoglyph probes ---');
for (const [b, l] of [['добро', 'cyr'], [homo, 'mixedCorL'], ['dobro', 'lat'], ['Добро'.replace('о', 'o'), 'mixedLatO-Word']]) {
  console.log(l, JSON.stringify(b), det.detectApproval(b));
}

console.log('\n--- LEAKED (approve=true) ---');
for (const [l, b, r] of leaked) console.log('  LEAK', l, b, '->', r);
console.log('\nleaked count:', leaked.length);
