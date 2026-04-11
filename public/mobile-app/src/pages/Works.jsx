import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import {
  Wrench, Search, Plus, ChevronRight, X,
  DollarSign, User, Briefcase, TrendingUp, CheckCircle2, Sparkles,
} from 'lucide-react';
import { formatDate, formatMoney } from '@/lib/utils';
import AsgardSelect from '@/components/ui/AsgardSelect';

function getStatusColor(status) {
  if (!status) return 'var(--text-tertiary)';
  const s = status.toLowerCase();
  if (['сдали', 'завершен', 'закрыт'].some((k) => s.includes(k))) return 'var(--green)';
  if (['в работе', 'выполнен', 'мобилиз'].some((k) => s.includes(k))) return 'var(--blue)';
  if (['пауз', 'ожидан', 'подписан'].some((k) => s.includes(k))) return 'var(--gold)';
  if (['отмен', 'просроч'].some((k) => s.includes(k))) return 'var(--red-soft)';
  return 'var(--text-tertiary)';
}

const DONE_STATUSES = ['работы сдали', 'завершена', 'закрыт', 'закрыто', 'отменено'];
function isDone(status) {
  return status && DONE_STATUSES.some((d) => status.toLowerCase().includes(d));
}

const ADMIN_ROLES = ['ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV', 'HEAD_PM'];
const CREATE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

const FILTERS = [
  { id: 'all',    label: 'Все' },
  { id: 'active', label: 'В работе' },
  { id: 'done',   label: 'Завершены' },
  { id: 'paused', label: 'На паузе' },
];

export default function Works() {
  const user = useAuthStore((s) => s.user);
  const haptic = useHaptic();
  const [works, setWorks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [filter, setFilter] = useState('all');
  const [detailWork, setDetailWork] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const isAdmin = user && ADMIN_ROLES.includes(user.role);
  const canCreate = user && CREATE_ROLES.includes(user.role);

  const fetchWorks = useCallback(async () => {
    setLoading(true);
    try {
      const params = isAdmin ? '' : `?pm_id=${user.id}`;
      const res = await api.get(`/works${params}`);
      setWorks(api.extractRows(res) || []);
    } catch {
      setWorks([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, user?.id]);

  useEffect(() => { fetchWorks(); }, [fetchWorks]);

  const handleRefresh = useCallback(async () => {
    await fetchWorks();
  }, [fetchWorks]);

  const stats = useMemo(() => {
    const total = works.length;
    const active = works.filter((w) => !isDone(w.work_status)).length;
    const completed = works.filter((w) => isDone(w.work_status)).length;
    const budget = works.reduce((sum, w) => sum + (Number(w.contract_value) || 0), 0);
    return { total, active, completed, budget };
  }, [works]);

  const filtered = useMemo(() => {
    let list = works;
    if (filter === 'active') {
      list = list.filter((w) => {
        const s = (w.work_status || '').toLowerCase();
        return ['работ', 'выполнен', 'мобилиз', 'подготовк'].some((k) => s.includes(k));
      });
    } else if (filter === 'done') {
      list = list.filter((w) => isDone(w.work_status));
    } else if (filter === 'paused') {
      list = list.filter((w) => (w.work_status || '').toLowerCase().includes('пауз'));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((w) =>
        (w.work_title || '').toLowerCase().includes(q) ||
        (w.customer_name || '').toLowerCase().includes(q) ||
        (w.pm_name || '').toLowerCase().includes(q) ||
        (w.object_name || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [works, filter, search]);

  return (
    <PageShell
      title={isAdmin ? 'Все работы' : 'Мои работы'}
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
      <PullToRefresh onRefresh={handleRefresh}>
        {showSearch && (
          <div className="px-1 pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}>
            <div
              className="flex items-center gap-2 px-3 rounded-xl"
              style={{ height: 36, background: 'var(--bg-surface-alt)', border: '0.5px solid var(--border-norse)' }}
            >
              <Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Поиск работ..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
                className="flex-1 bg-transparent outline-none text-[14px]"
                style={{ color: 'var(--text-primary)', caretColor: 'var(--gold)' }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ color: 'var(--text-tertiary)' }}>
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && works.length > 0 && (
          <div
            className="grid grid-cols-4 gap-1.5 px-1 pb-3"
            style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}
          >
            <StatCard icon={Briefcase} label="Всего" value={stats.total} color="var(--text-primary)" />
            <StatCard icon={TrendingUp} label="Активных" value={stats.active} color="var(--blue)" />
            <StatCard icon={DollarSign} label="Бюджет" value={formatMoney(stats.budget, { short: true })} color="var(--gold)" small />
            <StatCard icon={CheckCircle2} label="Завершено" value={stats.completed} color="var(--green)" />
          </div>
        )}

        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => { haptic.light(); setFilter(f.id); }}
              className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap"
              style={{
                background: filter === f.id ? 'var(--bg-elevated)' : 'transparent',
                color: filter === f.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border: filter === f.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <SkeletonList count={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Wrench}
            iconColor="var(--green)"
            iconBg="rgba(48, 209, 88, 0.1)"
            title={search ? 'Ничего не найдено' : 'Нет работ'}
            description={search ? 'Попробуйте изменить запрос' : 'Работы появятся здесь'}
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((work, i) => {
              const statusColor = getStatusColor(work.work_status);
              const budget = Number(work.contract_value) || 0;
              const progress = Number(work.progress) || 0;
              return (
                <button
                  key={work.id}
                  onClick={() => { haptic.light(); setDetailWork(work); }}
                  className="w-full text-left rounded-2xl px-4 py-3 spring-tap"
                  style={{
                    background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
                    backdropFilter: 'blur(8px)',
                    border: '0.5px solid var(--border-norse)',
                    animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 50}ms both`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
                      {work.customer_name || work.work_title || `Работа #${work.id}`}
                    </p>
                    <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 2 }} />
                  </div>
                  {work.work_title && work.customer_name && (
                    <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                      {work.work_title}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {work.work_status && (
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ background: `color-mix(in srgb, ${statusColor} 15%, transparent)`, color: statusColor }}
                      >
                        {work.work_status}
                      </span>
                    )}
                    {budget > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--gold)' }}>
                        <DollarSign size={10} />
                        {formatMoney(budget, { short: true })}
                      </span>
                    )}
                    {work.pm_name && (
                      <span className="flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                        <User size={10} />
                        {work.pm_name}
                      </span>
                    )}
                  </div>
                  {progress > 0 && (
                    <div className="mt-2 rounded-full overflow-hidden" style={{ height: 3, background: 'var(--bg-surface-alt)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(progress, 100)}%`,
                          background: progress >= 100 ? 'var(--green)' : 'var(--blue)',
                          transition: 'width 300ms ease',
                        }}
                      />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      <WorkDetailSheet work={detailWork} onClose={() => setDetailWork(null)} />
      {canCreate && (
        <CreateWorkSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchWorks} />
      )}
    </PageShell>
  );
}

function StatCard({ icon: Icon, label, value, color, small }) {
  return (
    <div
      className="flex flex-col items-center gap-0.5 py-2.5 rounded-xl"
      style={{
        background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
        border: '0.5px solid var(--border-norse)',
      }}
    >
      <Icon size={14} style={{ color }} />
      <p className={`font-bold ${small ? 'text-[11px]' : 'text-[15px]'}`} style={{ color }}>{value}</p>
      <p className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
    </div>
  );
}

function WorkDetailSheet({ work, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const navigate = useNavigate();
  const haptic = useHaptic();

  useEffect(() => {
    if (!work) { setDetail(null); return; }
    setLoadingDetail(true);
    api.get(`/works/${work.id}`)
      .then((res) => setDetail(res))
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [work?.id]);

  if (!work) return null;

  const w = detail?.work || work;
  const expenses = detail?.expenses || [];
  const statusColor = getStatusColor(w.work_status);
  const budget = Number(w.contract_value) || 0;
  const costPlan = Number(w.cost_plan) || 0;
  const costFact = Number(w.cost_fact) || 0;
  const progress = Number(w.progress) || 0;

  const fields = [
    { label: 'Статус', value: w.work_status, color: statusColor },
    w.customer_name && { label: 'Заказчик', value: w.customer_name },
    w.object_name && { label: 'Объект', value: w.object_name },
    w.work_title && { label: 'Название', value: w.work_title },
    w.pm_name && { label: 'РП', value: w.pm_name },
    w.city && { label: 'Город', value: w.city },
    w.address && { label: 'Адрес', value: w.address },
    budget > 0 && { label: 'Бюджет', value: formatMoney(budget) },
    costPlan > 0 && { label: 'Себест. план', value: formatMoney(costPlan) },
    costFact > 0 && { label: 'Себест. факт', value: formatMoney(costFact) },
    w.start_date && { label: 'Начало', value: formatDate(w.start_date) },
    w.end_plan && { label: 'Окончание (план)', value: formatDate(w.end_plan) },
    w.end_fact && { label: 'Окончание (факт)', value: formatDate(w.end_fact) },
    w.description && { label: 'Описание', value: w.description, full: true },
    w.notes && { label: 'Заметки', value: w.notes, full: true },
  ].filter(Boolean);

  return (
    <BottomSheet open={!!work} onClose={onClose} title={w.customer_name || w.work_title || `Работа #${w.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {/* AP1: Кнопка авто-просчёта Мимиром */}
        <button
          onClick={() => {
            haptic.medium();
            onClose();
            navigate(`/mimir-estimate/${w.id}`);
          }}
          className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3 spring-tap"
          style={{
            background: 'linear-gradient(135deg, #C8293B 0%, #1E4D8C 50%, #D4A843 100%)',
            color: '#fff',
            border: 'none',
            boxShadow: '0 4px 18px rgba(212,168,67,0.25), 0 0 30px rgba(200,41,59,0.12)',
          }}
        >
          <Sparkles size={18} />
          <span className="text-[14px] font-bold tracking-wide">Просчитать Мимиром</span>
        </button>

        {progress > 0 && (
          <div
            className="rounded-xl px-4 py-3"
            style={{
              background: 'color-mix(in srgb, var(--bg-surface) 85%, transparent)',
              border: '0.5px solid var(--border-norse)',
            }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                Прогресс
              </p>
              <p className="text-[14px] font-bold" style={{ color: progress >= 100 ? 'var(--green)' : 'var(--blue)' }}>
                {progress}%
              </p>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--bg-surface-alt)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(progress, 100)}%`,
                  background: progress >= 100 ? 'var(--green)' : 'var(--blue)',
                }}
              />
            </div>
          </div>
        )}

        {loadingDetail ? (
          <SkeletonList count={3} />
        ) : (
          fields.map((f, i) => (
            <div key={i}>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                {f.label}
              </p>
              {f.color ? (
                <span
                  className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block"
                  style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}
                >
                  {f.value}
                </span>
              ) : (
                <p className={`text-[14px] ${f.full ? 'whitespace-pre-wrap' : ''}`} style={{ color: 'var(--text-primary)' }}>
                  {f.value}
                </p>
              )}
            </div>
          ))
        )}

        {expenses.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
              Расходы ({expenses.length})
            </p>
            <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
              {expenses.map((exp, i) => (
                <div
                  key={exp.id || i}
                  className="flex items-center justify-between px-3 py-2.5"
                  style={{
                    background: 'var(--bg-surface)',
                    borderBottom: i < expenses.length - 1 ? '0.5px solid var(--border-norse)' : 'none',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] truncate" style={{ color: 'var(--text-primary)' }}>
                      {exp.description || exp.category || `Расход #${exp.id}`}
                    </p>
                    {exp.date && (
                      <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{formatDate(exp.date)}</p>
                    )}
                  </div>
                  <p className="text-[13px] font-semibold shrink-0 ml-2" style={{ color: 'var(--red-soft)' }}>
                    {formatMoney(exp.amount || 0)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function CreateWorkSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [title, setTitle] = useState('');
  const [customer, setCustomer] = useState('');
  const [budget, setBudget] = useState('');
  const [status, setStatus] = useState('Новая');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle(''); setCustomer(''); setBudget('');
    setStatus('Новая'); setStartDate(''); setEndDate('');
    setDescription('');
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    haptic.light();
    setSaving(true);
    try {
      await api.post('/works', {
        work_title: title.trim(),
        customer_name: customer.trim() || null,
        contract_value: budget ? Number(budget) : null,
        work_status: status,
        start_date: startDate || null,
        end_plan: endDate || null,
        description: description.trim() || null,
      });
      haptic.success();
      reset();
      onClose();
      onCreated();
    } catch {}
    setSaving(false);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Новая работа">
      <div className="flex flex-col gap-3 pb-4">
        <FormField label="Название работы">
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Название..."
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
            style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: '0.5px solid var(--border-norse)', caretColor: 'var(--gold)' }}
          />
        </FormField>

        <FormField label="Заказчик">
          <input
            type="text" value={customer} onChange={(e) => setCustomer(e.target.value)}
            placeholder="Наименование заказчика..."
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
            style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: '0.5px solid var(--border-norse)', caretColor: 'var(--gold)' }}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-2">
          <FormField label="Бюджет (₽)">
            <input
              type="number" value={budget} onChange={(e) => setBudget(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
              style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: '0.5px solid var(--border-norse)', caretColor: 'var(--gold)' }}
            />
          </FormField>
          <FormField label="Статус">
            <AsgardSelect
              options={[
                { value: 'Новая', label: 'Новая' },
                { value: 'В работе', label: 'В работе' },
                { value: 'На паузе', label: 'На паузе' },
                { value: 'Мобилизация', label: 'Мобилизация' },
              ]}
              value={status}
              onChange={(val) => setStatus(val)}
              placeholder="Статус"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <FormField label="Начало">
            <input
              type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
              style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: '0.5px solid var(--border-norse)' }}
            />
          </FormField>
          <FormField label="Окончание (план)">
            <input
              type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none"
              style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: '0.5px solid var(--border-norse)' }}
            />
          </FormField>
        </div>

        <FormField label="Описание">
          <textarea
            value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Подробности..." rows={3}
            className="w-full px-3 py-2.5 rounded-xl text-[14px] outline-none resize-none"
            style={{ background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: '0.5px solid var(--border-norse)', caretColor: 'var(--gold)' }}
          />
        </FormField>

        <button
          onClick={handleSubmit}
          disabled={!title.trim() || saving}
          className="w-full py-3 rounded-xl font-semibold text-[14px] spring-tap mt-1"
          style={{
            background: title.trim() ? 'var(--gold-gradient)' : 'var(--bg-elevated)',
            color: title.trim() ? '#fff' : 'var(--text-tertiary)',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Сохранение...' : 'Создать работу'}
        </button>
      </div>
    </BottomSheet>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
