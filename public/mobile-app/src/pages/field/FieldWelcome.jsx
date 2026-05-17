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

function AsgardLogo({ size = 140 }) {
  return (
    <div
      className="fa-logo"
      style={{
        width: size,
        filter: 'drop-shadow(0 0 24px rgba(200,41,59,0.35)) drop-shadow(0 0 48px rgba(30,77,140,0.25))',
      }}
    >
      <img
        src="/asgard-logo.png"
        alt="ASGARD CRM"
        draggable={false}
        style={{ width: '100%', height: 'auto', userSelect: 'none' }}
      />
    </div>
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
        <AsgardLogo size={140} />

        <p className="fa-subtitle" style={{ marginTop: 8 }}>Полевая служба</p>

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
