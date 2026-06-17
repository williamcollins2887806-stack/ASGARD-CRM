/**
 * ActionGrid — grid-меню действий с секциями (как AsgardActionMenu в vanilla).
 *
 * Использование:
 *   <ActionGridModal
 *     title="Действия по работе"
 *     actions={[
 *       { icon: '🔍', label: 'Осмотр', desc: 'Заявка на осмотр', onClick: fn },
 *       { section: 'Финансы' },
 *       { icon: '💰', label: 'Расходы', desc: 'Реестр расходов', onClick: fn, variant: 'success' },
 *       '---',
 *       { icon: '✅', label: 'Завершить', desc: 'Закрыть работу', onClick: fn, variant: 'danger' }
 *     ]}
 *   />
 */
import { useModal } from './ModalProvider';
import { MCard, MHead, MBody } from './parts';

export function ActionGridModal({ title = 'Действия', actions = [] }) {
  const { close } = useModal();

  // Группируем actions в секции
  const sections = [];
  let cur = { title: '', items: [] };
  for (const a of actions) {
    if (a === '---' || (a && a.section !== undefined)) {
      if (cur.items.length) sections.push(cur);
      cur = { title: a.section || '', items: [] };
      continue;
    }
    if (!a || !a.label) continue;
    cur.items.push(a);
  }
  if (cur.items.length) sections.push(cur);

  const onClick = (a) => {
    if (a.disabled) return;
    close();
    setTimeout(() => a.onClick?.(), 80);
  };

  return (
    <MCard className="modal-lg">
      <MHead icon="⚡" title={title} onClose={close} />
      <MBody>
        <div className="col gap-12">
          {sections.map((s, si) => (
            <div key={si}>
              {s.title && (
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '1.2px',
                  color: 'var(--t-3)',
                  margin: si === 0 ? '0 0 8px' : '12px 0 8px',
                  paddingLeft: 2
                }}>
                  {s.title}
                </div>
              )}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 8
              }}>
                {s.items.map((a, ai) => (
                  <button
                    key={ai}
                    className={'aag-card aag-' + (a.variant || 'default') + (a.disabled ? ' aag-disabled' : '')}
                    onClick={() => onClick(a)}
                    disabled={a.disabled}
                  >
                    <span className="aag-ic">{a.icon || '⚡'}</span>
                    <span className="aag-txt">
                      <span className="aag-l">{a.label}</span>
                      {a.desc && <span className="aag-d">{a.desc}</span>}
                    </span>
                    {a.badge && (
                      <span className={'aag-b aag-b-' + (a.badgeType || 'new')}>{a.badge}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </MBody>
    </MCard>
  );
}
