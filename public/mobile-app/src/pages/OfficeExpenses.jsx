import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { Building2, Plus, ChevronRight } from 'lucide-react';
import { formatMoney, relativeTime } from '@/lib/utils';

const CATEGORIES = [
  'Аренда', 'Коммунальные', 'Связь/Интернет', 'Канцелярия', 'Хоз. нужды',
  'ПО/Подписки', 'Транспорт', 'Питание', 'Оборудование офис', 'Маркетинг', 'Юридические', 'Прочее',
];

export default function OfficeExpenses() {
  const haptic = useHaptic();
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { const res = await api.get('/expenses/office'); setExpenses(api.extractRows(res) || []); }
    catch { setExpenses([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchData(); }, [fetchData]);

  const topCategories = useMemo(() => {
    const map = {};
    expenses.forEach((e) => { const c = e.category || 'Прочее'; map[c] = (map[c] || 0) + (Number(e.amount) || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c);
  }, [expenses]);

  const filtered = useMemo(() => {
    if (filter === 'all') return expenses;
    return expenses.filter((e) => e.category === filter);
  }, [expenses, filter]);

  const stats = useMemo(() => ({
    total: expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    count: expenses.length,
    categories: new Set(expenses.map((e) => e.category)).size,
  }), [expenses]);

  return (
    <PageShell title="Офис расходы" headerRight={<button onClick={() => { haptic.light(); setShowCreate(true); }} className="btn-icon c-blue spring-tap"><Plus size={22} /></button>}>
      <PullToRefresh onRefresh={fetchData}>
        {!loading && expenses.length > 0 && (
          <div className="card-hero mb-3" style={{ animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards' }}>
            <p className="input-label">Итого расходов</p>
            <p className="text-[24px] font-bold c-primary">{formatMoney(stats.total)}</p>
            <div className="flex items-center gap-4 mt-2">
              <span className="text-[12px] c-secondary">{stats.count} записей</span>
              <span className="text-[12px] c-tertiary">{stats.categories} категорий</span>
            </div>
          </div>
        )}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          <button onClick={() => { haptic.light(); setFilter('all'); }} className="filter-pill spring-tap" data-active={filter === 'all' ? 'true' : undefined}>Все</button>
          {topCategories.map((c) => <button key={c} onClick={() => { haptic.light(); setFilter(c); }} className="filter-pill spring-tap" data-active={filter === c ? 'true' : undefined}>{c}</button>)}
        </div>
        {loading ? <SkeletonList count={5} /> : filtered.length === 0 ? (
          <EmptyState icon={Building2} iconColor="var(--blue)" iconBg="rgba(74,144,217,0.1)" title="Нет расходов" description="Офисные расходы появятся здесь" />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((exp, i) => (
              <button key={exp.id} onClick={() => { haptic.light(); setDetail(exp); }} className="w-full text-left card-glass px-4 py-3 spring-tap" style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[14px] font-semibold leading-tight c-primary">{exp.description || exp.category || `#${exp.id}`}</p>
                  <ChevronRight size={16} className="c-tertiary" style={{ flexShrink: 0, marginTop: 2 }} />
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className="status-badge c-blue" style={{ background: 'color-mix(in srgb, var(--blue) 15%, transparent)' }}>{exp.category || 'Прочее'}</span>
                  <span className="text-[10px] font-semibold c-gold">{formatMoney(exp.amount || 0, { short: true })}</span>
                  {exp.created_at && <span className="text-[10px] c-tertiary">{relativeTime(exp.created_at)}</span>}
                  {exp.user_name && <span className="text-[10px] c-tertiary">{exp.user_name}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </PullToRefresh>
      <ExpenseDetailSheet expense={detail} onClose={() => setDetail(null)} />
      <CreateExpenseSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchData} />
    </PageShell>
  );
}

function ExpenseDetailSheet({ expense, onClose }) {
  if (!expense) return null;
  const e = expense;
  const fields = [
    { label: 'Категория', value: e.category || 'Прочее', color: 'var(--blue)' },
    { label: 'Сумма', value: formatMoney(e.amount || 0) },
    e.description && { label: 'Описание', value: e.description },
    (e.comment || e.notes) && { label: 'Комментарий', value: e.comment || e.notes, full: true },
    e.user_name && { label: 'Автор', value: e.user_name },
    e.created_at && { label: 'Создано', value: relativeTime(e.created_at) },
  ].filter(Boolean);
  return (
    <BottomSheet open={!!expense} onClose={onClose} title={e.description || 'Расход'}>
      <div className="flex flex-col gap-3 pb-4">
        {fields.map((f, i) => <div key={i}><p className="input-label">{f.label}</p>{f.color ? <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold inline-block" style={{ background: `color-mix(in srgb, ${f.color} 15%, transparent)`, color: f.color }}>{f.value}</span> : <p className={`text-[14px] c-primary ${f.full ? 'whitespace-pre-wrap' : ''}`}>{f.value}</p>}</div>)}
      </div>
    </BottomSheet>
  );
}

function CreateExpenseSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [category, setCategory] = useState('Прочее');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const handleSubmit = async () => {
    if (!amount || !description.trim()) return;
    haptic.light(); setSaving(true);
    try {
      await api.post('/expenses/office', { category, amount: Number(amount), description: description.trim(), comment: comment || null });
      haptic.success(); setCategory('Прочее'); setAmount(''); setDescription(''); setComment(''); onClose(); onCreated();
    } catch {} setSaving(false);
  };
  const valid = amount && description.trim();
  return (
    <BottomSheet open={open} onClose={onClose} title="Новый расход">
      <div className="flex flex-col gap-3 pb-4">
        <div><label className="input-label">Категория *</label><select value={category} onChange={(e) => setCategory(e.target.value)} className="input-field appearance-none">{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div><label className="input-label">Сумма (₽) *</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="input-field" /></div>
        <div><label className="input-label">Описание *</label><input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="За что" className="input-field" /></div>
        <div><label className="input-label">Комментарий</label><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Детали..." rows={2} className="input-field resize-none" /></div>
        <button onClick={handleSubmit} disabled={!valid || saving} className="btn-primary spring-tap mt-1">{saving ? 'Сохранение...' : 'Добавить расход'}</button>
      </div>
    </BottomSheet>
  );
}
