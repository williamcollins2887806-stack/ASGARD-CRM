/**
 * PdfDialogModal — настройки PDF (подпись / печать) + скачать.
 * Источник: showPdfDialog в tkp_page.js.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Checkbox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { openPdf } from '../api';

export function PdfDialogModal({ tkp }) {
  const { close } = useModal();
  const [signature, setSignature] = useState(true);
  const [stamp, setStamp] = useState(true);
  const [busy, setBusy] = useState(false);

  // openPdf — blob+Authorization header (без токена в URL, см. src/api/download.js)
  const handle = async () => {
    setBusy(true);
    try {
      await openPdf(tkp.id, { signature, stamp });
      close();
    } catch (e) {
      toast.error('PDF: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="📄" title="Скачать PDF" subtitle={`ТКП #${tkp.id}`} onClose={close} />
      <MBody>
        <div className="col gap-10">
          <Checkbox checked={signature} onChange={setSignature} label="Включить подпись" />
          <Checkbox checked={stamp}     onChange={setStamp}     label="Включить печать организации" />

          <div style={{ marginTop: 6, padding: 10, background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)', fontSize: 12.5, color: 'var(--t-2)' }}>
            💡 При снятых обоих галочках получится «чистый» PDF без подписи и печати — для редактирования.
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <Btn variant="primary" onClick={handle} disabled={busy}>{busy ? '⏳ Загружаем…' : '📥 Скачать / открыть'}</Btn>
      </MFoot>
    </MCard>
  );
}
