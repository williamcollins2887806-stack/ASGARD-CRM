import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useHaptic } from '@/hooks/useHaptic';
import { api } from '@/api/client';
import { PageShell } from '@/components/layout/PageShell';
import { EmptyState } from '@/components/shared/EmptyState';
import { SkeletonList } from '@/components/shared/SkeletonKit';
import { PullToRefresh } from '@/components/shared/PullToRefresh';
import { BottomSheet } from '@/components/shared/BottomSheet';
import { CalendarDays, ChevronLeft, ChevronRight, Check, Users } from 'lucide-react';

/**
 * OfficeSchedule — «График офиса» в мобильном (заказчик 17.10.2026).
 *
 * На десктопе есть «График: Офис» (#/office-schedule): матрица
 * «сотрудник × дни месяца» со статусами (в офисе / удалёнка / на объекте /
 * больничный / командировка…). В мобильном такого не было, хотя данные
 * (staff_plan) те же — и отметка присутствия на мобильном пишет ИМЕННО туда.
 *
 * Формат под телефон: месячная матрица со свайпом неудобна, поэтому:
 *   • сверху — СВОДКА НА СЕГОДНЯ (сколько людей в офисе/удалёнке/на объекте…);
 *   • ниже — НЕДЕЛЯ (Пн–Вс) целиком, БЕЗ горизонтального свайпа:
 *     одна строка = сотрудник, 7 ячеек = дни недели;
 *   • ячейка окрашена по статусу и показывает число; сегодня — золотая рамка;
 *   • тап по своей ячейке (или любой — для менеджера офиса/директора)
 *     открывает шторку выбора статуса;
 *   • стрелками ← → листаются недели.
 *
 * Данные: GET /api/data/staff_plan + /api/data/staff (generic CRUD, read).
 */

const STATUS = [
  { code: 'оф', label: 'В офисе',            short: 'О', color: '#4A90D9', icon: '🏢' },
  { code: 'уд', label: 'Удалёнка',           short: 'У', color: '#0EA5E9', icon: '🏠' },
  { code: 'об', label: 'На объекте',         short: 'О', color: '#22C55E', icon: '🏗' },
  { code: 'бн', label: 'На больничном',      short: 'Б', color: '#EF4444', icon: '🤒' },
  { code: 'сс', label: 'За свой счёт',       short: 'С', color: '#F59E0B', icon: '💤' },
  { code: 'км', label: 'Командировка',       short: 'К', color: '#A855F7', icon: '✈️' },
  { code: 'пг', label: 'Встреча/переговоры', short: 'П', color: '#10B981', icon: '🤝' },
  { code: 'уч', label: 'Учёба',              short: 'У', color: '#14B8A6', icon: '📚' },
  { code: 'ск', label: 'Склад',               short: 'С', color: '#8E8E93', icon: '📦' },
  { code: 'отп', label: 'Отпуск',            short: 'От', color: '#D4A843', icon: '🌴' },
  { code: 'вх', label: 'Выходной',           short: 'В', color: '#475569', icon: '🌙' },
];
const STATUS_BY_CODE = Object.fromEntries(STATUS.map((s) => [s.code, s]));
const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** Ширина колонки имён: на узких телефонах (≤360) ужимаем, чтобы 7 дней
 *  недели влезали без свайпа и оставались тапабельными. */
function nameColWidth() {
  if (typeof window === 'undefined') return 84;
  const w = window.innerWidth || 390;
  if (w <= 340) return 66;
  if (w <= 380) return 76;
  return 92;
}
/** Понедельник недели, содержащей дату. */
function startOfWeek(date) {
  const d = new Date(date);
  const dow = d.getDay();                 // 0=Вс … 6=Сб
  const shift = dow === 0 ? -6 : 1 - dow; // сдвиг к понедельнику
  d.setDate(d.getDate() + shift);
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Показывать ли сотрудника в графике (те же правила, что на десктопе). */
function isSkipped(user) {
  if (!user) return false;
  if (['BOT', 'ADMIN', 'FIELD_WORKER'].includes(user.role)) return true;
  const login = String(user.login || '');
  if (login.startsWith('test_') || login === 'mimir_bot') return true;
  const name = String(user.name || '').trim();
  if (name.startsWith('Test ') || name.startsWith('Тест ')) return true;
  return false;
}

export default function OfficeSchedule() {
  const user     = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const haptic   = useHaptic();

  const todayIso = ymd(new Date());
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [staff, setStaff]         = useState([]);
  const [planMap, setPlanMap]     = useState({});   // `${staff_id}|${iso}` → code
  const [loading, setLoading]     = useState(true);
  const [picked, setPicked]       = useState(null); // { staffId, name, iso, code }
  const [saving, setSaving]       = useState(false);

  const role = user?.role || '';
  const isOfficeManager = role === 'OFFICE_MANAGER';
  const isAdminish = role === 'ADMIN' || role.startsWith('DIRECTOR');

  // Ширина колонки имён зависит от ширины экрана (пересчитываем при повороте).
  const [nameCol, setNameCol] = useState(nameColWidth);
  useEffect(() => {
    const onResize = () => setNameCol(nameColWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const NAME_COL = `${nameCol}px`;

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // ⚠️ Именно /api/data/staff — это ОФИСНЫЙ штат (таблица staff: кто сидит
      // в офисе, у кого отметки в staff_plan). /api/staff отдаёт ДРУГОЕ —
      // список работников (employees), у него нет нужных отметок.
      const [staffRes, usersRes] = await Promise.all([
        api.get('/data/staff?limit=1000').catch(() => null),
        api.get('/data/users?limit=1000').catch(() => null),
      ]);
      let rows = api.extractRows(staffRes) || [];
      const users = api.extractRows(usersRes) || [];
      const skipped = new Set(users.filter(isSkipped).map((u) => u.id));
      rows = rows.filter((s) => {
        if (s.user_id && skipped.has(s.user_id)) return false;
        if (s.is_active === false) return false;
        const nm = String(s.name || '').trim();
        if (nm.startsWith('Test ') || nm.startsWith('Тест ')) return false;
        return true;
      });
      rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
      setStaff(rows);

      // План за видимую неделю (фильтруем на клиенте — generic CRUD без гарантий фильтров).
      const from = ymd(weekStart);
      const to = ymd(addDays(weekStart, 6));
      const planRes = await api.get('/data/staff_plan?limit=3000').catch(() => null);
      const planRows = api.extractRows(planRes) || [];
      const map = {};
      for (const p of planRows) {
        if (!p || !p.date) continue;
        const iso = ymd(p.date);
        if (iso < from || iso > to) continue;
        if (p.status_code) map[`${p.staff_id}|${iso}`] = p.status_code;
      }
      setPlanMap(map);
    } catch {
      setStaff([]);
      setPlanMap({});
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const shiftWeek = (dir) => {
    haptic.light();
    setWeekStart((w) => addDays(w, dir * 7));
  };
  const goToday = () => { haptic.light(); setWeekStart(startOfWeek(new Date())); };

  const isCurrentWeek = ymd(weekStart) === ymd(startOfWeek(new Date()));

  // Право на правку: своя строка — всегда; менеджер офиса/директор/админ — любую.
  const canEditRow = useCallback((s) => {
    if (isOfficeManager || isAdminish) return true;
    return s.user_id === user?.id;
  }, [isOfficeManager, isAdminish, user?.id]);

  /** Статус ячейки: из плана, иначе выходной по умолчанию. */
  const cellCode = (staffId, dt) => {
    const iso = ymd(dt);
    let code = planMap[`${staffId}|${iso}`] || '';
    const dow = dt.getDay();
    if (!code && (dow === 0 || dow === 6)) code = 'вх';
    return code;
  };

  // ── Сводка на СЕГОДНЯ (сколько людей в каждом статусе) ──
  const todaySummary = useMemo(() => {
    const counts = {};
    let unmarked = 0;
    for (const s of staff) {
      const code = cellCode(s.id, new Date());
      if (code) counts[code] = (counts[code] || 0) + 1;
      else unmarked++;
    }
    return { counts, unmarked };
  }, [staff, planMap]);

  const saveStatus = useCallback(async (code) => {
    if (!picked) return;
    setSaving(true);
    try {
      const all = api.extractRows(await api.get(`/data/staff_plan?limit=3000&staff_id=${picked.staffId}`).catch(() => null)) || [];
      const existing = all.find((p) => p.staff_id === picked.staffId && ymd(p.date) === picked.iso);
      if (existing) {
        if (code) await api.put(`/data/staff_plan/${existing.id}`, { status_code: code, updated_at: new Date().toISOString() });
        else await api.delete(`/data/staff_plan/${existing.id}`);
      } else if (code) {
        await api.post('/data/staff_plan', { staff_id: picked.staffId, date: picked.iso, status_code: code });
      }
      setPlanMap((m) => {
        const next = { ...m };
        const k = `${picked.staffId}|${picked.iso}`;
        if (code) next[k] = code; else delete next[k];
        return next;
      });
      haptic.success();
      setPicked(null);
    } catch (e) {
      haptic.error();
      window.alert(e.message || 'Не удалось сохранить статус');
    } finally {
      setSaving(false);
    }
  }, [picked, haptic]);

  const weekLabel = useMemo(() => {
    const a = weekStart;
    const b = addDays(weekStart, 6);
    if (a.getMonth() === b.getMonth()) {
      return `${a.getDate()}–${b.getDate()} ${MONTHS_RU[a.getMonth()]}`;
    }
    return `${a.getDate()} ${MONTHS_RU[a.getMonth()]} – ${b.getDate()} ${MONTHS_RU[b.getMonth()]}`;
  }, [weekStart]);

  const todayDate = new Date();

  return (
    <PageShell
      title="График офиса"
      showBack
      onBack={() => navigate('/more')}
      headerRight={
        !isCurrentWeek ? (
          <button
            type="button"
            onClick={goToday}
            className="spring-tap"
            style={{
              marginRight: 12, padding: '7px 12px', borderRadius: 999,
              fontSize: 12, fontWeight: 700,
              background: 'var(--soft-value)',
              border: '0.5px solid color-mix(in srgb, var(--gold) 40%, var(--border-norse))',
              color: 'var(--on-soft-value)',
            }}
          >
            Сегодня
          </button>
        ) : null
      }
    >
      <PullToRefresh onRefresh={fetchData}>

        {/* ═══ СВОДКА НА СЕГОДНЯ ═══ */}
        <div
          className="rounded-2xl mb-3"
          style={{
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--blue) 12%, var(--bg-surface)), color-mix(in srgb, var(--gold) 5%, var(--bg-surface)))',
            border: '0.5px solid color-mix(in srgb, var(--blue) 26%, var(--border-norse))',
            padding: '14px 16px',
            animation: 'fadeInUp var(--motion-normal) var(--ease-spring) forwards',
          }}
        >
          <div className="flex items-center gap-2 mb-2.5">
            <Users size={15} style={{ color: 'var(--blue)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
              Сегодня · {todayDate.getDate()} {MONTHS_RU[todayDate.getMonth()]}
            </span>
          </div>
          {staff.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Нет данных</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {STATUS.filter((s) => todaySummary.counts[s.code] > 0).map((s) => (
                <span
                  key={s.code}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', borderRadius: 999,
                    background: `color-mix(in srgb, ${s.color} 20%, transparent)`,
                    border: `0.5px solid color-mix(in srgb, ${s.color} 45%, transparent)`,
                    fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                  {todaySummary.counts[s.code]}
                  <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{s.label}</span>
                </span>
              ))}
              {todaySummary.unmarked > 0 && (
                <span
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', borderRadius: 999,
                    background: 'color-mix(in srgb, var(--text-tertiary) 12%, transparent)',
                    border: '0.5px solid var(--border-norse)',
                    fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)',
                  }}
                >
                  {todaySummary.unmarked}
                  <span style={{ fontWeight: 500 }}>без отметки</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* ═══ НЕДЕЛЯ ЦЕЛИКОМ (Пн–Вс, без свайпа) ═══ */}
        <div
          className="rounded-2xl mb-3"
          style={{
            background: 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
            border: '0.5px solid var(--border-norse)',
            animation: 'fadeInUp var(--motion-normal) var(--ease-spring) 60ms both',
          }}
        >
          {/* Навигация по неделям */}
          <div className="flex items-center justify-between" style={{ padding: '10px 8px 6px' }}>
            <button onClick={() => shiftWeek(-1)} className="spring-tap" style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', color: 'var(--text-tertiary)' }} aria-label="Предыдущая неделя">
              <ChevronLeft size={20} />
            </button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{weekLabel}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 1 }}>
                {isCurrentWeek ? 'текущая неделя' : WEEKDAYS[0] + '–' + WEEKDAYS[6]}
              </div>
            </div>
            <button onClick={() => shiftWeek(1)} className="spring-tap" style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', color: 'var(--text-tertiary)' }} aria-label="Следующая неделя">
              <ChevronRight size={20} />
            </button>
          </div>

          {/* Шапка дней недели — 7 колонок фиксированной сеткой */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `${NAME_COL} repeat(7, minmax(0, 1fr))`,
              gap: 4,
              padding: '0 10px 4px',
              alignItems: 'end',
            }}
          >
            <div />
            {weekDays.map((dt, i) => {
              const isToday = ymd(dt) === todayIso;
              const weekend = i >= 5;
              return (
                <div key={i} style={{ textAlign: 'center' }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: 0.2,
                    color: isToday ? 'var(--gold)' : (weekend ? 'var(--text-tertiary)' : 'var(--text-secondary)'),
                  }}>
                    {WEEKDAYS[i]}
                  </div>
                  <div style={{
                    fontSize: 13, fontWeight: isToday ? 800 : 600,
                    color: isToday ? 'var(--gold)' : 'var(--text-primary)',
                    lineHeight: 1.15,
                  }}>
                    {dt.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Строки сотрудников */}
          {loading ? (
            <div style={{ padding: '8px 10px 12px' }}><SkeletonList count={5} /></div>
          ) : staff.length === 0 ? (
            <div style={{ padding: 12 }}>
              <EmptyState
                icon={CalendarDays}
                iconColor="var(--blue)"
                iconBg="rgba(74,144,217,0.1)"
                title="Нет сотрудников"
                description="Сотрудники появятся здесь"
              />
            </div>
          ) : (
            <div style={{ padding: '2px 10px 12px' }}>
              {staff.map((s, idx) => {
                const editable = canEditRow(s);
                const isMe = s.user_id === user?.id;
                return (
                  <div
                    key={s.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `${NAME_COL} repeat(7, minmax(0, 1fr))`,
                      gap: 4,
                      alignItems: 'center',
                      padding: '3px 0',
                      borderTop: idx > 0 ? '0.5px solid color-mix(in srgb, var(--border-norse) 60%, transparent)' : 'none',
                      animation: `fadeInUp var(--motion-normal) var(--ease-spring) ${idx * 18}ms both`,
                    }}
                  >
                    {/* Имя сотрудника */}
                    <div style={{ minWidth: 0, paddingRight: 4 }}>
                      <div
                        style={{
                          fontSize: 12, fontWeight: isMe ? 700 : 600,
                          color: isMe ? 'var(--gold)' : 'var(--text-primary)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                        title={s.name}
                      >
                        {String(s.name || '—').split(' ').slice(0, 2).join(' ')}
                      </div>
                      {isMe && <div style={{ fontSize: 9, color: 'var(--gold)' }}>вы</div>}
                    </div>

                    {/* 7 дней */}
                    {weekDays.map((dt, i) => {
                      const iso = ymd(dt);
                      const code = cellCode(s.id, dt);
                      const st = STATUS_BY_CODE[code];
                      const isToday = iso === todayIso;
                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => {
                            if (!editable) { haptic.light(); return; }
                            haptic.light();
                            setPicked({ staffId: s.id, name: s.name, iso, code });
                          }}
                          aria-label={`${s.name}, ${iso}: ${st ? st.label : 'нет статуса'}`}
                          style={{
                            height: 40, borderRadius: 10,
                            background: st
                              ? `color-mix(in srgb, ${st.color} 42%, transparent)`
                              : 'color-mix(in srgb, var(--text-tertiary) 7%, transparent)',
                            border: isToday
                              ? '1.5px solid var(--gold)'
                              : '0.5px solid color-mix(in srgb, var(--border-norse) 80%, transparent)',
                            display: 'grid', placeItems: 'center',
                            fontSize: 12, fontWeight: 800,
                            color: st ? 'var(--text-primary)' : 'var(--text-tertiary)',
                            opacity: editable ? 1 : 0.72,
                            padding: 0,
                            minWidth: 0,
                          }}
                        >
                          {st ? st.short : ''}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {/* Легенда под сеткой */}
          <div
            style={{
              borderTop: '0.5px solid var(--border-norse)',
              padding: '10px 12px 12px',
              display: 'flex', flexWrap: 'wrap', gap: 10,
            }}
          >
            {STATUS.map((s) => (
              <span key={s.code} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 12, height: 12, borderRadius: 4, background: s.color, display: 'grid', placeItems: 'center', fontSize: 8, fontWeight: 800, color: '#0b0b0b' }}>{s.short}</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>{s.label}</span>
              </span>
            ))}
          </div>
        </div>

      </PullToRefresh>

      {/* ═══ ШТОРКА ВЫБОРА СТАТУСА ═══ */}
      <BottomSheet
        open={!!picked}
        onClose={() => setPicked(null)}
        title={picked ? `Статус на ${picked.iso.split('-').reverse().join('.')}` : 'Статус'}
      >
        {picked && (
          <div className="flex flex-col gap-2 pb-4">
            <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 2 }}>
              Сотрудник: <b style={{ color: 'var(--text-primary)' }}>{picked.name}</b>
            </p>
            {STATUS.map((s) => {
              const on = picked.code === s.code;
              return (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => saveStatus(s.code)}
                  disabled={saving}
                  className="spring-tap w-full text-left"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    minHeight: 50, padding: '10px 14px', borderRadius: 14,
                    background: on ? `color-mix(in srgb, ${s.color} 22%, var(--bg-surface))` : 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                    border: on ? `0.5px solid ${s.color}` : '0.5px solid var(--border-norse)',
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 14 }}>{s.icon}</span>
                  <span className="flex-1" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>{s.label}</span>
                  {on && <Check size={16} style={{ color: s.color }} />}
                </button>
              );
            })}
            {picked.code && (
              <button
                type="button"
                onClick={() => saveStatus('')}
                disabled={saving}
                className="spring-tap w-full"
                style={{
                  minHeight: 46, borderRadius: 14, fontWeight: 600, fontSize: 13.5,
                  background: 'transparent',
                  border: '0.5px solid color-mix(in srgb, var(--red-soft) 40%, var(--border-norse))',
                  color: 'var(--text-secondary)', marginTop: 4,
                  opacity: saving ? 0.6 : 1,
                }}
              >
                Очистить день
              </button>
            )}
          </div>
        )}
      </BottomSheet>
    </PageShell>
  );
}
