'use strict';

/**
 * src/lib/file-signature.js
 *
 * D-393: проверка РЕАЛЬНОГО типа файла по сигнатуре (magic bytes).
 *
 * ПРОБЛЕМА (28.10.2026). В uploads лежали файлы `….7z` и `….rar` по 302 байта,
 * внутри — HTML-заглушка прокси Газпром-Нефти:
 *
 *   <html><script>location.href = "http://spb99-prx-sa.gazprom-neft.local:8002/
 *   block/?&m=connection&reason=connection_error&param1=unexpected_disconnect…
 *
 * Поставщик выложил архив, но при скачивании корпоративный прокси подменил
 * содержимое страницей ошибки. Система честно пыталась распаковать «архив»
 * три раза, писала в лог `EXTRACT_FAILED: Не удалось распаковать 7Z-архив`
 * и в итоге сдавалась с невнятным «Ни один файл не распознан».
 *
 * Человек при этом не понимал, что дело в повреждённом файле, а не в системе.
 * Правильный ответ: «файл повреждён при скачивании — запросите заново».
 *
 * РЕШЕНИЕ. Определяем тип по первым байтам. Если расширение обещает архив или
 * документ, а внутри HTML/текст — это подмена, и мы говорим об этом прямо.
 *
 * Почему по сигнатуре, а не по MIME: MIME приходит от клиента и тоже врёт.
 * Сигнатура — единственное, что нельзя подделать случайно.
 */

/** Расширения, которые ОБЯЗАНЫ быть бинарными контейнерами. */
const BINARY_EXTS = new Set([
  '.7z', '.rar', '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.heic', '.heif',
]);

/** Сигнатуры контейнеров: ext → массив допустимых «начал». */
const SIGNATURES = {
  '.zip': [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]],
  // docx/xlsx/pptx — это ZIP
  '.docx': [[0x50, 0x4b, 0x03, 0x04]],
  '.xlsx': [[0x50, 0x4b, 0x03, 0x04]],
  '.pptx': [[0x50, 0x4b, 0x03, 0x04]],
  '.7z': [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
  '.rar': [[0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]],       // Rar!...
  '.gz': [[0x1f, 0x8b]],
  '.tgz': [[0x1f, 0x8b]],
  '.bz2': [[0x42, 0x5a, 0x68]],
  '.xz': [[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]],
  '.pdf': [[0x25, 0x50, 0x44, 0x46]],                     // %PDF
  '.doc': [[0xd0, 0xcf, 0x11, 0xe0], [0x50, 0x4b, 0x03, 0x04]],
  '.xls': [[0xd0, 0xcf, 0x11, 0xe0], [0x50, 0x4b, 0x03, 0x04]],
  '.ppt': [[0xd0, 0xcf, 0x11, 0xe0], [0x50, 0x4b, 0x03, 0x04]],
  '.jpg': [[0xff, 0xd8, 0xff]],
  '.jpeg': [[0xff, 0xd8, 0xff]],
  '.png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  '.gif': [[0x47, 0x49, 0x46, 0x38]],
  '.bmp': [[0x42, 0x4d]],
  '.webp': [[0x52, 0x49, 0x46, 0x46]],                    // RIFF....WEBP
  '.tiff': [[0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a]],
  '.tif': [[0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a]],
  '.tar': [],                                              // у tar сигнатуры нет
};

/** Похоже ли начало файла на HTML/текст (страница ошибки, заглушка). */
function looksLikeHtml(buf) {
  if (!buf || !buf.length) return false;
  // Берём первые 512 байт и ищем теги в начале (с пропуском BOM и пробелов).
  const head = buf.slice(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  return head.startsWith('<html')
    || head.startsWith('<!doctype')
    || head.startsWith('<?xml')
    || head.startsWith('<head')
    || head.startsWith('<script')
    || head.startsWith('<body');
}

/** Совпадает ли начало файла с одной из сигнатур. */
function matchesSignature(buf, sigs) {
  if (!sigs || !sigs.length) return true; // сигнатуры нет (tar) — не судим
  return sigs.some((sig) => sig.every((byte, i) => buf[i] === byte));
}

/**
 * Проверить файл по сигнатуре.
 *
 * @param {Buffer|Uint8Array} buf — первые байты файла (достаточно 512)
 * @param {string} ext — расширение с точкой, в нижнем регистре ('.7z', '.pdf')
 * @returns {{ok:boolean, reason?:string, detail?:string}}
 *   ok=true  — файл соответствует расширению (или расширение без сигнатуры);
 *   ok=false — подмена: HTML под видом архива/документа, или битая сигнатура.
 */
function checkFileSignature(buf, ext) {
  const e = String(ext || '').toLowerCase();
  if (!buf || !buf.length) {
    return { ok: false, reason: 'empty_file', detail: 'Файл пустой' };
  }

  // HTML под видом чего угодно бинарного — это подмена (прокси/сервер отдал ошибку).
  if (BINARY_EXTS.has(e) && looksLikeHtml(buf)) {
    return {
      ok: false,
      reason: 'html_instead_of_file',
      detail: 'Внутри файла HTML-страница, а не сам документ. '
        + 'Обычно так бывает, когда скачивание оборвалось или корпоративный прокси '
        + 'вернул страницу ошибки вместо файла.',
    };
  }

  const sigs = SIGNATURES[e];
  if (!sigs || !sigs.length) return { ok: true }; // неизвестное расширение — не судим

  if (!matchesSignature(buf, sigs)) {
    return {
      ok: false,
      reason: 'bad_signature',
      detail: `Содержимое не соответствует расширению ${e}: файл повреждён или это другой тип.`,
    };
  }
  return { ok: true };
}

/**
 * Человеческое объяснение для интерфейса.
 * @param {{reason?:string, detail?:string}} res — результат checkFileSignature
 * @param {string} fileName
 * @returns {string}
 */
function explainSignatureFailure(res, fileName) {
  const name = fileName ? `«${fileName}»` : 'Файл';
  if (res && res.reason === 'html_instead_of_file') {
    return `${name} повреждён: внутри не документ, а страница ошибки. `
      + 'Скачайте файл заново (или попросите поставщика прислать повторно) и загрузите снова.';
  }
  if (res && res.reason === 'empty_file') {
    return `${name} пустой — загрузите файл заново.`;
  }
  if (res && res.reason === 'bad_signature') {
    return `${name} повреждён: содержимое не соответствует расширению. `
      + 'Скачайте заново и повторите загрузку.';
  }
  return `${name}: файл не прошёл проверку.`;
}

module.exports = {
  BINARY_EXTS,
  SIGNATURES,
  looksLikeHtml,
  checkFileSignature,
  explainSignatureFailure,
};
