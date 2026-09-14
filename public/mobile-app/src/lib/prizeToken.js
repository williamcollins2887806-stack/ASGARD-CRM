/** Vector prize tokens — no emoji. Shared by CSS strip, reward sheet, 3D reel. */

const TIER_HEX = {
  common: '#3DDC84',
  rare: '#4A90FF',
  epic: '#A56EFF',
  legendary: '#F0C850',
};

export function prizeKind(p = {}) {
  const n = `${p.name || ''} ${p.desc || ''} ${p.description || ''}`.toLowerCase();
  const icon = String(p.icon || '');
  if (/рамк|frame/i.test(n) || icon === '⚔️' || icon === '✨') return 'frame';
  if (/шлем|облик|helmet|dragon/i.test(n) || icon === '🐉' || icon === '🪖') return 'helm';
  if (/множ|×2|x2|буст/i.test(n) || icon === '🎯') return 'mult';
  if (/\bxp\b|опыт/i.test(n) || icon === '⚡') return 'xp';
  if (/рун|дан|богат|сокровищ|💰|💎/i.test(n) || icon === 'ᚱ' || icon === '💰' || icon === '💎') return 'runes';
  return 'loot';
}

export function prizeColor(tier) {
  return TIER_HEX[tier] || TIER_HEX.common;
}

function svgShell(size, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">${body}</svg>`;
}

export function prizeSvg(kind, tier = 'common', size = 32) {
  const c = prizeColor(tier);
  const d = '#8B6914';
  if (kind === 'runes') {
    return svgShell(size, `
      <circle cx="32" cy="32" r="26" fill="url(#g)" stroke="${d}" stroke-width="2"/>
      <circle cx="32" cy="32" r="20" fill="none" stroke="rgba(90,62,0,.35)" stroke-width="1.5"/>
      <path d="M24 18 L24 46 M24 18 L38 18 Q44 18 44 26 Q44 32 38 32 L24 32 M32 32 L44 46" stroke="#5a3e00" stroke-width="3.2" stroke-linecap="round" fill="none"/>
      <defs><radialGradient id="g" cx="38%" cy="32%"><stop offset="0" stop-color="#FFE17A"/><stop offset="1" stop-color="#C8940A"/></radialGradient></defs>`);
  }
  if (kind === 'xp') {
    return svgShell(size, `
      <polygon points="32,6 38,26 58,26 42,38 48,58 32,46 16,58 22,38 6,26 26,26" fill="${c}" stroke="#0b1a12" stroke-width="1.5"/>
      <polygon points="32,14 36,27 48,27 38,35 42,48 32,40 22,48 26,35 16,27 28,27" fill="#fff" opacity=".35"/>`);
  }
  if (kind === 'mult') {
    return svgShell(size, `
      <rect x="8" y="16" width="48" height="32" rx="10" fill="${c}" stroke="#1a0a28" stroke-width="2"/>
      <text x="32" y="39" text-anchor="middle" font-size="18" font-weight="900" font-family="system-ui" fill="#fff">×2</text>`);
  }
  if (kind === 'helm') {
    return svgShell(size, `
      <path d="M12 34 Q12 12 32 8 Q52 12 52 34 L48 40 Q32 34 16 40Z" fill="#8a96a4" stroke="#2a3038" stroke-width="1.5"/>
      <rect x="14" y="32" width="36" height="7" rx="3" fill="${c}"/>
      <path d="M12 30 Q4 18 6 8 Q10 4 16 14 Q18 22 20 30" fill="${c}" stroke="${d}" stroke-width="1"/>
      <path d="M52 30 Q60 18 58 8 Q54 4 48 14 Q46 22 44 30" fill="${c}" stroke="${d}" stroke-width="1"/>`);
  }
  if (kind === 'frame') {
    return svgShell(size, `
      <rect x="10" y="10" width="44" height="44" rx="8" fill="none" stroke="${c}" stroke-width="5"/>
      <rect x="18" y="18" width="28" height="28" rx="4" fill="rgba(255,255,255,.08)" stroke="${c}" stroke-width="1.5"/>
      <circle cx="10" cy="10" r="4" fill="${c}"/><circle cx="54" cy="10" r="4" fill="${c}"/>
      <circle cx="10" cy="54" r="4" fill="${c}"/><circle cx="54" cy="54" r="4" fill="${c}"/>`);
  }
  return svgShell(size, `
    <polygon points="32,6 54,20 54,44 32,58 10,44 10,20" fill="${c}" stroke="#1a1028" stroke-width="1.8"/>
    <polygon points="32,14 46,22 46,40 32,48 18,40 18,22" fill="#fff" opacity=".22"/>
    <polygon points="32,22 40,28 32,42 24,28" fill="#fff" opacity=".5"/>`);
}

export function prizeIconHtml(prize, size = 32) {
  if (prize?.icon_svg) {
    return String(prize.icon_svg)
      .replace(/(<svg[^>]*)\s+width="[^"]*"/g, '$1')
      .replace(/(<svg[^>]*)\s+height="[^"]*"/g, '$1')
      .replace(/<svg/, `<svg width="${size}" height="${size}"`);
  }
  return prizeSvg(prizeKind(prize), prize?.tier || 'common', size);
}

export function drawPrizeIcon(ctx, kind, tier, cx, cy, s) {
  const c = prizeColor(tier);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s / 64, s / 64);
  ctx.translate(-32, -32);
  if (kind === 'runes') {
    const g = ctx.createRadialGradient(26, 22, 4, 32, 32, 26);
    g.addColorStop(0, '#FFE17A');
    g.addColorStop(1, '#C8940A');
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = '#8B6914';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = '#5a3e00';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(24, 18); ctx.lineTo(24, 46);
    ctx.moveTo(24, 18); ctx.lineTo(38, 18);
    ctx.quadraticCurveTo(44, 18, 44, 26);
    ctx.quadraticCurveTo(44, 32, 38, 32);
    ctx.lineTo(24, 32);
    ctx.moveTo(32, 32); ctx.lineTo(44, 46);
    ctx.stroke();
  } else if (kind === 'xp') {
    ctx.fillStyle = c;
    starPath(ctx, 32, 32, 5, 24, 10);
    ctx.fill();
  } else if (kind === 'mult') {
    roundRect(ctx, 8, 16, 48, 32, 10);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '900 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('×2', 32, 33);
  } else if (kind === 'helm') {
    ctx.fillStyle = '#8a96a4';
    ctx.beginPath();
    ctx.moveTo(12, 34);
    ctx.quadraticCurveTo(12, 12, 32, 8);
    ctx.quadraticCurveTo(52, 12, 52, 34);
    ctx.lineTo(48, 40);
    ctx.quadraticCurveTo(32, 34, 16, 40);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c;
    roundRect(ctx, 14, 32, 36, 7, 3);
    ctx.fill();
  } else if (kind === 'frame') {
    ctx.strokeStyle = c;
    ctx.lineWidth = 5;
    roundRect(ctx, 10, 10, 44, 44, 8);
    ctx.stroke();
  } else {
    ctx.fillStyle = c;
    gemPath(ctx);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath();
    ctx.moveTo(32, 22); ctx.lineTo(40, 28); ctx.lineTo(32, 42); ctx.lineTo(24, 28);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function starPath(ctx, x, y, n, r, ri) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n - Math.PI / 2;
    const rad = i % 2 === 0 ? r : ri;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function gemPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(32, 6);
  ctx.lineTo(54, 20);
  ctx.lineTo(54, 44);
  ctx.lineTo(32, 58);
  ctx.lineTo(10, 44);
  ctx.lineTo(10, 20);
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function makePrizeCardTexture(THREE, prize, w = 512, h = 160) {
  const { c, g: ctx } = (() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return { c, g: c.getContext('2d') };
  })();
  const tier = prize?.tier || 'common';
  const kind = prizeKind(prize);
  const col = prizeColor(tier);
  const bg = {
    common: ['#12301c', '#0a1810'],
    rare: ['#102038', '#081018'],
    epic: ['#1c1234', '#0c0818'],
    legendary: ['#3a2808', '#140e04'],
  }[tier] || ['#12121a', '#08080c'];
  const grd = ctx.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, bg[0]);
  grd.addColorStop(1, bg[1]);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = col;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.globalAlpha = 1;
  const shine = ctx.createLinearGradient(0, 0, 0, h);
  shine.addColorStop(0, 'rgba(255,255,255,0.18)');
  shine.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.fillRect(0, 0, w, h * 0.45);
  drawPrizeIcon(ctx, kind, tier, 78, h / 2, 96);
  ctx.fillStyle = '#fff';
  ctx.font = '800 36px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const name = String(prize?.name || 'Приз');
  ctx.fillText(name, 140, h / 2 - 14, w - 168);
  ctx.fillStyle = col;
  ctx.font = '700 22px system-ui, sans-serif';
  const tag = tier === 'legendary' ? 'ЛЕГЕНДА' : tier === 'epic' ? 'ЭПИК' : tier === 'rare' ? 'РЕДКИЙ' : 'ОБЫЧНЫЙ';
  ctx.fillText(tag, 140, h / 2 + 24, w - 168);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
