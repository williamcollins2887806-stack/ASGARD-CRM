import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * AppSplash — заставка при открытии мобильного приложения.
 *
 * Заказчик (21.10.2026): «интерактив, а не сухое открытие», «уровень Сбера и
 * Яндекса». Ориентир взят у них же: пока грузится — крутятся КОРОТКИЕ ФРАЗЫ,
 * а сцена держит внимание и не выглядит пустым ожиданием.
 *
 * Что здесь делает уровень:
 *  • В ЦЕНТРЕ — НАСТОЯЩИЙ ЛОГОТИП ASGARD (/m/asgard-logo.png), а не выдуманный
 *    символ. Заставка обязана показывать бренд, а не фантазию дизайнера.
 *    Логотип-растр: показываем ~140 px (downscale с 566 px прячет пиксельные
 *    края исходника), под ним мягкое золотое свечение.
 *  • ФРАЗЫ как у Сбера/Яндекса: сменяются каждые ~1.8 с, плавный fade;
 *    первая — сразу. Если загрузка долгая, фразы идут по кругу.
 *  • ХОРЕОГРАФИЯ по стадиям: свет → логотип → название → фраза + прогресс.
 *  • СДЕРЖАННОСТЬ: один световой слой, одно тонкое кольцо, немного искр
 *    по краям. Никаких четырёх концентрических слоёв — взгляд держится за
 *    логотип и текст.
 *
 * Технически: всё на transform/opacity (GPU), сцена в бандле (видна мгновенно),
 * тап пропускает, prefers-reduced-motion уважается, запросов и токенов нет.
 */

/** Минимум показа (мс): первый девиз успевает прочитаться целиком. */
const MIN_MS = 1900;
/** Максимум показа (мс): дальше уступаем даже при плохой сети. */
const MAX_MS = 3600;
/** Как часто меняется фраза (мс). */
const QUOTE_MS = 1900;

/**
 * Короткие изречения в духе северных воинов: про путь, терпение и ожидание.
 * Тон — спокойная уверенность, без пафоса. Оборачиваются в «ёлочки», как в
 * интерфейсах Сбера и Яндекса: цитата узнаётся по кавычкам.
 */
const QUOTES = [
  'Терпение воина дороже похвал',
  'Хугин и Мунин уже в пути',
  'Сила — в спокойствии',
  'Медленно точится меч, быстро — слава',
  'Путь начинается с тишины',
  'Кто ждёт достойно, тот увидит зал',
];

export function AppSplash({ ready = false }) {
  const [hidden, setHidden] = useState(false);
  const [fading, setFading] = useState(false);
  const [pct, setPct] = useState(0);
  const [stage, setStage] = useState(0);       // 0..3 — хореография
  const [qi, setQi] = useState(0);             // индекс фразы
  const [pressed, setPressed] = useState(false);
  const mountedAt = useRef(Date.now());
  const doneRef = useRef(false);

  const reduceMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Закрывает заставку один раз: fade → размонтирование. */
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setFading(true);
    window.setTimeout(() => setHidden(true), 480);
  }, []);

  // ── Хореография: слои включаются по очереди, а не разом ──
  useEffect(() => {
    if (reduceMotion) { setStage(3); setPct(100); return undefined; }
    const timers = [
      window.setTimeout(() => setStage(1), 110),   // логотип
      window.setTimeout(() => setStage(2), 560),   // название
      window.setTimeout(() => setStage(3), 760),   // фраза + прогресс (скорее: её надо успеть прочесть)
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [reduceMotion]);

  // ── Фразы: смена каждые QUOTE_MS, по кругу ──
  useEffect(() => {
    if (reduceMotion) return undefined;
    const t = window.setInterval(() => {
      setQi((i) => (i + 1) % QUOTES.length);
    }, QUOTE_MS);
    return () => window.clearInterval(t);
  }, [reduceMotion]);

  // ── Прогресс: честный — быстрый старт, ожидание сети в конце ──
  useEffect(() => {
    if (reduceMotion) return undefined;
    let raf = 0;
    let value = 0;
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const target = elapsed < 900
        ? (elapsed / 900) * 80
        : Math.min(96, 80 + ((elapsed - 900) / 2800) * 16);
      value = Math.max(value, target);
      setPct(Math.round(value));
      if (!doneRef.current) raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [reduceMotion]);

  // ── Готовность + ограничители MIN/MAX ──
  useEffect(() => {
    if (reduceMotion) { finish(); return undefined; }
    const elapsed = Date.now() - mountedAt.current;
    let minTimer = 0;
    if (ready) {
      minTimer = window.setTimeout(() => { setPct(100); finish(); }, Math.max(0, MIN_MS - elapsed));
    }
    const maxTimer = window.setTimeout(() => { setPct(100); finish(); }, Math.max(0, MAX_MS - elapsed));
    return () => { window.clearTimeout(minTimer); window.clearTimeout(maxTimer); };
  }, [ready, finish, reduceMotion]);

  const skip = useCallback(() => {
    if (doneRef.current) return;
    setPct(100);
    finish();
  }, [finish]);

  // Под заставкой страница не скроллится.
  useEffect(() => {
    if (hidden) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [hidden]);

  if (hidden) return null;

  const at = (s) => stage >= s;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="ASGARD CRM загружается"
      onPointerDown={() => setPressed(true)}
      onPointerUp={skip}
      onPointerCancel={() => setPressed(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        // Светлая и тёмная сцены. Раньше фон был ТОЛЬКО тёмный, и в светлой теме
        // заставка выглядела чужеродно (жалоба 22.10.2026). Класс темы вешает
        // themeStore на <html> (`.light`) ДО монтирования React, поэтому переменная
        // уже верна на первом кадре.
        background: 'var(--splash-bg)',
        opacity: fading ? 0 : 1,
        transform: fading ? 'scale(1.04)' : 'scale(1)',
        transition: 'opacity 480ms cubic-bezier(0.4,0,0.2,1), transform 480ms cubic-bezier(0.4,0,0.2,1)',
        willChange: 'opacity, transform',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        // БЕЗ overflow:hidden и без height: элемент занимает ровно вьюпорт
        // (position: fixed; inset: 0). Обрезка содержимого тут не нужна и мешала
        // «прыжкам»: при смене высоты вьюпорта контент пересчитывался.
      }}
    >
      <style>{`
        /* ── Сцены заставки: тёмная и светлая ───────────────────────────────
           Переменные читаются из класса темы на <html>, который ставит themeStore.
           Тёмная: глубокая синева с золотом. Светлая: тёплый перламутр с золотом —
           заставка должна продолжать тему, а не спорить с ней. */
        :root {
          --splash-bg: radial-gradient(ellipse 130% 90% at 50% -12%, #17213f 0%, #0a0e1c 44%, #04050a 100%);
          --splash-title-a: #a08030;
          --splash-title-b: #c8a84e;
          --splash-title-hi: #FFF9E4;
          --splash-sub: rgba(214,224,240,0.50);
          --splash-quote: rgba(230,237,248,0.82);
          --splash-quote-shadow: 0 1px 12px rgba(0,0,0,0.55);
          --splash-track: rgba(214,224,240,0.09);
          --splash-bar: rgba(214,224,240,0.36);
          --splash-hint: rgba(214,224,240,0.22);
          --splash-glow: rgba(255,236,180,0.30);
          --splash-logo-glow: rgba(200,168,78,0.30);
        }
        html.light {
          /* Светлая сцена: почти белый с тёплым оттенком и золотым ореолом.
             Тексты — тёмные, иначе на светлом фоне их не видно. */
          --splash-bg: radial-gradient(ellipse 130% 90% at 50% -12%, #FFFFFF 0%, #F7F4EC 42%, #EFEAE0 100%);
          --splash-title-a: #8A5E0B;
          --splash-title-b: #B8860B;
          --splash-title-hi: #FFF6D8;
          --splash-sub: rgba(60,60,67,0.62);
          --splash-quote: rgba(40,42,50,0.86);
          --splash-quote-shadow: 0 1px 0 rgba(255,255,255,0.7);
          --splash-track: rgba(60,60,67,0.12);
          --splash-bar: rgba(90,90,100,0.55);
          --splash-hint: rgba(60,60,67,0.34);
          --splash-glow: rgba(200,168,78,0.34);
          --splash-logo-glow: rgba(160,120,30,0.26);
        }
        @keyframes sx-orb {
          0%,100% { transform: translate3d(0,0,0) scale(1); }
          33%     { transform: translate3d(16px,-12px,0) scale(1.08); }
          66%     { transform: translate3d(-12px,9px,0) scale(.94); }
        }
        @keyframes sx-core {
          0%,100% { opacity:.50; transform: scale(1); }
          50%     { opacity:.88; transform: scale(1.09); }
        }
        @keyframes sx-ringSpin { to { transform: rotate(360deg); } }
        @keyframes sx-float {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-6px); }
        }
        @keyframes sx-sparkRise {
          0%   { transform: translate3d(0,14px,0) scale(.7); opacity:0; }
          24%  { opacity:.75; }
          76%  { opacity:.28; }
          100% { transform: translate3d(0,-58px,0) scale(1); opacity:0; }
        }
        @keyframes sx-quoteIn {
          from { opacity: 0; transform: translateY(7px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes sx-lineSweep {
          0%   { transform: translate3d(-140px,0,0); }
          100% { transform: translate3d(250px,0,0); }
        }
        /* Блик проходит по силуэту знака — анимация внутри SVG (SMIL),
           здесь только мягкое золотое свечение под знаком. */
      `}</style>

      {/* ── Свет: два больших мягких источника + один тёплый ── */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{
          position: 'absolute', width: 400, height: 400, top: '-18%', left: '-20%', borderRadius: '50%',
          background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-blue, #1E4D8C) 52%, transparent), transparent 68%)',
          filter: 'blur(56px)', animation: reduceMotion ? 'none' : 'sx-orb 15s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', width: 330, height: 330, bottom: '-4%', right: '-18%', borderRadius: '50%',
          background: 'radial-gradient(circle, color-mix(in srgb, var(--brand-red, #C8293B) 38%, transparent), transparent 68%)',
          filter: 'blur(56px)', animation: reduceMotion ? 'none' : 'sx-orb 18s ease-in-out -6s infinite',
        }} />
        <div style={{
          position: 'absolute', width: 420, height: 300, top: '30%', left: '18%', borderRadius: '50%',
          background: 'radial-gradient(circle, color-mix(in srgb, var(--gold, #c8a84e) 22%, transparent), transparent 70%)',
          filter: 'blur(60px)', animation: reduceMotion ? 'none' : 'sx-orb 20s ease-in-out -10s infinite',
        }} />
      </div>

      {/* ── Искры по краям (не поверх логотипа) ── */}
      {!reduceMotion && (
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {Array.from({ length: 14 }).map((_, i) => {
            const left = i % 2 === 0
              ? 4 + ((i * 11) % 16)          // левая треть
              : 80 + ((i * 7) % 16);         // правая треть
            const size = 1.5 + (i % 3) * 0.8;
            return (
              <span key={i} style={{
                position: 'absolute',
                left: `${left}%`,
                bottom: `${6 + ((i * 29) % 46)}%`,
                width: size, height: size, borderRadius: '50%',
                background: i % 3 === 0 ? '#F2E2A8' : (i % 3 === 1 ? '#C8A84E' : '#FFFFFF'),
                boxShadow: `0 0 ${4 + (i % 3) * 3}px rgba(206,168,74,.85)`,
                animation: `sx-sparkRise ${5.5 + (i % 5) * 1.5}s ease-in-out ${(i % 7) * 0.8}s infinite`,
              }} />
            );
          })}
        </div>
      )}

      {/* ── ЛОГОТИП: настоящий знак ASGARD ── */}
      <div style={{
        position: 'relative', display: 'grid', placeItems: 'center',
        opacity: at(1) ? 1 : 0,
        transform: `scale(${pressed ? 0.97 : (at(1) ? 1 : 0.90)})`,
        transition: 'opacity 720ms ease-out, transform 900ms cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        {/* Свечение под логотипом */}
        <div aria-hidden="true" style={{
          position: 'absolute', width: 208, height: 208, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,236,180,0.30) 0%, color-mix(in srgb, var(--gold, #c8a84e) 30%, transparent) 40%, transparent 70%)',
          filter: 'blur(22px)',
          animation: reduceMotion ? 'none' : 'sx-core 3.8s ease-in-out infinite',
        }} />

        {/* Тонкое кольцо — единственное, держит композицию */}
        <svg aria-hidden="true" width="216" height="216" viewBox="0 0 216 216"
          style={{
            position: 'absolute',
            opacity: at(1) ? 0.75 : 0,
            transition: 'opacity 1000ms ease-out',
            animation: reduceMotion ? 'none' : 'sx-ringSpin 90s linear infinite',
          }}>
          <circle cx="108" cy="108" r="99" fill="none" stroke="color-mix(in srgb, var(--gold, #c8a84e) 26%, transparent)" strokeWidth="0.7" />
          <circle cx="108" cy="108" r="90" fill="none" stroke="color-mix(in srgb, var(--gold, #c8a84e) 16%, transparent)" strokeWidth="0.6"
            strokeDasharray="2 7" />
        </svg>

        {/* Сам логотип — РАСТР. Заказчик 21.10.2026: растр смотрится лучше
            трассированного вектора (у вектора терялись объём и мягкие края).
            Показываем 150px — downscale с 566px гасит пиксельные края исходника. */}
        <img
          src={`${import.meta.env.BASE_URL}asgard-logo.png`}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{
            position: 'relative',
            width: 150,
            height: 'auto',
            filter: 'drop-shadow(0 6px 20px rgba(0,0,0,0.55)) drop-shadow(0 0 24px rgba(200,168,78,0.30))',
            animation: reduceMotion ? 'none' : 'sx-float 5.5s ease-in-out infinite',
          }}
        />
      </div>

      {/* ── НАЗВАНИЕ ── */}
      <div style={{
        marginTop: 26, textAlign: 'center',
        opacity: at(2) ? 1 : 0,
        transform: `translateY(${at(2) ? 0 : 10}px)`,
        transition: 'opacity 760ms ease-out, transform 760ms cubic-bezier(0.22,1,0.36,1)',
      }}>
        <div style={{
          fontSize: 30, fontWeight: 800, letterSpacing: 11, paddingLeft: 11, lineHeight: 1,
          backgroundImage: `linear-gradient(100deg, var(--splash-title-a) 0%, var(--splash-title-b) 26%, var(--splash-title-hi) 46%, var(--splash-title-b) 62%, var(--splash-title-a) 84%, #6B4909 100%)`,
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
          WebkitTextFillColor: 'transparent',
          filter: 'drop-shadow(0 1px 0 rgba(0,0,0,.5))',
        }}>АСГАРД</div>

        <div style={{
          marginTop: 9, fontSize: 9.5, letterSpacing: 5, paddingLeft: 5,
          color: 'var(--splash-sub)', textTransform: 'uppercase', fontWeight: 600,
        }}>Система управления</div>
      </div>

      {/* ── ДЕВИЗ (как у Сбера и Яндекса: коротко, в кавычках, сменяется) ── */}
      <div style={{
        marginTop: 30, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: at(3) ? 1 : 0,
        transition: 'opacity 700ms ease-out',
        paddingInline: 26,
      }}>
        <span
          key={qi}
          style={{
            fontSize: 14.5, letterSpacing: 0.2, textAlign: 'center', fontStyle: 'italic',
            color: 'var(--splash-quote)',
            textShadow: 'var(--splash-quote-shadow)',
            animation: reduceMotion ? 'none' : 'sx-quoteIn 620ms cubic-bezier(0.22,1,0.36,1) both',
          }}
        >«{QUOTES[qi]}»</span>
      </div>

      {/* ── ПРОГРЕСС: линия с золотым бегущим бликом ── */}
      <div style={{
        position: 'absolute', left: 0, right: 0,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 44px)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 11,
        opacity: at(3) ? 1 : 0, transition: 'opacity 700ms ease-out',
      }}>
        <div style={{
          position: 'relative', width: 180, height: 2.5, borderRadius: 999,
          background: 'var(--splash-track)', overflow: 'hidden',
        }}>
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 999,
            background: 'linear-gradient(90deg, var(--splash-title-a), var(--splash-title-b) 45%, var(--splash-title-hi))',
            boxShadow: '0 0 12px color-mix(in srgb, var(--splash-title-b) 65%, transparent)',
            transition: 'width 320ms cubic-bezier(0.4,0,0.2,1)',
          }} />
          {!reduceMotion && (
            <div style={{
              position: 'absolute', top: -10, left: 0, width: 52, height: 22,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent)',
              animation: 'sx-lineSweep 2.8s ease-in-out infinite',
            }} />
          )}
        </div>

        <div style={{
          fontSize: 10, letterSpacing: 2, paddingLeft: 2,
          color: 'var(--splash-bar)', minHeight: 13,
        }}>
          {pct >= 100 ? 'Готово' : 'Загрузка'}
        </div>
      </div>

      <div style={{
        position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
        fontSize: 9.5, letterSpacing: 1.3, color: 'var(--splash-hint)',
        opacity: at(3) ? 1 : 0,
      }}>коснитесь, чтобы пропустить</div>
    </div>
  );
}

export default AppSplash;
