import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Receipt, Search, ChevronRight, X, ExternalLink, DollarSign } from 'lucide-react';
import { formatDate, formatMoney } from '@/lib/utils';

const STATUS_MAP = {
  unpaid: { label: 'Неоплачен', color: 'var(--red-soft)' },
  partial: { label: 'Частично', color: 'var(--gold)' },
  paid: { label: 'Оплачен', color: 'var(--green)' },
  cancelled: { label: 'Отменён', color: 'var(--text-tertiary)' },
};
const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'unpaid', label: 'Неоплачен' },
  { id: 'partial', label: 'Частично' }, { id: 'paid', label: 'Оплачен' },
];

export default function Invoices() {
  const haptic = useHaptic();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get('/invoices?limit=200'); setInvoices(api.extractRows(res) || []); }
    catch { setInvoices([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const stats = useMemo(() => {
    const total = invoices.length;
    const paidSum = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const unpaidSum = invoices.filter((i) => i.status !== 'paid' && i.status !== 'cancelled').reduce((s, i) => s + (Number(i.amount) || 0) - (Number(i.paid_amount) || 0), 0);
    return { total, paidSum, unpaidSum };
  }, [invoices]);

  const filtered = useMemo(() => {
    let list = invoices;
    if (filter !== 'all') list = list.filter((i) => i.status === filter);
    if (search) { const q = search.toLowerCase(); list = list.filter((i) => (i.number || '').toLowerCase().includes(q) || (i.customer_name || '').toLowerCase().includes(q) || (i.work_title || '').toLowerCase().includes(q)); }
    return list;
  }, [invoices, filter, search]);

  return (
    <PageShell title="Счета" headerRight={<button onClick={() => { haptic.light(); setShowSearch(!showSearch); }} className="flex items-center justify-center spring-tap" style={{ width: 44, height: 44, color: 'var(--text-tertiary)' }}><Search size={20} /></button>}>
      <PullToRefresh onRefresh={fetchInvoices}>
        {showSearch && <SearchBar search={search} setSearch={setSearch} placeholder="Поиск счетов..." />}
        {!loading && invoices.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5 px-1 pb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <MiniStat label="Всего" value={stats.total} color="var(--text-primary)" />
            <MiniStat label="Оплачено" value={formatMoney(stats.paidSum, { short: true })} color="var(--green)" />
            <MiniStat label="К оплате" value={formatMoney(stats.unpaidSum, { short: true })} color="var(--gold)" />
          </div>
        )}
        <FilterPills filters={FILTERS} active={filter} onChange={(f) => { haptic.light(); setFilter(f); }} />
        {loading ? <SkeletonList count={5} /> : filtered.length === 0 ? (
          <EmptyState icon={Receipt} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title={search ? 'Ничего не найдено' : 'Нет счетов'} description="Счета появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((inv, i) => {
              const st = STATUS_MAP[inv.status] || STATUS_MAP.unpaid;
              const amount = Number(inv.amount) || 0;
              const paid = Number(inv.paid_amount) || 0;
              const pct = amount > 0 ? Math.round((paid / amount) * 100) : 0;
              return (
                <button key={inv.id} onClick={() => { haptic.light(); setDetail(inv); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', backdropFilter: 'blur(8px)', border: '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>№{inv.number || inv.id} · {inv.customer_name || ''}</p>
                    <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
                  </div>
                  {inv.work_title && <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{inv.work_title}</p>}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {amount > 0 && <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--gold)' }}><DollarSign size={10} />{formatMoney(amount, { short: true })}</span>}
                    {inv.due_date && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>до {formatDate(inv.due_date)}</span>}
                  </div>
                  {inv.status === 'partial' && pct > 0 && (
                    <div className="mt-2 rounded-full overflow-hidden" style={{ height: 3, background: 'var(--bg-surface-alt)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--green)' }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <InvoiceDetailSheet invoice={detail} onClose={() => setDetail(null)} />
    </PageShell>
  );
}

function InvoiceDetailSheet({ invoice, onClose }) {
  if (!invoice) return null;
  const inv = invoice;
  const st = STATUS_MAP[inv.status] || STATUS_MAP.unpaid;
  const amount = Number(inv.amount) || 0;
  const paid = Number(inv.paid_amount) || 0;
  const pct = amount > 0 ? Math.round((paid / amount) * 100) : 0;
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    inv.number && { label: '№', value: inv.number },
    inv.date && { label: 'Дата', value: formatDate(inv.date) },
    inv.customer_name && { label: 'Заказчик', value: inv.customer_name },
    inv.work_title && { label: 'Работа', value: inv.work_title },
    amount > 0 && { label: 'Сумма', value: formatMoney(amount) },
    Number(inv.amount_with_vat) > 0 && { label: 'Сумма с НДС', value: formatMoney(inv.amount_with_vat) },
    paid > 0 && { label: 'Оплачено', value: `${formatMoney(paid)} (${pct}%)` },
    inv.due_date && { label: 'Срок оплаты', value: formatDate(inv.due_date) },
    (inv.note || inv.comment) && { label: 'Примечание', value: inv.note || inv.comment, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!invoice} onClose={onClose} title={`Счёт №${inv.number || inv.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {pct > 0 && pct < 100 && (
          <div className="rounded-xl px-4 py-3" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)' }}>
            <div className="flex items-center justify-between mb-1"><p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Оплата</p><p className="text-[14px] font-bold" style={{ color: 'var(--green)' }}>{pct}%</p></div>
            <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--bg-surface-alt)' }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--green)' }} /></div>
          </div>
        )}
        {fields.map((f, i) => <FieldRow key={i} {...f} />)}
        {inv.file_url && <a href={inv.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] spring-tap mt-1" style={{ background: 'var(--bg-elevated)', color: 'var(--blue)' }}><ExternalLink size={16} /> Скачать счёт</a>}
      </div>
    </BottomSheet>
  );
}

function FieldRow({ label, value, color, full }) { return <div><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{label}</p>{color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>{value}</span> : <p className={`text-[14px] ${full ? 'whitespace-pre-wrap' : ''}`} style={{ color: 'var(--text-primary)' }}>{value}</p>}</div>; }
function MiniStat({ label, value, color }) { return <div className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)' }}><p className="text-[12px] font-bold" style={{ color }}>{value}</p><p className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>{label}</p></div>; }
function FilterPills({ filters, active, onChange }) { return <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">{filters.map((f) => <button key={f.id} onClick={() => onChange(f.id)} className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap" style={{ background: active === f.id ? 'var(--bg-elevated)' : 'transparent', color: active === f.id ? 'var(--text-primary)' : 'var(--text-tertiary)', border: active === f.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent' }}>{f.label}</button>)}</div>; }
function SearchBar({ search, setSearch, placeholder }) { return <div className="px-1 pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}><div className="flex items-center gap-2 px-3 rounded-xl" style={{ height: 36, background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}><Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} /><input type="text" placeholder={placeholder} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus className="flex-1 bg-transparent outline-none text-[14px]" style={{ color: 'var(--text-primary)', caretColor: 'var(--gold)' }} />{search && <button onClick={() => setSearch('')} style={{ color: 'var(--text-tertiary)' }}><X size={16} /></button>}</div></div>; }
