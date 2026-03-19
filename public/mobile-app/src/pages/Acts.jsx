import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { FileCheck, Search, ChevronRight, X, ExternalLink, DollarSign } from 'lucide-react';
import { formatDate, formatMoney } from '@/lib/utils';

const STATUS_MAP = {
  draft: { label: 'Черновик', color: 'var(--text-tertiary)' },
  signing: { label: 'На подписании', color: 'var(--gold)' },
  signed: { label: 'Подписан', color: 'var(--green)' },
  paid: { label: 'Оплачен', color: 'var(--blue)' },
  cancelled: { label: 'Отменён', color: 'var(--red-soft)' },
};
const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'draft', label: 'Черновик' },
  { id: 'signing', label: 'На подписании' }, { id: 'signed', label: 'Подписан' }, { id: 'paid', label: 'Оплачен' },
];

export default function Acts() {
  const haptic = useHaptic();
  const [acts, setActs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);

  const fetchActs = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get('/acts?limit=200'); setActs(api.extractRows(res) || []); }
    catch { setActs([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchActs(); }, [fetchActs]);

  const stats = useMemo(() => {
    const total = acts.length;
    const signed = acts.filter((a) => a.status === 'signed' || a.status === 'paid').length;
    const sum = acts.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    return { total, signed, sum };
  }, [acts]);

  const filtered = useMemo(() => {
    let list = acts;
    if (filter !== 'all') list = list.filter((a) => a.status === filter);
    if (search) { const q = search.toLowerCase(); list = list.filter((a) => (a.number || '').toLowerCase().includes(q) || (a.work_title || a.title || '').toLowerCase().includes(q) || (a.customer_name || '').toLowerCase().includes(q)); }
    return list;
  }, [acts, filter, search]);

  return (
    <PageShell title="Акты" headerRight={<button onClick={() => { haptic.light(); setShowSearch(!showSearch); }} className="flex items-center justify-center spring-tap" style={{ width: 44, height: 44, color: 'var(--text-tertiary)' }}><Search size={20} /></button>}>
      <PullToRefresh onRefresh={fetchActs}>
        {showSearch && <SearchBar search={search} setSearch={setSearch} placeholder="Поиск актов..." />}
        {!loading && acts.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5 px-1 pb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <MiniStat label="Всего" value={stats.total} color="var(--text-primary)" />
            <MiniStat label="Подписано" value={stats.signed} color="var(--green)" />
            <MiniStat label="Сумма" value={formatMoney(stats.sum, { short: true })} color="var(--gold)" />
          </div>
        )}
        <FilterPills filters={FILTERS} active={filter} onChange={(f) => { haptic.light(); setFilter(f); }} />
        {loading ? <SkeletonList count={5} /> : filtered.length === 0 ? (
          <EmptyState icon={FileCheck} iconColor="var(--green)" iconBg="rgba(48,209,88,0.1)" title={search ? 'Ничего не найдено' : 'Нет актов'} description="Акты появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((act, i) => {
              const st = STATUS_MAP[act.status] || STATUS_MAP.draft;
              return (
                <button key={act.id} onClick={() => { haptic.light(); setDetail(act); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', backdropFilter: 'blur(8px)', border: '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{act.number || act.title || `Акт #${act.id}`}</p>
                    <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
                  </div>
                  {act.work_title && <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{act.work_title}</p>}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {Number(act.amount) > 0 && <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--gold)' }}><DollarSign size={10} />{formatMoney(act.amount, { short: true })}</span>}
                    {act.date && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{formatDate(act.date)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <ActDetailSheet act={detail} onClose={() => setDetail(null)} />
    </PageShell>
  );
}

function ActDetailSheet({ act, onClose }) {
  if (!act) return null;
  const st = STATUS_MAP[act.status] || STATUS_MAP.draft;
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    act.number && { label: '№', value: act.number },
    act.date && { label: 'Дата', value: formatDate(act.date) },
    act.customer_name && { label: 'Заказчик', value: act.customer_name },
    act.work_title && { label: 'Работа', value: act.work_title },
    Number(act.amount) > 0 && { label: 'Сумма', value: formatMoney(act.amount) },
    Number(act.amount_with_vat) > 0 && { label: 'Сумма с НДС', value: formatMoney(act.amount_with_vat) },
    act.responsible_name && { label: 'Ответственный', value: act.responsible_name },
    (act.note || act.comment) && { label: 'Примечание', value: act.note || act.comment, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!act} onClose={onClose} title={act.number || `Акт #${act.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <FieldRow key={i} {...f} />)}
        {act.file_url && <a href={act.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] spring-tap mt-1" style={{ background: 'var(--bg-elevated)', color: 'var(--blue)' }}><ExternalLink size={16} /> Скачать акт</a>}
      </div>
    </BottomSheet>
  );
}

function FieldRow({ label, value, color, full }) { return <div><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{label}</p>{color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>{value}</span> : <p className={`text-[14px] ${full ? 'whitespace-pre-wrap' : ''}`} style={{ color: 'var(--text-primary)' }}>{value}</p>}</div>; }
function MiniStat({ label, value, color }) { return <div className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)' }}><p className="text-[13px] font-bold" style={{ color }}>{value}</p><p className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>{label}</p></div>; }
function FilterPills({ filters, active, onChange }) { return <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">{filters.map((f) => <button key={f.id} onClick={() => onChange(f.id)} className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap" style={{ background: active === f.id ? 'var(--bg-elevated)' : 'transparent', color: active === f.id ? 'var(--text-primary)' : 'var(--text-tertiary)', border: active === f.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent' }}>{f.label}</button>)}</div>; }
function SearchBar({ search, setSearch, placeholder }) { return <div className="px-1 pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}><div className="flex items-center gap-2 px-3 rounded-xl" style={{ height: 36, background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}><Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} /><input type="text" placeholder={placeholder} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus className="flex-1 bg-transparent outline-none text-[14px]" style={{ color: 'var(--text-primary)', caretColor: 'var(--gold)' }} />{search && <button onClick={() => setSearch('')} style={{ color: 'var(--text-tertiary)' }}><X size={16} /></button>}</div></div>; }
