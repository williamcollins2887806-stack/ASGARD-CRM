import { CAPACITY, REAGENTS } from '../chemLabLogic';
import { resolveVisualState } from '../chemLabRenderer';
import { loadThree, makeRenderer, resizeRenderer, canUseWebGL } from './loadThree';
import { makeWoodMap, makeBrassMap, makeStudioEnv, woodMat, brassMat } from './procTextures';

const MAX_TUBES = 12;
const MAX_LAYERS = 8;
const STREAM_COUNT = 120;

function hexToVec3(hex) {
  const h = String(hex || '#888888').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function layoutTubes(n) {
  const count = Math.max(1, n);
  const rows = count <= 6 ? 1 : 2;
  const top = rows === 1 ? count : Math.ceil(count / 2);
  const bot = count - top;
  const gap = count >= 10 ? 0.62 : count >= 8 ? 0.68 : 0.78;
  const pos = [];
  const place = (num, z) => {
    const w = (num - 1) * gap;
    for (let i = 0; i < num; i++) pos.push({ x: -w / 2 + i * gap, z });
  };
  if (rows === 1) place(count, 0);
  else {
    place(top, -0.42);
    place(bot, 0.42);
  }
  return pos;
}

const LIQ_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
void main() {
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  vec4 w = modelViewMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * w;
}
`;

const LIQ_FRAG = /* glsl */ `
precision mediump float;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
uniform vec3 uColors[8];
uniform float uTops[8];
uniform int uCount;
uniform float uFill;
uniform float uTime;
uniform float uWave;
uniform float uMix;
uniform float uDim;

void main() {
  float h = vUv.y;
  if (h > uFill) discard;
  vec3 col = uColors[0];
  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    float top = uTops[i];
    float bot = i == 0 ? 0.0 : uTops[i - 1];
    float band = smoothstep(bot - 0.012, bot + 0.012, h) * (1.0 - smoothstep(top - 0.012, top + 0.012, h));
    col = mix(col, uColors[i], band);
  }
  // Candy saturation (Royal Match)
  float lum = dot(col, vec3(0.22, 0.67, 0.11));
  col = mix(vec3(lum), col, 1.38);
  col = col * 1.08 + 0.04;

  float nx = vN.x;
  col *= mix(0.78, 1.18, 0.5 + 0.5 * nx);
  vec3 V = normalize(-vW);
  float spec = pow(max(0.0, dot(reflect(-V, normalize(vN)), vec3(0.15, 0.7, 0.7))), 42.0);
  col += vec3(spec * 0.55);

  float men = 1.0 - smoothstep(0.0, 0.035, uFill - h);
  col = mix(col, col + vec3(0.18, 0.22, 0.28), men * 0.55);

  float wave = sin(uTime * 0.003 + vUv.x * 12.0) * uWave * 0.012;
  if (h > uFill + wave - 0.02 && uWave > 0.2) col += vec3(0.12);

  if (uMix > 0.2) {
    float b = fract(sin(dot(vUv, vec2(12.7, 4.1)) + uTime * 0.002) * 43758.5);
    col += vec3(0.12) * step(0.82, b) * uMix;
  }
  if (uDim > 0.5) col *= 0.62;
  gl_FragColor = vec4(col, 0.94);
}
`;

const GLASS_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 w = modelViewMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * w;
}
`;

const GLASS_FRAG = /* glsl */ `
precision mediump float;
varying vec3 vN;
varying vec3 vW;
uniform float uSel;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(-vW);
  float fres = pow(1.0 - abs(dot(n, v)), 2.6);
  vec3 rim = mix(vec3(0.65, 0.86, 1.0), vec3(1.0, 0.86, 0.45), uSel);
  gl_FragColor = vec4(rim, 0.06 + fres * 0.62);
}
`;

function makeSoft(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

export async function createChemLabScene3D(canvas) {
  if (!canvas || !canUseWebGL()) return null;
  let THREE;
  try {
    THREE = await loadThree();
  } catch {
    return null;
  }

  const renderer = makeRenderer(THREE, canvas, { exposure: 1.16, shadows: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.08, 40);
  camera.position.set(0, 2.05, 5.15);
  camera.lookAt(0, 0.72, 0);

  const env = makeStudioEnv(THREE);
  scene.environment = env;
  const woodMap = makeWoodMap(THREE);
  const brassMap = makeBrassMap(THREE);
  const wood = woodMat(THREE, woodMap, env);
  const brass = brassMat(THREE, brassMap, env);
  const soft = makeSoft(THREE);

  const bench = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.18, 2.4), wood);
  bench.position.y = -0.02;
  bench.receiveShadow = true;
  bench.castShadow = true;
  scene.add(bench);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(7.3, 0.08, 0.12), brass);
  lip.position.set(0, 0.1, 1.18);
  scene.add(lip);

  scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x1a1208, 0.75));
  const key = new THREE.DirectionalLight(0xfff4e0, 2.1);
  key.position.set(2.4, 5.2, 3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const amber = new THREE.PointLight(0xf0c850, 2.0, 12);
  amber.position.set(-2.2, 2.2, 2.4);
  scene.add(amber);
  const cool = new THREE.PointLight(0x4aa0ff, 1.1, 10);
  cool.position.set(2.4, 1.6, 1.8);
  scene.add(cool);

  const glassGeo = new THREE.CylinderGeometry(0.24, 0.24, 1.62, 32, 1, true);
  const liqGeo = new THREE.CylinderGeometry(0.205, 0.205, 1.0, 28, 8, true);
  liqGeo.translate(0, 0.5, 0);
  const rimGeo = new THREE.TorusGeometry(0.245, 0.03, 8, 24);
  const footGeo = new THREE.CylinderGeometry(0.27, 0.3, 0.08, 20);

  const tubes = [];
  for (let i = 0; i < MAX_TUBES; i++) {
    const group = new THREE.Group();
    group.visible = false;
    const uniforms = {
      uColors: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector3()) },
      uTops: { value: new Array(MAX_LAYERS).fill(0) },
      uCount: { value: 1 },
      uFill: { value: 0 },
      uTime: { value: 0 },
      uWave: { value: 0 },
      uMix: { value: 0 },
      uDim: { value: 0 },
    };
    const liqMat = new THREE.ShaderMaterial({
      uniforms, vertexShader: LIQ_VERT, fragmentShader: LIQ_FRAG, transparent: true, side: THREE.DoubleSide,
    });
    const glassMat = new THREE.ShaderMaterial({
      uniforms: { uSel: { value: 0 } },
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const liquid = new THREE.Mesh(liqGeo, liqMat);
    liquid.position.y = 0.08;
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.y = 0.89;
    glass.renderOrder = 2;
    const rim = new THREE.Mesh(rimGeo, brass);
    rim.position.y = 1.7;
    rim.rotation.x = Math.PI / 2;
    const foot = new THREE.Mesh(footGeo, brass);
    foot.position.y = 0.04;
    foot.castShadow = true;
    group.add(foot, liquid, glass, rim);
    scene.add(group);
    tubes.push({ group, liquid, glass, glassMat, uniforms, liqMat });
  }

  const streamPos = new Float32Array(STREAM_COUNT * 3);
  const streamCol = new Float32Array(STREAM_COUNT * 3);
  const streamGeo = new THREE.BufferGeometry();
  streamGeo.setAttribute('position', new THREE.BufferAttribute(streamPos, 3));
  streamGeo.setAttribute('color', new THREE.BufferAttribute(streamCol, 3));
  const streamMat = new THREE.PointsMaterial({
    size: 0.09, map: soft, vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stream = new THREE.Points(streamGeo, streamMat);
  stream.visible = false;
  stream.frustumCulled = false;
  scene.add(stream);

  const hits = [];
  let disposed = false;
  let viewW = 1;
  let viewH = 1;
  let failPts = null;
  let failAlive = false;
  let winPts = null;
  let winAlive = false;

  function resize(w, h) {
    viewW = Math.max(1, w);
    viewH = Math.max(1, h);
    resizeRenderer(renderer, camera, viewW, viewH);
  }

  function project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: (v.x * 0.5 + 0.5) * viewW, y: (-v.y * 0.5 + 0.5) * viewH };
  }

  function bez(u, a, b, c) {
    const t = 1 - u;
    return t * t * a + 2 * t * u * b + u * u * c;
  }

  function clearFail() {
    failAlive = false;
    if (failPts) {
      scene.remove(failPts);
      failPts.geometry.dispose();
      failPts.material.dispose();
      failPts = null;
    }
  }

  function burstFail(sx, sy, vfx = 'explosion') {
    if (disposed) return;
    clearFail();
    const ndcX = (sx / viewW) * 2 - 1;
    const ndcY = -(sy / viewH) * 2 + 1;
    const wpos = new THREE.Vector3(ndcX, ndcY, 0.7).unproject(camera);
    const count = vfx === 'explosion' ? 220 : 160;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const vel = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = wpos.x; pos[i * 3 + 1] = wpos.y; pos[i * 3 + 2] = wpos.z;
      const a = Math.random() * Math.PI * 2;
      const sp = (vfx === 'explosion' ? 2.2 : 1.3) * (0.4 + Math.random());
      vel.push({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 0.8, vz: (Math.random() - 0.5) * sp });
      if (vfx === 'gas') { col[i * 3] = 0.35; col[i * 3 + 1] = 0.95; col[i * 3 + 2] = 0.3; }
      else if (vfx === 'boil') { col[i * 3] = 1; col[i * 3 + 1] = 0.72; col[i * 3 + 2] = 0.2; }
      else { col[i * 3] = 1; col[i * 3 + 1] = 0.35 + Math.random() * 0.4; col[i * 3 + 2] = 0.08; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.11, map: soft, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    failPts = new THREE.Points(geo, mat);
    failPts.frustumCulled = false;
    scene.add(failPts);
    failAlive = true;
    const t0 = performance.now();
    const tick = (now) => {
      if (!failAlive || disposed) return;
      const u = Math.min(1, (now - t0) / 1100);
      const arr = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        vel[i].vy -= 2.8 * 0.016;
        arr[i * 3] += vel[i].vx * 0.016;
        arr[i * 3 + 1] += vel[i].vy * 0.016;
        arr[i * 3 + 2] += vel[i].vz * 0.016;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1 - u * u;
      if (u < 1) requestAnimationFrame(tick);
      else clearFail();
    };
    requestAnimationFrame(tick);
  }

  function burstWin() {
    if (disposed) return;
    if (winPts) {
      scene.remove(winPts);
      winPts.geometry.dispose();
      winPts.material.dispose();
    }
    const count = 180;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const vel = [];
    const palette = [[1, 0.82, 0.2], [1, 0.4, 0.55], [0.4, 0.85, 1], [0.55, 1, 0.45], [0.75, 0.45, 1]];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 1.2;
      pos[i * 3 + 1] = 1.1;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
      vel.push({ vx: (Math.random() - 0.5) * 2.4, vy: 1.5 + Math.random() * 2.2, vz: (Math.random() - 0.5) * 2.4 });
      const p = palette[i % palette.length];
      col[i * 3] = p[0]; col[i * 3 + 1] = p[1]; col[i * 3 + 2] = p[2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.1, map: soft, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    winPts = new THREE.Points(geo, mat);
    scene.add(winPts);
    winAlive = true;
    const t0 = performance.now();
    const tick = (now) => {
      if (!winAlive || disposed) return;
      const u = Math.min(1, (now - t0) / 1400);
      const arr = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        vel[i].vy -= 4.2 * 0.016;
        arr[i * 3] += vel[i].vx * 0.016;
        arr[i * 3 + 1] += vel[i].vy * 0.016;
        arr[i * 3 + 2] += vel[i].vz * 0.016;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1 - u * u;
      if (u < 1) requestAnimationFrame(tick);
      else {
        winAlive = false;
        if (winPts) {
          scene.remove(winPts);
          winPts.geometry.dispose();
          winPts.material.dispose();
          winPts = null;
        }
      }
    };
    requestAnimationFrame(tick);
  }

  function render(state) {
    if (disposed) return;
    const {
      width, height, cans = [], reagents = {}, pourVisual = null,
      mixIdx = null, selected = null, shakeIdx = null, time = 0, reducedMotion = false,
    } = state;
    if (width !== viewW || height !== viewH) resize(width, height);

    const n = cans.length;
    const pos = layoutTubes(n);
    const vis = resolveVisualState(cans, pourVisual);
    hits.length = 0;
    const mouths = [];

    for (let i = 0; i < MAX_TUBES; i++) {
      const slot = tubes[i];
      if (i >= n) {
        slot.group.visible = false;
        continue;
      }
      slot.group.visible = true;
      const p = pos[i];
      const can = vis.list[i] || { layers: [], capacity: CAPACITY };
      const isSrc = pourVisual && pourVisual.from === i;
      const isDst = pourVisual && pourVisual.to === i;
      const tiltAmt = (pourVisual?.tilt || 0) * (pourVisual?.tiltDir === 'left' ? -0.55 : 0.55);
      const lift = isSrc ? (pourVisual?.lift || 0) * 0.012 : (selected === i ? 0.16 : 0);
      const shake = shakeIdx === i ? Math.sin(time * 0.06) * 0.06 : 0;
      slot.group.position.set(p.x + shake, lift, p.z);
      slot.group.rotation.z = isSrc ? tiltAmt : 0;
      slot.group.scale.setScalar(selected === i ? 1.08 : 1);

      const cap = can.capacity || CAPACITY;
      const layers = can.layers.slice();
      const fracMissing = vis.from === i ? vis.fracSrc : 0;
      const fracExtra = vis.to === i ? vis.fracDst : 0;
      const colors = [];
      const tops = [];
      let acc = 0;
      for (let li = 0; li < layers.length; li++) {
        let hh = 1;
        if (li === layers.length - 1 && fracMissing > 0) hh = 1 - fracMissing;
        acc += hh;
        const code = layers[li];
        const hex = reagents[code]?.color || REAGENTS[code]?.color || '#888';
        colors.push(hexToVec3(hex));
        tops.push(Math.min(1, acc / cap));
      }
      if (fracExtra > 0.02) {
        const hex = vis.transferCode
          ? (reagents[vis.transferCode]?.color || pourVisual?.color || '#888')
          : (pourVisual?.color || '#888');
        colors.push(hexToVec3(hex));
        acc += fracExtra;
        tops.push(Math.min(1, acc / cap));
      }
      while (colors.length < MAX_LAYERS) {
        colors.push([0, 0, 0]);
        tops.push(tops.length ? tops[tops.length - 1] : 0);
      }
      const fillUnits = layers.length - fracMissing + fracExtra;
      const fill = Math.max(0, Math.min(1, fillUnits / cap));
      const u = slot.uniforms;
      for (let k = 0; k < MAX_LAYERS; k++) {
        u.uColors.value[k].set(colors[k][0], colors[k][1], colors[k][2]);
        u.uTops.value[k] = tops[k];
      }
      u.uCount.value = Math.max(1, Math.min(MAX_LAYERS, layers.length + (fracExtra > 0.02 ? 1 : 0)));
      u.uFill.value = fill;
      u.uTime.value = time + i * 40;
      u.uWave.value = reducedMotion ? 0 : (0.15 + (isDst ? (pourVisual?.wave || 0) : 0));
      u.uMix.value = mixIdx === i || (isDst && (pourVisual?.wave || 0) > 0.15) ? 1 : 0;
      u.uDim.value = selected != null && selected !== i ? 1 : 0;
      slot.liquid.scale.y = 1.52;
      slot.liquid.visible = fill > 0.02;
      slot.glassMat.uniforms.uSel.value = selected === i ? 1 : 0;

      const mouth = slot.group.localToWorld(new THREE.Vector3(0, 1.72, 0));
      mouths[i] = mouth;
      const top = project(p.x, 1.72 + lift, p.z);
      const bot = project(p.x, 0.02, p.z);
      const mid = project(p.x + 0.24, 0.8, p.z);
      hits[i] = {
        x: top.x - Math.abs(mid.x - top.x) - 8,
        y: top.y - 8,
        w: Math.abs(mid.x - top.x) * 2 + 16,
        h: Math.max(80, bot.y - top.y + 16),
      };
    }

    const showStream = pourVisual && !pourVisual.fail && (pourVisual.streamAlpha || 0) > 0.02
      && mouths[pourVisual.from] && mouths[pourVisual.to] && !reducedMotion;
    if (showStream) {
      const a = mouths[pourVisual.from];
      const b = mouths[pourVisual.to];
      const mx = (a.x + b.x) / 2;
      const my = Math.max(a.y, b.y) + 0.55;
      const mz = (a.z + b.z) / 2;
      const rgb = hexToVec3(pourVisual.color || '#888');
      for (let i = 0; i < STREAM_COUNT; i++) {
        const u = ((time * 0.0018) + i / STREAM_COUNT) % 1;
        streamPos[i * 3] = bez(u, a.x, mx, b.x) + (Math.sin(i + time * 0.01) * 0.03);
        streamPos[i * 3 + 1] = bez(u, a.y, my, b.y * 0.55 + 0.2);
        streamPos[i * 3 + 2] = bez(u, a.z, mz, b.z);
        const br = 0.7 + 0.3 * Math.sin(u * Math.PI);
        streamCol[i * 3] = rgb[0] * br;
        streamCol[i * 3 + 1] = rgb[1] * br;
        streamCol[i * 3 + 2] = rgb[2] * br;
      }
      streamGeo.attributes.position.needsUpdate = true;
      streamGeo.attributes.color.needsUpdate = true;
      streamMat.opacity = 0.4 + pourVisual.streamAlpha * 0.6;
      stream.visible = true;
    } else stream.visible = false;

    camera.position.x = Math.sin(time * 0.00015) * 0.12;
    renderer.render(scene, camera);
  }

  function getHits() {
    return hits;
  }

  function dispose() {
    disposed = true;
    clearFail();
    winAlive = false;
    renderer.dispose();
  }

  resize(canvas.clientWidth || 1, canvas.clientHeight || 1);
  return { resize, render, burstFail, burstWin, dispose, getHits, clearFail };
}

export { canUseWebGL, MAX_TUBES };
