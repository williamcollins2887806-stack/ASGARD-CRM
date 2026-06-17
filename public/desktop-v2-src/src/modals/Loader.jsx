import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot, Btn } from './parts';

/**
 * Loader-модалка. progress (0..100) опционально.
 */
export function LoaderModal({
  title = 'Загрузка…',
  message,
  progress,
  cancelable = false,
  onCancel
}) {
  const { close } = useModal();
  const finite = typeof progress === 'number';

  return (
    <MCard aria-busy="true">
      <MHead icon="⏳" title={title} accent="info" onClose={null} />
      <MBody>
        <div className="m-loader" role="status" aria-live="polite">
          {!finite && <div className="ring" aria-hidden="true" />}
          {finite && (
            <>
              <div
                style={{ fontSize: 40, fontWeight: 900, color: 'var(--gold)' }}
                role="progressbar"
                aria-valuenow={Math.round(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={title}
              >{Math.round(progress)}%</div>
              <div className="m-progress-row" aria-hidden="true"><div className="m-progress-fill" style={{ width: progress + '%' }} /></div>
            </>
          )}
          {message && <div className="t mt-14" >{message}</div>}
          {/* sr-only — гарантированный announce даже если визуальный текст не озвучится */}
          <span className="sr-only">{title}{message ? '. ' + message : ''}{finite ? `. ${Math.round(progress)} процентов` : ''}</span>
        </div>
      </MBody>
      {cancelable && (
        <MFoot align="center">
          <Btn variant="ghost" onClick={() => { onCancel?.(); close(); }}>Прервать</Btn>
        </MFoot>
      )}
    </MCard>
  );
}
