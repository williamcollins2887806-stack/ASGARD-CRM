/**
 * Protected file download helpers (vanilla CRM).
 * Mobile browsers don't send Authorization on <a href> — append ?token= or use fetch+Blob.
 */
window.AsgardFileDownload = (function () {
  function token() {
    try { return localStorage.getItem('asgard_token') || ''; } catch (_) { return ''; }
  }

  function fileDownloadUrl(pathOrDoc) {
    let url = '';
    if (typeof pathOrDoc === 'string') {
      url = pathOrDoc;
    } else if (pathOrDoc) {
      url = pathOrDoc.file_url || pathOrDoc.download_url || '';
      if (!url && pathOrDoc.filename) {
        url = '/api/files/download/' + encodeURIComponent(pathOrDoc.filename);
      }
    }
    if (!url) return '';
    if (url.startsWith('/api/files/download/') || url.startsWith('/api/files/preview/')) {
      const t = token();
      if (t && !/[?&]token=/.test(url)) {
        url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
      }
    }
    return url;
  }

  async function openProtected(url, filename) {
    const full = fileDownloadUrl(url);
    if (!full) throw new Error('Нет URL файла');
    const t = token();
    const r = await fetch(full.split('?')[0] + (full.includes('?') ? full.slice(full.indexOf('?')) : ''), {
      headers: t ? { Authorization: 'Bearer ' + t } : {},
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error('HTTP ' + r.status + (txt ? ': ' + txt.slice(0, 120) : ''));
    }
    const blob = await r.blob();
    const blobUrl = URL.createObjectURL(blob);
    const w = window.open(blobUrl, '_blank', 'noopener,noreferrer');
    if (!w) {
      const a = document.createElement('a');
      a.href = blobUrl;
      if (filename) a.download = filename;
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }

  return { token, fileDownloadUrl, openProtected };
})();
