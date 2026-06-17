/**
 * Те же действия что в оригинале (renderQuickActions): тендер/чек/чат.
 * Расширил списком по ролям, который фактически использует оригинальный модуль.
 *
 * D-111 / batch D-vol8.
 *   Кнопка «📷 Чек» у PM теперь открывает ReceiptScannerModal inline (а не ведёт на #/cash).
 */
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import ReceiptScannerModal from './ReceiptScannerModal';

const ACT_RECEIPT = '__action:receipt';

const ACTIONS_BY_ROLE = {
  ADMIN: [
    { i: '📋', l: 'Тендер', h: '/#/tenders?new=1' },
    { i: '💬', l: 'Чат', h: '/#/chat' },
    { i: '✓', l: 'Согласовать', h: '/#/approvals' },
    { i: '👥', l: 'Юзеры', h: '/#/user-requests' }
  ],
  PM: [
    { i: '🏗️', l: 'Работы', h: '/#/pm-works' },
    { i: '🧮', l: 'Просчёты', h: '/#/pm-calcs' },
    { i: '💬', l: 'Чат', h: '/#/chat' },
    { i: '📷', l: 'Чек', h: ACT_RECEIPT }
  ],
  HEAD_PM: [
    { i: '🏗️', l: 'Все работы', h: '/#/all-works' },
    { i: '✓', l: 'Согласовать', h: '/#/approvals' },
    { i: '💬', l: 'Чат', h: '/#/chat' }
  ],
  TO: [
    { i: '📋', l: 'Тендер', h: '/#/tenders?new=1' },
    { i: '📊', l: 'Мои просчёты', h: '/#/to-calcs' },
    { i: '💬', l: 'Чат', h: '/#/chat' }
  ],
  HEAD_TO: [
    { i: '📋', l: 'Тендеры', h: '/#/tenders' },
    { i: '✓', l: 'Согл. ТО', h: '/#/head-to-approvals' },
    { i: '💬', l: 'Чат', h: '/#/chat' }
  ],
  BUH: [
    { i: '💰', l: 'Финансы', h: '/#/finances' },
    { i: '🧾', l: 'Реестр', h: '/#/buh-registry' },
    { i: '💬', l: 'Чат', h: '/#/chat' }
  ],
  DIRECTOR_GEN: [
    { i: '📊', l: 'Дашборд', h: '/#/v2-dashboard' },
    { i: '✓', l: 'Согласовать', h: '/#/approvals' },
    { i: '💰', l: 'Финансы', h: '/#/finances' },
    { i: '💬', l: 'Чат', h: '/#/chat' }
  ]
};

const DEFAULT_ACTIONS = [
  { i: '💬', l: 'Чат', h: '/#/chat' },
  { i: '📋', l: 'Задачи', h: '/#/tasks' }
];

function actionsFor(role) {
  if (role && role.startsWith('DIRECTOR')) return ACTIONS_BY_ROLE.DIRECTOR_GEN;
  return ACTIONS_BY_ROLE[role] || DEFAULT_ACTIONS;
}

export default function QuickActions({ user }) {
  const acts = actionsFor(user?.role);
  const { open } = useModal();

  const openReceiptScanner = (e) => {
    e.preventDefault();
    open(
      <ReceiptScannerModal
        onParsed={(data) => {
          const amt = data?.parsed?.amount ?? data?.expense?.amount;
          toast('Расход создан', amt ? `${amt} ₽` : 'OCR-чек обработан', 'ok');
        }}
      />
    );
  };

  return (
    <div className="quick-w">
      {acts.map((a, i) => {
        if (a.h === ACT_RECEIPT) {
          return (
            <a key={i} href="#" onClick={openReceiptScanner}>
              <span className="ic">{a.i}</span>
              <span className="qa-lb">{a.l}</span>
            </a>
          );
        }
        return (
          <a key={i} href={a.h}>
            <span className="ic">{a.i}</span>
            <span className="qa-lb">{a.l}</span>
          </a>
        );
      })}
    </div>
  );
}
