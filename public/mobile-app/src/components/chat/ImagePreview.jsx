import { useState } from 'react';
import { X } from 'lucide-react';

/**
 * ImagePreview — фото в бабле + fullscreen просмотр
 */
export function ImagePreview({ src, alt }) {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <>
      <img
        src={src}
        alt={alt || 'Фото'}
        loading="lazy"
        onClick={() => setFullscreen(true)}
        className="rounded-xl cursor-pointer"
        style={{
          maxWidth: 240,
          maxHeight: 300,
          objectFit: 'cover',
        }}
      />

      {fullscreen && (
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{
            zIndex: 60,
            background: 'rgba(0,0,0,0.92)',
            animation: 'fadeInUp 200ms ease forwards',
          }}
          onClick={() => setFullscreen(false)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full"
            style={{
              top: 'calc(var(--safe-top) + 12px)',
              background: 'rgba(255,255,255,0.1)',
              color: '#fff',
            }}
            onClick={() => setFullscreen(false)}
          >
            <X size={24} />
          </button>
          <img
            src={src}
            alt={alt || 'Фото'}
            className="max-w-[95vw] max-h-[85vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
