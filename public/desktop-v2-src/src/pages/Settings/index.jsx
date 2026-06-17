/**
 * Страница /settings — Кузница Настроек.
 * Источник: vanilla `public/assets/js/settings.js` (~761 строка) +
 * backend `src/routes/settings.js` (GET / / refs/all / :key, PUT/DELETE).
 *
 * RBAC: только ADMIN + DIRECTOR_* (см. EDIT_ROLES в api.js).
 *
 * Структура: 6 табов
 *   1. Система           — НДС/Гант/корреспонденция/чекбоксы
 *   2. SLA и лимиты      — дедлайны, рабочие дни, лимиты РП, расписания
 *   3. Калькулятор       — нормы прибыли, налоги, ставки, JSON роли/химия/транспорт
 *   4. Справочники       — статусы/причины/допуска (textarea построчно)
 *   5. Компания          — реквизиты профиля
 *   6. Цвета статусов    — офис и рабочие, для календарей
 *
 * Сохранение — один POST PUT в /api/settings/app + /api/settings/refs.
 */
import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';

import {
  EDIT_ROLES, DEFAULT_APP, DEFAULT_REFS,
  loadAllSettings, saveKey, deepMerge
} from './api';
import SystemTab from './tabs/SystemTab';
import SlaTab from './tabs/SlaTab';
import CalculatorTab from './tabs/CalculatorTab';
import RefsTab from './tabs/RefsTab';
import CompanyTab from './tabs/CompanyTab';
import ColorsTab from './tabs/ColorsTab';
import SecurityTab from './tabs/SecurityTab';
import { ChangePasswordModal } from './modals/ChangePasswordModal';
import { ChangePinModal } from './modals/ChangePinModal';
import './settings.css';

const TABS = [
  { id: 'system',   label: '⚙️ Система' },
  { id: 'sla',      label: '🛡 SLA и лимиты' },
  { id: 'calc',     label: '🧮 Калькулятор' },
  { id: 'refs',     label: '📚 Справочники' },
  { id: 'company',  label: '🏢 Компания' },
  { id: 'colors',   label: '🎨 Цвета статусов' },
  { id: 'security', label: '🔐 AI и безопасность' }
];

const TAB_HINTS = {
  system:   'НДС, дата старта Ганта, корреспонденция, чекбоксы поведения',
  sla:      'Дедлайны SLA, рабочие часы, лимиты РП, расписания',
  calc:     'Нормы прибыли, налоги, ставки ролей, химия, транспорт',
  refs:     'Справочные значения: статусы, причины, допуска',
  company:  'Реквизиты компании-носителя CRM',
  colors:   'Палитра статусов для календарей и канбанов',
  security: 'AI-ассистент (YandexGPT и др.), push-уведомления, биометрия и ключи'
};

export default function SettingsPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [tab, setTab] = useState('system');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [app, setApp] = useState(DEFAULT_APP);
  const [refs, setRefs] = useState(DEFAULT_REFS);

  const canEdit = useMemo(() => EDIT_ROLES.includes(user?.role), [user]);

  const refresh = () => {
    setLoading(true);
    loadAllSettings()
      .then((all) => {
        const nextApp = deepMerge(DEFAULT_APP, all.app || {});
        const nextRefs = deepMerge(DEFAULT_REFS, all.refs || {});
        setApp(nextApp);
        setRefs(nextRefs);
      })
      .catch((e) => toast.error('Не удалось загрузить настройки: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) refresh(); }, [user?.id]);

  const onSave = async () => {
    if (!canEdit) {
      toast.warn('Сохранять может только ADMIN или директор');
      return;
    }
    setSaving(true);
    try {
      await saveKey('app', app);
      await saveKey('refs', refs);
      toast.success('Настройки сохранены');
    } catch (e) {
      toast.error('Не удалось сохранить: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const onReset = () => {
    modal.open(
      <ConfirmModal
        title="Сбросить настройки?"
        message="Все параметры (app + refs) вернутся к заводским значениям. Действие необратимо."
        tone="warn"
        okText="Сбросить"
        cancelText="Отмена"
        onConfirm={async () => {
          try {
            await saveKey('app', DEFAULT_APP);
            await saveKey('refs', DEFAULT_REFS);
            setApp(DEFAULT_APP);
            setRefs(DEFAULT_REFS);
            toast.success('Сброшено к заводским настройкам');
          } catch (e) {
            toast.error('Не удалось сбросить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  if (loading) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Раздел" title="Кузница Настроек" />
        <div className="card card-empty" >
          ⏳ Загружаем настройки…
        </div>
      </div>
    );
  }

  // Смена пароля/PIN доступна всем авторизованным.
  const openChangePassword = () => modal.open(<ChangePasswordModal />);
  const openChangePin = () => modal.open(<ChangePinModal />);

  if (!canEdit) {
    // Не админ/директор — показываем минимальный «Личный кабинет»:
    // карточку профиля + кнопки смены пароля и PIN.
    return (
      <div className="col gap-12">
        <TopActionsBar
          kicker="Раздел"
          title="Кузница Настроек"
          subtitle="Личный кабинет"
        />
        <div className="sett-account-card">
          <div className="sett-account-head">
            <div className="sett-account-avatar">👤</div>
            <div>
              <div className="sett-account-name">{user?.name || user?.login || 'Пользователь'}</div>
              <div className="sett-account-role">Роль: {user?.role || '—'}</div>
            </div>
          </div>
          <div className="sett-account-actions">
            <Btn variant="primary" onClick={openChangePassword}>🔐 Сменить пароль</Btn>
            <Btn variant="primary" onClick={openChangePin}>🔢 Сменить PIN</Btn>
          </div>
          <EmptyState
            icon="🔒"
            title="Системные параметры недоступны"
            hint="Настройки CRM, SLA, калькулятора и справочников — только ADMIN/директорам."
          />
        </div>
      </div>
    );
  }

  const companyName = app?.company?.short_name || app?.company?.name || 'АСГАРД CRM';
  const theme = (typeof document !== 'undefined') && document.documentElement.getAttribute('data-theme');
  const isLight = theme === 'light';

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Раздел"
        title="Кузница Настроек"
        subtitle="Параметры системы, SLA, калькулятор, справочники"
        actions={
          <>
            <Btn variant="ghost" onClick={openChangePassword}>🔐 Сменить пароль</Btn>
            <Btn variant="ghost" onClick={openChangePin}>🔢 Сменить PIN</Btn>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            <Btn variant="ghost" onClick={onReset}>Сбросить к дефолту</Btn>
            <Btn onClick={onSave} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Btn>
          </>
        }
      />

      {/* Hero «Текущий профиль системы» */}
      <div className="sett-hero">
        <div className="sett-hero-ic">⚒</div>
        <div className="sett-hero-body">
          <div className="sett-hero-kicker">Текущий профиль системы</div>
          <div className="sett-hero-title">{companyName}</div>
          <div className="sett-hero-sub">
            Режим: <b>{isLight ? 'Светлая тема' : 'Тёмная тема'}</b> · НДС <b>{app?.vat_pct ?? 22}%</b> ·
            Старт Ганта <b>{app?.gantt_start_iso ? new Date(app.gantt_start_iso).toLocaleDateString('ru-RU') : '—'}</b>
          </div>
        </div>
        <div className="sett-hero-meta">
          <div className="sett-hero-meta-row">
            <span className="sett-hero-meta-lab">Пользователь</span>
            <span className="sett-hero-meta-val">{user?.name || user?.login || '—'}</span>
          </div>
          <div className="sett-hero-meta-row">
            <span className="sett-hero-meta-lab">Роль</span>
            <span className="sett-hero-meta-val">{user?.role || '—'}</span>
          </div>
        </div>
      </div>

      <TabsBar
        tabs={TABS}
        active={tab}
        onChange={setTab}
      />

      <div className="sett-tab-hint">{TAB_HINTS[tab]}</div>

      <div className="page-content sett-page-content">
        {tab === 'system'   && <SystemTab app={app} setApp={setApp} />}
        {tab === 'sla'      && <SlaTab    app={app} setApp={setApp} refs={refs} />}
        {tab === 'calc'     && <CalculatorTab app={app} setApp={setApp} />}
        {tab === 'refs'     && <RefsTab   refs={refs} setRefs={setRefs} />}
        {tab === 'company'  && <CompanyTab app={app} setApp={setApp} />}
        {tab === 'colors'   && <ColorsTab app={app} setApp={setApp} />}
        {tab === 'security' && <SecurityTab user={user} />}
      </div>

      <div className="sett-toolbar mt-8" >
        <Btn variant="ghost" onClick={onReset}>Сбросить к дефолту</Btn>
        <Btn onClick={onSave} disabled={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Btn>
      </div>
    </div>
  );
}
