/**
 * Меню действий по тендеру (троеточие «⋯» в таблице тендеров).
 *
 * Список команд фильтруется по `tender_status` (нельзя «отметить выигрыш»
 * на черновике, нельзя «архивировать» уже архивированный и т.п.).
 * Сами обработчики живут в `Tenders/index.jsx::runCommand` — это меню
 * только эмитит `onCommand(cmd, tender)`.
 */
import { MCard, MHead, MBody } from '@/modals/parts';

export function ActionMenuModal({ onClose, tender, onCommand }) {
  const s = tender?.tender_status;
  // Backend хранит русские статусы — ранее условия с english никогда не срабатывали,
  // меню рендерилось пустым. Архив = «Не подходит» (см. vanilla tenders.js:1020).
  const CAN_SHOW_WIN_LOSE = ['КП отправлено', 'Готово к отправке КП'].includes(s);
  const TERMINAL = ['Выиграли', 'Проиграли', 'Не подходит'];
  const actions = [
    { id: 'won',           label: '🏆 Отметить выигрыш',          show: CAN_SHOW_WIN_LOSE },
    { id: 'lost',          label: '❌ Отметить проигрыш',         show: CAN_SHOW_WIN_LOSE },
    { id: 'cancel',        label: '🚫 Отменить',                  show: !TERMINAL.includes(s) },
    { id: 'archive',       label: '📁 В архив',                   show: s !== 'Не подходит' },
    { id: 'unarchive',     label: '♻️ Из архива',                 show: s === 'Не подходит' },
    { id: 'change_author', label: '👤 Сменить автора (ADMIN)',    show: true },
    { id: 'pass_request',  label: '🔑 Создать заявку на пропуск', show: true },
    { id: 'tmc_request',   label: '📦 Создать заявку на ТМЦ',     show: true }
  ];
  return (
    <MCard className="modal-sm">
      <MHead icon="⋯" title={`Действия по тендеру #${tender?.id}`} onClose={onClose} />
      <MBody>
        <div className="tnd-actions-list">
          {actions.filter((a) => a.show).map((a) => (
            <button
              key={a.id}
              className="btn-ghost"
              onClick={() => { onCommand?.(a.id, tender); onClose?.(); }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </MBody>
    </MCard>
  );
}
