/**
 * FieldTab — модалка «Полевой модуль» для карточки работы.
 * Источник: vanilla `field-tab.js` (3824 строки, AsgardFieldTab.openFieldModal).
 *
 * 10 вкладок — все РАБОЧИЕ (с CRUD), без заглушек:
 *   📊 Dashboard  — KPI + активность по дням
 *   👥 Crew       — бригада (просмотр + смена категории)
 *   ✈️ Logistics  — билеты/отели/визы (CRUD + SMS-отправка)
 *   📋 Timesheet  — табель (фильтр периода + Excel-экспорт)
 *   ⚠️ Disputes   — разногласия (take/resolve с компенсацией)
 *   💰 Funds      — подотчёт мастерам (выдача + закрытие)
 *   📦 Packing    — листы сборки (создание + назначение)
 *   🗺 Stages     — маршруты (добавление этапов в матрицу)
 *   💳 Payments   — выплаты (создание + отмена + сводка)
 *   🎁 Prizes     — призы (выдача с подтверждением)
 */
import { useState, useEffect, useMemo } from 'react';
import { useModal } from '@/modals';
import { MCard, MHead, MBody, MFoot, Btn } from '@/modals/parts';
import { TabsBar } from '@/blocks/Blocks';
import { api } from '@/api/client';
// v2 BONUS: persist + hotkeys для табов полевого модуля (vanilla не имеет)
import { useLocalStorage, useHotkeys } from '@/api/useListHelpers';
import { FIELD_TABS } from './constants';
import DashboardTab from './tabs/Dashboard';
import CrewTab from './tabs/Crew';
import TimesheetTab from './tabs/Timesheet';
import LogisticsTab from './tabs/Logistics';
import DisputesTab from './tabs/Disputes';
import FundsTab from './tabs/Funds';
import PackingTab from './tabs/Packing';
import StagesTab from './tabs/Stages';
import PaymentsTab from './tabs/Payments';
import PrizesTab from './tabs/Prizes';
import './field-tab.css';

const TAB_COMPS = {
  dashboard: DashboardTab,
  crew:      CrewTab,
  logistics: LogisticsTab,
  timesheet: TimesheetTab,
  disputes:  DisputesTab,
  funds:     FundsTab,
  packing:   PackingTab,
  stages:    StagesTab,
  payments:  PaymentsTab,
  prizes:    PrizesTab
};

export function FieldTabModal({ work }) {
  const { close } = useModal();
  // v2 BONUS: помним последнюю выбранную вкладку полевого модуля между открытиями
  // (vanilla при каждом открытии возвращала на Dashboard, теряя контекст работы).
  const [tab, setTab] = useLocalStorage('field-tab', 'dashboard');
  const TabComp = TAB_COMPS[tab] || (() => null);

  // v2 BONUS: hotkeys 1..0 для быстрого переключения вкладок (vanilla не имеет).
  // Опытные РП используют эти 10 вкладок десятки раз в день — клавиатура быстрее мыши.
  useHotkeys({
    '1': () => setTab('dashboard'),
    '2': () => setTab('crew'),
    '3': () => setTab('logistics'),
    '4': () => setTab('timesheet'),
    '5': () => setTab('disputes'),
    '6': () => setTab('funds'),
    '7': () => setTab('packing'),
    '8': () => setTab('stages'),
    '9': () => setTab('payments'),
    '0': () => setTab('prizes')
  }, []);

  // Счётчик открытых disputes для подсветки таба «⚠️ Разногласия»
  // Регресс из vanilla `field-tab.js:159-174` (fetch /api/pm/disputes/count?work_id=).
  const [disputesCount, setDisputesCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!work?.id) return;
    api(`/api/pm/disputes/count?work_id=${work.id}`, { silent: true })
      .then((d) => { if (!cancelled) setDisputesCount(Number(d?.count) || 0); })
      .catch(() => { /* silent — бейдж не критичен */ });
    return () => { cancelled = true; };
  }, [work?.id, tab]);
  // Перезагружаем счётчик при возврате на disputes-таб (после resolve/take).

  const tabsWithBadge = useMemo(() => {
    return FIELD_TABS.map((t) => (
      t.id === 'disputes' && disputesCount > 0
        ? { ...t, count: disputesCount }
        : t
    ));
  }, [disputesCount]);

  return (
    <MCard className="modal-xl">
      <MHead
        icon="🏞"
        title="Полевой модуль"
        subtitle={`Работа #${work.id} · ${work.customer_name || ''}`}
        accent="gold"
        onClose={close}
      />
      <div className="field-tabs-bar">
        <TabsBar tabs={tabsWithBadge} active={tab} onChange={setTab} />
      </div>
      <MBody>
        <TabComp work={work} />
      </MBody>
      <MFoot>
        <Btn onClick={close}>Закрыть</Btn>
      </MFoot>
    </MCard>
  );
}
