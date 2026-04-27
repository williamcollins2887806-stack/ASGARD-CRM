/**
 * FieldQuests.jsx — 1:1 port of FIELD_QUESTS_RENDER.html
 * Norse dark + gold, 4 tabs, live timers, claim modal with shield SVG,
 * confetti + star burst + coin fly, night mode, streak danger toast
 * ================================================================
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fieldApi } from '@/api/fieldClient';

/* ═══ MOCK QUEST DATA — 14 quests ═══ */
const MOCK_QUESTS = [
  { id:1, type:'daily', icon:'\uD83C\uDF05', name:'Ранняя пташка', desc:'Отметиться на объекте до 08:00',
    lore:'Один пробуждался раньше всех, чтобы видеть первый луч Солнца над Асгардом.',
    current:3, target:5, rewardCoins:50, rewardItem:null, state:'active', timerType:'daily' },
  { id:2, type:'daily', icon:'\uD83D\uDCF7', name:'Хроника дня', desc:'Сделать 1 фото с объекта',
    lore:'Летописцы Вальхаллы запечатлели каждый подвиг на рунических камнях.',
    current:0, target:1, rewardCoins:30, rewardItem:null, state:'active', timerType:'daily' },
  { id:3, type:'daily', icon:'\uD83D\uDCCB', name:'Отчёт готов', desc:'Сдать дневной отчёт вовремя',
    lore:'Порядок — основа великих свершений. Тюр записывал каждый бой.',
    current:1, target:1, rewardCoins:40, rewardItem:null, state:'ready', timerType:'daily' },
  { id:4, type:'daily', icon:'\uD83D\uDD25', name:'Без простоев', desc:'Отработать 8+ часов за смену',
    lore:'Кузнец Брок выковал Мьёльнир, не прерываясь ни на миг.',
    current:8.5, target:8, rewardCoins:60, rewardItem:null, state:'ready', timerType:'daily' },
  { id:5, type:'daily', icon:'\uD83D\uDCDE', name:'Командный дух', desc:'Позвонить мастеру участка',
    lore:'Даже Тор не шёл в бой без слова Одина.',
    current:1, target:1, rewardCoins:20, rewardItem:null, state:'claimed', timerType:'daily' },
  { id:6, type:'weekly', icon:'\uD83D\uDEE1', name:'Железная воля', desc:'Выйти на 6 смен подряд без пропусков',
    lore:'Эйнхерии тренируются в Вальхалле каждый день без устали.',
    current:4, target:6, rewardCoins:200, rewardItem:'+1 спин рулетки', state:'active', timerType:'weekly' },
  { id:7, type:'weekly', icon:'\uD83C\uDFAF', name:'Мастер точности', desc:'0 ошибок чекинов за неделю',
    lore:'Стрелы Улля никогда не промахиваются.',
    current:5, target:7, rewardCoins:150, rewardItem:null, state:'active', timerType:'weekly' },
  { id:8, type:'weekly', icon:'\uD83D\uDC65', name:'Наставник', desc:'Помочь новичку 3 раза за неделю',
    lore:'Мудрый Мимир делился знаниями у источника.',
    current:1, target:3, rewardCoins:180, rewardItem:null, state:'active', timerType:'weekly' },
  { id:9, type:'weekly', icon:'\uD83C\uDFC6', name:'Перевыполнение', desc:'Хотя бы 1 день отработать 11+ часов',
    lore:'Берсерк не знает меры в бою.',
    current:1, target:1, rewardCoins:250, rewardItem:null, state:'claimed', timerType:'weekly' },
  { id:10, type:'seasonal', icon:'\uD83D\uDC51', name:'Мастер КАО Азот', desc:'Весь проект без единого прогула',
    lore:'Хранители Биврёста стояли на посту столетиями без единого пропуска.',
    current:18, target:25, rewardCoins:0, rewardItem:'Куртка ASGARD Pro', state:'active', timerType:'seasonal', seasonEnd:'2026-05-31' },
  { id:11, type:'seasonal', icon:'\uD83D\uDCC5', name:'Весна 2026', desc:'Отработать 60 смен за март-май',
    lore:'Три месяца Фимбульветра закалят тебя.',
    current:42, target:60, rewardCoins:0, rewardItem:'Нашивка Весна 2026', state:'active', timerType:'seasonal', seasonEnd:'2026-05-31' },
  { id:12, type:'permanent', icon:'\uD83C\uDFDB', name:'Легенда', desc:'Отработать 500 смен за всё время',
    lore:'Имена величайших воинов высечены в камне.',
    current:287, target:500, rewardCoins:0, rewardItem:'Золотой меч (legendary)', state:'active', timerType:'none' },
  { id:13, type:'permanent', icon:'\u2B50', name:'Столетие', desc:'100 смен без единого нарушения',
    lore:'Хеймдалль видит всё. Сто смен безупречной службы.',
    current:76, target:100, rewardCoins:0, rewardItem:'+5 спинов + рамка Страж', state:'active', timerType:'none' },
  { id:14, type:'permanent', icon:'\uD83D\uDD12', name:'Ярл', desc:'Достичь 20-го уровня',
    lore:'Только достигнув 20-го уровня, воин может стать Ярлом.',
    current:0, target:1, rewardCoins:0, rewardItem:'Титул Ярл + особая рамка', state:'locked', requiredLevel:20, currentLevel:7, timerType:'none' },
];

const TYPE_LABELS = { daily:'\uD83C\uDF05 День', weekly:'\uD83D\uDCC5 Неделя', monthly:'\uD83D\uDCC6 Месяц', seasonal:'\uD83C\uDF42 Сезон', permanent:'\uD83C\uDFDB Вечные' };
const RUNE_ACCENTS = ['\u16C9','\u16B1','\u16CF','\u16A6','\u16A0','\u16C7'];
const TAB_RUNES = { daily:'\u16A0', weekly:'\u16B1', monthly:'\u16CF', seasonal:'\u16C7', permanent:'\u16C9' };

/* ═══ Timer helpers ═══ */
function getEndOfDay() { const d = new Date(); d.setHours(23,59,59,999); return d; }
function getEndOfWeek() { const d = new Date(); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? 0 : 7 - day)); d.setHours(23,59,59,999); return d; }
function getEndOfMonth() { const d = new Date(); d.setMonth(d.getMonth() + 1, 0); d.setHours(23,59,59,999); return d; }
function formatCountdown(ms) {
  if (ms <= 0) return 'Истекло';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}мин`;
  return `${m}мин`;
}

/* ═══ Confetti ═══ */
class ConfettiPiece {
  constructor(x, y, color) {
    this.x = x; this.y = y; this.color = color;
    this.w = 4 + Math.random() * 6; this.h = 3 + Math.random() * 4;
    this.vx = (Math.random() - 0.5) * 12; this.vy = -8 - Math.random() * 12;
    this.gravity = 0.25; this.rotation = Math.random() * Math.PI * 2;
    this.rotSpeed = (Math.random() - 0.5) * 0.3;
    this.life = 1; this.decay = 0.008 + Math.random() * 0.005;
  }
  update() { this.vy += this.gravity; this.vx *= 0.98; this.x += this.vx; this.y += this.vy; this.rotation += this.rotSpeed; this.life -= this.decay; }
  draw(ctx) {
    if (this.life <= 0) return;
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.rotation);
    ctx.globalAlpha = this.life; ctx.fillStyle = this.color; ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h); ctx.restore();
  }
}

/* ═══ COMPONENT ═══ */
export default function FieldQuests() {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const confRef = useRef([]);
  const confAnimRef = useRef(false);
  const timerRef = useRef(null);

  const [quests, setQuests] = useState([]);
  const [activeTab, setActiveTab] = useState('daily');
  const [showModal, setShowModal] = useState(false);
  const [claimingQuest, setClaimingQuest] = useState(null);
  const [showDangerToast, setShowDangerToast] = useState(false);
  const [expandedLore, setExpandedLore] = useState(new Set());
  const [visibleCards, setVisibleCards] = useState(new Set());
  const [timerTick, setTimerTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isNight, setIsNight] = useState(false);

  /* ── Load from API ── */
  useEffect(() => {
    fieldApi.get('/gamification/quests').then(d => {
      const apiQuests = d?.quests || [];
      setQuests((apiQuests || []).map(q => ({
        id: q.id, type: q.quest_type || 'daily', icon: q.icon || '\u26A1',
        name: q.name, desc: q.description,
        lore: q.lore || 'Испытание, достойное воина Асгарда.',
        current: q.progress || 0, target: q.target_count || 1,
        rewardCoins: q.reward_amount || 0, rewardItem: q.reward_item || null,
        state: q.reward_claimed ? 'claimed' : q.completed ? 'ready' : 'active',
        timerType: q.quest_type === 'daily' ? 'daily' : q.quest_type === 'weekly' ? 'weekly' :
          q.quest_type === 'monthly' ? 'monthly' : q.quest_type === 'seasonal' ? 'seasonal' : 'none',
        seasonEnd: q.season_end || '2026-05-31',
        requiredLevel: q.required_level, currentLevel: q.current_level,
      })));
    }).catch(() => setQuests([]))
      .finally(() => setLoading(false));
  }, []);

  /* ── Night mode ── */
  useEffect(() => {
    const check = () => { const h = new Date().getHours(); setIsNight(h >= 22 || h < 6); };
    check();
    const iv = setInterval(check, 60000);
    return () => clearInterval(iv);
  }, []);

  /* ── Live timers ── */
  useEffect(() => {
    timerRef.current = setInterval(() => setTimerTick(t => t + 1), 10000); // Q1: 10s instead of 1s — timers show minutes
    return () => clearInterval(timerRef.current);
  }, []);

  /* ── Canvas resize ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = innerWidth * devicePixelRatio;
      canvas.height = innerHeight * devicePixelRatio;
      canvas.getContext('2d').setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  /* ── Stagger visible cards ── */
  useEffect(() => {
    if (loading) return;
    setVisibleCards(new Set());
    const tab = quests.filter(q => q.type === activeTab);
    tab.forEach((q, i) => {
      setTimeout(() => setVisibleCards(prev => new Set(prev).add(q.id)), i * 100);
    });
  }, [quests, activeTab, loading]);

  /* ── Streak danger toast (demo after 8s) ── */
  useEffect(() => {
    let t2;
    const t = setTimeout(() => { setShowDangerToast(true); t2 = setTimeout(() => setShowDangerToast(false), 4000); }, 8000);
    return () => { clearTimeout(t); if (t2) clearTimeout(t2); };
  }, []);

  /* ── Audio ── */
  const initAudio = useCallback(() => { if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)(); }, []);
  const playFanfare = useCallback(() => {
    initAudio(); const au = audioCtxRef.current; if (!au) return;
    [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((freq, i) => {
      const osc = au.createOscillator(), gain = au.createGain();
      osc.connect(gain); gain.connect(au.destination);
      osc.frequency.value = freq; osc.type = i < 3 ? 'triangle' : 'sine';
      gain.gain.setValueAtTime(0, au.currentTime + i * 0.15);
      gain.gain.linearRampToValueAtTime(0.08, au.currentTime + i * 0.15 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, au.currentTime + i * 0.15 + 0.5);
      osc.start(au.currentTime + i * 0.15); osc.stop(au.currentTime + i * 0.15 + 0.5);
    });
  }, [initAudio]);
  const playClick = useCallback(() => {
    initAudio(); const au = audioCtxRef.current; if (!au) return;
    const osc = au.createOscillator(), g = au.createGain();
    osc.connect(g); g.connect(au.destination); osc.frequency.value = 600; osc.type = 'triangle'; g.gain.value = 0.04;
    g.gain.exponentialRampToValueAtTime(0.001, au.currentTime + 0.05);
    osc.start(); osc.stop(au.currentTime + 0.05);
  }, [initAudio]);

  /* ── Confetti ── */
  const spawnConfetti = useCallback((x, y, count) => {
    const colors = ['#F0C850','#FFE17A','#E84057','#4A90FF','#A56EFF','#3DDC84','#FF8A8A','#FFD700','#FF6B6B'];
    for (let i = 0; i < count; i++) confRef.current.push(new ConfettiPiece(x, y, colors[Math.floor(Math.random() * colors.length)]));
    if (!confAnimRef.current) {
      confAnimRef.current = true;
      const animate = () => {
        const canvas = canvasRef.current; if (!canvas) { confAnimRef.current = false; return; }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width / devicePixelRatio, canvas.height / devicePixelRatio);
        confRef.current = confRef.current.filter(p => p.life > 0);
        confRef.current.forEach(p => { p.update(); p.draw(ctx); });
        if (confRef.current.length) requestAnimationFrame(animate); else confAnimRef.current = false;
      };
      animate();
    }
  }, []);

  /* ── Haptic ── */
  const hap = useCallback((p) => { if (navigator.vibrate) navigator.vibrate(p); }, []);

  /* ── Tab switch ── */
  const switchTab = useCallback((type) => {
    if (activeTab === type) return;
    playClick(); setActiveTab(type);
  }, [activeTab, playClick]);

  /* ── Claim modal ── */
  const openClaimModal = useCallback((quest) => {
    playClick(); hap([15]); setClaimingQuest(quest); setShowModal(true);
  }, [playClick, hap]);
  const closeModal = useCallback(() => { setShowModal(false); setTimeout(() => setClaimingQuest(null), 400); }, []);

  const confirmClaim = useCallback(async () => {
    if (!claimingQuest) return;
    const q = claimingQuest;

    // API claim first — only celebrate on success
    try {
      await fieldApi.post(`/gamification/quests/${q.id}/claim`);
    } catch (err) {
      hap([50]); closeModal();
      return;
    }

    playFanfare(); hap([50, 30, 80, 30, 100]);
    spawnConfetti(innerWidth / 2, innerHeight / 3, 80);
    spawnConfetti(innerWidth / 2, innerHeight / 3, 60);
    setQuests(prev => prev.map(quest => quest.id === q.id ? { ...quest, state: 'claimed' } : quest));
    setTimeout(() => { closeModal(); }, 600);
  }, [claimingQuest, playFanfare, hap, spawnConfetti, closeModal]);

  /* ── Lore toggle ── */
  const toggleLore = useCallback((id) => {
    setExpandedLore(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }, []);

  /* ── Computed ── */
  const tabQuests = useMemo(() => quests.filter(q => q.type === activeTab), [quests, activeTab]);
  const badges = useMemo(() => {
    const b = { daily: 0, weekly: 0, monthly: 0, seasonal: 0, permanent: 0 };
    quests.forEach(q => { if (q.state === 'ready') b[q.type] = (b[q.type] || 0) + 1; });
    return b;
  }, [quests]);
  const dailyDone = useMemo(() => quests.filter(q => q.type === 'daily' && (q.state === 'ready' || q.state === 'claimed')).length, [quests]);
  const dailyTotal = useMemo(() => quests.filter(q => q.type === 'daily').length, [quests]);

  /* ── Timer value helper ── */
  const getTimer = useCallback((timerType, seasonEnd) => {
    const now = Date.now();
    if (timerType === 'daily') return formatCountdown(getEndOfDay().getTime() - now);
    if (timerType === 'weekly') return formatCountdown(getEndOfWeek().getTime() - now);
    if (timerType === 'monthly') return formatCountdown(getEndOfMonth().getTime() - now);
    if (timerType === 'seasonal' && seasonEnd) return formatCountdown(new Date(seasonEnd + 'T23:59:59').getTime() - now);
    return null;
  }, [timerTick]); // eslint-disable-line

  /* ── Ribbon ── */
  const renderRibbon = useCallback(() => {
    const q = tabQuests;
    if (activeTab === 'daily') {
      const done = q.filter(q => q.state === 'ready' || q.state === 'claimed').length;
      return (
        <div className="fq-ribbon">
          <div className="fq-ribbon-row">
            <span className="fq-ribbon-label">Сегодня:</span>
            <div className="fq-ribbon-dots">
              {q.map((_, i) => <div key={i} className={`fq-ribbon-dot${i < done ? ' on daily' : ''}`} />)}
            </div>
            <span className="fq-ribbon-val" style={{ color: 'var(--fq-daily)' }}>{done}/{q.length}</span>
          </div>
          <div className="fq-ribbon-streak">
            <span className="fq-streak-fire">{'\uD83D\uDD25'}</span>
            <span className="fq-streak-txt"><b>12 дней</b> подряд</span>
          </div>
        </div>
      );
    }
    if (activeTab === 'weekly') {
      const done = q.filter(q => q.state === 'ready' || q.state === 'claimed').length;
      return (
        <div className="fq-ribbon">
          <div className="fq-ribbon-row">
            <span className="fq-ribbon-label">Неделя:</span>
            <div className="fq-ribbon-dots">
              {q.map((_, i) => <div key={i} className={`fq-ribbon-dot${i < done ? ' on weekly' : ''}`} />)}
            </div>
            <span className="fq-ribbon-val" style={{ color: 'var(--fq-weekly)' }}>{done}/{q.length} квестов</span>
          </div>
          <div className="fq-ribbon-bonus">
            <span className="fq-bonus-icon">{'\u269C'}</span>
            <span className="fq-bonus-txt">Бонус за неделю:</span>
            <span className="fq-bonus-val">{'\u269C'} 500</span>
          </div>
        </div>
      );
    }
    if (activeTab === 'monthly') {
      const totalT = q.reduce((a, q) => a + q.target, 0);
      const totalC = q.reduce((a, q) => a + Math.min(q.current, q.target), 0);
      const pct = totalT > 0 ? Math.round(totalC / totalT * 100) : 0;
      const daysLeft = Math.ceil((getEndOfMonth().getTime() - Date.now()) / 86400000);
      return (
        <div className="fq-ribbon">
          <div className="fq-ribbon-row">
            <span className="fq-ribbon-label">{new Date().toLocaleString('ru-RU', { month: 'long' })}:</span>
            <span className="fq-ribbon-val" style={{ color: 'var(--fq-monthly)' }}>{pct}%</span>
          </div>
          <div style={{ marginTop: 6 }}>
            <div className="fq-bar-track" style={{ height: 8 }}><div className="fq-bar-fill monthly" style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="fq-ribbon-streak" style={{ borderTopColor: 'rgba(168,85,247,.1)' }}>
            <span style={{ fontSize: 18 }}>{'\u23F3'}</span>
            <span className="fq-streak-txt">Осталось <b style={{ color: 'var(--fq-monthly)' }}>{daysLeft}</b> дней</span>
          </div>
        </div>
      );
    }
    if (activeTab === 'seasonal') {
      const totalT = q.reduce((a, q) => a + q.target, 0);
      const totalC = q.reduce((a, q) => a + q.current, 0);
      const pct = Math.round(totalC / totalT * 100);
      return (
        <div className="fq-ribbon">
          <div className="fq-ribbon-row">
            <span className="fq-ribbon-label">Сезон «Весна 2026»:</span>
            <span className="fq-ribbon-val" style={{ color: 'var(--fq-seasonal)' }}>{pct}%</span>
          </div>
          <div style={{ marginTop: 6 }}>
            <div className="fq-bar-track" style={{ height: 8 }}><div className="fq-bar-fill seasonal" style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
      );
    }
    // permanent
    const unlocked = q.filter(q => q.state !== 'locked');
    const totalT = unlocked.reduce((a, q) => a + q.target, 0);
    const totalC = unlocked.reduce((a, q) => a + q.current, 0);
    const pct = totalT > 0 ? Math.round(totalC / totalT * 100) : 0;
    return (
      <div className="fq-ribbon">
        <div className="fq-ribbon-row">
          <span className="fq-ribbon-label">Общий прогресс:</span>
          <span className="fq-ribbon-val" style={{ color: 'var(--fq-permanent)' }}>{pct}%</span>
        </div>
        <div style={{ marginTop: 6 }}>
          <div className="fq-bar-track" style={{ height: 8 }}><div className="fq-bar-fill permanent" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="fq-ribbon-streak" style={{ borderTopColor: 'rgba(245,158,11,.1)' }}>
          <span style={{ fontSize: 18 }}>{'\uD83C\uDFDB'}</span>
          <span className="fq-streak-txt">Вечные достижения — без срока</span>
        </div>
      </div>
    );
  }, [activeTab, tabQuests]);

  /* ── Stars ── */
  const stars = useMemo(() => Array.from({ length: 30 }, () => ({
    left: Math.random() * 100, top: Math.random() * 100,
    size: 1 + Math.random() * 2, delay: Math.random() * 3, dur: 2 + Math.random() * 2,
  })), []);

  /* ── Skeleton ── */
  if (loading) {
    return (
      <>
        <style>{QUEST_CSS}</style>
        <div className="fq">
          <div className="fq-page" style={{ padding: '60px 16px' }}>
            {[1,2,3,4].map(i => (
              <div key={i} style={{ height: 140, borderRadius: 18, marginBottom: 10,
                background: 'linear-gradient(90deg,#141828 25%,#1a2040 50%,#141828 75%)',
                backgroundSize: '200% 100%', animation: 'fq-shimmer 1.5s infinite' }} />
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{QUEST_CSS}</style>
      <div className={`fq${isNight ? ' night' : ''}`}>
        <div className="fq-bg">
          <div className="fq-bg-glow g1" /><div className="fq-bg-glow g2" /><div className="fq-bg-glow g3" />
          <div className="fq-stars">
            {stars.map((s, i) => <div key={i} className="fq-s" style={{
              left: `${s.left}%`, top: `${s.top}%`, width: s.size, height: s.size,
              animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s`,
            }} />)}
          </div>
        </div>
        <canvas ref={canvasRef} className="fq-confetti" />

        <div className="fq-page">

          {/* ═══ HEADER ═══ */}
          <div className="fq-header">
            <div className="fq-hdr-back" onClick={() => navigate(-1)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            </div>
            <div className="fq-hdr-title">ИСПЫТАНИЯ</div>
            <div className="fq-hdr-counter">
              <span className="fq-fire">{'\uD83D\uDD25'}</span> <span>{dailyDone}/{dailyTotal}</span> сегодня
            </div>
          </div>

          {/* ═══ TAB BAR ═══ */}
          <div className="fq-tabs">
            {['daily','weekly','monthly','seasonal','permanent'].map(type => (
              <div key={type} className={`fq-tab ${type}${activeTab === type ? ' active' : ''}`}
                onClick={() => switchTab(type)}>
                <span className="fq-tab-icon">{type === 'daily' ? '\uD83C\uDF05' : type === 'weekly' ? '\uD83D\uDCC5' : type === 'monthly' ? '\uD83D\uDCC6' : type === 'seasonal' ? '\uD83C\uDF42' : '\uD83C\uDFDB'}</span>
                {type === 'daily' ? 'День' : type === 'weekly' ? 'Неделя' : type === 'monthly' ? 'Месяц' : type === 'seasonal' ? 'Сезон' : 'Вечные'}
                {badges[type] > 0 && <span className="fq-tab-badge">{badges[type]}</span>}
              </div>
            ))}
          </div>

          {/* ═══ RIBBON ═══ */}
          {renderRibbon()}

          {/* ═══ QUEST LIST ═══ */}
          <div className="fq-quest-list">
            {tabQuests.length === 0 ? (
              <div className="fq-empty-state" style={{ transform: 'translateY(10px)' }}>
                <div className="fq-empty-rune">{'\u16A6'}</div>
                <div className="fq-empty-title">Новых испытаний пока нет</div>
                <div className="fq-empty-sub">Загляни позже</div>
              </div>
            ) : tabQuests.map((q, idx) => {
              const pct = Math.min(100, Math.round((q.current / q.target) * 100));
              const isVisible = visibleCards.has(q.id);
              const rune = RUNE_ACCENTS[idx % RUNE_ACCENTS.length];
              const fillClass = q.state === 'ready' ? 'ready' : q.type;
              const timer = getTimer(q.timerType, q.seasonEnd);
              const isTimerDanger = q.timerType === 'daily' && (getEndOfDay().getTime() - Date.now()) < 7200000;
              const loreOpen = expandedLore.has(q.id);

              return (
                <div key={q.id} className={`fq-quest-card ${q.type} state-${q.state}${isVisible ? ' visible' : ''}`}
                  style={{ transitionDelay: `${idx * 80}ms` }}>
                  <div className="fq-rune-accent r1">{rune}</div>

                  {/* Top row */}
                  <div className="fq-qc-top">
                    <div className={`fq-qc-pill ${q.type}`}>
                      <span>{q.icon}</span>
                      {q.type === 'daily' ? 'День' : q.type === 'weekly' ? 'Неделя' : q.type === 'monthly' ? 'Месяц' : q.type === 'seasonal' ? 'Сезон' : 'Вечный'}
                    </div>
                    {q.state === 'ready' && <span className="fq-qc-status ready">{'\u2726'} Награда</span>}
                    {q.state === 'claimed' && <span className="fq-qc-status claimed">{'\u2713'} Выполнен</span>}
                    {q.state === 'locked' && <span className="fq-qc-status locked">{'\uD83D\uDD12'} Lvl {q.requiredLevel}</span>}
                  </div>

                  {/* Name + desc */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
                    <span className="fq-qc-icon">{q.icon}</span>
                    <div className="fq-qc-info">
                      <div className="fq-qc-name">{q.name}</div>
                      <div className="fq-qc-desc">{q.desc}</div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  {q.state !== 'locked' && (
                    <div className="fq-qc-progress">
                      <div className="fq-qc-bar-counter">{q.current}/{q.target}</div>
                      <div className="fq-bar-track">
                        <div className={`fq-bar-fill ${fillClass}`} style={{ width: isVisible ? `${pct}%` : '0%', transition: 'width .6s cubic-bezier(.25,.46,.45,.94)' }} />
                      </div>
                    </div>
                  )}

                  {/* Locked message */}
                  {q.state === 'locked' && (
                    <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 12, color: 'var(--fq-t3)' }}>
                      Разблокируется на <b style={{ color: 'var(--fq-gold)' }}>Lvl {q.requiredLevel}</b>{' '}
                      <span style={{ fontSize: 11 }}>(сейчас Lvl {q.currentLevel})</span>
                    </div>
                  )}

                  {/* Footer: rewards + timer */}
                  <div className="fq-qc-footer">
                    <div className="fq-qc-rewards">
                      {q.rewardCoins > 0 && (
                        <div className="fq-qc-reward"><span className="fq-rw-icon">{'\u269C'}</span><span className="fq-rw-val">{q.rewardCoins}</span></div>
                      )}
                      {q.rewardItem && (
                        <div className="fq-qc-reward">
                          <span className="fq-rw-icon">{q.rewardItem.includes('спин') ? '\uD83C\uDF81' : '\uD83D\uDCE6'}</span>
                          <span className="fq-rw-val" style={{ color: 'var(--fq-t2)', fontSize: 11 }}>{q.rewardItem}</span>
                        </div>
                      )}
                    </div>
                    {timer && (
                      <div className="fq-qc-timer" style={isTimerDanger ? { color: 'var(--fq-red)', fontWeight: 800 } : undefined}>
                        <span className="fq-timer-icon">{'\u23F3'}</span><span>{timer}</span>
                      </div>
                    )}
                  </div>

                  {/* Claim button */}
                  {q.state === 'ready' && (
                    <button className="fq-qc-claim" onClick={(e) => { e.stopPropagation(); openClaimModal(q); }}>
                      <span className="fq-claim-rune">{'\u269C'}</span> ЗАБРАТЬ НАГРАДУ
                    </button>
                  )}

                  {/* Lore expand */}
                  <div className={`fq-qc-expand${loreOpen ? ' open' : ''}`} onClick={() => toggleLore(q.id)}>
                    <span className="fq-arrow">{'\u25BE'}</span> Подробнее
                  </div>
                  <div className={`fq-qc-lore${loreOpen ? ' open' : ''}`}>{q.lore}</div>
                </div>
              );
            })}
          </div>

        </div>

        {/* ═══ DANGER TOAST ═══ */}
        <div className={`fq-danger-toast${showDangerToast ? ' show' : ''}`}>
          <span className="fq-dt-fire">{'\uD83D\uDD25'}</span> Серия 12 дней под угрозой!
        </div>

        {/* ═══ CLAIM MODAL ═══ */}
        <div className={`fq-modal-overlay${showModal ? ' on' : ''}`} onClick={closeModal} />
        <div className={`fq-modal-popup${showModal ? ' on' : ''}`}>
          <div className="fq-modal-card">
            <div className="fq-modal-handle" />
            <div className="fq-modal-rune-l">{'\u16C9'}</div>
            <div className="fq-modal-rune-r">{'\u16CF'}</div>
            <div className="fq-modal-swords">{'\u2694'} ИСПЫТАНИЕ ПРОЙДЕНО {'\u2694'}</div>

            {/* Shield SVG */}
            <div className="fq-modal-shield">
              <div className="fq-shield-glow" />
              <svg viewBox="0 0 150 150" width="150" height="150">
                <defs>
                  <linearGradient id="fqShieldG" x1="75" y1="10" x2="75" y2="140" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#FFE17A"/><stop offset="30%" stopColor="#F0C850"/>
                    <stop offset="70%" stopColor="#C8940A"/><stop offset="100%" stopColor="#8B6914"/>
                  </linearGradient>
                  <linearGradient id="fqShieldInner" x1="75" y1="25" x2="75" y2="125" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#1a2040"/><stop offset="100%" stopColor="#0b0e1a"/>
                  </linearGradient>
                  <radialGradient id="fqShieldGlow" cx="50%" cy="40%" r="50%">
                    <stop offset="0%" stopColor="rgba(240,200,80,.15)"/><stop offset="100%" stopColor="transparent"/>
                  </radialGradient>
                </defs>
                <path d="M75 8 L135 30 Q140 75 120 110 Q100 138 75 145 Q50 138 30 110 Q10 75 15 30Z" fill="url(#fqShieldG)" stroke="#8B6914" strokeWidth="2"/>
                <path d="M75 22 L122 40 Q126 75 110 103 Q94 126 75 132 Q56 126 40 103 Q24 75 28 40Z" fill="url(#fqShieldInner)" stroke="rgba(240,200,80,.3)" strokeWidth="1"/>
                <path d="M75 22 L122 40 Q126 75 110 103 Q94 126 75 132 Q56 126 40 103 Q24 75 28 40Z" fill="url(#fqShieldGlow)"/>
                <text x="75" y="65" textAnchor="middle" fontFamily="Cinzel,serif" fontSize="18" fontWeight="900" fill="rgba(240,200,80,.6)" letterSpacing="3">{'\u16B1 \u16CF \u16A6'}</text>
                <circle cx="75" cy="85" r="18" fill="none" stroke="rgba(240,200,80,.2)" strokeWidth="1.5"/>
                <circle cx="75" cy="85" r="14" fill="none" stroke="rgba(240,200,80,.15)" strokeWidth="1"/>
                <text x="75" y="92" textAnchor="middle" fontFamily="Cinzel,serif" fontSize="22" fontWeight="900" fill="#F0C850">
                  {claimingQuest ? TAB_RUNES[claimingQuest.type] || '\u16C9' : '\u16C9'}
                </text>
                <line x1="55" y1="40" x2="95" y2="40" stroke="rgba(240,200,80,.1)" strokeWidth="1"/>
                <line x1="75" y1="28" x2="75" y2="130" stroke="rgba(240,200,80,.08)" strokeWidth="1"/>
              </svg>
            </div>

            <div className="fq-modal-quest-name">{claimingQuest?.name || '-'}</div>
            <div className="fq-modal-lore">{claimingQuest?.lore || '-'}</div>
            <div className="fq-modal-reward-label">НАГРАДА</div>
            <div className="fq-modal-rewards">
              {claimingQuest?.rewardCoins > 0 && (
                <div className="fq-modal-rw-item"><span className="fq-mr-icon">{'\u269C'}</span> {claimingQuest.rewardCoins} монет</div>
              )}
              {claimingQuest?.rewardItem && (
                <div className="fq-modal-rw-item"><span className="fq-mr-icon">{'\uD83C\uDF81'}</span> {claimingQuest.rewardItem}</div>
              )}
            </div>
            <button className="fq-modal-claim-btn" onClick={confirmClaim}>ЗАБРАТЬ</button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   CSS — 1:1 from FIELD_QUESTS_RENDER.html
   ═══════════════════════════════════════════════════════════ */
const QUEST_CSS = `
/* Q10: Cinzel font loaded via index.html link — no @import FOUC */
@keyframes fq-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.fq{
  --fq-bg:#0b0e1a;--fq-card:#141828;--fq-card2:#1a2040;
  --fq-gold:#F0C850;--fq-gold-d:#C8940A;--fq-gold-l:#FFE17A;
  --fq-red:#E84057;--fq-blue:#4A90FF;--fq-purple:#A56EFF;--fq-green:#3DDC84;
  --fq-t1:#fff;--fq-t2:rgba(255,255,255,.7);--fq-t3:rgba(255,255,255,.4);
  --fq-daily:#22c55e;--fq-weekly:#3b82f6;--fq-monthly:#a855f7;--fq-seasonal:#8b5cf6;--fq-permanent:#f59e0b;
  --fq-rune:#b45309;
  position:relative;width:100%;height:100dvh;background:var(--fq-bg);color:var(--fq-t1);
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Round',system-ui,sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;overflow:hidden;
}
.fq-bg{position:fixed;inset:0;z-index:0;overflow:hidden}
.fq-bg-glow{position:absolute;border-radius:50%;filter:blur(80px);opacity:.25;transition:opacity 1s}
.fq-bg-glow.g1{width:300px;height:300px;top:-50px;left:-50px;background:var(--fq-blue)}
.fq-bg-glow.g2{width:250px;height:250px;bottom:-30px;right:-60px;background:var(--fq-purple)}
.fq-bg-glow.g3{width:200px;height:200px;top:40%;left:50%;transform:translateX(-50%);background:var(--fq-gold);opacity:.08}
.fq-stars{position:absolute;inset:0}.fq-s{position:absolute;background:#fff;border-radius:50%;animation:fq-tw 3s ease-in-out infinite alternate}
@keyframes fq-tw{0%{opacity:.1;transform:scale(.8)}100%{opacity:.5;transform:scale(1.3)}}
.fq-confetti{position:fixed;inset:0;z-index:250;pointer-events:none}
.fq-page{position:relative;z-index:5;display:flex;flex-direction:column;height:100dvh;max-width:430px;margin:0 auto;overflow:hidden}

/* Header */
.fq-header{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;
  padding-top:max(env(safe-area-inset-top),10px);flex-shrink:0;
  background:linear-gradient(180deg,rgba(11,14,26,.95),rgba(11,14,26,.7));backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);z-index:20;position:sticky;top:0}
.fq-hdr-back{width:36px;height:36px;border-radius:12px;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:background .2s}
.fq-hdr-back:active{background:rgba(255,255,255,.12)}
.fq-hdr-title{font-family:'Cinzel',serif;font-size:16px;font-weight:900;letter-spacing:.12em;color:var(--fq-gold);text-shadow:0 0 20px rgba(240,200,80,.2)}
.fq-hdr-counter{display:flex;align-items:center;gap:5px;padding:5px 12px;border-radius:20px;
  background:linear-gradient(135deg,rgba(232,64,87,.1),rgba(240,200,80,.08));border:1px solid rgba(232,64,87,.2);
  font-size:13px;font-weight:700;color:var(--fq-gold-l)}
.fq-fire{font-size:16px;filter:drop-shadow(0 0 4px rgba(255,120,0,.4))}

/* Tabs */
.fq-tabs{display:flex;gap:6px;padding:8px 16px;flex-shrink:0;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.fq-tabs::-webkit-scrollbar{display:none}
.fq-tab{display:flex;align-items:center;gap:5px;padding:8px 14px;border-radius:20px;font-size:13px;font-weight:700;
  cursor:pointer;white-space:nowrap;transition:all .3s cubic-bezier(.34,1.56,.64,1);position:relative;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);color:var(--fq-t3);flex-shrink:0}
.fq-tab-icon{font-size:15px}
.fq-tab-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;border-radius:9px;
  font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 5px;
  background:var(--fq-red);color:#fff;box-shadow:0 2px 6px rgba(232,64,87,.4);animation:fq-badgePulse 2s ease-in-out infinite}
@keyframes fq-badgePulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}
.fq-tab.active{transform:scale(1.05);box-shadow:0 4px 16px rgba(0,0,0,.3)}
.fq-tab.active.daily{background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.3);color:var(--fq-daily)}
.fq-tab.active.weekly{background:rgba(59,130,246,.15);border-color:rgba(59,130,246,.3);color:var(--fq-weekly)}
.fq-tab.active.seasonal{background:rgba(139,92,246,.15);border-color:rgba(139,92,246,.3);color:var(--fq-seasonal)}
.fq-tab.active.monthly{background:rgba(168,85,247,.15);border-color:rgba(168,85,247,.3);color:var(--fq-monthly)}
.fq-tab.active.permanent{background:rgba(245,158,11,.15);border-color:rgba(245,158,11,.3);color:var(--fq-permanent)}

/* Ribbon */
.fq-ribbon{margin:0 16px 6px;padding:12px 14px;border-radius:16px;background:var(--fq-card);border:1px solid rgba(255,255,255,.04);flex-shrink:0}
.fq-ribbon-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.fq-ribbon-label{font-size:12px;color:var(--fq-t2);font-weight:600}
.fq-ribbon-val{font-size:13px;font-weight:800}
.fq-ribbon-dots{display:flex;gap:4px;flex:1;max-width:140px}
.fq-ribbon-dot{flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,.06);transition:background .4s;position:relative}
.fq-ribbon-dot.on::after{content:'';position:absolute;top:1px;left:2px;right:2px;height:3px;border-radius:2px;background:rgba(255,255,255,.25)}
.fq-ribbon-dot.on.daily{background:linear-gradient(90deg,#16a34a,var(--fq-daily))}
.fq-ribbon-dot.on.weekly{background:linear-gradient(90deg,#2563eb,var(--fq-weekly))}
.fq-ribbon-dot.on.monthly{background:linear-gradient(90deg,#7c3aed,var(--fq-monthly))}
.fq-ribbon-streak{display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.04)}
.fq-streak-fire{font-size:18px;filter:drop-shadow(0 0 6px rgba(255,120,0,.5));animation:fq-flame .8s ease-in-out infinite alternate}
@keyframes fq-flame{0%{transform:scale(1) rotate(-3deg)}100%{transform:scale(1.1) rotate(3deg)}}
.fq-streak-txt{font-size:12px;font-weight:700;color:var(--fq-t2)}
.fq-streak-txt b{color:var(--fq-gold)}
.fq-ribbon-bonus{display:flex;align-items:center;gap:6px;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.04)}
.fq-bonus-icon{font-size:16px}.fq-bonus-txt{font-size:12px;font-weight:600;color:var(--fq-t2)}
.fq-bonus-val{font-size:13px;font-weight:800;color:var(--fq-gold);margin-left:auto}

/* Quest list */
.fq-quest-list{flex:1;overflow-y:auto;overflow-x:hidden;padding:6px 16px 20px;-webkit-overflow-scrolling:touch;scroll-behavior:smooth}
.fq-quest-list::-webkit-scrollbar{width:3px}.fq-quest-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px}

/* Quest card */
.fq-quest-card{background:var(--fq-card);border-radius:18px;padding:14px;margin-bottom:10px;
  border:1px solid rgba(255,255,255,.04);box-shadow:0 4px 16px rgba(0,0,0,.2);position:relative;overflow:hidden;
  transition:all .4s cubic-bezier(.34,1.56,.64,1);opacity:0;transform:translateY(20px) scale(.97)}
.fq-quest-card.visible{opacity:1;transform:translateY(0) scale(1)}
.fq-quest-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:4px 0 0 4px;transition:background .3s}
.fq-quest-card.daily::before{background:var(--fq-daily)}
.fq-quest-card.weekly::before{background:var(--fq-weekly)}
.fq-quest-card.seasonal::before{background:var(--fq-seasonal)}
.fq-quest-card.monthly::before{background:var(--fq-monthly)}
.fq-quest-card.permanent::before{background:var(--fq-permanent)}
.fq-quest-card.state-ready{border-color:rgba(240,200,80,.3);box-shadow:0 4px 16px rgba(0,0,0,.2),0 0 20px rgba(240,200,80,.12);animation:fq-goldGlow 2.5s ease-in-out infinite}
@keyframes fq-goldGlow{0%,100%{box-shadow:0 4px 16px rgba(0,0,0,.2),0 0 15px rgba(240,200,80,.08)}50%{box-shadow:0 4px 16px rgba(0,0,0,.2),0 0 30px rgba(240,200,80,.2)}}
.fq-quest-card.state-ready::before{background:var(--fq-gold)!important}
.fq-quest-card.state-claimed{opacity:.5;filter:saturate(.3)}
.fq-quest-card.state-claimed::before{background:rgba(255,255,255,.15)!important}
.fq-quest-card.state-locked{opacity:.35;filter:saturate(.1);pointer-events:none}
.fq-quest-card.state-locked::before{background:rgba(255,255,255,.08)!important}

.fq-rune-accent{position:absolute;font-size:48px;color:rgba(180,83,9,.06);font-family:'Cinzel',serif;pointer-events:none;z-index:0}
.fq-rune-accent.r1{bottom:4px;right:10px}

/* Top row */
.fq-qc-top{display:flex;align-items:flex-start;gap:10px;margin-bottom:8px}
.fq-qc-pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:700;flex-shrink:0}
.fq-qc-pill.daily{background:rgba(34,197,94,.12);color:var(--fq-daily);border:1px solid rgba(34,197,94,.2)}
.fq-qc-pill.weekly{background:rgba(59,130,246,.12);color:var(--fq-weekly);border:1px solid rgba(59,130,246,.2)}
.fq-qc-pill.seasonal{background:rgba(139,92,246,.12);color:var(--fq-seasonal);border:1px solid rgba(139,92,246,.2)}
.fq-qc-pill.monthly{background:rgba(168,85,247,.12);color:var(--fq-monthly);border:1px solid rgba(168,85,247,.2)}
.fq-qc-pill.permanent{background:rgba(245,158,11,.12);color:var(--fq-permanent);border:1px solid rgba(245,158,11,.2)}
.fq-qc-status{margin-left:auto;font-size:11px;font-weight:700;display:flex;align-items:center;gap:4px}
.fq-qc-status.ready{color:var(--fq-gold);animation:fq-statusPulse 1.5s ease-in-out infinite}
@keyframes fq-statusPulse{0%,100%{opacity:.7}50%{opacity:1}}
.fq-qc-status.claimed{color:var(--fq-t3)}
.fq-qc-status.locked{color:var(--fq-t3)}

.fq-qc-icon{font-size:22px;flex-shrink:0}
.fq-qc-info{flex:1;min-width:0}
.fq-qc-name{font-size:15px;font-weight:800;margin-bottom:2px;line-height:1.3}
.fq-qc-desc{font-size:12px;color:var(--fq-t2);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

/* Progress */
.fq-qc-progress{margin:10px 0 8px;position:relative}
.fq-qc-bar-counter{position:absolute;right:0;top:-18px;font-size:11px;font-weight:700;color:var(--fq-t2)}
.fq-bar-track{height:10px;border-radius:5px;background:rgba(255,255,255,.06);overflow:hidden;box-shadow:inset 0 2px 4px rgba(0,0,0,.2)}
.fq-bar-fill{height:100%;border-radius:5px;position:relative;min-width:0}
.fq-bar-fill::after{content:'';position:absolute;top:1px;left:4px;right:4px;height:4px;border-radius:3px;background:rgba(255,255,255,.25)}
.fq-bar-fill.daily{background:linear-gradient(90deg,#16a34a,var(--fq-daily),#4ade80)}
.fq-bar-fill.weekly{background:linear-gradient(90deg,#2563eb,var(--fq-weekly),#60a5fa)}
.fq-bar-fill.seasonal{background:linear-gradient(90deg,#7c3aed,var(--fq-seasonal),#a78bfa)}
.fq-bar-fill.monthly{background:linear-gradient(90deg,#7c3aed,var(--fq-monthly),#c084fc)}
.fq-bar-fill.permanent{background:linear-gradient(90deg,#d97706,var(--fq-permanent),#fbbf24)}
.fq-bar-fill.ready{background:linear-gradient(90deg,var(--fq-gold-d),var(--fq-gold),var(--fq-gold-l))!important}

/* Footer */
.fq-qc-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.fq-qc-rewards{display:flex;align-items:center;gap:8px}
.fq-qc-reward{display:flex;align-items:center;gap:3px;padding:3px 8px;border-radius:8px;background:rgba(255,255,255,.04);font-size:12px;font-weight:700}
.fq-rw-icon{font-size:14px}.fq-rw-val{color:var(--fq-gold-l)}
.fq-qc-timer{font-size:11px;font-weight:600;color:var(--fq-t3);display:flex;align-items:center;gap:4px}
.fq-timer-icon{font-size:12px}

/* Claim button */
.fq-qc-claim{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:11px;
  border-radius:12px;border:none;font-size:14px;font-weight:800;color:#fff;cursor:pointer;
  margin-top:10px;position:relative;overflow:hidden;
  background:linear-gradient(135deg,var(--fq-gold-d),var(--fq-gold),var(--fq-gold-l));
  box-shadow:0 4px 0 #8B6914,0 6px 16px rgba(240,200,80,.25);animation:fq-claimPulse 2s ease-in-out infinite;transition:all .1s}
.fq-qc-claim:active{transform:translateY(3px);box-shadow:0 1px 0 #8B6914}
@keyframes fq-claimPulse{0%,100%{box-shadow:0 4px 0 #8B6914,0 6px 16px rgba(240,200,80,.2)}50%{box-shadow:0 4px 0 #8B6914,0 6px 28px rgba(240,200,80,.4)}}
.fq-qc-claim::after{content:'';position:absolute;top:0;left:-100%;width:40%;height:100%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);animation:fq-claimShine 2.5s infinite}
@keyframes fq-claimShine{0%,100%{left:-100%}50%{left:150%}}
.fq-claim-rune{font-family:'Cinzel',serif;font-size:16px}

/* Lore expand */
.fq-qc-expand{display:flex;align-items:center;gap:4px;margin-top:8px;font-size:11px;color:var(--fq-t3);cursor:pointer;font-weight:600;transition:color .2s}
.fq-qc-expand:active{color:var(--fq-t2)}
.fq-arrow{transition:transform .3s;display:inline-block}
.fq-qc-expand.open .fq-arrow{transform:rotate(180deg)}
.fq-qc-lore{max-height:0;overflow:hidden;transition:max-height .4s cubic-bezier(.4,0,.2,1);font-size:12px;color:var(--fq-t3);line-height:1.5;font-style:italic}
.fq-qc-lore.open{max-height:200px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.04)}

/* Danger toast */
.fq-danger-toast{position:fixed;top:80px;left:50%;transform:translateX(-50%) translateY(-120px);z-index:300;
  padding:10px 20px;border-radius:14px;background:linear-gradient(135deg,rgba(232,64,87,.9),rgba(200,40,60,.95));
  border:1px solid rgba(255,100,120,.3);box-shadow:0 8px 30px rgba(232,64,87,.4);
  font-size:13px;font-weight:700;color:#fff;white-space:nowrap;transition:transform .5s cubic-bezier(.34,1.56,.64,1);backdrop-filter:blur(8px)}
.fq-danger-toast.show{transform:translateX(-50%) translateY(0)}
.fq-dt-fire{animation:fq-flame .5s ease-in-out infinite alternate}

/* Empty */
.fq-empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 30px;text-align:center;opacity:0;animation:fq-fadeUp .5s .2s forwards}
@keyframes fq-fadeUp{to{opacity:1;transform:translateY(0)}}
.fq-empty-rune{font-size:80px;color:rgba(255,255,255,.06);margin-bottom:16px;font-family:'Cinzel',serif;animation:fq-runeFloat 4s ease-in-out infinite}
@keyframes fq-runeFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.fq-empty-title{font-size:16px;font-weight:700;color:var(--fq-t2);margin-bottom:8px}
.fq-empty-sub{font-size:13px;color:var(--fq-t3);line-height:1.4}

/* Modal */
.fq-modal-overlay{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0);pointer-events:none;transition:background .4s}
.fq-modal-overlay.on{background:rgba(0,0,0,.75);pointer-events:auto;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.fq-modal-popup{position:fixed;left:50%;bottom:0;width:100%;max-width:430px;transform:translate(-50%,110%);z-index:201;
  transition:transform .6s cubic-bezier(.34,1.56,.64,1)}
.fq-modal-popup.on{transform:translate(-50%,0)}
.fq-modal-card{background:linear-gradient(180deg,var(--fq-card2),var(--fq-card));border-radius:28px 28px 0 0;
  border:1px solid rgba(255,255,255,.08);border-bottom:none;padding:20px 24px;
  padding-bottom:max(env(safe-area-inset-bottom),28px);box-shadow:0 -10px 50px rgba(0,0,0,.5);text-align:center;position:relative;overflow:hidden}
.fq-modal-handle{width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,.12);margin:0 auto 16px}
.fq-modal-swords{font-family:'Cinzel',serif;font-size:14px;color:var(--fq-gold);letter-spacing:.15em;margin-bottom:12px;text-shadow:0 0 12px rgba(240,200,80,.3)}
.fq-modal-shield{width:150px;height:150px;margin:0 auto 16px;position:relative}
.fq-shield-glow{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:180px;height:180px;border-radius:50%;
  background:radial-gradient(circle,rgba(240,200,80,.2),transparent 70%);animation:fq-shieldGlow 2s ease-in-out infinite;pointer-events:none}
@keyframes fq-shieldGlow{0%,100%{opacity:.5;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}}
.fq-modal-quest-name{font-family:'Cinzel',serif;font-size:20px;font-weight:900;color:var(--fq-gold);margin-bottom:8px;text-shadow:0 0 16px rgba(240,200,80,.2)}
.fq-modal-lore{font-size:13px;color:var(--fq-t2);line-height:1.5;font-style:italic;margin-bottom:16px;max-width:300px;margin-left:auto;margin-right:auto}
.fq-modal-reward-label{font-size:10px;font-weight:700;color:var(--fq-t3);letter-spacing:.15em;text-transform:uppercase;margin-bottom:8px}
.fq-modal-rewards{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:20px;flex-wrap:wrap}
.fq-modal-rw-item{display:flex;align-items:center;gap:6px;padding:8px 16px;border-radius:12px;
  background:rgba(240,200,80,.08);border:1px solid rgba(240,200,80,.15);font-size:16px;font-weight:700;color:var(--fq-gold-l)}
.fq-mr-icon{font-size:20px}
.fq-modal-claim-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:16px;border-radius:16px;border:none;
  font-family:'Cinzel',serif;font-size:16px;font-weight:900;color:#1a1000;cursor:pointer;position:relative;overflow:hidden;
  background:linear-gradient(135deg,var(--fq-gold-d),var(--fq-gold),var(--fq-gold-l));
  box-shadow:0 5px 0 #8B6914,0 8px 24px rgba(240,200,80,.3);transition:all .1s}
.fq-modal-claim-btn:active{transform:translateY(4px);box-shadow:0 1px 0 #8B6914}
.fq-modal-claim-btn::after{content:'';position:absolute;top:0;left:-100%;width:50%;height:100%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent);animation:fq-claimShine 3s infinite}
.fq-modal-rune-l,.fq-modal-rune-r{position:absolute;font-size:64px;color:rgba(180,83,9,.05);font-family:'Cinzel',serif;pointer-events:none}
.fq-modal-rune-l{top:20px;left:10px}.fq-modal-rune-r{bottom:40px;right:10px}

/* Night mode */
.fq.night .fq-bg-glow{opacity:.12!important}
.fq.night .fq-bg-glow.g3{opacity:.04!important}
`;
