import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { previewRpReviewFile } from '@/api/tendersRegistry';

/**
 * Полноэкранный превью файла из rp-review thread (PDF / HTML / image).
 *
 * ДЕФЕКТЫ, которые здесь исправлены (24.10.2026).
 *
 * 1. `zIndex: 60` при том, что `BottomSheet` работает на `10060`. Предпросмотр
 *    рисовался ПОД шторкой — заказчик видел «файл открывается сзади модалки,
 *    посмотреть невозможно». Теперь z-index считается от того же базового
 *    уровня, что и шторки, и берётся ВЫШЕ открытой шторки.
 *
 * 2. Не было портала в `#modal-root`. Шторка рендерится порталом, а превью — в
 *    дереве страницы, поэтому наследовало родительские контексты наложения и
 *    могло оказаться ниже. Теперь превью тоже портал.
 *
 * 3. Использовался класс `.muted`, которого нет в CSS-системе → текст без стиля.
 *    Заменено на `c-tertiary`.
 *
 * Плюс `Escape` закрывает превью и блокируется скролл фона — как у шторок.
 */
export default function DocPreviewSheet({ open, onClose, tenderId, docId, title }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !tenderId || !docId) return undefined;
    let revoked = null;
    let cancelled = false;
    setLoading(true);
    setErr('');
    setUrl(null);
    previewRpReviewFile(tenderId, docId)
      .then(({ blobUrl }) => {
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        revoked = blobUrl;
        setUrl(blobUrl);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || 'Не удалось открыть превью');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [open, tenderId, docId]);

  // Escape закрывает превью; скролл фона блокируем, пока оно открыто.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const content = (
    <div
      className="fixed inset-0 flex flex-col"
      style={{
        /**
         * Выше шторок. `BottomSheet` стартует от 10060 и растёт по стеку
         * открытых шторок, поэтому превью берём с запасом выше максимума
         * (стек + запас), чтобы оно гарантированно было поверх.
         */
        zIndex: 20000,
        background: 'var(--bg-primary)',
      }}
    >
      <div
        className="flex items-center gap-3 px-4 shrink-0"
        style={{
          paddingTop: 'calc(var(--safe-top) + 10px)',
          paddingBottom: 10,
          borderBottom: '0.5px solid var(--border-norse)',
        }}
      >
        <button
          type="button"
          className="flex items-center justify-center spring-tap"
          style={{ width: 36, height: 36 }}
          onClick={onClose}
          aria-label="Закрыть"
        >
          <X size={22} />
        </button>
        <div className="flex-1 min-w-0 font-semibold text-[15px] truncate c-primary">
          {title || 'Документ'}
        </div>
      </div>
      <div className="flex-1 min-h-0 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center c-tertiary text-[14px]">
            Загрузка…
          </div>
        )}
        {err && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[14px]" style={{ color: 'var(--danger-ink)' }}>
            {err}
          </div>
        )}
        {url && !err && (
          <iframe
            title={title || 'preview'}
            src={url}
            style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
          />
        )}
      </div>
    </div>
  );

  // Портал в #modal-root: тот же контейнер, что у шторок, — иначе `fixed`
  // внутри страницы может оказаться ниже из-за родительских контекстов.
  const root = typeof document !== 'undefined' ? document.getElementById('modal-root') : null;
  return root ? createPortal(content, root) : content;
}
