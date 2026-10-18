import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Wallet, History, Users, Truck, UserCircle,
  MapPin, AlertCircle, RefreshCw, Play, Square,
  Phone, Briefcase, Camera, FileText, AlertTriangle, Package, DollarSign, Map,
  Calendar, Shield, PackageCheck, ClipboardList, ScrollText, Sun, Moon,
  Gamepad2, ShoppingBag, Gift, Landmark, Swords, Leaf, Trophy, Dices, Waves, FlaskConical, Plus,
  Stethoscope, Plane, Hourglass, BedDouble, Building2, Ship, HardHat, Archive, HelpCircle,
  Bell, Smartphone, Wrench, Ban, Ruler, BookOpen, Trophy as TrophyIcon, Home as HomeIcon,
} from 'lucide-react';
import { fieldApi } from '@/api/fieldClient';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import { useHaptic } from '@/hooks/useHaptic';
import RankUpCeremony, { checkRankCeremony } from '@/components/field/RankUpCeremony';
import { getLevel, getRank, rankIndex } from '@/lib/fieldRanks';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import { NornsPauseStrip, PAUSE_BADGE } from '@/components/field/NornsPauseBanner';
import { IconTile } from '@/components/field/ui';
import { useThemeStore } from '@/stores/themeStore';
import './field-home.css';
import { buildProfileHref, gapsContainPpe, FOCUS_PPE } from '@/lib/ppeField';

const PUSH_DISMISSED_KEY = 'asgard_field_push_dismissed_v1';
const IOS_HINT_DISMISSED_KEY = 'asgard_ios_hint_dismissed_v1';
const CHEMLAB_BANNER_KEY = 'asgard_chemlab_banner_v1';
const CHEMLAB_FIXED_KEY = 'asgard_chemlab_fixed_v1';

/* Плитки игр: цвет — по смыслу (danger/acc/value), фон — токены темы.
   Раньше здесь были тёмные градиенты-литералы, из-за которых в светлой теме
   плитки оставались чёрными. */
const GAMES_FOLDER = [
  { icon: Dices, label: 'Рулетка', path: '/field/wheel', tone: 'danger', badge: PAUSE_BADGE },
  { icon: Waves, label: 'Рунопровод', path: '/field/pipeline', tone: 'accent' },
  { icon: FlaskConical, label: 'Химцех', path: '/field/chemlab', tone: 'danger', badge: 'NEW' },
  { icon: Plus, label: 'Скоро', path: null, tone: 'neutral', soon: true },
];

// Detect iOS Safari (not standalone)
function detectIOSSafari() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS|OPiOS|mercury/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua);
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  return isIOS && isSafari && !isStandalone;
}

const VIKING_QUOTES = [
  'Не бойся медленного продвижения — бойся остановки',
  'Лучше быть волком один день, чем овцой всю жизнь',
  'В бурю кормчий познаётся',
  'Каждый день — поход за славой',
  'Кто рано встаёт, тому Один даёт',
  'Сильный духом побеждает сильного телом',
  'Дела говорят громче рун',
  'Мудрый путник далеко не заходит в одиночку',
  'Своё железо куй, пока горячо',
  'Даже Тор пахал прежде, чем метал молнии',
  'Слава приходит к тому, кто работает молча',
  'Валгалла ждёт тех, кто не сдаётся',
  'Рука помощи ближе, чем ты думаешь',
  'Один весло не сдвинет корабль',
  'Битва выиграна до рассвета — подготовкой',
  'Нет плохой погоды — есть слабые воины',
  'Щит ломается — дух крепчает',
  'Асгард строится каждый день',
  'Один мудрый сказал: «Рано встал — уже победил»',
  'Новый день — новый поход за славой!',
  'Руки крепкие, дух несгибаемый — вперёд!',
  'Настоящий воин не ждёт команды — он готов',
  'Сегодня мы делаем то, что другие не могут',
  'Рассвет принадлежит тем, кто не боится работы',
  'Один за всех, все за Асгард!',
  'Воин не жалуется — воин действует',
];

function randomQuote() { return VIKING_QUOTES[Math.floor(Math.random() * VIKING_QUOTES.length)]; }

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

function fmtDate() {
  return new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
}

function fmtTimer(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtPlanPeriod(from, to) {
  const fmt = (d) => (d ? new Date(d).toLocaleDateString('ru-RU') : null);
  const f = fmt(from);
  const t = fmt(to);
  if (f && t) return `с ${f} по ${t}`;
  if (f) return `с ${f}`;
  if (t) return `по ${t}`;
  return 'дата уточняется';
}

function shortFio(fio) {
  if (!fio) return '';
  const p = fio.trim().split(/\s+/).filter(Boolean);
  if (p.length >= 3) return `${p[0]} ${p[1]} ${p[2][0]}.`;
  if (p.length === 2) return `${p[0]} ${p[1]}`;
  return p[0];
}
function getGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve({}),
      { timeout: 8000, enableHighAccuracy: true }
    );
  });
}

// 23.06.2026 BUG-FIX (🟡 S-FIELD-05): добавлен ключ `object` (Объект) — канон stage_type бэкенда
// (src/routes/field-stages.js:33 STAGE_TYPES = ['medical','travel','waiting','warehouse','day_off','object']).
// Без этого ключа баннер "current stage" рисовал бы сырой 'object' при stage_type='object'.
const STAGE_LABELS = {
  medical: 'Медосмотр', travel: 'Дорога', waiting: 'Ожидание', warehouse: 'Склад',
  day_off: 'Выходной', object: 'Объект', ship: 'Корабль', helicopter: 'Вертолёт', training: 'Обучение',
};

const STAGE_COLORS = {
  medical: 'var(--acc)', travel: 'var(--acc)', waiting: 'var(--value)', warehouse: 'var(--value)',
  day_off: 'var(--text-secondary)', object: 'var(--ok)', ship: 'var(--acc)', helicopter: 'var(--acc)', training: 'var(--acc)',
};
const STAGE_ICONS = {
  medical: Stethoscope, travel: Plane, waiting: Hourglass, warehouse: Package,
  day_off: BedDouble, object: Building2, ship: Ship, helicopter: Truck, training: BookOpen,
};

/** Read-only блок вахты МЛСП (токены темы поля). */
function MlspStayBanner({ stay }) {
  if (!stay?.is_open) return null;
  const hot = stay.is_overdue || (stay.days_left != null && stay.days_left <= 7);
  const warn = !hot && stay.days_left != null && stay.days_left <= 14;
  const tone = hot ? 'var(--danger, var(--danger))' : warn ? 'var(--warning, var(--value))' : 'var(--success, var(--ok))';
  const bg = hot ? 'color-mix(in oklab, var(--danger) 12%, transparent)' : warn ? 'color-mix(in oklab, var(--danger) 12%, transparent)' : 'color-mix(in oklab, var(--ok) 10%, transparent)';
  const bd = hot ? 'color-mix(in oklab, var(--danger) 35%, transparent)' : warn ? 'color-mix(in oklab, var(--danger) 35%, transparent)' : 'color-mix(in oklab, var(--ok) 30%, transparent)';
  return (
    <div className="mt-3 rounded-lg px-3 py-2" style={{ backgroundColor: bg, border: `1px solid ${bd}` }}>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: tone }}>
        МЛСП · {stay.days_on_platform ?? '—'} дн. на платформе
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
        Заезд: {stay.arrived_at ? new Date(stay.arrived_at).toLocaleDateString('ru-RU') : '—'}
        {' · '}Вывоз: {stay.planned_depart_at ? new Date(stay.planned_depart_at).toLocaleDateString('ru-RU') : '—'}
        {stay.days_left != null && !stay.is_overdue ? ` · осталось ${stay.days_left} дн` : ''}
        {stay.is_overdue ? ` · просрочен ${Math.abs(stay.days_left)} дн` : ''}
      </p>
      {stay.transport && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          Вывоз: {stay.transport === 'ship' ? 'корабль' : 'вертолёт'}
        </p>
      )}
    </div>
  );
}

const GAMIFICATION_TILES = [
  { icon: Gamepad2, label: 'Игры', path: '__games_folder__', tone: 'danger', badge: 'NEW', folder: true },
  { icon: ShoppingBag, label: 'Магазин', path: '/field/shop', tone: 'value' },
  { icon: Gift, label: 'Инвентарь', path: '/field/inventory', tone: 'accent' },
  { icon: Landmark, label: 'Чертоги Мимира', path: '/field/academy', tone: 'accent' },
  { icon: Swords, label: 'Квесты', path: '/field/quests', tone: 'accent' },
  { icon: Leaf, label: 'Сезон', path: '/field/seasonal', tone: 'danger', badge: 'NEW' },
  { icon: Trophy, label: 'Рейтинг', path: '/field/leaderboard', tone: 'value' },
  { icon: Map, label: 'Подвиги', path: '/field/journey', tone: 'status' },
];

export default function FieldHome() {
  const navigate = useNavigate();
  const haptic = useHaptic();
  const employee = useFieldAuthStore((s) => s.employee);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  const [data, setData] = useState(null);
  const [currentStage, setCurrentStage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [quote] = useState(randomQuote);
  const [myRank, setMyRank] = useState(null);
  const [mimirTip, setMimirTip] = useState(null);
  const [academyAlert, setAcademyAlert] = useState(null); // {type:'blocked'|'reminder', title, lesson_id, daysLeft}
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [showReadinessPrompt, setShowReadinessPrompt] = useState(false);
  const [showChemLabBanner, setShowChemLabBanner] = useState(false);
  const [showChemLabFixed, setShowChemLabFixed] = useState(false);
  const [showGamesFolder, setShowGamesFolder] = useState(false);
  const [showProfileConfirm, setShowProfileConfirm] = useState(false);
  const [profileCompleteness, setProfileCompleteness] = useState(null);
  const [profileConfirming, setProfileConfirming] = useState(false);
  const [readinessStatus, setReadinessStatus] = useState(null); // ready|not_ready|on_site|unknown|archive
  const [rankCeremony, setRankCeremony] = useState(null);
  const [meAssets, setMeAssets] = useState({});
  const [meCosmetics, setMeCosmetics] = useState({});
  const push = usePushSubscription();
  const timerRef = useRef(null);
  const [pulling, setPulling] = useState(false);
  const ceremonyShownRef = useRef(false);

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Рейтинг / Мимир: повторы при сбое, при ошибке не затираем уже загруженный рейтинг. */
  const fetchGamification = useCallback(async () => {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fieldApi.get('/gamification/leaderboard');
        if (res?.my_rank) setMyRank(res.my_rank);
        break;
      } catch {
        if (attempt < maxAttempts) await delay(400 * attempt);
      }
    }
    try {
      const res = await fieldApi.get('/gamification/mimir-tip');
      if (res?.tip) setMimirTip(res.tip);
    } catch { /* подсказка не критична */ }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await fieldApi.get('/worker/active-project');
      setData(res);
      // Load current trip stage
      const workId = res?.project?.work_id;
      if (workId) {
        fieldApi.get(`/stages/my/current/${workId}`).then(setCurrentStage).catch(() => {});
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Rank-up ceremony (shared session guard with FieldProfile)
  useEffect(() => {
    if (ceremonyShownRef.current) return;
    try {
      if (sessionStorage.getItem('field_rank_ceremony_session')) return;
    } catch { /* */ }
    let cancelled = false;
    fieldApi.get('/worker/me').then((me) => {
      if (cancelled || !me) return;
      setMeAssets(me.assets || {});
      setMeCosmetics({
        active_avatar: me.active_avatar,
        active_frame: me.active_frame,
        active_badge: me.active_badge,
        active_theme: me.active_theme,
        active_helmet: me.active_helmet,
        active_weapon: me.active_weapon,
        active_armor: me.active_armor,
      });
      const lvl = getLevel(me.xp || 0);
      const rank = getRank(lvl);
      const chk = checkRankCeremony(me.id || employee?.id, rank.title);
      if (!chk.show) return;
      if (chk.prevTitle && rankIndex(rank.title) <= rankIndex(chk.prevTitle)) return;
      ceremonyShownRef.current = true;
      try { sessionStorage.setItem('field_rank_ceremony_session', '1'); } catch { /* */ }
      setRankCeremony({
        rank,
        prevTitle: chk.prevTitle,
        level: lvl,
        welcome: !!chk.welcome,
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [employee?.id]);

  // Загрузить статус готовности всегда (для постоянного баннера) + показать промпт когда нужно
  useEffect(() => {
    if (loading || !data) return;
    const hasProject = data.project && data.project.is_active !== false && !data.project.departure_date;
    fieldApi.get('/readiness').then(res => {
      const st = res?.readiness?.readiness_status || 'unknown';
      setReadinessStatus(st);
      // Промпт «готов на объект?» — только если НЕ на активном проекте и статус не определён/снят
      if (!hasProject && (st === 'unknown' || st === 'on_site')) {
        setShowReadinessPrompt(true);
      }
    }).catch(() => {});
  }, [loading, data]);

  // Ежемесячное подтверждение анкеты (отдельно от readiness)
  useEffect(() => {
    if (loading || !data) return;
    fieldApi.get('/worker/personal/completeness').then((res) => {
      setProfileCompleteness(res);
      if (res?.needsConfirm) setShowProfileConfirm(true);
    }).catch(() => {});
  }, [loading, data]);

  // Show push prompt after data loaded (not dismissed, not subscribed, supported)
  useEffect(() => {
    if (!push.supported || push.subscribed || push.permission === 'denied') return;
    if (localStorage.getItem(PUSH_DISMISSED_KEY)) return;
    const t = setTimeout(() => setShowPushPrompt(true), 3000);
    return () => clearTimeout(t);
  }, [push.supported, push.subscribed, push.permission]);

  // Show iOS "Add to Home Screen" hint for iOS Safari users
  useEffect(() => {
    if (!detectIOSSafari()) return;
    if (localStorage.getItem(IOS_HINT_DISMISSED_KEY)) return;
    const t = setTimeout(() => setShowIOSHint(true), 2000);
    return () => clearTimeout(t);
  }, []);

  // Новая игра «Химцех» — баннер при входе (приоритет над старым pipeline)
  useEffect(() => {
    if (localStorage.getItem(CHEMLAB_BANNER_KEY)) return;
    const t = setTimeout(() => setShowChemLabBanner(true), 800);
    return () => clearTimeout(t);
  }, []);

  // «Химцех починен» — показываем один раз (свернул → больше не появится)
  useEffect(() => {
    if (localStorage.getItem(CHEMLAB_FIXED_KEY)) return;
    const t = setTimeout(() => setShowChemLabFixed(true), 1400);
    return () => clearTimeout(t);
  }, []);

  // Academy: check if worker needs to pass a test (non-blocking fetch)
  useEffect(() => {
    Promise.all([
      fieldApi.get('/academy/shift-allowed'),
      fieldApi.get('/academy/current-lesson'),
    ]).then(([allowed, cur]) => {
      if (!allowed.allowed) {
        setAcademyAlert({
          type: 'blocked',
          title: allowed.lesson_title,
          lesson_id: allowed.lesson_id,
          blocking_reason: allowed.blocking_reason,
        });
      } else if (cur.blocking) {
        setAcademyAlert({
          type: 'blocked',
          title: cur.blocking.title,
          lesson_id: cur.blocking.id,
          blocking_reason: cur.blocking_reason,
        });
      } else if (cur.current_week && !cur.current_week.passed) {
        const daysLeft = cur.current_week.deadline
          ? Math.ceil((new Date(cur.current_week.deadline) - Date.now()) / 86400000)
          : null;
        setAcademyAlert({
          type: 'reminder',
          title: cur.current_week.title,
          lesson_id: cur.current_week.id,
          daysLeft,
        });
      } else {
        setAcademyAlert(null);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchGamification();
  }, [fetchGamification]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') fetchGamification();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [fetchGamification]);

  // Live timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const checkin = data?.today_checkin || data?.project?.today_checkin;
    if (!checkin || checkin.checkout_at) return;
    const start = new Date(checkin.checkin_at).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => clearInterval(timerRef.current);
  }, [data]);

  const handleCheckin = async () => {
    haptic.medium();
    setActionLoading(true);
    try {
      const geo = await getGeo();
      const wid = data?.project?.work_id || data?.assignment?.work_id;
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const client_date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
      const client_time = now.toISOString();
      const client_local_hour = now.getHours();
      await fieldApi.post('/checkin/', { work_id: wid, ...geo, client_date, client_time, client_local_hour });
      haptic.success();
      await fetchData();
      fetchGamification().catch(() => {});
    } catch (e) {
      // Academy block — special UI
      if (e.message?.includes('Чертогах Мимира') || e.message?.includes('ACADEMY_BLOCKED') || e.message?.includes('Испытание')) {
        haptic.error();
                setError((e.message || 'Пройди Испытание недели в Чертогах Мимира'));
        setActionLoading(false);
        return;
      }
      haptic.error();
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckout = async () => {
    haptic.medium();
    setActionLoading(true);
    try {
      const geo = await getGeo();
      const client_time = new Date().toISOString();
      await fieldApi.post('/checkin/checkout', { ...geo, checkin_id: checkin?.id, client_time });
      haptic.success();
      await fetchData();
      fetchGamification().catch(() => {});
    } catch (e) {
      haptic.error();
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Pull to refresh — D-267: раньше условие было `window.scrollY === 0`, но скролл
  // на этом экране идёт внутри контейнера FieldLayout (`flex-1 overflow-auto`),
  // поэтому window.scrollY ВСЕГДА 0 → любой жест вниз >80px (в том числе при работе
  // с полями и селектами) запускал двойной перезапрос с ретраями и «выкидывал» экран.
  // Теперь: только когда прокрутка реально вверху, и только если жест начался НЕ на
  // элементе управления (input/select/textarea/button).
  const pullStartRef = useRef({ y: 0, armed: false });

  const findScrollParent = (node) => {
    let el = node?.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) return el;
      el = el.parentElement;
    }
    return null;
  };

  const onTouchStart = (e) => {
    const target = e.target;
    const onControl = target?.closest?.('input,select,textarea,button,a,[role="button"]');
    pullStartRef.current = {
      y: e.touches[0].clientY,
      armed: !onControl,
    };
  };
  const onTouchEnd = async (e) => {
    const { y: startY, armed } = pullStartRef.current;
    pullStartRef.current = { y: 0, armed: false };
    if (!armed || pulling) return;
    const diff = e.changedTouches[0].clientY - startY;
    if (diff <= 80) return;
    const scroller = findScrollParent(e.target);
    const atTop = scroller ? scroller.scrollTop <= 0 : (window.scrollY || 0) <= 0;
    if (!atTop) return;
    setPulling(true);
    await Promise.all([fetchData(), fetchGamification()]);
    setPulling(false);
  };

  // fio = "Фамилия Имя Отчество" → берём второе слово (Имя)
  // Если оно выглядит как инициал ("А.", "А.В.") или пустое — берём первое слово (Фамилия)
  const fio = employee?.fio || '';
  const fioParts = fio.trim().split(/\s+/);
  const rawSecond = fioParts[1] || '';
  const isInitial = rawSecond.length <= 3 || /^[А-ЯA-Z][.\-]/.test(rawSecond);
  const firstName = (!isInitial && rawSecond) ? rawSecond : (fioParts[0] || 'Воин');
  const project = data?.project;
  const plannedEngagement = data?.planned_engagement;
  const mlspStay = data?.mlsp_stay || project?.mlsp_stay || null;
  const checkin = data?.today_checkin || project?.today_checkin;
  const isActive = checkin && !checkin.checkout_at;
  const hasDeparted = !!project?.departure_date;
  const isActiveAssignment = project?.is_active !== false && !hasDeparted;
  const isMaster = employee?.field_role === 'shift_master' || employee?.field_role === 'senior_master' || project?.field_role?.includes('master');

  // Shift end time restriction (local device time)
  const shiftType = project?.shift_type || 'day';
  const shiftHours = parseFloat(project?.shift_hours || 11);
  function getShiftEndInfo() {
    const checkin = data?.today_checkin || data?.project?.today_checkin;
    if (!checkin || checkin.checkout_at) return { allowed: true, endLabel: '', remainingLabel: '' };
    const checkinAt = new Date(checkin.checkin_at).getTime();
    const now = Date.now();
    const hoursWorked = (now - checkinAt) / 3600000;
    // Rule 1: Must have worked 8+ hours
    const MIN_HOURS = 8;
    if (hoursWorked < MIN_HOURS) {
      const remainingMin = Math.ceil((MIN_HOURS - hoursWorked) * 60);
      const h = Math.floor(remainingMin / 60);
      const m = remainingMin % 60;
      return {
        allowed: false,
        endLabel: `${MIN_HOURS}ч минимум`,
        remainingLabel: h > 0 ? `${h}ч ${m}м` : `${m}м`,
      };
    }
    // Rule 2: Must be within 2 hours of shift end (day=20:00 MSK, night=08:00 MSK)
    // Use MSK offset: UTC+3
    const mskMs = now + 3 * 3600000;
    const mskDate = new Date(mskMs);
    const mskHour = mskDate.getUTCHours();
    const mskMin = mskDate.getUTCMinutes();
    const mskTotalMin = mskHour * 60 + mskMin;
    const endMin = shiftType === 'night' ? 8 * 60 : 20 * 60;
    let minutesToEnd;
    if (shiftType === 'night') {
      minutesToEnd = mskTotalMin >= 20 * 60 ? (24 * 60 - mskTotalMin + endMin) : (endMin - mskTotalMin);
    } else {
      minutesToEnd = endMin - mskTotalMin;
    }
    // Allow if within 2 hours of shift end OR worked 10.5+ hours (fallback)
    const allowed = minutesToEnd <= 120 || hoursWorked >= 10.5;
    if (!allowed) {
      const h = Math.floor(minutesToEnd / 60);
      const m = minutesToEnd % 60;
      return {
        allowed: false,
        endLabel: shiftType === 'night' ? '08:00' : '20:00',
        remainingLabel: `${h}ч ${m}м до конца`,
      };
    }
    return { allowed: true, endLabel: '', remainingLabel: '' };
  }
  const shiftEndInfo = isActive ? getShiftEndInfo() : { allowed: true, endLabel: '', remainingLabel: '' };
  const WARRIOR_TITLES = [
    'воин Асгарда', 'страж Мидгарда', 'берсерк Севера', 'копейщик Одина',
    'щитоносец клана', 'викинг Асгарда', 'хускарл Тора', 'дружинник Севера',
    'рунный боец', 'сын Асгарда', 'меченосец клана', 'северный страж',
  ];
  const MASTER_TITLES = [
    'ярл Асгарда', 'хёвдинг клана', 'вождь дружины', 'конунг объекта',
    'старейшина клана', 'хирдман Одина', 'военный вождь', 'ярл Севера',
  ];
  const dayIndex = Math.floor(Date.now() / 86400000); // меняется каждый день
  const titles = isMaster ? MASTER_TITLES : WARRIOR_TITLES;
  const vikingTitle = titles[dayIndex % titles.length];

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl h-24 animate-pulse" style={{ backgroundColor: 'var(--bg-elevated)' }} />
        ))}
      </div>
    );
  }

  // Build quick actions
  const actions = [
    { icon: Briefcase, label: 'Мои работы', path: '/field/my-works' },
    { icon: History, label: 'Табель', path: '/field/timesheet' },
    { icon: Users, label: 'Бригада', path: '/field/crew' },
    { icon: Map, label: 'Маршрут', path: '/field/stages' },
    { icon: Truck, label: 'Поездки и направления', path: '/field/logistics' },
    { icon: Camera, label: 'Фото', path: '/field/photos' },
    { icon: Package, label: 'Сбор паллет', path: '/field/assembly' },
    { icon: ScrollText, label: 'Наряды', path: '/field/permits' },
  ];
  if (isMaster) {
    actions.push(
      { icon: FileText, label: 'Отчёт', path: '/field/report' },
      { icon: AlertTriangle, label: 'Инцидент', path: '/field/incidents' },
      { icon: Wallet, label: 'Подотчёт', path: '/field/funds' },
      { icon: PackageCheck, label: 'Приёмка', path: '/field/receiving' },
    );
  }
  actions.push({ icon: UserCircle, label: 'Профиль', path: '/field/profile' });

  return (
    <div className="fh-root" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Ambient-сцена: мягкие орбы (не мешают контенту, z-index 0) */}
      <div className="fh-scene" aria-hidden>
        <span className="fh-orb fh-orb--a" />
        <span className="fh-orb fh-orb--b" />
        <span className="fh-orb fh-orb--c" />
      </div>
      {rankCeremony && (
        <RankUpCeremony
          open
          rank={rankCeremony.rank}
          prevRank={rankCeremony.prevTitle}
          level={rankCeremony.level}
          assets={meAssets}
          cosmetics={meCosmetics}
          employeeId={employee?.id}
          haptic={haptic}
          welcome={!!rankCeremony.welcome}
          onClose={() => setRankCeremony(null)}
        />
      )}
      {pulling && (
        <div className="flex justify-center py-2" style={{ position: 'relative', zIndex: 6 }}>
          <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--value)' }} />
        </div>
      )}

      <div className="fh-content" style={{ padding: 'max(env(safe-area-inset-top), 16px) 16px max(env(safe-area-inset-bottom), 24px)' }}>
      {/* Greeting + Viking quote + быстрый тумблер темы */}
      <div className="fh-greet">
        <div className="fh-greet__body">
          <h1 className="fh-h1">{getGreeting()}, {firstName}, <span className="fh-rankword">{vikingTitle}</span>!</h1>
          <p className="fh-date">{fmtDate()}</p>
          <p className="fh-quote">«{quote}»</p>
        </div>
        <button
          type="button"
          onClick={() => { haptic.light(); toggleTheme(); }}
          aria-label={theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'}
          className="fh-theme-btn"
        >
          {theme === 'light' ? <Moon size={18} strokeWidth={2} /> : <Sun size={18} strokeWidth={2} />}
        </button>
      </div>
      {/* Химцех — launch banner (вёрстка из прототипа: сочный рэмп + блик) */}
      {showChemLabBanner && (
        <button
          type="button"
          className="fh-promo"
          onClick={() => {
            haptic.medium();
            localStorage.setItem(CHEMLAB_BANNER_KEY, '1');
            setShowChemLabBanner(false);
            navigate('/field/chemlab');
          }}
        >
          <span className="fh-promo__sheen" aria-hidden />
          <span className="fh-promo__ico"><FlaskConical size={26} strokeWidth={2} /></span>
          <span className="fh-promo__txt">
            <span className="fh-promo__k">Новая игра · Химцех</span>
            <span className="fh-promo__t">Переливай реагенты по протоколу</span>
            <span className="fh-promo__s">Ошибка = взрыв. Учись на правилах смены</span>
          </span>
          <span className="fh-promo__cta">ИГРАТЬ</span>
          <span
            className="fh-promo__x"
            role="button"
            tabIndex={0}
            aria-label="Скрыть"
            onClick={(e) => {
              e.stopPropagation();
              setShowChemLabBanner(false);
              localStorage.setItem(CHEMLAB_BANNER_KEY, '1');
            }}
          >×</span>
        </button>
      )}
      {/* «Химцех починен» — один раз, сворачивается */}
      {showChemLabFixed && (
        <div style={{
          position: 'relative', display: 'flex', alignItems: 'center', gap: 14,
          background: 'linear-gradient(135deg, color-mix(in oklab, var(--ok) 28%, transparent) 0%, color-mix(in oklab, var(--ok) 8%, transparent) 60%, rgba(20,24,32,0.4) 100%)',
          border: '1.5px solid color-mix(in oklab, var(--ok) 45%, transparent)',
          borderRadius: 18, padding: '14px 16px', marginBottom: 20,
          boxShadow: '0 8px 30px color-mix(in oklab, var(--ok) 18%, transparent), inset 0 1px 0 color-mix(in oklab, var(--text-primary) 6%, transparent)',
          animation: 'fadeInUp var(--motion-normal) var(--ease-spring) both',
        }}>
          <button
            type="button"
            onClick={() => { localStorage.setItem(CHEMLAB_FIXED_KEY, '1'); setShowChemLabFixed(false); }}
            style={{
              position: 'absolute', top: 8, right: 10, background: 'none', border: 'none',
              color: 'color-mix(in oklab, var(--text-primary) 45%, transparent)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4,
            }}
            aria-label="Свернуть"
          >×</button>
          <div style={{
            width: 48, height: 48, borderRadius: 14, flexShrink: 0,
            background: 'color-mix(in oklab, var(--ok) 18%, transparent)',
            border: '1px solid color-mix(in oklab, var(--ok) 45%, transparent)',
            display: 'grid', placeItems: 'center', color: 'var(--ok)',
          }}><Wrench size={24} strokeWidth={2} /></div>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', color: 'var(--ok)', marginBottom: 4 }}>
              ИГРА СНОВА РАБОТАЕТ
            </p>
            <p style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.25 }}>
              Химцех починен
            </p>
            <p style={{ fontSize: 11, color: 'color-mix(in oklab, var(--text-primary) 65%, transparent)', lineHeight: 1.4 }}>
              Открывал и вылетало — починили. Заходи и переливай реагенты
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              haptic.medium();
              localStorage.setItem(CHEMLAB_FIXED_KEY, '1');
              setShowChemLabFixed(false);
              navigate('/field/chemlab');
            }}
            style={{
              fontSize: 11, fontWeight: 900, color: '#06210f',
              background: 'linear-gradient(135deg, var(--ok), #2D8659)',
              border: 'none', borderRadius: 12, padding: '12px 12px',
              whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer',
              boxShadow: '0 4px 18px color-mix(in oklab, var(--ok) 35%, transparent)',
            }}
          >
            ОТКРЫТЬ
          </button>
        </div>
      )}

      {/* Download app banner — only in browser, not native APK */}
      {!window?.Capacitor?.isNativePlatform?.() && (
        <a
          href="https://92.242.61.184/download"
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: 'linear-gradient(135deg, color-mix(in oklab, var(--value) 18%, transparent) 0%, color-mix(in oklab, var(--value) 8%, transparent) 100%)',
            border: '1px solid color-mix(in oklab, var(--value) 40%, transparent)',
            borderRadius: 16, padding: '14px 16px', marginBottom: 20,
            textDecoration: 'none',
            animation: 'fadeInUp var(--motion-normal) var(--ease-spring) both',
          }}
        >
          <div style={{
            width: 46, height: 46, borderRadius: 12, flexShrink: 0,
            background: 'linear-gradient(135deg, color-mix(in oklab, var(--value) 30%, transparent), color-mix(in oklab, var(--value) 10%, transparent))',
            border: '1px solid color-mix(in oklab, var(--value) 50%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24,
                }}>
                  <Shield size={22} strokeWidth={2.2} aria-hidden />
                </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', marginBottom: 2 }}>
              Скачать приложение ASGARD
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Установи APK — работай без браузера. Быстрее, удобнее, надёжнее.
            </p>
          </div>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--bg-primary)',
            background: 'var(--gold)', borderRadius: 8,
            padding: '6px 12px', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            Скачать
          </div>
        </a>
      )}

      {/* iOS "Add to Home Screen" hint */}
      {showIOSHint && (
        <div style={{
          position: 'fixed', bottom: 80, left: 16, right: 16, zIndex: 500,
          background: 'var(--field-card)',
          border: '1px solid color-mix(in oklab, var(--value) 40%, transparent)',
          borderRadius: 18, padding: '16px',
          boxShadow: '0 8px 32px color-mix(in oklab, var(--bg-primary) 50%, transparent)',
          animation: 'fadeInUp var(--motion-normal) var(--ease-spring) both',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--value-ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Smartphone size={15} strokeWidth={2.4} aria-hidden />
              Добавь приложение на экран
            </p>
            <button onClick={() => { setShowIOSHint(false); localStorage.setItem(IOS_HINT_DISMISSED_KEY, '1'); }}
              style={{ background: 'none', border: 'none', color: 'color-mix(in oklab, var(--text-primary) 40%, transparent)', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>×</button>
          </div>
          <p style={{ fontSize: 12, color: 'color-mix(in oklab, var(--text-primary) 60%, transparent)', lineHeight: 1.5, marginBottom: 12 }}>
            Работай как в приложении — без браузерных панелей.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {[
              { icon: '⎙', label: 'Нажми «Поделиться»' },
              { icon: '→', label: '' },
              { icon: '＋', label: '«На экран "Домой"»' },
            ].map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span style={{ color: 'color-mix(in oklab, var(--text-primary) 30%, transparent)', fontSize: 12 }}>→</span>}
                <div style={{
                  background: 'color-mix(in oklab, var(--value) 15%, transparent)', border: '1px solid color-mix(in oklab, var(--value) 30%, transparent)',
                  borderRadius: 10, padding: '6px 10px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 16, marginBottom: 2 }}>{s.icon}</div>
                  {s.label && <div style={{ fontSize: 9, color: 'color-mix(in oklab, var(--text-primary) 60%, transparent)', lineHeight: 1.2 }}>{s.label}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Push notification prompt */}
      {showPushPrompt && !push.subscribed && push.permission !== 'denied' && (
        <div style={{
          position: 'fixed', bottom: 80, left: 16, right: 16, zIndex: 500,
          background: 'var(--field-card)',
          border: '1px solid color-mix(in oklab, var(--acc) 40%, transparent)',
          borderRadius: 18, padding: '16px',
          boxShadow: '0 8px 32px color-mix(in oklab, var(--bg-primary) 50%, transparent)',
          animation: 'fadeInUp var(--motion-normal) var(--ease-spring) both',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--acc)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Bell size={15} strokeWidth={2.4} aria-hidden />
              Включи уведомления
            </p>
            <button onClick={() => { setShowPushPrompt(false); localStorage.setItem(PUSH_DISMISSED_KEY, '1'); }}
              style={{ background: 'none', border: 'none', color: 'color-mix(in oklab, var(--text-primary) 40%, transparent)', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>×</button>
          </div>
          <p style={{ fontSize: 12, color: 'color-mix(in oklab, var(--text-primary) 60%, transparent)', lineHeight: 1.5, marginBottom: 14 }}>
            Получай уведомления о выплатах, заданиях и изменениях в расписании прямо на экран.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={async () => {
                const res = await push.subscribe();
                if (res.ok) setShowPushPrompt(false);
              }}
              disabled={push.loading}
              style={{
                flex: 1, padding: '11px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, var(--acc), var(--acc-deep))',
                color: 'var(--text-primary)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
                {push.loading ? '…' : 'Включить'}
            </button>
            <button
              onClick={() => { setShowPushPrompt(false); localStorage.setItem(PUSH_DISMISSED_KEY, '1'); }}
              style={{
                flex: 1, padding: '11px', borderRadius: 12,
                background: 'transparent', border: '1px solid color-mix(in oklab, var(--text-primary) 12%, transparent)',
                color: 'color-mix(in oklab, var(--text-primary) 40%, transparent)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Не сейчас
            </button>
          </div>
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3 mb-4"
          style={{ backgroundColor: 'color-mix(in oklab, var(--danger) 12%, transparent)', border: '1px solid color-mix(in oklab, var(--danger) 30%, transparent)' }}>
          <AlertCircle size={18} color="var(--danger)" />
          <span className="text-sm" style={{ color: 'var(--danger)' }}>{error}</span>
        </div>
      )}

      {/* Active Project */}
      {project ? (
        <div className="rounded-xl p-4 mb-4"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <div className="flex items-center gap-2 mb-2">
            <MapPin size={16} style={{ color: 'var(--gold)' }} />
            <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
              {isActiveAssignment ? 'Активный проект' : 'Завершён'}
            </span>
          </div>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{project.work_title || project.title || project.object_name}</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {[project.city, project.object_name].filter(Boolean).join(' · ')}
          </p>

          {/* Вахта МЛСП — только чтение, вшито в баннер объекта */}
          {mlspStay?.is_open && (
            <MlspStayBanner stay={mlspStay} />
          )}

          {/* PM + Masters call buttons */}
          <div className="flex flex-wrap gap-2 mt-3">
            {project.pm?.fio && (
              <a href={`tel:${(project.pm.phone || '').replace(/[^\d+]/g, '')}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                <Phone size={12} style={{ color: 'var(--gold)' }} />
                РП: {shortFio(project.pm.fio)}
              </a>
            )}
            {project.masters?.map((m, i) => (
              <a key={i} href={`tel:${(m.phone || '').replace(/[^\d+]/g, '')}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-norse)', color: 'var(--text-primary)' }}>
                <Phone size={12} style={{ color: 'var(--gold)' }} />
                {m.role === 'senior_master' ? 'Ст. маст.' : 'Маст.'}: {shortFio(m.fio)}
              </a>
            ))}
          </div>
        </div>
      ) : mlspStay?.is_open ? (
        <div className="rounded-xl p-4 mb-4"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <div className="flex items-center gap-2 mb-2">
            <MapPin size={16} style={{ color: 'var(--gold)' }} />
            <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
              На платформе МЛСП
            </span>
          </div>
          <MlspStayBanner stay={mlspStay} />
        </div>
      ) : (
        <div className="rounded-xl p-6 mb-4 text-center"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <MapPin size={32} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>Нет активного проекта</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>Отдыхай, воин!</p>
        </div>
      )}

      {/* Планируемое привлечение */}
      {plannedEngagement && (
        <div className="rounded-xl p-4 mb-4"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid color-mix(in oklab, var(--acc) 35%, transparent)' }}>
          <div className="flex items-center gap-2 mb-2">
            <ClipboardList size={16} style={{ color: 'var(--acc)' }} />
            <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--acc)' }}>
              Планируемое привлечение
            </span>
          </div>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{plannedEngagement.work_title}</p>
          {plannedEngagement.pm_name && (
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              РП: {plannedEngagement.pm_name}
            </p>
          )}
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            <Calendar size={12} className="inline mr-1" style={{ verticalAlign: '-2px' }} />
            {fmtPlanPeriod(plannedEngagement.planned_from, plannedEngagement.planned_to)}
          </p>
          {(plannedEngagement.site_category === 'mlsp' || plannedEngagement.inbound_transport) && (
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Завоз{plannedEngagement.planned_from ? ` ${new Date(plannedEngagement.planned_from).toLocaleDateString('ru-RU')}` : ''}
              {plannedEngagement.inbound_transport === 'ship' ? ' · корабль'
                : plannedEngagement.inbound_transport === 'helicopter' ? ' · вертолёт' : ''}
            </p>
          )}
          <p className="text-xs mt-2 italic" style={{ color: 'var(--text-tertiary)' }}>
            Это план, не назначение. Смена начнётся после выезда на объект.
          </p>
        </div>
      )}

      {/* Постоянный баннер готовности — рабочий всегда видит свой статус и может сменить */}
      {readinessStatus && (() => {
        const RS = {
          ready:     { ic: Swords, label: 'Готов к походу',      sub: 'Жду нового объекта',        col: 'var(--ok)' },
          not_ready: { ic: BedDouble, label: 'Пока отдыхаю',     sub: 'Не готов к выезду',          col: 'var(--value)' },
          on_site:   { ic: HardHat, label: 'На объекте',         sub: 'В строю на работе',          col: 'var(--acc)' },
          archive:   { ic: Archive, label: 'В архиве',           sub: '',                           col: 'var(--text-tertiary)' },
          unknown:   { ic: HelpCircle, label: 'Готов на объект?', sub: 'Отметь свою готовность',    col: 'var(--danger)' },
        };
        const r = RS[readinessStatus] || RS.unknown;
        // Если чек-ин заблокирован непройденным уроком — не показываем «зелёное» противоречие
        const blockedByAcademy = academyAlert?.type === 'blocked' && !isActive;
        const shown = blockedByAcademy ? { ...r, col: 'var(--danger)', sub: 'Пройди обязательный урок' } : r;
        return (
          <button onClick={() => { haptic.light(); navigate('/field/readiness'); }}
            className="w-full rounded-xl p-4 mb-4 flex items-center gap-3 text-left"
            style={{ backgroundColor: 'var(--bg-elevated)', border: `2px solid ${shown.col}`, opacity: blockedByAcademy ? 0.85 : 1 }}>
            <IconTile icon={shown.ic} size={44} tone={blockedByAcademy ? 'danger' : 'status'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="font-semibold" style={{ color: shown.col }}>{shown.label}</p>
              {shown.sub && <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{shown.sub}</p>}
            </div>
            <span className="text-xs px-2 py-1 rounded-lg" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border-norse)' }}>
              {readinessStatus === 'unknown' ? 'Отметить' : 'Изменить'}
            </span>
          </button>
        );
      })()}

      {/* Current trip stage card */}
      {currentStage && currentStage.stage_type && currentStage.stage_type !== 'object' && (
        <button onClick={() => navigate('/field/stages')}
          className="w-full rounded-xl p-4 mb-4 text-left"
          style={{ backgroundColor: 'var(--bg-elevated)', border: `2px solid ${STAGE_COLORS[currentStage.stage_type] || 'var(--acc)'}` }}>
          <p className="font-semibold" style={{ color: STAGE_COLORS[currentStage.stage_type] || 'var(--acc)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {(() => { const Ic = STAGE_ICONS[currentStage.stage_type]; return Ic ? <Ic size={15} strokeWidth={2.2} /> : null; })()}
            {STAGE_LABELS[currentStage.stage_type] || currentStage.stage_type}
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {Math.max(1, Math.floor((Date.now() - new Date(currentStage.date_from).getTime()) / 86400000) + 1)}-й день
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--gold)' }}>Подробнее →</p>
        </button>
      )}

      {/* "Left site" info card */}
      {project && !isActiveAssignment && (
        <div className="rounded-xl p-4 mb-4 text-center"
          style={{ backgroundColor: 'color-mix(in oklab, var(--danger) 8%, transparent)', border: '1px solid color-mix(in oklab, var(--danger) 20%, transparent)' }}>
              <div className="text-2xl mb-1"><HomeIcon size={24} strokeWidth={2.2} aria-hidden /></div>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Вы уехали с объекта</p>
          {(project.departure_date || project.date_to) && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Отъезд: {new Date(project.departure_date || project.date_to).toLocaleDateString('ru-RU')}
            </p>
          )}
          {project.departure_reason && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{project.departure_reason}</p>
          )}
          {(mlspStay?.transport || project?.mlsp_stay?.transport) && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Вывезли: {(mlspStay?.transport || project.mlsp_stay.transport) === 'ship' ? 'корабль' : 'вертолёт'}
            </p>
          )}
        </div>
      )}

      {/* Academy alert — показываем только если смена не идёт */}
      {academyAlert && !isActive && (
        <div
          onClick={() => navigate('/field/academy')}
          className="rounded-xl px-4 py-3 mb-3 flex items-start gap-3"
          style={{
            background: academyAlert.type === 'blocked'
              ? 'color-mix(in oklab, var(--danger) 10%, transparent)'
              : academyAlert.daysLeft <= 1 ? 'color-mix(in oklab, var(--danger) 12%, transparent)' : 'color-mix(in oklab, var(--acc) 10%, transparent)',
            border: academyAlert.type === 'blocked'
              ? '1px solid color-mix(in oklab, var(--danger) 35%, transparent)'
              : academyAlert.daysLeft <= 1 ? '1px solid color-mix(in oklab, var(--danger) 40%, transparent)' : '1px solid color-mix(in oklab, var(--acc) 30%, transparent)',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 20, flexShrink: 0 }}>
            {academyAlert.type === 'blocked' ? '🚫' : academyAlert.daysLeft <= 1 ? '⚠️' : '🏛️'}
          </span>
          <div style={{ flex: 1 }}>
            <div className="text-sm font-semibold" style={{
              color: academyAlert.type === 'blocked' ? 'var(--danger)' : academyAlert.daysLeft <= 1 ? 'var(--value)' : 'var(--acc)',
            }}>
              {academyAlert.type === 'blocked'
                ? 'Чекин заблокирован — пройди Испытание'
                : academyAlert.daysLeft <= 1
                  ? 'Последний день! Пройди тест до полуночи'
                  : `Пройди Испытание до воскресенья`}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              «{academyAlert.title}» · иначе не сможешь начать смену
              {academyAlert.type === 'reminder' && academyAlert.daysLeft > 1 && ` · осталось ${academyAlert.daysLeft}д`}
            </div>
          </div>
          <span style={{ fontSize: 14, color: 'var(--text-tertiary)', alignSelf: 'center' }}>→</span>
        </div>
      )}

      {/* Shift block */}
      {project && isActiveAssignment && (
        <div className="rounded-xl p-4 mb-4"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          {isActive ? (
            <>
              <div className="text-center mb-3">
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--text-tertiary)' }}>Смена идёт</p>
                <p className="text-3xl font-mono font-bold" style={{ color: 'var(--gold)' }}>{fmtTimer(elapsed)}</p>
              </div>
              {!shiftEndInfo.allowed && (
                <p className="text-center text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Смена до {shiftEndInfo.endLabel} · осталось {shiftEndInfo.remainingLabel}
                </p>
              )}
              <button disabled={actionLoading || !shiftEndInfo.allowed} onClick={handleCheckout}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm disabled:opacity-50"
                style={{ backgroundColor: shiftEndInfo.allowed ? 'var(--danger)' : 'var(--bg-elevated)', color: shiftEndInfo.allowed ? 'var(--text-primary)' : 'var(--text-tertiary)', border: shiftEndInfo.allowed ? 'none' : '1px solid var(--border-norse)' }}>
                {actionLoading ? 'Завершаем...' : shiftEndInfo.allowed ? 'Завершить смену' : `Завершить в ${shiftEndInfo.endLabel}`}
              </button>
            </>
          ) : (
            <>
              <button disabled={actionLoading || academyAlert?.type === 'blocked'} onClick={handleCheckin}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--gold), var(--value))' }}>
                {actionLoading ? 'Отмечаемся...' : academyAlert?.type === 'blocked' ? '🚫 Сначала пройди урок' : '⚔️ Начать смену'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Tariff card */}
      {project?.tariff && (
        <div className="rounded-xl p-3 mb-4"
          style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>Тариф</p>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            {project.tariff.position_name} · {project.tariff.points} баллов
          </p>
          {project.tariff.combination && (
            <p className="text-xs mt-1" style={{ color: 'var(--gold)' }}>
              + Совмещение: {project.tariff.combination.position_name} (+1 балл)
            </p>
          )}
        </div>
      )}

      {/* Gamification tiles */}
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide px-1 mb-2" style={{ color: 'var(--text-tertiary)', letterSpacing: '.1em' }}>
          Геймификация
        </p>
        <NornsPauseStrip style={{ margin: '0 0 10px' }} />
        <div className="grid grid-cols-2 gap-3">
          {GAMIFICATION_TILES.map(({ icon: Icon, label, path, tone, badge, folder }) => (
            <button
              key={path}
              onClick={() => {
                haptic.medium();
                if (folder) setShowGamesFolder(true);
                else navigate(path);
              }}
              className="flex items-center gap-3 p-4 rounded-2xl active:scale-95 transition-transform relative"
              style={{
                background: tone === 'neutral' ? 'var(--bg-surface)' : `color-mix(in oklab, var(--${tone}) 9%, var(--bg-surface))`,
                border: `1.5px solid ${tone === 'neutral' ? 'var(--border-norse)' : `color-mix(in oklab, var(--${tone}) 30%, transparent)`}`,
                boxShadow: 'var(--elevation-1)',
              }}
            >
              {badge && (
                <span style={{
                  position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 800,
                  padding: '3px 7px', borderRadius: 999,
                  background: badge === PAUSE_BADGE ? 'var(--value)' : 'var(--danger)',
                  color: badge === PAUSE_BADGE ? 'var(--text-on-gold)' : '#fff',
                  letterSpacing: '.06em',
                  maxWidth: '55%',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>{badge}</span>
              )}
              {folder ? (
                <div style={{
                  width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-norse)',
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, padding: 4,
                  color: 'var(--text-secondary)',
                }}>
                  {[Dices, Waves, FlaskConical, Plus].map((Ic, i) => (
                    <div key={i} style={{ display: 'grid', placeItems: 'center' }}>
                      <Ic size={11} strokeWidth={2.2} />
                    </div>
                  ))}
                </div>
              ) : (
                <IconTile icon={Icon} size={40} tone={tone} />
              )}
              <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* iOS-style Games folder */}
      {showGamesFolder && (
        <div
          role="dialog"
          aria-label="Игры"
          onClick={() => setShowGamesFolder(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 80,
            background: 'color-mix(in oklab, var(--bg-primary) 55%, transparent)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
            animation: 'fadeInUp 0.25s var(--ease-spring) both',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 320,
              borderRadius: 28,
              padding: '22px 18px 18px',
              background: 'var(--field-card)',
              border: '1px solid var(--field-hairline)',
              boxShadow: '0 24px 80px color-mix(in oklab, var(--bg-primary) 55%, transparent)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '0 4px' }}>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 900, color: 'var(--field-text)' }}>Игры</p>
              <button
                type="button"
                onClick={() => setShowGamesFolder(false)}
                style={{
                  width: 32, height: 32, borderRadius: 16, border: 'none',
                  background: 'var(--field-card-3)', color: 'var(--field-text)', fontSize: 18, cursor: 'pointer',
                }}
              >×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {GAMES_FOLDER.map((g) => (
                <button
                  key={g.label}
                  type="button"
                  disabled={g.soon}
                  onClick={() => {
                    if (g.soon || !g.path) return;
                    haptic.medium();
                    setShowGamesFolder(false);
                    navigate(g.path);
                  }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    padding: 10, border: 'none', background: 'transparent', cursor: g.soon ? 'default' : 'pointer',
                    opacity: g.soon ? 0.45 : 1,
                  }}
                >
                  <div style={{ position: 'relative' }}>
                    <IconTile icon={g.icon} size={64} tone={g.tone} iconSize={30} />
                    {g.badge && (
                      <span style={{
                        position: 'absolute', top: -4, right: -4, fontSize: 10, fontWeight: 800,
                        padding: '3px 6px', borderRadius: 999,
                        background: g.badge === PAUSE_BADGE ? 'var(--value)' : 'var(--danger)',
                        color: g.badge === PAUSE_BADGE ? 'var(--text-on-gold)' : '#fff',
                      }}>{g.badge}</span>
                    )}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{g.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mimir tip */}
      {mimirTip && (
        <div className="mb-4 rounded-2xl p-4"
          style={{ background: 'linear-gradient(135deg, color-mix(in oklab, var(--acc) 6%, transparent), color-mix(in oklab, var(--acc) 4%, transparent))',
            border: '1px solid color-mix(in oklab, var(--acc) 15%, transparent)', boxShadow: '0 4px 16px color-mix(in oklab, var(--bg-primary) 15%, transparent)' }}>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: 28, filter: 'drop-shadow(0 2px 8px color-mix(in oklab, var(--acc) 30%, transparent))' }}>{mimirTip.icon}</span>
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'color-mix(in oklab, var(--acc) 70%, transparent)', letterSpacing: '.1em' }}>Мимир говорит</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)', lineHeight: 1.4 }}>{mimirTip.text}</p>
            </div>
          </div>
        </div>
      )}

      {/* Rank mini-card */}
      {myRank && (
        <button onClick={() => { haptic.medium(); navigate('/field/leaderboard'); }}
          className="w-full rounded-2xl p-4 mb-5 text-left active:scale-95 transition-transform"
          style={{ background: 'var(--field-card)', border: '1.5px solid color-mix(in oklab, var(--value) 40%, transparent)', boxShadow: '0 4px 20px color-mix(in oklab, var(--value) 8%, transparent)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <span style={{ color: 'var(--value-ink)' }}><TrophyIcon size={30} strokeWidth={2.1} aria-hidden /></span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'color-mix(in oklab, var(--value) 70%, transparent)' }}>Мой рейтинг</p>
                <p className="text-lg font-bold" style={{ color: 'var(--value)' }}>#{myRank.rank} из {myRank.total}</p>
                <p className="text-xs" style={{ color: 'color-mix(in oklab, var(--text-primary) 50%, transparent)' }}>
                  {myRank.rank_title?.icon} {myRank.rank_title?.title} · {myRank.earned_runes} ᚱ заработано
                </p>
              </div>
            </div>
            <span style={{ color: 'color-mix(in oklab, var(--value) 60%, transparent)', fontSize: 18 }}>›</span>
          </div>
        </button>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-3">
        {actions.map(({ icon: Icon, label, path }) => (
          <button key={path + label} onClick={() => { haptic.light(); navigate(path); }}
            className="flex flex-col items-center gap-2 py-3 px-1 rounded-xl active:scale-95 transition-transform"
            style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-norse)' }}>
            <Icon size={20} style={{ color: 'var(--gold)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
          </button>
        ))}
      </div>

      {/* Readiness prompt BottomSheet */}
      {showReadinessPrompt && (
        <>
          <div
            role="presentation"
            style={{
              position: 'fixed', inset: 0, zIndex: 10050,
              background: 'color-mix(in oklab, var(--bg-primary) 50%, transparent)',
            }}
            onClick={() => setShowReadinessPrompt(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10051,
              background: 'var(--bg-elevated)',
              borderTopLeftRadius: 24, borderTopRightRadius: 24,
              padding: '24px 20px 32px',
              paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
              boxShadow: '0 -8px 32px color-mix(in oklab, var(--bg-primary) 30%, transparent)',
              animation: 'fadeInUp 300ms var(--ease-spring) both',
            }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-norse)', margin: '0 auto 20px' }} />
            <div className="text-center mb-5">
              <Shield size={40} style={{ color: 'var(--gold)', margin: '0 auto 12px' }} />
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                Готов к новому походу?
              </p>
              <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                Обнови свой статус готовности, чтобы HR мог подобрать тебя на объект
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { haptic.medium(); setShowReadinessPrompt(false); navigate('/field/readiness'); }}
                className="flex-1 py-3.5 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
                style={{ background: 'linear-gradient(135deg, var(--green), var(--ok))', color: 'var(--text-primary)' }}
                >
                  Готов
                </button>
              <button
                type="button"
                onClick={() => { haptic.light(); setShowReadinessPrompt(false); navigate('/field/readiness'); }}
                className="flex-1 py-3.5 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
                style={{
                  background: 'color-mix(in srgb, var(--warn-t) 15%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--warn-t) 35%, transparent)',
                  color: 'var(--warn-t)',
                }}
                >
                  Отдыхаю
                </button>
            </div>
          </div>
        </>
      )}

      {/* Monthly profile confirm — после readiness, если оба нужны.
          z-index выше FieldLayout-баннеров (999/1000) и changelog (9999),
          иначе кнопки «Открыть профиль» перехватываются оверлеями сверху.
          Backdrop и sheet — siblings без transform-родителя (иначе fixed ломается на iOS). */}
      {!showReadinessPrompt && showProfileConfirm && profileCompleteness && (
        <>
          <div
            role="presentation"
            style={{
              position: 'fixed', inset: 0, zIndex: 10050,
              background: 'color-mix(in oklab, var(--bg-primary) 50%, transparent)',
            }}
            onClick={() => setShowProfileConfirm(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10051,
              background: 'var(--bg-elevated)',
              borderTopLeftRadius: 24, borderTopRightRadius: 24,
              padding: '24px 20px 32px',
              paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
              boxShadow: '0 -8px 32px color-mix(in oklab, var(--bg-primary) 30%, transparent)',
              maxHeight: '85vh',
              overflowY: 'auto',
              animation: 'fadeInUp 300ms var(--ease-spring) both',
            }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-norse)', margin: '0 auto 20px' }} />
            <div className="text-center mb-4">
              <UserCircle size={40} style={{ color: 'var(--gold)', margin: '0 auto 12px' }} />
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {profileCompleteness.criticalOk ? 'Данные не изменились?' : 'Проверь анкету'}
              </p>
              <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                {profileCompleteness.criticalOk
                  ? 'Раз в месяц подтверждаем, что личные данные актуальны'
                  : 'Зайди в Профиль и нажми «Исправить данные»'}
              </p>
            </div>

            {profileCompleteness.criticalGaps?.length > 0 && (
              <div className="mb-3 rounded-xl p-3"
                style={{
                  background: 'color-mix(in srgb, var(--danger, var(--danger)) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--danger, var(--danger)) 28%, transparent)',
                }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--danger, var(--danger))' }}>
                  Обязательно заполнить
                </p>
                <ul className="text-sm space-y-0.5" style={{ color: 'var(--text-primary)' }}>
                  {profileCompleteness.criticalGaps.map((g) => (
                    <li key={g}>• {g}</li>
                  ))}
                </ul>
              </div>
            )}

            {profileCompleteness.softGaps?.length > 0 && (
              <div className="mb-4 rounded-xl p-3"
                style={{
                  background: 'color-mix(in srgb, var(--warn-t, var(--value)) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--warn-t, var(--value)) 28%, transparent)',
                }}>
                <p className="text-xs font-semibold mb-1" style={{ color: 'var(--warn-t, var(--value))' }}>
                  Желательно
                </p>
                <ul className="text-sm space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {profileCompleteness.softGaps.map((g) => (
                    <li key={g}>• {g}</li>
                  ))}
                </ul>
              </div>
            )}

            {profileCompleteness.criticalOk ? (
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={profileConfirming}
                  onClick={async () => {
                    haptic.medium();
                    setProfileConfirming(true);
                    try {
                      await fieldApi.post('/worker/personal/confirm', { changed: false });
                      setShowProfileConfirm(false);
                    } catch (e) {
                      haptic.error();
                      setError(e.message || 'Не удалось подтвердить');
                    } finally {
                      setProfileConfirming(false);
                    }
                  }}
                  className="flex-1 py-3.5 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
                  style={{ background: 'linear-gradient(135deg, var(--green), var(--ok))', color: 'var(--text-primary)' }}
                >
                  {profileConfirming ? '…' : 'Всё верно'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    haptic.light();
                    setShowProfileConfirm(false);
                    navigate(buildProfileHref(profileCompleteness.criticalGaps));
                  }}
                  className="flex-1 py-3.5 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
                  style={{
                    background: 'color-mix(in srgb, var(--gold) 15%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--gold) 35%, transparent)',
                    color: 'var(--gold)',
                  }}
                >
                  Есть изменения
                </button>
              </div>
            ) : (
              <>
                {/* D-267: отдельная кнопка «Внести размеры» — ведёт ПРЯМО к полям СИЗ
                    с открытой формой и подсветкой, чтобы рабочий не искал их в профиле. */}
                {gapsContainPpe(profileCompleteness.criticalGaps) && (
                  <button
                    type="button"
                    onClick={() => {
                      haptic.medium();
                      setShowProfileConfirm(false);
                      navigate(`/field/profile?focus=${FOCUS_PPE}&edit=1`);
                    }}
                    className="w-full mb-2 py-3.5 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
                    style={{ backgroundColor: 'var(--gold)', color: 'var(--bg-primary)' }}
                  >
                    👕 Внести размеры СИЗ
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    haptic.medium();
                    setShowProfileConfirm(false);
                    navigate(buildProfileHref(profileCompleteness.criticalGaps));
                  }}
                  className="w-full py-3.5 rounded-xl font-semibold text-sm active:scale-95 transition-transform"
                  style={{
                    backgroundColor: 'var(--gold)',
                    color: 'var(--bg-primary)',
                  }}
                >
                  Заполнить анкету
                </button>
              </>
            )}
          </div>
        </>
      )}
      </div>
    </div>
  );
}
