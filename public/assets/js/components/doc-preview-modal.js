/**
 * Универсальный предпросмотр документов (vanilla).
 * window.AsgardDocPreview.open({ title, fileUrl, mime, downloadUrl })
 */
(function () {
  'use strict';

  let _zoom = 1;
  let _overlay = null;

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function _isImg(url, mime) {
    return (mime || '').startsWith('image') || /\.(png|jpe?g|webp|gif|svg)$/i.test(url || '');
  }
  function _isPdf(url, mime) {
    return (mime || '').includes('pdf') || /\.pdf$/i.test(url || '');
  }
  function _isText(url, mime) {
    return (mime || '').startsWith('text') || /\.(txt|md|csv)$/i.test(url || '');
  }

  async function _loadText(url) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      return await r.text();
    } catch {
      return '';
    }
  }

  function _close() {
    if (_overlay) {
      try { _overlay.remove(); } catch (_) {}
      _overlay = null;
    }
    _zoom = 1;
    document.removeEventListener('keydown', _onKey);
  }

  function _onKey(e) {
    if (e.key === 'Escape') _close();
  }

  async function open(opts) {
    _close();
    const title = opts.title || 'Документ';
    const fileUrl = opts.fileUrl || '';
    const downloadUrl = opts.downloadUrl || fileUrl;
    const mime = opts.mime || '';

    _overlay = document.createElement('div');
    _overlay.className = 'asg-doc-preview-overlay';
    _overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;flex-direction:column';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 16px;background:var(--bg-elevated,#1e1e1e);color:var(--text-primary,#fff)';
    head.innerHTML = `
      <div style="flex:1;font-weight:700">${esc(title)}</div>
      <button type="button" class="btn ghost" data-act="zoom-out" title="Уменьшить">−</button>
      <button type="button" class="btn ghost" data-act="zoom-in" title="Увеличить">+</button>
      <button type="button" class="btn ghost" data-act="copy" title="Копировать текст">📋</button>
      <a class="btn primary" href="${esc(downloadUrl)}" download target="_blank" rel="noreferrer">⬇ Скачать</a>
      <button type="button" class="btn ghost" data-act="close">✕</button>
    `;

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow:auto;display:grid;place-items:center;padding:16px';
    const inner = document.createElement('div');
    inner.className = 'asg-doc-preview-inner';
    inner.style.transformOrigin = 'center center';

    if (_isImg(fileUrl, mime)) {
      inner.innerHTML = `<img src="${esc(fileUrl)}" alt="${esc(title)}" style="max-width:100%;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.4)"/>`;
    } else if (_isPdf(fileUrl, mime)) {
      inner.innerHTML = `<iframe src="${esc(fileUrl)}" title="${esc(title)}" style="width:min(960px,92vw);height:75vh;border:0;border-radius:8px;background:#fff"></iframe>`;
    } else if (_isText(fileUrl, mime)) {
      const txt = await _loadText(fileUrl);
      inner.innerHTML = `<textarea readonly style="width:min(800px,92vw);height:60vh;padding:12px;font-family:monospace;font-size:13px">${esc(txt)}</textarea>`;
    } else {
      inner.innerHTML = `<div style="text-align:center;color:#ccc;padding:32px">Предпросмотр недоступен.<br>Скачайте файл.</div>`;
    }

    body.appendChild(inner);
    _overlay.appendChild(head);
    _overlay.appendChild(body);
    document.body.appendChild(_overlay);

    function _applyZoom() {
      inner.style.transform = `scale(${_zoom})`;
    }

    head.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'close') return _close();
      if (act === 'zoom-in') { _zoom = Math.min(3, _zoom + 0.15); _applyZoom(); }
      if (act === 'zoom-out') { _zoom = Math.max(0.4, _zoom - 0.15); _applyZoom(); }
      if (act === 'copy') {
        const ta = inner.querySelector('textarea');
        let text = ta ? ta.value : '';
        if (!text && _isPdf(fileUrl, mime)) {
          text = 'Копирование текста из PDF в браузере ограничено — скачайте файл.';
        }
        try {
          await navigator.clipboard.writeText(text || title);
          if (window.toast) window.toast('Скопировано', 'Текст в буфере обмена', 'ok');
        } catch (_) {}
      }
    });

    document.addEventListener('keydown', _onKey);
  }

  window.AsgardDocPreview = { open, close: _close };
})();
