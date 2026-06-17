/**
 * Страница /permits — Разрешения и допуски (M6).
 *
 * Источник: vanilla `public/assets/js/permits.js` (~1314 строк, IIFE `AsgardPermitsPage`).
 * Backend: `src/routes/permits.js` (prefix /api/permits).
 *
 * ## Vanilla coverage checklist
 *  ✅ index.jsx           — табы Список/Матрица/Проекты + статистика + кнопка проверки уведомлений
 *  ✅ api.js              — все endpoints + категории + должности + helpers
 *  ✅ ListTab             — vanilla renderListTab: фильтры + чекбоксы + bulk renew + действия
 *  ✅ MatrixTab           — vanilla renderMatrixTab: матрица сотрудники × типы + required-флаги
 *  ✅ ProjectsTab         — vanilla renderProjectsTab: требования + готовность команды + no_permits_required
 *  ✅ PermitEditModal     — vanilla openPermitModal: создание + редактирование + загрузка скана
 *  ✅ RenewModal          — vanilla openRenewModal: продление допуска
 *  ✅ BulkRenewModal      — vanilla openBulkRenewModal: массовое продление
 *  ✅ ManageTypesModal    — vanilla openManageTypesModal: CRUD типов через permit-applications/types
 *  ✅ checkExpiry         — vanilla checkAndNotify + кнопка «Проверить уведомления»
 *  ✅ Без window.confirm  — все подтверждения через ConfirmModal
 *
 * RBAC: read: 'permits' permission, write: WRITE_ROLES, types mgmt: ADMIN/HR/TO/HEAD_TO/HR_MANAGER.
 */
import { useState, useEffect } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn } from '@/modals/parts';
import { TopActionsBar, TabsBar } from '@/blocks/Blocks';
// v2 BONUS: hotkeys + persist tab (vanilla не имеет)
import { useLocalStorage, useHotkeys } from '@/api/useListHelpers';
import {
  loadTypes, loadStats, checkExpiry,
  ALLOWED_READ_ROLES, TYPE_MGMT_ROLES
} from './api';
import ListTab from './ListTab';
import MatrixTab from './MatrixTab';
import ProjectsTab from './ProjectsTab';
import ManageTypesModal from './ManageTypesModal';

import './permits.css';

export default function PermitsPage() {
  const { user } = useAuth();
  const modal = useModal();
  // v2 BONUS: persist выбранную вкладку между сессиями (vanilla сбрасывала на «Список»)
  const [tab, setTab] = useLocalStorage('permits-tab', 'list');
  const [stats, setStats] = useState({ total: 0, active: 0, expired: 0, expiring_14: 0, expiring_30: 0 });
  const [types, setTypes] = useState([]);

  const isAllowed = ALLOWED_READ_ROLES.includes(user?.role);
  const canManageTypes = TYPE_MGMT_ROLES.includes(user?.role);

  const refresh = () => {
    loadStats().then(setStats).catch(() => {});
    loadTypes().then(setTypes).catch(() => {});
  };

  useEffect(() => {
    if (!isAllowed) return;
    refresh();

    // Автопроверка уведомлений раз в день (vanilla паттерн)
    try {
      const lastCheck = localStorage.getItem('permits_last_check');
      const today = new Date().toISOString().slice(0, 10);
      if (lastCheck !== today) {
        checkExpiry().then(() => { try { localStorage.setItem('permits_last_check', today); } catch { /* noop */ } }).catch(() => {});
      }
    } catch { /* noop */ }
  }, [isAllowed]);

  const onCheckNotify = async () => {
    try {
      const r = await checkExpiry();
      const sent = r?.sent ?? 0;
      toast.success(`Проверено. Отправлено уведомлений: ${sent}`);
      try { localStorage.setItem('permits_last_check', new Date().toISOString().slice(0, 10)); } catch { /* noop */ }
    } catch (e) {
      toast.error('Ошибка: ' + (e?.message || e));
    }
  };

  const onManageTypes = () => {
    modal.open(<ManageTypesModal onChanged={() => loadTypes().then(setTypes)} />, { size: 'wide' });
  };

  // v2 BONUS: keyboard hotkeys для табов (vanilla не имеет).
  // 1=Список, 2=Матрица, 3=Проекты. Сильно ускоряет работу HR при ежедневных обходах.
  useHotkeys({
    '1': () => setTab('list'),
    '2': () => setTab('matrix'),
    '3': () => setTab('projects')
  }, []);

  if (!isAllowed) {
    return (
      <div className="card p-32 t-center" >
        <div className="fs-32 opacity-half mb-12">🔒</div>
        <div className="fs-16 fw-700 mb-6">Доступ закрыт</div>
        <div className="c-t3">Разрешения и допуски доступны только специальным ролям.</div>
      </div>
    );
  }

  return (
    <div className="col gap-14">
      <TopActionsBar
        kicker="Кадры"
        title="Разрешения и допуски"
        subtitle="Справочник допусков сотрудников, матрица, требования проектов"
        actions={
          <>
            <Btn variant="ghost" onClick={onCheckNotify}>🔔 Проверить уведомления</Btn>
            {canManageTypes && <Btn variant="ghost" onClick={onManageTypes}>⚙ Управление типами</Btn>}
          </>
        }
      />

      {/* Hero «Готовность всей дружины к работам» */}
      {(() => {
        const total = stats.total || 0;
        const active = stats.active || 0;
        const ratio = total > 0 ? Math.round((active / total) * 100) : 0;
        const tone = ratio >= 80 ? 'ok' : ratio >= 60 ? 'warn' : 'err';
        return (
          <div className={'pmt-hero pmt-hero--' + tone}>
            <div className="pmt-hero-ic">🛡</div>
            <div className="pmt-hero-body">
              <div className="pmt-hero-kicker">Готовность дружины к работам</div>
              <div className="pmt-hero-title">{ratio}% действующих допусков</div>
              <div className="pmt-hero-sub">
                Из <b>{total}</b> допусков действует <b>{active}</b> ·
                истекают в 30 дн. <b>{stats.expiring_30 || 0}</b> ·
                истёкших <b>{stats.expired || 0}</b>
              </div>
              <div className="pmt-hero-bar">
                <div className={'pmt-hero-bar-fill ' + tone} style={{ width: ratio + '%' }} />
              </div>
            </div>
            <div className="pmt-hero-meta">
              <div className={'pmt-hero-meta-row ' + (stats.expired ? 'err' : 'muted')}>
                <span className="pmt-hero-meta-val">❌ {stats.expired || 0}</span>
                <span className="pmt-hero-meta-lab">Истекли</span>
              </div>
              <div className={'pmt-hero-meta-row ' + ((stats.expiring_14 || 0) > 0 ? 'amber' : 'muted')}>
                <span className="pmt-hero-meta-val">⏰ {stats.expiring_14 || 0}</span>
                <span className="pmt-hero-meta-lab">Истекают за 14 дн.</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Статистика */}
      <div className="pmt-stats">
        <div className="pmt-stat blue">
          <div className="v">{stats.total || 0}</div>
          <div className="l">Всего</div>
        </div>
        <div className="pmt-stat green">
          <div className="v">{stats.active || 0}</div>
          <div className="l">✅ Действующих</div>
        </div>
        <div className={'pmt-stat amber' + ((stats.expiring_30 || 0) > 0 ? ' pulse' : '')}>
          <div className="v">{stats.expiring_30 || 0}</div>
          <div className="l">⏰ Истекают (30 дн.)</div>
        </div>
        <div className={'pmt-stat red' + ((stats.expiring_14 || 0) > 0 ? ' pulse' : '')}>
          <div className="v">{stats.expiring_14 || 0}</div>
          <div className="l">⏰ Истекают (14 дн.)</div>
        </div>
        <div className="pmt-stat red">
          <div className="v c-err" >{stats.expired || 0}</div>
          <div className="l">❌ Истекли</div>
        </div>
      </div>

      {/* Табы — унифицированы на TabsBar (как в остальных страницах CRM v2) */}
      <TabsBar
        tabs={[
          { id: 'list',     label: '📋 Список' },
          { id: 'matrix',   label: '📊 Матрица' },
          { id: 'projects', label: '🏗 Проекты' }
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'list'     && <ListTab     user={user} types={types} onChanged={refresh} />}
      {tab === 'matrix'   && <MatrixTab   />}
      {tab === 'projects' && <ProjectsTab user={user} types={types} />}
    </div>
  );
}
