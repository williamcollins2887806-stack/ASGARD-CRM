import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldAuthStore } from '@/stores/fieldAuthStore';
import '@/styles/field-auth.css';

const QUOTES = [
  'Работай так, как будто рядом стоит Один',
  'Сегодня ты — воин. Завтра — легенда',
  'В Вальхаллу забирают не по силе, а по делам',
  'Один кузнец выковал молот. Бригада куёт империю',
  'Сильный не тот, кто работает много. А тот, кто работает честно',
  'Твоё имя останется в сагах асгардцев',
  'Нет стали без огня. Нет воина без работы',
  'Валькирии наблюдают за каждой твоей сменой',
  'Асгард строят те, кто не боится мороза и высоты',
  'Каждый чек-ин приближает тебя к Вальхалле',
];

function playHammerStrike() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(120, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.1);
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.3);
    setTimeout(() => ctx.close(), 500);
  } catch (_) {}
}

// Valknut SVG — 3 interlocked triangles of Odin
function ValknutLogo({ size = 120 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="fa-logo">
      <defs>
        <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F5D070" />
          <stop offset="50%" stopColor="#D4A843" />
          <stop offset="100%" stopColor="#8B7030" />
        </linearGradient>
        <filter id="goldGlow">
          <feGaussianBlur stdDeviation="2" result="glow" />
          <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g fill="none" stroke="url(#goldGrad)" strokeWidth="2.5" strokeLinejoin="round" filter="url(#goldGlow)">
        {/* Triangle 1 — top */}
        <path d="M50 10 L30 45 L50 35 L70 45 Z" />
        {/* Triangle 2 — bottom-left */}
        <path d="M25 80 L20 45 L40 55 L45 80 Z" />
        {/* Triangle 3 — bottom-right */}
        <path d="M75 80 L55 80 L60 55 L80 45 Z" />
        {/* Interlocking lines */}
        <path d="M50 35 L40 55" strokeWidth="2" />
        <path d="M50 35 L60 55" strokeWidth="2" />
        <path d="M40 55 L45 80" strokeWidth="2" />
        <path d="M60 55 L55 80" strokeWidth="2" />
        {/* Inner ring */}
        <circle cx="50" cy="50" r="8" strokeWidth="1.5" opacity="0.5" />
      </g>
    </svg>
  );
}

// Animated stars background
function Stars() {
  const stars = useRef(
    Array.from({ length: 40 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 0.5,
      delay: Math.random() * 4,
      duration: 2 + Math.random() * 3,
    }))
  ).current;

  return (
    <div className="fa-stars">
      {stars.map((s, i) => (
        <div
          key={i}
          className="fa-star"
          style={{
            left: s.x + '%', top: s.y + '%',
            width: s.size + 'px', height: s.size + 'px',
            animationDelay: s.delay + 's',
            animationDuration: s.duration + 's',
          }}
        />
      ))}
    </div>
  );
}

export default function FieldWelcome() {
  const navigate = useNavigate();
  const { token, status } = useFieldAuthStore();
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  const [typedQuote, setTypedQuote] = useState('');
  const [showContent, setShowContent] = useState(false);
  const [showButton, setShowButton] = useState(false);

  // If already authenticated → home
  useEffect(() => {
    if (token && status === 'authenticated') {
      navigate('/field/home', { replace: true });
    }
  }, [token, status, navigate]);

  // Typewriter effect
  useEffect(() => {
    const timer1 = setTimeout(() => setShowContent(true), 400);
    const timer2 = setTimeout(() => {
      let i = 0;
      const interval = setInterval(() => {
        setTypedQuote(quote.slice(0, i + 1));
        i++;
        if (i >= quote.length) clearInterval(interval);
      }, 45);
      return () => clearInterval(interval);
    }, 1200);
    const timer3 = setTimeout(() => setShowButton(true), 2200);
    return () => { clearTimeout(timer1); clearTimeout(timer2); clearTimeout(timer3); };
  }, [quote]);

  const handleEnter = () => {
    playHammerStrike();
    if (navigator.vibrate) navigator.vibrate(50);
    navigate('/field-login');
  };

  return (
    <div className="fa-welcome">
      <Stars />

      {/* Corner runes */}
      <span className="fa-rune fa-rune-tl">ᚠ</span>
      <span className="fa-rune fa-rune-tr">ᚱ</span>
      <span className="fa-rune fa-rune-bl">ᚦ</span>
      <span className="fa-rune fa-rune-br">ᛟ</span>

      <div className={`fa-welcome-content ${showContent ? 'fa-visible' : ''}`}>
        <ValknutLogo size={120} />

        <h1 className="fa-title">ASGARD</h1>
        <p className="fa-subtitle">Полевая служба</p>

        <p className="fa-quote">
          &laquo;{typedQuote}<span className="fa-cursor">|</span>&raquo;
        </p>
      </div>

      <div className={`fa-welcome-bottom ${showButton ? 'fa-visible' : ''}`}>
        <button className="fa-btn-gold" onClick={handleEnter}>
          ⚔ Войти в Асгард
        </button>

        <p className="fa-footer">ASGARD Service v1.0 &middot; Мир асгардцев</p>
      </div>
    </div>
  );
}
