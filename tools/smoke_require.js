'use strict';

/**
 * Дымовая проверка require: роуты и PBX-модули загружаются без ошибок.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ИНСТРУМЕНТ (инцидент 08–09.10.2026):
 *   node -e "require('./src/pbx/index.js'); require('./src/routes/telephony')"
 * НЕ ЗАВЕРШАЕТСЯ. Загрузка этих модулей создаёт pg-пул (и слушатели AMI/SSE),
 * которые держат event loop живым, поэтому `node -e` висит вечно — задача в
 * очереди провисела ~24 часа. Здесь мы явно закрываем ресурсы и вызываем
 * process.exit, поэтому проверка всегда завершается.
 *
 * Usage:
 *   node tools/smoke_require.js                 # модули + выход 0
 *   node tools/smoke_require.js --quiet         # только итог
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QUIET = process.argv.includes('--quiet');

const MODULES = [
  'src/routes/telephony-pbx',
  'src/routes/telephony',
  'src/pbx/index.js',
  'src/pbx/recording',
  'src/pbx/prompts',
  'src/pbx/ami-client',
  'src/pbx/dial-engine',
  'src/pbx/call-lifecycle',
  'src/pbx/line-claim',
  'src/pbx/operator-lifecycle',
  'src/lib/telephony-access',
];

let failed = 0;
for (const rel of MODULES) {
  try {
    require(path.join(ROOT, rel));
    if (!QUIET) console.log(`  OK   ${rel}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL ${rel}: ${e.message}`);
  }
}

// Гасим ресурсы, которые держат event loop (pg-пул в src/pbx/index.js),
// затем выходим принудительно — иначе процесс повиснет (см. шапку файла).
try {
  const pbx = require(path.join(ROOT, 'src/pbx/index.js'));
  if (pbx && typeof pbx.stop === 'function') {
    pbx.stop().catch(() => {}).finally(() => process.exit(failed ? 1 : 0));
    // stop() может не успеть — подстраховываемся жёстким выходом.
    setTimeout(() => process.exit(failed ? 1 : 0), 1500).unref();
  } else {
    process.exit(failed ? 1 : 0);
  }
} catch (_) {
  process.exit(failed ? 1 : 0);
}

console.log(`\n${MODULES.length - failed}/${MODULES.length} модулей загружено`);
