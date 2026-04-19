import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Stamp, Plus, ChevronRight, ExternalLink } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import AsgardSelect from '@/components/ui/AsgardSelect';

function getProxyStatus(proxy) {
  if (proxy.end_date && new Date(proxy.end_date) < new Date()) return { label: 'Истекла', color: 'var(--red-soft)' };
  return { label: 'Действующая', color: 'var(--green)' };
}

const TEMPLATE_MAP = { general: 'Генеральная', material: 'На материалы', representation: 'Представительство', custom: 'Особая' };
const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'active', label: 'Действующие' }, { id: 'expired', label: 'Истёкшие' },
];

export default function Proxies() {
  const haptic = useHaptic();
  const [proxies, setProxies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get('/data/proxies?limit=100'); setProxies(api.extractRows(res) || []); }
    catch { setProxies([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    const now = new Date();
    if (filter === 'active') return proxies.filter((p) => !p.end_date || new Date(p.end_date) >= now);
    if (filter === 'expired') return proxies.filter((p) => p.end_date && new Date(p.end_date) < now);
    return proxies;
  }, [proxies, filter]);

  return (
    <PageShell title="Доверенности" headerRight={<button onClick={() => { haptic.light(); setShowCreate(true); }} className="btn-icon spring-tap c-blue"><Plus size={22} /></button>}>
      <PullToRefresh onRefresh={fetchData}>
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="filter-pill spring-tap" data-active={filter === f.id}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={Stamp} iconColor="var(--gold)" iconBg="color-mix(in srgb, var(--gold) 10%, transparent)" title="Нет доверенностей" description="Доверенности появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((proxy, i) => {
              const st = getProxyStatus(proxy);
              return (
                <button key={proxy.id} onClick={() => { haptic.light(); setDetail(proxy); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap card-glass" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight c-primary">{proxy.title || proxy.number || `Доверенность #${proxy.id}`}</p>
                    <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                  </div>
                  {(proxy.representative_name || proxy.trustee_name) && <p className="text-[12px] mt-0.5 truncate c-secondary">{proxy.representative_name || proxy.trustee_name}</p>}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {proxy.template_name && <span className="text-[10px] c-tertiary">{proxy.template_name}</span>}
                    {proxy.end_date && <span className="text-[10px] c-tertiary">до {formatDate(proxy.end_date)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <ProxyDetailSheet proxy={detail} onClose={() => setDetail(null)} />
      <CreateProxySheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchData} />
    </PageShell>
  );
}

function ProxyDetailSheet({ proxy, onClose }) {
  if (!proxy) return null;
  const p = proxy;
  const st = getProxyStatus(p);
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    p.title && { label: 'Название', value: p.title },
    p.number && { label: '№', value: p.number },
    p.grantor_name && { label: 'Доверитель', value: p.grantor_name },
    (p.representative_name || p.trustee_name) && { label: 'Представитель', value: p.representative_name || p.trustee_name },
    p.start_date && { label: 'Начало', value: formatDate(p.start_date) },
    p.end_date && { label: 'Окончание', value: formatDate(p.end_date) },
    p.template_name && { label: 'Шаблон', value: p.template_name },
    (p.scope || p.description) && { label: 'Полномочия', value: p.scope || p.description, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!proxy} onClose={onClose} title={p.title || p.number || 'Доверенность'}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>}</div>)}
        {(p.file_url || p.scan_file) && <a href={p.file_url || `/api/files/download/${p.scan_file}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] spring-tap mt-1 c-blue bg-elevated"><ExternalLink size={16} /> Скачать</a>}
      </div>
    </BottomSheet>
  );
}

function CreateProxySheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [template, setTemplate] = useState('general');
  const [representative, setRepresentative] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [scope, setScope] = useState('');
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    if (!representative.trim() || !startDate || !endDate) return;
    haptic.light(); setSaving(true);
    try {
      await api.post('/data/proxies', { template, representative_name: representative.trim(), start_date: startDate, end_date: endDate, scope: scope || null });
      haptic.success(); setTemplate('general'); setRepresentative(''); setStartDate(''); setEndDate(''); setScope(''); onClose(); onCreated();
    } catch {} setSaving(false);
  };
  const valid = representative.trim() && startDate && endDate;
  return (
    <BottomSheet open={open} onClose={onClose} title="Новая доверенность">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="input-label">Шаблон *</label><AsgardSelect options={Object.entries(TEMPLATE_MAP).map(([k, v]) => ({ value: k, label: v }))} value={template} onChange={(val) => setTemplate(val)} placeholder="Шаблон" /></div>
        <div><label className="input-label">Представитель *</label><input type="text" value={representative} onChange={(e) => setRepresentative(e.target.value)} placeholder="ФИО" className="input-field" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="input-label">Начало *</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field" /></div>
          <div><label className="input-label">Окончание *</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-field" /></div>
        </div>
        <div><label className="input-label">Полномочия</label><textarea value={scope} onChange={(e) => setScope(e.target.value)} placeholder="Описание полномочий..." rows={2} className="input-field resize-none" /></div>
        <button onClick={handleSubmit} disabled={!valid || saving} className="btn-primary spring-tap mt-1">{saving ? 'Сохранение...' : 'Создать'}</button>
      </div>
    </BottomSheet>
  );
}
