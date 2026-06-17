import { useState } from 'react';
import {
  useModal,
  ConfirmModal, PromptModal, FormModal, WizardModal,
  DrawerModal, CartDrawer, BottomSheet, ActionMenu,
  DetailsModal, KV, Timeline,
  ApprovalModal, PickerModal, MethodPicker,
  AlertModal, LoaderModal, StatusChangeModal, FilePreviewModal,
  Btn
} from '@/modals';
import {
  BuhPayBankModal, BuhIssueCashModal, CashReceivedConfirm,
  ExpenseReportModal, ReturnCashModal, CashLimitWarning
} from '@/modals/Buh';
// E-1: src/modals/AIWorkspace.jsx удалён вместе с DEMO_AGENTS/DEMO_EVENTS массивами
// (использовался только в каталоге для демо). Реальный Conductor War Room — это
// отдельная страница /conductor-estimate (pages/ConductorEstimate/) с SSE-потоком
// и реальными данными из /api/mimir/conductor/*.
// E-1: src/modals/Fullscreen.jsx и src/modals/Specials.jsx удалены — содержали
// демо-компоненты с моковыми default props («Заказчик А — ЛОТ 5855», fake URLs).
// Реальные модули живут в pages/*:
//   - BigScreen → pages/BigScreen/ (страница /big-screen с реальными данными)
//   - Welcome → pages/Welcome/
//   - AwaitingCustomer → pages/AwaitingCustomer/
//   - CatalogImportModal → pages/Warehouse/CatalogImportModal.jsx
//   - Conductor War Room → pages/ConductorEstimate/ (SSE + реальные данные)
//
// Чтобы каталог /modals (ADMIN-only справочник UI) не сломался, ниже placeholder-stubs
// которые показывают где живёт реальная реализация. Никаких моков.
const _CatalogStub = ({ route, name }) => (
  <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--t-3)' }}>
    🔗 {name} — реализован как страница <code>{route}</code> с реальными данными из API.
    Открой её через сайдбар.
  </div>
);
const BigScreen = () => <_CatalogStub route="/big-screen" name="BigScreen" />;
const AwaitingCustomer = () => <_CatalogStub route="/awaiting-customer" name="Awaiting Customer" />;
const DirectorReport = () => <_CatalogStub route="/conductor-estimate" name="Director Report" />;
const LetterGenerator = () => <_CatalogStub route="/conductor-estimate" name="Letter Generator" />;
const PinGate = () => <_CatalogStub route="/login" name="PIN Gate" />;
const OfflineGuard = () => <_CatalogStub route="(автоматически)" name="Offline Guard" />;
const Welcome = () => <_CatalogStub route="/welcome" name="Welcome" />;
const ThemeSelectorModal = () => <_CatalogStub route="(в сайдбаре)" name="Theme Selector" />;
const IncomingCall = () => <_CatalogStub route="/telephony" name="Incoming Call" />;
const ReceiptScannerModal = () => <_CatalogStub route="/cash" name="Receipt Scanner" />;
const CatalogImportModal = () => <_CatalogStub route="/warehouse-v2" name="Catalog Import" />;
const QRGeneratorModal = () => <_CatalogStub route="(модуль ассеты)" name="QR Generator" />;
const EmojiPickerModal = () => <_CatalogStub route="(модуль чатов)" name="Emoji Picker" />;
const LightboxModal = () => <_CatalogStub route="(модуль вложений)" name="Lightbox" />;
const EmailComposeModal = () => <_CatalogStub route="/my-mail" name="Email Compose" />;
const MassActionConfirm = () => <_CatalogStub route="(встроен в страницы)" name="Mass Action Confirm" />;
const HintBubble = () => <_CatalogStub route="(встроен в страницы)" name="Hint Bubble" />;
const NewCustomerOverlay = () => <_CatalogStub route="/customers" name="New Customer" />;
// Аналогично для удалённых из blocks/Blocks.jsx демо-панелей:
const WinPanel = () => <_CatalogStub route="/tenders" name="WinPanel" />;
const DistPanel = () => <_CatalogStub route="/funnel" name="DistPanel" />;
const StatCardRow = () => <_CatalogStub route="/dashboard" name="StatCardRow" />;
const FilterBar = () => <_CatalogStub route="(встроен в страницы)" name="FilterBar" />;
const AlertStrip = () => <_CatalogStub route="/alerts" name="AlertStrip" />;
const ListItemRow = () => <_CatalogStub route="(встроен в страницы)" name="ListItemRow" />;
import {
  Field, TextInput, PasswordInput, NumberInput, MoneyInput,
  INNInput, PhoneInput, SearchInput, TextareaInput, SelectInput,
  Combobox, MultiSelect, RadioGroup, Segmented, Checkbox, Switch,
  Slider, DatePicker, Rating, ColorPicker, FileDrop
} from '@/inputs/Inputs';
import { TopActionsBar, EmptyState, TabsBar } from '@/blocks/Blocks';
import {
  toast, AnnouncementBanner, NotificationBell, Tooltip,
  ProgressSteps, Accordion, StatusBadge, VoicePlayer, Stepper, MiniChart,
  DateRangePicker, TimePicker
} from '@/modals/Notifications';

// ─────────────────────────────────────────────────────────────────────────────
// КАТЕГОРИИ (4 типа сущностей)
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'modals', icon: '🎨', name: 'Модалки', desc: '~30 типов диалогов', count: 30 },
  { key: 'fullscreen', icon: '🖥️', name: 'Fullscreen', desc: 'Workspace и системные overlay', count: 12 },
  { key: 'inputs', icon: '✎', name: 'Инпуты', desc: 'Поля ввода и контроли', count: 22 },
  { key: 'blocks', icon: '🧱', name: 'Блоки', desc: 'Inline-панели на страницах', count: 9 },
  { key: 'notif', icon: '🔔', name: 'Уведомления и UI', desc: 'Toast, badges, accordion, stepper', count: 12 }
];

// ─────────────────────────────────────────────────────────────────────────────
// SUBNAV для каждой категории
// ─────────────────────────────────────────────────────────────────────────────
const GROUPS_MODALS = [
  {
    title: 'Базовые',
    items: [
      { key: 'confirm', icon: '❓', name: 'Confirm' },
      { key: 'prompt', icon: '✎', name: 'Prompt' },
      { key: 'alert', icon: '🔔', name: 'Alert' },
      { key: 'loader', icon: '⏳', name: 'Loader' }
    ]
  },
  {
    title: 'Формы',
    items: [
      { key: 'form', icon: '📋', name: 'Form' },
      { key: 'wizard', icon: '🪄', name: 'Wizard' },
      { key: 'status', icon: '↻', name: 'StatusChange' }
    ]
  },
  {
    title: 'Сложные',
    items: [
      { key: 'details', icon: '📄', name: 'Details + Tabs' },
      { key: 'approval', icon: '✓', name: 'Approval (+nested)' },
      { key: 'method', icon: '🎼', name: 'MethodPicker' },
      { key: 'mass', icon: '🗑', name: 'MassAction' }
    ]
  },
  {
    title: 'Финансы (BUH)',
    items: [
      { key: 'pay-bank', icon: '💳', name: 'Оплата ПП' },
      { key: 'issue-cash', icon: '💵', name: 'Выдать наличные' },
      { key: 'cash-received', icon: '✓', name: 'Деньги получены' },
      { key: 'expense-report', icon: '📤', name: 'Отчёт о расходах' },
      { key: 'return-cash', icon: '↩️', name: 'Возврат остатка' },
      { key: 'cash-limit', icon: '⛔', name: 'Недостаточно средств' }
    ]
  },
  {
    title: 'Выбор',
    items: [
      { key: 'picker', icon: '👥', name: 'Picker (single/multi)' },
      { key: 'menu', icon: '⋯', name: 'ActionMenu' }
    ]
  },
  {
    title: 'Контейнеры',
    items: [
      { key: 'drawer', icon: '☰', name: 'Drawer' },
      { key: 'cart', icon: '🛒', name: 'CartDrawer' },
      { key: 'sheet', icon: '↑', name: 'BottomSheet' },
      { key: 'file', icon: '📎', name: 'FilePreview' }
    ]
  },
  {
    title: 'Спец',
    items: [
      { key: 'nested', icon: '🪆', name: 'Тройная вложенность' },
      { key: 'receipt', icon: '📷', name: 'ReceiptScanner' },
      { key: 'import', icon: '📥', name: 'CatalogImport (AI+OCR)' },
      { key: 'qr', icon: '📱', name: 'QR Generator' },
      { key: 'emoji', icon: '😀', name: 'EmojiPicker' },
      { key: 'lightbox', icon: '🖼', name: 'Lightbox' },
      { key: 'email', icon: '✉️', name: 'EmailCompose' },
      { key: 'hint', icon: '💡', name: 'HintBubble (Мимир)' },
      { key: 'newcust', icon: '🏢', name: 'NewCustomer' }
    ]
  }
];

const GROUPS_FULLSCREEN = [
  {
    title: 'AI Workspaces',
    items: [
      { key: 'awaiting', icon: '⏳', name: 'Awaiting Customer' },
      { key: 'dir-report', icon: '📊', name: 'Director Report' },
      { key: 'letter', icon: '✍', name: 'Letter Generator' }
    ]
  },
  {
    title: 'Display / Big Screen',
    items: [
      { key: 'bigscreen', icon: '📺', name: 'Big Screen (для босса)' }
    ]
  },
  {
    title: 'Системные overlay',
    items: [
      { key: 'pin', icon: '🔒', name: 'PIN Gate (lock)' },
      { key: 'offline', icon: '🪶', name: 'Offline Guard' },
      { key: 'welcome', icon: 'ᛟ', name: 'Welcome / Splash' },
      { key: 'theme', icon: '🌗', name: 'Theme Selector' },
      { key: 'call', icon: '📞', name: 'Incoming Call' }
    ]
  }
];

const GROUPS_INPUTS = [
  {
    title: 'Текстовые',
    items: [
      { key: 'text', name: 'Text Input' },
      { key: 'password', name: 'Password (с глазом)' },
      { key: 'number', name: 'Number (+/-)' },
      { key: 'money', name: 'Money (₽)' },
      { key: 'inn', name: 'ИНН (валидация)' },
      { key: 'phone', name: 'Телефон (+7 ___)' },
      { key: 'search', name: 'Search (с clear)' },
      { key: 'textarea', name: 'Textarea (auto-grow)' }
    ]
  },
  {
    title: 'Выбор',
    items: [
      { key: 'select', name: 'Select (нативный)' },
      { key: 'combo', name: 'Combobox (поиск)' },
      { key: 'multi', name: 'MultiSelect (chips)' },
      { key: 'radio', name: 'RadioGroup' },
      { key: 'segmented', name: 'Segmented' }
    ]
  },
  {
    title: 'Бинарные',
    items: [
      { key: 'check', name: 'Checkbox' },
      { key: 'switch', name: 'Switch (3 размера)' }
    ]
  },
  {
    title: 'Спец',
    items: [
      { key: 'slider', name: 'Slider' },
      { key: 'date', name: 'DatePicker (календарь)' },
      { key: 'rating', name: 'Rating (звёзды)' },
      { key: 'color', name: 'ColorPicker' },
      { key: 'file', name: 'FileDrop (drag&drop)' }
    ]
  }
];

const GROUPS_BLOCKS = [
  {
    title: 'Виджеты',
    items: [
      { key: 'empty', name: 'EmptyState' }
    ]
  },
  {
    title: 'Навигация',
    items: [
      { key: 'top', name: 'TopActionsBar' },
      { key: 'tabs', name: 'TabsBar' }
    ]
  }
];

const GROUPS_NOTIF = [
  {
    title: 'Уведомления',
    items: [
      { key: 'toast', name: 'Toast (1836 в проекте!)', desc: 'Главный паттерн уведомлений' },
      { key: 'banner', name: 'Banner (app_updates)' },
      { key: 'bell', name: 'NotificationBell + dropdown' }
    ]
  },
  {
    title: 'Подсказки',
    items: [
      { key: 'tooltip', name: 'Tooltip (на hover)' }
    ]
  },
  {
    title: 'UI-индикаторы',
    items: [
      { key: 'psteps', name: 'ProgressSteps' },
      { key: 'accordion', name: 'Accordion' },
      { key: 'badge', name: 'StatusBadge (расш.)' },
      { key: 'voice', name: 'VoicePlayer' },
      { key: 'stepper', name: 'Stepper (qty +/−)' },
      { key: 'chart', name: 'MiniChart (sparkline)' }
    ]
  },
  {
    title: 'Дата и время',
    items: [
      { key: 'daterange', name: 'DateRangePicker' },
      { key: 'time', name: 'TimePicker' }
    ]
  }
];

// ─────────────────────────────────────────────────────────────────────────────
export default function Modals() {
  const { open } = useModal();
  const [tab, setTab] = useState('modals');
  const [activeM, setActiveM] = useState('confirm');
  const [activeF, setActiveF] = useState('awaiting');
  const [activeI, setActiveI] = useState('text');
  const [activeB, setActiveB] = useState('win');
  const [activeN, setActiveN] = useState('toast');

  return (
    <div className="mc">
      <aside className="mc-side">
        <div className="mc-tabs-vert">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={'mc-tab-vert ' + (tab === t.key ? 'on' : '')}
              onClick={() => setTab(t.key)}
            >
              <span className="mc-tab-ic">{t.icon}</span>
              <div className="flex-1">
                <div className="mc-tab-n">{t.name}</div>
                <div className="mc-tab-d">{t.desc}</div>
              </div>
              <span className="badge">{t.count}</span>
            </button>
          ))}
        </div>
        {tab === 'modals' && <SubNav groups={GROUPS_MODALS} active={activeM} setActive={setActiveM} />}
        {tab === 'fullscreen' && <SubNav groups={GROUPS_FULLSCREEN} active={activeF} setActive={setActiveF} />}
        {tab === 'inputs' && <SubNav groups={GROUPS_INPUTS} active={activeI} setActive={setActiveI} />}
        {tab === 'blocks' && <SubNav groups={GROUPS_BLOCKS} active={activeB} setActive={setActiveB} />}
        {tab === 'notif' && <SubNav groups={GROUPS_NOTIF} active={activeN} setActive={setActiveN} />}
      </aside>
      <main className="mc-main">
        <div className="mc-hero">
          <h1>🎨 АСГАРД 2.0 — Каталог UI</h1>
          <div className="lead">
            <b>Полная карта</b>: ~71 элемент UI которые встречаются в проекте (модалки, поля, блоки, fullscreen).
            Все переработаны под современный UX, работают в двух темах.
            Когда захотите — заменим vanilla одним свитчем (window.AsgardUI2 готов).
          </div>
          <div className="mc-tag-row mt-12" >
            <span className="mc-tag gold">{TABS.reduce((s, t) => s + t.count, 0)} элементов</span>
            <span className="mc-tag info">N-уровневая вложенность</span>
            <span className="mc-tag ok">2 темы</span>
            <span className="mc-tag">window.AsgardUI2</span>
          </div>
        </div>

        {/* MODALS TAB */}
        {tab === 'modals' && <ModalsCatalog active={activeM} open={open} />}

        {/* FULLSCREEN TAB */}
        {tab === 'fullscreen' && <FullscreenCatalog active={activeF} open={open} />}

        {/* INPUTS TAB */}
        {tab === 'inputs' && <InputsCatalog active={activeI} />}

        {/* BLOCKS TAB */}
        {tab === 'blocks' && <BlocksCatalog active={activeB} />}

        {/* NOTIF TAB */}
        {tab === 'notif' && <NotifCatalog active={activeN} />}
      </main>
    </div>
  );
}

function SubNav({ groups, active, setActive }) {
  return (
    <div className="mt-14 pt-12 brd-2-t">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="grp">{g.title}</div>
          {g.items.map((it) => (
            <div
              key={it.key}
              className={'item ' + (it.key === active ? 'active' : '')}
              onClick={() => setActive(it.key)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(it.key); } }}
              role="button"
              tabIndex={0}
              aria-current={it.key === active ? 'true' : undefined}
              aria-label={it.name}
            >
              {it.icon && <span className="ic" aria-hidden="true">{it.icon}</span>}
              <span className="flex-1">
                <div>{it.name}</div>
                {it.desc && <div className="fs-10-5 c-t3 fw-400">{it.desc}</div>}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODALS CATALOG (содержит все примеры из 1-й волны + BUH + спец)
// ═══════════════════════════════════════════════════════════════════════════
function ModalsCatalog({ active, open }) {
  const RENDERS = {
    confirm: () => (
      <Section icon="❓" accent="info" title="Confirm — Да/Нет с акцентом" lead="50+ vanilla confirm заменено единым API с 4 тонами.">
        <CardRow>
          <DemoCard color="info" title="Info" onClick={() => open(<ConfirmModal title="Сменить тему?" message="Применится сразу." tone="info" okText="Сменить" />)} />
          <DemoCard color="ok" title="Success" onClick={() => open(<ConfirmModal title="Подтвердить выдачу аванса?" message="15 000 ₽ будет списано." tone="success" okText="Подтвердить" />)} />
          <DemoCard color="gold" title="Warn" onClick={() => open(<ConfirmModal title="Переназначить РП?" message="Текущий РП получит уведомление." tone="warn" okText="Переназначить" />)} />
          <DemoCard color="danger" title="Danger" onClick={() => open(<ConfirmModal title="Удалить тендер №734?" message="Удаление необратимо." tone="danger" okText="Удалить" />)} />
        </CardRow>
      </Section>
    ),
    prompt: () => (
      <Section icon="✎" accent="info" title="Prompt — поле ввода" lead="30+ vanilla prompt. Single/multiline, Enter/Ctrl+Enter.">
        <CardRow>
          <DemoCard color="info" title="Однострочный" onClick={() => open(<PromptModal title="Добавить тег" label="Название" placeholder="«Заказчик А-2026»" />)} />
          <DemoCard color="gold" title="Multiline" onClick={() => open(<PromptModal title="Комментарий" multiline label="Что хотите сказать?" />)} />
          <DemoCard color="purple" title="С подстановкой" onClick={() => open(<PromptModal title="Редактировать" initial="Тендер 2026/Q3 — Капремонт ВЛ-110 кВ" multiline />)} />
        </CardRow>
      </Section>
    ),
    alert: () => (
      <Section icon="🔔" accent="info" title="Alert — уведомление" lead="4 пресета результата операции.">
        <CardRow>
          <DemoCard color="ok" title="Success" onClick={() => open(<AlertModal tone="success" title="Готово!" message="Тендер отправлен Хосе на анализ." />)} />
          <DemoCard color="info" title="Info" onClick={() => open(<AlertModal tone="info" title="Все данные актуальны" message="Последняя синхронизация: только что." />)} />
          <DemoCard color="gold" title="Warn" onClick={() => open(<AlertModal tone="warn" title="Сохранено с замечаниями" message="3 поля заполнены частично." />)} />
          <DemoCard color="danger" title="Danger" onClick={() => open(<AlertModal tone="danger" title="Не удалось сохранить" message="Ошибка 503. Повторите через минуту." />)} />
        </CardRow>
      </Section>
    ),
    loader: () => (
      <Section icon="⏳" accent="info" title="Loader — загрузка" lead="Spinner или с %.">
        <CardRow>
          <DemoCard color="info" title="Spinner" onClick={() => open(<LoaderModal title="Загружаем…" message="Получаем все тендеры" />, { dismissOnClick: false })} />
          <DemoCard color="danger" title="С отменой" onClick={() => open(<LoaderModal title="Импорт 1 247 позиций…" cancelable />, { dismissOnClick: false })} />
        </CardRow>
      </Section>
    ),
    form: () => (
      <Section icon="📋" accent="gold" title="Form — большая форма" lead="Создание/редактирование, валидация, асинхронный submit.">
        <DemoCard color="gold" title="Новый тендер" onClick={() => open(<FormModal title="Новый тендер" icon="📋" accent="gold" fields={[
          { key: 'customer', label: 'Заказчик', required: true },
          { key: 'inn', label: 'ИНН' },
          { key: 'title', label: 'Название', required: true, span: 2 },
          { key: 'price', label: 'НМЦ, ₽', type: 'number' },
          { key: 'type', label: 'Тип', type: 'select', options: ['Тендер', 'Прямой запрос'] }
        ]} />, { size: 'wide' })} />
      </Section>
    ),
    wizard: () => (
      <Section icon="🪄" accent="purple" title="Wizard — многошаговый" lead="Со степпером и валидацией шагов.">
        <DemoCard color="purple" title="Просчёт (3 шага)" onClick={() => open(<WizardModal title="Создание просчёта" steps={[
          { key: 'p', title: 'Параметры', render: (s, set) => <Field label="Бригада"><input type="number" className="m-input" value={s.crew || ''} onChange={(e) => set({ ...s, crew: e.target.value })} /></Field>, canNext: (s) => s.crew },
          { key: 'o', title: 'Объект', render: (s, set) => <Field label="Город"><input className="m-input" value={s.city || ''} onChange={(e) => set({ ...s, city: e.target.value })} /></Field>, canNext: (s) => s.city },
          { key: 'c', title: 'Подтверждение', render: (s) => <KV rows={[{ k: 'Бригада', v: s.crew + ' чел.' }, { k: 'Город', v: s.city }]} /> }
        ]} />, { size: 'wide' })} />
      </Section>
    ),
    status: () => (
      <Section icon="↻" accent="warn" title="StatusChange" lead="Смена статуса с причиной и комментарием.">
        <CardRow>
          <DemoCard color="danger" title="Тендер: Проиграли" onClick={() => open(<StatusChangeModal title="Тендер: Проиграли" fromStatus="КП отправлено" toStatus="Проиграли" reasonOptions={['Цена выше', 'Срок не подошёл', 'Конкурент']} accent="danger" />)} />
          <DemoCard color="gold" title="Не подходит" onClick={() => open(<StatusChangeModal title="Отсеять" fromStatus="На анализе" toStatus="Не подходит" reasonOptions={['Не наш профиль', 'Нет ресурсов', 'Срок истёк']} accent="warn" icon="📁" />)} />
        </CardRow>
      </Section>
    ),
    details: () => (
      <Section icon="📄" accent="info" title="Details — карточка" lead="Табы + KV + Timeline.">
        <DemoCard color="info" title="Карточка тендера" onClick={() => open(<DetailsModal title="Тендер №734" subtitle="Заказчик А" icon="📋" accent="gold" status={{ label: 'Согласование ТКП', tone: 'gold' }} tabs={[
          { key: 'm', label: 'Основное', render: () => <KV rows={[{ k: 'Заказчик', v: 'Заказчик А' }, { k: 'НМЦ', v: '18.5 млн ₽' }, { k: 'РП', v: 'Иванов И.' }]} /> },
          { key: 'h', label: 'История', render: () => <Timeline events={[
            { when: 'Сегодня 14:30', what: 'Просчёт отправлен', by: 'Иванов', tone: 'info' },
            { when: 'Вчера 16:45', what: 'Передан РП', by: 'Хосе', tone: 'ok' },
            { when: '11.06', what: 'Создан', by: 'Морозов' }
          ]} /> }
        ]} />, { size: 'wide' })} />
      </Section>
    ),
    approval: () => (
      <Section icon="✓" accent="gold" title="Approval — 4 кнопки с вложенным prompt" lead="При выборе доработка/вопрос/отклонить — открывает Prompt в стеке.">
        <DemoCard color="gold" title="Согласование просчёта" onClick={() => open(<ApprovalModal title="Согласование просчёта" subtitle="Тендер №734" icon="✓" accent="gold" summary={<KV rows={[{ k: 'ТКП', v: '17.2 млн ₽' }, { k: 'Маржа', v: '19.8%' }]} />} />)} />
      </Section>
    ),
    method: () => (
      <Section icon="🎼" accent="purple" title="MethodPicker — выбор из 2-4 крупных" lead="Quick vs Conductor — реальный кейс.">
        <DemoCard color="purple" title="Способ просчёта" onClick={() => open(<MethodPicker title="Выбор способа расчёта" icon="🪄" accent="purple" options={[
          { key: 'q', icon: '🧙', title: 'Быстрый', desc: 'Один агент. 1–3 мин.', meta: '≈ 5–15 ₽' },
          { key: 'c', icon: '🎼', title: 'Полный (Conductor)', desc: '30+ агентов. 10–60 мин.', meta: '≈ 100–800 ₽', featured: true }
        ]} />, { size: 'wide' })} />
      </Section>
    ),
    mass: () => (
      <Section icon="🗑" accent="danger" title="MassActionConfirm" lead="Confirm со списком элементов которые затронет операция.">
        <DemoCard color="danger" title="Удалить 5 тендеров" onClick={() => open(<MassActionConfirm action="Удалить" danger items={['Тендер №734 — Заказчик А', 'Тендер №732 — Заказчик Б', 'Тендер №730 — Заказчик В', 'Тендер №728 — Заказчик Г', 'Тендер №726 — Заказчик Д']} />)} />
      </Section>
    ),
    'pay-bank': () => (
      <Section icon="💳" accent="info" title="BUH — Оплата ПП" lead="Платёжное поручение: реквизиты + скан.">
        <DemoCard color="info" title="Оплатить заявку №42" onClick={() => open(<BuhPayBankModal requestTitle="Аванс на материалы — Иванов И." amount={150000} />, { size: 'wide' })} />
      </Section>
    ),
    'issue-cash': () => (
      <Section icon="💵" accent="gold" title="BUH — Выдача наличных (с балансом!)" lead="Показывает баланс кассы и валидирует достаточно ли средств.">
        <CardRow>
          <DemoCard color="ok" title="Хватает (баланс 500к)" onClick={() => open(<BuhIssueCashModal requestTitle="Аванс Иванову" amount={150000} balance={500000} />)} />
          <DemoCard color="danger" title="Не хватает (баланс 80к)" onClick={() => open(<BuhIssueCashModal requestTitle="Аванс Иванову" amount={150000} balance={80000} />)} />
        </CardRow>
      </Section>
    ),
    'cash-received': () => (
      <Section icon="✓" accent="success" title="Подтверждение получения наличных" lead="Простая модалка с одной кнопкой.">
        <DemoCard color="ok" title="Получил 150 000 ₽" onClick={() => open(<CashReceivedConfirm amount={150000} fromName="кассы Асгард" />)} />
      </Section>
    ),
    'expense-report': () => (
      <Section icon="📤" accent="purple" title="Отчёт о расходах + чеки" lead="Прикрепить файл с чеками + описание.">
        <DemoCard color="purple" title="Отчёт по 150к" onClick={() => open(<ExpenseReportModal requestTitle="Аванс №42" amount={150000} />, { size: 'wide' })} />
      </Section>
    ),
    'return-cash': () => (
      <Section icon="↩️" accent="success" title="Возврат остатка в кассу" lead="Если потратил меньше выданного.">
        <DemoCard color="ok" title="Вернуть из 50 000 ₽" onClick={() => open(<ReturnCashModal maxAmount={50000} />)} />
      </Section>
    ),
    'cash-limit': () => (
      <Section icon="⛔" accent="danger" title="Недостаточно средств" lead="Блокирующий warning с информацией о балансе.">
        <DemoCard color="danger" title="Не хватает 70 000 ₽" onClick={() => open(<CashLimitWarning required={150000} available={80000} limit={200000} />)} />
      </Section>
    ),
    picker: () => (
      <Section icon="👥" accent="info" title="Picker — выбор из списка" lead="С поиском, аватарами, single/multi.">
        <CardRow>
          <DemoCard color="info" title="Single РП" onClick={() => open(<PickerModal title="Назначить РП" icon="👤" accent="info" items={[
            { id: 1, name: 'Иванов И.И.', role: 'PM' },
            { id: 2, name: 'Петров П.П.', role: 'PM' },
            { id: 3, name: 'Хосе Гарсия', role: 'HEAD_TO' }
          ]} />)} />
          <DemoCard color="gold" title="Multi (чат)" onClick={() => open(<PickerModal title="Добавить в чат" icon="👥" multi items={[
            { id: 1, name: 'Иванов И.', role: 'PM' },
            { id: 2, name: 'Петров П.', role: 'PM' },
            { id: 3, name: 'Хосе Гарсия', role: 'HEAD_TO' }
          ]} />)} />
        </CardRow>
      </Section>
    ),
    menu: () => (
      <Section icon="⋯" accent="default" title="ActionMenu" lead="Группы, разделители, danger-варианты.">
        <DemoCard color="gold" title="Действия с тендером" onClick={() => open(<ActionMenu title="Действия" icon="📋" items={[
          { group: 'Управление' },
          { icon: '📝', label: 'Редактировать' },
          { icon: '👥', label: 'Переназначить РП' },
          '---',
          { group: 'Документы' },
          { icon: '📎', label: 'Прикрепить файл' },
          { icon: '📥', label: 'Скачать комплект', meta: '4 файла' },
          '---',
          { icon: '🗑', label: 'Удалить', desc: 'Необратимо', danger: true }
        ]} />)} />
      </Section>
    ),
    drawer: () => (
      <Section icon="☰" accent="default" title="Drawer — выезжает справа" lead="Sticky-shadow при скролле, anim slide-right.">
        <DemoCard color="info" title="Сводка работы" onClick={() => open(<DrawerModal title="Работа #421" subtitle="ВЛ-110 кВ" icon="🏗️" accent="info">
          <KV rows={[{ k: 'Заказчик', v: 'Заказчик А' }, { k: 'Срок', v: '15.06—22.06' }, { k: 'Готовность', v: '67%' }]} />
        </DrawerModal>, { shape: 'drawer-right' })} />
      </Section>
    ),
    cart: () => (
      <Section icon="🛒" accent="gold" title="CartDrawer — корзина склада" lead="Готовый пресет.">
        <DemoCard color="gold" title="Корзина (3 поз.)" onClick={() => open(<CartDrawer items={[
          { id: 1, name: 'Кабель ВВГнг 3×2.5', unit: 'м', qty: 250, price: 84 },
          { id: 2, name: 'Хомут D50', unit: 'шт', qty: 40, price: 95 },
          { id: 3, name: 'Каска защитная', unit: 'шт', qty: 6, price: 720 }
        ]} />, { shape: 'drawer-right' })} />
      </Section>
    ),
    sheet: () => (
      <Section icon="↑" accent="default" title="BottomSheet" lead="Снизу с grab-handle.">
        <DemoCard color="info" title="Action sheet" onClick={() => open(<BottomSheet title="Действия" icon="⚡">
          <div className="row gap-10 row-around">
            {['📋', '✏️', '📎', '👥', '🗑'].map((i) => (
              <button key={i} className="m-btn outline p-14" style={{ flexDirection: 'column' }}>{i}</button>
            ))}
          </div>
        </BottomSheet>, { shape: 'sheet-bottom' })} />
      </Section>
    ),
    file: () => (
      <Section icon="📎" accent="info" title="FilePreview" lead="Image / PDF iframe.">
        <DemoCard color="info" title="Изображение" onClick={() => open(<FilePreviewModal title="Скан ТЗ" fileUrl="/assets/img/icon-512.png" mime="image/png" downloadUrl="#" />, { size: 'wide' })} />
      </Section>
    ),
    nested: () => (
      <Section icon="🪆" accent="purple" title="Nested — N-уровневая вложенность" lead="Реальный кейс: Работа → Закупки → Заявки → Новая.">
        <DemoCard color="purple" title="Открыть 4 уровня" onClick={() => {
          open(<ConfirmModal title="Уровень 1" message="Откроется второй" tone="info" okText="Дальше" onConfirm={() => {
            open(<DetailsModal title="Уровень 2 — Работа" icon="🏗️" accent="info" tabs={[{
              key: 't', label: 'Контент',
              render: () => <div>
                <p>Кликни кнопку — откроется Уровень 3</p>
                <Btn variant="primary" onClick={() => open(<FormModal title="Уровень 3 — Новая заявка" icon="🛒" accent="gold" fields={[{ key: 'item', label: 'Позиция', required: true, span: 2 }]} onSubmit={() => {
                  open(<AlertModal tone="success" title="Уровень 4 — Готово!" message="Все 4 модалки в стеке. ESC закрывает верхний." />);
                }} />, { size: 'wide' })}>📂 Открыть</Btn>
              </div>
            }]} />);
          }} />);
        }} />
      </Section>
    ),
    receipt: () => (
      <Section icon="📷" accent="gold" title="ReceiptScanner — камера + OCR" lead="Снимок чека → Tesseract OCR → автозаполнение расхода.">
        <DemoCard color="gold" title="Сканировать чек" onClick={() => open(<ReceiptScannerModal />, { size: 'wide' })} />
      </Section>
    ),
    import: () => (
      <Section icon="📥" accent="info" title="CatalogImport — PDF/Excel/AI" lead="Загрузка УПД → AI парсер → preview сопоставления.">
        <DemoCard color="info" title="Импорт счёта" onClick={() => open(<CatalogImportModal />, { size: 'wide' })} />
      </Section>
    ),
    qr: () => (
      <Section icon="📱" accent="purple" title="QRGenerator + Печать" lead="QR-код объекта для наклейки.">
        <DemoCard color="purple" title="QR работы #421" onClick={() => open(<QRGeneratorModal />)} />
      </Section>
    ),
    emoji: () => (
      <Section icon="😀" accent="gold" title="EmojiPicker" lead="Bottom-sheet с категориями.">
        <DemoCard color="gold" title="Выбрать эмодзи" onClick={() => open(<EmojiPickerModal />)} />
      </Section>
    ),
    lightbox: () => (
      <Section icon="🖼" accent="default" title="Lightbox" lead="Fullscreen просмотр фото / документа.">
        <DemoCard color="info" title="Открыть фото" onClick={() => open(<LightboxModal />, { shape: 'full' })} />
      </Section>
    ),
    email: () => (
      <Section icon="✉️" accent="info" title="EmailCompose" lead="Большая модалка для письма + вложения.">
        <DemoCard color="info" title="Написать клиенту" onClick={() => open(<EmailComposeModal />, { size: 'wide' })} />
      </Section>
    ),
    hint: () => (
      <Section icon="💡" accent="gold" title="HintBubble — подсказка Мимира" lead="Overlay с указателем на UI-элемент.">
        <DemoCard color="gold" title="Подсказка" onClick={() => open(<HintBubble />)} />
      </Section>
    ),
    newcust: () => (
      <Section icon="🏢" accent="info" title="NewCustomer (cm-overlay)" lead="Создание контрагента — замена cm-overlay в contracts.js.">
        <DemoCard color="info" title="Новый клиент" onClick={() => open(<NewCustomerOverlay />)} />
      </Section>
    )
  };
  return RENDERS[active]?.() ?? <Empty />;
}

// ═══════════════════════════════════════════════════════════════════════════
// FULLSCREEN CATALOG
// ═══════════════════════════════════════════════════════════════════════════
function FullscreenCatalog({ active, open }) {
  const RENDERS = {
    // E-1: warroom/quick/mimir-chat демо-секции удалены вместе с AIWorkspace.jsx.
    // Реальные модули: /conductor-estimate, /tkp (быстрый), MimirFab widget.
    awaiting: () => (
      <Section icon="⏳" accent="warn" title="Awaiting Customer" lead="Дашборд ожидания ответа на письмо Conductor. В оригинале: awaiting-customer.html.">
        <DemoCard color="gold" title="Открыть" onClick={() => open(<AwaitingCustomer />, { shape: 'full' })} />
      </Section>
    ),
    'dir-report': () => (
      <Section icon="📊" accent="info" title="Director Report Viewer" lead="PDF-отчёт для директора с TOC и приёмкой.">
        <DemoCard color="info" title="Открыть отчёт" onClick={() => open(<DirectorReport />, { shape: 'full' })} />
      </Section>
    ),
    letter: () => (
      <Section icon="✍" accent="info" title="Letter Generator" lead="Conductor генерирует письмо заказчику с уточнениями от агентов.">
        <DemoCard color="info" title="Открыть письмо" onClick={() => open(<LetterGenerator />, { shape: 'full' })} />
      </Section>
    ),
    bigscreen: () => (
      <Section icon="📺" accent="gold" title="Big Screen — босс-дашборд" lead="Telegram-вид на ТВ в офисе. Большие цифры, ротация слайдов. Можно проецировать с DisplayPort.">
        <DemoCard color="gold" title="Запустить Big Screen" onClick={() => open(<BigScreen />, { shape: 'full' })} />
      </Section>
    ),
    pin: () => (
      <Section icon="🔒" accent="warn" title="PIN Gate — Session Lock" lead="При 10 мин простоя — fullscreen с виртуальной клавиатурой и руной.">
        <DemoCard color="warn" title="Открыть PIN gate" onClick={() => open(<PinGate />, { shape: 'full', dismissOnClick: false })} />
      </Section>
    ),
    offline: () => (
      <Section icon="🪶" accent="danger" title="Offline Guard" lead="Fullscreen «нет сети» с анимацией ворон Хугинна.">
        <DemoCard color="danger" title="Показать Offline" onClick={() => open(<OfflineGuard />, { shape: 'full' })} />
      </Section>
    ),
    welcome: () => (
      <Section icon="ᛟ" accent="gold" title="Welcome / Splash" lead="Стартовый экран. Руны, бренд, цитата дня.">
        <DemoCard color="gold" title="Открыть Welcome" onClick={() => open(<Welcome />, { shape: 'full' })} />
      </Section>
    ),
    theme: () => (
      <Section icon="🌗" accent="purple" title="Theme Selector" lead="Стартовый выбор темы. Mini-preview каждой.">
        <DemoCard color="purple" title="Выбрать тему" onClick={() => open(<ThemeSelectorModal />, { shape: 'full' })} />
      </Section>
    ),
    call: () => (
      <Section icon="📞" accent="success" title="Incoming Call" lead="Fullscreen всплывающий звонок с пульсацией кольца.">
        <DemoCard color="ok" title="Имитация звонка" onClick={() => open(<IncomingCall />, { shape: 'full' })} />
      </Section>
    )
  };
  return RENDERS[active]?.() ?? <Empty />;
}

// ═══════════════════════════════════════════════════════════════════════════
// INPUTS CATALOG
// ═══════════════════════════════════════════════════════════════════════════
function InputsCatalog({ active }) {
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const [v3, setV3] = useState(0);
  const [date, setDate] = useState('');
  const [arr, setArr] = useState([]);
  const RENDERS = {
    text: () => (
      <Showcase title="Text Input" desc="Универсальный текстовый ввод с иконкой и clear.">
        <Field label="Простой">
          <TextInput value={v1} onChange={setV1} placeholder="Введите…" />
        </Field>
        <Field label="С иконкой и clear" required>
          <TextInput icon="@" clearable value={v2} onChange={setV2} placeholder="email@..." />
        </Field>
        <Field label="С ошибкой" error="Поле обязательно">
          <TextInput value="" onChange={() => {}} placeholder="нужно заполнить" />
        </Field>
      </Showcase>
    ),
    password: () => (
      <Showcase title="Password" desc="С глазом-toggle для показа.">
        <Field label="Пароль" required help="Минимум 8 символов">
          <PasswordInput value={v1} onChange={setV1} placeholder="••••••••" />
        </Field>
      </Showcase>
    ),
    number: () => (
      <Showcase title="Number" desc="С кнопками +/− и валидацией min/max.">
        <Field label="Бригада, чел." help="От 1 до 30">
          <NumberInput value={v3} onChange={(v) => setV3(Number(v) || 0)} min={1} max={30} />
        </Field>
      </Showcase>
    ),
    money: () => (
      <Showcase title="Money" desc="Авто-форматирование 1 000 000.">
        <Field label="Сумма договора" required>
          <MoneyInput value={v1} onChange={setV1} />
        </Field>
      </Showcase>
    ),
    inn: () => (
      <Showcase title="ИНН" desc="10 цифр (юр.лицо) или 12 (ИП).">
        <Field label="ИНН" required help="Подтянем название из ЕГРЮЛ">
          <INNInput value={v1} onChange={setV1} />
        </Field>
      </Showcase>
    ),
    phone: () => (
      <Showcase title="Phone" desc="Маска +7 (___) ___-__-__.">
        <Field label="Телефон">
          <PhoneInput value={v1} onChange={setV1} />
        </Field>
      </Showcase>
    ),
    search: () => (
      <Showcase title="Search" desc="Иконка + clear-кнопка при наличии текста.">
        <Field label="Поиск">
          <SearchInput value={v1} onChange={setV1} placeholder="заказчик, тендер, тег…" />
        </Field>
      </Showcase>
    ),
    textarea: () => (
      <Showcase title="Textarea" desc="Auto-grow по содержимому (макс 10 строк).">
        <Field label="Описание объекта">
          <TextareaInput value={v1} onChange={setV1} placeholder="Подробно опишите…" />
        </Field>
      </Showcase>
    ),
    select: () => (
      <Showcase title="Select" desc="Нативный select с кастомным стилем.">
        <Field label="Тип тендера">
          <SelectInput value={v1} onChange={setV1} options={['Тендер', 'Прямой запрос', 'Доп. объём']} />
        </Field>
      </Showcase>
    ),
    combo: () => (
      <Showcase title="Combobox" desc="Select с автоподсказкой по поиску.">
        <Field label="Заказчик">
          <Combobox value={v1} onChange={setV1} options={[
            { value: 'gpn', label: 'ООО «Заказчик А»' },
            { value: 'luk', label: 'ПАО «Заказчик Б»' },
            { value: 'tat', label: 'ПАО «Заказчик В»' },
            { value: 'sng', label: 'ПАО «Сургутнефтегаз»' },
            { value: 'rosn', label: 'ПАО «Заказчик Д»' }
          ]} />
        </Field>
      </Showcase>
    ),
    multi: () => (
      <Showcase title="MultiSelect" desc="Чипы выбранных + поиск.">
        <Field label="Теги">
          <MultiSelect value={arr} onChange={setArr} options={['Заказчик А', 'Капремонт', 'Высота', 'Срочно', 'Север', '2026', 'Электрика']} />
        </Field>
      </Showcase>
    ),
    radio: () => (
      <Showcase title="RadioGroup" desc="С описаниями. На больших экранах — крупные плитки.">
        <Field label="Кто будет считать">
          <RadioGroup value={v1} onChange={setV1} options={[
            { value: 'pm', label: '👷 РП', desc: 'Полный цикл просчёта' },
            { value: 'to', label: '📊 Я сам (ТО)', desc: 'Для мелких/лёгких' }
          ]} />
        </Field>
      </Showcase>
    ),
    segmented: () => (
      <Showcase title="Segmented" desc="Iconбы + варианты в компактной плашке.">
        <Field label="Вид">
          <Segmented value={v1} onChange={setV1} options={[
            { value: 'cards', label: 'Карточки', icon: '⊞' },
            { value: 'table', label: 'Таблица', icon: '☰' },
            { value: 'kanban', label: 'Канбан', icon: '◫' }
          ]} />
        </Field>
      </Showcase>
    ),
    check: () => (
      <Showcase title="Checkbox" desc="Включая indeterminate.">
        <div className="col gap-10">
          <Checkbox checked={arr.includes('a')} onChange={(v) => setArr(v ? [...arr, 'a'] : arr.filter((x) => x !== 'a'))} label="Учитывать НДС в смете" />
          <Checkbox checked={arr.includes('b')} onChange={(v) => setArr(v ? [...arr, 'b'] : arr.filter((x) => x !== 'b'))} label="Включать командировочные" />
          <Checkbox indeterminate label="Уведомлять — частично" onChange={() => {}} />
        </div>
      </Showcase>
    ),
    switch: () => (
      <Showcase title="Switch" desc="3 размера: sm / md / lg.">
        <div className="col gap-14">
          <Switch checked={arr.includes('s')} onChange={(v) => setArr(v ? ['s'] : [])} size="sm" label="Маленький" />
          <Switch checked={arr.includes('s')} onChange={(v) => setArr(v ? ['s'] : [])} label="Средний (по умолчанию)" />
          <Switch checked={arr.includes('s')} onChange={(v) => setArr(v ? ['s'] : [])} size="lg" label="Большой" />
        </div>
      </Showcase>
    ),
    slider: () => (
      <Showcase title="Slider" desc="С показом значения и track-fill.">
        <Field label={'Маржа: ' + v3 + '%'}>
          <Slider value={v3} onChange={setV3} min={5} max={50} showValue />
        </Field>
      </Showcase>
    ),
    date: () => (
      <Showcase title="DatePicker" desc="Popover-календарь с кнопками «Сегодня» и «Очистить».">
        <Field label="Дедлайн">
          <DatePicker value={date} onChange={setDate} />
        </Field>
      </Showcase>
    ),
    rating: () => (
      <Showcase title="Rating" desc="Звёзды с hover-предпросмотром.">
        <Field label="Оценка работы">
          <Rating value={v3} onChange={setV3} />
        </Field>
      </Showcase>
    ),
    color: () => (
      <Showcase title="ColorPicker" desc="Палитра + нативный picker.">
        <Field label="Цвет тега">
          <ColorPicker value={v1} onChange={setV1} />
        </Field>
      </Showcase>
    ),
    file: () => (
      <Showcase title="FileDrop" desc="Drag&drop с превью загруженных файлов.">
        <Field label="Документы">
          <FileDrop multiple hint="Перетащите файлы или нажмите" />
        </Field>
      </Showcase>
    )
  };
  return RENDERS[active]?.() ?? <Empty />;
}

// ═══════════════════════════════════════════════════════════════════════════
// BLOCKS CATALOG
// ═══════════════════════════════════════════════════════════════════════════
function BlocksCatalog({ active }) {
  // E-1: демо-компоненты с моковыми данными (WinPanel/DistPanel/StatCardRow/FilterBar/
  // AlertStrip/ListItemRow) удалены вместе с DEMO_WON/DEMO_PMS/DEMO_DIST массивами
  // из blocks/Blocks.jsx. Каталог теперь показывает только реально используемые блоки.
  const RENDERS = {
    empty: () => (
      <div className="mc-section">
        <div className="h"><div className="ico">📭</div><h2>EmptyState</h2></div>
        <div className="lead">«Ничего нет» с опциональным CTA.</div>
        <EmptyState title="Пока пусто" hint="Здесь будут отображаться записи когда они появятся." />
      </div>
    ),
    top: () => (
      <div className="mc-section">
        <div className="h"><div className="ico">⚡</div><h2>TopActionsBar</h2></div>
        <div className="lead">Заголовок страницы + опциональные действия справа.</div>
        <TopActionsBar kicker="Раздел" title="Заголовок страницы" subtitle="Подзаголовок" />
      </div>
    ),
    tabs: () => (
      <div className="mc-section">
        <div className="h"><div className="ico">📑</div><h2>TabsBar</h2></div>
        <div className="lead">Управляемые табы. Передавай tabs/active/onChange.</div>
        <TabsBar tabs={[{ lab: 'Один' }, { lab: 'Два' }, { lab: 'Три' }]} />
      </div>
    )
  };
  return RENDERS[active]?.() ?? <Empty />;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════
function Section({ icon, accent, title, lead, children }) {
  return (
    <div className={'mc-section m-acc-' + accent}>
      <div className="h">
        <div className="ico">{icon}</div>
        <h2>{title}</h2>
      </div>
      <div className="lead">{lead}</div>
      {children}
    </div>
  );
}
function CardRow({ children }) { return <div className="mc-grid">{children}</div>; }
function DemoCard({ color = 'gold', title, desc, onClick }) {
  const grads = {
    gold: 'linear-gradient(90deg, var(--gold), var(--amber))',
    danger: 'linear-gradient(90deg, var(--red), var(--orange))',
    ok: 'linear-gradient(90deg, var(--ok), var(--cyan))',
    info: 'linear-gradient(90deg, var(--info), var(--purple))',
    purple: 'linear-gradient(90deg, var(--purple), var(--purple-l))',
    warn: 'linear-gradient(90deg, var(--amber), var(--orange))'
  };
  return (
    <button className="mc-card" style={{ '--mc-grad': grads[color] || grads.gold }} onClick={onClick}>
      <div className="ttl">{title}</div>
      {desc && <div className="desc">{desc}</div>}
    </button>
  );
}
function Showcase({ title, desc, children }) {
  return (
    <div className="mc-section">
      <div className="h">
        <div className="ico">✎</div>
        <h2>{title}</h2>
      </div>
      <div className="lead">{desc}</div>
      <div className="mw-560">{children}</div>
    </div>
  );
}
function Empty() {
  return <div className="mc-section"><div className="p-40 t-center c-t3">Выберите элемент слева</div></div>;
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIF CATALOG
// ═══════════════════════════════════════════════════════════════════════════
function NotifCatalog({ active }) {
  const [date, setDate] = useState({ from: '', to: '' });
  const [time, setTime] = useState('14:30');
  const [qty, setQty] = useState(0);

  const NOTIFS = [
    { icon: '📋', title: 'Новый тендер', message: 'Морозов Н. создал тендер для Заказчик А', when: '5 минут назад', read: false },
    { icon: '✓', title: 'Просчёт согласован', message: 'Хосе одобрил просчёт по ЛОТу 5855', when: '1 час назад', read: false },
    { icon: '💰', title: 'Аванс выдан', message: 'Бухгалтерия выдала 150 000 ₽', when: '3 часа назад', read: false },
    { icon: '🏆', title: 'Выиграли!', message: 'Тендер №728 Заказчик В — наш', when: 'Вчера', read: true }
  ];

  const RENDERS = {
    toast: () => (
      <Section icon="🔔" accent="info" title="Toast — главный паттерн уведомлений" lead="1836 использований в проекте! Выезжает справа-снизу. 5 типов: success/error/info/warn/loading. Поддерживает action-кнопку и promise.">
        <CardRow>
          <DemoCard color="ok" title="Success" onClick={() => toast.success('Тендер успешно создан', { title: 'Готово' })} />
          <DemoCard color="danger" title="Error" onClick={() => toast.error('Не удалось сохранить — попробуйте снова')} />
          <DemoCard color="info" title="Info" onClick={() => toast.info('Получено 4 новых уведомления')} />
          <DemoCard color="warn" title="Warn" onClick={() => toast.warn('Сессия истекает через 5 минут')} />
          <DemoCard color="gold" title="Loading" onClick={() => {
            const id = toast.loading('Импортируем 1 247 позиций…');
            setTimeout(() => { toast.dismiss(id); toast.success('Импорт завершён'); }, 2500);
          }} />
          <DemoCard color="purple" title="Promise" onClick={() => toast.promise(
            new Promise((r) => setTimeout(r, 2000)),
            { loading: 'Сохраняем тендер…', success: 'Тендер сохранён', error: 'Ошибка сохранения' }
          )} />
        </CardRow>
      </Section>
    ),
    banner: () => (
      <Section icon="📢" accent="gold" title="Announcement Banner" lead="Баннер новых релизов (app_updates) — лента сверху страницы.">
        <AnnouncementBanner
          version="v20.13.112"
          title="ТО считает мелкие тендеры сам"
          items={[
            { icon: '📊', text: 'При создании тендера ТО выбирает: РП или «Я сам»' },
            { icon: '🟦', text: 'Хосе одобряет одной кнопкой в distPanel' },
            { icon: '🧮', text: 'Новая страница «Мои просчёты (ТО)»' }
          ]}
        />
      </Section>
    ),
    bell: () => (
      <Section icon="🔔" accent="gold" title="NotificationBell с dropdown" lead="Колокольчик в шапке. Badge с числом непрочитанных. Popover через portal — не обрезается.">
        <div className="row gap-20 p-20">
          <NotificationBell items={NOTIFS} />
          <div className="fs-13 c-t3">← нажмите на колокольчик</div>
        </div>
      </Section>
    ),
    tooltip: () => (
      <Section icon="💬" accent="info" title="Tooltip — на hover" lead="Маленькая подсказка при наведении. Через portal, авто-flip вверх/вниз.">
        <div className="row gap-24 p-30 u-wrap">
          <Tooltip content="Простая подсказка">
            <span className="p-8 bg-inner r-8">Наведите на меня</span>
          </Tooltip>
          <Tooltip content={`Многострочная\nподсказка\nс переносами`}>
            <span className="p-8 bg-gold c-gold r-8">📋 Тендер №734</span>
          </Tooltip>
          <Tooltip content="Tooltip снизу" placement="bottom">
            <span className="p-8 bg-info c-info r-8">Снизу</span>
          </Tooltip>
        </div>
      </Section>
    ),
    psteps: () => (
      <Section icon="📊" accent="gold" title="ProgressSteps — горизонтальная панель шагов" lead="Для cash flow, согласований, wizard-процессов.">
        <ProgressSteps
          steps={['Заявка', 'Согласовано', 'Выдано', 'Получено', 'Отчёт', 'Закрыто']}
          active={2}
        />
        <div className="mt-24">
          <ProgressSteps steps={['ТЗ', 'Просчёт', 'ТКП', 'Отправлено', 'Выиграли']} active={4} />
        </div>
      </Section>
    ),
    accordion: () => (
      <Section icon="📂" accent="info" title="Accordion — раскрывающиеся секции" lead="Для FAQ, длинных секций, фильтров. Поддерживает single и multi mode.">
        <Accordion
          items={[
            {
              key: '1', icon: '📋', title: 'Как создать тендер?', meta: '3 мин чтения',
              content: 'Зайдите в раздел «Сага Тендеров», нажмите «+ Новый тендер», заполните обязательные поля и нажмите «Создать». После этого тендер появится в статусе «Новый».'
            },
            {
              key: '2', icon: '👥', title: 'Как назначить РП на просчёт?', meta: '2 мин',
              content: 'В карточке тендера выберите ответственного РП в поле «Кто будет считать». Доступно для роли HEAD_TO и выше.'
            },
            {
              key: '3', icon: '💰', title: 'Как принять аванс?', meta: '1 мин',
              content: 'Когда бухгалтерия выдаст аванс, вы получите уведомление в колокольчике и кнопку «Подтвердить получение».'
            }
          ]}
        />
      </Section>
    ),
    badge: () => (
      <Section icon="🏷" accent="default" title="StatusBadge — расширенные бейджи" lead="С иконкой и pulse-анимацией для горящих состояний.">
        <div className="row gap-10 p-14 u-wrap">
          <StatusBadge tone="draft" label="Черновик" />
          <StatusBadge tone="sent" label="Отправлено" />
          <StatusBadge tone="approved" label="Согласовано" />
          <StatusBadge tone="rework" label="На доработку" />
          <StatusBadge tone="question" label="Вопрос" />
          <StatusBadge tone="rejected" label="Отклонено" />
          <StatusBadge tone="paid" label="Оплачено" />
          <StatusBadge tone="burning" label="Горящий дедлайн" />
        </div>
      </Section>
    ),
    voice: () => (
      <Section icon="🎤" accent="gold" title="VoicePlayer — голосовое сообщение" lead="Мини-плеер с waveform для голосовых в чате. Play/pause, прогресс.">
        <div className="p-20 row gap-14 u-wrap">
          <VoicePlayer duration={23} />
          <VoicePlayer duration={45} />
        </div>
      </Section>
    ),
    stepper: () => (
      <Section icon="🔢" accent="gold" title="Stepper — счётчик количества" lead="Для корзины склада. Превращается из кнопки «+ В корзину» в [−][N][+] при первом клике.">
        <div className="p-20 row gap-20 u-wrap">
          <Stepper value={qty} onChange={setQty} unit="шт." max={100} />
          <span className="c-t3">значение: {qty}</span>
          <button className="m-btn ghost sm" onClick={() => setQty(0)}>сбросить</button>
        </div>
      </Section>
    ),
    chart: () => (
      <Section icon="📈" accent="info" title="MiniChart — sparkline в строке" lead="Тренд в одной строке таблицы. Без подписей, чисто визуальная динамика.">
        <div className="p-20 col gap-12">
          <div className="row gap-14">
            <span className="w-140">Выручка 2026</span>
            <MiniChart data={[12, 18, 15, 22, 28, 24, 32, 38]} tone="gold" />
            <span className="c-ok fw-700">+18%</span>
          </div>
          <div className="row gap-14">
            <span className="w-140">Конверсия</span>
            <MiniChart data={[28, 25, 30, 35, 33, 38, 35, 40]} tone="ok" />
            <span className="c-ok fw-700">35% ↑</span>
          </div>
          <div className="row gap-14">
            <span className="w-140">Проблемные работы</span>
            <MiniChart data={[2, 3, 5, 4, 6, 5, 7, 8]} tone="err" />
            <span className="c-err fw-700">+33%</span>
          </div>
        </div>
      </Section>
    ),
    daterange: () => (
      <Section icon="📅" accent="info" title="DateRangePicker" lead="Выбор периода. Пресеты (7д / 30д / 3мес / год) + ручной выбор.">
        <div className="mw-360 p-14">
          <DateRangePicker from={date.from} to={date.to} onChange={setDate} />
          <div className="fs-12 c-t3 mt-8">
            Выбрано: {date.from || '—'} → {date.to || '—'}
          </div>
        </div>
      </Section>
    ),
    time: () => (
      <Section icon="⏰" accent="info" title="TimePicker" lead="Выбор времени в формате HH:MM. Две колонки часов и минут.">
        <div className="mw-240 p-14">
          <TimePicker value={time} onChange={setTime} />
          <div className="fs-12 c-t3 mt-8">Выбрано: <b className="c-gold">{time}</b></div>
        </div>
      </Section>
    )
  };

  return RENDERS[active]?.() ?? <Empty />;
}
