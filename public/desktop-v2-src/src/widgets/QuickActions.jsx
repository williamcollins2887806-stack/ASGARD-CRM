/**
 * Те же действия что в оригинале (renderQuickActions): тендер/чек/чат.
 * Расширил списком по ролям, который фактически использует оригинальный модуль.
 */
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
    { i: '📷', l: 'Чек', h: '/#/cash' }
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
  return (
    <div className="quick-w">
      {acts.map((a, i) => (
        <a key={i} href={a.h}>
          <span className="ic">{a.i}</span>
          <span className="qa-lb">{a.l}</span>
        </a>
      ))}
    </div>
  );
}
