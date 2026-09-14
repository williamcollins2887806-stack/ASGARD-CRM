/**
 * Canvas2D idle/splash particles. Fail GL burst lives in chemLabLiquidGL.
 */

const MAX_IDLE = 40;
const MAX_SPLASH = 28;

function hexToRgb(hex) {
  const h = (hex || '#888888').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function createParticleSystem() {
  /** @type {Array<object>} */
  let particles = [];

  function spawnIdle(w, h, count = 1) {
    for (let i = 0; i < count && particles.length < MAX_IDLE; i++) {
      particles.push({
        kind: 'dust',
        x: Math.random() * w,
        y: h * (0.35 + Math.random() * 0.45),
        vx: (Math.random() - 0.5) * 8,
        vy: -6 - Math.random() * 12,
        life: 1,
        decay: 0.003 + Math.random() * 0.004,
        size: 1 + Math.random() * 2,
        color: 'rgba(232,168,56,0.35)',
      });
    }
  }

  function spawnSplash(x, y, color, count = 26) {
    const { r, g, b } = hexToRgb(color);
    const n = Math.min(count, MAX_SPLASH);
    for (let i = 0; i < n; i++) {
      const a = (-Math.PI / 2) + (Math.random() - 0.5) * 2.1;
      const sp = 50 + Math.random() * 110;
      particles.push({
        kind: 'drop',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 1,
        decay: 0.014 + Math.random() * 0.018,
        size: 2.2 + Math.random() * 3.8,
        color: `rgba(${r},${g},${b},0.92)`,
        g: 260,
      });
    }
  }

  /** Tiny mist along ribbon while pouring */
  function spawnStreamMist(x, y, color) {
    if (particles.length > MAX_IDLE + MAX_SPLASH) return;
    const { r, g, b } = hexToRgb(color);
    particles.push({
      kind: 'mist',
      x: x + (Math.random() - 0.5) * 8,
      y: y + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 25,
      vy: 10 + Math.random() * 30,
      life: 1,
      decay: 0.035 + Math.random() * 0.02,
      size: 1.5 + Math.random() * 2.5,
      color: `rgba(${r},${g},${b},0.55)`,
      g: 40,
    });
  }

  function spawnSoft(x, y, mode = 'steam') {
    const n = mode === 'foam' ? 14 : 10;
    for (let i = 0; i < n; i++) {
      particles.push({
        kind: mode,
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 20,
        vy: -20 - Math.random() * 30,
        life: 1,
        decay: 0.012 + Math.random() * 0.01,
        size: mode === 'foam' ? 4 + Math.random() * 6 : 3 + Math.random() * 5,
        color: mode === 'foam' ? 'rgba(220,240,255,0.55)' : 'rgba(200,220,230,0.4)',
      });
    }
  }

  function spawnFailCanvas(x, y, vfx) {
    const n = vfx === 'gas' ? 36 : vfx === 'boil' ? 28 : 42;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * (vfx === 'explosion' ? 160 : 90);
      const col = vfx === 'gas'
        ? `rgba(${80 + Math.random() * 60},${200 + Math.random() * 40},${90},0.85)`
        : vfx === 'boil'
          ? `rgba(255,${180 + Math.random() * 40},80,0.9)`
          : `rgba(255,${120 + Math.random() * 80},${40 + Math.random() * 40},0.95)`;
      particles.push({
        kind: 'fail',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (vfx === 'gas' ? 40 : 10),
        life: 1,
        decay: 0.012 + Math.random() * 0.015,
        size: 2 + Math.random() * 4,
        color: col,
        g: vfx === 'gas' ? 40 : 180,
      });
    }
  }

  /**
   * @deprecated Use liquidGL.burstFail via particlesRef — kept as Canvas2D-only fallback.
   */
  async function startWebGlBurst(_canvas, vfx) {
    // Second WebGL context removed (shared chemLabLiquidGL). No-op here.
    void vfx;
    return null;
  }

  function stopWebGlBurst() {
    /* no standalone GL burst */
  }

  function update(dt, w, h, { idle = true, reducedMotion = false } = {}) {
    if (reducedMotion) {
      particles = [];
      return;
    }
    if (idle && particles.filter((p) => p.kind === 'dust').length < 12 && Math.random() < 0.08) {
      spawnIdle(w, h, 1);
    }
    const next = [];
    for (const p of particles) {
      p.life -= p.decay * (dt / 16);
      p.x += p.vx * (dt / 1000);
      p.y += p.vy * (dt / 1000);
      if (p.g) p.vy += p.g * (dt / 1000);
      if (p.life > 0 && p.y < h + 40) next.push(p);
    }
    particles = next.slice(0, MAX_IDLE + MAX_SPLASH + 50);
  }

  function draw(ctx) {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.6 + p.life * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function clear() {
    particles = [];
  }

  return {
    spawnIdle,
    spawnSplash,
    spawnStreamMist,
    spawnSoft,
    spawnFailCanvas,
    startWebGlBurst,
    stopWebGlBurst,
    update,
    draw,
    clear,
    get count() { return particles.length; },
  };
}
