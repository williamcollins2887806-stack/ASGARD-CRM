/**
 * ArchiveErrorModal — структурированный показ ошибки загрузки тендерного архива.
 *
 * D-59 в `tests/reports/_DIFF-LEDGER.md`:
 *   Источник — vanilla `tenders.js:2152 showArchiveError(errObj)`.
 *   Бэкенд `/api/tenders/:id/upload-archive` отдаёт `{ error: { code, message, hint } }`
 *   при PASSWORD_PROTECTED/CORRUPTED/UNSUPPORTED_FORMAT/EMPTY/TOO_MANY/BOMB/NO_TOOL/
 *   TIMEOUT/NOT_ARCHIVE/FILE_TOO_LARGE/UPLOAD_FAILED/IO_ERROR/NETWORK и др.
 *   До этого фикса React показывал плоский toast → пользователь не видел hint и code.
 *
 * Props:
 *   errObj = { message: string, hint?: string, code?: string }
 *
 * Все цвета — через CSS-токены темы (`--err`, `--inner-bg`, `--text`, `--text-muted`,
 * `--border`, `--gold`) — color-gate не сработает. Никакого `#hex` в JSX.
 */
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';

// Иконки по коду — паритет с vanilla 2154 (`icons` mapping).
const CODE_ICONS = {
  PASSWORD_PROTECTED: '🔒',
  CORRUPTED:          '⚠️',
  UNSUPPORTED_FORMAT: '❓',
  EMPTY:              '📭',
  EMPTY_FILE:         '📭',
  TOO_MANY:           '📚',
  BOMB:               '💣',
  NO_TOOL:            '🛠',
  TIMEOUT:            '⏱',
  NOT_ARCHIVE:        '📄',
  FILE_TOO_LARGE:     '⚖️',
  UPLOAD_FAILED:      '⬆️',
  IO_ERROR:           '💾',
  NETWORK:            '🌐'
};

export function ArchiveErrorModal({ errObj }) {
  const { close } = useModal();
  const code = errObj?.code || 'ERR';
  const icon = CODE_ICONS[code] || '❌';
  const message = errObj?.message || 'Не удалось обработать архив';
  const hint = errObj?.hint || '';

  return (
    <MCard className="frame-inside">
      <MHead
        icon="📦"
        title="Ошибка загрузки архива"
        accent="danger"
        onClose={close}
      />
      <MBody>
        <div
          style={{
            display: 'flex',
            gap: 14,
            alignItems: 'flex-start',
            padding: '14px 16px',
            background: 'var(--inner-bg)',
            border: '1px solid var(--border)',
            borderLeft: '4px solid var(--err)',
            borderRadius: 8
          }}
        >
          <div style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }} aria-hidden="true">
            {icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 15,
                color: 'var(--err)',
                marginBottom: hint || code ? 8 : 0,
                lineHeight: 1.4
              }}
              role="alert"
            >
              {message}
            </div>
            {hint && (
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--text-muted)',
                  lineHeight: 1.5,
                  marginBottom: code ? 10 : 0
                }}
              >
                <span aria-hidden="true">💡 </span>{hint}
              </div>
            )}
            {code && (
              <div
                style={{
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  color: 'var(--text-muted)',
                  letterSpacing: '0.04em'
                }}
              >
                CODE: {code}
              </div>
            )}
          </div>
        </div>
      </MBody>
      <MFoot>
        <Btn variant="primary" onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}

export default ArchiveErrorModal;
