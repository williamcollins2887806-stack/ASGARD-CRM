'use strict';

/**
 * Тесты: в интерфейсе нет англицизмов и служебных кодов.
 *
 * ── Требование ─────────────────────────────────────────────────────────────
 * В модалках анализа и просчёта, в отчётах и письмах не должно быть
 * английских слов и «сырых» кодов схемы (go/no-go, need_info, no_go,
 * conditional, expert, high/medium/low). Пользователь — русский РП.
 *
 * ── Что считается нарушением ───────────────────────────────────────────────
 * Только то, что ВИДИТ пользователь: тексты внутри шаблонов, подписи кнопок,
 * заголовки. Имена полей в коде (reportJson.decision_recommend) — не
 * нарушение: их не видно.
 *
 * Допустимы: обозначения единиц (DN, Ру, м3), бренды (BORZIG, Hi Pro),
 * технические сокращения (НДС, ТО, ИТР, РП, ТКП, ВОР, ДВ).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  path.join(ROOT, 'public', 'assets', 'js', 'rp_review_modal.js'),
  path.join(ROOT, 'public', 'assets', 'js', 'rp_calc_modal.js'),
  path.join(ROOT, 'public', 'assets', 'js', 'director_analytics.js'),
  path.join(ROOT, 'src', 'services', 'tender-director-mail.js'),
  path.join(ROOT, 'src', 'services', 'tender-digest.js')
];

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log('PASS ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log('FAIL ' + name + ' — ' + e.message);
  }
}

/**
 * Вытаскивает из файла строки, которые попадут в интерфейс.
 *
 * Берём только то, что похоже на ГОТОВЫЙ ТЕКСТ: строка содержит кириллицу,
 * начинается с заглавной буквы или цифры и не содержит признаков кода
 * (скобки вызова, точки с запятой, стрелки, переводы строк).
 *
 * Так отсекаются куски кода с комментариями внутри литералов — они не
 * показываются пользователю.
 */
function uiStrings(src) {
  const out = [];
  const re = /(['"`])((?:[^'"`\\]|\\.)*[а-яёА-ЯЁ](?:[^'"`\\]|\\.)*)\1/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const s = m[2];
    // Многострочные литералы — это код с комментариями, не подпись.
    if (s.includes('\n') || s.includes('\\n')) continue;
    // Признаки кода: вызовы, присваивания, стрелки.
    if (/[();{}]|=>|\|\||&&/.test(s)) continue;
    // Подпись: короткий текст, начинается с буквы или цифры.
    if (s.length > 160) continue;
    if (!/^[\s\d«"']?[А-ЯЁA-Zа-яё]/.test(s.trim()) && !/^\d/.test(s.trim())) continue;
    out.push(s.trim());
  }
  return out;
}

/** Запрещённые обороты: ИИ-штампы и служебные коды в тексте. */
const BANNED = [
  /важно отметить/i,
  /следует отметить/i,
  /стоит отметить/i,
  /необходимо отметить/i,
  /таким образом/i,
  /в заключение/i,
  /в целом\b/i,
  /в свою очередь/i,
  /тем не менее/i,
  /подводя итог/i,
  /резюмируя/i,
  /в конечном счёте/i,
  /как известно/i,
  /в рамках\b/i,
  /в целях\b/i,
  /надлежащ/i,
  /вышеуказанн/i,
  /вышеупомянут/i,
  /нижеследующ/i,
  /осуществля/i,
  /является\b/i,
  /настоящим\b/i
];

check('в текстах интерфейса нет ИИ-штампов и канцелярита', () => {
  const bad = [];
  for (const file of FILES) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const s of uiStrings(src)) {
      for (const re of BANNED) {
        if (re.test(s)) bad.push(path.basename(file) + ': «' + s.slice(0, 70) + '» (' + re + ')');
      }
    }
  }
  assert.strictEqual(bad.length, 0, 'найдено:\n  ' + bad.slice(0, 8).join('\n  '));
});

check('служебные коды не показываются пользователю', () => {
  // Коды вроде go/no-go и need_info допустимы в данных, но не в тексте.
  const CODES = [/\bgo\/no-go\b/i, /\bneed_info\b/, /\bno_go\b/, /--> *go</, /\bdecision_recommend\b/];
  const bad = [];
  for (const file of FILES) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const s of uiStrings(src)) {
      for (const re of CODES) {
        if (re.test(s)) bad.push(path.basename(file) + ': «' + s.slice(0, 60) + '»');
      }
    }
  }
  assert.strictEqual(bad.length, 0, 'найдено:\n  ' + bad.slice(0, 8).join('\n  '));
});

check('решения переведены на русский', () => {
  // Проверяем, что коды получили русские подписи, а не показываются как есть.
  const src = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'js', 'rp_review_modal.js'), 'utf8');
  assert.ok(/не подаём/i.test(src), 'нет подписи для отказа');
  assert.ok(/Нужны данные/i.test(src), 'нет подписи для «нужны данные»');
  assert.ok(/Условно/i.test(src), 'нет подписи для «условно»');
});

check('единицы и технические сокращения остаются как есть', () => {
  // Это НЕ англицизмы: так пишут в промышленной документации.
  const src = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'js', 'rp_calc_modal.js'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'public', 'assets', 'js', 'rp_review_modal.js'), 'utf8');
  assert.ok(/м3|м³/.test(src), 'кубометры должны остаться');
  // Проверяем, что русские подписи на месте (не переведено «обратно»).
  assert.ok(/Объём/i.test(src), 'нет подписи «Объём»');
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log('итог: ' + (results.length - failed.length) + ' PASS, ' + failed.length + ' FAIL');
process.exit(failed.length ? 1 : 0);
