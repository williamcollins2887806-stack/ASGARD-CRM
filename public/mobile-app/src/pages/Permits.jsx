import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Shield, ChevronRight, ExternalLink, Search, X } from 'lucide-react';
import { formatDate } from '@/lib/utils';

function getPermitStatus(permit) {
  if (!permit.valid_to) return { label: 'Без срока', color: 'var(--text-tertiary)' };
  const now = new Date();
  const end = new Date(permit.valid_to);
  const daysLeft = Math.ceil((end - now) / 86400000);
  if (daysLeft < 0) return { label: 'Просрочен', color: 'var(--red-soft)' };
  if (daysLeft <= 30) return { label: `Истекает (${daysLeft} дн.)`, color: 'var(--gold)' };
  return { label: 'Действует', color: 'var(--green)' };
}

const FILTERS = [
  { id: 'all', label: 'Все' }, { id: 'valid', label: 'Действующие' },
  { id: 'expiring', label: 'Истекающие' }, { id: 'expired', label: 'Просроченные' },
];

export default function Permits() {
  const haptic = useHaptic();
  const [permits, setPermits] = useState([]);
  const [employees, setEmployees] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [detail, setDetail] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, eRes] = await Promise.all([
        api.get('/permits'),
        api.get('/staff/employees?limit=1000').catch(() => null),
      ]);
      setPermits(api.extractRows(pRes) || []);
      if (eRes) {
        const rows = api.extractRows(eRes) || [];
        const map = {};
        rows.forEach((e) => { map[e.id] = e.full_name || e.last_name || `#${e.id}`; });
        setEmployees(map);
      }
    } catch { setPermits([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    const now = new Date();
    let list = permits;
    if (filter === 'valid') list = list.filter((p) => { if (!p.valid_to) return true; return new Date(p.valid_to) > now && Math.ceil((new Date(p.valid_to) - now) / 86400000) > 30; });
    else if (filter === 'expiring') list = list.filter((p) => { if (!p.valid_to) return false; const d = Math.ceil((new Date(p.valid_to) - now) / 86400000); return d >= 0 && d <= 30; });
    else if (filter === 'expired') list = list.filter((p) => p.valid_to && new Date(p.valid_to) < now);
    if (search) { const q = search.toLowerCase(); list = list.filter((p) => (p.permit_type || p.type_name || '').toLowerCase().includes(q) || (employees[p.employee_id] || '').toLowerCase().includes(q) || (p.number || '').toLowerCase().includes(q)); }
    return list;
  }, [permits, filter, search, employees]);

  return (
    <PageShell title="Допуски" headerRight={<button onClick={() => { haptic.light(); setShowSearch(!showSearch); }} className="flex items-center justify-center spring-tap" style={{ width: 44, height: 44, color: 'var(--text-tertiary)' }}><Search size={20} /></button>}>
      <PullToRefresh onRefresh={fetchData}>
        {showSearch && (
          <div className="px-1 pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}>
            <div className="flex items-center gap-2 px-3 rounded-xl" style={{ height: 36, background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}>
              <Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              <input type="text" placeholder="Поиск допусков..." value={search} onChange={(e) => setSearch(e.target.value)} autoFocus className="flex-1 bg-transparent outline-none text-[14px]" style={{ color: 'var(--text-primary)', caretColor: 'var(--gold)' }} />
              {search && <button onClick={() => setSearch('')} style={{ color: 'var(--text-tertiary)' }}><X size={16} /></button>}
            </div>
          </div>
        )}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => <button key={f.id} onClick={() => { haptic.light(); setFilter(f.id); }} className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap" style={{ background: filter === f.id ? 'var(--bg-elevated)' : 'transparent', color: filter === f.id ? 'var(--text-primary)' : 'var(--text-tertiary)', border: filter === f.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent' }}>{f.label}</button>)}
        </div>
        {loading ? <SkeletonList count={4} /> : filtered.length === 0 ? (
          <EmptyState icon={Shield} iconColor="var(--green)" iconBg="rgba(48,209,88,0.1)" title={search ? 'Ничего не найдено' : 'Нет допусков'} description="Допуски и удостоверения появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((permit, i) => {
              const st = getPermitStatus(permit);
              const empName = employees[permit.employee_id] || '';
              return (
                <button key={permit.id} onClick={() => { haptic.light(); setDetail(permit); }} className="w-full text-left rounded-2xl px-4 py-3 spring-tap" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', backdropFilter: 'blur(8px)', border: '0.5px solid var(--border-norse)', animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{permit.permit_type || permit.type_name || `Допуск #${permit.id}`}</p>
                    <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
                  </div>
                  {empName && <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{empName}</p>}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `color-mix(in srgb, ${st.color} 15%, transparent)`, color: st.color }}>{st.label}</span>
                    {permit.number && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>№{permit.number}</span>}
                    {permit.valid_to && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>до {formatDate(permit.valid_to)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <PermitDetailSheet permit={detail} onClose={() => setDetail(null)} employees={employees} />
    </PageShell>
  );
}

function PermitDetailSheet({ permit, onClose, employees }) {
  if (!permit) return null;
  const p = permit;
  const st = getPermitStatus(p);
  const fields = [
    { label: 'Статус', value: st.label, color: st.color },
    { label: 'Тип', value: p.permit_type || p.type_name || '—' },
    p.employee_id && employees[p.employee_id] && { label: 'Сотрудник', value: employees[p.employee_id] },
    p.number && { label: '№', value: p.number },
    p.valid_from && { label: 'Действует с', value: formatDate(p.valid_from) },
    p.valid_to && { label: 'Действует до', value: formatDate(p.valid_to) },
    p.issuing_authority && { label: 'Выдан', value: p.issuing_authority },
    p.work_title && { label: 'Проект', value: p.work_title },
  ].filter(Boolean);

  let progressPct = 0;
  if (p.valid_from && p.valid_to) {
    const start = new Date(p.valid_from).getTime();
    const end = new Date(p.valid_to).getTime();
    const now = Date.now();
    if (end > start) progressPct = Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
  }

  return (
    <BottomSheet open={!!permit} onClose={onClose} title={p.permit_type || p.type_name || 'Допуск'}>
      <div className="flex flex-col gap-3 pb-4">
        {progressPct > 0 && progressPct < 100 && (
          <div className="rounded-xl px-4 py-3" style={{ background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)', border: '0.5px solid var(--border-norse)' }}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Срок действия</p>
              <p className="text-[14px] font-bold" style={{ color: st.color }}>{progressPct}%</p>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--bg-surface-alt)' }}>
              <div className="h-full rounded-full" style={{ width: `${progressPct}%`, background: st.color }} />
            </div>
          </div>
        )}
        {fields.map((f, i) => <div key={i}><p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className="text-[14px]" style={{ color: 'var(--text-primary)' }}>{f.value}</p>}</div>)}
        {p.scan_file && <a href={`/api/files/download/${p.scan_file}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] spring-tap mt-1" style={{ background: 'var(--bg-elevated)', color: 'var(--blue)' }}><ExternalLink size={16} /> Скачать скан</a>}
      </div>
    </BottomSheet>
  );
}
