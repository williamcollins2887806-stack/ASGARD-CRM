import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { previewRpReviewFile } from '@/api/tendersRegistry';

/**
 * Полноэкранный превью файла из rp-review thread (PDF / HTML / image).
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 flex flex-col" style={{ zIndex: 60, background: 'var(--bg-primary)' }}>
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
          <div className="absolute inset-0 flex items-center justify-center muted text-[14px]">
            Загрузка…
          </div>
        )}
        {err && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[14px]" style={{ color: 'var(--danger)' }}>
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
}
