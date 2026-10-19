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

  function _isOffice(url, mime) {
    const m = (mime || '').toLowerCase();
    const u = (url || '').toLowerCase();
    return m.includes('word') || m.includes('sheet') || m.includes('excel')
      || /\.docx?$/.test(u) || /\.xlsx?$/.test(u);
  }
  function _isZip(url, mime) {
    return (mime || '').includes('zip') || /\.zip$/i.test(url || '');
  }

  /** MIME по расширению — для файлов внутри архива (сервер не отдаёт mime). */
  function _mimeByExt(name) {
    const n = String(name || '').toLowerCase();
    if (/\.pdf$/.test(n)) return 'application/pdf';
    if (/\.(png)$/.test(n)) return 'image/png';
    if (/\.(jpe?g)$/.test(n)) return 'image/jpeg';
    if (/\.(webp)$/.test(n)) return 'image/webp';
    if (/\.(gif)$/.test(n)) return 'image/gif';
    if (/\.(docx?)$/.test(n)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (/\.(xlsx?)$/.test(n)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (/\.(txt|md|csv|log)$/.test(n)) return 'text/plain';
    if (/\.zip$/.test(n)) return 'application/zip';
    return 'application/octet-stream';
  }

  /** Иконка по расширению — как в проводнике Яндекс.Диска. */
  function _fileIcon(name) {
    const n = String(name || '').toLowerCase();
    if (/\.(png|jpe?g|webp|gif|bmp|svg|heic)$/.test(n)) return '🖼';
    if (/\.pdf$/.test(n)) return '📕';
    if (/\.(docx?|rtf|odt)$/.test(n)) return '📘';
    if (/\.(xlsx?|ods|csv)$/.test(n)) return '📗';
    if (/\.(pptx?|odp)$/.test(n)) return '📙';
    if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return '🗜';
    if (/\.(txt|md|log)$/.test(n)) return '📄';
    if (/\.(dwg|dxf)$/.test(n)) return '📐';
    return '📎';
  }

  async function open(opts) {
    _close();
    const title = opts.title || 'Документ';
    const fileUrl = opts.fileUrl || '';
    const downloadUrl = opts.downloadUrl || fileUrl;
    const mime = opts.mime || '';
    const htmlContent = opts.htmlContent || '';
    const archiveListUrl = opts.archiveListUrl || '';
    const archiveList = opts.archiveList || null;

    // D-290: как собрать URL файла ВНУТРИ архива. Раньше список был мёртвым:
    // имена видел, открыть — нельзя. Теперь клик по строке открывает вложенный
    // файл (в т.ч. DOCX/XLSX — с серверной конвертацией в PDF).
    const archiveEntryUrl = opts.archiveEntryUrl || (
      archiveListUrl ? String(archiveListUrl).replace(/\/archive-list(\?|$)/, '/archive-entry$1') : ''
    );

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

    /** Список файлов внутри архива: строка кликабельна → предпросмотр. */
    function renderArchiveEntries(entries, subtitle) {
      const rows = entries.map((e) => {
        const p = e.path || e.name || '';
        const sizeKb = e.size ? Math.max(1, Math.round(Number(e.size) / 1024)) + ' КБ' : '';
        const isDir = /\/$/.test(p);
        const openable = !isDir && !!archiveEntryUrl;
        return `<div class="asg-arc-row${isDir ? ' is-dir' : ''}${openable ? ' is-openable' : ''}"
                     ${openable ? `data-arc-path="${esc(p)}"` : ''}
                     title="${openable ? 'Открыть предпросмотр' : esc(p)}">
            <span class="asg-arc-ic">${isDir ? '📁' : _fileIcon(p)}</span>
            <span class="asg-arc-name">${esc(p)}</span>
            <span class="asg-arc-size">${esc(sizeKb)}</span>
          </div>`;
      }).join('');
      inner.innerHTML = `<div class="asg-arc-wrap">
        <div class="asg-arc-head">Содержимое архива (${entries.length})${subtitle ? ' · ' + esc(subtitle) : ''}</div>
        <div class="asg-arc-list">${rows || '<div class="asg-arc-empty">Архив пуст</div>'}</div>
        <div class="asg-arc-hint">Клик по файлу — предпросмотр. Office-документы конвертируются сервером.</div>
      </div>`;
    }

    if (htmlContent) {
      const iframe = document.createElement('iframe');
      iframe.title = title;
      iframe.sandbox = 'allow-same-origin';
      iframe.srcdoc = htmlContent;
      iframe.style.cssText = 'width:min(960px,92vw);height:75vh;border:0;border-radius:8px;background:#fff';
      inner.appendChild(iframe);
    } else if (_isImg(fileUrl, mime)) {
      inner.innerHTML = `<img src="${esc(fileUrl)}" alt="${esc(title)}" style="max-width:100%;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.4)"/>`;
    } else if (archiveList && Array.isArray(archiveList)) {
      renderArchiveEntries(archiveList);
    } else if (_isOffice(fileUrl, mime)) {
      const pdfUrl = fileUrl + (fileUrl.includes('?') ? '&' : '?') + 'format=pdf';
      inner.innerHTML = `<iframe src="${esc(pdfUrl)}" title="${esc(title)}" style="width:min(960px,92vw);height:78vh;border:0;border-radius:8px;background:#fff"></iframe>`;
    } else if (_isZip(fileUrl, mime) && archiveListUrl) {
      try {
        const r = await fetch(archiveListUrl, { credentials: 'include' });
        const j = await r.json().catch(() => ({}));
        const entries = Array.isArray(j.entries) ? j.entries : [];
        if (entries.length) renderArchiveEntries(entries);
        else {
          inner.innerHTML = `<div style="text-align:center;color:#ccc;padding:32px">Архив пуст или не читается.<br><a href="${esc(downloadUrl)}" download>Скачать архив</a></div>`;
        }
      } catch (_) {
        inner.innerHTML = `<div style="text-align:center;color:#ccc;padding:32px">Не удалось прочитать архив.<br><a href="${esc(downloadUrl)}" download>Скачать архив</a></div>`;
      }
    } else if (_isPdf(fileUrl, mime)) {
      inner.innerHTML = `<iframe src="${esc(fileUrl)}" title="${esc(title)}" style="width:min(960px,92vw);height:78vh;border:0;border-radius:8px;background:#fff"></iframe>`;
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

    // D-290: клик по файлу внутри архива — открываем его предпросмотр.
    // Office-файлы внутри архива просим у сервера уже сконвертированными (?format=pdf).
    if (archiveEntryUrl) {
      body.addEventListener('click', (e) => {
        const row = e.target.closest('[data-arc-path]');
        if (!row) return;
        const p = row.getAttribute('data-arc-path') || '';
        if (!p) return;
        const sep = archiveEntryUrl.includes('?') ? '&' : '?';
        const base = `${archiveEntryUrl}${sep}path=${encodeURIComponent(p)}`;
        const mimeByExt = _mimeByExt(p);
        const wantsPdf = _isOffice(p, mimeByExt);
        open({
          title: p.split('/').pop() || p,
          fileUrl: wantsPdf ? base + '&format=pdf' : base,
          mime: wantsPdf ? 'application/pdf' : mimeByExt,
          downloadUrl: base,
        });
      });
    }

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
