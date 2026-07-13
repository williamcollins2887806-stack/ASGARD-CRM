import { fetchBlobUrl } from '@/api/download';

export function threadFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1048576) return Math.round(bytes / 1024) + ' КБ';
  return (bytes / 1048576).toFixed(1) + ' МБ';
}

export function threadFileIcon(mime, name) {
  const m = String(mime || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(n)) return '🖼️';
  if (m.includes('pdf') || n.endsWith('.pdf')) return '📕';
  if (m.includes('word') || n.endsWith('.docx') || n.endsWith('.doc')) return '📘';
  if (m.includes('sheet') || m.includes('excel') || /\.(xlsx|xls|csv)$/i.test(n)) return '📗';
  return '📎';
}

export function threadPreviewUrl(tenderId, file) {
  if (file?.preview_url) return file.preview_url;
  if (file?.id) return `/api/tenders/${tenderId}/rp-review/files/${file.id}/preview`;
  return null;
}

export async function loadThreadFilePreview(tenderId, file) {
  const url = threadPreviewUrl(tenderId, file);
  if (!url) throw new Error('Нет ссылки на предпросмотр');
  const token = localStorage.getItem('asgard_token') || '';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error || `HTTP ${r.status}`);
  }
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('text/html')) {
    const html = await r.text();
    return { mode: 'html', html, downloadUrl: file.download_url || url };
  }
  const blob = await r.blob();
  const blobUrl = URL.createObjectURL(blob);
  return {
    mode: 'blob',
    blobUrl,
    mime: ct || file.mime_type || '',
    downloadUrl: file.download_url || url,
    revoke: () => URL.revokeObjectURL(blobUrl)
  };
}

export function loadLocalFilePreview(file) {
  const blobUrl = URL.createObjectURL(file);
  return {
    mode: 'blob',
    blobUrl,
    mime: file.type || '',
    downloadUrl: blobUrl,
    revoke: () => URL.revokeObjectURL(blobUrl)
  };
}
