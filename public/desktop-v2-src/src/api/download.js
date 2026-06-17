/**
 * Безопасные скачивания/просмотр файлов.
 *
 * ПРОБЛЕМА с `?token=` в URL:
 *   – Токен попадает в логи прокси и сервера.
 *   – Токен сохраняется в browser history.
 *   – При наличии `target=_blank` и редиректов токен может утечь через Referer.
 *
 * РЕШЕНИЕ:
 *   – `fetch()` с `Authorization: Bearer …` → blob → `URL.createObjectURL()`.
 *   – Открываем blob-URL (`window.open` / `<a>`), он живёт только в текущей вкладке.
 *   – Очищаем `URL.revokeObjectURL` после открытия.
 */

function getToken() {
  try { return localStorage.getItem('asgard_token') || ''; } catch { return ''; }
}

/**
 * Получить файл с auth-заголовком и вернуть blob-URL.
 * Вызывающий обязан выполнить URL.revokeObjectURL после использования.
 */
export async function fetchBlobUrl(url) {
  const r = await fetch(url, {
    headers: { Authorization: 'Bearer ' + getToken() },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    const err = new Error(`HTTP ${r.status}: ${txt || r.statusText}`);
    err.status = r.status;
    throw err;
  }
  const blob = await r.blob();
  return { blobUrl: URL.createObjectURL(blob), contentType: r.headers.get('content-type') || '' };
}

/**
 * Открыть защищённый ресурс (PDF/изображение/Excel) в новой вкладке БЕЗ токена в URL.
 * Если open() заблокирован браузером — fallback: <a download>.
 */
export async function openProtected(url, filename) {
  const { blobUrl } = await fetchBlobUrl(url);
  const w = window.open(blobUrl, '_blank', 'noopener,noreferrer');
  if (!w) {
    // popup blocked → форсированное скачивание
    const a = document.createElement('a');
    a.href = blobUrl;
    if (filename) a.download = filename;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // ревокаем через 60 секунд (запас на загрузку PDF в новой вкладке)
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

/**
 * Принудительное скачивание файла (Excel/PDF/архив) без открытия вкладки.
 */
export async function downloadProtected(url, filename) {
  const { blobUrl } = await fetchBlobUrl(url);
  const a = document.createElement('a');
  a.href = blobUrl;
  if (filename) a.download = filename;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
}
