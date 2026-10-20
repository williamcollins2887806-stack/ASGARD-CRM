'use strict';
/**
 * D-291 (заказчик 20.10.2026): проверка правок Doc Hub.
 * ═══════════════════════════════════════════════════════════════════════════
 * Закрываем шесть жалоб на странице «Финансы · Документы»:
 *   1. Выпадающие списки показывали «пол текста» — жёсткий height:34px при
 *      глобальном padding 12px/16px и appearance:none.
 *   2. Липкая шапка ехала на прозрачном фоне.
 *   3. В «Входящих СФ» кнопка «СФ получена» наезжала на текст.
 *   4. «Способ получения = email» — неверно: поле про ЗАКРЫВАЮЩИЕ документы.
 *   5. Англицизмы: «Дозаполните: contract_not_found».
 *   6. Не было графика оплат и корзины (удаление/восстановление).
 *
 * Тест проверяет и CSS-правила, и JS-словари/нормализацию — потому что часть
 * дефектов была именно в отсутствии правил, а не в их неверном значении.
 */

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

const CSS = fs.readFileSync(path.join(__dirname, '../public/assets/css/doc-hub.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '../public/assets/js/doc-hub.js'), 'utf8');
const INTAKE = fs.readFileSync(path.join(__dirname, '../src/services/doc-email-intake.js'), 'utf8');
const ROUTE = fs.readFileSync(path.join(__dirname, '../src/routes/doc-registry.js'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────
console.log('── 1. Выпадающие списки: высота по содержимому ──');
{
  const m = CSS.match(/\.dh-facet input,[\s\S]{0,40}?\.dh-facet select\s*\{[\s\S]*?\n\}/);
  const block = m ? m[0] : '';
  check('высота auto, а не фиксированные 34px', /height:\s*auto/.test(block), block.slice(0, 120));
  check('есть min-height как нижняя граница', /min-height:\s*34px/.test(block));
  check('правый отступ под стрелку select', /padding:\s*7px 34px 7px 10px/.test(block));
  check('line-height задан явно', /line-height:\s*1\.25/.test(block));
  check('для input правый отступ обычный', /\.dh-facet input\s*\{\s*padding-right:\s*10px/.test(CSS));
  check('сортировка не обрезается (min-width 250px)', /\.dh-facet--sort select\s*\{\s*min-width:\s*250px/.test(CSS));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 2. Липкая шапка непрозрачная ──');
{
  const m = CSS.match(/\.dh-app--embedded \.dh-top\s*\{[\s\S]*?\}/);
  const block = m ? m[0] : '';
  check('position: sticky сохранён', /position:\s*sticky/.test(block));
  check('задан непрозрачный background', /background:\s*var\(--bg/.test(block), block.slice(0, 200));
  check('есть разделитель снизу', /border-bottom:\s*1px solid/.test(block));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 3. «Входящие СФ»: без наложения ──');
{
  check('класс .dh-sf__table объявлен в CSS', /\.dh-sf__table\s+\.dh-actions/.test(CSS));
  check('фон колонки действий непрозрачный', /\.dh-sf__table[\s\S]{0,200}background:\s*var\(--bg2/.test(CSS));
  check('nowrap для кнопок', /\.dh-sf__table[\s\S]{0,400}white-space:\s*nowrap/.test(CSS));
  check('класс применён к таблице в JS', /class="dh-table dh-sf__table"/.test(JS));
  check('колонка называется «Отметка», не «Действия»', /dh-actions">Отметка</.test(JS));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 4. «Способ получения»: не email ──');
{
  check('intake больше не пишет email', !/VALUES \('in','invoice'[\s\S]{0,300}'email'/.test(INTAKE));
  check('intake пишет NULL', /'other',\$10,\$10,\$10,NULL,\$11/.test(INTAKE));
  check('есть нормализация каналов receiveChannelCanon', /function receiveChannelCanon/.test(JS));
  check('ЭДО распознаётся в любом написании', /эдо\|edo/.test(JS));
  check('операторы ЭДО (сбис/контур) — тоже ЭДО', /сбис\|sbis\|диадок/.test(JS));
  check('исходный текст в подсказке ячейки', /const title = raw && raw\.toLowerCase\(\) !== label\.toLowerCase\(\)/.test(JS));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 5. Причины — по-русски, без кодов ──');
{
  check('есть переводчик incompleteReasonLabel', /function incompleteReasonLabel/.test(JS));
  check('contract_not_found переведён', /contract_not_found:\s*'договор из счёта не найден/.test(JS));
  check('no_payment_terms переведён', /no_payment_terms:\s*'не указаны условия оплаты/.test(JS));
  check('fallback не показывает сырой код', /return map\[code\] \|\| 'требует проверки'/.test(JS));
  check('неизвестный код не утекает в текст', !/labels\[r\] \|\| r/.test(JS));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 6. Корзина: удаление и восстановление ──');
{
  check('API: GET /trash', /fastify\.get\('\/trash'/.test(ROUTE));
  check('API: POST /:id/restore', /fastify\.post\('\/:id\/restore'/.test(ROUTE));
  check('restore проверяет права', /Нет прав на восстановление/.test(ROUTE));
  check('UI: вкладка «Корзина (удалённые)»', /Корзина \(удалённые\)/.test(JS));
  check('UI: кнопка «Восстановить»', /data-restore=/.test(JS));
  check('UI: кнопка «Удалить» в карточке', /id="dhDrawerDelete"/.test(JS));
  check('удаление подтверждается', /confirm\('Удалить документ\?/.test(JS));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 7. График оплат ──');
{
  check('API: /payment-schedule', /fastify\.get\('\/payment-schedule'/.test(ROUTE));
  check('API объявлен ДО /:id (иначе перехватится)', (() => {
    const a = ROUTE.indexOf("'/payment-schedule'");
    const b = ROUTE.indexOf("'/:id'");
    return a > 0 && b > 0 && a < b;
  })());
  check('KPI: просрочено / неделя / месяц', /overdue:/.test(ROUTE) && /week:/.test(ROUTE) && /month:/.test(ROUTE));
  check('частичная оплата — ближайший этап', /payment_kind.*partial/.test(ROUTE) && /next\.due_at|due = iso\(next\.due_at\)/.test(ROUTE));
  check('UI: кнопка «График оплат»', /id="dhBtnPay"/.test(JS));
  check('UI: календарь платежей', /dh-pdays/.test(JS));
  check('CSS: стили календаря', /\.dh-pdays\s*\{/.test(CSS) && /\.dh-pday\b/.test(CSS));
  check('deep-link tab=pay', /tab === 'pay'\) state\.payTab = true/.test(JS));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 8. Вложения: имя файла вместо пути ──');
{
  check('есть niceName (декодирует имя из URL)', /const niceName =/.test(JS));
  check('не печатается сырой url в подписи', !/<div class="b">\$\{url \? esc\(url\)/.test(JS));
  check('есть кнопка «Скачать»', /download title="Скачать"/.test(JS));
  check('CSS: кнопки вложений не сжимаются', /\.dh-attach__acts\s*\{[^}]*flex:\s*0 0 auto/.test(CSS));
}

// ─────────────────────────────────────────────────────────────────────────
console.log('── 9. Миграции ──');
{
  const m419 = fs.readFileSync(path.join(__dirname, '../migrations/V419__reset_receive_channel_email.sql'), 'utf8');
  const m420 = fs.readFileSync(path.join(__dirname, '../migrations/V420__doc_owner_to_tumaeva.sql'), 'utf8');
  check('V419 сбрасывает email', /receive_channel = NULL[\s\S]{0,200}receive_channel = 'email'/.test(m419));
  check('V419 сводит варианты к edo/original/scan', (m419.match(/SET receive_channel = '(edo|original|scan)'/g) || []).length >= 3);
  check('V420 переводит админа и пустые', /doc_owner_id = 1 OR doc_owner_id IS NULL/.test(m420));
  check('V420 ищет Тумаеву по email, а не по хардкод-id', /office@asgard-service\.com/.test(m420));
  check('V420 падает, если сотрудник не найден', /RAISE EXCEPTION/.test(m420));
}

console.log('\n────────────────────────────────────────');
console.log(`ИТОГ D-291: PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log('FAIL:', fails.join(' | ')); process.exit(1); }
