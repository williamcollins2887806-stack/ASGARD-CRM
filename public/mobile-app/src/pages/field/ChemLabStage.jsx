import { useEffect, useRef, useCallback, useState } from 'react';
import { REAGENTS, topOf } from '@/lib/chemLabLogic';
import { drawChemLabFrame, drawChemLabGlassPass } from '@/lib/chemLabRenderer';
import { createParticleSystem } from '@/lib/chemLabParticles';
import { createLiquidGL, canUseWebGL } from '@/lib/chemLabLiquidGL';
import './chem-lab-stage.css';

/**
 * Layer stack: C2D shell → WebGL liquid → C2D glass → DOM hits
 */
export default function ChemLabStage({
  cans,
  reagents,
  selected,
  hintPair,
  valid = [],
  danger = [],
  shakeIdx = null,
  pourVisualRef = null,
  mixIdx = null,
  reducedMotion = false,
  locked = false,
  onCanTap,
  particlesRef,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const glassRef = useRef(null);
  const glRef = useRef(null);
  const hitsRef = useRef(null);
  const particles = useRef(null);
  const liquidGl = useRef(null);
  const scene3d = useRef(null);
  const stateRef = useRef({});
  const layoutsRef = useRef([]);
  const rafRef = useRef(0);
  const lastTs = useRef(0);
  const [glReady, setGlReady] = useState(false);
  const [useScene3d, setUseScene3d] = useState(false);

  if (!particles.current) particles.current = createParticleSystem();

  useEffect(() => {
    let cancelled = false;
    const canvas = glRef.current;
    const wantGl = canUseWebGL() && !reducedMotion;

    (async () => {
      if (!wantGl || !canvas) {
        liquidGl.current = null;
        scene3d.current = null;
        if (!cancelled) {
          setGlReady(false);
          setUseScene3d(false);
        }
        return;
      }
      const api = await createLiquidGL(canvas);
      if (cancelled) {
        api?.dispose?.();
        return;
      }
      liquidGl.current = api;
      scene3d.current = null;
      setUseScene3d(false);
      setGlReady(!!api);
      const wrap = wrapRef.current;
      if (api && wrap) api.resize(wrap.clientWidth, wrap.clientHeight);
    })();

    return () => {
      cancelled = true;
      liquidGl.current?.dispose?.();
      liquidGl.current = null;
      scene3d.current = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (particlesRef) {
      particlesRef.current = {
        ...particles.current,
        glCanvas: () => glRef.current,
        burstFail: (x, y, vfx) => {
          if (liquidGl.current) liquidGl.current.burstFail(x, y, vfx);
          else particles.current.spawnFailCanvas(x, y, vfx);
        },
        burstWin: () => liquidGl.current?.burstWin?.(),
        hasLiquidGl: () => !!liquidGl.current,
      };
    }
    return () => {
      particles.current?.clear();
      if (particlesRef) particlesRef.current = null;
    };
  }, [particlesRef, glReady]);

  const measureLayouts = useCallback(() => {
    const wrap = wrapRef.current;
    const hits = hitsRef.current;
    if (!wrap || !hits) return [];
    const wr = wrap.getBoundingClientRect();
    const nodes = hits.querySelectorAll('[data-can-idx]');
    const layouts = [];
    nodes.forEach((node) => {
      const idx = Number(node.getAttribute('data-can-idx'));
      const r = node.getBoundingClientRect();
      const labelH = 36;
      layouts[idx] = {
        x: r.left - wr.left,
        y: r.top - wr.top,
        w: r.width,
        h: Math.max(120, r.height - labelH),
      };
    });
    layoutsRef.current = layouts;
    return layouts;
  }, []);

  const resizeCanvas = useCallback((canvas, w, h, dpr) => {
    if (!canvas) return;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  const resize = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    resizeCanvas(canvasRef.current, w, h, dpr);
    resizeCanvas(glassRef.current, w, h, dpr);
    if (glRef.current) {
      glRef.current.style.width = `${w}px`;
      glRef.current.style.height = `${h}px`;
    }
    liquidGl.current?.resize?.(w, h);
    measureLayouts();
  }, [measureLayouts, resizeCanvas]);

  stateRef.current = {
    cans,
    reagents,
    selected,
    hintPair,
    valid,
    danger,
    shakeIdx,
    pourVisualRef,
    mixIdx,
    reducedMotion,
    useScene3d,
  };

  useEffect(() => {
    resize();
    const wrap = wrapRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && wrap
      ? new ResizeObserver(() => resize())
      : null;
    ro?.observe(wrap);
    window.addEventListener('resize', resize);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [resize, cans.length]);

  useEffect(() => {
    measureLayouts();
  }, [cans, selected, measureLayouts]);

  useEffect(() => {
    let alive = true;
    lastTs.current = performance.now();

    const loop = (now) => {
      if (!alive) return;
      const canvas = canvasRef.current;
      const glass = glassRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      if (document.hidden) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const dt = Math.min(48, now - lastTs.current);
      lastTs.current = now;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const s = stateRef.current;
      const pourVisual = s.pourVisualRef?.current || null;
      const useGl = !!liquidGl.current && !s.reducedMotion;
      const sceneOn = !!scene3d.current;
      const busy = !!(pourVisual || s.shakeIdx != null || particles.current.count > 0 || useGl);

      if (!busy) {
        if (now - (loop._lastIdle || 0) < 33) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }
        loop._lastIdle = now;
      }

      particles.current.update(dt, w, h, {
        idle: !s.reducedMotion && !pourVisual,
        reducedMotion: s.reducedMotion,
      });

      if (pourVisual && !pourVisual.fail && pourVisual.streamAlpha > 0.15 && !s.reducedMotion && !useGl) {
        const layouts = layoutsRef.current;
        const fromL = layouts[pourVisual.from];
        const toL = layouts[pourVisual.to];
        if (fromL && toL && Math.random() < 0.55) {
          const u = Math.random();
          const x1 = fromL.x + fromL.w / 2;
          const y1 = fromL.y + 18;
          const x2 = toL.x + toL.w / 2;
          const y2 = toL.y + toL.h * 0.35;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2 - 16;
          const t = 1 - u;
          const px = t * t * x1 + 2 * t * u * mx + u * u * x2;
          const py = t * t * y1 + 2 * t * u * my + u * u * y2;
          particles.current.spawnStreamMist?.(px, py, pourVisual.color || '#888');
        }
      }

      if (!layoutsRef.current.length) measureLayouts();

      const frame = {
        width: w,
        height: h,
        layouts: layoutsRef.current,
        cans: s.cans,
        reagents: s.reagents,
        selected: s.selected,
        hintPair: s.hintPair,
        valid: s.valid,
        danger: s.danger,
        shakeIdx: s.shakeIdx,
        pourVisual,
        mixIdx: s.mixIdx,
        time: now,
        reducedMotion: s.reducedMotion,
        particles: (useGl || s.reducedMotion) ? null : particles.current,
        skipLiquid: useGl,
        skipStream: useGl,
        skipGlass: useGl,
      };

      const ctx = canvas.getContext('2d');
      if (ctx && !sceneOn) drawChemLabFrame(ctx, frame);
      else if (ctx && sceneOn) ctx.clearRect(0, 0, w, h);

      if (useGl) {
        liquidGl.current.render(frame);
        if (sceneOn) {
          const hs = scene3d.current.getHits?.() || [];
          const nodes = hitsRef.current?.querySelectorAll('[data-can-idx]');
          nodes?.forEach((node) => {
            const idx = Number(node.getAttribute('data-can-idx'));
            const hbox = hs[idx];
            if (!hbox) return;
            node.style.left = `${hbox.x}px`;
            node.style.top = `${hbox.y}px`;
            node.style.width = `${Math.max(44, hbox.w)}px`;
            node.style.height = `${Math.max(90, hbox.h)}px`;
          });
        }
        const gctx = glass?.getContext('2d');
        if (gctx) {
          if (sceneOn) gctx.clearRect(0, 0, w, h);
          else {
            drawChemLabGlassPass(gctx, {
              ...frame,
              particles: s.reducedMotion ? null : particles.current,
            });
          }
        }
      } else if (glass) {
        const gctx = glass.getContext('2d');
        if (gctx) gctx.clearRect(0, 0, w, h);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [measureLayouts, glReady]);

  return (
    <div className="cl-stage" ref={wrapRef}>
      <div className="cl-stage-surface" aria-hidden style={useScene3d ? { display: 'none' } : undefined} />
      <canvas ref={canvasRef} className="cl-stage-canvas" aria-hidden />
      <canvas ref={glRef} className="cl-stage-gl" aria-hidden />
      <canvas ref={glassRef} className="cl-stage-glass" aria-hidden />
      <div className={`cl-stage-hits${useScene3d ? ' is-3d' : ''}${cans.length >= 9 ? ' cl-hits-dense' : cans.length >= 5 ? ' cl-hits-many' : ''}`} ref={hitsRef}>
        {cans.map((can, i) => {
          const top = topOf(can);
          const meta = top ? (reagents[top] || REAGENTS[top]) : null;
          return (
            <button
              key={i}
              type="button"
              className={`cl-hit${selected === i ? ' cl-hit--selected' : ''}`}
              data-can-idx={i}
              onClick={() => onCanTap(i)}
              disabled={locked}
              aria-label={meta ? `${meta.name}, канистра ${i + 1}` : `Пустая канистра ${i + 1}`}
            >
              <span className="cl-hit-pad" aria-hidden />
              <div className="cl-hit-label">
                <strong>{meta?.short || '—'}</strong>
                <span>{meta ? meta.name.split(' ').slice(0, 2).join(' ') : 'буфер'}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
