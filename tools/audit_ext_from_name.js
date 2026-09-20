/**
 * Аудит класса D-220 — карта ВСЕХ загрузчиков файлов от пользователя.
 * Для каждого route-handler'а, принимающего multipart, показывает:
 *   - пишет ли в uploads/ (значит раздаётся static или files-роутом)
 *   - как определяется расширение (MIME / из имени клиента / белый список)
 *   - отдаётся ли клиентский mime_type как Content-Type
 *
 * Ручной инструмент; не входит в CI.
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
})(path.join(ROOT, 'src'));

const rows = [];
for (const f of new Set(files.map((x) => path.resolve(x)))) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  // D-220b (аудит поймал СВОЮ слепую зону): раньше проверялся только литерал 'uploads',
  // поэтому роуты, где каталог — переменная (`const uploadDir = process.env.UPLOAD_DIR || './uploads'`),
  // проходили как «без uploads». Теперь признак uploads ищется и по переменным-каталогам всего файла.
  const fileUploadsVar = /process\.env\.UPLOAD_DIR|UPLOAD_BASE|UPLOAD_DIR|uploadDir|uploadBase/.test(src);
  const fileWhitelist = /safeStoredExt|PHOTO_MIME_EXT|upload-ext/.test(src);
  lines.forEach((line, i) => {
    if (!/\.file\(|\.parts\(|multipart/.test(line)) return;
    const win = lines.slice(Math.max(0, i - 20), Math.min(lines.length, i + 90)).join('\n');
    if (!/writeFile|createWriteStream/.test(win)) return;
    // uploads: либо литерал в окне, либо файл в принципе пишет в uploads-каталог через переменную.
    const uploadsRef = /uploads|UPLOAD_DIR|UPLOAD_BASE/.test(win)
      || (fileUploadsVar && /writeFile|writeFileSync|createWriteStream/.test(win));
    const extFromName = /extname\(/.test(win);
    const extFromMime = /safeStoredExt|PHOTO_MIME_EXT|allowedExt|allowed\s*=\s*\[/.test(win) || fileWhitelist;
    const mimeEcho = /Content-Type['"]\s*,\s*(doc|att|file|.*mime)/.test(src) || /\.header\(['"]Content-Type['"],\s*[a-zA-Z_.]*(mime|type)/.test(win);
    rows.push({
      rel,
      line: i + 1,
      uploadsRef,
      extFromName,
      extFromMime,
      mimeEcho,
      snippet: line.trim().slice(0, 90),
    });
  });
}

const risky = rows.filter((r) => r.uploadsRef && r.extFromName && !r.extFromMime);
console.log('=== ВСЕ multipart-загрузчики с записью на диск ===');
rows.forEach((r) => {
  const flags = [
    r.uploadsRef ? 'uploads' : '-',
    r.extFromName ? 'ext<-client' : '-',
    r.extFromMime ? 'whitelist' : '-',
  ].join(' | ');
  console.log(`${r.rel}:${r.line}  [${flags}]\n   ${r.snippet}`);
});
console.log(`\nвсего загрузчиков: ${rows.length}`);
console.log(`\n=== ВЫСОКИЙ РИСК (uploads + ext из имени, без белого списка): ${risky.length} ===`);
risky.forEach((r) => console.log(`  ${r.rel}:${r.line}  ${r.snippet}`));
