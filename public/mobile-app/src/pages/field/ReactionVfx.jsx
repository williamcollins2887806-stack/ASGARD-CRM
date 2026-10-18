import { useEffect, useState } from 'react';
import './chem-lab-vfx.css';

/**
 * Fail VFX: вспышка → искры → карточка причины поверх видимых канистр.
 * Кнопки «ещё раз» рисует ChemLabGame, не этот слой.
 *
 * ФИЗИКА ЧАСТИЦ. Раньше искры выводились из индекса (`--i * 12.8deg`) — все на
 * одном радиусе, с одной скоростью, одинакового размера. Такой слой читается как
 * решётка из точек, а не как взрыв. Здесь каждой частице считается свой угол,
 * дистанция, длительность, задержка, размер, снос и гравитация.
 *
 * Значения детерминированные (хэш от индекса), а не `Math.random()` — иначе
 * скриншот «до/после» не воспроизводится и нельзя сравнить кадры.
 */
function rnd(i, salt) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Искры взрыва: разлёт по кругу + сильная гравитация (падают вниз). */
function sparkStyle(i, count) {
  return {
    '--a': `${((i / count) * 360 + (rnd(i, 1) - 0.5) * 26).toFixed(1)}deg`,
    '--d': `${(150 + rnd(i, 2) * 175).toFixed(0)}px`,
    '--dur': `${(0.72 + rnd(i, 3) * 0.7).toFixed(2)}s`,
    '--dl': `${(rnd(i, 4) * 0.07).toFixed(3)}s`,
    '--sc': (0.55 + rnd(i, 5) * 1.05).toFixed(2),
    '--g': `${(70 + rnd(i, 6) * 130).toFixed(0)}px`,
    '--drift': `${((rnd(i, 7) - 0.5) * 95).toFixed(0)}px`,
  };
}

/** Крупные обломки: медленнее искр, заметно падают. */
function debrisStyle(i, count) {
  return {
    '--a': `${((i / count) * 360 + (rnd(i, 21) - 0.5) * 40).toFixed(1)}deg`,
    '--d': `${(55 + rnd(i, 22) * 110).toFixed(0)}px`,
    '--dur': `${(1.0 + rnd(i, 23) * 0.6).toFixed(2)}s`,
    '--g': `${(120 + rnd(i, 24) * 120).toFixed(0)}px`,
    '--r': `${((rnd(i, 25) - 0.5) * 540).toFixed(0)}deg`,
  };
}

/** Капли вскипания: улетают вверх и падают. */
function dropStyle(i, count) {
  return {
    '--a': `${((i / count) * 360 + (rnd(i, 11) - 0.5) * 30).toFixed(1)}deg`,
    '--d': `${(70 + rnd(i, 12) * 95).toFixed(0)}px`,
    '--dur': `${(0.5 + rnd(i, 13) * 0.42).toFixed(2)}s`,
    '--dl': `${(rnd(i, 14) * 0.06).toFixed(3)}s`,
    '--sc': (0.6 + rnd(i, 15) * 0.9).toFixed(2),
    '--g': `${(95 + rnd(i, 16) * 135).toFixed(0)}px`,
  };
}

/** Конфетти победы: разлёт с вращением, мягкое падение. */
function confettiStyle(i, count) {
  return {
    '--a': `${((i / count) * 360 + (rnd(i, 31) - 0.5) * 34).toFixed(1)}deg`,
    '--d': `${(90 + rnd(i, 32) * 160).toFixed(0)}px`,
    '--dur': `${(1.0 + rnd(i, 33) * 0.8).toFixed(2)}s`,
    '--dl': `${(rnd(i, 34) * 0.12).toFixed(3)}s`,
    '--g': `${(130 + rnd(i, 35) * 130).toFixed(0)}px`,
    '--r': `${((rnd(i, 36) - 0.5) * 720).toFixed(0)}deg`,
    '--sc': (0.7 + rnd(i, 37) * 0.8).toFixed(2),
  };
}

export default function ReactionVfx({
  active,
  vfx = 'explosion',
  title,
  fact,
  onEpilogue,
  reducedMotion = false,
}) {
  const [phase, setPhase] = useState('idle');

  useEffect(() => {
    if (!active) {
      setPhase('idle');
      return undefined;
    }
    if (reducedMotion) {
      setPhase('epilogue');
      onEpilogue?.();
      return undefined;
    }

    setPhase('impact');
    const t1 = setTimeout(() => setPhase('catastrophe'), 90);
    const t2 = setTimeout(() => {
      setPhase('epilogue');
      onEpilogue?.();
    }, 1100);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [active, vfx, reducedMotion, onEpilogue]);

  if (!active && phase === 'idle') return null;

  const isFail = vfx === 'explosion' || vfx === 'gas' || vfx === 'boil';
  const showEpilogue = phase === 'epilogue';

  return (
    <div
      className={`cl-vfx cl-vfx--${vfx} cl-vfx--${phase}`}
      role="presentation"
    >
      {(phase === 'impact' || phase === 'catastrophe') && (
        <>
          <div className="cl-vfx__flash" />
          <div className="cl-vfx__hotcore" />
          {vfx === 'explosion' && (
            <>
              <div className="cl-vfx__shockwave" />
              <div className="cl-vfx__sparks">
                {Array.from({ length: 26 }).map((_, i) => (
                  <span key={i} style={sparkStyle(i, 26)} />
                ))}
              </div>
              <div className="cl-vfx__debris">
                {Array.from({ length: 9 }).map((_, i) => (
                  <span key={i} style={debrisStyle(i, 9)} />
                ))}
              </div>
              <div className="cl-vfx__fireball" />
            </>
          )}
          {vfx === 'gas' && <div className="cl-vfx__gas" />}
          {vfx === 'boil' && (
            <>
              <div className="cl-vfx__steam" />
              <div className="cl-vfx__splash">
                {Array.from({ length: 14 }).map((_, i) => (
                  <span key={i} style={dropStyle(i, 14)} />
                ))}
              </div>
            </>
          )}
          {vfx === 'foam' && <div className="cl-vfx__foam" />}
          {vfx === 'steam' && <div className="cl-vfx__steam cl-vfx__steam--soft" />}
          {vfx === 'win' && (
            <>
              <div className="cl-vfx__win-sparks" />
              <div className="cl-vfx__confetti">
                {Array.from({ length: 22 }).map((_, i) => (
                  <span key={i} style={confettiStyle(i, 22)} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {showEpilogue && isFail && (
        <div className="cl-vfx__epilogue">
          <p className="cl-vfx__epilogue-kicker">АВАРИЯ НА СМЕНЕ</p>
          <h2 className="cl-vfx__epilogue-title">{title || 'Реакция'}</h2>
          <p className="cl-vfx__epilogue-fact">{fact}</p>
          <p className="cl-vfx__epilogue-hint">Канистры на месте — смотри, что смешалось</p>
        </div>
      )}
    </div>
  );
}
