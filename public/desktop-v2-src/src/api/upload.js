/**
 * Безопасные загрузки файлов (POST multipart).
 *
 * Зачем модуль:
 *   1. Единое ограничение размера (зеркало backend MAX_FILE_SIZE=200 MB) —
 *      ловим overflow на клиенте, чтобы не гонять 200 МБ в /dev/null и не получать 413.
 *   2. Mime/extension whitelist по `accept`-строке `<input type="file">`.
 *   3. Унифицированная обработка ошибок 413 (Payload Too Large), 415 (Unsupported Media Type),
 *      401/403 (authz) — превращаем HTTP-коды в человеческие сообщения.
 *   4. Корректная multipart-отправка — Content-Type БРАУЗЕР выставляет САМ
 *      (вместе с boundary). Если выставить вручную — бэк не сможет разобрать.
 *
 * Все upload-сайты должны использовать `postMultipart()` либо как минимум
 * `validateFile()` перед `fetch(..., {body: formData})`.
 */

/** Дефолтный лимит — синхронно с backend `src/index.js` (MAX_FILE_SIZE env, 200 MB). */
export const MAX_FILE_SIZE = 200 * 1024 * 1024;

/** Сервисный лимит для обычных вложений (фото чека, скан допуска и т.п.). */
export const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;

/** Дефолтный лимит для фото (товар, чек) — клиент может ужать до 5 МБ. */
export const MAX_PHOTO_SIZE = 10 * 1024 * 1024;

function getToken() {
  try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; }
}

/** Человеческое имя размера: 1.5 МБ / 200 МБ. */
export function fmtBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0 Б';
  if (v < 1024)         return v + ' Б';
  if (v < 1024 * 1024)  return (v / 1024).toFixed(1) + ' КБ';
  return (v / 1024 / 1024).toFixed(1) + ' МБ';
}

/**
 * Парсит `accept`-строку (`".pdf,.jpg,image/*"`) в список расширений и mime-prefix'ов.
 * Возвращает функцию-предикат `(file) => boolean`.
 */
function buildAcceptMatcher(accept) {
  if (!accept || accept === '*' || accept === '*/*') return null;
  const parts = String(accept).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const exts  = parts.filter((p) => p.startsWith('.')).map((p) => p.slice(1));
  const mimes = parts.filter((p) => !p.startsWith('.'));
  return (file) => {
    const name = String(file?.name || '').toLowerCase();
    const type = String(file?.type || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    if (exts.length && exts.includes(ext)) return true;
    for (const m of mimes) {
      if (m.endsWith('/*')) {
        const prefix = m.slice(0, -1); // 'image/'
        if (type.startsWith(prefix)) return true;
      } else if (type === m) {
        return true;
      }
    }
    return exts.length === 0 && mimes.length === 0;
  };
}

/**
 * Проверка одного файла. Бросает `Error` с понятным сообщением — caller ловит и показывает toast.
 *
 * @param {File} file
 * @param {{ maxSize?: number, accept?: string, label?: string }} opts
 */
export function validateFile(file, opts = {}) {
  if (!file) throw new Error('Файл не выбран');
  const max = Number.isFinite(+opts.maxSize) && +opts.maxSize > 0 ? +opts.maxSize : MAX_FILE_SIZE;
  if (file.size > max) {
    const e = new Error(`Файл слишком большой: ${fmtBytes(file.size)} (максимум ${fmtBytes(max)})`);
    e.code = 'FILE_TOO_LARGE';
    throw e;
  }
  const match = buildAcceptMatcher(opts.accept);
  if (match && !match(file)) {
    const e = new Error(`Неподдерживаемый тип файла: ${file.name || file.type || '—'}. Допустимо: ${opts.accept}`);
    e.code = 'FILE_UNSUPPORTED_TYPE';
    throw e;
  }
  return true;
}

/** Проверка набора файлов — для multi-select. */
export function validateFiles(files, opts = {}) {
  const arr = Array.from(files || []);
  if (!arr.length) throw new Error('Файлы не выбраны');
  for (const f of arr) validateFile(f, opts);
  return arr;
}

/**
 * Единая точка POST multipart/form-data с Authorization.
 *
 * ⚠️ Content-Type НЕ ставим — браузер сам добавит `multipart/form-data; boundary=…`.
 *
 * @param {string} url
 * @param {FormData} formData
 * @param {{ signal?: AbortSignal, onProgress?: (loaded:number, total:number) => void }} opts
 */
export async function postMultipart(url, formData, opts = {}) {
  // Если нужен progress-callback — fetch не умеет, fallback на XHR.
  if (typeof opts.onProgress === 'function') {
    return postMultipartXHR(url, formData, opts);
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + getToken() },
    body: formData,
    signal: opts.signal,
  });
  if (!r.ok) {
    let detail = '';
    try {
      const txt = await r.text();
      try { detail = JSON.parse(txt)?.error || txt; } catch { detail = txt; }
    } catch { /* noop */ }
    throw makeUploadError(r.status, detail || r.statusText);
  }
  if (r.status === 204) return null;
  return r.json().catch(() => ({}));
}

function postMultipartXHR(url, formData, opts) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', 'Bearer ' + getToken());
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        try { opts.onProgress(ev.loaded, ev.total); } catch { /* noop */ }
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (xhr.status === 204 || !xhr.responseText) return resolve(null);
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(xhr.responseText); }
      } else {
        let detail = xhr.responseText || xhr.statusText;
        try { detail = JSON.parse(xhr.responseText)?.error || detail; } catch { /* noop */ }
        reject(makeUploadError(xhr.status, detail));
      }
    };
    xhr.onerror = () => reject(makeUploadError(0, 'Сетевая ошибка'));
    xhr.onabort = () => reject(makeUploadError(0, 'Загрузка отменена'));
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(formData);
  });
}

/** Превращает HTTP-статус в понятную ошибку. */
function makeUploadError(status, detail) {
  let msg;
  switch (status) {
    case 401: msg = 'Нет доступа. Войдите заново.'; break;
    case 403: msg = 'Доступ запрещён.'; break;
    case 413: msg = `Файл слишком большой (лимит сервера ${fmtBytes(MAX_FILE_SIZE)}).`; break;
    case 415: msg = `Неподдерживаемый тип файла${detail ? ': ' + detail : ''}.`; break;
    case 0:   msg = detail || 'Сеть недоступна'; break;
    default:  msg = detail || `HTTP ${status}`;
  }
  const err = new Error(msg);
  err.status = status;
  err.code = status === 413 ? 'FILE_TOO_LARGE'
           : status === 415 ? 'FILE_UNSUPPORTED_TYPE'
           : 'UPLOAD_FAILED';
  return err;
}
