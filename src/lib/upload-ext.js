/**
 * upload-ext.js — единая политика типов для загружаемых пользователями файлов.
 *
 * Класс дефекта D-220 (VERIFY-C 20.09, повторно вскрыт независимым верификатором):
 * расширение брали из имени файла клиента (`path.extname(file.filename)`), файл клали
 * в `uploads/`, который раздаётся статикой @fastify/static. Статика выставляет
 * Content-Type по расширению → `evil.html` отдавался как `text/html` и ИСПОЛНЯЛСЯ
 * в домене CRM (stored XSS от лица залогиненного сотрудника). `X-Content-Type-Options:
 * nosniff` тут НЕ помогает: он запрещает угадывание типа, а сервер сам объявляет text/html.
 *
 * Урок D-203/D-206/D-220: закрывать класс централизованно, а не по одному роуту.
 * Здесь — единый вход: БЕЛЫЙ список расширений + ЯВНЫЙ блок-лист исполняемых.
 */

const path = require('path');

/** Расширения, которые браузер может ИСПОЛНИТЬ, если отдать их со своим типом. */
const DANGEROUS_EXT = new Set([
  '.html', '.htm', '.xhtml', '.shtml', '.shtm',
  '.svg', '.xml', '.xsl', '.xslt',
  '.js', '.mjs', '.cjs', '.jsx',
  '.swf', '.hta', '.jar', '.vbs', '.wsf', '.hta',
]);

/** MIME → каноничное расширение. Расширение берём ИЗ MIME, а не из имени клиента. */
const PHOTO_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
};

const DOC_MIME_EXT = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/rtf': '.rtf',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/vnd.rar': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/gzip': '.gz',
  'application/x-tar': '.tar',
};

/** Хранимые расширения, безопасные для раздачи статикой (без исполнения). */
const SAFE_STORED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.heif', '.tiff', '.tif',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.rtf', '.odt', '.ods', '.odp',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.bin',
]);

/** Расширения, допустимые для поля «фото» (allow: 'photo'). */
const PHOTO_EXT_SET = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.heif', '.tiff', '.tif',
]);

function normMime(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

/**
 * Определить безопасное расширение для хранения.
 * @param {string} mimetype — MIME из multipart (не доверяем как единственному источнику истины)
 * @param {string} [filename] — имя от клиента (используем ТОЛЬКО для fallback-сверки)
 * @param {{allow?: 'photo'|'doc'|'any'}} [opts]
 * @returns {string|null} каноничное расширение (с точкой) или null, если тип недопустим
 */
function safeStoredExt(mimetype, filename, opts = {}) {
  const allow = opts.allow || 'any';
  const mime = normMime(mimetype);

  // Расширение определяем по MIME в первую очередь (имя клиента — не источник истины).
  const fromMime = allow === 'photo'
    ? PHOTO_MIME_EXT[mime]
    : (PHOTO_MIME_EXT[mime] || DOC_MIME_EXT[mime]);
  if (fromMime) return fromMime;

  // MIME пустой/незнакомый (частый случай multipart с кривым Content-Type).
  // Тогда единственный ориентир — расширение имени, но только из безопасного списка
  // и никогда из блок-листа исполняемых.
  const raw = String(filename || '');
  const ext = path.extname(raw).toLowerCase();
  if (!ext) return null;
  if (DANGEROUS_EXT.has(ext)) return null;
  if (allow === 'photo' && !PHOTO_EXT_SET.has(ext)) return null;
  return SAFE_STORED_EXT.has(ext) ? ext : null;
}

function isDangerousExt(ext) {
  return DANGEROUS_EXT.has(String(ext || '').toLowerCase());
}

/** Заголовки «безопасного рендера» для файлов потенциально исполнимыми браузером типами. */
function inlineSafetyHeaders(ext) {
  const e = String(ext || '').toLowerCase();
  if (!DANGEROUS_EXT.has(e)) return {};
  return {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  };
}

/** Каноничный Content-Type по расширению сохранённого файла. */
const EXT_CONTENT_TYPE = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
  '.heic': 'image/heic', '.heif': 'image/heif', '.tiff': 'image/tiff', '.tif': 'image/tiff',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain', '.csv': 'text/csv', '.rtf': 'application/rtf',
  '.zip': 'application/zip', '.rar': 'application/vnd.rar', '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar', '.gz': 'application/gzip',
};

/**
 * Безопасный Content-Type для отдачи файла.
 * Приоритет — расширение РЕАЛЬНО сохранённого файла (мы сами его формировали),
 * client-supplied MIME используется только если расширение неизвестно и тип не опасен.
 */
function safeContentType(storedExt, claimedMime) {
  const ext = String(storedExt || '').toLowerCase();
  if (isDangerousExt(ext)) return 'application/octet-stream';
  if (EXT_CONTENT_TYPE[ext]) return EXT_CONTENT_TYPE[ext];

  const claimed = normMime(claimedMime);
  // Никогда не отдаём исполняемые типы, даже если так записано в БД.
  if (!claimed) return 'application/octet-stream';
  if (claimed.includes('html') || claimed.includes('svg') || claimed.includes('xml')
    || claimed.includes('javascript') || claimed.includes('ecmascript')
    || claimed === 'text/xml' || claimed === 'application/xhtml+xml') {
    return 'application/octet-stream';
  }
  return claimed;
}

module.exports = {
  DANGEROUS_EXT,
  PHOTO_MIME_EXT,
  DOC_MIME_EXT,
  SAFE_STORED_EXT,
  PHOTO_EXT_SET,
  EXT_CONTENT_TYPE,
  safeContentType,
  safeStoredExt,
  isDangerousExt,
  inlineSafetyHeaders,
  normMime,
};
