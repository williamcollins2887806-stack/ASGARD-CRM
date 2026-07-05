/**
 * ЭТАЛОН СТРАНИЦЫ для агентов CRM 2.0.
 *
 * Что показывает этот эталон:
 *   1. Структура: TopActionsBar (через blocks) + контент
 *   2. Использование готовых компонентов из @/blocks, @/inputs, @/modals
 *   3. Toast вместо AsgardUI.toast
 *   4. Модалки через useModal().open(<Modal/>)
 *   5. Сохранение настроек в localStorage (или API)
 *   6. Работа с авторизацией через useAuth
 *   7. Никаких inline-цветов, всё через var(--*)
 *   8. Темы переключаются автоматически
 *
 * Замещает: vanilla `custom_dashboard.js` (1 555 строк) → 220 строк React.
 *
 * Папка `src/pages/Home/`:
 *   index.jsx          — главный компонент (тут)
 *   README.md          — описание для разработчиков
 */
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/api/useAuth';
import { api } from '@/api/client';
import { useModal, PickerModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';

import Welcome from '@/widgets/Welcome';
import Notifications from '@/widgets/Notifications';
import MyWorks from '@/widgets/MyWorks';
import Funnel from '@/widgets/Funnel';
import Money from '@/widgets/Money';
import Birthdays from '@/widgets/Birthdays';
import Calendar from '@/widgets/Calendar';
import QuickActions from '@/widgets/QuickActions';
import Approvals from '@/widgets/Approvals';
import Todo from '@/widgets/Todo';
import {
  MyReadiness, DirectorReadiness, EquipmentValue, ReceiptScanner, TelephonyStatus,
  OverdueWorks, PermitsExpiry, TeamWorkload, TenderDynamics, KpiSummary,
  GanttMini, CashBalance, MyCashBalance, EquipmentAlerts, PayrollPending,
  PreTenders, BankSummary, PlatformAlerts, MyMail, Academy
} from '@/widgets/BusinessWidgets';

const WIDGET_TYPES = {
  welcome:           { name: 'Приветствие',          icon: '👋', size: 'normal', cls: 'w-welcome', render: (u) => <Welcome user={u} /> },
  notifications:     { name: 'Уведомления',          icon: '🔔', size: 'normal', cls: 'w-notif',   render: () => <Notifications /> },
  my_works:          { name: 'Мои работы',           icon: '🔧', size: 'normal', cls: 'w-works',   render: (u) => <MyWorks user={u} /> },
  my_readiness:      { name: 'Мои проекты',          icon: '🎯', size: 'wide',   cls: 'w-works',   render: (u) => <MyReadiness user={u} /> },
  director_readiness:{ name: 'Готовность по РП',     icon: '🚦', size: 'wide',   cls: 'w-works',   render: () => <DirectorReadiness /> },
  tenders_funnel:    { name: 'Воронка',              icon: '📊', size: 'normal', cls: 'w-funnel',  render: () => <Funnel /> },
  money_summary:     { name: 'Финансы',              icon: '💰', size: 'normal', cls: 'w-money',   render: () => <Money /> },
  equipment_value:   { name: 'Стоимость ТМЦ',        icon: '📦', size: 'normal', cls: 'w-money',   render: () => <EquipmentValue /> },
  birthdays:         { name: 'Дни рождения',         icon: '🎂', size: 'normal', cls: 'w-bday',    render: () => <Birthdays /> },
  approvals:         { name: 'Согласования',         icon: '✅', size: 'normal', cls: 'w-appr',    render: () => <Approvals /> },
  calendar:          { name: 'Календарь',            icon: '📅', size: 'normal', cls: 'w-cal',     render: () => <Calendar /> },
  quick_actions:     { name: 'Быстрые действия',     icon: '⚡', size: 'normal', cls: 'w-quick',   render: (u) => <QuickActions user={u} /> },
  receipt_scanner:   { name: 'Сканер чеков',         icon: '📷', size: 'normal', cls: 'w-quick',   render: () => <ReceiptScanner /> },
  telephony_status:  { name: 'Телефония',            icon: '📞', size: 'normal', cls: 'w-cal',     render: () => <TelephonyStatus /> },
  overdue_works:     { name: 'Просроченные работы',  icon: '⚠️', size: 'wide',   cls: 'w-works',   render: () => <OverdueWorks /> },
  permits_expiry:    { name: 'Истекающие допуски',   icon: '🛡️', size: 'wide',  cls: 'w-bday',    render: () => <PermitsExpiry /> },
  team_workload:     { name: 'Загрузка РП',          icon: '📊', size: 'wide',   cls: 'w-funnel',  render: () => <TeamWorkload /> },
  tender_dynamics:   { name: 'Динамика тендеров',    icon: '📈', size: 'wide',   cls: 'w-funnel',  render: () => <TenderDynamics /> },
  kpi_summary:       { name: 'KPI сводка',           icon: '🎯', size: 'wide',   cls: 'w-money',   render: () => <KpiSummary /> },
  gantt_mini:        { name: 'Ближайшие дедлайны',   icon: '⏰', size: 'normal', cls: 'w-todo',    render: () => <GanttMini /> },
  cash_balance:      { name: 'Баланс КАССА',         icon: '💵', size: 'normal', cls: 'w-money',   render: () => <CashBalance /> },
  my_cash_balance:   { name: 'Мои подотчётные',      icon: '💰', size: 'normal', cls: 'w-money',   render: (u) => <MyCashBalance user={u} /> },
  equipment_alerts:  { name: 'Оборудование • Алерты',icon: '🔧', size: 'normal', cls: 'w-works',   render: () => <EquipmentAlerts /> },
  payroll_pending:   { name: 'Ведомости (ожидание)', icon: '💰', size: 'normal', cls: 'w-appr',    render: () => <PayrollPending /> },
  todo:              { name: 'Мои задачи',           icon: '✅', size: 'normal', cls: 'w-todo',    render: () => <Todo /> },
  pre_tenders:       { name: 'Заявки',               icon: '📨', size: 'normal', cls: 'w-funnel',  render: () => <PreTenders /> },
  bank_summary:      { name: 'Банковская сводка',    icon: '🏦', size: 'normal', cls: 'w-money',   render: () => <BankSummary /> },
  platform_alerts:   { name: 'Тендерные площадки',   icon: '🏗️', size: 'normal',cls: 'w-funnel',  render: () => <PlatformAlerts /> },
  my_mail:           { name: 'Моя почта',            icon: '✉️', size: 'normal', cls: 'w-notif',   render: (u) => <MyMail user={u} /> },
  academy:           { name: 'Залы Асгарда',         icon: '🏛️', size: 'normal',cls: 'w-bday',    render: (u) => <Academy user={u} /> }
};

const DEFAULT_LAYOUTS = {
  ADMIN: ['welcome','academy','kpi_summary','pre_tenders','quick_actions','overdue_works','tenders_funnel','my_mail','notifications'],
  PM: ['welcome','academy','quick_actions','my_readiness','my_works','my_cash_balance','gantt_mini','todo','my_mail','notifications','birthdays'],
  TO: ['welcome','academy','quick_actions','tenders_funnel','tender_dynamics','my_mail','notifications'],
  HEAD_TO: ['welcome','academy','my_cash_balance','pre_tenders','platform_alerts','tender_dynamics','tenders_funnel','my_mail','notifications'],
  HEAD_PM: ['welcome','academy','director_readiness','team_workload','overdue_works','gantt_mini','my_mail','notifications'],
  CHIEF_ENGINEER: ['welcome','academy','equipment_value','equipment_alerts','my_mail','notifications'],
  HR: ['welcome','academy','permits_expiry','birthdays','my_mail','notifications','calendar'],
  HR_MANAGER: ['welcome','academy','permits_expiry','birthdays','team_workload','my_mail','notifications'],
  BUH: ['welcome','academy','cash_balance','bank_summary','money_summary','my_mail','notifications'],
  DEFAULT: ['welcome','academy','my_mail','notifications','todo','calendar','birthdays']
};

function layoutFor(role) {
  if (role && role.startsWith('DIRECTOR')) return DEFAULT_LAYOUTS.ADMIN;
  return DEFAULT_LAYOUTS[role] || DEFAULT_LAYOUTS.DEFAULT;
}

// LS — кеш-зеркало (для оффлайна и мгновенного first paint).
// SSoT — БД через /api/settings/dash_layout_<userId> (тот же ключ, что в vanilla custom_dashboard.js,
// благодаря этому layout синхронизируется между устройствами и vanilla v1 ↔ React v2).
const LS_KEY = (uid) => 'asgard_v2_home_layout_' + uid;
const API_KEY = (uid) => 'dash_layout_' + uid;

/**
 * Виджет на главной — поддерживает HTML5 drag&drop.
 *
 * Drag за «ручку» в header (≡), drop на любой соседний виджет.
 * `dragOver` подсвечивает целевой виджет рамкой (см. .widget--drop-target в CSS).
 * Источник паттерна — Funnel/Column.jsx (drop-зона) + Funnel/Card.jsx (draggable).
 */
function Widget({ id, user, onRemove, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, isDragging, isDropTarget }) {
  const w = WIDGET_TYPES[id];
  if (!w) return null;
  const cls = [
    'widget',
    w.size === 'wide' ? 'wide' : '',
    w.cls,
    isDragging ? 'widget--drag' : '',
    isDropTarget ? 'widget--drop-target' : ''
  ].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      data-widget-id={id}
      onDragOver={(e) => { e.preventDefault(); onDragOver?.(id); }}
      onDragLeave={() => onDragLeave?.(id)}
      onDrop={(e) => { e.preventDefault(); onDrop?.(id); }}
    >
      <div className="widget-head">
        <span
          className="widget-grip"
          title="Перетащите, чтобы изменить порядок"
          draggable
          onDragStart={(e) => {
            try {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', id);
            } catch { /* noop */ }
            onDragStart?.(id);
          }}
          onDragEnd={() => onDragEnd?.(id)}
          aria-label="Перетащить виджет"
        >≡</span>
        <span className="ico">{w.icon}</span>
        <span className="name">{w.name}</span>
        {onRemove && (
          <button
            className="widget-remove"
            title="Убрать виджет"
            onClick={() => onRemove(id)}
          >×</button>
        )}
      </div>
      <div className="widget-body">
        {w.render(user)}
      </div>
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { open } = useModal();
  const [layout, setLayout] = useState(() => layoutFor(user?.role));

  // Загрузка кастомного layout: SSoT — API (GET /api/settings/dash_layout_<userId>),
  // LS — кеш-зеркало для оффлайна и мгновенного first paint (до ответа API).
  // 1) Сначала пытаемся LS — чтобы экран не мигал пустым на медленном API.
  // 2) Затем дергаем API — если value есть, переписываем layout (SSoT побеждает).
  // 3) Если API отдал null/упал — остаёмся на LS-значении (или role-default).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    // (1) LS-fallback — мгновенно.
    let lsLayout = null;
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY(user.id)) || 'null');
      if (Array.isArray(saved) && saved.length) lsLayout = saved;
    } catch { /* noop */ }
    setLayout(lsLayout || layoutFor(user.role));

    // (2) API — авторитетный источник. Sync с других устройств.
    api('/api/settings/' + API_KEY(user.id), { silent: true })
      .then((resp) => {
        if (cancelled) return;
        const v = resp?.value;
        if (Array.isArray(v) && v.length) {
          setLayout(v);
          // Подновляем LS-кеш на случай, если он отстал от другого устройства.
          try { localStorage.setItem(LS_KEY(user.id), JSON.stringify(v)); } catch { /* noop */ }
        }
        // value === null/[] → используем LS-fallback или role-default (уже выставлено выше).
      })
      .catch(() => { /* offline/5xx — остаёмся на LS, см. (1) */ });

    return () => { cancelled = true; };
  }, [user?.id, user?.role]);

  const saveLayout = (next) => {
    setLayout(next);
    // Параллельно: API (SSoT) + LS (кеш-зеркало). LS даёт мгновенный first paint
    // при следующем заходе, API синхронизирует с другими устройствами того же user_id.
    try { localStorage.setItem(LS_KEY(user.id), JSON.stringify(next)); } catch { /* noop */ }
    if (user?.id) {
      api('/api/settings/' + API_KEY(user.id), {
        method: 'PUT',
        body: { value: next },
        silent: true
      }).catch(() => { /* offline/5xx — LS-кеш сохранится, синхронизация на следующем входе */ });
    }
  };

  const handleAddWidget = () => {
    const available = Object.entries(WIDGET_TYPES)
      .filter(([id]) => !layout.includes(id))
      .map(([id, w]) => ({ id, name: w.name, role: w.size === 'wide' ? 'широкий' : 'обычный', icon: w.icon }));
    if (available.length === 0) {
      toast.info('Все виджеты уже добавлены');
      return;
    }
    open(
      <PickerModal
        title="Добавить виджет на главную"
        subtitle={`Свободно: ${available.length}`}
        icon="🧩"
        accent="info"
        multi
        items={available}
        onSubmit={(picked) => {
          const ids = picked.map((p) => p.id);
          saveLayout([...layout, ...ids]);
          toast.success(`Добавлено ${ids.length} виджет(а)`);
        }}
      />
    );
  };

  const handleResetLayout = () => {
    open(
      <ConfirmModal
        title="Сбросить расположение виджетов?"
        message="Вернётся стандартный набор для вашей роли. Кастомизация будет потеряна."
        tone="warn"
        okText="Сбросить"
        onConfirm={() => {
          const fresh = layoutFor(user.role);
          saveLayout(fresh);
          toast.success('Расположение сброшено к стандарту');
        }}
      />
    );
  };

  const handleRemoveWidget = (id) => {
    saveLayout(layout.filter((x) => x !== id));
    toast.info('Виджет убран. Чтобы вернуть — нажмите «+ Виджет»');
  };

  // ─── Drag&Drop виджетов ────────────────────────────────────────────────
  // Перетаскивание за ручку «≡» в шапке виджета. Drop на соседнего —
  // перенос позиции в layout с сохранением через saveLayout (LS).
  // Источник паттерна — Funnel/index.jsx (draggedRef + onDrop по индексу).
  const draggedIdRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const onWidgetDragStart = (id) => {
    draggedIdRef.current = id;
    setDragging(id);
  };
  const onWidgetDragEnd = () => {
    draggedIdRef.current = null;
    setDragging(null);
    setDropTarget(null);
  };
  const onWidgetDragOver = (overId) => {
    if (!draggedIdRef.current || draggedIdRef.current === overId) return;
    if (dropTarget !== overId) setDropTarget(overId);
  };
  const onWidgetDragLeave = (overId) => {
    if (dropTarget === overId) setDropTarget(null);
  };
  const onWidgetDrop = (overId) => {
    const dragged = draggedIdRef.current;
    draggedIdRef.current = null;
    setDragging(null);
    setDropTarget(null);
    if (!dragged || dragged === overId) return;
    const fromIdx = layout.indexOf(dragged);
    const toIdx = layout.indexOf(overId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = layout.slice();
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragged);
    saveLayout(next);
  };

  if (!user) return null;

  return (
    <div className="page-home">
      {/*
        Заголовок страницы — кастомный (Home — особый случай со стилизованным «Залом Ярла»).
        Для обычных страниц используй <TopActionsBar /> из @/blocks/Blocks.
      */}
      <HomeHeader
        userName={user.name || user.login}
        role={user.role}
        widgetsCount={layout.length}
        onAdd={handleAddWidget}
        onReset={handleResetLayout}
      />

      {/* Сетка виджетов — перетаскивание за ручку «≡» в шапке */}
      <div className="home-grid">
        {layout.map((id) => (
          <Widget
            key={id}
            id={id}
            user={user}
            onRemove={handleRemoveWidget}
            onDragStart={onWidgetDragStart}
            onDragEnd={onWidgetDragEnd}
            onDragOver={onWidgetDragOver}
            onDragLeave={onWidgetDragLeave}
            onDrop={onWidgetDrop}
            isDragging={dragging === id}
            isDropTarget={dropTarget === id}
          />
        ))}
      </div>
    </div>
  );
}

function HomeHeader({ userName, role, widgetsCount, onAdd, onReset }) {
  return (
    <div className="home-head">
      <h1>
        <span className="fs-22">ᛟ</span>
        Зал Ярла
      </h1>
      <div className="runes">ᛟ ᚱ ᛏ · {userName} · {role} · {widgetsCount} виджетов</div>
      <div className="home-head-actions">
        <Btn variant="ghost" onClick={onAdd}>+ Виджет</Btn>
        <Btn variant="ghost" onClick={onReset}>↻ Сброс</Btn>
      </div>
    </div>
  );
}
