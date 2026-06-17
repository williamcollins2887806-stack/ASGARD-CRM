/**
 * TenderDocsModal — лёгкая модалка «Комплект документов тендера».
 * Источник: vanilla pm_calcs.js:828-859 (openDocsPack fallback + список файлов).
 *
 * Открывается из строки таблицы PmCalcs (кнопка «Комплект»).
 * Показывает /api/files/?tender_id и ссылку на purchase_url (если есть).
 */
import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { openProtected } from '@/api/download';

export function TenderDocsModal({ tenderId, purchaseUrl }) {
  const { close } = useModal();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api(`/api/files/?tender_id=${tenderId}`)
      .then((d) => setFiles(d.files || d.items || []))
      .catch((e) => toast.error('Ошибка загрузки файлов: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, [tenderId]);

  return (
    <MCard>
      <MHead
        icon="📁"
        title={`Комплект документов · Тендер #${tenderId}`}
        accent="default"
        onClose={() => close()}
      />
      <MBody>
        {loading ? (
          <div className="p-24 t-center c-t3">⏳ Загружаем…</div>
        ) : files.length === 0 ? (
          <div className="p-24 t-center c-t3">Документов пока нет</div>
        ) : (
          <div className="col gap-6">
            {files.map((f) => {
              const fname = encodeURIComponent(f.filename || '');
              const label = f.original_name || f.filename || f.name || `Файл #${f.id}`;
              return (
                <button
                  type="button"
                  key={f.id}
                  className="m-btn ghost"
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  onClick={() => openProtected('/api/files/download/' + fname, label).catch((e) => toast.error('Файл: ' + (e?.message || e)))}
                >
                  📄 {label}
                  {f.type && <span className="c-t3" style={{ marginLeft: 8 }}>· {f.type}</span>}
                </button>
              );
            })}
          </div>
        )}

        {purchaseUrl && (
          <div className="mt-12 p-10 bg-inner r-md">
            <div className="c-t3 fs-12 mb-4">Площадка закупки:</div>
            <a
              href={purchaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="c-gold"
              style={{ wordBreak: 'break-all' }}
            >
              🌐 {purchaseUrl}
            </a>
          </div>
        )}
      </MBody>
      <MFoot>
        <Btn onClick={() => close()}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
