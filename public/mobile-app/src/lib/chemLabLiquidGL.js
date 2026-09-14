/**
 * Persistent WebGL liquid layer for ChemLab (one Three.js context).
 * Tubes + ribbon stream + fail burst. Pixel orthographic space (Y down).
 */
import { CAPACITY, REAGENTS } from './chemLabLogic';
import { resolveVisualState, measureTube } from './chemLabRenderer';
import { canUseWebGL } from '@/components/field/VikingAvatar3D';

const MAX_TUBES = 16;
const MAX_LAYERS = 8;
const STREAM_COUNT = 96;

function hexToVec3(hex) {
  const h = String(hex || '#888888').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function makeSoftTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const LIQUID_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LIQUID_FRAG = /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform vec3 uColors[8];
uniform float uTops[8];
uniform int uCount;
uniform float uFill;
uniform float uTime;
uniform float uWave;
uniform float uMix;
uniform float uDim;
uniform float uRadius;
uniform vec2 uSize;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  // vUv: x 0..1 left-right, y 0..1 bottom-top (Three PlaneGeometry)
  vec2 p = (vUv - 0.5) * uSize;
  float halfW = uSize.x * 0.5;
  float halfH = uSize.y * 0.5;
  float d = sdRoundBox(p, vec2(halfW, halfH), uRadius);
  float alphaMask = 1.0 - smoothstep(-1.2, 1.2, d);
  if (alphaMask < 0.02) discard;

  float heightFromBottom = 1.0 - vUv.y;
  // Quiet surface — real cans barely ripple at rest
  float wave = sin(uTime * 0.0028 + vUv.x * 7.0) * uWave * 0.007
             + sin(uTime * 0.0046 + vUv.x * 16.0) * uWave * 0.0025;
  float surface = clamp(uFill + wave, 0.0, 1.05);
  if (heightFromBottom > surface) discard;

  vec3 col = uColors[0];
  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    float top = uTops[i];
    float bot = i == 0 ? 0.0 : uTops[i - 1];
    float band = smoothstep(bot - 0.05, bot + 0.05, heightFromBottom)
               * (1.0 - smoothstep(top - 0.05, top + 0.05, heightFromBottom));
    col = mix(col, uColors[i], band);
  }
  float lum = dot(col, vec3(0.22, 0.67, 0.11));
  col = mix(vec3(lum), col, 1.38);
  col = col * 1.08 + 0.04;

  // Mild cylinder shading — keep hue readable
  float nx = (vUv.x - 0.5) * 2.0;
  col *= mix(0.86, 1.1, 1.0 - nx * nx * 0.5);
  if (uDim > 0.5) col *= 0.82;

  // Meniscus + candy rim
  float men = 1.0 - smoothstep(0.0, 0.055, surface - heightFromBottom);
  col = mix(col, col * 1.22 + vec3(0.1), men * 0.62);
  col = mix(col, vec3(1.0), men * 0.2);

  // Slow caustic streak
  float cau = pow(max(0.0, sin(vUv.x * 12.0 + uTime * 0.0028 + heightFromBottom * 7.0)), 10.0);
  col += vec3(0.14, 0.18, 0.22) * cau * 0.28 * (0.4 + uMix);

  float dens = 1.2 + uMix * 8.0 + max(0.0, uWave) * 4.0;
  for (int b = 0; b < 8; b++) {
    float fi = float(b);
    vec2 cell = vec2(hash(vec2(fi, 1.3)), hash(vec2(fi, 7.1)));
    float rise = fract(uTime * (0.00028 + fi * 0.00004) + cell.y);
    vec2 bp = vec2(0.16 + cell.x * 0.68, 1.0 - rise * surface * 0.9);
    float rad = 0.012 + fract(cell.x * 9.0) * 0.014 * (1.0 + uMix * 0.6);
    float bd = length((vUv - bp) * vec2(1.0, uSize.y / max(uSize.x, 1.0)));
    float bubble = smoothstep(rad, rad * 0.2, bd);
    col = mix(col, vec3(1.0), bubble * 0.32 * dens / 10.0);
  }

  float a = alphaMask * mix(0.92, 0.98, men);
  gl_FragColor = vec4(col, a);
}
`;

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<object|null>}
 */
export async function createLiquidGL(canvas) {
  if (!canvas || !canUseWebGL()) return null;

  let THREE;
  try {
    THREE = await import('three');
  } catch {
    return null;
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    premultipliedAlpha: false,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;

  const scene = new THREE.Scene();
  // Y-down pixel space to match Canvas2D / layouts
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -100, 100);
  camera.position.z = 10;

  const softMap = makeSoftTexture(THREE);

  const tubes = [];
  for (let i = 0; i < MAX_TUBES; i++) {
    const uniforms = {
      uColors: { value: Array.from({ length: MAX_LAYERS }, () => new THREE.Vector3(0.5, 0.5, 0.5)) },
      uTops: { value: new Array(MAX_LAYERS).fill(0) },
      uCount: { value: 1 },
      uFill: { value: 0 },
      uTime: { value: 0 },
      uWave: { value: 0 },
      uMix: { value: 0 },
      uDim: { value: 0 },
      uRadius: { value: 10 },
      uSize: { value: new THREE.Vector2(60, 120) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: LIQUID_VERT,
      fragmentShader: LIQUID_FRAG,
      transparent: true,
      depthWrite: false,
      // Ortho Y-down flips winding → FrontSide would cull all tube planes
      // (stream Points still render — matches “only pour stream visible”).
      side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.Mesh(geo, mat);
    const pivot = new THREE.Object3D();
    pivot.add(mesh);
    pivot.visible = false;
    scene.add(pivot);
    tubes.push({ pivot, mesh, mat, uniforms });
  }

  // Stream points
  const streamPos = new Float32Array(STREAM_COUNT * 3);
  const streamCol = new Float32Array(STREAM_COUNT * 3);
  const streamGeo = new THREE.BufferGeometry();
  streamGeo.setAttribute('position', new THREE.BufferAttribute(streamPos, 3));
  streamGeo.setAttribute('color', new THREE.BufferAttribute(streamCol, 3));
  const streamMat = new THREE.PointsMaterial({
    size: 14,
    map: softMap,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: false,
  });
  const streamPoints = new THREE.Points(streamGeo, streamMat);
  streamPoints.visible = false;
  streamPoints.frustumCulled = false;
  scene.add(streamPoints);

  // Splash bloom sprite at destination
  const bloomMat = new THREE.SpriteMaterial({
    map: softMap,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const bloom = new THREE.Sprite(bloomMat);
  bloom.scale.set(40, 40, 1);
  bloom.visible = false;
  scene.add(bloom);

  let failPoints = null;
  let failAlive = false;
  let failRaf = 0;
  let disposed = false;
  let viewW = 1;
  let viewH = 1;

  function resize(w, h) {
    if (disposed) return;
    viewW = Math.max(1, w);
    viewH = Math.max(1, h);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(viewW, viewH, false);
    camera.left = 0;
    camera.right = viewW;
    camera.top = 0;
    camera.bottom = viewH;
    camera.updateProjectionMatrix();
  }

  function clearFail() {
    failAlive = false;
    if (failRaf) cancelAnimationFrame(failRaf);
    failRaf = 0;
    if (failPoints) {
      scene.remove(failPoints);
      failPoints.geometry.dispose();
      failPoints.material.dispose();
      failPoints = null;
    }
  }

  function burstFail(x, y, vfx = 'explosion') {
    if (disposed) return;
    clearFail();
    const count = vfx === 'explosion' ? 180 : vfx === 'gas' ? 140 : 120;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 2;
      const a = Math.random() * Math.PI * 2;
      const sp = vfx === 'explosion' ? 80 + Math.random() * 220 : 40 + Math.random() * 120;
      velocities.push({
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (vfx === 'gas' ? 30 : 10),
      });
      if (vfx === 'gas') {
        colors[i * 3] = 0.3; colors[i * 3 + 1] = 0.85; colors[i * 3 + 2] = 0.35;
      } else if (vfx === 'boil') {
        colors[i * 3] = 1; colors[i * 3 + 1] = 0.7; colors[i * 3 + 2] = 0.2;
      } else {
        colors[i * 3] = 1; colors[i * 3 + 1] = 0.4 + Math.random() * 0.4; colors[i * 3 + 2] = 0.1;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: vfx === 'explosion' ? 10 : 12,
      map: softMap,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: false,
    });
    failPoints = new THREE.Points(geo, mat);
    failPoints.frustumCulled = false;
    scene.add(failPoints);
    failAlive = true;
    const t0 = performance.now();
    const life = vfx === 'explosion' ? 1100 : 1300;
    const tick = (now) => {
      if (!failAlive || disposed) return;
      const u = Math.min(1, (now - t0) / life);
      const dt = 0.016;
      const pos = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        const v = velocities[i];
        v.vy += (vfx === 'gas' ? 20 : 280) * dt;
        pos[i * 3] += v.vx * dt;
        pos[i * 3 + 1] += v.vy * dt;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1 - u * u;
      mat.size = (vfx === 'explosion' ? 10 : 12) * (1 + u * 0.8);
      // Main stage RAF renders the shared scene; do not render here.
      if (u < 1) failRaf = requestAnimationFrame(tick);
      else clearFail();
    };
    failRaf = requestAnimationFrame(tick);
  }

  function bez(u, a, b, c) {
    const t = 1 - u;
    return t * t * a + 2 * t * u * b + u * u * c;
  }

  function render(state) {
    if (disposed) return;
    const {
      width, height, layouts = [], cans = [], reagents = {},
      pourVisual = null, mixIdx = null, selected = null, shakeIdx = null,
      time = 0, reducedMotion = false,
    } = state;

    if (width !== viewW || height !== viewH) resize(width, height);

    const vis = resolveVisualState(cans, pourVisual);
    const dimOthers = selected != null;
    const mouths = [];

    for (let i = 0; i < MAX_TUBES; i++) {
      const slot = tubes[i];
      const L = layouts[i];
      if (!L || i >= cans.length) {
        slot.pivot.visible = false;
        continue;
      }

      const can = vis.list[i] || { layers: [], capacity: CAPACITY };
      const isSrc = pourVisual && pourVisual.from === i;
      const isDst = pourVisual && pourVisual.to === i;
      const tiltAmt = (pourVisual?.tilt || 0) * (pourVisual?.tiltDir === 'left' ? -0.7 : 0.7);
      const tilt = isSrc ? tiltAmt : 0;
      const lift = isSrc ? (pourVisual?.lift || 0) : (selected === i ? 14 : 0);
      const shakeX = shakeIdx === i ? Math.sin(time * 0.055) * 5 : 0;
      const tube = measureTube(L.x, L.y, L.w, L.h, lift, shakeX);

      const fracMissing = vis.from === i ? vis.fracSrc : 0;
      const fracExtra = vis.to === i ? vis.fracDst : 0;
      const layers = can.layers.slice();
      const cap = can.capacity || CAPACITY;
      let fillUnits = layers.length - fracMissing + fracExtra;

      // Append phantom color for partial unit into dst
      const colors = [];
      const tops = [];
      let acc = 0;
      for (let li = 0; li < layers.length; li++) {
        let h = 1;
        if (li === layers.length - 1 && fracMissing > 0) h = 1 - fracMissing;
        acc += h;
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

      const fill = Math.max(0, Math.min(1, fillUnits / cap));
      const wave = isDst ? (pourVisual?.wave || 0) : 0;
      const mix = (mixIdx === i || (isDst && (pourVisual?.wave || 0) > 0.15) || (isDst && (pourVisual?.streamAlpha || 0) > 0.1)) ? 1 : 0;

      const u = slot.uniforms;
      for (let k = 0; k < MAX_LAYERS; k++) {
        u.uColors.value[k].set(colors[k][0], colors[k][1], colors[k][2]);
        u.uTops.value[k] = tops[k];
      }
      u.uCount.value = Math.max(1, Math.min(MAX_LAYERS, layers.length + (fracExtra > 0.02 ? 1 : 0)));
      u.uFill.value = fill;
      u.uTime.value = time + i * 40;
      // Idle almost flat; pour only slight ripple
      u.uWave.value = reducedMotion ? 0 : (0.12 + wave * 0.7 + (isDst && pourVisual?.streamAlpha ? 0.2 : 0));
      u.uMix.value = mix;
      u.uDim.value = dimOthers && selected !== i ? 1 : 0;
      u.uRadius.value = 11;
      u.uSize.value.set(tube.iw, tube.ih);

      // Pivot at rotate origin; mesh offset to liquid rect center
      slot.pivot.position.set(tube.cx, tube.originY, 0);
      slot.pivot.rotation.z = tilt;
      slot.mesh.position.set(0, (tube.iy + tube.ih / 2) - tube.originY, 0);
      slot.mesh.scale.set(tube.iw, tube.ih, 1);
      slot.pivot.visible = fill > 0.01;

      // Empty label is C2D glass pass responsibility when fill≈0

      const mouthX = tube.cx + Math.sin(tilt) * (tube.shellH * 0.42);
      const mouthY = tube.iy + 4 - lift;
      mouths[i] = {
        x: mouthX,
        y: mouthY,
        midX: tube.cx,
        midY: tube.iy + tube.ih * 0.28 - lift,
      };
    }

    // Stream ribbon
    const showStream = pourVisual && !pourVisual.fail && (pourVisual.streamAlpha || 0) > 0.02
      && mouths[pourVisual.from] && mouths[pourVisual.to] && !reducedMotion;
    if (showStream) {
      const a = mouths[pourVisual.from];
      const b = mouths[pourVisual.to];
      const x1 = a.x;
      const y1 = a.y;
      const x2 = b.midX;
      const y2 = b.midY + 8;
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12;
      const my = Math.min(y1, y2) - 28;
      const rgb = hexToVec3(pourVisual.color || '#888');
      const alpha = pourVisual.streamAlpha;
      for (let i = 0; i < STREAM_COUNT; i++) {
        const baseU = i / (STREAM_COUNT - 1);
        const travel = ((time * 0.0015) + baseU) % 1;
        const jitter = (hash1(i) - 0.5) * 0.04;
        const u = Math.max(0, Math.min(1, travel + jitter));
        const px = bez(u, x1, mx, x2) + (hash1(i + 3) - 0.5) * 6 * Math.sin(u * Math.PI);
        const py = bez(u, y1, my, y2) + (hash1(i + 7) - 0.5) * 4 * Math.sin(u * Math.PI);
        streamPos[i * 3] = px;
        streamPos[i * 3 + 1] = py;
        streamPos[i * 3 + 2] = 1;
        const bright = 0.7 + 0.3 * Math.sin(u * Math.PI);
        streamCol[i * 3] = rgb[0] * bright;
        streamCol[i * 3 + 1] = rgb[1] * bright;
        streamCol[i * 3 + 2] = rgb[2] * bright;
      }
      streamGeo.attributes.position.needsUpdate = true;
      streamGeo.attributes.color.needsUpdate = true;
      streamMat.opacity = 0.5 + alpha * 0.5;
      streamMat.size = 15 + Math.sin(time * 0.012) * 3;
      streamPoints.visible = true;

      bloom.visible = true;
      bloom.position.set(x2, y2, 1.5);
      bloom.scale.set(36 + alpha * 20, 36 + alpha * 20, 1);
      bloomMat.color.setRGB(rgb[0], rgb[1], rgb[2]);
      bloomMat.opacity = 0.25 + alpha * 0.45;
    } else {
      streamPoints.visible = false;
      bloom.visible = false;
    }

    renderer.render(scene, camera);
  }

  function hash1(n) {
    const x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  }

  function dispose() {
    disposed = true;
    clearFail();
    tubes.forEach(({ pivot, mesh, mat }) => {
      scene.remove(pivot);
      mesh.geometry.dispose();
      mat.dispose();
    });
    scene.remove(streamPoints);
    streamGeo.dispose();
    streamMat.dispose();
    scene.remove(bloom);
    bloomMat.dispose();
    softMap.dispose();
    renderer.dispose();
  }

  resize(canvas.clientWidth || 1, canvas.clientHeight || 1);

  return { resize, render, burstFail, dispose, clearFail };
}

export { canUseWebGL };
