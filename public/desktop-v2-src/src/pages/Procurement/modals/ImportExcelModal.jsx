/**
 * Импорт позиций из Excel-шаблона.
 *
 * Endpoint: POST /api/procurement/:id/items/import-excel  (multipart, file)
 *
 * Сервер ждёт ровно формат шаблона (template/excel):
 *   - 3 строки шапки (заголовок + пустая + колонки)
 *   - колонки: №, Наименование, Артикул, Ед.изм., Кол-во, Примечание
 *
 * Источник: «📥 Импорт Excel» в openDetail (vanilla).
 */
import { useState, useRef } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { importExcelItems } from '../api';
import { validateFile, MAX_FILE_SIZE } from '@/api/upload';
import { openProtected } from '@/api/download';

/** Открыть модалку импорта Excel позиций. */
export function openImportExcelModal(open, procId, onDone) {
  open(<ImportExcelModal procId={procId} onDone={onDone} />);
}

export function ImportExcelModal({ procId, onDone }) {
  const { close } = useModal();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // G-5: размер/тип Excel-файла.
    try {
      validateFile(file, { maxSize: MAX_FILE_SIZE, accept: '.xlsx,.xls' });
    } catch (vErr) {
      toast.error(vErr?.message || 'Файл не подходит'); return;
    }
    setBusy(true);
    try {
      const d = await importExcelItems(procId, file);
      toast.success(`Импортировано: ${d.count} позиций`);
      onDone?.();
      close();
    } catch (err) { toast.error(err?.message || 'Ошибка'); setBusy(false); }
  };

  return (
    <MCard>
      <MHead icon="📥" title="Импорт Excel" onClose={close} />
      <MBody>
        <div className="proc-imp-intro">
          Загрузите Excel-файл с позициями. Формат по шаблону системы:
        </div>
        <div className="proc-imp-spec">
          <div><b>Колонки:</b> №, Наименование, Артикул, Ед.изм., Кол-во, Примечание</div>
          <div className="proc-imp-spec-row">Первые 3 строки — заголовок (пропускаются)</div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="proc-inv-hidden-file"
          onChange={onFile}
        />
        <div className="proc-imp-actions">
          <Btn
            variant="ghost"
            onClick={() =>
              openProtected('/api/procurement/template/excel', 'procurement_template.xlsx')
                .catch((e) => toast.error('Шаблон: ' + (e?.message || e)))
            }
          >📄 Скачать шаблон</Btn>
          <Btn
            variant="primary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? '⏳ Импорт…' : '📎 Выбрать файл'}
          </Btn>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={close} disabled={busy}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
