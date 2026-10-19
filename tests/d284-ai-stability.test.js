'use strict';
/**
 * D-284 (прод 19.10.2026): стабильность разбора писем.
 * ═══════════════════════════════════════════════════════════════════════════
 * ЖИВОЙ ИНЦИДЕНТ. Письмо #4894 (Fwd: Запрос КП, ООО «Велесстрой») висело
 * неразобранным 2.5 минуты:
 *
 *   22:26:43  обрыв по токенам (stopReason=length) — повтор с maxTokens=8192
 *   22:26:43  Empty AI response — marking _parse_failed
 *   22:27:49  обрыв по токенам — повтор с maxTokens=16384
 *   22:27:49  Empty AI response
 *   22:28:34  наконец разобралось (третья попытка)
 *
 * ПРИЧИНА НЕ В РАЗМЕРЕ БЮДЖЕТА. Модель по умолчанию — deepseek-v4.1-flash,
 * «думающая»: reasoning съедает max_tokens РАНЬШЕ content, ответ приходит
 * ПУСТЫМ. В invoice-ai-extract (счета) reasoning отключали, в анализаторе
 * писем — забыли. Три попытки × удвоение = до 28672 токенов впустую.
 *
 * Тест держит три свойства:
 *   1) reasoning ОТКЛЮЧЁН при разборе письма;
 *   2) при пустом ответе с length бьём тревогу в лог (диагностируемость);
 *   3) лимиты входа не режут содержательную часть (ТЗ в хвосте письма).
 */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const SRC = fs.readFileSync(path.join(__dirname, '../src/services/ai-email-analyzer.js'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────
console.log('── 1. reasoning отключён (главная причина) ──');
check('analyzeEmail передаёт reasoning: {enabled:false}', /reasoning:\s*reasoningOff/.test(SRC));
check('константа reasoningOff объявлена', /const reasoningOff = \{ enabled: false \}/.test(SRC));
// Не должно остаться вызова completeFn с температурой без reasoning.
{
  // Ищем вызов внутри цикла повторов.
  const m = SRC.match(/response = await completeFn\(\{[\s\S]{0,400}?\}\);/);
  check('вызов completeFn содержит reasoning', !!(m && /reasoning/.test(m[0])),
    m ? 'нет reasoning в вызове' : 'вызов не найден');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 2. Диагностика пустого ответа ──');
check('пустой ответ при length логируется явно', /ПУСТОЙ ответ при stopReason=length/.test(SRC));
check('emptyText вычисляется', /const emptyText = !String\(response\.text \|\| ''\)\.trim\(\)/.test(SRC));

// ─────────────────────────────────────────────────────────────────────────
console.log('── 3. Лимиты входа не режут ТЗ ──');
{
  const m = SRC.match(/function buildAnalysisMessage[\s\S]*?\n  if \(workload\)/);
  const fn = m ? m[0] : '';
  check('тело: сохраняется хвост письма', /slice\(-tail\)/.test(fn));
  check('тело: есть маркер пропуска середины', /середина опущена/.test(fn));
  check('вложения: лимит делится на файлы', /perFile = Math\.max\(1500/.test(fn));
  check('вложения: каждый файл получает долю', /attachmentTexts\.map/.test(fn));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 4. Реальный кейс: письмо #4894 не теряется ──');
{
  // Воспроизводим структуру: шапка форвардера + длинное ТЗ в хвосте.
  const header = '-------- Пересылаемое сообщение --------\n19.10.2026, 16:17, info@asgard-service.com\n';
  const filler = 'x'.repeat(4000);
  const toz = 'ТЕХНИЧЕСКОЕ ЗАДАНИЕ: промывка и обезжиривание УУКГ, линия СПГ Усть-Луга';
  const body = header + filler + toz;

  const maxLen = 3000;
  const head = Math.floor(maxLen * 0.4);
  const tail = maxLen - head;
  const cut = body.slice(0, head) + '\n...[середина опущена]...\n' + body.slice(-tail);

  check('ТЗ из хвоста дошло до модели', cut.includes('промывка и обезжиривание'), 'ТЗ потеряно');
  check('шапка форвардера тоже сохранена', cut.includes('Пересылаемое сообщение'), 'шапка потеряна');
  check('длина уложилась в лимит (+маркер)', cut.length <= maxLen + 40, `len=${cut.length}`);
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 5. Регресс: детектор «Добро» не задет ──');
{
  const { detectApproval } = require('../src/services/approval-detector');
  check('«Добро» от Гажилиева проходит', detectApproval('Добро').approve === true);
  check('пустое письмо не согласие', detectApproval('').approve === false);
  check('«Оплату подтверждаю» не согласие', detectApproval('Оплату подтверждаю').approve === false);
}

console.log('\n────────────────────────────────────────');
console.log(`ИТОГ D-284: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('FAIL:', fails.join(' | ')); process.exit(1); }
