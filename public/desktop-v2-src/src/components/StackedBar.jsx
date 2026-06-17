import { useEffect, useRef } from 'react';

/**
 * Простой stacked-bar — повторяет AsgardCharts.stackedBar по структуре.
 * rows: [{ label, parts: [{ value, color, label }] }]
 */
export default function StackedBar({ rows, legend = [], height = 200 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    ctx.clearRect(0, 0, W, H);

    if (!rows.length) return;

    const padL = 36;
    const padR = 16;
    const padT = 12;
    const padB = 28;

    const maxTotal = Math.max(1, ...rows.map((r) => (r.parts || []).reduce((s, p) => s + Math.max(0, +p.value || 0), 0)));
    const niceMax = niceCeil(maxTotal);

    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const groupGap = 6;
    const groupW = innerW / rows.length;
    const barW = Math.max(8, groupW - groupGap);

    // grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) {
      ctx.strokeStyle = 'rgba(15,23,42,0.08)';
      ctx.fillStyle = 'rgba(15,23,42,0.55)';
    }
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const y = padT + (innerH * i) / ticks;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      const val = Math.round(niceMax * (1 - i / ticks));
      ctx.fillText(String(val), padL - 6, y);
    }

    rows.forEach((row, idx) => {
      const xCenter = padL + groupW * idx + groupW / 2;
      const x = xCenter - barW / 2;
      let yCursor = padT + innerH;
      (row.parts || []).forEach((p) => {
        const v = Math.max(0, +p.value || 0);
        if (!v) return;
        const h = (v / niceMax) * innerH;
        const color = resolveColor(p.color);
        const grad = ctx.createLinearGradient(0, yCursor - h, 0, yCursor);
        grad.addColorStop(0, color);
        grad.addColorStop(1, lighten(color, -0.15));
        ctx.fillStyle = grad;
        roundRect(ctx, x, yCursor - h, barW, h, 4);
        ctx.fill();
        yCursor -= h;
      });

      // подпись месяца
      ctx.fillStyle = isLight ? 'rgba(15,23,42,0.65)' : 'rgba(255,255,255,0.55)';
      ctx.font = '11px -apple-system, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(row.label, xCenter, H - padB + 6);
    });
  }, [rows, height]);

  return (
    <div>
      <canvas ref={ref} className="chart-canvas" style={{ height }} />
      {legend.length > 0 && (
        <div className="chart-legend mt-6" >
          {legend.map((l, i) => (
            <span key={i}>
              <span className="swatch" style={{ background: resolveColor(l.color) }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function niceCeil(n) {
  if (n <= 5) return 5;
  if (n <= 10) return 10;
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const r = n / exp;
  if (r <= 1) return exp;
  if (r <= 2) return 2 * exp;
  if (r <= 5) return 5 * exp;
  return 10 * exp;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function resolveColor(c) {
  if (!c) return '#888';
  if (c.startsWith('var(')) {
    const name = c.slice(4, -1).trim();
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || '#888';
  }
  return c;
}

function lighten(hex, amount) {
  // amount in [-1,1]; supports hex or any string already resolved
  const c = hex.startsWith('#') ? hex : resolveColor(hex);
  if (!c.startsWith('#')) return c;
  let r = parseInt(c.slice(1, 3), 16);
  let g = parseInt(c.slice(3, 5), 16);
  let b = parseInt(c.slice(5, 7), 16);
  r = Math.round(Math.max(0, Math.min(255, r + 255 * amount)));
  g = Math.round(Math.max(0, Math.min(255, g + 255 * amount)));
  b = Math.round(Math.max(0, Math.min(255, b + 255 * amount)));
  return `rgb(${r},${g},${b})`;
}
