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
  // Машинный статус: снят ложный «оф» (статус «в офисе» без прохода СКУД).
  // В ручном выборе его нет — как «отп».
  { code: 'нп', label: 'Не подтверждён',     short: 'НП', color: '#EF4444', icon: '❔', machine: true },
];
const STATUS_BY_CODE = Object.fromEntries(STATUS.map((s) => [s.code, s]));

/* Статусы для ответа «где ты был»: всё, кроме «оф» и машинного «нп». */
const DISPUTE_STATUSES = ['уд', 'об', 'км', 'пг', 'уч', 'ск', 'бн', 'сс', 'вх'];

/* Минуты → «7:55». */
function hoursText(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/* Плашка «В офисе 24:30» в личном своде. */
function HoursChip({ label, value, tone }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 9px', borderRadius: 999, fontSize: 11.5,
        background: `color-mix(in srgb, ${tone} 16%, transparent)`,
        color: 'var(--text-secondary)',
        border: `0.5px solid color-mix(in srgb, ${tone} 34%, transparent)`,
      }}
    >
      <span style={{ color: tone, fontWeight: 700 }}>{value}</span>
      <span style={{ opacity: 0.8 }}>{label}</span>
    </span>
  );
}
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
  // Часы: личный свод (неделя + месяц) и вопросы «где ты был» (V453).
  const [myHours, setMyHours]     = useState(null);
  const [disputes, setDisputes]   = useState([]);

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

  // Личный свод часов (норма / офис / СРМ / зачёт) и вопросы «где ты был».
  // Отдельным запросом: основной /api/data/staff_plan не знает про часы.
  const fetchHours = useCallback(async () => {
    const from = ymd(weekStart);
    const to = ymd(addDays(weekStart, 6));
    const [me, week] = await Promise.all([
      api.get(`/office-attendance/me?from=${from}&to=${to}`).catch(() => null),
      api.get('/daily-presence/week').catch(() => null),
    ]);
    setMyHours(me && me.ok ? me : null);
    setDisputes((week && week.disputes) || []);
  }, [weekStart]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchHours(); }, [fetchHours]);

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

  /** Ответ на «где ты был»: статус, отличный от «оф», плюс закрытие флага. */
  const answerDispute = useCallback(async (date, code) => {
    haptic.light();
    try {
      await api.post('/daily-presence/dispute-response', { date, status_code: code });
      haptic.success();
      setDisputes((list) => list.filter((d) => d.date !== date));
      // День поменял статус — обновим сетку и свод.
      fetchData();
      fetchHours();
    } catch (e) {
      haptic.error();
      window.alert(e.message || 'Не удалось ответить');
    }
  }, [haptic, fetchData, fetchHours]);

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
      // 409 office_not_confirmed: «в офисе» без прохода СКУД — объясняем словами,
      // а не показываем «HTTP 409».
      if (e && (e.code === 'office_not_confirmed' || /office_not_confirmed/.test(String(e.message || '')))) {
        window.alert('В этот день СКУД не зафиксировал вход — «В офисе» поставить нельзя. Выберите другой статус.');
      } else {
        window.alert(e.message || 'Не удалось сохранить статус');
      }
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

        {/* ═══ МОИ ЧАСЫ (V453) ═══
            Заказчик просил: сотрудник видит, что не дорабатывает 8-часовой
            день и 40-часовую неделю. Показываем зачёт к норме за неделю и
            месяц, отдельно часы офиса (СКУД) и часы СРМ. */}
        {myHours ? (
          <div
            className="rounded-2xl mb-3"
            style={{
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--gold) 9%, var(--bg-surface)), color-mix(in srgb, var(--blue) 6%, var(--bg-surface)))',
              border: '0.5px solid color-mix(in srgb, var(--gold) 30%, var(--border-norse))',
              padding: '13px 15px',
            }}
          >
            <div className="flex items-center justify-between mb-2.5">
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                Мои часы
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                норма {myHours.settings?.norm_hours_per_week || 40} ч/нед
              </span>
            </div>

            {(() => {
              const wk = myHours.summary || {};
              const norm = wk.norm_minutes || 0;
              const credited = wk.credited_minutes || 0;
              const pct = norm ? Math.min(100, Math.round((credited / norm) * 100)) : 0;
              const delta = wk.delta_minutes || 0;
              const bad = delta < 0;
              const barColor = bad ? 'var(--error)' : 'var(--success)';
              const dH = Math.floor(Math.abs(delta) / 60);
              const dM = Math.abs(delta) % 60;
              return (
                <>
                  <div className="flex items-baseline gap-2 mb-1.5">
                    <span style={{ fontSize: 26, fontWeight: 800, color: bad ? 'var(--error)' : 'var(--success)' }}>
                      {hoursText(credited)}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                      из {hoursText(norm)} ч
                    </span>
                    {norm > 0 && (
                      <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: barColor }}>
                        {bad ? `−${dH}${dM ? ':' + String(dM).padStart(2, '0') : ''} ч` : 'норма выполнена'}
                      </span>
                    )}
                  </div>
                  {norm > 0 && (
                    <div style={{ height: 7, borderRadius: 4, background: 'var(--soft-value)', overflow: 'hidden', marginBottom: 10 }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 4, transition: 'width .3s' }} />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <HoursChip label="В офисе" value={hoursText(wk.office_minutes)} tone="var(--blue)" />
                    <HoursChip label="В СРМ" value={hoursText(wk.crm_minutes)} tone="var(--cyan)" />
                    {myHours.month && (
                      <HoursChip
                        label="Месяц"
                        value={`${hoursText(myHours.month.credited_minutes)} / ${hoursText(myHours.month.norm_minutes)} ч`}
                        tone="var(--gold)"
                      />
                    )}
                  </div>
                  {myHours.summary_text ? (
                    <p style={{ fontSize: 11.5, color: bad ? 'var(--error)' : 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.45 }}>
                      {myHours.summary_text}
                    </p>
                  ) : null}
                </>
              );
            })()}
          </div>
        ) : null}

        {/* ═══ «ГДЕ ТЫ БЫЛ?» — снятые отметки «в офисе» ═══
            Блокирующий по смыслу: пока не ответишь, статус дня не закрыт и
            норма не зачитывается. Здесь же запрещён «в офисе». */}
        {disputes.length ? (
          <div
            className="rounded-2xl mb-3"
            style={{
              background: 'color-mix(in srgb, var(--error) 9%, var(--bg-surface))',
              border: '0.5px solid color-mix(in srgb, var(--error) 45%, transparent)',
              padding: '13px 15px',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--error)', marginBottom: 6 }}>
              СКУД не видел тебя в офисе
            </div>
            {disputes.map((d) => (
              <div key={d.date} style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45, marginBottom: 7 }}>
                  {d.date.split('-').reverse().slice(0, 2).join('.')}: отметка «в офисе» снята — прохода не было.
                  Где ты был?
                  {d.office_attempts > 1 ? ` Это уже ${d.office_attempts}-й раз.` : ''}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {DISPUTE_STATUSES.map((code) => (
                    <button
                      key={code}
                      type="button"
                      className="spring-tap"
                      onClick={() => answerDispute(d.date, code)}
                      style={{
                        padding: '6px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                        background: 'var(--soft-value)', color: 'var(--on-soft-value)',
                        border: '0.5px solid var(--border-norse)',
                      }}
                    >
                      {STATUS_BY_CODE[code]?.label || code}
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 5 }}>
                  «В офисе» выбрать нельзя — пропуска не было.
                </p>
              </div>
            ))}
          </div>
        ) : null}

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
                            // День с проходами? Если СКУД не видел — «оф» блокируем
                            // сразу в шторке, чтобы не ловить 409.
                            const dayRow = (myHours?.days || []).find((d) => d.date === iso);
                            const officeBlocked = !!dayRow && dayRow.warn === 'no_punches';
                            setPicked({ staffId: s.id, name: s.name, iso, code, officeBlocked });
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
            {STATUS.filter((s) => !s.machine).map((s) => {
              const on = picked.code === s.code;
              // «оф» недоступен, если по СКУД в этот день прохода не было:
              // сервер всё равно вернёт 409, лучше не давать кнопку.
              const blocked = s.code === 'оф' && picked.officeBlocked;
              return (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => saveStatus(s.code)}
                  disabled={saving || blocked}
                  className="spring-tap w-full text-left"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    minHeight: 50, padding: '10px 14px', borderRadius: 14,
                    background: on ? `color-mix(in srgb, ${s.color} 22%, var(--bg-surface))` : 'color-mix(in srgb, var(--bg-surface) 92%, transparent)',
                    border: on ? `0.5px solid ${s.color}` : '0.5px solid var(--border-norse)',
                    opacity: (saving || blocked) ? 0.45 : 1,
                  }}
                >
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 14 }}>{s.icon}</span>
                  <span className="flex-1" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {s.label}
                    {blocked ? <span style={{ display: 'block', fontSize: 10.5, fontWeight: 400, color: 'var(--text-tertiary)' }}>СКУД не видел в этот день</span> : null}
                  </span>
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
