import { useModal } from './ModalProvider';
import { MCard, MHead, MBody, MFoot, Btn } from './parts';

/**
 * Drawer (выезжает справа/слева). Контент — любой children.
 * Использование: open(<DrawerModal title="Корзина">{...}</DrawerModal>, { size: 'drawer-right' })
 *   или открыть через size = 'drawer-right' автоматически.
 */
export function DrawerModal({
  title,
  subtitle,
  icon = '☰',
  accent = 'default',
  children,
  footer,
  onClose
}) {
  const { close } = useModal();
  const handleClose = () => { onClose?.(); close(); };
  return (
    <MCard className="drawer-card">
      <MHead icon={icon} title={title} subtitle={subtitle} accent={accent} onClose={handleClose} />
      <MBody>{children}</MBody>
      {footer && <MFoot align="spread">{footer}</MFoot>}
    </MCard>
  );
}

/** Cart-drawer — пример пресета (корзина склада) */
export function CartDrawer({ items = [], onSubmit, onClose }) {
  const { close } = useModal();
  const total = items.reduce((s, x) => s + (x.qty || 0) * (x.price || 0), 0);
  const handleClose = () => { onClose?.(); close(); };
  return (
    <MCard>
      <MHead
        icon="🛒"
        title="Корзина закупки"
        subtitle={`${items.length} позиций · ${total.toLocaleString('ru-RU')} ₽`}
        accent="gold"
        onClose={handleClose}
      />
      <MBody>
        {items.length === 0 ? (
          <div className="t-center p-40 c-t3">
            <div className="fs-48 mb-12">🛒</div>
            Корзина пуста
          </div>
        ) : (
          items.map((it) => (
            <div key={it.id} style={{ display: 'flex', gap: 12, padding: 12, background: 'var(--inner-bg)', border: 'var(--inner-border)', borderRadius: 'var(--r-sm)', marginBottom: 8 }}>
              <div className="flex-1">
                <div className="fw-600 fs-13">{it.name}</div>
                <div className="fs-11-5 c-t3 mt-2">{it.unit} · {it.supplier || 'без поставщика'}</div>
              </div>
              <div className="t-right">
                <div className="fw-700 c-gold">{it.qty} × {it.price?.toLocaleString('ru-RU') || '—'} ₽</div>
                <div className="fs-11 c-t3">{((it.qty || 0) * (it.price || 0)).toLocaleString('ru-RU')} ₽</div>
              </div>
            </div>
          ))
        )}
      </MBody>
      <MFoot align="spread">
        <Btn variant="ghost" onClick={handleClose}>Закрыть</Btn>
        <Btn variant="primary" disabled={!items.length} onClick={() => { onSubmit?.(items); close(); }}>
          📨 Отправить заявку
        </Btn>
      </MFoot>
    </MCard>
  );
}
