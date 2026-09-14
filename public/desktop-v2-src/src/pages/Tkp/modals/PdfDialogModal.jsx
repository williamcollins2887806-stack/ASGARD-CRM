/**
 * PdfDialogModal — PDF ± печать + Word.
 * Источник: showPdfDialog в tkp-page.js.
 */
import { useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { Checkbox } from '@/inputs/Inputs';
import { toast } from '@/modals/Notifications';
import { openPdf, openDocx } from '../api';

export function PdfDialogModal({ tkp }) {
  const { close } = useModal();
  const [signature, setSignature] = useState(true);
  const [stamp, setStamp] = useState(true);
  const [busy, setBusy] = useState(false);

  const handlePdf = async (forceNoStamp = false) => {
    setBusy(true);
    try {
      await openPdf(tkp.id, { signature, stamp: forceNoStamp ? false : stamp });
      close();
    } catch (e) {
      toast.error('PDF: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const handleDocx = async () => {
    setBusy(true);
    try {
      await openDocx(tkp.id);
      close();
    } catch (e) {
      toast.error('Word: ' + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MCard className="modal-sm">
      <MHead icon="📄" title="Выгрузка" subtitle={`ТКП #${tkp.id}`} onClose={close} />
      <MBody>
        <div className="col gap-10">
          <Checkbox checked={signature} onChange={setSignature} label="Включить подпись" />
          <Checkbox checked={stamp} onChange={setStamp} label="Включить печать организации" />
          <div style={{ marginTop: 6, padding: 10, background: 'var(--inner-bg)', borderRadius: 'var(--r-sm)', fontSize: 12.5, color: 'var(--t-2)' }}>
            PDF с печатью / без печати, либо Word (.docx).
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn onClick={close}>Отмена</Btn>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn disabled={busy} onClick={() => handlePdf(true)}>PDF без печати</Btn>
          <Btn disabled={busy} onClick={handleDocx}>Word</Btn>
          <Btn variant="primary" onClick={() => handlePdf(false)} disabled={busy}>{busy ? '…' : 'PDF'}</Btn>
        </div>
      </MFoot>
    </MCard>
  );
}
