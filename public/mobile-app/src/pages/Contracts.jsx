import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import {
  FileText, Search, Plus, ChevronRight, X,
  DollarSign, Calendar, ExternalLink,
} from 'lucide-react';
import { formatDate, formatMoney } from '@/lib/utils';
import AsgardSelect from '@/components/ui/AsgardSelect';

const STATUS_MAP = {
  active:     { label: 'Действующий',   color: 'var(--green)' },
  signing:    { label: 'На подписании', color: 'var(--gold)' },
  draft:      { label: 'Черновик',      color: 'var(--text-tertiary)' },
  completed:  { label: 'Завершён',      color: 'var(--blue)' },
  cancelled:  { label: 'Расторгнут',    color: 'var(--red-soft)' },
  terminated: { label: 'Расторгнут',    color: 'var(--red-soft)' },
  expiring:   { label: 'Истекает',      color: 'var(--gold)' },
  expired:    { label: 'Истёк',         color: 'var(--red-soft)' },
};

function computeStatus(c) {
  if (c.status === 'terminated' || c.status === 'cancelled' || c.status === 'draft' || c.status === 'signing') {
    return c.status;
  }
  if (!c.end_date || c.is_perpetual) return 'active';
  const days = Math.ceil((new Date(c.end_date) - new Date()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring';
  return 'active';
}

function getStatus(c) {
  const key = computeStatus(c);
  return STATUS_MAP[key] || STATUS_MAP.draft;
}

const FILTERS = [
  { id: 'all',       label: 'Все' },
  { id: 'active',    label: 'Действующие' },
  { id: 'signing',   label: 'На подписании' },
  { id: 'completed', label: 'Завершённые' },
];

export default function Contracts() {
  const haptic = useHaptic();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/data/contracts?limit=500&orderBy=id&desc=true');
      setContracts(api.extractRows(res) || []);
    } catch {
      setContracts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchContracts(); }, [fetchContracts]);

  const filtered = useMemo(() => {
    let list = contracts;
    if (filter === 'active') {
      list = list.filter((c) => {
        const s = computeStatus(c);
        return s === 'active' || s === 'expiring';
      });
    } else if (filter === 'signing') {
      list = list.filter((c) => c.status === 'signing');
    } else if (filter === 'completed') {
      list = list.filter((c) => {
        const s = computeStatus(c);
        return s === 'expired' || c.status === 'terminated' || c.status === 'cancelled' || c.status === 'completed';
      });
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((c) =>
        (c.number || '').toLowerCase().includes(q) ||
        (c.counterparty_name || c.contractor_name || '').toLowerCase().includes(q) ||
        (c.subject || c.title || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [contracts, filter, search]);

  return (
    <PageShell
      title="Договоры"
      headerRight={
        <div className="flex items-center gap-1">
          <button
            onClick={() => { haptic.light(); setShowSearch(!showSearch); }}
            className="btn-icon spring-tap"
          >
            <Search size={20} />
          </button>
          <button
            onClick={() => { haptic.light(); setShowCreate(true); }}
            className="btn-icon spring-tap c-blue"
          >
            <Plus size={22} />
          </button>
        </div>
      }
    >
      <PullToRefresh onRefresh={fetchContracts}>
        {showSearch && (
          <div className="px-1 pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}>
            <div className="search-bar">
              <Search size={16} className="c-tertiary" style={{ flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Поиск договоров..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              {search && (
                <button onClick={() => setSearch('')} className="c-tertiary">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => { haptic.light(); setFilter(f.id); }}
              className="filter-pill spring-tap"
              data-active={filter === f.id ? 'true' : undefined}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <SkeletonList count={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            iconColor="var(--gold)"
            iconBg="color-mix(in srgb, var(--gold) 10%, transparent)"
            title={search ? 'Ничего не найдено' : 'Нет договоров'}
            description={search ? 'Попробуйте изменить запрос' : 'Договоры появятся здесь'}
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((c, i) => {
              const st = getStatus(c);
              const amount = Number(c.amount || c.contract_value) || 0;
              return (
                <button
                  key={c.id}
                  onClick={() => { haptic.light(); setDetail(c); }}
                  className="card-glass w-full text-left px-4 py-3 spring-tap"
                  style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 50}ms both` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">
                      {c.title || c.counterparty_name || c.contractor_name || `Договор ${c.number || `#${c.id}`}`}
                    </p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  {c.contractor_name && c.title && (
                    <p className="text-[12px] mt-0.5 truncate c-secondary">
                      {c.contractor_name}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span
                      className="status-badge"
                      style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}
                    >
                      {st.label}
                    </span>
                    {c.number && (
                      <span className="text-[10px] c-tertiary">
                        № {c.number}
                      </span>
                    )}
                    {amount > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] c-gold">
                        <DollarSign size={10} />
                        {formatMoney(amount, { short: true })}
                      </span>
                    )}
                    {c.end_date && !c.is_perpetual && (
                      <span className="flex items-center gap-0.5 text-[10px] c-tertiary">
                        <Calendar size={10} />
                        до {formatDate(c.end_date)}
                      </span>
                    )}
                    {c.is_perpetual && (
                      <span className="text-[10px] c-tertiary">Бессрочный</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      <ContractDetailSheet contract={detail} onClose={() => setDetail(null)} />
      <CreateContractSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchContracts} />
    </PageShell>
  );
}

function ContractDetailSheet({ contract, onClose }) {
  if (!contract) return null;
  const c = contract;
  const st = getStatus(c);
  const amount = Number(c.amount || c.contract_value) || 0;

  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    c.number && { label: '№ Договора', value: c.number },
    (c.counterparty_name || c.contractor_name) && { label: 'Контрагент', value: c.counterparty_name || c.contractor_name },
    (c.subject || c.title) && { label: 'Предмет', value: c.subject || c.title, full: true },
    c.type && { label: 'Тип', value: c.type === 'customer' ? 'Покупатель (заказчик)' : c.type === 'supplier' ? 'Поставщик' : c.type },
    amount > 0 && { label: 'Сумма', value: formatMoney(amount) },
    c.start_date && { label: 'Дата заключения', value: formatDate(c.start_date) },
    c.is_perpetual ? { label: 'Срок действия', value: 'Бессрочный' } : c.end_date && { label: 'Действует до', value: formatDate(c.end_date) },
    c.responsible && { label: 'Ответственный', value: c.responsible || c.responsible_name },
    (c.comment || c.note) && { label: 'Примечание', value: c.comment || c.note, full: true },
  ].filter(Boolean);

  return (
    <BottomSheet open={!!contract} onClose={onClose} title={c.title || c.number || `Договор #${c.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => (
          <div key={i}>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">
              {f.label}
            </p>
            {f.color ? (
              <span
                className="status-badge px-2.5 py-1 text-[12px] inline-block"
                style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}
              >
                {f.value}
              </span>
            ) : (
              <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>
                {f.value}
              </p>
            )}
          </div>
        ))}

        {c.file_url && (
          <a
            href={c.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-action spring-tap mt-1 bg-elevated c-blue"
          >
            <ExternalLink size={16} /> Скачать договор
          </a>
        )}
      </div>
    </BottomSheet>
  );
}

function CreateContractSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [number, setNumber] = useState('');
  const [type, setType] = useState('customer');
  const [counterparty, setCounterparty] = useState('');
  const [subject, setSubject] = useState('');
  const [amount, setAmount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [perpetual, setPerpetual] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setNumber(''); setType('customer'); setCounterparty('');
    setSubject(''); setAmount(''); setStartDate(''); setEndDate('');
    setPerpetual(false);
  };

  const handleSubmit = async () => {
    if (!number.trim()) return;
    haptic.light();
    setSaving(true);
    try {
      await api.post('/data/contracts', {
        number: number.trim(),
        type,
        counterparty_name: counterparty.trim() || null,
        subject: subject.trim() || null,
        amount: amount ? Number(amount) : null,
        start_date: startDate || null,
        end_date: perpetual ? null : (endDate || null),
        is_perpetual: perpetual,
        status: 'draft',
      });
      haptic.success();
      reset();
      onClose();
      onCreated();
    } catch {}
    setSaving(false);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Новый договор">
      <div className="flex flex-col gap-3 pb-4">
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Номер договора *">
            <input
              type="text" value={number} onChange={(e) => setNumber(e.target.value)}
              placeholder="Д-2026/001"
              className="input-field"
            />
          </FormField>
          <FormField label="Тип">
            <AsgardSelect
              options={[
                { value: 'customer', label: 'Заказчик' },
                { value: 'supplier', label: 'Поставщик' },
              ]}
              value={type}
              onChange={(val) => setType(val)}
              placeholder="Тип"
            />
          </FormField>
        </div>

        <FormField label="Контрагент">
          <input
            type="text" value={counterparty} onChange={(e) => setCounterparty(e.target.value)}
            placeholder="Наименование контрагента..."
            className="input-field"
          />
        </FormField>

        <FormField label="Предмет договора">
          <textarea
            value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="Описание предмета..."
            rows={2}
            className="input-field resize-none"
          />
        </FormField>

        <FormField label="Сумма (₽)">
          <input
            type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="input-field"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-2">
          <FormField label="Дата заключения">
            <input
              type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="input-field"
            />
          </FormField>
          <FormField label="Действует до">
            <input
              type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              disabled={perpetual}
              className="input-field"
              style={{ opacity: perpetual ? 0.4 : 1 }}
            />
          </FormField>
        </div>

        <button
          onClick={() => setPerpetual(!perpetual)}
          className="flex items-center gap-2 px-1 spring-tap"
        >
          <div
            className="shrink-0 flex items-center justify-center rounded-md"
            style={{
              width: 20, height: 20,
              background: perpetual ? 'var(--blue)' : 'transparent',
              border: perpetual ? 'none' : '2px solid var(--border-light)',
              transition: 'all 200ms ease',
            }}
          >
            {perpetual && <span className="text-white text-[12px] font-bold">✓</span>}
          </div>
          <span className="text-[13px] c-secondary">Бессрочный договор</span>
        </button>

        <button
          onClick={handleSubmit}
          disabled={!number.trim() || saving}
          className="btn-primary spring-tap mt-1"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Сохранение...' : 'Создать договор'}
        </button>
      </div>
    </BottomSheet>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="input-label">
        {label}
      </label>
      {children}
    </div>
  );
}
