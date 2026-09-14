/**
 * ChemLab stage renderer — glass tubes, volumetric liquid, ribbon stream, bubbles.
 * Canvas2D ceiling for SortPuz-like feel (no full fluid sim).
 */
import { CAPACITY, REAGENTS } from './chemLabLogic';

function hexToRgb(hex) {
  const h = String(hex || '#888888').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 136, g: 136, b: 136 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function bez(u, a, b, c) {
  const t = 1 - u;
  return t * t * a + 2 * t * u * b + u * u * c;
}

export function resolveVisualState(cans, pourVisual) {
  if (!pourVisual || pourVisual.fail) {
    return {
      list: cans.map((c) => ({ capacity: c.capacity || CAPACITY, layers: c.layers.slice() })),
      fracSrc: 0,
      fracDst: 0,
      from: -1,
      to: -1,
      transferCode: null,
    };
  }
  if (pourVisual.committed) {
    return {
      list: cans.map((c) => ({ capacity: c.capacity || CAPACITY, layers: c.layers.slice() })),
      fracSrc: 0,
      fracDst: 0,
      from: pourVisual.from,
      to: pourVisual.to,
      transferCode: null,
    };
  }

  const base = (pourVisual.before || cans).map((c) => ({
    capacity: c.capacity || CAPACITY,
    layers: c.layers.slice(),
  }));
  const from = pourVisual.from;
  const to = pourVisual.to;
  const poured = pourVisual.poured || 0;
  const transfer = Math.max(0, Math.min(1, pourVisual.transfer || 0));
  const code = pourVisual.colorCode;
  const moved = poured * transfer;

  let remainRemove = moved;
  while (remainRemove >= 1 && base[from].layers.length) {
    base[from].layers.pop();
    remainRemove -= 1;
  }
  const fracSrc = remainRemove > 0 && remainRemove < 1 ? remainRemove : 0;

  let remainAdd = moved;
  while (remainAdd >= 1 && base[to].layers.length < base[to].capacity) {
    base[to].layers.push(code);
    remainAdd -= 1;
  }
  const fracDst = remainAdd > 0 && remainAdd < 1 ? remainAdd : 0;

  return {
    list: base,
    fracSrc,
    fracDst,
    from,
    to,
    transferCode: code,
  };
}

/** Geometry + outer shell (liquid drawn separately, then glass overlay). */
export function measureTube(x, y, w, h, lift, shakeX) {
  const pad = 6;
  const bodyX = x + shakeX;
  const bodyY = y - lift;
  const cx = bodyX + w / 2;
  const shellY = bodyY + 11;
  const shellH = h - 14;
  return {
    bodyX,
    bodyY,
    cx,
    shellY,
    shellH,
    w,
    h,
    pad,
    ix: bodyX + pad,
    iy: shellY + pad,
    iw: w - pad * 2,
    ih: shellH - pad * 2 - 2,
    originY: bodyY + h * 0.88,
    lift,
  };
}

function drawTubeShell(ctx, tube, opts) {
  const {
    selected, valid, danger, hint, dim, tilt, time,
  } = opts;
  const {
    bodyX, bodyY, cx, shellY, shellH, w, h, originY,
  } = tube;

  ctx.save();
  ctx.translate(cx, originY);
  ctx.rotate(tilt);
  ctx.translate(-cx, -originY);

  // Soft contact shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(cx, bodyY + h + 5, w * 0.4, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Selection / target aura
  if (selected) {
    const glow = ctx.createRadialGradient(cx, shellY + shellH * 0.3, 2, cx, shellY + shellH * 0.25, w * 1.15);
    glow.addColorStop(0, 'rgba(232,168,56,0.5)');
    glow.addColorStop(1, 'rgba(232,168,56,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(bodyX - 14, shellY - 18, w + 28, shellH + 36);
  }
  if (valid || danger || hint) {
    if (valid) ctx.shadowColor = 'rgba(52,211,153,0.7)';
    else if (danger) ctx.shadowColor = 'rgba(248,113,113,0.65)';
    else {
      const pulse = 0.4 + Math.sin(time * 0.007) * 0.4;
      ctx.shadowColor = `rgba(52,211,153,${pulse})`;
    }
    ctx.shadowBlur = 16;
  }

  // Outer glass body — cool translucent shell
  const shellGrad = ctx.createLinearGradient(bodyX, shellY, bodyX + w, shellY);
  if (dim) {
    shellGrad.addColorStop(0, 'rgba(55,65,80,0.92)');
    shellGrad.addColorStop(0.35, 'rgba(28,34,44,0.95)');
    shellGrad.addColorStop(0.7, 'rgba(18,22,30,0.96)');
    shellGrad.addColorStop(1, 'rgba(40,48,60,0.9)');
  } else {
    shellGrad.addColorStop(0, 'rgba(120,135,155,0.55)');
    shellGrad.addColorStop(0.18, 'rgba(55,65,82,0.88)');
    shellGrad.addColorStop(0.5, 'rgba(22,28,38,0.94)');
    shellGrad.addColorStop(0.82, 'rgba(30,38,50,0.92)');
    shellGrad.addColorStop(1, 'rgba(90,105,125,0.5)');
  }
  roundRectPath(ctx, bodyX, shellY, w, shellH, 16);
  ctx.fillStyle = shellGrad;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = valid ? 'rgba(52,211,153,0.9)'
    : danger ? 'rgba(248,113,113,0.85)'
      : selected ? 'rgba(232,168,56,0.75)' : 'rgba(160,175,195,0.35)';
  ctx.lineWidth = valid || danger || selected ? 2.5 : 1.6;
  ctx.stroke();

  // Metal cap
  const capW = w * 0.5;
  const capH = 13;
  const capX = cx - capW / 2;
  const capY = bodyY - 1;
  const capGrad = ctx.createLinearGradient(capX, capY, capX, capY + capH);
  capGrad.addColorStop(0, '#9aa3b5');
  capGrad.addColorStop(0.45, '#4a5364');
  capGrad.addColorStop(1, '#2a313c');
  roundRectPath(ctx, capX, capY, capW, capH, 5);
  ctx.fillStyle = capGrad;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(capX + 6, capY + 3, capW - 12, 2.5);

  // Inner well (empty dark)
  roundRectPath(ctx, tube.ix, tube.iy, tube.iw, tube.ih, 11);
  const well = ctx.createLinearGradient(tube.ix, tube.iy, tube.ix + tube.iw, tube.iy);
  well.addColorStop(0, 'rgba(6,8,12,0.72)');
  well.addColorStop(0.5, 'rgba(10,12,18,0.55)');
  well.addColorStop(1, 'rgba(6,8,12,0.72)');
  ctx.fillStyle = well;
  ctx.fill();

  // Mouth ellipse (top opening)
  ctx.beginPath();
  ctx.ellipse(cx, tube.iy + 3, tube.iw * 0.48, 4.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,210,225,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

/** Glass rim / fresnel / specular drawn AFTER liquid. */
function drawGlassOverlay(ctx, tube, opts) {
  const { tilt, selected, time, dim } = opts;
  const {
    cx, originY, ix, iy, iw, ih, bodyX, shellY, w, shellH,
  } = tube;

  ctx.save();
  ctx.translate(cx, originY);
  ctx.rotate(tilt);
  ctx.translate(-cx, -originY);

  // Inner rim (thickness)
  roundRectPath(ctx, ix - 1, iy - 1, iw + 2, ih + 2, 11);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Left key specular (glass)
  const specX = ix + iw * (0.08 + (selected ? 0.02 * Math.sin(time * 0.003) : 0));
  const spec = ctx.createLinearGradient(specX, iy, specX + iw * 0.22, iy);
  spec.addColorStop(0, 'rgba(255,255,255,0)');
  spec.addColorStop(0.35, dim ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.38)');
  spec.addColorStop(0.55, 'rgba(255,255,255,0.08)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  roundRectPath(ctx, ix, iy, iw, ih, 11);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = spec;
  ctx.fillRect(ix, iy, iw * 0.4, ih);
  // Thin bright edge
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(ix + 3, iy + 8, 2.2, ih - 16);
  ctx.restore();

  // Right rim darkening (thickness cue)
  const rim = ctx.createLinearGradient(ix + iw * 0.75, iy, ix + iw, iy);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.28)');
  roundRectPath(ctx, ix, iy, iw, ih, 11);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = rim;
  ctx.fillRect(ix + iw * 0.7, iy, iw * 0.3, ih);
  ctx.restore();

  // Outer bevel highlight
  roundRectPath(ctx, bodyX + 1.5, shellY + 1.5, w - 3, shellH - 3, 15);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function drawLiquid(ctx, tube, can, reagents, opts) {
  const {
    fracExtra = 0,
    fracMissing = 0,
    extraColor = null,
    wave = 0,
    time = 0,
    dim = false,
    mixing = false,
    pouring = false,
    reducedMotion = false,
  } = opts;
  const {
    ix, iy, iw, ih, cx, tilt, originY,
  } = tube;
  const cap = can.capacity || CAPACITY;
  const unitH = ih / cap;
  const layers = can.layers;
  const fillUnits = layers.length - fracMissing + fracExtra;

  ctx.save();
  ctx.translate(cx, originY);
  ctx.rotate(tilt);
  ctx.translate(-cx, -originY);

  if (fillUnits <= 0.01) {
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.font = '700 10px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('пусто', ix + iw / 2, iy + ih / 2);
    ctx.restore();
    return;
  }

  roundRectPath(ctx, ix, iy, iw, ih, 11);
  ctx.clip();

  let y = iy + ih;
  const drawLayers = layers.slice();

  for (let i = 0; i < drawLayers.length; i++) {
    const code = drawLayers[i];
    const color = reagents[code]?.color || REAGENTS[code]?.color || '#888';
    let h = unitH;
    if (i === drawLayers.length - 1 && fracMissing > 0) h = unitH * (1 - fracMissing);
    y -= h;

    // Soft vertical volume + slight horizontal “cylinder” shading
    const g = ctx.createLinearGradient(ix, y, ix, y + h);
    g.addColorStop(0, rgba(color, dim ? 0.7 : 0.88));
    g.addColorStop(0.35, rgba(color, dim ? 0.9 : 1));
    g.addColorStop(1, rgba(color, dim ? 0.55 : 0.78));
    ctx.fillStyle = g;
    ctx.fillRect(ix - 0.5, y, iw + 1, h + 1);

    const cyl = ctx.createLinearGradient(ix, y, ix + iw, y);
    cyl.addColorStop(0, 'rgba(0,0,0,0.22)');
    cyl.addColorStop(0.22, 'rgba(255,255,255,0.12)');
    cyl.addColorStop(0.5, 'rgba(255,255,255,0)');
    cyl.addColorStop(0.78, 'rgba(0,0,0,0.08)');
    cyl.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = cyl;
    ctx.fillRect(ix, y, iw, h);

    // Soft seam blend into next layer
    if (i < drawLayers.length - 1 || fracExtra > 0.02) {
      const seam = ctx.createLinearGradient(ix, y, ix, y + 6);
      seam.addColorStop(0, 'rgba(255,255,255,0.14)');
      seam.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = seam;
      ctx.fillRect(ix, y, iw, 6);
    }
  }

  if (fracExtra > 0.02 && extraColor) {
    const h = unitH * fracExtra;
    y -= h;
    const g = ctx.createLinearGradient(ix, y, ix, y + h);
    g.addColorStop(0, rgba(extraColor, 0.95));
    g.addColorStop(1, rgba(extraColor, 0.7));
    ctx.fillStyle = g;
    ctx.fillRect(ix, y, iw, h + 0.5);
  }

  const surfaceY = iy + ih - fillUnits * unitH;
  const amp = reducedMotion ? 0 : (0.35 + wave * 1.4 + (pouring ? 0.5 : 0));
  const phase = time * 0.003;
  const topCode = drawLayers[drawLayers.length - 1];
  const topColor = (fracExtra > 0.02 && extraColor)
    ? extraColor
    : (reagents[topCode]?.color || REAGENTS[topCode]?.color || '#aaa');

  // Meniscus band with dual-frequency wave
  ctx.beginPath();
  ctx.moveTo(ix, iy + ih);
  ctx.lineTo(ix, surfaceY + 2);
  for (let px = 0; px <= iw; px += 1.5) {
    const wy = surfaceY
      + Math.sin(phase + px * 0.2) * amp
      + Math.sin(phase * 1.7 + px * 0.45) * amp * 0.35;
    ctx.lineTo(ix + px, wy);
  }
  ctx.lineTo(ix + iw, iy + ih);
  ctx.closePath();
  // already clipped; fill only surface highlight strip
  ctx.beginPath();
  for (let px = 0; px <= iw; px += 1.5) {
    const wy = surfaceY
      + Math.sin(phase + px * 0.2) * amp
      + Math.sin(phase * 1.7 + px * 0.45) * amp * 0.35;
    if (px === 0) ctx.moveTo(ix + px, wy);
    else ctx.lineTo(ix + px, wy);
  }
  for (let px = iw; px >= 0; px -= 1.5) {
    const wy = surfaceY + 7
      + Math.sin(phase + px * 0.2) * amp * 0.3;
    ctx.lineTo(ix + px, wy);
  }
  ctx.closePath();
  const men = ctx.createLinearGradient(ix, surfaceY - 4, ix, surfaceY + 10);
  men.addColorStop(0, rgba(topColor, 0.15));
  men.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  men.addColorStop(1, rgba(topColor, 0.35));
  ctx.fillStyle = men;
  ctx.fill();

  // Moving caustic band
  if (!reducedMotion) {
    const cxBand = ix + ((time * 0.03) % (iw + 20)) - 10;
    const cau = ctx.createLinearGradient(cxBand, surfaceY, cxBand + 18, surfaceY + ih * 0.5);
    cau.addColorStop(0, 'rgba(255,255,255,0)');
    cau.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    cau.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cau;
    ctx.fillRect(ix, surfaceY, iw, ih * 0.55);
  }

  // Bubbles — idle + denser when mixing / pouring into this can
  if (!reducedMotion && fillUnits > 0.25) {
    const n = mixing ? 10 : pouring ? 7 : 4;
    for (let b = 0; b < n; b++) {
      const seed = b * 97.3 + (mixing ? 11 : 0);
      const bx = ix + 6 + ((Math.sin(seed) * 0.5 + 0.5) * (iw - 12));
      const speed = mixing ? 0.055 : 0.032;
      const travel = ((time * speed + seed * 13) % (ih * 0.55 + 12));
      const by = surfaceY + 6 + travel;
      if (by > iy + ih - 3) continue;
      const rad = mixing ? 1.6 + (b % 3) * 0.7 : 1.2 + (b % 2) * 0.5;
      ctx.beginPath();
      ctx.arc(bx, by, rad, 0, Math.PI * 2);
      ctx.fillStyle = mixing ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.32)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx - rad * 0.3, by - rad * 0.3, rad * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
    }
  }

  ctx.restore();
}

/**
 * Dense ribbon + metaball-ish blobs along quadratic path (SortPuz-style).
 */
function drawRibbonStream(ctx, x1, y1, x2, y2, color, alpha, time) {
  if (alpha < 0.02) return;
  const { r, g, b } = hexToRgb(color);
  const mx = (x1 + x2) / 2 + (y2 - y1) * 0.1;
  const my = (y1 + y2) / 2 - 18;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Soft glow body (blurred metaball approximation)
  ctx.save();
  if (typeof ctx.filter === 'string') ctx.filter = 'blur(3.5px)';
  ctx.fillStyle = `rgba(${r},${g},${b},0.55)`;
  for (let i = 0; i <= 18; i++) {
    const u = i / 18;
    const px = bez(u, x1, mx, x2);
    const py = bez(u, y1, my, y2);
    const rad = 5.5 + Math.sin(u * Math.PI) * 4.5 + Math.sin(time * 0.02 + u * 10) * 1.2;
    ctx.beginPath();
    ctx.ellipse(px, py, rad * 1.15, rad * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = 'none';
  ctx.restore();

  // Core ribbon
  ctx.strokeStyle = `rgba(${r},${g},${b},0.95)`;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx, my, x2, y2);
  ctx.stroke();

  // Highlight filament
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx - 2, my - 2, x2, y2);
  ctx.stroke();

  // Traveling blobs / droplets
  for (let i = 0; i < 10; i++) {
    const u = ((time * 0.0018) + i * 0.09) % 1;
    const px = bez(u, x1, mx, x2);
    const py = bez(u, y1, my, y2);
    const rad = 2.2 + Math.sin(u * Math.PI) * 2.8;
    ctx.beginPath();
    ctx.ellipse(px, py, rad, rad * 0.75, Math.atan2(y2 - y1, x2 - x1), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px - 1, py - 1, rad * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
  }

  // Splash bloom at destination
  const bloom = ctx.createRadialGradient(x2, y2, 1, x2, y2, 22);
  bloom.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
  bloom.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(x2, y2, 22, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function drawChemLabFrame(ctx, state) {
  const {
    width, height, cans, reagents, selected, hintPair, valid = [], danger = [],
    shakeIdx, pourVisual, time = 0, reducedMotion = false, particles, mixIdx = null,
    skipLiquid = false, skipStream = false, skipGlass = false,
  } = state;

  ctx.clearRect(0, 0, width, height);

  const light = ctx.createRadialGradient(width * 0.3, height * 0.05, 8, width * 0.45, height * 0.25, width * 0.8);
  light.addColorStop(0, 'rgba(232,168,56,0.14)');
  light.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, width, height);

  const benchG = ctx.createLinearGradient(0, height - 72, 0, height);
  benchG.addColorStop(0, 'rgba(0,0,0,0)');
  benchG.addColorStop(0.35, 'rgba(18,22,30,0.5)');
  benchG.addColorStop(1, 'rgba(10,12,16,0.9)');
  ctx.fillStyle = benchG;
  ctx.fillRect(0, height - 72, width, 72);

  const layouts = state.layouts || [];
  const vis = resolveVisualState(cans, pourVisual);
  const dimOthers = selected != null;
  const mouth = [];
  const tubes = [];

  for (let i = 0; i < layouts.length; i++) {
    const L = layouts[i];
    if (!L) continue;
    const can = vis.list[i] || { layers: [], capacity: CAPACITY };
    const isSrc = pourVisual && pourVisual.from === i;
    const isDst = pourVisual && pourVisual.to === i;
    const tiltAmt = (pourVisual?.tilt || 0) * (pourVisual?.tiltDir === 'left' ? -0.7 : 0.7);
    const tilt = isSrc ? tiltAmt : 0;
    const lift = isSrc ? (pourVisual?.lift || 0) : (selected === i ? 14 : 0);
    const shakeX = shakeIdx === i ? Math.sin(time * 0.055) * 5 : 0;

    const tube = measureTube(L.x, L.y, L.w, L.h, lift, shakeX);
    tube.tilt = tilt;
    tubes[i] = tube;

    drawTubeShell(ctx, tube, {
      selected: selected === i,
      valid: valid.includes(i),
      danger: danger.includes(i),
      hint: hintPair && (hintPair.from === i || hintPair.to === i),
      dim: dimOthers && selected !== i && !valid.includes(i) && !danger.includes(i)
        && !(hintPair && (hintPair.from === i || hintPair.to === i)),
      tilt,
      time,
    });

    const fracMissing = vis.from === i ? vis.fracSrc : 0;
    const fracExtra = vis.to === i ? vis.fracDst : 0;
    const fillUnits = can.layers.length - fracMissing + fracExtra;

    if (!skipLiquid) {
      drawLiquid(ctx, tube, can, reagents, {
        fracMissing,
        fracExtra,
        extraColor: vis.transferCode
          ? (reagents[vis.transferCode]?.color || pourVisual?.color)
          : pourVisual?.color,
        wave: isDst ? (pourVisual?.wave || 0) : 0,
        time: time + i * 40,
        dim: dimOthers && selected !== i,
        mixing: mixIdx === i || (isDst && (pourVisual?.wave || 0) > 0.15),
        pouring: isDst && (pourVisual?.streamAlpha || 0) > 0.1,
        reducedMotion,
      });
    } else if (fillUnits <= 0.01) {
      // Empty mark when liquid is on GL layer
      ctx.save();
      ctx.translate(tube.cx, tube.originY);
      ctx.rotate(tilt);
      ctx.translate(-tube.cx, -tube.originY);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.font = '700 10px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('пусто', tube.ix + tube.iw / 2, tube.iy + tube.ih / 2);
      ctx.restore();
    }

    if (!skipGlass) {
      drawGlassOverlay(ctx, tube, {
        tilt,
        selected: selected === i,
        time,
        dim: dimOthers && selected !== i,
      });

      const top = can.layers[can.layers.length - 1];
      if (top && (reagents[top]?.hazard || REAGENTS[top]?.hazard)) {
        ctx.save();
        ctx.translate(tube.cx, tube.originY);
        ctx.rotate(tilt);
        ctx.translate(-tube.cx, -tube.originY);
        ctx.fillStyle = 'rgba(248,113,113,0.95)';
        ctx.font = 'bold 12px system-ui';
        ctx.fillText('⚠', tube.ix + tube.iw - 16, tube.iy + 16);
        ctx.restore();
      }
    }

    const mouthX = tube.cx + Math.sin(tilt) * (tube.shellH * 0.42);
    const mouthY = tube.iy + 4 - lift;
    mouth[i] = {
      x: mouthX,
      y: mouthY,
      midX: tube.cx,
      midY: tube.iy + tube.ih * 0.28 - lift,
    };
  }

  if (!skipStream && pourVisual && !pourVisual.fail && pourVisual.streamAlpha > 0.02
    && mouth[pourVisual.from] && mouth[pourVisual.to]) {
    const a = mouth[pourVisual.from];
    const b = mouth[pourVisual.to];
    drawRibbonStream(
      ctx,
      a.x,
      a.y,
      b.midX,
      b.midY + 8,
      pourVisual.color || '#888',
      pourVisual.streamAlpha,
      time
    );
  }

  if (particles) particles.draw(ctx);

  return { tubes, mouth, vis };
}

/** Top glass pass (above WebGL liquid). */
export function drawChemLabGlassPass(ctx, state) {
  const {
    width, height, cans, reagents, selected, hintPair, valid = [], danger = [],
    shakeIdx, pourVisual, time = 0, particles,
  } = state;

  ctx.clearRect(0, 0, width, height);

  const layouts = state.layouts || [];
  const vis = resolveVisualState(cans, pourVisual);
  const dimOthers = selected != null;

  for (let i = 0; i < layouts.length; i++) {
    const L = layouts[i];
    if (!L) continue;
    const can = vis.list[i] || { layers: [], capacity: CAPACITY };
    const isSrc = pourVisual && pourVisual.from === i;
    const tiltAmt = (pourVisual?.tilt || 0) * (pourVisual?.tiltDir === 'left' ? -0.7 : 0.7);
    const tilt = isSrc ? tiltAmt : 0;
    const lift = isSrc ? (pourVisual?.lift || 0) : (selected === i ? 14 : 0);
    const shakeX = shakeIdx === i ? Math.sin(time * 0.055) * 5 : 0;
    const tube = measureTube(L.x, L.y, L.w, L.h, lift, shakeX);

    drawGlassOverlay(ctx, tube, {
      tilt,
      selected: selected === i,
      time,
      dim: dimOthers && selected !== i,
    });

    const top = can.layers[can.layers.length - 1];
    if (top && (reagents[top]?.hazard || REAGENTS[top]?.hazard)) {
      ctx.save();
      ctx.translate(tube.cx, tube.originY);
      ctx.rotate(tilt);
      ctx.translate(-tube.cx, -tube.originY);
      ctx.fillStyle = 'rgba(248,113,113,0.95)';
      ctx.font = 'bold 12px system-ui';
      ctx.fillText('⚠', tube.ix + tube.iw - 16, tube.iy + 16);
      ctx.restore();
    }

    void hintPair;
    void valid;
    void danger;
  }

  if (particles) particles.draw(ctx);
}