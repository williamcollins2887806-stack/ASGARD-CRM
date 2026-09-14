import { loadThree, makeRenderer, resizeRenderer, canUseWebGL } from './loadThree';
import { makeMetalMap, makeBrassMap, makeStudioEnv, steelMat, brassMat } from './procTextures';

const P = { EMPTY: 0, STR: 1, ELB: 2, TEE: 3, SRC: 5, DRN: 6, RUST: 7, CLOG: 8, BROKEN: 9, ROOT: 10 };
const CONN = [0, 0b1010, 0b1100, 0b1110, 0, 0b0100, 0b1000, 0b1010, 0b1010, 0b1010, 0b1010];

function rotMask(mask, rot) {
  let m = mask;
  const n = ((rot % 4) + 4) % 4;
  for (let i = 0; i < n; i++) m = ((m << 1) | (m >> 3)) & 0xf;
  return m;
}

function hexColor(THREE, hex) {
  return new THREE.Color(hex);
}

function makeArmGeo(THREE) {
  const geo = new THREE.CylinderGeometry(0.16, 0.16, 0.52, 20);
  geo.translate(0, 0.26, 0);
  return geo;
}

function worldAccent(name = '') {
  const n = String(name).toUpperCase();
  if (n.includes('УТГАРД')) return 0x4ade80;
  if (n.includes('НИФЛЬ')) return 0xa5f3fc;
  if (n.includes('МУСПЕЛЬ')) return 0xfb923c;
  if (n.includes('АСГАРД')) return 0xf0c850;
  return 0x38bdf8;
}

/**
 * Isometric 3D pipe board. Overlay DOM grid for hits.
 */
export async function createPipelineBoard3D(canvas) {
  if (!canvas || !canUseWebGL()) return null;
  let THREE;
  try {
    THREE = await loadThree();
  } catch {
    return null;
  }

  const renderer = makeRenderer(THREE, canvas, { exposure: 1.2, shadows: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  const env = makeStudioEnv(THREE);
  scene.environment = env;
  scene.fog = new THREE.Fog(0x070a12, 12, 28);

  const metalMap = makeMetalMap(THREE);
  const brassMap = makeBrassMap(THREE);
  const steel = steelMat(THREE, metalMap, env);
  const steelHot = steelMat(THREE, metalMap, env, { emissive: 0x123848, emissiveIntensity: 0.35, color: 0xb8e8ff });
  const steelFlow = steelMat(THREE, metalMap, env, { emissive: 0x1a6a9a, emissiveIntensity: 0.85, color: 0xd8f6ff });
  const brass = brassMat(THREE, brassMap, env);
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x8a4a18, roughness: 0.86, metalness: 0.2, envMap: env });
  const iceMat = new THREE.MeshPhysicalMaterial({
    color: 0xc4eeff, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.42,
    transmission: 0.35, thickness: 0.3, envMap: env,
  });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x3ecbff, emissive: 0x1480c8, emissiveIntensity: 1.1, roughness: 0.2, metalness: 0.35,
  });
  const goldMat = brass.clone();
  const clogMat = new THREE.MeshStandardMaterial({ color: 0x4a7a32, roughness: 0.8, metalness: 0.1 });
  const rootMat = new THREE.MeshStandardMaterial({ color: 0x3d6b2a, roughness: 0.75, metalness: 0.05 });
  const brokenMat = new THREE.MeshStandardMaterial({ color: 0x9a2030, roughness: 0.55, metalness: 0.4, emissive: 0x400010, emissiveIntensity: 0.4 });

  const armGeo = makeArmGeo(THREE);
  const jointGeo = new THREE.SphereGeometry(0.2, 20, 16);
  const jointRingGeo = new THREE.TorusGeometry(0.2, 0.035, 8, 20);

  const board = new THREE.Group();
  scene.add(board);

  const hemi = new THREE.HemisphereLight(0xb8d4ff, 0x1a1208, 0.7);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff3dd, 2.3);
  key.position.set(4, 10, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const fill = new THREE.PointLight(0x38bdf8, 1.4, 18);
  fill.position.set(-3, 4, 4);
  scene.add(fill);

  const tiles = [];
  let size = 0;
  let spacing = 1.15;
  let disposed = false;
  let raf = 0;
  let time = 0;
  let accent = 0x38bdf8;
  const visualRot = [];
  const pulse = [];

  function clearTiles() {
    const toKill = [...board.children];
    toKill.forEach((ch) => board.remove(ch));
    tiles.length = 0;
    visualRot.length = 0;
    pulse.length = 0;
  }

  function addArm(group, bit, mat) {
    const m = new THREE.Mesh(armGeo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    if (bit === 1) m.rotation.x = -Math.PI / 2; // N -Z
    else if (bit === 2) m.rotation.z = -Math.PI / 2; // E +X
    else if (bit === 4) m.rotation.x = Math.PI / 2; // S +Z
    else if (bit === 8) m.rotation.z = Math.PI / 2; // W -X
    group.add(m);
    return m;
  }

  function buildPipe(cell, connected, flowing) {
    const g = new THREE.Group();
    const mask = rotMask(CONN[cell.t] || 0, 0); // rotation applied on group
    const mat = flowing ? steelFlow : connected ? steelHot : steel;
    [1, 2, 4, 8].forEach((b) => {
      if (mask & b) addArm(g, b, mat);
    });
    const joint = new THREE.Mesh(jointGeo, flowing || connected ? waterMat : steel);
    joint.castShadow = true;
    g.add(joint);
    const ring = new THREE.Mesh(jointRingGeo, brass);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);

    if (cell.t === P.SRC) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 16), waterMat);
      bulb.position.y = 0.28;
      g.add(bulb);
    }
    if (cell.t === P.DRN) {
      const cup = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.38, 16), goldMat);
      cup.position.y = 0.22;
      g.add(cup);
    }
    if (cell.t === P.RUST && !cell.rustCleared) {
      const crust = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), rustMat);
      g.add(crust);
    }
    if (cell.t === P.CLOG && !cell.clogCleared) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), clogMat);
      g.add(blob);
    }
    if (cell.t === P.BROKEN && !cell.brokenCleared) {
      const crack = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), brokenMat);
      g.add(crack);
    }
    if (cell.t === P.ROOT && !cell.rootCleared) {
      const vine = new THREE.Mesh(new THREE.TorusKnotGeometry(0.16, 0.04, 40, 6), rootMat);
      vine.scale.set(1, 0.7, 1);
      g.add(vine);
    }
    if (cell.ice) {
      const ice = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), iceMat);
      g.add(ice);
    }
    return g;
  }

  function layoutCamera() {
    const span = Math.max(1, size) * spacing;
    const dist = span * 1.35 + 2.2;
    camera.position.set(span * 0.08, dist * 0.72, dist * 0.78);
    camera.lookAt(0, 0.1, 0);
    fill.color = hexColor(THREE, accent);
  }

  function rebuild(nextSize) {
    clearTiles();
    size = nextSize;
    spacing = size >= 8 ? 0.92 : size >= 6 ? 1.02 : 1.15;
    const origin = -((size - 1) * spacing) / 2;
    const baseGeo = new THREE.BoxGeometry(size * spacing + 0.8, 0.12, size * spacing + 0.8);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x121a28, roughness: 0.7, metalness: 0.25, envMap: env,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -0.28;
    base.receiveShadow = true;
    const wrap = new THREE.Group();
    wrap.add(base);
    board.add(wrap);

    for (let i = 0; i < size * size; i++) {
      const r = Math.floor(i / size);
      const c = i % size;
      const group = new THREE.Group();
      group.position.set(origin + c * spacing, 0, origin + r * spacing);
      board.add(group);
      tiles.push({ group, pipe: null, wrap });
      visualRot[i] = 0;
      pulse[i] = 0;
    }
    layoutCamera();
  }

  function setState(s) {
    if (disposed) return;
    const nextSize = s.size || 5;
    if (nextSize !== size) rebuild(nextSize);
    accent = worldAccent(s.worldName);
    fill.color.setHex(accent);
    const grid = s.grid || [];
    const reachable = s.reachable || new Set();
    const flowPath = s.flowPath || [];
    const ghost = s.ghostPath || [];
    const hl = s.highlight ?? -1;
    const flashIdx = s.flashIdx ?? -1;
    const pulseCells = s.pulseCells || [];

    for (let i = 0; i < tiles.length; i++) {
      const cell = grid[i];
      const tile = tiles[i];
      if (!cell || cell.t === P.EMPTY) {
        if (tile.pipe) {
          tile.group.remove(tile.pipe);
          tile.pipe = null;
        }
        tile.group.visible = false;
        continue;
      }
      tile.group.visible = true;
      const connected = reachable.has(i);
      const flowing = flowPath.includes(i);
      const sig = `${cell.t}:${cell.rustCleared}:${cell.clogCleared}:${cell.brokenCleared}:${cell.rootCleared}:${cell.ice}:${connected}:${flowing}`;
      if (tile.sig !== sig) {
        if (tile.pipe) tile.group.remove(tile.pipe);
        tile.pipe = buildPipe(cell, connected, flowing);
        tile.group.add(tile.pipe);
        tile.sig = sig;
        visualRot[i] = (cell.r || 0) * (Math.PI / 2);
      }
      const target = (cell.r || 0) * (Math.PI / 2);
      const vr = visualRot[i] ?? target;
      let d = target - vr;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      visualRot[i] = vr + d * 0.28;
      if (tile.pipe) tile.pipe.rotation.y = visualRot[i];

      const wantPulse = pulseCells.includes(i) || flashIdx === i || ghost.includes(i);
      pulse[i] = wantPulse ? 1 : (pulse[i] || 0) * 0.86;
      const sc = 1 + (pulse[i] || 0) * 0.12 + (hl === i ? 0.08 : 0);
      tile.group.scale.setScalar(sc);
      tile.group.position.y = hl === i ? 0.14 : 0;
    }
  }

  function render(now) {
    if (disposed) return;
    const dt = Math.min(0.033, ((now - (render._t || now)) / 1000));
    render._t = now;
    time += dt;
    waterMat.emissiveIntensity = 0.85 + Math.sin(time * 6) * 0.25;
    steelFlow.emissiveIntensity = 0.7 + Math.sin(time * 8) * 0.3;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    resizeRenderer(renderer, camera, w, h);
    renderer.render(scene, camera);
  }

  function start() {
    const loop = (now) => {
      if (disposed) return;
      render(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    clearTiles();
    armGeo.dispose();
    jointGeo.dispose();
    jointRingGeo.dispose();
    renderer.dispose();
  }

  rebuild(5);
  start();

  return { setState, dispose, ready: true };
}

export { canUseWebGL };
