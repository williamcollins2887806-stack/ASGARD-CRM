import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import {
  loadRegistry,
  createRegistryRow,
  buildRegistryPeriodOptions,
} from '@/api/tendersRegistry';
import {
  computeRegistryKpi,
  isToRole,
} from '@/lib/registryStatus';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { StatCard, StatRow } from '@/components/shared/StatCard';
import RegistryDetailSheet, { SourceBadge, RegistryStatusBadge } from '@/components/tenders/RegistryDetailSheet';
import {
  Trophy, Search, Plus, ChevronRight, X, Calendar, DollarSign,
  LayoutGrid, AlertTriangle, ChevronDown, Inbox, Clock,
} from 'lucide-react';
import { formatDate, formatMoney } from '@/lib/utils';

const SUB_TABS = [
  { id: 'registry', label: 'Реестр' },
  { id: 'submitted', label: 'В работе ТО' },
  { id: 'archive', label: 'Архив' },
];

const CREATE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

function isBurning(t) {
  if (!t.docs_deadline) return false;
  if (['отмена', 'проиграли', 'выиграли'].includes(t.registry_status)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dl = new Date(t.docs_deadline).getTime();
  if (!Number.isFinite(dl)) return false;
  const days = Math.round((dl - today.getTime()) / 86400000);
  return days >= 0 && days <= 3;
}

export default function Tenders() {
  const user = useAuthStore((s) => s.user);
  const haptic = useHaptic();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [kpiRows, setKpiRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [subtab, setSubtab] = useState('registry');
  const [period, setPeriod] = useState('current');
  const [burnOnly, setBurnOnly] = useState(false);
  const [showPeriod, setShowPeriod] = useState(false);
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const canCreate = user && CREATE_ROLES.includes(user.role);
  const showKanbanCta = user && isToRole(user.role);
  const periodOptions = useMemo(() => buildRegistryPeriodOptions(), []);
  const periodLabel = periodOptions.find((o) => o.value === period)?.label || 'Период';

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await loadRegistry({
        subtab,
        period,
        burn: burnOnly,
        limit: 500,
      });
      setItems(res.items || []);
      setTotal(res.total ?? (res.items || []).length);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [subtab, period, burnOnly]);

  const fetchKpi = useCallback(async () => {
    try {
      const res = await loadRegistry({ subtab: 'registry', period: '', limit: 1000 });
      setKpiRows(res.items || []);
    } catch {
      setKpiRows([]);
    }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { fetchKpi(); }, [fetchKpi]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchList(), fetchKpi()]);
  }, [fetchList, fetchKpi]);

  const kpi = useMemo(() => computeRegistryKpi(kpiRows), [kpiRows]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((t) =>
      (t.customer_name || '').toLowerCase().includes(q) ||
      (t.tender_title || '').toLowerCase().includes(q) ||
      (t.comment_to || '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const jumpToBurn = () => {
    haptic.light();
    setSubtab('registry');
    setPeriod('current');
    setBurnOnly(true);
  };

  return (
    <PageShell
      title="Реестр ТО"
      headerRight={
        <div className="flex items-center gap-1">
          <button
            onClick={() => { haptic.light(); setShowSearch(!showSearch); }}
            className="flex items-center justify-center spring-tap"
            style={{ width: 44, height: 44, color: 'var(--text-tertiary)' }}
          >
            <Search size={20} />
          </button>
          {canCreate && (
            <button
              onClick={() => { haptic.light(); setShowCreate(true); }}
              className="flex items-center justify-center spring-tap"
              style={{ width: 44, height: 44, color: 'var(--blue)' }}
            >
              <Plus size={22} />
            </button>
          )}
        </div>
      }
    >
      <PullToRefresh onRefresh={refresh}>
        {showKanbanCta && (
          <button
            type="button"
            onClick={() => navigate('/personal-kanban')}
            className="w-full mb-3 rounded-2xl px-4 py-3 flex items-center justify-between spring-tap"
            style={{
              background: 'color-mix(in srgb, var(--blue) 10%, var(--bg-surface))',
              border: '0.5px solid color-mix(in srgb, var(--blue) 25%, var(--border-norse))',
            }}
          >
            <div className="flex items-center gap-2">
              <LayoutGrid size={18} style={{ color: 'var(--blue)' }} />
              <span className="text-[14px] font-semibold c-primary">Мой канбан</span>
            </div>
            <ChevronRight size={16} className="c-tertiary" />
          </button>
        )}

        {!loading && (
          <>
            <StatRow cols={3}>
              <StatCard icon={Inbox} label="Сегодня" value={kpi.inbox_today} color="var(--gold)" delay={0} />
              <StatCard icon={Trophy} label="В работе ТО" value={kpi.in_work} color="var(--blue)" delay={40} />
              <StatCard
                icon={AlertTriangle}
                label="Дедлайн ≤3д"
                value={kpi.burn}
                color={kpi.burn > 0 ? 'var(--red-soft)' : 'var(--text-tertiary)'}
                delay={80}
                onClick={kpi.burn > 0 ? jumpToBurn : undefined}
              />
            </StatRow>
            <StatRow cols={3}>
              <StatCard icon={Clock} label="Дозапрос" value={kpi.addendum} color="var(--gold)" delay={100} />
              <StatCard icon={Trophy} label="Выиграно/мес" value={kpi.won_month} color="var(--green)" delay={120} />
              <StatCard
                icon={Trophy}
                label="Конверсия"
                value={kpi.win_pct != null ? `${kpi.win_pct}%` : '—'}
                color="var(--text-secondary)"
                delay={140}
              />
            </StatRow>
          </>
        )}

        {burnOnly && (
          <div
            className="mb-3 rounded-xl px-3 py-2 flex items-center justify-between"
            style={{
              background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
              border: '0.5px solid color-mix(in srgb, var(--gold) 30%, transparent)',
            }}
          >
            <span className="text-[13px] font-semibold" style={{ color: 'var(--gold)' }}>
              🔥 Только горящие дедлайны
            </span>
            <button type="button" onClick={() => setBurnOnly(false)} className="text-[12px] c-secondary spring-tap">
              Сбросить
            </button>
          </div>
        )}

        <div className="flex gap-2 pb-2">
          <button
            type="button"
            onClick={() => setShowPeriod(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap shrink-0"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '0.5px solid var(--border-norse)' }}
          >
            {periodLabel}
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            onClick={() => navigate('/tenders/platform')}
            className="px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap shrink-0"
            style={{ background: 'var(--bg-elevated)', color: 'var(--blue)', border: '0.5px solid var(--border-norse)' }}
          >
            📡 С площадок
          </button>
        </div>

        <div className="flex gap-1.5 pb-3 overflow-x-auto no-scrollbar">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { haptic.light(); setSubtab(tab.id); setBurnOnly(false); }}
              className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap"
              style={{
                background: subtab === tab.id ? 'var(--bg-elevated)' : 'transparent',
                color: subtab === tab.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border: subtab === tab.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent',
              }}
            >
              {tab.label}
              {tab.id === 'submitted' && kpi.in_work > 0 && (
                <span className="ml-1 px-1 rounded-full text-[10px]" style={{ background: 'var(--blue)', color: '#fff' }}>
                  {kpi.in_work}
                </span>
              )}
            </button>
          ))}
        </div>

        {showSearch && (
          <div className="pb-2">
            <div
              className="flex items-center gap-2 px-3 rounded-xl"
              style={{ height: 40, background: 'var(--bg-surface)', border: '0.5px solid var(--border-norse)' }}
            >
              <Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Поиск..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                className="flex-1 bg-transparent outline-none text-[14px]"
                style={{ color: 'var(--text-primary)' }}
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} style={{ color: 'var(--text-tertiary)' }}>
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        <p className="text-[11px] c-tertiary pb-2 px-0.5">
          {total} {total === 1 ? 'запись' : total < 5 ? 'записи' : 'записей'} · {periodLabel.toLowerCase()}
        </p>

        {loading ? (
          <SkeletonList count={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Trophy}
            iconColor="var(--gold)"
            iconBg="color-mix(in srgb, var(--gold) 10%, transparent)"
            title={search ? 'Ничего не найдено' : 'Нет тендеров'}
            description={search ? 'Измените запрос' : 'Добавьте тендер через +'}
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((tender, i) => {
              const price = Number(tender.tender_price) || 0;
              const burning = isBurning(tender);
              return (
                <button
                  key={tender.id}
                  onClick={() => { haptic.light(); setDetail(tender); }}
                  className="w-full text-left rounded-2xl px-4 py-3.5 spring-tap"
                  style={{
                    background: 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                    border: burning
                      ? '0.5px solid color-mix(in srgb, var(--gold) 45%, var(--border-norse))'
                      : '0.5px solid var(--border-norse)',
                    animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold leading-tight truncate c-primary">
                        {tender.customer_name || tender.tender_title || `#${tender.id}`}
                      </p>
                      {tender.tender_title && tender.customer_name && (
                        <p className="text-[12px] mt-0.5 truncate c-secondary">{tender.tender_title}</p>
                      )}
                    </div>
                    <ChevronRight size={16} className="c-tertiary shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {tender.registry_status && <RegistryStatusBadge status={tender.registry_status} />}
                    {(tender.source_kind || tender.source_label) && (
                      <SourceBadge kind={tender.source_kind} label={tender.source_label} />
                    )}
                    {burning && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--gold) 20%, transparent)', color: 'var(--gold)' }}>
                        🔥 ≤3д
                      </span>
                    )}
                    {price > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px]" style={{ color: 'var(--gold)' }}>
                        <DollarSign size={11} />
                        {formatMoney(price, { short: true })}
                      </span>
                    )}
                    {tender.docs_deadline && (
                      <span className="flex items-center gap-0.5 text-[11px] c-tertiary">
                        <Calendar size={11} />
                        {formatDate(tender.docs_deadline)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      <RegistryDetailSheet
        tender={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        onChanged={refresh}
      />

      <BottomSheet open={showPeriod} onClose={() => setShowPeriod(false)} title="Период">
        <div className="flex flex-col gap-1 pb-4">
          {periodOptions.map((opt) => (
            <button
              key={opt.value || 'all'}
              type="button"
              onClick={() => { setPeriod(opt.value); setShowPeriod(false); haptic.light(); }}
              className="w-full text-left px-4 py-3 rounded-xl spring-tap text-[14px] font-medium"
              style={{
                background: period === opt.value ? 'var(--bg-elevated)' : 'transparent',
                color: period === opt.value ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </BottomSheet>

      {canCreate && (
        <CreateRegistrySheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={refresh} />
      )}
    </PageShell>
  );
}

function CreateRegistrySheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [customer, setCustomer] = useState('');
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [deadline, setDeadline] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCustomer(''); setTitle(''); setPrice(''); setDeadline(''); setComment('');
  };

  const handleSubmit = async () => {
    if (!customer.trim() && !title.trim()) return;
    haptic.light();
    setSaving(true);
    try {
      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      await createRegistryRow({
        customer_name: customer.trim(),
        tender_title: title.trim() || null,
        tender_price: price ? Number(price) : null,
        docs_deadline: deadline || null,
        comment_to: comment.trim() || null,
        registry_status: 'рассмотрение',
        period,
      });
      haptic.success();
      reset();
      onClose();
      onCreated?.();
    } catch (e) {
      window.alert(e?.body?.error || e?.message || 'Ошибка создания');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Новый тендер в реестре">
      <div className="flex flex-col gap-3 pb-4">
        <FormField label="Заказчик *">
          <input className="input-field" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Наименование..." />
        </FormField>
        <FormField label="Название">
          <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Описание..." />
        </FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField label="НМЦ (₽)">
            <input type="number" className="input-field" value={price} onChange={(e) => setPrice(e.target.value)} />
          </FormField>
          <FormField label="Дедлайн">
            <input type="date" className="input-field" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Комментарий ТО">
          <textarea className="input-field resize-none" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </FormField>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={(!customer.trim() && !title.trim()) || saving}
          className="btn-primary spring-tap"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Сохранение…' : 'Добавить в реестр'}
        </button>
      </div>
    </BottomSheet>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="input-label">{label}</label>
      {children}
    </div>
  );
}
