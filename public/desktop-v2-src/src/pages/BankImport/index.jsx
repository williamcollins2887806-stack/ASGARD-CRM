/**
 * Страница /bank-import — Импорт банковских выписок.
 * Vanilla source: `public/assets/js/bank_import.js` (621 строк) — полный перенос.
 *
 * Vanilla coverage checklist:
 *   ✓ Загрузка файла выписки (CSV/TXT/1С) — UploadModal + FileDrop
 *   ✓ AI-парсинг + автоклассификация — backend `/upload` (rules + AI)
 *   ✓ Список транзакций + фильтры/поиск/пагинация — TransactionsList
 *   ✓ Редактирование транзакции — TransactionDetail
 *   ✓ Массовая классификация — bulk-classify
 *   ✓ Распределение по работам — DistributeModal (single+bulk)
 *   ✓ Пачки импорта (batches) — BatchesList
 *   ✓ CRUD правил классификации — RulesList + RuleEditor
 *   ✓ Экспорт 1С / Excel — ExportPanel
 *   ✓ Статистика (доходы/расходы/баланс/неразнесённые) — StatsBar
 *
 * RBAC: ADMIN, BUH, DIRECTOR_GEN, DIRECTOR_COMM, DIRECTOR_DEV (см. BANK_ROLES backend).
 */
import { useEffect, useState, useCallback } from 'react';
import { useModal } from '@/modals';
import { TopActionsBar, TabsBar } from '@/blocks/Blocks';
import { Btn } from '@/modals/parts';
import { toast } from '@/modals/Notifications';

import { loadStats, fmtMoney } from './api';
import UploadModal from './UploadModal';
import TransactionsList from './TransactionsList';
import BatchesList from './BatchesList';
import RulesList from './RulesList';
import ExportPanel from './ExportPanel';
import './bank-import.css';

const TABS = [
  { id: 'tx',      label: '📋 Транзакции' },
  { id: 'batches', label: '📦 Пачки' },
  { id: 'rules',   label: '⚙️ Правила' },
  { id: 'export',  label: '📤 Экспорт' }
];

function StatsBar({ stats }) {
  const s = stats || {};
  return (
    <div className="bi-stats">
      <div className="bi-stat">
        <div className="val c-ok">{fmtMoney(s.total_income || 0)}</div>
        <div className="lbl">Доходы</div>
      </div>
      <div className="bi-stat">
        <div className="val c-err">{fmtMoney(s.total_expense || 0)}</div>
        <div className="lbl">Расходы</div>
      </div>
      <div className="bi-stat">
        <div className="val c-gold">{fmtMoney(s.balance || 0)}</div>
        <div className="lbl">Баланс</div>
      </div>
      <div className="bi-stat">
        <div className="val c-amber">{s.unclassified_count || 0}</div>
        <div className="lbl">Неразнесённых</div>
      </div>
    </div>
  );
}

export default function BankImportPage() {
  const modal = useModal();
  const [tab, setTab] = useState('tx');
  const [stats, setStats] = useState(null);
  const [version, setVersion] = useState(0);   // bump → перезагрузка дочерних вкладок

  const refreshStats = useCallback(() => {
    loadStats()
      .then((s) => setStats(s?.success ? s : (s || {})))
      .catch(() => setStats(null));
  }, []);

  useEffect(() => { refreshStats(); }, [refreshStats]);

  const refreshAll = useCallback(() => {
    refreshStats();
    setVersion((v) => v + 1);
  }, [refreshStats]);

  const onUpload = () => {
    modal.open(
      <UploadModal
        onDone={() => {
          refreshAll();
          setTab('tx');
          toast.success('Выписка загружена — проверьте транзакции');
        }}
      />,
      { size: 'wide' }
    );
  };

  return (
    <div className="col gap-12">
      <TopActionsBar
        kicker="Финансы"
        title="📄 Импорт банковских выписок"
        subtitle="CSV / TXT (1С, Тинькофф, Сбер, Точка) → авто-классификация → разноска по работам"
        actions={
          <>
            <Btn variant="ghost" onClick={refreshAll}>↻ Обновить</Btn>
            <Btn variant="primary" onClick={onUpload}>📥 Загрузить выписку</Btn>
          </>
        }
      />

      <StatsBar stats={stats} />

      <TabsBar tabs={TABS} active={tab} onChange={setTab} />

      <div>
        {tab === 'tx'      && <TransactionsList key={'tx-' + version}      onChanged={refreshAll} />}
        {tab === 'batches' && <BatchesList     key={'batches-' + version} />}
        {tab === 'rules'   && <RulesList       key={'rules-' + version}    onChanged={refreshAll} />}
        {tab === 'export'  && <ExportPanel     stats={stats} />}
      </div>
    </div>
  );
}
