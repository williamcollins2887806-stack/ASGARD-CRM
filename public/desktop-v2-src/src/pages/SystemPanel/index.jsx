/**
 * /system-panel — Панель сервера (ADMIN only).
 *
 * Источник: vanilla `public/assets/js/system-panel.js` (1060 LOC).
 * Backend: `src/routes/admin-system.js` + `src/routes/mimir.js`.
 *
 * Шесть табов:
 *   1. Сервер   — CPU/RAM/disk, аптайм, БД, версия Node, активные юзеры
 *   2. Логи     — SSE-стрим journalctl, фильтр по уровню, ручная загрузка
 *   3. Мимир    — AI-провайдер, статистика, последние раны Conductor
 *   4. Действия — рестарт сервиса, бамп SHELL_VERSION, рантайм-команды
 *   5. Деплои   — список последних релизов из app_updates
 *   6. Паспорт  — техническая документация CRM
 *
 * Auto-refresh для «Сервер» — каждые 6 секунд (как в vanilla).
 */
import { useState } from 'react';
import { useAuth } from '@/api/useAuth';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';

import { ADMIN_ROLE } from './api';
import ServerTab   from './tabs/Server';
import LogsTab     from './tabs/Logs';
import MimirTab    from './tabs/Mimir';
import ActionsTab  from './tabs/Actions';
import TerminalTab from './tabs/Terminal';
import DeploysTab  from './tabs/Deploys';
import PassportTab from './tabs/Passport';
import './system-panel.css';

const TABS = [
  { id: 'server',   label: '🖥 Сервер' },
  { id: 'logs',     label: '📋 Логи' },
  { id: 'mimir',    label: '🔮 Мимир' },
  { id: 'actions',  label: '⚙️ Действия' },
  { id: 'terminal', label: '💻 Терминал' },
  { id: 'deploys',  label: '🚀 Деплои' },
  { id: 'passport', label: '📖 Паспорт' }
];

const TAB_HINTS = {
  server:   'Реальная статистика сервера: CPU/RAM/Disk, БД, активные сессии',
  logs:     'journalctl сервиса asgard-crm — стрим в реальном времени и ручная выборка',
  mimir:    'Состояние AI-провайдеров, статистика индекса, последние раны Conductor',
  actions:  'Опасные операции — перезапуск, бамп версии, рантайм-команды (только ADMIN!)',
  terminal: 'Полноценный bash через WebSocket+node-pty (xterm.js). Только ADMIN.',
  deploys:  'История релизов из таблицы app_updates',
  passport: 'Техническая документация системы — стэк, сервер, БД, cron-задачи'
};

export default function SystemPanelPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('server');

  if (!user) return null;
  if (user.role !== ADMIN_ROLE) {
    return (
      <div className="col gap-12">
        <TopActionsBar kicker="Раздел" title="Панель сервера" />
        <EmptyState
          icon="🔒"
          title="Нет доступа"
          hint="Раздел доступен только администраторам."
        />
      </div>
    );
  }

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Раздел"
        title="⚡ Панель сервера"
        subtitle="АСГАРД CRM — мониторинг и управление"
      />

      <TabsBar tabs={TABS} active={tab} onChange={setTab} />
      <div className="sysp-tab-hint">{TAB_HINTS[tab]}</div>

      <div className="page-content sysp-content">
        {tab === 'server'   && <ServerTab />}
        {tab === 'logs'     && <LogsTab />}
        {tab === 'mimir'    && <MimirTab />}
        {tab === 'actions'  && <ActionsTab />}
        {tab === 'terminal' && <TerminalTab />}
        {tab === 'deploys'  && <DeploysTab />}
        {tab === 'passport' && <PassportTab />}
      </div>
    </div>
  );
}
