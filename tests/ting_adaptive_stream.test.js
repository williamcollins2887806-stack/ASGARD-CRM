'use strict';

/**
 * D-416: качество медиа веб-Тинга приведено к эталону LiveKit.
 *
 * Три решения, которые отличали нас от Телемоста:
 *   1) adaptiveStream был выключен на десктопе — слои не подстраивались под
 *      канал и размер плитки вообще;
 *   2) degradationPreference: 'maintain-resolution' — при просадке резались
 *      кадры, картинка «залипала»;
 *   3) startPublicationQuality форсировал VideoQuality.HIGH, конфликтуя с
 *      адаптацией: SDK выбирал слой, а следующий вызов возвращал HIGH.
 *
 * Запуск: node tests/ting_adaptive_stream.test.js
 * (корневой jest сломан чужим BOM в tools/offers-pack/package.json)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'public/assets/js/ting_page.js'), 'utf8');
const profile = fs.readFileSync(path.join(root, 'public/assets/js/ting_media_profile.js'), 'utf8');

/* Смотрим код: в комментариях старые значения упоминаются законно. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const pageCode = strip(page);
const profileCode = strip(profile);

const checks = [];

function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (e) {
    checks.push({ name, ok: false, error: e.message });
  }
}

check('adaptiveStream включён с pixelDensity screen', () => {
  assert.ok(
    /adaptiveStream:\s*\{\s*pixelDensity:\s*'screen'/.test(pageCode),
    'adaptiveStream должен быть включён с pixelDensity screen',
  );
});

check('adaptiveStream не выключен ни в одной ветке', () => {
  assert.ok(
    !/adaptiveStream\s*=\s*false/.test(pageCode),
    'adaptiveStream = false снова лишит SDK выбора слоя',
  );
});

check('degradationPreference = balanced', () => {
  assert.ok(
    /degradationPreference:\s*'balanced'/.test(profileCode),
    'balanced сохраняет плавность вместо сохранения разрешения',
  );
});

check('нет maintain-resolution', () => {
  assert.ok(
    !/maintain-resolution/.test(profileCode),
    'maintain-resolution режет кадры и даёт залипания',
  );
});

check('стартовое качество не форсирует HIGH', () => {
  assert.ok(
    !/applyVideoQuality\(\s*pub,\s*'high'\s*\)/.test(pageCode),
    'форсирование HIGH конфликтует с adaptiveStream',
  );
  assert.ok(
    /videoQualityLadder\.set\(\s*key,\s*'auto'\s*\)/.test(pageCode),
    'стартовое значение должно быть auto — решение за SDK',
  );
});

check('ступени качества знают состояние auto', () => {
  assert.ok(/auto:\s*'medium'/.test(pageCode), 'нет перехода из auto вниз');
  assert.ok(/auto:\s*'high'/.test(pageCode), 'нет перехода из auto вверх');
});

let failed = 0;
checks.forEach((c) => {
  if (c.ok) {
    console.log('PASS ' + c.name);
  } else {
    failed += 1;
    console.log('FAIL ' + c.name + ' — ' + c.error);
  }
});
console.log(`\nD-416: ${checks.length - failed}/${checks.length} проверок`);
process.exit(failed === 0 ? 0 : 1);
