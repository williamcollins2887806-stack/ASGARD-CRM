/** Procedural PBR-ish maps: wood, brass, brushed metal. */

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d') };
}

function toTex(THREE, c, repeat = 1) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.needsUpdate = true;
  return tex;
}

export function makeWoodMap(THREE, w = 512, h = 512) {
  const { c, g } = canvas2d(w, h);
  g.fillStyle = '#6a4018';
  g.fillRect(0, 0, w, h);
  const base = g.createLinearGradient(0, 0, w, 0);
  base.addColorStop(0, '#4a2c10');
  base.addColorStop(0.35, '#8a5a28');
  base.addColorStop(0.55, '#5c3814');
  base.addColorStop(1, '#3e2410');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const x = (i / 90) * w + Math.sin(i * 1.7) * 8;
    g.strokeStyle = `rgba(${20 + (i % 12)},${10 + (i % 8)},0,${0.04 + (i % 5) * 0.02})`;
    g.lineWidth = 1 + (i % 3);
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + 14, h * 0.33, x - 18, h * 0.66, x + 6, h);
    g.stroke();
  }
  for (let k = 0; k < 18; k++) {
    g.fillStyle = `rgba(255,210,140,${0.03 + (k % 4) * 0.015})`;
    g.fillRect((k * 47) % w, 0, 3, h);
  }
  return toTex(THREE, c, 2);
}

export function makeBrassMap(THREE, w = 256, h = 256) {
  const { c, g } = canvas2d(w, h);
  const grd = g.createRadialGradient(w * 0.35, h * 0.3, 8, w * 0.5, h * 0.5, w * 0.75);
  grd.addColorStop(0, '#ffe08a');
  grd.addColorStop(0.35, '#e0b24a');
  grd.addColorStop(0.7, '#b8860b');
  grd.addColorStop(1, '#6a4a08');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(255,255,220,${0.04 + Math.random() * 0.08})`;
    g.lineWidth = 1;
    const y = Math.random() * h;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y + (Math.random() - 0.5) * 6);
    g.stroke();
  }
  return toTex(THREE, c, 1);
}

export function makeMetalMap(THREE, w = 256, h = 256) {
  const { c, g } = canvas2d(w, h);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#d8e0ea');
  grd.addColorStop(0.5, '#8a96a8');
  grd.addColorStop(1, '#3a4450');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(255,255,255,${0.02 + (i % 3) * 0.02})`;
    g.fillRect(0, i * (h / 70), w, 1);
  }
  return toTex(THREE, c, 2);
}

export function makeStudioEnv(THREE) {
  const { c, g } = canvas2d(128, 64);
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#e8f0ff');
  grd.addColorStop(0.38, '#8ab0d8');
  grd.addColorStop(0.55, '#2a2010');
  grd.addColorStop(1, '#08060a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = 'rgba(255,230,160,0.35)';
  g.beginPath();
  g.ellipse(96, 14, 22, 10, 0, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function woodMat(THREE, map, env) {
  return new THREE.MeshStandardMaterial({
    map,
    roughness: 0.62,
    metalness: 0.04,
    envMap: env,
    envMapIntensity: 0.45,
    color: 0xc48848,
  });
}

export function brassMat(THREE, map, env, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xf0c850,
    roughness: 0.28,
    metalness: 0.92,
    envMap: env,
    envMapIntensity: 1.35,
    ...extra,
  });
}

export function steelMat(THREE, map, env, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map,
    color: 0xc5d0dc,
    roughness: 0.32,
    metalness: 0.88,
    envMap: env,
    envMapIntensity: 1.1,
    ...extra,
  });
}
