/**
 * Модалка выбора типа отметки для ячейки табеля.
 * Аналог dropdown'а в vanilla `showEditDropdown()`.
 */
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { CELL_TYPES } from './api';

export function TypePickerModal({ _employeeId, fio, date, workId, editableTypes, onPick }) {
  const { close } = useModal();

  return (
    <MCard>
      <MHead icon="📋" title="Отметка табеля" onClose={() => close()} />
      <MBody>
        <div style={{ fontSize: 13, color: 'var(--t-2)', marginBottom: 4 }}>
          Сотрудник: <b className="c-t1">{fio || '—'}</b>
        </div>
        <div style={{ fontSize: 13, color: 'var(--t-2)', marginBottom: 14 }}>
          Дата: <b className="c-t1">{date}</b>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {editableTypes.map((type) => {
            const ct = CELL_TYPES[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => { onPick?.(type); close(); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 14px',
                  border: '1px solid var(--brd-2)',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--inner-bg)',
                  color: 'var(--t-1)',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background 0.12s ease, border-color 0.12s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--hover-bg)';
                  e.currentTarget.style.borderColor = 'var(--gold)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--inner-bg)';
                  e.currentTarget.style.borderColor = 'var(--brd-2)';
                }}
              >
                <span
                  className="gts-cell"
                  style={{ background: ct.bg, color: ct.color, minWidth: 28 }}
                >
                  {ct.label}
                </span>
                <span>{ct.title}</span>
              </button>
            );
          })}
        </div>
        {(() => {
          // подсказка для work-required типов
          const dn = editableTypes.includes('day') || editableTypes.includes('night');
          return dn && !workId ? (
            <div style={{
              marginTop: 12, padding: 10,
              background: 'var(--warn-bg)',
              borderRadius: 'var(--r-sm)',
              fontSize: 12,
              color: 'var(--warn-t)'
            }}>
              ⚠ Для отметки «День/Ночь» сначала привяжите работу — у строки сотрудника должен быть конкретный объект.
            </div>
          ) : null;
        })()}
      </MBody>
      <MFoot>
        <Btn variant="ghost" onClick={() => close()}>Отмена</Btn>
      </MFoot>
    </MCard>
  );
}
