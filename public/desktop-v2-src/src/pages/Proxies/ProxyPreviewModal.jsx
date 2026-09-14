/**
 * Предпросмотр доверенности: PDF в iframe + скачать Word / PDF.
 */
import { useEffect, useState } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';
import { previewDocxBlob, previewPdfBlob, downloadBlobFile } from './api';

export function ProxyPreviewModal({ form, number }) {
  const { close } = useModal();
  const [busy, setBusy] = useState(true);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let revoked = false;
    let url = null;
    (async () => {
      setBusy(true);
      setError('');
      try {
        const blob = await previewPdfBlob(form);
        if (revoked) return;
        url = URL.createObjectURL(blob);
        setPdfUrl(url);
      } catch (e) {
        if (!revoked) setError(String(e?.message || e));
      } finally {
        if (!revoked) setBusy(false);
      }
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [form]);

  const downloadWord = async () => {
    try {
      const blob = await previewDocxBlob(form);
      downloadBlobFile(blob, `Доверенность_${number || form?.number || 'draft'}.docx`);
    } catch (e) {
      toast.error('Word: ' + (e?.message || e));
    }
  };

  const downloadPdf = async () => {
    try {
      if (pdfUrl) {
        const a = document.createElement('a');
        a.href = pdfUrl;
        a.download = `Доверенность_${number || form?.number || 'draft'}.pdf`;
        a.click();
        return;
      }
      const blob = await previewPdfBlob(form);
      downloadBlobFile(blob, `Доверенность_${number || form?.number || 'draft'}.pdf`);
    } catch (e) {
      toast.error('PDF: ' + (e?.message || e));
    }
  };

  return (
    <MCard className="modal-wide">
      <MHead
        title="Предпросмотр доверенности"
        subtitle={number || form?.number || 'черновик'}
        accent="info"
        onClose={close}
      />
      <MBody>
        {busy && <div className="prx-dim" style={{ padding: 24, textAlign: 'center' }}>Формируем PDF…</div>}
        {!busy && error && (
          <div style={{ padding: 16 }}>
            <div style={{ color: 'var(--danger-t, var(--t-1))', marginBottom: 12 }}>{error}</div>
            <Btn variant="ghost" onClick={downloadWord}>Скачать Word без PDF</Btn>
          </div>
        )}
        {!busy && pdfUrl && (
          <iframe
            title="proxy-preview-pdf"
            src={pdfUrl}
            style={{
              width: '100%',
              height: 'min(72vh, 820px)',
              border: '1px solid var(--brd-2)',
              borderRadius: 'var(--r-sm, 8px)',
              background: 'var(--inner-bg)'
            }}
          />
        )}
      </MBody>
      <MFoot align="spread">
        <div className="u-flex gap-8">
          <Btn variant="ghost" onClick={downloadWord} disabled={busy}>Скачать Word</Btn>
          <Btn variant="ghost" onClick={downloadPdf} disabled={busy || (!pdfUrl && !!error)}>Скачать PDF</Btn>
        </div>
        <Btn onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
