import { useState, useEffect, useCallback, useMemo } from 'react';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import {
  Users, Search, X, ChevronRight, Phone, Star, MapPin, Copy, Check,
} from 'lucide-react';

const ROLE_MAP = {
  worker: 'Рабочий', foreman: 'Бригадир', welder: 'Сварщик',
  fitter: 'Слесарь', cleaner: 'Специалист ХО', rigger: 'Стропальщик',
  driver: 'Водитель', engineer: 'Инженер', master: 'Мастер',
};

function getRoleName(tag) {
  return ROLE_MAP[tag] || tag || '—';
}

export default function Personnel() {
  const haptic = useHaptic();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState(null);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/staff/employees?limit=1000');
      const rows = api.extractRows(res) || [];
      rows.sort((a, b) => {
        const ra = Number(a.rating_avg) || 0;
        const rb = Number(b.rating_avg) || 0;
        if (rb !== ra) return rb - ra;
        return (a.fio || a.name || '').localeCompare(b.fio || b.name || '', 'ru');
      });
      setEmployees(rows);
    } catch {
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const roleTags = useMemo(() => {
    const tags = new Set();
    employees.forEach((e) => { if (e.role_tag) tags.add(e.role_tag); });
    return Array.from(tags).sort();
  }, [employees]);

  const filtered = useMemo(() => {
    let list = employees;
    if (filter !== 'all') {
      list = list.filter((e) => e.role_tag === filter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((e) =>
        (e.fio || e.name || '').toLowerCase().includes(q) ||
        (e.city || '').toLowerCase().includes(q) ||
        (e.phone || '').includes(q)
      );
    }
    return list;
  }, [employees, filter, search]);

  return (
    <PageShell
      title="Дружина"
      headerRight={
        <button
          onClick={() => { haptic.light(); setShowSearch(!showSearch); }}
          className="btn-icon spring-tap"
        >
          <Search size={20} />
        </button>
      }
    >
      <PullToRefresh onRefresh={fetchEmployees}>
        {showSearch && (
          <div className="px-1 pb-2" style={{ animation: 'fadeInUp 150ms var(--ease-spring) forwards' }}>
            <div className="search-bar">
              <Search size={16} className="c-tertiary" style={{ flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Поиск по имени, городу..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              {search && (
                <button onClick={() => setSearch('')} className="c-tertiary">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Filter pills */}
        <div className="flex gap-1.5 px-1 pb-3 overflow-x-auto no-scrollbar">
          <FilterPill active={filter === 'all'} label="Все" onClick={() => { haptic.light(); setFilter('all'); }} />
          {roleTags.map((tag) => (
            <FilterPill
              key={tag}
              active={filter === tag}
              label={getRoleName(tag)}
              onClick={() => { haptic.light(); setFilter(tag); }}
            />
          ))}
        </div>

        {loading ? (
          <SkeletonList count={6} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            iconColor="#7B68EE"
            iconBg="rgba(123, 104, 238, 0.1)"
            title={search ? 'Никого не найдено' : 'Нет сотрудников'}
            description={search ? 'Попробуйте изменить запрос' : 'Сотрудники появятся здесь'}
          />
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {filtered.map((emp, i) => {
              const rating = Number(emp.rating_avg) || 0;
              const name = emp.fio || emp.name || 'Сотрудник';
              return (
                <button
                  key={emp.id}
                  onClick={() => { haptic.light(); setDetail(emp); }}
                  className="card-glass w-full text-left px-4 py-3 spring-tap"
                  style={{ animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${i * 40}ms both` }}
                >
                  <div className="flex items-center gap-3">
                    <div className="avatar-hero w-10 h-10 text-[14px]">
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold leading-tight truncate c-primary">
                        {name}
                      </p>
                      <p className="text-[11px] mt-0.5 c-secondary">
                        {getRoleName(emp.role_tag)}
                        {emp.city && <span className="c-tertiary"> · {emp.city}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {rating > 0 && (
                        <span className="flex items-center gap-0.5 text-[12px] font-semibold c-gold">
                          <Star size={12} fill="var(--gold)" />
                          {rating.toFixed(1)}
                        </span>
                      )}
                      <ChevronRight size={16} className="c-tertiary" />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </PullToRefresh>

      <EmployeeDetailSheet employee={detail} onClose={() => setDetail(null)} />
    </PageShell>
  );
}

function FilterPill({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="filter-pill spring-tap"
      data-active={active ? 'true' : undefined}
    >
      {label}
    </button>
  );
}

function EmployeeDetailSheet({ employee, onClose }) {
  const haptic = useHaptic();
  const [copied, setCopied] = useState(null);

  if (!employee) return null;
  const e = employee;
  const name = e.fio || e.name || 'Сотрудник';
  const rating = Number(e.rating_avg) || 0;

  const copyText = (text, key) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    haptic.light();
    setTimeout(() => setCopied(null), 1500);
  };

  const fields = [
    { label: 'ФИО', value: name },
    { label: 'Должность', value: getRoleName(e.role_tag) },
    e.city && { label: 'Город', value: e.city },
    e.phone && { label: 'Телефон', value: e.phone, link: `tel:${e.phone}` },
    rating > 0 && {
      label: 'Рейтинг',
      custom: (
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <Star
              key={s}
              size={16}
              fill={s <= Math.round(rating) ? 'var(--gold)' : 'transparent'}
              style={{ color: s <= Math.round(rating) ? 'var(--gold)' : 'var(--text-tertiary)' }}
            />
          ))}
          <span className="text-[13px] font-semibold ml-1 c-gold">
            {rating.toFixed(1)}
          </span>
        </div>
      ),
    },
    e.permits?.length > 0 && { label: 'Допуски', value: e.permits.join(', ') },
    e.passport_series && e.passport_number && { label: 'Паспорт', value: `${e.passport_series} ${e.passport_number}` },
    e.inn && {
      label: 'ИНН', value: e.inn,
      action: (
        <button onClick={() => copyText(e.inn, 'inn')} className="spring-tap" style={{ color: copied === 'inn' ? 'var(--green)' : 'var(--blue)' }}>
          {copied === 'inn' ? <Check size={14} /> : <Copy size={14} />}
        </button>
      ),
    },
    e.snils && {
      label: 'СНИЛС', value: e.snils,
      action: (
        <button onClick={() => copyText(e.snils, 'snils')} className="spring-tap" style={{ color: copied === 'snils' ? 'var(--green)' : 'var(--blue)' }}>
          {copied === 'snils' ? <Check size={14} /> : <Copy size={14} />}
        </button>
      ),
    },
  ].filter(Boolean);

  return (
    <BottomSheet open={!!employee} onClose={onClose} title={name}>
      <div className="flex flex-col gap-3 pb-4">
        {/* Avatar hero */}
        <div className="flex items-center gap-3 pb-1">
          <div className="avatar-hero w-14 h-14 text-xl">
            {name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-[16px] font-bold c-primary">{name}</p>
            <p className="text-[12px] c-secondary">{getRoleName(e.role_tag)}</p>
          </div>
        </div>

        {fields.map((f, i) => (
          <div key={i}>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-0.5 c-tertiary">
              {f.label}
            </p>
            {f.custom ? f.custom : (
              <div className="flex items-center gap-2">
                {f.link ? (
                  <a href={f.link} className="text-[14px] c-blue">{f.value}</a>
                ) : (
                  <p className="text-[14px] flex-1 c-primary">{f.value}</p>
                )}
                {f.action}
              </div>
            )}
          </div>
        ))}

        {/* Action buttons */}
        <div className="flex gap-2 mt-1">
          {e.phone && (
            <a
              href={`tel:${e.phone}`}
              className="btn-action spring-tap c-green"
              style={{ background: 'color-mix(in srgb, var(--green) 15%, transparent)' }}
            >
              <Phone size={16} /> Позвонить
            </a>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
