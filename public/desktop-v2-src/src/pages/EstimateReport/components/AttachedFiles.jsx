/**
 * AttachedFiles — секция Прикреплённых документов с предпросмотром.
 * Источник: vanilla estimate_report.js:478-580 (renderFiles + bindFilePreview).
 * Превью через FilePreviewModal: <img> для image/*, <iframe> для PDF.
 * Endpoint: GET /api/files/download/:filename (через fileDownloadUrl).
 */
import { useModal, FilePreviewModal } from '@/modals';
import { fileDownloadUrl } from '../api';

const PREVIEWABLE_MIME = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'
];

function fileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' Б';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' КБ';
  return (bytes / 1048576).toFixed(1) + ' МБ';
}

function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('word')) return '📘';
  if (mime.includes('sheet') || mime.includes('excel')) return '📗';
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z')) return '🗜️';
  return '📄';
}

function isPreviewable(mime) {
  if (!mime) return false;
  return PREVIEWABLE_MIME.includes(mime);
}

export default function AttachedFiles({ docs }) {
  const modal = useModal();
  if (!docs || !docs.length) return null;

  const openPreview = (doc, url, name) => {
    modal.open(
      <FilePreviewModal
        title={name}
        subtitle={fileSize(doc.size) || doc.mime_type || ''}
        fileUrl={url}
        mime={doc.mime_type || ''}
        downloadUrl={url}
      />,
      { size: 'wide' }
    );
  };

  return (
    <div className="card er-files-card">
      <div className="er-files-title">📎 Прикреплённые документы ({docs.length})</div>
      <div className="col gap-6">
        {docs.map((d) => {
          const url = fileDownloadUrl(d);
          const name = d.original_name || d.filename || 'Файл';
          const size = fileSize(d.size);
          const preview = isPreviewable(d.mime_type);
          return (
            <div key={d.id || d.filename || name} className="er-file-row">
              <span className="er-file-icon" aria-hidden="true">{fileIcon(d.mime_type)}</span>
              <div className="flex-1 ellipsis-wrap">
                <div className="ellipsis">{name}</div>
                {size && <div className="er-file-size">{size}</div>}
              </div>
              {preview && (
                <button
                  type="button"
                  className="er-file-link"
                  onClick={() => openPreview(d, url, name)}
                >👁 Просмотр</button>
              )}
              <a href={url} download={name} className="er-file-link" target="_blank" rel="noreferrer">⬇ Скачать</a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
