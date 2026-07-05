import { useState, useRef } from 'react';
import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot, Btn } from './parts';
import { toast } from './Notifications';

/**
 * Предпросмотр документа/изображения с zoom и копированием текста.
 */
export function FilePreviewModal({
  title,
  subtitle,
  fileUrl,
  mime = 'image',
  downloadUrl,
  onClose
}) {
  const { close } = useModal();
  const [zoom, setZoom] = useState(1);
  const textRef = useRef(null);
  const handleClose = () => { onClose?.(); close(); };
  const isImg = mime.startsWith('image') || /\.(png|jpe?g|webp|gif|svg)$/i.test(fileUrl || '');
  const isPdf = mime.includes('pdf') || /\.pdf$/i.test(fileUrl || '');
  const isText = mime.startsWith('text') || /\.(txt|md|csv)$/i.test(fileUrl || '');

  const onCopy = async () => {
    try {
      let text = '';
      if (textRef.current) text = textRef.current.value || '';
      else if (isPdf) text = 'PDF: используйте скачивание для полного текста';
      await navigator.clipboard.writeText(text || title || '');
      toast.success('Скопировано в буфер обмена');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  return (
    <MCard>
      <MHead icon="📄" title={title} subtitle={subtitle} accent="info" onClose={handleClose} />
      <MBody style={{ padding: 0, background: 'var(--inner-bg)' }}>
        <div className="row gap-6 p-8" style={{ justifyContent: 'flex-end', borderBottom: '1px solid var(--brd-1)' }}>
          <Btn variant="ghost" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}>−</Btn>
          <span className="fs-12 c-t3">{Math.round(zoom * 100)}%</span>
          <Btn variant="ghost" onClick={() => setZoom((z) => Math.min(3, z + 0.15))}>+</Btn>
          <Btn variant="ghost" onClick={onCopy}>📋 Копировать</Btn>
        </div>
        <div style={{ display: 'grid', placeItems: 'center', minHeight: 320, padding: 16, overflow: 'auto' }}>
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}>
            {isImg ? (
              <img src={fileUrl} alt={title || subtitle || 'Предпросмотр файла'} style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 8, boxShadow: 'var(--sh-md)' }} />
            ) : isPdf ? (
              <iframe src={fileUrl} title={'Предпросмотр PDF: ' + (title || 'документ')} style={{ width: 'min(960px, 92vw)', height: '70vh', border: 0, borderRadius: 8, background: 'white' }} />
            ) : isText ? (
              <iframe src={fileUrl} title={title} style={{ width: 'min(800px, 92vw)', height: '60vh', border: 0, borderRadius: 8, background: 'white' }} />
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--t-3)' }}>
                <div className="fs-48 mb-12">📎</div>
                Предпросмотр недоступен.<br />Скачайте файл, чтобы открыть.
              </div>
            )}
          </div>
        </div>
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={handleClose}>Закрыть</Btn>
        {downloadUrl && (
          <a href={downloadUrl} download target="_blank" rel="noreferrer" className="m-btn primary u-no-decor">
            ⬇ Скачать
          </a>
        )}
      </MFoot>
    </MCard>
  );
}
