import { api } from '@/api/client';

/** URL для скачивания с token (мобильный браузер не шлёт Bearer на <a href>). */
export function fileDownloadUrl(pathOrDoc) {
  let url = '';
  if (typeof pathOrDoc === 'string') {
    url = pathOrDoc;
  } else if (pathOrDoc) {
    url = pathOrDoc.file_url || pathOrDoc.download_url || '';
    if (!url && pathOrDoc.filename) {
      url = `/api/files/download/${encodeURIComponent(pathOrDoc.filename)}`;
    }
  }
  if (!url) return '';
  if (url.startsWith('/api/files/download/') || url.startsWith('/api/files/preview/')) {
    const t = api.getToken?.() || '';
    if (t && !/[?&]token=/.test(url)) {
      url += (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(t)}`;
    }
  }
  return url;
}

/** Скачивание через fetch + Blob (надёжнее на iOS). */
export async function downloadProtected(url, filename) {
  const full = fileDownloadUrl(url);
  if (!full) throw new Error('Нет URL файла');
  const token = api.getToken?.() || '';
  const r = await fetch(full.replace(/\?token=[^&]+/, '').split('?')[0] + (full.includes('?') ? full.slice(full.indexOf('?')) : ''), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const blob = await r.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  if (filename) a.download = filename;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
}
