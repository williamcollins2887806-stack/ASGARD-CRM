/**
 * Read-only list of tender documents (ТЗ и прочее).
 */
import { useEffect, useState } from 'react';
import { loadTenderDocs } from '../api';
import { openProtected } from '@/api/download';
import { toast } from '@/modals/Notifications';

function docUrl(f) {
  if (f.file_url) return f.file_url;
  if (f.download_url) return f.download_url;
  if (f.filename) return '/api/files/download/' + encodeURIComponent(f.filename);
  return '';
}

export default function TenderDocsReadOnly({ tenderId, title = 'Документы ТО' }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenderId) return;
    setLoading(true);
    loadTenderDocs(tenderId)
      .then(setFiles)
      .catch((e) => toast.error('Документы: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, [tenderId]);

  return (
    <div className="tnd-docs-readonly" style={{ marginTop: 12 }}>
      <div className="muted fs-12" style={{ marginBottom: 6 }}>{title}</div>
      {loading ? (
        <div className="muted fs-12">⏳ Загружаем…</div>
      ) : !files.length ? (
        <div className="muted fs-12">Документов пока нет</div>
      ) : (
        <div className="col gap-4">
          {files.map((f) => {
            const label = f.original_name || f.filename || f.name || 'файл';
            const url = docUrl(f);
            return (
              <button
                key={f.id}
                type="button"
                className="m-btn ghost"
                style={{ justifyContent: 'flex-start', textAlign: 'left', fontSize: 13 }}
                onClick={() => url && openProtected(url, label).catch((e) => toast.error(String(e?.message || e)))}
              >
                📄 {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
