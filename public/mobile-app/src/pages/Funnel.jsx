import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Filter, ChevronRight } from 'lucide-react';
import { formatMoney, formatDate } from '@/lib/utils';

const STAGES = [
  { id: 'new', label: 'Новые', color: 'var(--text-tertiary)', match: ['черновик', 'новый', 'получен'] },
  { id: 'calc', label: 'Просчёт', color: 'var(--blue)', match: ['в просчёте', 'на просчёте', 'просчёт'] },
  { id: 'negotiation', label: 'Переговоры', color: 'var(--gold)', match: ['кп отправлено', 'ткп отправлено', 'согласование ткп', 'переговоры', 'на согласовании', 'ткп согласовано'] },
  { id: 'prep', label: 'Подготовка', color: '#7B68EE', match: ['выиграли', 'клиент согласился', 'контракт'] },
  { id: 'work', label: 'В работе', color: 'var(--green)', match: ['в работе', 'выполняется', 'мобилизация'] },
  { id: 'lost', label: 'Проиграно', color: 'var(--red-soft)', match: ['проиграли', 'отказ', 'клиент отказался', 'отменён'] },
];

function getStage(tender) {
  const s = (tender.tender_status || tender.status || '').toLowerCase();
  for (const stage of STAGES) {
    if (stage.match.some((m) => s.includes(m))) return stage;
  }
  return STAGES[0];
}

export default function Funnel() {
  const haptic = useHaptic();
  const [tenders, setTenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [activeStage, setActiveStage] = useState('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get('/data/tenders'); setTenders(api.extractRows(res) || []); }
    catch { setTenders([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const grouped = useMemo(() => {
    const map = {};
    STAGES.forEach((s) => { map[s.id] = { ...s, items: [], sum: 0 }; });
    tenders.forEach((t) => {
      const stage = getStage(t);
      map[stage.id].items.push(t);
      map[stage.id].sum += Number(t.amount || t.price || 0);
    });
    return map;
  }, [tenders]);

  const stats = useMemo(() => ({
    total: tenders.length,
    sum: tenders.reduce((s, t) => s + (Number(t.amount || t.price || 0)), 0),
    won: (grouped.prep?.items.length || 0) + (grouped.work?.items.length || 0),
    newCount: grouped.new?.items.length || 0,
  }), [tenders, grouped]);

  const displayStages = activeStage === 'all' ? STAGES : STAGES.filter((s) => s.id === activeStage);

  return (
    <PageShell title="Воронка">
      <PullToRefresh onRefresh={fetchData}>
        {!loading && tenders.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5 px-1 pb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <div className="card-glass flex flex-col items-center gap-0.5 py-2.5"><p className="text-[13px] font-bold c-primary">{stats.total}</p><p className="text-[9px] c-tertiary">Всего</p></div>
            <div className="card-glass flex flex-col items-center gap-0.5 py-2.5"><p className="text-[13px] font-bold c-gold">{formatMoney(stats.sum, { short: true })}</p><p className="text-[9px] c-tertiary">Сумма</p></div>
            <div className="card-glass flex flex-col items-center gap-0.5 py-2.5"><p className="text-[13px] font-bold c-green">{stats.won}</p><p className="text-[9px] c-tertiary">Выиграно</p></div>
            <div className="card-glass flex flex-col items-center gap-0.5 py-2.5"><p className="text-[13px] font-bold c-blue">{stats.newCount}</p><p className="text-[9px] c-tertiary">Новые</p></div>
          </div>
        )}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          <button onClick={() => { haptic.light(); setActiveStage('all'); }} className="filter-pill spring-tap" data-active={activeStage === 'all' ? 'true' : undefined}>Все</button>
          {STAGES.map((s) => <button key={s.id} onClick={() => { haptic.light(); setActiveStage(s.id); }} className="filter-pill spring-tap" data-active={activeStage === s.id ? 'true' : undefined}>{s.label} ({grouped[s.id]?.items.length || 0})</button>)}
        </div>
        {loading ? <SkeletonList count={5} /> : tenders.length === 0 ? (
          <EmptyState icon={Filter} iconColor="var(--gold)" iconBg="color-mix(in srgb, var(--gold) 10%, transparent)" title="Нет тендеров" description="Тендеры появятся здесь" />
        ) : (
          <div className="flex flex-col gap-4 pb-4">
            {displayStages.map((stage) => {
              const g = grouped[stage.id];
              if (!g || g.items.length === 0) return null;
              return (
                <div key={stage.id}>
                  <div className="flex items-center gap-2 px-1 mb-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
                    <p className="text-[13px] font-bold c-primary">{stage.label}</p>
                    <span className="text-[11px] c-tertiary">{g.items.length} · {formatMoney(g.sum, { short: true })}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {g.items.map((t, i) => (
                      <button key={t.id} onClick={() => { haptic.light(); setDetail(t); }} className="w-full text-left card-glass px-4 py-3 spring-tap" style={{ borderLeft: `3px solid ${stage.color}`, animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[14px] font-semibold leading-tight c-primary">{t.customer_name || t.client || t.name || t.title || `#${t.id}`}</p>
                          <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                        </div>
                        {(t.name || t.title) && t.customer_name && <p className="text-[12px] mt-0.5 truncate c-secondary">{t.name || t.title}</p>}
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          {Number(t.amount || t.price || 0) > 0 && <span className="text-[10px] font-semibold c-gold">{formatMoney(t.amount || t.price, { short: true })}</span>}
                          {(t.deadline || t.submission_deadline) && <span className="text-[10px] c-tertiary">до {formatDate(t.deadline || t.submission_deadline)}</span>}
                          {(t.manager_name || t.rp) && <span className="text-[10px] c-tertiary">{t.manager_name || t.rp}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PullToRefresh>
      <FunnelDetailSheet tender={detail} onClose={() => setDetail(null)} />
    </PageShell>
  );
}

function FunnelDetailSheet({ tender, onClose }) {
  if (!tender) return null;
  const t = tender;
  const stage = getStage(t);
  const fields = [
    { label: 'Этап', value: stage.label, color: stage.color },
    { label: 'Статус', value: t.tender_status || t.status || '—' },
    (t.customer_name || t.client) && { label: 'Заказчик', value: t.customer_name || t.client },
    (t.name || t.title) && { label: 'Название', value: t.name || t.title },
    Number(t.amount || t.price || 0) > 0 && { label: 'Сумма', value: formatMoney(t.amount || t.price) },
    (t.deadline || t.submission_deadline) && { label: 'Дедлайн', value: formatDate(t.deadline || t.submission_deadline) },
    (t.manager_name || t.rp) && { label: 'РП', value: t.manager_name || t.rp },
    t.description && { label: 'Описание', value: t.description, full: true },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!tender} onClose={onClose} title={t.customer_name || t.name || 'Тендер'}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="input-label">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>}</div>)}
      </div>
    </BottomSheet>
  );
}
