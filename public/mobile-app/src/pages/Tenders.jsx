import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { StatCard, StatRow } from '@/components/shared/StatCard';
import {
  Trophy, Search, Plus, ChevronRight, X,
  DollarSign, User, Calendar, TrendingUp,
  CheckCircle2, XCircle, Briefcase,
} from 'lucide-react';
import { formatDate, formatMoney } from '@/lib/utils';

function getStatusColor(status) {
  if (!status) return 'var(--text-tertiary)';
  const s = status.toLowerCase();
  if (['выиграли', 'контракт', 'клиент согласился', 'ткп согласовано'].some((k) => s.includes(k))) return 'var(--green)';
  if (['в просчёте', 'на просчёте', 'в работе', 'выполняется', 'мобилизация', 'на согласовании', 'согласование'].some((k) => s.includes(k))) return 'var(--blue)';
  if (['кп отправлено', 'ткп отправлено', 'переговоры', 'истекает'].some((k) => s.includes(k))) return 'var(--gold)';
  if (['проиграли', 'отказ', 'клиент отказался'].some((k) => s.includes(k))) return 'var(--red-soft)';
  return 'var(--text-tertiary)';
}

const WON_STATUSES  = ['выиграли', 'контракт', 'клиент согласился'];
const LOST_STATUSES = ['проиграли', 'отказ', 'клиент отказался', 'отменён'];

function isWon(s)  { return s && WON_STATUSES.some((k)  => s.toLowerCase().includes(k)); }
function isLost(s) { return s && LOST_STATUSES.some((k) => s.toLowerCase().includes(k)); }

const FILTERS = [
  { id: 'all',  label: 'Все' },
  { id: 'new',  label: 'Новые' },
  { id: 'wip',  label: 'В работе' },
  { id: 'won',  label: 'Выиграно' },
  { id: 'lost', label: 'Проиграно' },
];

const CREATE_ROLES = ['ADMIN', 'PM', 'HEAD_PM', 'TO', 'HEAD_TO', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'];

export default function Tenders() {
  const user   = useAuthStore((s) => s.user);
  const haptic = useHaptic();
  const [tenders, setTenders]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [filter, setFilter]         = useState('all');
  const [detail, setDetail]         = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const canCreate = user && CREATE_ROLES.includes(user.role);

  const fetchTenders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/tenders?limit=200');
      setTenders(api.extractRows(res) || []);
    } catch {
      setTenders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTenders(); }, [fetchTenders]);

  const stats = useMemo(() => {
    const total    = tenders.length;
    const won      = tenders.filter((t) => isWon(t.tender_status)).length;
    const lost     = tenders.filter((t) => isLost(t.tender_status)).length;
    const active   = total - won - lost;
    const totalSum = tenders.reduce((s, t) => s + (Number(t.tender_price) || 0), 0);
    return { total, won, lost, active, totalSum };
  }, [tenders]);

  const filtered = useMemo(() => {
    let list = tenders;
    if (filter === 'new') {
      list = list.filter((t) => {
        const s = (t.tender_status || '').toLowerCase();
        return ['новый', 'получен', 'черновик'].some((k) => s.includes(k));
      });
    } else if (filter === 'wip') {
      list = list.filter((t) => {
        const s = (t.tender_status || '').toLowerCase();
        return ['просчёт', 'кп', 'ткп', 'переговор', 'согласован', 'в работе', 'выполняется', 'мобилизация'].some((k) => s.includes(k));
      });
    } else if (filter === 'won') {
      list = list.filter((t) => isWon(t.tender_status));
    } else if (filter === 'lost') {
      list = list.filter((t) => isLost(t.tender_status));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) =>
        (t.customer_name || '').toLowerCase().includes(q) ||
        (t.tender_title  || '').toLowerCase().includes(q) ||
        (t.pm_name       || '').toLowerCase().includes(q) ||
        (t.group_tag     || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [tenders, filter, search]);

  const winRate = stats.total > 0
    ? Math.round((stats.won / (stats.won + stats.lost || 1)) * 100)
    : 0;

  return (
    <PageShell
      title="Тендеры"
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
      <PullToRefresh onRefresh={fetchTenders}>
        {showSearch && (
          <div className="pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}>
            <div
              className="flex items-center gap-2 px-3 rounded-xl"
              style={{ height: 40, background: 'var(--bg-surface)', border: '0.5px solid var(--border-norse)' }}
            >
              <Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Поиск тендеров..."
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

        {/* Герой: общая сумма и процент побед */}
        {!loading && tenders.length > 0 && (
          <div
            className="rounded-2xl px-4 py-4 mb-3 flex items-center justify-between"
            style={{
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--gold) 12%, var(--bg-surface)), color-mix(in srgb, var(--green) 6%, var(--bg-surface)))',
              border: '0.5px solid color-mix(in srgb, var(--gold) 20%, var(--border-norse))',
              animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards',
            }}
          >
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Общая сумма
              </p>
              <p className="text-[22px] font-bold" style={{ color: 'var(--gold)' }}>
                {formatMoney(stats.totalSum)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Winrate
              </p>
              <p className="text-[22px] font-bold" style={{ color: 'var(--green)' }}>
                {winRate}%
              </p>
            </div>
          </div>
        )}

        {!loading && tenders.length > 0 && (
          <StatRow cols={3}>
            <StatCard icon={Briefcase}    label="Всего"      value={stats.total}  color="var(--text-primary)" delay={0} />
            <StatCard icon={CheckCircle2} label="Выиграно"   value={stats.won}    color="var(--green)"        delay={60} />
            <StatCard icon={XCircle}      label="Проиграно"  value={stats.lost}   color="var(--red-soft)"     delay={120} />
          </StatRow>
        )}

        <div className="flex gap-1.5 pb-3 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => { haptic.light(); setFilter(f.id); }}
              className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold spring-tap"
              style={{
                background: filter === f.id ? 'var(--bg-elevated)' : 'transparent',
                color:      filter === f.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border:     filter === f.id ? '0.5px solid var(--border-light)' : '0.5px solid transparent',
              }}
            >
              {f.label}
              {f.id === 'wip' && stats.active > 0 && (
                <span
                  className="ml-1 px-1 rounded-full text-[10px]"
                  style={{ background: 'var(--blue)', color: '#fff' }}
                >
                  {stats.active}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <SkeletonList count={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Trophy}
            iconColor="var(--gold)"
            iconBg="color-mix(in srgb, var(--gold) 10%, transparent)"
            title={search ? 'Ничего не найдено' : 'Нет тендеров'}
            description={search ? 'Попробуйте изменить запрос' : 'Тендеры появятся здесь'}
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((tender, i) => {
              const price = Number(tender.tender_price) || 0;
              return (
                <button
                  key={tender.id}
                  onClick={() => { haptic.light(); setDetail(tender); }}
                  className="w-full text-left rounded-2xl px-4 py-3.5 spring-tap"
                  style={{
                    background:    'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                    backdropFilter:'blur(8px)',
                    border:        '0.5px solid var(--border-norse)',
                    animation:     `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both`,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
                        {tender.customer_name || tender.tender_title || `Тендер #${tender.id}`}
                      </p>
                      {tender.tender_title && tender.customer_name && (
                        <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                          {tender.tender_title}
                        </p>
                      )}
                    </div>
                    <ChevronRight size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: 3 }} />
                  </div>

                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {tender.tender_status && <StatusBadge status={tender.tender_status} />}
                    {price > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px]" style={{ color: 'var(--gold)' }}>
                        <DollarSign size={11} />
                        {formatMoney(price, { short: true })}
                      </span>
                    )}
                    {tender.pm_name && (
                      <span className="flex items-center gap-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        <User size={11} />
                        {tender.pm_name}
                      </span>
                    )}
                    {tender.docs_deadline && (
                      <span className="flex items-center gap-0.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
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

      <TenderDetailSheet tender={detail} onClose={() => setDetail(null)} />
      {canCreate && (
        <CreateTenderSheet open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchTenders} />
      )}
    </PageShell>
  );
}

function TenderDetailSheet({ tender, onClose }) {
  const [full, setFull]           = useState(null);
  const [loadingFull, setLoading] = useState(false);

  useEffect(() => {
    if (!tender) { setFull(null); return; }
    setLoading(true);
    api.get(`/tenders/${tender.id}`)
      .then((res) => setFull(res))
      .catch(() => setFull(null))
      .finally(() => setLoading(false));
  }, [tender?.id]);

  if (!tender) return null;

  const t         = full?.tender || tender;
  const price     = Number(t.tender_price) || 0;
  const estimates = full?.estimates || [];
  const works     = full?.works || [];

  const fields = [
    t.customer_name && { label: 'Заказчик',  value: t.customer_name },
    t.tender_title  && { label: 'Название',   value: t.tender_title },
    t.tender_type   && { label: 'Тип',        value: t.tender_type },
    price > 0       && { label: 'Сумма',      value: formatMoney(price) },
    t.docs_deadline && { label: 'Дедлайн',    value: formatDate(t.docs_deadline) },
    t.pm_name       && { label: 'РП',         value: t.pm_name },
    t.group_tag     && { label: 'Группа',     value: t.group_tag },
    t.period        && { label: 'Период',     value: t.period },
    t.comment_to    && { label: 'Комментарий ТО', value: t.comment_to, full: true },
    t.comment_dir   && { label: 'Комментарий директора', value: t.comment_dir, full: true },
    t.reject_reason && { label: 'Причина отказа', value: t.reject_reason, full: true },
  ].filter(Boolean);

  return (
    <BottomSheet open={!!tender} onClose={onClose} title={t.customer_name || `Тендер #${t.id}`}>
      <div className="flex flex-col gap-3 pb-4">
        {t.tender_status && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
              Статус
            </p>
            <StatusBadge status={t.tender_status} />
          </div>
        )}

        {loadingFull ? (
          <SkeletonList count={3} />
        ) : (
          <>
            {fields.length > 0 && (
              <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
                {fields.map((f, i) => (
                  <div
                    key={i}
                    className="px-4 py-3"
                    style={{
                      background:   'var(--bg-surface)',
                      borderBottom: i < fields.length - 1 ? '0.5px solid var(--border-norse)' : 'none',
                    }}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {f.label}
                    </p>
                    <p className={`text-[14px] ${f.full ? 'whitespace-pre-wrap' : ''}`} style={{ color: 'var(--text-primary)' }}>
                      {f.value}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {estimates.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                  Просчёты ({estimates.length})
                </p>
                <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
                  {estimates.map((e, i) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between px-3 py-2.5"
                      style={{
                        background:   'var(--bg-surface)',
                        borderBottom: i < estimates.length - 1 ? '0.5px solid var(--border-norse)' : 'none',
                      }}
                    >
                      <p className="text-[13px] truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                        {e.title || `Просчёт #${e.id}`}
                      </p>
                      {e.amount && (
                        <p className="text-[12px] font-semibold ml-2 shrink-0" style={{ color: 'var(--gold)' }}>
                          {formatMoney(e.amount, { short: true })}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {works.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                  Работы ({works.length})
                </p>
                <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border-norse)' }}>
                  {works.map((w, i) => (
                    <div
                      key={w.id}
                      className="flex items-center justify-between px-3 py-2.5"
                      style={{
                        background:   'var(--bg-surface)',
                        borderBottom: i < works.length - 1 ? '0.5px solid var(--border-norse)' : 'none',
                      }}
                    >
                      <p className="text-[13px] truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                        {w.work_title || `Работа #${w.id}`}
                      </p>
                      {w.work_status && (
                        <div className="ml-2 shrink-0">
                          <StatusBadge status={w.work_status} dot={false} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}

function CreateTenderSheet({ open, onClose, onCreated }) {
  const haptic = useHaptic();
  const [customer,    setCustomer]    = useState('');
  const [title,       setTitle]       = useState('');
  const [price,       setPrice]       = useState('');
  const [deadline,    setDeadline]    = useState('');
  const [tenderType,  setTenderType]  = useState('');
  const [comment,     setComment]     = useState('');
  const [saving,      setSaving]      = useState(false);

  const reset = () => {
    setCustomer(''); setTitle(''); setPrice('');
    setDeadline(''); setTenderType(''); setComment('');
  };

  const handleSubmit = async () => {
    if (!customer.trim()) return;
    haptic.light();
    setSaving(true);
    try {
      await api.post('/tenders', {
        customer:     customer.trim(),
        tender_number: title.trim() || null,
        tender_price: price ? Number(price) : null,
        deadline:     deadline || null,
        tender_type:  tenderType || null,
        comment_to:   comment.trim() || null,
      });
      haptic.success();
      reset();
      onClose();
      onCreated();
    } catch {}
    setSaving(false);
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="Новый тендер">
      <div className="flex flex-col gap-3 pb-4">
        <FormField label="Заказчик *">
          <input
            type="text" value={customer} onChange={(e) => setCustomer(e.target.value)}
            placeholder="Наименование заказчика..."
            className="input-field"
          />
        </FormField>

        <FormField label="Название тендера">
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Описание тендера..."
            className="input-field"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-2">
          <FormField label="Сумма (₽)">
            <input
              type="number" value={price} onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
              className="input-field"
            />
          </FormField>
          <FormField label="Дедлайн">
            <input
              type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
              className="input-field"
            />
          </FormField>
        </div>

        <FormField label="Тип">
          <input
            type="text" value={tenderType} onChange={(e) => setTenderType(e.target.value)}
            placeholder="Тип тендера..."
            className="input-field"
          />
        </FormField>

        <FormField label="Комментарий">
          <textarea
            value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="Примечания..."
            rows={2}
            className="input-field resize-none"
          />
        </FormField>

        <button
          onClick={handleSubmit}
          disabled={!customer.trim() || saving}
          className="btn-primary spring-tap mt-1"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Сохранение...' : 'Создать тендер'}
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
