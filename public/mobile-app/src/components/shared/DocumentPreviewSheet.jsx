import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/api/client';
import { BottomSheet } from '@/components/shared/BottomSheet';
import {
  FileText, Download, ExternalLink, ZoomIn, ZoomOut, RotateCw,
  AlertCircle, RefreshCw,
} from 'lucide-react';

/**
 * DocumentPreviewSheet — универсальный просмотрщик документов (PDF и изображения).
 *
 * Зачем (20.10.2026): на мобильном у директора счета не раскрывались и файл
 * не показывался, хотя на десктопе превью есть. Компонент закрывает этот класс:
 * один вьюер для счетов, чеков, писем и вложений.
 *
 * Особенности, важные для iOS:
 *   • Файл тянется через fetch с Authorization и превращается в blob-URL.
 *     Вставлять src="/api/..." нельзя: браузер не отправит заголовок и получим 401.
 *   • Для PDF предпочитаем PNG-рендер первой страницы (эндпоинт .../preview),
 *     потому что iOS Safari плохо работает с blob-PDF в iframe; оригинал
 *     остаётся доступен кнопкой «Открыть»/«Скачать».
 *   • Пинч и двойной тап — зум; поворот для фото счетов, снятых боком.
 *
 * Props:
 *   open       — открыта ли шторка
 *   onClose    — закрыть
 *   title      — заголовок шторки (напр. «Счёт №123»)
 *   fileName   — имя файла для скачивания
 *   fileUrl    — URL оригинала (API или /uploads/...), требующий авторизации
 *   previewUrl — URL PNG-превью (если есть; иначе подставляется производный)
 *   subtitle   — пояснение под заголовком
 */
export function DocumentPreviewSheet({
  open,
  onClose,
  title = 'Документ',
  fileName = 'документ',
  fileUrl,
  previewUrl,
  subtitle,
}) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [contentType, setContentType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);
  /** Последний тап для детекта двойного. */
  const lastTap = useRef(0);
  const pinchStart = useRef(null);

  /** Тянет файл с токеном и отдаёт blob-URL. */
  const load = useCallback(async (url) => {
    if (!url) { setError('Файл не приложен'); return; }
    setLoading(true); setError('');
    setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    try {
      const token = api.getToken?.() || localStorage.getItem('asgard_token') || '';
      // Токен может быть уже в query (эндпоинты .../preview поддерживают ?token=).
      const full = /[?&]token=/.test(url) || !token
        ? url
        : url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
      const r = await fetch(full, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error(r.status === 403 ? 'Нет доступа к файлу' : 'HTTP ' + r.status);
      const blob = await r.blob();
      setContentType(r.headers.get('content-type') || blob.type || '');
      setBlobUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e.message || 'Не удалось открыть файл');
    } finally {
      setLoading(false);
    }
  }, []);

  // При открытии: сначала пробуем картинку-превью (лучше работает на iOS),
  // оригинал подгружаем по кнопке.
  useEffect(() => {
    if (!open) {
      setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
      setZoom(1); setRotate(0); setError('');
      return;
    }
    if (previewUrl) load(previewUrl);
    else if (fileUrl) load(fileUrl);
  }, [open, previewUrl, fileUrl, load]);

  // Чистим blob при размонтировании.
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  const isPdf = /pdf/i.test(contentType) || /\.pdf($|\?)/i.test(fileUrl || '');
  const isImg = !isPdf && (/image/i.test(contentType) || /\.(png|jpe?g|webp|gif|bmp)($|\?)/i.test(fileUrl || ''));

  const zoomIn = () => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(1, +(z - 0.25).toFixed(2)));
  const spin = () => setRotate((r) => (r + 90) % 360);

  /** Двойной тап — быстрое увеличение/сброс. */
  const onImageTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) setZoom((z) => (z > 1 ? 1 : 2));
    lastTap.current = now;
  };

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      pinchStart.current = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom };
    }
  };
  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinchStart.current) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const next = Math.min(4, Math.max(1, +(pinchStart.current.zoom * (d / pinchStart.current.d)).toFixed(2)));
      setZoom(next);
    }
  };
  const onTouchEnd = () => { pinchStart.current = null; };

  /** Открыть оригинал в новой вкладке (blob, без обращения к сети). */
  const openExternal = async () => {
    if (!fileUrl) return;
    try {
      const token = api.getToken?.() || '';
      const r = await fetch(fileUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const u = URL.createObjectURL(blob);
      window.open(u, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(u), 120000);
    } catch (e) { setError(e.message || 'Не удалось открыть'); }
  };

  /** Скачать оригинал в память устройства. */
  const download = async () => {
    if (!fileUrl) return;
    try {
      const token = api.getToken?.() || '';
      const r = await fetch(fileUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u; a.download = fileName || 'документ';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 5000);
    } catch (e) { setError(e.message || 'Не удалось скачать'); }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={title} maxHeight="92vh">
      <div className="flex flex-col gap-3 pb-2">
        {subtitle && (
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{subtitle}</p>
        )}

        {/* Панель управления */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {isImg && (
            <>
              <ToolBtn onClick={zoomOut} disabled={zoom <= 1} label="Уменьшить"><ZoomOut size={16} /></ToolBtn>
              <ToolBtn onClick={zoomIn} disabled={zoom >= 4} label="Увеличить"><ZoomIn size={16} /></ToolBtn>
              <ToolBtn onClick={spin} label="Повернуть"><RotateCw size={16} /></ToolBtn>
              <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', minWidth: 40, textAlign: 'center' }}>
                {Math.round(zoom * 100)}%
              </span>
            </>
          )}
          {fileUrl && (
            <>
              <ToolBtn onClick={openExternal} label="Открыть в новой вкладке"><ExternalLink size={16} /></ToolBtn>
              <ToolBtn onClick={download} label="Скачать"><Download size={16} /></ToolBtn>
            </>
          )}
        </div>

        {/* Область просмотра */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{
            position: 'relative',
            borderRadius: 14,
            overflow: 'auto',
            background: 'var(--bg-surface-alt)',
            border: '0.5px solid var(--border-norse)',
            minHeight: 260,
            maxHeight: '58vh',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', gap: 8 }}>
              <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
                <RefreshCw size={20} className="animate-spin" style={{ margin: '0 auto 6px' }} />
                Загрузка…
              </div>
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--danger-ink)', fontSize: 13 }}>
              <AlertCircle size={22} style={{ margin: '0 auto 8px' }} />
              {error}
            </div>
          )}
          {!loading && !error && blobUrl && (
            isPdf ? (
              // PDF: сначала PNG-превью (blob). Оригинал — кнопкой «Открыть».
              <iframe
                title={title}
                src={blobUrl}
                style={{ width: '100%', height: '56vh', border: 0, background: '#fff' }}
              />
            ) : (
              <img
                src={blobUrl}
                alt={title}
                onClick={onImageTap}
                style={{
                  maxWidth: '100%',
                  transform: `scale(${zoom}) rotate(${rotate}deg)`,
                  transformOrigin: 'top center',
                  transition: 'transform var(--motion-fast) var(--ease-smooth)',
                  display: 'block',
                  background: '#fff',
                }}
              />
            )
          )}
          {!loading && !error && !blobUrl && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
              <FileText size={24} style={{ margin: '0 auto 8px' }} />
              Файл не приложен
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

/** Кнопка панели инструментов вьюера. */
function ToolBtn({ onClick, disabled, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="spring-tap"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 34, height: 34, borderRadius: 10,
        background: 'var(--bg-elevated)',
        border: '0.5px solid var(--border-norse)',
        color: disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default DocumentPreviewSheet;
