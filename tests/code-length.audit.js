/**
 * АУДИТ: длина кодов бэкенд ↔ фронтенд по всей CRM.
 * Проверяем три потока (как просил заказчик): подтверждение выплат,
 * вход в Huginn, вход в СРМ рабочих. Плюс PIN.
 */
const fs = require('fs');

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } }
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log(`  ✅ ${name} — ${detail}`); } else { fail++; console.log(`  ❌ ${name} — ${detail}`); } };

console.log('═══ 1. ПОДТВЕРЖДЕНИЕ ВЫПЛАТЫ ═══');
{
  const be = read('src/lib/payout-notify.js');
  const m = be.match(/CODE_LENGTH\s*=\s*(\d+)/);
  const beLen = m ? Number(m[1]) : null;
  // Бэк: диапазон генерации должен совпадать с CODE_LENGTH
  const body = read('src/mobile-placeholder');
  const gen = be.match(/Math\.pow\(10, CODE_LENGTH - 1\)[\s\S]{0,120}?Math\.pow\(10, CODE_LENGTH\)/);
  console.log(`  бэк CODE_LENGTH = ${beLen}, генерация 10^(N-1)…10^N: ${gen ? 'совпадает ✅' : 'ПРОВЕРИТЬ'}`);

  const fe = read('public/mobile-app/src/components/PayoutStatementBanner.jsx');
  const feLen = fe.match(/clean\.length\s*!==\s*(\d+)/);
  const feMax = fe.match(/slice\(0,\s*(\d+)\)/);
  const fePh = fe.match(/placeholder="(•+)"/);
  const feLabel = fe.match(/Код из SMS или MAX \((\d+) цифр\)/);
  console.log(`  фронт: валидация ${feLen ? feLen[1] : '?'}, обрезка ${feMax ? feMax[1] : '?'}, плейсхолдер ${fePh ? fePh[1].length : '?'} точек, подпись ${feLabel ? feLabel[1] : '?'}`);
  check('бэк и фронт совпадают',
    beLen != null && feLen && feMax && fePh && feLabel
    && Number(feLen[1]) === beLen && Number(feMax[1]) === beLen && fePh[1].length === beLen && Number(feLabel[1]) === beLen,
    `бэк ${beLen}, фронт валидация ${feLen && feLen[1]}, обрезка ${feMax && feMax[1]}, точек ${fePh && fePh[1].length}, подпись «${feLabel && feLabel[1]} цифр»`);
}

console.log('\n═══ 2. ВХОД В HUGINN ═══');
{
  const be = read('src/routes/huginn_ext.js');
  const gen = be.match(/crypto\.randomInt\((\d+),\s*(\d+)\)/);
  const beLen = gen ? String(gen[1]).length : null;
  const maxGen = be.match(/maxLength\s*=\s*(\d+)/);
  // Проверяем сообщение об ошибке: «6-значный код»
  const msg = be.match(/(\d+)-значный код/);
  console.log(`  бэк: randomInt(${gen && gen[1]}, ${gen && gen[2]}) → ${beLen} цифр; в тексте ошибки: ${msg ? msg[1] + ' цифр' : '—'}`);

  const fe = read('public/h/app.js');
  const feLen = fe.match(/SMS_CODE_LEN\s*=\s*(\d+)/);
  const cmt = fe.match(/Бэкенд шлёт (\d+)-значный код/);
  console.log(`  фронт: SMS_CODE_LEN = ${feLen && feLen[1]}, комментарий «${cmt && cmt[1]}-значный»`);
  check('бэк и фронт совпадают (6)',
    beLen != null && feLen && msg && Number(feLen[1]) === beLen && Number(msg[1]) === beLen,
    `бэк ${beLen}, фронт ${feLen && feLen[1]}, в тексте ${msg && msg[1]}`);
}

console.log('\n═══ 3. ВХОД В СРМ РАБОЧИХ (SMS/Max) ═══');
{
  const be = read('src/routes/field-auth.js');
  const beLen = be.match(/SMS_CODE_LENGTH\s*=\s*(\d+)/);
  const range = be.match(/crypto\.randomInt\((\d+),\s*(\d+)\)/);
  const rangeLen = range ? String(range[1]).length : null;
  console.log(`  бэк: SMS_CODE_LENGTH = ${beLen && beLen[1]}, генерация randomInt(${range && range[1]}, ${range && range[2]}) → ${rangeLen} цифр`);

  const fe = read('public/mobile-app/src/pages/field/FieldLogin.jsx');
  const otpCount = (fe.match(/useState\(\['', '', '', ''\]\)/) ? 4 : null) || (fe.match(/otp, setOtp\] = useState\(\[([^\]]*)\]\)/)?.[1]?.split(',').length);
  const refsCount = (fe.match(/useRef\(\), useRef\(\), useRef\(\), useRef\(\)/) ? 4 : null);
  const desc = fe.match(/Введи (\d+) цифры/);
  const idxCheck = fe.match(/index\s*<\s*(\d+)\)\s*otpRefs/);
  console.log(`  фронт: ячеек otp=${otpCount}, refs=${refsCount}, подпись «${desc && desc[1]} цифры», переход к следующей при index<${idxCheck && idxCheck[1]}`);
  check('бэк и фронт совпадают (4)',
    beLen && Number(beLen[1]) === 4 && rangeLen === 4 && otpCount === 4 && refsCount === 4 && desc && Number(desc[1]) === 4,
    `бэк ${beLen && beLen[1]}, генерация ${rangeLen}, ячеек ${otpCount}, refs ${refsCount}, подпись ${desc && desc[1]}`);
  check('бэк не шлёт больше, чем ячеек',
    rangeLen === 4 && otpCount === 4,
    `генерация ${rangeLen} цифр → ячеек ${otpCount}`);
}

console.log('\n═══ 4. PIN (вход в приложение рабочего) ═══');
{
  const be = read('src/routes/field-auth.js');
  const bePin = be.match(/pattern:\s*'\^\\\\d\{(\d+)\}\$'/g);
  const beLens = [...be.matchAll(/pin:\s*\{\s*type:\s*'string',\s*pattern:\s*'\^\\\\d\{(\d+)\}\$'/g)].map((x) => x[1]);
  console.log(`  бэк: паттерн PIN → ${beLens.length ? [...new Set(beLens)].join('/') : '?'} цифр (вхождений ${beLens.length})`);

  const setup = read('public/mobile-app/src/pages/field/FieldPinSetup.jsx');
  const setupLen = setup.match(/slice\(0,\s*(\d+)\)/);
  const setupDots = setup.match(/\[0, 1, 2, 3\]/);
  const setupMax = setup.match(/maxLength=\{(\d+)\}/);
  const entry = read('public/mobile-app/src/pages/field/FieldPinEntry.jsx');
  const entryLen = entry.match(/slice\(0,\s*(\d+)\)/);
  console.log(`  фронт setup: slice(0,${setupLen && setupLen[1]}), точек ${setupDots ? 4 : '?'}, maxLength ${setupMax && setupMax[1]}; entry: slice(0,${entryLen && entryLen[1]})`);
  check('PIN 4 цифры везде',
    beLens.length > 0 && [...new Set(beLens)].every((l) => l === '4')
    && setupLen && setupLen[1] === '4' && setupMax && setupMax[1] === '4' && entryLen && entryLen[1] === '4',
    `бэк ${[...new Set(beLens)].join('/')}, setup ${setupLen && setupLen[1]}, entry ${entryLen && entryLen[1]}`);
}

console.log(`\n═══ ИТОГ: ${pass} PASS / ${fail} FAIL ═══`);
process.exit(fail ? 1 : 0);
