import { useEffect, useState } from 'react';
import './chem-lab-vfx.css';

/**
 * Fail VFX: вспышка → искры → карточка причины поверх видимых канистр.
 * Кнопки «ещё раз» рисует ChemLabGame, не этот слой.
 */
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
          {vfx === 'explosion' && (
            <>
              <div className="cl-vfx__shockwave" />
              <div className="cl-vfx__sparks">
                {Array.from({ length: 28 }).map((_, i) => (
                  <span key={i} style={{ '--i': i }} />
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
                {Array.from({ length: 12 }).map((_, i) => (
                  <span key={i} style={{ '--i': i }} />
                ))}
              </div>
            </>
          )}
          {vfx === 'foam' && <div className="cl-vfx__foam" />}
          {vfx === 'steam' && <div className="cl-vfx__steam cl-vfx__steam--soft" />}
          {vfx === 'win' && <div className="cl-vfx__win-sparks" />}
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
