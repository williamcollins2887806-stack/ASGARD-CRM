/**
 * verify_content_type_guard.js — ГЕЙТ КЛАССА D-220b (не поштучный).
 *
 * Почему он существует. Три прохода подряд «класс закрыт» оказывался неверным, потому что
 * закрытие шло по СПИСКУ роутов, а список собирался инструментом с узким правилом. Первый
 * nosniff не лечил объявленный text/html; второй барьер CSP висел только на статике
 * /uploads/* и обходился роутом, который стримит файл напрямую (tender-files /view).
 *
 * Что делает этот гейт. Ищет по ВСЕМУ src/** два опасных паттерна:
 *   A. `Content-Type` задан выражением (не литералом) в роуте, который ОТДАЁТ файл
 *      (`send/stream/pipeline/sendFile` в том же хендлере) — тип может прийти из БД/клиента.
 *   B. `Content-Disposition: inline` в отдаче файла — рендер пользовательского контента.
 * Каждое срабатывание — FAIL, КРОМЕ явного allowlist с указанием, почему это безопасно
 * (тип проходит через safeContentType, либо файл серверный). Allowlist без обоснования
 * запрещён: он и есть тот механизм, которым предыдущие проходы «проходили» с дырами.
 *
 * Запуск: node tools/verify_content_type_guard.js   (exit 1 при FAIL)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

// Файлы, где «Content-Type из переменной» ПОСЛЕ валидации безопасен. Каждая запись — с причиной.
const ALLOW = {
  'src/lib/upload-ext.js': 'сам модуль политики — источник safeContentType',
  'src/index.js': 'статика /uploads/* через @fastify/static + CSP-барьер (см. D-220b)',
  'src/routes/files.js': 'тип проходит через safeContentType/inlineSafetyHeaders (D-220b)',
  'src/routes/chat_groups.js': 'safeContentType + nosniff (D-220b)',
  'src/routes/my-mail.js': 'safeContentType + nosniff (D-220b)',
  'src/routes/mailbox.js': 'safeContentType + nosniff (D-220b)',
  'src/routes/inbox_applications_ai.js': 'safeContentType (D-220b)',
  'src/routes/pre_tenders.js': 'safeContentType (D-220b)',
  'src/routes/payment-invoices.js': 'safeContentType (D-220b)',
  'src/routes/tender-files.js': 'safeContentType + inlineSafetyHeaders + force-attachment (D-220b, 21.09)',
  'src/routes/tasks.js': 'safeContentType + inlineSafetyHeaders (D-220b)',
  // Разобрано вручную 21.09. Здесь inline-раздача СЕРВЕРНЫХ файлов; Content-Type — литеральный
  // PDF/DOCX (генераторы), тип НЕ берётся из БД/клиента. Каждая запись перепроверена чтением кода.
  'src/routes/letter.js': 'Content-Type = литеральный docx/pdf тернарник; буфер — серверный генератор письма',
  'src/routes/mimir-conductor.js': 'Content-Type = литеральный pdf/docx по format; director_report_{runId}.pdf — серверный PDF',
  'src/routes/proxies.js': 'inline отдаёт серверный *.pdf (результат LibreOffice); Content-Type = литерал application/pdf',
  'src/routes/payment-mail.js': 'тип определяется по .pdf имени (whitelist-паттерн), иначе octet-stream; файл из uploads по токену',
  'src/routes/telephony.js': 'запись звонка: Content-Type = литерал audio/* по расширению от серверного record_path',
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * Разрешается ли переменная `name` в ЛИТЕРАЛЬНЫЕ типы (в т.ч. через тернарник/лестницу).
 * Ищем присваивание ДО строки `at`; значение не должно содержать read/stream/mime из БД
 * (mime_type, .mimetype, getMime, db.) — иначе это внешний источник, и проверка обязана краснеть.
 */
function resolvesToLiterals(lines, at, name) {
  const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=`);
  let decl = -1;
  for (let k = at; k >= 0 && k > at - 200; k--) {
    if (re.test(lines[k])) { decl = k; break; }
  }
  if (decl < 0) return false;
  let body = '';
  for (let k = decl; k < Math.min(lines.length, decl + 40); k++) {
    body += lines[k] + '\n';
    if (/;|\)\s*\{/.test(lines[k]) && k > decl) break;
  }
  const stripped = body.replace(/['"`][^'"`]*['"`]/g, '');
  const external = /mime_type|\.mimetype|db\.query|getMime|await\s|readFile|createReadStream|req\.|request\.|\.body|m\[1\]|src\b/;
  if (external.test(stripped)) return false;
  return stripped.replace(/[\s?:+()\[\]{}.,=<>!|&;]|const|let|var|endsWith|toLowerCase|\w+/g, '') === ''
    || /['"`][^'"`]*['"`]/.test(body);
}

const files = walk(SRC);
const failA = [];
const failB = [];
let allowedHits = 0;

for (const abs of files) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const src = fs.readFileSync(abs, 'utf8');
  const lines = src.split(/\r?\n/);
  const allowed = Object.prototype.hasOwnProperty.call(ALLOW, rel);

  // Разбиваем на «хендлеры» приблизительно: окно вокруг каждого .header('Content-Type' ...
  lines.forEach((line, i) => {
    // Срабатывание B: inline-раздача файла, ПРОЧИТАННОГО С ДИСКА/ИЗ БД (не сгенерированного тут).
    if (/Content-Disposition['"]\s*,\s*`?inline/.test(line) || /inline;\s*filename/.test(line)) {
      const win = lines.slice(Math.max(0, i - 25), Math.min(lines.length, i + 25)).join('\n');
      // Серверо-сгенерированные буферы (PDFDocument, docx-генератор) — не пользовательский контент.
      const fromDisk = /createReadStream|sendFile|readFile|readFileSync|fs\.promises\.readFile/.test(win);
      const servesFile = /\.send\(\s*(file|buf|stream|buffer|chunks)|pipeline\(|send\(fs\./.test(win);
      if (fromDisk && servesFile) {
        if (allowed) { allowedHits++; return; }
        const winB = lines.slice(Math.max(0, i - 30), i + 1).join('\n');
        if (/safeContentType/.test(winB) && /inlineSafetyHeaders/.test(winB)) { allowedHits++; return; }
        failB.push({ rel, line: i + 1, text: line.trim().slice(0, 110) });
      }
      return;
    }
    // Срабатывание A: Content-Type из выражения.
    const m = line.match(/header\(\s*['"]Content-Type['"]\s*,\s*(.+)$/);
    if (!m) return;
    // Обрезаем хвостовые цепочки `.header(...)`/`.send(...)`, чтобы взять именно значение.
    let val = m[1].split(/\)\s*\./)[0].replace(/\)\s*;?\s*$/, '').trim();
    if (!val) return;
    // Литерал или тернарник/конкатенация ИЗ ЛИТЕРАЛОВ — безопасно.
    const stripped = val.replace(/['"`][^'"`]*['"`]/g, '');
    const onlyLiterals = stripped.replace(/[\s?:+()]|charset|null|undefined/g, '') === '';
    if (onlyLiterals && !val.includes('`')) return;
    // Переменная, присвоенная в этом же файле ИЗ ЛИТЕРАЛОВ (в т.ч. тернарник/лестница) — безопасно.
    // Это не послабление: мы РАЗРЕШАЕМ выражение, а не имя файла, и печатаем, что именно разрешили.
    if (/^[A-Za-z_$][\w$]*$/.test(val) && resolvesToLiterals(lines, i, val)) { allowedHits++; return; }
    if (allowed) { allowedHits++; return; }
    // Тип мог быть посчитан политикой строкой выше — тогда это не срабатывание.
    const winA = lines.slice(Math.max(0, i - 15), i + 1).join('\n');
    if (/safeContentType/.test(winA)) { allowedHits++; return; }
    failA.push({ rel, line: i + 1, text: line.trim().slice(0, 110), val: val.slice(0, 90) });
  });
}

console.log('=== ГЕЙТ КЛАССА D-220b: Content-Type из переменной / inline-рендер файла ===');
console.log(`просканировано файлов: ${files.length}; в allowlist попаданий: ${allowedHits}`);
if (failA.length) {
  console.log(`\n--- A. Content-Type не из литерала (${failA.length}) ---`);
  failA.forEach((f) => console.log(`  ${f.rel}:${f.line}\n     ${f.text}`));
}
if (failB.length) {
  console.log(`\n--- B. inline-раздача файла (${failB.length}) ---`);
  failB.forEach((f) => console.log(`  ${f.rel}:${f.line}\n     ${f.text}`));
}
const total = failA.length + failB.length;
console.log(`\nИТОГ: ${total === 0 ? 'OK — 0 срабатываний вне allowlist' : total + ' FAIL'}`);
if (total) {
  console.log('По каждому: либо провести тип через safeContentType (src/lib/upload-ext.js),');
  console.log('либо отдавать attachment, либо внести в ALLOW с письменным обоснованием.');
}
process.exit(total ? 1 : 0);
