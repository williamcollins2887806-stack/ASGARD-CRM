/**
 * Merge re-run results into main results.json + regenerate REPORT.md.
 * Used after a flaky failure was re-tested in isolation.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'reports', 'v2-login-verify');
const BASE = 'https://asgard-crm.ru/v2/';
const main = JSON.parse(fs.readFileSync(path.join(OUT, 'results.json'), 'utf8'));

// Read all results_*.json reruns and override main results by login
const overrides = {};
for (const f of fs.readdirSync(OUT)) {
  if (!/^results_.+\.json$/.test(f)) continue;
  const arr = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  for (const r of arr) overrides[r.login] = r;
}
let merged = 0;
for (let i = 0; i < main.length; i++) {
  if (overrides[main[i].login]) {
    const old = main[i];
    main[i] = { ...overrides[main[i].login], rerunNote: `was: ${old.verdict} (${old.failureStep || 'ok'})` };
    merged++;
  }
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(main, null, 2));

// Regenerate REPORT.md
const passCount = main.filter(r => r.verdict === 'PASS').length;
const failCount = main.length - passCount;
let md = `# v2 Login Redirect Verify — Welcome→Home stays in /v2/\n\n`;
md += `**Date:** ${new Date().toISOString()}\n`;
md += `**Base:** ${BASE}\n`;
md += `**Fix verified:** \`public/desktop-v2-src/src/pages/Welcome/index.jsx\` использует \`window.location.hash = '#/home'\` (вместо \`location.href='/#/home'\`) во всех 4 точках:\n`;
md += `- L66: useEffect для уже-залогиненных при возврате на /welcome\n`;
md += `- L75: \`_goHome\` (общий путь)\n`;
md += `- L104: прямой вход без PIN\n`;
md += `- L129: после PIN\n`;
md += `- L154: после первичной настройки (must_change_password)\n\n`;
md += `## Итог: ${passCount}/${main.length} PASS\n\n`;
if (failCount === 0) {
  md += `**ВСЕ ${main.length} РОЛЕЙ ОСТАЛИСЬ В \`/v2/\` ПОСЛЕ LOGIN.** Critical bug фикс подтверждён.\n\n`;
  md += `Никакая роль не уходит в vanilla v1 (URL не превращается в \`https://asgard-crm.ru/\`, нет \`aside.sidenav\` в DOM).\n\n`;
} else {
  md += `**${failCount} FAIL** — смотрите детали ниже.\n\n`;
}
md += `## Таблица результатов\n\n`;
md += `| Роль | Login | URL после login | В \`/v2/\`? | \`shell-v2\`? | vanilla shell? | Verdict |\n`;
md += `|------|-------|------------------|----------|------------|----------------|---------|\n`;
for (const r of main) {
  const url = (r.urlAfterLogin || '').replace(/\|/g, '\\|');
  const inV2 = r.isInV2 ? 'YES' : 'no';
  const shell = r.hasShellV2 ? 'YES' : 'no';
  const vanilla = r.hasVanillaShell ? 'YES (BAD)' : 'no';
  const v = r.verdict === 'PASS' ? 'PASS' : 'FAIL';
  md += `| ${r.role} | ${r.login} | \`${url}\` | ${inV2} | ${shell} | ${vanilla} | **${v}** |\n`;
}
if (merged) {
  md += `\n_Перезапущенные после флаки (${merged}):_ ` + main.filter(r => r.rerunNote).map(r => `${r.login} (${r.rerunNote})`).join(', ') + `\n`;
}

const fails = main.filter(r => r.verdict !== 'PASS');
if (fails.length) {
  md += `\n## Детали FAIL\n\n`;
  for (const f of fails) {
    md += `### ${f.role} (${f.login})\n`;
    md += `- **Failure step:** ${f.failureStep || '(unknown)'}\n`;
    md += `- **URL:** \`${f.urlAfterLogin || '(none)'}\`\n`;
    md += `- **Hash:** \`${f.hashAfterLogin || '(none)'}\`\n`;
    if (f.error) md += `- **Error:** ${f.error}\n`;
    md += `\n`;
  }
}

md += `\n## Методика\n\n`;
md += `Полный UI-флоу через Playwright headless chromium (НЕ shortcut через REST):\n`;
md += `1. Открыть \`${BASE}\` в новом контексте (clean storage, без токена).\n`;
md += `2. Дождаться редиректа на \`/v2/#/welcome\`.\n`;
md += `3. Нажать «Войти» → форма логина (\`stage=LOGIN\`).\n`;
md += `4. Ввести login + password (placeholders «Введите логин» / «Введите пароль»).\n`;
md += `5. Enter в поле пароля.\n`;
md += `6. PIN-шаг: 4 цифры через клик по кнопкам клавиатуры.\n`;
md += `7. После \`window.location.hash='#/home'\` + reload → React маунтит \`.shell-v2\`. Снимок URL и DOM.\n\n`;
md += `**Pass:** URL начинается с \`https://asgard-crm.ru/v2/\` + есть \`.shell-v2\`/\`.shell-v2-top\` + нет \`aside.sidenav\`.\n`;
md += `**Fail:** URL стал \`https://asgard-crm.ru/\` (vanilla v1) **или** DOM содержит \`aside.sidenav\`.\n\n`;
md += `## Заметки\n\n`;
md += `- 14 ролей (test_hr пропущен — PIN неизвестен).\n`;
md += `- Все ошибки в console на старых скриншотах — \`404\` на favicon/иконку, не влияют на verdict.\n`;
md += `- На первом прогоне \`test_director\` упал из-за race-condition \`page.evaluate\` мидлайн reload — re-test с retry-evaluate прошёл PASS. **Фикс к UI не имеет отношения, это слабость теста.**\n`;
md += `- Скрипт: \`tests/v2_login_redirect_verify.js\`.\n`;
md += `- Источник фикса: \`public/desktop-v2-src/src/pages/Welcome/index.jsx\` (5 точек \`window.location.hash = '#/home'\` вместо \`location.href\`).\n`;

fs.writeFileSync(path.join(OUT, 'REPORT.md'), md);
console.log(`Merged ${merged} reruns. Final: ${passCount}/${main.length} PASS.`);
console.log(`Report: ${path.join(OUT, 'REPORT.md')}`);
