import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import {
  Users, Search, X, ChevronRight, Phone, Star, MapPin, Shield,
  CheckCircle, XCircle, Archive, UserCheck, AlertTriangle, FileWarning,
} from 'lucide-react';
import { StatCard, StatRow } from '@/components/shared/StatCard';

const STATUS_CONFIG = {
  on_site:  { label: 'На объекте',  color: 'var(--green)',  icon: MapPin,      emoji: '🏗', border: 'var(--green)' },
  approved: { label: 'Утверждён',   color: 'var(--info-t)',       icon: UserCheck,   emoji: '✅', border: 'var(--info-t)' },
  ready:    { label: 'Готов',        color: 'var(--blue)',   icon: Shield,      emoji: '⚔️', border: 'var(--blue)' },
  not_ready:{ label: 'Не готов',     color: 'var(--warn-t)', icon: XCircle,     emoji: '🛏', border: 'var(--warn-t)' },
  archive:  { label: 'Архив',       color: 'var(--text-tertiary)', icon: Archive, emoji: '📦', border: 'var(--text-tertiary)' },
};

const FILTER_PILLS = [
  { key: 'all',       label: 'Все' },
  { key: 'on_site',   label: 'На объекте' },
  { key: 'approved',  label: 'Утверждён' },
  { key: 'ready',     label: 'Готов' },
  { key: 'not_ready', label: 'Не готов' },
];

const REASONS = {
  illness: 'Болезнь', vacation: 'Отпуск', family: 'Семейные', training: 'Обучение',
  personal: 'Личные', legal: 'Юридические', injury: 'Травма', no_contact: 'Нет связи',
  refused: 'Отказ', other: 'Другое',
};

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function Personnel() {
  const haptic = useHaptic();
  const user = useAuthStore((s) => s.user);
  // 23.06.2026 BUG-FIX (🟡 Staff-1, D-10): добавлены DIRECTOR_COMM/DIRECTOR_DEV в APPROVE_ROLES.
  // Backend worker-readiness.js:16 READINESS_ROLES включает DIRECTOR_COMM — мобилка должна это
  // отражать. Без фикса DIRECTOR_COMM/DEV не видели кнопок "Готов/Не готов" хотя backend позволял.
  const isHR = ['ADMIN', 'HR', 'HR_MANAGER', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV'].includes(user?.role);

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);
  const [saving, setSaving] = useState(false);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/staff/readiness');
      const rows = api.extractRows(res) || [];
      setEmployees(rows);
    } catch (e) {
      setEmployees([]);
      setError(e.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const stats = useMemo(() => {
    const s = { on_site: 0, approved: 0, ready: 0, not_ready: 0, archive: 0 };
    employees.forEach(e => {
      const st = e.effective_status || e.readiness_status || 'not_ready';
      if (s[st] !== undefined) s[st]++;
    });
    return s;
  }, [employees]);

  const grouped = useMemo(() => {
    let list = employees;
    if (filter !== 'all') {
      list = list.filter(e => (e.effective_status || e.readiness_status || 'not_ready') === filter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        (e.fio || '').toLowerCase().includes(q) ||
        (e.phone || '').includes(q) ||
        (e.position || '').toLowerCase().includes(q)
      );
    }
    // Group by status
    const groups = {};
    const order = ['on_site', 'approved', 'ready', 'not_ready', 'archive'];
    order.forEach(k => { groups[k] = []; });
    list.forEach(e => {
      const st = e.effective_status || e.readiness_status || 'not_ready';
      if (!groups[st]) groups[st] = [];
      groups[st].push(e);
    });
    return order.map(k => ({ key: k, items: groups[k] })).filter(g => g.items.length > 0);
  }, [employees, filter, search]);

  const handleStatusChange = async (emp, newStatus) => {
    haptic.medium();
    setSaving(true);
    try {
      await api.put(`/staff/readiness/${emp.id}/status`, { status: newStatus });
      haptic.success();
      setDetail(null);
      await fetchEmployees();
    } catch (e) {
      haptic.error();
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="Дружина"
      headerRight={
        <button onClick={() => { haptic.light(); setShowSearch(!showSearch); }} className="btn-icon spring-tap">
          <Search size={20} />
        </button>
      }
    >
      <PullToRefresh onRefresh={fetchEmployees}>
        {/* Error */}
        {error && (
          <div className="rounded-xl px-4 py-3 mb-3 flex items-center gap-2"
            style={{ background: 'color-mix(in srgb, var(--err-t) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--err-t) 30%, transparent)' }}
            onClick={() => setError(null)}>
            <AlertTriangle size={16} style={{ color: 'var(--err-t)', flexShrink: 0 }} />
            <span className="text-sm" style={{ color: 'var(--err-t)' }}>{error}</span>
          </div>
        )}

        {/* Stats */}
        {!loading && employees.length > 0 && (
          <StatRow cols={4}>
            <StatCard icon={MapPin}    label="На объекте" value={stats.on_site}  color="var(--green)"  delay={0} />
            <StatCard icon={Shield}    label="Готов"      value={stats.ready}    color="var(--blue)"   delay={60} />
            <StatCard icon={XCircle}   label="Не готов"   value={stats.not_ready} color="var(--warn-t)" delay={120} />
            <StatCard icon={Archive}   label="Архив"      value={stats.archive}  color="var(--text-tertiary)" delay={180} />
          </StatRow>
        )}

        {/* Search */}
        {showSearch && (
          <div className="px-1 pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}>
            <div className="search-bar">
              <Search size={16} className="c-tertiary" style={{ flexShrink: 0 }} />
              <input type="text" placeholder="Поиск по ФИО, телефону..." value={search}
                onChange={(e) => setSearch(e.target.value)} autoFocus />
              {search && <button onClick={() => setSearch('')} className="c-tertiary"><X size={16} /></button>}
            </div>
          </div>
        )}

        {/* Filter pills */}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          {FILTER_PILLS.map(p => (
            <FilterPill key={p.key} active={filter === p.key} label={p.label}
              onClick={() => { haptic.light(); setFilter(p.key); }} />
          ))}
        </div>

        {loading ? <SkeletonList count={6} /> : grouped.length === 0 ? (
          <EmptyState icon={Users} iconColor="var(--info-t)" iconBg="color-mix(in srgb, var(--info-t) 10%, transparent)"
            title={search ? 'Никого не найдено' : 'Нет сотрудников'}
            description={search ? 'Попробуйте изменить запрос' : 'Сотрудники появятся здесь'} />
        ) : (
          <div className="flex flex-col gap-1 pb-4">
            {grouped.map(group => {
              const cfg = STATUS_CONFIG[group.key] || STATUS_CONFIG.not_ready;
              return (
                <div key={group.key}>
                  {/* Group header */}
                  <div className="flex items-center gap-2 px-1 py-2">
                    <div style={{ width: 3, height: 16, borderRadius: 2, background: cfg.color }} />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: cfg.color }}>
                      {cfg.label} ({group.items.length})
                    </span>
                  </div>
                  {group.items.map((emp, i) => (
                    <EmployeeCard key={emp.id} emp={emp} cfg={cfg} index={i}
                      onTap={() => { haptic.light(); setDetail(emp); }} />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      {/* Detail BottomSheet */}
      <EmployeeDetailSheet
        employee={detail}
        onClose={() => setDetail(null)}
        isHR={isHR}
        onStatusChange={handleStatusChange}
        saving={saving}
      />
    </PageShell>
  );
}

function FilterPill({ active, label, onClick }) {
  return (
    <button onClick={onClick} className="filter-pill spring-tap" data-active={active ? 'true' : undefined}>
      {label}
    </button>
  );
}

function EmployeeCard({ emp, cfg, index, onTap }) {
  const name = emp.fio || 'Сотрудник';
  const rating = Number(emp.rating_avg) || 0;
  // 23.06.2026 BUG-FIX (Staff D-01): backend worker-readiness.js:230 отдаёт
  // вложенный объект `permits: { expired: N, expiring: M }`. До фикса mobile
  // читал плоские `expired_permits` / `expiring_permits` которых нет в ответе →
  // иконки 🔴/⚠️ документов на карточке рабочего никогда не зажигались.
  const expiredCnt  = Number(emp.permits?.expired ?? emp.expired_permits ?? 0);
  const expiringCnt = Number(emp.permits?.expiring ?? emp.expiring_permits ?? 0);
  const hasExpired  = expiredCnt > 0;
  const hasExpiring = expiringCnt > 0;

  return (
    <button
      onClick={onTap}
      className="card-glass w-full text-left px-4 py-3 spring-tap mb-1.5"
      style={{
        animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${index * 30}ms both`,
        borderLeft: `3px solid ${cfg.color}`,
      }}
    >
      <div className="flex items-center gap-3">
        <div className="avatar-hero w-10 h-10 text-[14px]">
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold leading-tight truncate c-primary">{name}</p>
          <p className="text-[11px] mt-0.5 c-secondary">
            {emp.position || emp.role_tag || '—'}
            {/* 23.06.2026 BUG-FIX (🟡 Staff-2, D-04): JSX || приоритет — `a || b && <span>` =
                `a || (b && <span>)`. Если last_work_title есть, рендерилась голая строка без обёртки
                и точки. Обернул в скобки. */}
            {(emp.last_work_title || emp.work_title) && <span className="c-tertiary"> · {emp.last_work_title || emp.work_title}</span>}
          </p>
          {/* 23.06.2026 BUG-FIX (🟡 Staff-2, D-04): то же — оборачиваем `||` в скобки. */}
          {(emp.last_pm_name || emp.pm_name) && (
            <p className="text-[10px] mt-0.5 c-tertiary">РП: {emp.last_pm_name || emp.pm_name}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasExpired && <span title="Просроченные документы" style={{ fontSize: 14 }}>🔴</span>}
          {!hasExpired && hasExpiring && <span title="Скоро истекут" style={{ fontSize: 14 }}>⚠️</span>}
          {rating > 0 && (
            <span className="flex items-center gap-0.5 text-[12px] font-semibold c-gold">
              <Star size={12} fill="var(--gold)" />{rating.toFixed(1)}
            </span>
          )}
          <ChevronRight size={16} className="c-tertiary" />
        </div>
      </div>
    </button>
  );
}

function EmployeeDetailSheet({ employee, onClose, isHR, onStatusChange, saving }) {
  if (!employee) return null;
  const e = employee;
  const name = e.fio || 'Сотрудник';
  const rating = Number(e.rating_avg) || 0;
  const st = e.readiness_status || 'unknown';
  const cfg = STATUS_CONFIG[st] || STATUS_CONFIG.not_ready;

  const fields = [
    { label: 'Должность', value: e.position || e.role_tag || '—' },
    e.city && { label: 'Город', value: e.city },
    e.phone && { label: 'Телефон', value: e.phone, link: `tel:${e.phone}` },
    { label: 'Статус', custom: (
      <span className="text-sm font-semibold" style={{ color: cfg.color }}>
        {cfg.emoji} {cfg.label}
      </span>
    )},
    // 23.06.2026 BUG-FIX (🟡 Staff-2, D-04): JSX || приоритет — `a || b && {…}` парсится как
    // `a || (b && {…})`. Если last_work_title задан, в массив попадает голая строка вместо
    // объекта-описания поля, и Field-рендер падает. Оборачиваем `||` в скобки.
    (e.last_work_title || e.work_title) && { label: 'Объект', value: e.last_work_title || e.work_title },
    (e.last_pm_name || e.pm_name) && { label: 'РП', value: e.last_pm_name || e.pm_name },
    e.readiness_date && st === 'ready' && { label: 'Готов с', value: fmtDate(e.readiness_date) },
    e.readiness_reason && st === 'not_ready' && { label: 'Причина', value: REASONS[e.readiness_reason] || e.readiness_reason },
    e.readiness_comment && { label: 'Комментарий', value: e.readiness_comment },
    rating > 0 && {
      label: 'Рейтинг',
      custom: (
        <div className="flex items-center gap-1">
          {[1,2,3,4,5].map(s => (
            <Star key={s} size={16}
              fill={s <= Math.round(rating) ? 'var(--gold)' : 'transparent'}
              style={{ color: s <= Math.round(rating) ? 'var(--gold)' : 'var(--text-tertiary)' }} />
          ))}
          <span className="text-[13px] font-semibold ml-1 c-gold">{rating.toFixed(1)}</span>
        </div>
      ),
    },
    e.is_self_employed && { label: 'Самозанятый', value: '✅ Да' },
    e.is_officially_employed && { label: 'Официальный', value: '✅ Да' },
  ].filter(Boolean);

  return (
    <BottomSheet open={!!employee} onClose={onClose} title={name}>
      <div className="flex flex-col gap-3 pb-4">
        <div className="flex items-center gap-3 pb-1">
          <div className="avatar-hero w-14 h-14 text-xl">{name.charAt(0).toUpperCase()}</div>
          <div>
            <p className="text-[16px] font-bold c-primary">{name}</p>
            <p className="text-[12px] c-secondary">{e.position || e.role_tag || '—'}</p>
          </div>
        </div>

        {fields.map((f, i) => (
          <div key={i}>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">{f.label}</p>
            {f.custom ? f.custom : (
              f.link ? <a href={f.link} className="text-[14px] c-blue">{f.value}</a>
                     : <p className="text-[14px] c-primary">{f.value}</p>
            )}
          </div>
        ))}

        {/* HR actions */}
        {isHR && st !== 'on_site' && (
          <div className="flex gap-2 mt-2">
            {st !== 'ready' && (
              <button
                onClick={() => onStatusChange(e, 'ready')}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 spring-tap"
                style={{
                  background: 'color-mix(in srgb, var(--green) 15%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--green) 35%, transparent)',
                  color: 'var(--green)',
                }}
              >
                ⚔️ Готов
              </button>
            )}
            {st !== 'not_ready' && (
              <button
                onClick={() => onStatusChange(e, 'not_ready')}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 spring-tap"
                style={{
                  background: 'color-mix(in srgb, var(--warn-t) 15%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--warn-t) 35%, transparent)',
                  color: 'var(--warn-t)',
                }}
              >
                🛏 Не готов
              </button>
            )}
          </div>
        )}

        {/* Call button */}
        {e.phone && (
          <a href={`tel:${e.phone}`}
            className="btn-action spring-tap c-green mt-1"
            style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)' }}>
            <Phone size={16} /> Позвонить
          </a>
        )}
      </div>
    </BottomSheet>
  );
}
