/**
 * Страница /travel — Логистика дружины (билеты, жильё, направления МО, обучение).
 * Источник: vanilla `public/assets/js/travel.js`.
 *
 *   ✅ index.jsx              — root + KPI + табы + поиск + грид + действия
 *   ✅ api.js                 — endpoints + типы/табы/helpers
 *   ✅ TravelAddModal.jsx     — создание (тип/сотрудник/маршрут/даты/сумма/файл/доп.поля)
 *   ✅ TravelUploadModal.jsx  — прикрепить файл к существующей записи
 *
 * Действия со строкой:
 *   • 📎 Файл       → TravelUploadModal
 *   • ✅ Куплено    → POST /api/field/logistics/:id/purchased
 *   • 📨 Отправить  → POST /api/field/logistics/:id/send (SMS+Push, шаблоны по типу)
 *   • 🗑 Удалить    → ConfirmModal → DELETE /api/field/logistics/:id (каскадно расход + файл)
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/api/useAuth';
import { useModal, ConfirmModal } from '@/modals';
import { toast } from '@/modals/Notifications';
import { Btn, Pill } from '@/modals/parts';
import { TopActionsBar, TabsBar, EmptyState } from '@/blocks/Blocks';
import { SearchInput } from '@/inputs/Inputs';
// v2 BONUS: LS-persist tab + hotkeys (vanilla не имеет)
import { useDebounce, useLocalStorage, useHotkeys, exportToCsv } from '@/api/useListHelpers';

import {
  ALLOWED_ROLES, TAB_DEFS,
  typeLabel, statusInfo, fmtDate, formatRubFromAmount,
  loadLogistics, loadEmployees, loadWorks,
  markPurchased, sendToEmployee, deleteLogistics
} from './api';
import { TravelAddModal } from './TravelAddModal';
import { TravelUploadModal } from './TravelUploadModal';
import './travel.css';

export default function TravelPage() {
  const { user } = useAuth();
  const modal = useModal();

  const [items, setItems] = useState([]);
  const [works, setWorks] = useState([]);
  const [employees, setEmployees] = useState([]);
  // v2 BONUS: помним последнюю активную вкладку между сессиями (vanilla сбрасывала на tickets)
  const [activeTab, setActiveTab] = useLocalStorage('travel-tab', 'tickets');
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 300);  // G-11: debounce 300мс
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  // RBAC
  useEffect(() => {
    if (user && !ALLOWED_ROLES.includes(user.role)) {
      setDenied(true);
    }
  }, [user]);

  const refresh = useCallback(() => {
    if (denied) return;
    setLoading(true);
    Promise.all([loadLogistics(), loadEmployees(), loadWorks()])
      .then(([list, emps, ws]) => {
        setItems(list);
        setEmployees(emps);
        setWorks(ws);
      })
      .catch((e) => toast.error('Не удалось загрузить логистику: ' + (e?.message || e)))
      .finally(() => setLoading(false));
  }, [denied]);

  useEffect(() => { refresh(); }, [refresh]);

  const empMap = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
  const workMap = useMemo(() => Object.fromEntries(works.map((w) => [w.id, w])), [works]);

  const tabCounts = useMemo(() => {
    const counts = {};
    for (const tab of TAB_DEFS) {
      counts[tab.id] = items.filter((it) => tab.types.includes(it.item_type)).length;
    }
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    const tab = TAB_DEFS.find((t) => t.id === activeTab);
    if (!tab) return [];
    const q = dSearch.trim().toLowerCase();
    return items.filter((it) => {
      if (!tab.types.includes(it.item_type)) return false;
      if (!q) return true;
      const emp = empMap[it.employee_id];
      const work = workMap[it.work_id];
      return (
        String(it.title || '').toLowerCase().includes(q) ||
        String(it.description || '').toLowerCase().includes(q) ||
        String(emp?.fio || it.fio || '').toLowerCase().includes(q) ||
        String(work?.work_title || it.work_title || '').toLowerCase().includes(q)
      );
    });
  }, [items, activeTab, dSearch, empMap, workMap]);

  const totals = useMemo(() => {
    const totalAmount = items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
    const sent = items.filter((i) => i.sent_to_employee).length;
    const waiting = items.filter((i) => !i.sent_to_employee && i.status !== 'cancelled').length;
    return { totalAmount, sent, waiting };
  }, [items]);

  const onAdd = () => {
    modal.open(
      <TravelAddModal
        employees={employees}
        works={works}
        onSaved={(type) => {
          const tabForType = TAB_DEFS.find((t) => t.types.includes(type));
          if (tabForType) setActiveTab(tabForType.id);
          refresh();
        }}
      />,
      { size: 'wide' }
    );
  };

  const onUpload = (id) => modal.open(<TravelUploadModal logisticsId={id} onUploaded={refresh} />);

  const onPurchased = async (id) => {
    try {
      await markPurchased(id);
      toast.success('Отмечено как куплено');
      refresh();
    } catch (e) {
      toast.error('Не удалось: ' + (e?.message || e));
    }
  };

  const onSend = async (id) => {
    try {
      const r = await sendToEmployee(id);
      const parts = [];
      if (r?.sms_sent) parts.push('SMS');
      if (r?.push_sent) parts.push('Push');
      toast.success('Уведомление: ' + (parts.join(' + ') || 'сохранено'));
      refresh();
    } catch (e) {
      toast.error('Не удалось отправить: ' + (e?.message || e));
    }
  };

  // v2 BONUS: CSV-экспорт текущего таба (vanilla не имеет — бухгалтерия просила выгружать
  // авиабилеты в Excel для сверки с поставщиком).
  const onExportCsv = () => {
    if (!filtered.length) { toast.warn('Нет записей для экспорта'); return; }
    const ymd = new Date().toISOString().slice(0, 10);
    exportToCsv(`travel-${activeTab}-${ymd}.csv`, filtered, [
      { key: 'id', label: 'ID' },
      { key: 'item_type', label: 'Тип', format: typeLabel },
      { key: 'title', label: 'Название' },
      { key: 'description', label: 'Описание' },
      { key: (r) => empMap[r.employee_id]?.fio || r.fio || '', label: 'Сотрудник' },
      { key: (r) => workMap[r.work_id]?.work_title || r.work_title || '', label: 'Работа' },
      { key: 'date_from', label: 'С', format: fmtDate },
      { key: 'date_to', label: 'По', format: fmtDate },
      { key: 'amount', label: 'Сумма ₽' },
      { key: 'status', label: 'Статус' },
      { key: (r) => r.sent_to_employee ? 'да' : 'нет', label: 'Отправлено' }
    ]);
    toast.success(`Экспортировано ${filtered.length} записей`);
  };

  // v2 BONUS: hotkeys — / поиск, Ctrl+N добавить, Ctrl+E экспорт, 1..6 — табы.
  useHotkeys({
    '/': () => {
      const inp = document.querySelector('.tl-page input[type=text]');
      if (inp) inp.focus();
    },
    'mod+n': () => onAdd(),
    'mod+e': () => onExportCsv(),
    '1': () => setActiveTab(TAB_DEFS[0]?.id || 'tickets'),
    '2': () => setActiveTab(TAB_DEFS[1]?.id),
    '3': () => setActiveTab(TAB_DEFS[2]?.id),
    '4': () => setActiveTab(TAB_DEFS[3]?.id),
    '5': () => setActiveTab(TAB_DEFS[4]?.id)
  }, [filtered.length, employees.length, works.length]);

  const onDelete = (id) => {
    modal.open(
      <ConfirmModal
        title="Удалить запись?"
        message="Запись будет удалена вместе с привязанным расходом в проекте и прикреплённым файлом. Это действие нельзя отменить."
        tone="danger"
        okText="Удалить"
        onConfirm={async () => {
          try {
            await deleteLogistics(id);
            toast.success('Запись удалена');
            refresh();
          } catch (e) {
            toast.error('Не удалось удалить: ' + (e?.message || e));
          }
        }}
      />
    );
  };

  if (denied) {
    return (
      <div className="p-32">
        <EmptyState
          icon="🔒"
          title="Доступ закрыт"
          hint="Раздел «Логистика дружины» доступен ролям ADMIN, OFFICE_MANAGER, HR, PM, HEAD_PM, директорам, TO."
          action={null}
        />
      </div>
    );
  }

  return (
    <div className="tl-page">
      <TopActionsBar
        kicker="Дружина"
        title="Логистика дружины"
        subtitle="Жильё, авиабилеты и ж/д, направления на медосмотр, обучение и аттестации"
        actions={
          <>
            <Btn variant="ghost" onClick={refresh}>↻ Обновить</Btn>
            {/* v2 BONUS: CSV-экспорт (vanilla не имеет) */}
            <Btn variant="ghost" onClick={onExportCsv} title="Экспорт CSV (Ctrl+E)">📥 CSV</Btn>
            <Btn variant="primary" onClick={onAdd} title="Добавить запись (Ctrl+N)">+ Добавить запись</Btn>
          </>
        }
      />

      <div className="tl-kpi">
        <div className="tl-kpi-card gold" style={{ '--tl-acc': 'var(--gold)' }}>
          <div className="tl-kpi-lab">Всего записей</div>
          <div className="tl-kpi-val">{items.length}</div>
        </div>
        <div className="tl-kpi-card blue" style={{ '--tl-acc': 'var(--blue, var(--info))' }}>
          <div className="tl-kpi-lab">Сумма расходов</div>
          <div className="tl-kpi-val">{formatRubFromAmount(totals.totalAmount)} ₽</div>
        </div>
        <div className="tl-kpi-card ok" style={{ '--tl-acc': 'var(--ok)' }}>
          <div className="tl-kpi-lab">Отправлено рабочим</div>
          <div className="tl-kpi-val">{totals.sent}</div>
        </div>
        <div className="tl-kpi-card warn" style={{ '--tl-acc': 'var(--amber, var(--warn-t))' }}>
          <div className="tl-kpi-lab">Ожидают отправки</div>
          <div className="tl-kpi-val">{totals.waiting}</div>
        </div>
      </div>

      <TabsBar
        tabs={TAB_DEFS.map((t) => ({ id: t.id, label: t.label, count: tabCounts[t.id] || 0 }))}
        active={activeTab}
        onChange={setActiveTab}
      />

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Поиск по сотруднику, работе, описанию…"
      />

      {loading ? (
        <div className="tl-empty">⏳ Загружаем записи…</div>
      ) : filtered.length === 0 ? (
        <div className="tl-empty">
          <div className="tl-empty-ic">📋</div>
          <div className="tl-empty-ttl">Нет записей</div>
          <div>Добавьте билет, жильё или направление</div>
        </div>
      ) : (
        <div className="tl-grid">
          {filtered.map((item) => {
            const emp = empMap[item.employee_id];
            const work = workMap[item.work_id];
            const empName = emp?.fio || item.fio || '—';
            const workName = work?.work_title || item.work_title || '';
            const st = statusInfo(item.status);
            const fileUrl = item.download_url || null;

            const dateLine = item.date_from
              ? fmtDate(item.date_from) +
                (item.date_to && item.date_to !== item.date_from ? ' — ' + fmtDate(item.date_to) : '')
              : '';

            return (
              <div key={item.id} className="tl-card">
                <div>
                  <div className="tl-card-type">{typeLabel(item.item_type)}</div>
                  <div className="tl-card-title">{item.title || '—'}</div>
                  {item.description && <div className="tl-card-sub">{item.description}</div>}
                  <div className="tl-card-meta">
                    <span>
                      👤 {empName}
                      {item.has_lk === false && (
                        <span
                          title="У сотрудника нет личного кабинета — push не уйдёт, только SMS"
                          style={{ color: 'var(--amber, #f59e0b)', marginLeft: 6, fontWeight: 700 }}
                        >
                          🚫 LK
                        </span>
                      )}
                    </span>
                    {workName && <span>📁 {workName}</span>}
                    {item.referral_at && <span>🩺 Выдано: {fmtDate(item.referral_at)}</span>}
                    {dateLine && <span>📅 {dateLine}</span>}
                    {item.transport_no && <span>№ {item.transport_no}</span>}
                    {item.hotel_address && <span>📍 {item.hotel_address}</span>}
                    {item.driver_phone && <span>📞 {item.driver_phone}</span>}
                    {fileUrl && (
                      <a className="tl-file-link" href={fileUrl} target="_blank" rel="noreferrer">
                        📎 Файл
                      </a>
                    )}
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </div>
                </div>
                <div className="tl-card-actions">
                  {item.amount && (
                    <div className="tl-card-amount">{formatRubFromAmount(item.amount)} ₽</div>
                  )}
                  {item.vat_included && <div className="tl-card-vat">С НДС</div>}
                  <Btn size="sm" variant="ghost" onClick={() => onUpload(item.id)}>📎 Файл</Btn>
                  {item.status !== 'purchased' && item.status !== 'sent' && (
                    <Btn size="sm" variant="ghost" onClick={() => onPurchased(item.id)}>✅ Куплено</Btn>
                  )}
                  {!item.sent_to_employee && (
                    <Btn size="sm" variant="primary" onClick={() => onSend(item.id)}>📨 Отправить</Btn>
                  )}
                  <Btn size="sm" variant="ghost" onClick={() => onDelete(item.id)}>🗑</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
