import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot, Btn } from './parts';

/**
 * Предпросмотр документа/изображения.
 * Поддерживает: image / pdf-iframe / text.
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
  const handleClose = () => { onClose?.(); close(); };
  const isImg = mime.startsWith('image') || /\.(png|jpe?g|webp|gif|svg)$/i.test(fileUrl || '');
  const isPdf = mime.includes('pdf') || /\.pdf$/i.test(fileUrl || '');

  return (
    <MCard>
      <MHead icon="📄" title={title} subtitle={subtitle} accent="info" onClose={handleClose} />
      <MBody style={{ padding: 0, background: 'var(--inner-bg)' }}>
        <div style={{ display: 'grid', placeItems: 'center', minHeight: 320, padding: 16 }}>
          {isImg ? (
            /* G-1: alt с осмысленным текстом — это содержательное изображение, а не декорация */
            <img src={fileUrl} alt={title || subtitle || 'Предпросмотр файла'} style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 8, boxShadow: 'var(--sh-md)' }} />
          ) : isPdf ? (
            <iframe src={fileUrl} title={'Предпросмотр PDF: ' + (title || 'документ')} style={{ width: '100%', height: '70vh', border: 0, borderRadius: 8, background: 'white' }} />
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--t-3)' }}>
              <div className="fs-48 mb-12">📎</div>
              Предпросмотр недоступен.<br />Скачайте файл, чтобы открыть.
            </div>
          )}
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
