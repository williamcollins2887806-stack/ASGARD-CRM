import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { WidgetShell } from './WidgetShell';

/**
 * PhotosWidget — последние фото с полей (от рабочих PM-а)
 * API: GET /field/photos/recent?limit=12
 * Grid 3×4 миниатюр. Клик → lightbox.
 */
export default function PhotosWidget() {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/field/photos/recent?limit=12');
        const rows = Array.isArray(res) ? res : api.extractRows(res);
        setPhotos(rows);
      } catch {
        setPhotos([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  function formatTime(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${day}.${month} ${hh}:${mm}`;
    } catch {
      return '';
    }
  }

  return (
    <>
      <WidgetShell name="Фото с полей" icon="📸" loading={loading}>
        {photos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <span style={{ fontSize: 28 }}>📷</span>
            <span
              style={{
                fontSize: 13,
                color: 'var(--text-tertiary)',
                fontWeight: 500,
              }}
            >
              Нет фото с полей
            </span>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 6,
            }}
          >
            {photos.slice(0, 12).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setLightbox(p)}
                title={`${p.employee_fio || ''} · ${p.work_title || ''}`}
                style={{
                  position: 'relative',
                  aspectRatio: '1 / 1',
                  borderRadius: 10,
                  overflow: 'hidden',
                  border: '0.5px solid var(--border-norse)',
                  backgroundColor: 'var(--bg-surface-alt)',
                  padding: 0,
                  cursor: 'pointer',
                }}
              >
                <img
                  src={p.thumbnail_url || p.url}
                  alt={p.employee_fio || 'фото'}
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </WidgetShell>

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <img
            src={lightbox.url}
            alt={lightbox.employee_fio || 'фото'}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '100%',
              maxHeight: '80vh',
              objectFit: 'contain',
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              marginTop: 12,
              color: '#fff',
              textAlign: 'center',
              fontSize: 13,
              maxWidth: '90%',
            }}
          >
            <div style={{ fontWeight: 600 }}>{lightbox.employee_fio}</div>
            <div style={{ opacity: 0.8, marginTop: 2 }}>
              {lightbox.work_title} · {formatTime(lightbox.taken_at)}
            </div>
            <a
              href={lightbox.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'inline-block',
                marginTop: 10,
                color: 'var(--gold)',
                fontSize: 12,
                textDecoration: 'underline',
              }}
            >
              Открыть в новой вкладке
            </a>
          </div>
          <button
            type="button"
            onClick={() => setLightbox(null)}
            style={{
              position: 'absolute',
              top: 16,
              right: 16,
              background: 'rgba(255,255,255,0.1)',
              color: '#fff',
              border: '0.5px solid rgba(255,255,255,0.2)',
              borderRadius: 999,
              width: 40,
              height: 40,
              fontSize: 20,
              cursor: 'pointer',
            }}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
