/**
 * Lazy 3D warrior thumb for shop grid.
 * Mounts WebGL only when visible + respects a global concurrency cap
 * (phones choke on dozens of GL contexts).
 */
import { useEffect, useRef, useState } from 'react';
import VikingAvatar3D, { canUseWebGL } from '@/components/field/VikingAvatar3D';

const MAX_CONCURRENT = 3;
let activeCount = 0;
const queue = [];

function acquireSlot() {
  return new Promise((resolve) => {
    if (activeCount < MAX_CONCURRENT) {
      activeCount += 1;
      resolve();
      return;
    }
    queue.push(resolve);
  });
}

function releaseSlot() {
  activeCount = Math.max(0, activeCount - 1);
  const next = queue.shift();
  if (next) {
    activeCount += 1;
    next();
  }
}

export default function ShopWarriorThumb({
  assets = {},
  cosmetics = {},
  overrides = {},
  level = 1,
  size = 96,
  fallback = null,
  onFail,
}) {
  const wrapRef = useRef(null);
  const hasSlot = useRef(false);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const can3d = canUseWebGL();

  const handleFail = () => {
    setFailed(true);
    onFail?.();
  };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(!!entry?.isIntersecting),
      { rootMargin: '120px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!can3d || !visible) {
      if (hasSlot.current) {
        releaseSlot();
        hasSlot.current = false;
      }
      setReady(false);
      return undefined;
    }
    acquireSlot().then(() => {
      if (cancelled) {
        releaseSlot();
        return;
      }
      hasSlot.current = true;
      setReady(true);
    });
    return () => {
      cancelled = true;
      if (hasSlot.current) {
        releaseSlot();
        hasSlot.current = false;
      }
      setReady(false);
    };
  }, [visible, can3d]);

  return (
    <div
      ref={wrapRef}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        overflow: 'hidden',
        background: 'radial-gradient(circle at 50% 30%,rgba(240,200,80,.1),transparent 70%)',
      }}
    >
      {failed ? (
        fallback || (
          <div style={{
            width: size * 0.55,
            height: size * 0.55,
            borderRadius: '50%',
            background: 'rgba(240,200,80,.12)',
            border: '1px solid rgba(240,200,80,.3)',
          }} />
        )
      ) : ready ? (
        <VikingAvatar3D
          assets={assets}
          cosmetics={cosmetics}
          overrides={overrides}
          level={level}
          size={size}
          interactive={false}
          transparentBg
          mood="idle"
          onFail={handleFail}
        />
      ) : (
        <div style={{
          width: size * 0.35,
          height: size * 0.35,
          borderRadius: '50%',
          border: '2px solid rgba(240,200,80,.35)',
          borderTopColor: 'transparent',
          animation: 'fshopSpin .8s linear infinite',
        }} />
      )}
    </div>
  );
}
