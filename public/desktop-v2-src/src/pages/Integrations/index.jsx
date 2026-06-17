/**
 * Страница /integrations — три вкладки в одном SPA-модуле.
 * Источник: vanilla `public/assets/js/integrations.js` (~488 строк).
 *
 *   ✅ index.jsx           — корень + табы Bank/Platforms/ERP
 *   ✅ api.js              — все endpoints + helpers
 *   ✅ BankTab.jsx         — стата, загрузка выписки, транзакции, правила, экспорт 1С
 *   ✅ PlatformsTab.jsx    — стата, парсинг писем, детали площадки, создание заявки
 *   ✅ ErpTab.jsx          — подключения, тест, экспорт, логи синхронизации
 *   ✅ integrations.css    — стили
 *
 * RBAC (см. nav.config): ADMIN, BUH, DIRECTOR_*, HEAD_TO, TO.
 */
import { useState } from 'react';
import { TopActionsBar, TabsBar } from '@/blocks/Blocks';

import { BankTab } from './BankTab';
import { PlatformsTab } from './PlatformsTab';
import { ErpTab } from './ErpTab';
import './integrations.css';

const TABS = [
  { id: 'bank',      label: '🏦 Банк / 1С' },
  { id: 'platforms', label: '🏗 Площадки' },
  { id: 'erp',       label: '🔗 ERP' }
];

export default function IntegrationsPage() {
  const [tab, setTab] = useState('bank');

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Связи"
        title="Интеграции"
        subtitle="Банк, 1С, тендерные площадки, ERP"
        actions={null}
      />

      <TabsBar tabs={TABS} active={tab} onChange={setTab} />

      <div>
        {tab === 'bank'      && <BankTab key="bank" />}
        {tab === 'platforms' && <PlatformsTab key="platforms" />}
        {tab === 'erp'       && <ErpTab key="erp" />}
      </div>
    </div>
  );
}
