'use strict';

/**
 * D-404: без registerGlobals() нативный клиент не видит WebRTC и падает
 * с «WebRTC isn't detected, have you called registerGlobals?».
 *
 * Это была реальная блокировка входа на телеке: ошибка воспроизводилась
 * при каждом подключении, независимо от APK и от вёрстки.
 *
 * Проверяем:
 *   1) registerGlobals импортируется из @livekit/react-native;
 *   2) вызывается ДО регистрации компонента (иначе connect() успеет раньше);
 *   3) в собранном commonjs-билде SDK такой экспорт действительно есть.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const entryPath = path.join(__dirname, '..', 'index.js');

describe('TV client: registerGlobals (D-404)', () => {
  it('импортирует registerGlobals из @livekit/react-native', () => {
    const entry = fs.readFileSync(entryPath, 'utf8');
    assert.ok(
      /import\s*\{\s*registerGlobals\s*\}\s*from\s*'@livekit\/react-native'/.test(entry),
      'index.js должен импортировать registerGlobals'
    );
  });

  it('вызывает registerGlobals() ДО registerComponent', () => {
    const entry = fs.readFileSync(entryPath, 'utf8');
    const callIdx = entry.indexOf('registerGlobals()');
    const regIdx = entry.indexOf('AppRegistry.registerComponent');
    assert.ok(callIdx > -1, 'registerGlobals() не вызывается');
    assert.ok(regIdx > -1, 'registerComponent не найден');
    assert.ok(callIdx < regIdx, 'registerGlobals() должен идти раньше registerComponent');
  });

  it('SDK экспортирует registerGlobals', () => {
    /* Импортировать модуль в jest нельзя: он тянет ESM/TS исходники и падает
       на трансформации. Проверяем собранный commonjs текстом. */
    const sdkBuild = fs.readFileSync(
      path.join(__dirname, '..', 'node_modules', '@livekit', 'react-native', 'lib', 'commonjs', 'index.js'),
      'utf8'
    );
    assert.ok(/exports\.registerGlobals\s*=/.test(sdkBuild), 'экспорт отсутствует');
    assert.ok(/function registerGlobals/.test(sdkBuild), 'реализация отсутствует');
  });
});
