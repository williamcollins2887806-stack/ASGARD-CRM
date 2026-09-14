/**
 * VikingAvatar3D — KayKit Adventurers GLB per XP rank + cosmetics tint/weapons.
 * Assets: /m/assets/avatars/ranks/rank_*.glb (CC0 KayKit Free)
 */
import { useEffect, useRef, useState } from 'react';
import { getRank } from '@/lib/fieldRanks';

function canUseWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

function resolveKeys(assets = {}, cosmetics = {}, overrides = {}) {
  const k = (a) => (a && String(a).trim()) || null;
  const fromActive = (val, fallback) => {
    if (!val) return null;
    const s = String(val);
    // Prefer real asset_key (helmet_dragon / weapon_axe / body_jarl…)
    if (/^(helmet|weapon|armor|cape|boots|paint|body|frame|theme|badge)_/i.test(s)) return s;
    return fallback || null;
  };
  return {
    helmet: k(overrides.helmet) || k(assets.helmet) || fromActive(cosmetics.active_helmet, 'helmet_steel'),
    armor: k(overrides.armor) || k(assets.armor) || fromActive(cosmetics.active_armor, 'armor_chain'),
    weapon: k(overrides.weapon) || k(assets.weapon) || fromActive(cosmetics.active_weapon, 'weapon_axe'),
    cape: k(overrides.cape) || k(assets.cape) || fromActive(cosmetics.active_cape, null),
    boots: k(overrides.boots) || k(assets.boots) || fromActive(cosmetics.active_boots, null),
    face_paint: k(overrides.face_paint) || k(assets.face_paint) || fromActive(cosmetics.active_face_paint, null),
    body: k(overrides.body) || k(assets.body) || fromActive(cosmetics.active_avatar, null),
  };
}

const HELMET_COLORS = {
  helmet_horned: 0x8A9BAC, helmet_steel: 0x7a8794, helmet_jarl: 0xD4A843,
  helmet_berserk: 0x5a4030, helmet_dome: 0x6a7580, helmet_scout: 0x4a5560,
  helmet_dragon: 0x3d6b4f, helmet_ice: 0x88ccff, helmet_fire: 0xc04020,
  helmet_raven: 0x1a1a22, helmet_skull: 0xEEE8D0, helmet_gold: 0xD4A843,
  helmet_rune: 0x708090, helmet_valkyrie: 0xc0c8d8,
};
const ARMOR_COLORS = {
  armor_chain: 0x606878, armor_jarl: 0x8A9BAC, armor_leather: 0x3a2410,
  armor_plate: 0x707888, armor_rune: 0x556070, armor_dragon: 0x2d5a40,
  armor_ice: 0x6aa8c8, armor_fire: 0xa03820, armor_shadow: 0x1a1a24, armor_gold: 0xD4A843,
};
const CAPE_COLORS = {
  cape_bear: 0x3a2010, cape_wolf: 0x4a4a55, cape_crimson: 0x8b1a1a,
  cape_night: 0x12121a, cape_frost: 0x4a78a0, cape_ember: 0xb04018,
  cape_raven: 0x0e0e14, cape_gold: 0xC9A227,
};
const BOOT_COLORS = {
  boots_travel: 0x2a1810, boots_steel: 0x555555, boots_shadow: 0x111118,
  boots_jarl: 0x5a4020, boots_ice: 0x3a6080, boots_fire: 0x6a2010,
};
const PAINT_COLORS = {
  paint_warrior: 0x2A5A90, paint_berserk: 0x8B0000, paint_runes: 0xD4A843,
  paint_shadow: 0x111111, paint_ice: 0x88ccff, paint_fire: 0xff4400,
  paint_lightning: 0x88aaff,
};
const SKIN_TINT = {
  body_odin: 0xB87448, body_thor: 0xC88858, body_warrior: 0xB87448,
  body_berserk: 0xA06040, body_volva: 0xC89878, body_skald: 0xB88060,
  body_guard: 0xA87850, body_smith: 0x9A6840, body_hunter: 0xB07048,
  body_jarl: 0xC89060, body_valkyrie: 0xD0A888, body_shadow: 0x8A6050,
};
const WEAPON_TINT = {
  weapon_axe: 0x8A9BAC, weapon_hammer: 0xD4A843, weapon_spear: 0x707888,
  weapon_sword: 0x9aa8b8, weapon_handaxe: 0x7a8794, weapon_battleaxe: 0x606878,
  weapon_jarl_sword: 0xD4A843, weapon_dagger: 0x708090, weapon_bow: 0x5a4030,
  weapon_axe_shield: 0x8A9BAC, weapon_trident: 0x88ccff, weapon_forge_hammer: 0xc04020,
  weapon_guard_spear: 0x7a8794, weapon_flame_sword: 0xff4400,
};

/** Rank → GLB + presentation (kitbash jarl/konung from Knight/Barbarian) */
const RANK_MODELS = {
  thrall: { url: '/m/assets/avatars/ranks/rank_thrall.glb', scaleMul: 1, bg: 0x0a1018, rim: 0x9ca3af, rimInt: 0.35 },
  karl: { url: '/m/assets/avatars/ranks/rank_karl.glb', scaleMul: 1, bg: 0x0c0e1a, rim: 0xa78bfa, rimInt: 0.4 },
  huskarl: { url: '/m/assets/avatars/ranks/rank_huskarl.glb', scaleMul: 1, bg: 0x0a121c, rim: 0x60a5fa, rimInt: 0.5 },
  druzhina: { url: '/m/assets/avatars/ranks/rank_druzhina.glb', scaleMul: 1, bg: 0x0a1018, rim: 0x34d399, rimInt: 0.55 },
  vityaz: { url: '/m/assets/avatars/ranks/rank_vityaz.glb', scaleMul: 1, bg: 0x120c08, rim: 0xf97316, rimInt: 0.65 },
  jarl: { url: '/m/assets/avatars/ranks/rank_jarl.glb', scaleMul: 1.02, bg: 0x12100a, rim: 0xD4A843, rimInt: 0.9, goldBoost: true },
  konung: { url: '/m/assets/avatars/ranks/rank_konung.glb', scaleMul: 1.18, bg: 0x140808, rim: 0xef4444, rimInt: 1.1, goldBoost: true },
};

const FALLBACK_URL = '/m/assets/avatars/ranks/rank_druzhina.glb';
const LEGACY_URL = '/m/assets/avatars/viking_barbarian.glb';

function weaponFamily(key) {
  if (!key) return null;
  const k = String(key).toLowerCase();
  if (k.includes('axe_shield') || (k.includes('shield') && k.includes('axe'))) return 'axe_shield';
  if (k.includes('shield')) return 'shield';
  if (k.includes('hammer') || k.includes('forge')) return 'axe_2h';
  if (k.includes('dagger')) return 'dagger';
  if (k.includes('sword') || k.includes('flame')) {
    return (k.includes('jarl') || k.includes('2h') || k.includes('flame')) ? 'sword_2h' : 'sword';
  }
  if (k.includes('spear') || k.includes('trident') || k.includes('guard_spear')) return 'staff';
  if (k.includes('bow') || k.includes('crossbow') || k.includes('wand')) return k.includes('wand') ? 'wand' : 'crossbow';
  if (k.includes('axe')) return k.includes('battle') ? 'axe_2h' : 'axe';
  return 'axe';
}

function weaponUrl(family) {
  if (!family || family === 'axe_shield') return null;
  return `/m/assets/avatars/weapons/${family}.gltf`;
}

/** KayKit Free weapon GLTFs are already in character units — parent to handslotr/l as-is. */
const WEAPON_GRIP = {
  axe: { scale: 1, rot: [Math.PI, 0, Math.PI], pos: [0, 0.033, 0] },
  axe_2h: { scale: 1, rot: [Math.PI, 0, Math.PI], pos: [0, 0.033, 0] },
  sword: { scale: 1, rot: [Math.PI, 0, Math.PI], pos: [0, 0.033, 0] },
  sword_2h: { scale: 1, rot: [Math.PI, 0, Math.PI], pos: [0, 0.033, 0] },
  dagger: { scale: 1, rot: [Math.PI, 0, Math.PI], pos: [0, 0.02, 0] },
  staff: { scale: 1, rot: [Math.PI, 0, Math.PI], pos: [0, 0.033, 0] },
  wand: { scale: 1, rot: [Math.PI, 0, Math.PI], pos: [0, 0.033, 0] },
  crossbow: { scale: 1, rot: [Math.PI / 2, 0, 0], pos: [0, 0.04, 0.02] },
  shield: { scale: 1, rot: [0, 0, 0], pos: [0, 0.017, 0.156] },
  shield_badge: { scale: 1, rot: [0, 0, 0], pos: [0, 0.017, 0.156] },
};

/**
 * Map shop asset_key → distinct helmet mesh (A Adventurers / B Skeletons / C external).
 * Tint still applies on top for color variety within the same silhouette.
 */
function helmetMeshKey(key) {
  if (!key) return null;
  const k = String(key).toLowerCase();
  // B — skull helm (user-approved silhouette)
  if (k === 'helmet_skull') return 'hat_skel_warrior';
  if (k === 'helmet_raven') return 'hat_skel_hood';
  // A — Adventurers (same atlas as warrior)
  // Barbarian_Hat = медвежья шапка → только берсерк
  if (k.includes('berserk')) return 'hat_barbarian';
  // Драконий — купол рыцаря + зубчатый гребень (отдельный меш)
  if (k.includes('dragon')) return 'hat_dragon';
  if (k.includes('ice') || k.includes('fire') || k.includes('valkyrie') || k.includes('mage')) return 'hat_mage';
  // C — внешний рогатый (только явный horned)
  if (k === 'helmet_horned') return 'hat_external_viking';
  // steel / dome / jarl / gold / scout / rune / default — рыцарский купол
  return 'hat_knight';
}

function helmetUrl(meshKey) {
  if (!meshKey) return null;
  return `/m/assets/avatars/helmets/${meshKey}.gltf`;
}

/** Collect object + ancestors names (KayKit puts class on parent: Barbarian_Hat, Mage_Body…) */
function ancestryName(obj) {
  const parts = [];
  let o = obj;
  let depth = 0;
  while (o && depth < 8) {
    if (o.name) parts.push(o.name);
    o = o.parent;
    depth += 1;
  }
  return parts.join(' ');
}

/**
 * Classify KayKit Adventurers meshes across Barbarian/Knight/Mage/Rogue.
 * Prefer parent class names (*_Hat, *_Body, *_Cape, 1H_*, Spellbook…).
 */
function classifyMesh(obj, keys = {}) {
  const n = ancestryName(obj).toLowerCase();

  // Held props / weapons (before body — "hand" appears in handslot)
  if (/1h_|2h_|knife|sword|axe|wand|staff|spellbook|crossbow|throwable|mug|shield|offhand/.test(n)) {
    return 'weapon';
  }
  // Skip pure rig bones
  if (/handslot|handik|elbowik|kneeik|heelik|control-|ik-|\.l$|\.r$/.test(n) && !/_arm|_leg|_body|_head|_hat|_helmet|_cape|hooded/.test(n)) {
    if (/^(hand|wrist|lowerarm|upperarm|toes|foot|lowerleg|upperleg|hips|spine|chest|head|root|rig)/.test(
      (obj.name || '').toLowerCase(),
    )) {
      return 'rig';
    }
  }

  if (/_hat|_helmet|hooded/.test(n) || /(^| )(hat|helmet)( |$)/.test(n)) return 'helmet';
  if (/_cape|(^| )cape( |$)/.test(n)) return 'cape';
  if (/toes\.|foot\./.test(n)) return 'boots';
  // Legs/arms/body = armor plate zones
  if (/_body|_arm|_leg|(^| )chest( |$)/.test(n)) return 'armor';
  // Head / hood without separate hat: Rogue_Head, Mage_Head…
  if (/_head|(^| )head( |$)/.test(n)) {
    // Hooded rogue: helmet tint if helmet equipped, else skin
    if (/hooded/.test(n) && keys.helmet) return 'helmet';
    return 'skin';
  }
  return 'other';
}

function tintColor(THREE, mat, hex, strength = 0.55) {
  if (!mat || hex == null) return;
  const target = new THREE.Color(hex);
  if (!mat.color) mat.color = new THREE.Color(0xffffff);
  mat.color.lerp(target, strength);
  mat.needsUpdate = true;
}

function materialList(mat) {
  return (Array.isArray(mat) ? mat : [mat]).filter(Boolean);
}

function safeCloneMaterials(THREE, mats) {
  return mats.map((m) => {
    const c = m.clone();
    if (c.map) c.map.colorSpace = THREE.SRGBColorSpace;
    return c;
  });
}

function supportsEmissive(m) {
  return !!(m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial));
}

function applyCosmetics(THREE, model, keys, rankMeta, matStore = null) {
  const berserk = keys.body === 'body_berserk'
    || keys.face_paint === 'paint_berserk'
    || (keys.helmet && keys.helmet.includes('berserk'));
  const jarlBody = keys.body === 'body_jarl' || (keys.helmet && keys.helmet.includes('jarl'));

  model.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const srcMats = materialList(o.material);
    if (!srcMats.length) return;

    // Restore untinted base materials so re-tint (try-on / load me) never stacks
    if (matStore?.has(o)) {
      const base = matStore.get(o);
      const baseList = materialList(base);
      if (!baseList.length) return;
      const restored = safeCloneMaterials(THREE, baseList);
      o.material = Array.isArray(o.material) ? restored : restored[0];
    } else {
      const cloned = safeCloneMaterials(THREE, srcMats);
      if (matStore) {
        matStore.set(o, Array.isArray(o.material) ? safeCloneMaterials(THREE, cloned) : cloned[0].clone());
      }
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
    }
    o.castShadow = true;
    o.receiveShadow = true;

    const cls = classifyMesh(o, keys);
    if (cls === 'rig' || cls === 'other') {
      // Still allow goldBoost on unknown body-ish meshes for jarl/konung
      if (!(rankMeta?.goldBoost && /body|arm|leg|head|hat|helmet/i.test(ancestryName(o)))) return;
    }
    const list = materialList(o.material);
    const anc = ancestryName(o).toLowerCase();

    list.forEach((m) => {
      if (cls === 'helmet' && keys.helmet) tintColor(THREE, m, HELMET_COLORS[keys.helmet], 0.62);
      else if (cls === 'armor' && keys.armor) tintColor(THREE, m, ARMOR_COLORS[keys.armor], 0.55);
      else if (cls === 'cape' && keys.cape) tintColor(THREE, m, CAPE_COLORS[keys.cape], 0.7);
      else if (cls === 'boots' && keys.boots) tintColor(THREE, m, BOOT_COLORS[keys.boots], 0.65);
      else if (cls === 'skin' && keys.body) tintColor(THREE, m, SKIN_TINT[keys.body], 0.35);
      else if (cls === 'weapon' && keys.weapon) tintColor(THREE, m, WEAPON_TINT[keys.weapon] || 0x8A9BAC, 0.5);

      // Boots often baked into *_Leg* meshes — tint lower portion via leg when boots equipped
      if (keys.boots && cls === 'armor' && /_leg/.test(anc)) {
        tintColor(THREE, m, BOOT_COLORS[keys.boots], 0.25);
      }

      if (rankMeta?.goldBoost && (cls === 'helmet' || cls === 'armor' || cls === 'cape')) {
        tintColor(THREE, m, 0xD4A843, jarlBody ? 0.35 : 0.22);
      }
      if (berserk) {
        if (cls === 'skin' || cls === 'armor') tintColor(THREE, m, 0x6a1810, 0.28);
        if (cls === 'helmet') tintColor(THREE, m, 0x3a2010, 0.35);
      }
      if (!supportsEmissive(m)) return;
      if (keys.face_paint && (cls === 'skin' || (cls === 'helmet' && /head|hooded/.test(anc)))) {
        const pc = PAINT_COLORS[keys.face_paint];
        if (pc) {
          m.emissive = new THREE.Color(pc);
          m.emissiveIntensity = berserk ? 0.35 : 0.18;
        }
      } else if (m.emissive) {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    });
  });
}

/** KayKit Free packs ship with held props baked into the GLB — hide whole nodes, not only meshes. */
const BUILTIN_WEAPON_NODE =
  /knife|throwable|crossbow|spellbook|1h_|2h_|mug|offhand|badge_shield|rectangle_shield|round_shield|spike_shield|barbarian_round_shield|(^|_)(sword|axe|wand|staff|shield)(_|$)/i;

function hideBuiltinWeapons(model) {
  model.traverse((o) => {
    const n = o.name || '';
    if (n && BUILTIN_WEAPON_NODE.test(n)) {
      o.visible = false;
      return;
    }
    if (o.isMesh && classifyMesh(o) === 'weapon') o.visible = false;
  });
}

/** Hide class default hat/helmet/hood so attached shop mesh is the only headgear. */
function setBuiltinHatsVisible(model, visible) {
  model.traverse((o) => {
    const n = o.name || '';
    if (!n) return;
    if (/_Hat$|_Helmet$|_Hood$|Hooded/i.test(n) || /^(Barbarian_Hat|Knight_Helmet|Mage_Hat|Rogue_Head_Hooded|Skeleton_.*_(Hat|Helmet|Hood))$/i.test(n)) {
      o.visible = visible;
    }
  });
}

function findHandBone(root) {
  let best = null;
  let bestScore = 0;
  root.traverse((o) => {
    const n = (o.name || '').toLowerCase().replace(/[_\s]/g, '');
    let score = 0;
    // KayKit Adventurers: handslotr / handr (no dots)
    if (n === 'handslotr' || n === 'handslot.r') score = 4;
    else if (n === 'handr' || n === 'hand.r') score = 3;
    else if (/handslotr|handslot\.r/.test(n)) score = 2;
    else if (/handr$|hand\.r|righthand|wristr|wrist\.r/.test(n)) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  });
  return best;
}

function findLeftHandBone(root) {
  let best = null;
  let bestScore = 0;
  root.traverse((o) => {
    const n = (o.name || '').toLowerCase().replace(/[_\s]/g, '');
    let score = 0;
    if (n === 'handslotl' || n === 'handslot.l') score = 4;
    else if (n === 'handl' || n === 'hand.l') score = 3;
    else if (/handslotl|handslot\.l/.test(n)) score = 2;
    else if (/handl$|hand\.l|lefthand|wristl|wrist\.l/.test(n)) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  });
  return best;
}

function findHeadBone(root) {
  let exact = null;
  let soft = null;
  root.traverse((o) => {
    const n = (o.name || '').toLowerCase();
    if (n === 'head') exact = o;
    else if (!soft && (n === 'head.x' || n === 'mixamorighead' || /\bhead\b/.test(n))) soft = o;
  });
  return exact || soft;
}

function pickIdleClip(animations) {
  if (!animations?.length) return null;
  const prefer = ['Idle', 'Unarmed_Idle', '2H_Melee_Idle', 'Idle_A', 'idle'];
  for (const name of prefer) {
    const hit = animations.find((a) => a.name === name || a.name?.toLowerCase() === name.toLowerCase());
    if (hit) return hit;
  }
  const nonWalk = animations.find((a) => !/walk|run|strafe|jump|death/i.test(a.name || ''));
  return nonWalk || null;
}

function VikingCanvas({
  assets = {},
  cosmetics = {},
  overrides = {},
  level = 1,
  size = 280,
  interactive = true,
  heroPunch = false,
  mood = 'idle',
  tick = 0,
  transparentBg = false,
  onFail,
}) {
  const canvasRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const keys = resolveKeys(assets, cosmetics, overrides);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const gearDirtyRef = useRef(false);
  const keysSig = `${keys.helmet}|${keys.armor}|${keys.weapon}|${keys.cape}|${keys.boots}|${keys.face_paint}|${keys.body}`;
  useEffect(() => { gearDirtyRef.current = true; }, [keysSig]);
  const rank = getRank(level);
  const rankMeta = RANK_MODELS[rank.key] || RANK_MODELS.druzhina;
  // Remount ONLY when the GLB model changes — cosmetics/try-on hot-swap in place (no blank flash)
  const keySig = `${rank.key}|${transparentBg ? 1 : 0}|${size}`;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        if (disposed || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(size, size);
        renderer.shadowMap.enabled = true;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        const initialKeys = keysRef.current;
        const berserk0 = initialKeys.body === 'body_berserk' || initialKeys.face_paint === 'paint_berserk';
        const bgHex = berserk0 ? 0x1a0808 : rankMeta.bg;
        const scene = new THREE.Scene();
        scene.background = transparentBg ? null : new THREE.Color(bgHex);

        const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 80);
        const baseZoom = heroPunch ? 3.4 : 4.0;
        camera.position.set(0, 1.05, baseZoom);
        camera.lookAt(0, 0.95, 0);

        scene.add(new THREE.AmbientLight(0xb8c4d8, 0.85));
        const keyLight = new THREE.DirectionalLight(0xffe0b0, 2.4);
        keyLight.position.set(-2.2, 4.5, 3.2);
        scene.add(keyLight);
        const fill = new THREE.DirectionalLight(0x6a90c0, 0.9);
        fill.position.set(2.8, 1.5, 1.2);
        scene.add(fill);
        const rimCol = berserk0 ? 0xef4444 : rankMeta.rim;
        const rim = new THREE.DirectionalLight(rimCol, berserk0 ? 1.2 : rankMeta.rimInt);
        rim.position.set(0, 2, -3);
        scene.add(rim);

        // Ground ring for high ranks + dynamic aura for epic/legendary win
        let auraRing = null;
        {
          const ringGeo = new THREE.RingGeometry(0.55, 0.72, 48);
          const ringMat = new THREE.MeshBasicMaterial({
            color: rimCol,
            transparent: true,
            opacity: (rank.key === 'jarl' || rank.key === 'konung' || berserk0) ? 0.35 : 0,
            side: THREE.DoubleSide,
          });
          auraRing = new THREE.Mesh(ringGeo, ringMat);
          auraRing.rotation.x = -Math.PI / 2;
          auraRing.position.y = 0.02;
          scene.add(auraRing);
        }

        const G = new THREE.Group();
        scene.add(G);

        const loader = new GLTFLoader();
        const loadModel = (url) => new Promise((resolve, reject) => {
          loader.load(url, resolve, undefined, reject);
        });

        let gltf;
        try {
          gltf = await loadModel(rankMeta.url);
        } catch {
          try {
            gltf = await loadModel(FALLBACK_URL);
          } catch {
            gltf = await loadModel(LEGACY_URL);
          }
        }
        if (disposed) return;

        const model = gltf.scene;
        const matStore = new WeakMap();

        const box = new THREE.Box3().setFromObject(model);
        const size3 = new THREE.Vector3();
        box.getSize(size3);
        const scale = (1.85 * (rankMeta.scaleMul || 1)) / Math.max(size3.y, 0.01);
        model.scale.setScalar(scale);
        box.setFromObject(model);
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.x -= center.x;
        model.position.z -= center.z;
        model.position.y -= box.min.y;

        G.add(model);

        // Hide KayKit bundled props — only equipped shop/roulette weapons are shown
        hideBuiltinWeapons(model);

        async function attachProp(url, handBone, tintKey, grip = null, opts = {}) {
          const wGltf = await loadModel(url);
          if (disposed) return null;
          const prop = wGltf.scene;
          prop.userData.asgardWeapon = !opts.helmet;
          prop.userData.asgardHelmet = !!opts.helmet;
          prop.traverse((o) => {
            if (!o.isMesh || !o.material) return;
            const mats = materialList(o.material);
            if (!mats.length) return;
            const cloned = mats.map((m) => {
              const c = m.clone();
              if (c.map) c.map.colorSpace = THREE.SRGBColorSpace;
              if (opts.helmet) tintColor(THREE, c, HELMET_COLORS[tintKey] || 0x7a8794, 0.55);
              else tintColor(THREE, c, WEAPON_TINT[tintKey] || 0x8A9BAC, 0.45);
              return c;
            });
            o.material = Array.isArray(o.material) ? cloned : cloned[0];
            o.castShadow = true;
          });

          if (opts.helmet) {
            prop.scale.setScalar(opts.scale ?? 1);
            prop.rotation.set(0, 0, 0);
            if (handBone) {
              handBone.add(prop);
              prop.position.set(0, 0, 0);
            } else {
              prop.position.set(0, 1.55, 0);
              G.add(prop);
            }
            return prop;
          }
          const g = grip || { scale: 1, rot: [Math.PI, 0, Math.PI], pos: [0, 0.033, 0] };
          prop.scale.setScalar(g.scale);
          prop.rotation.set(g.rot[0], g.rot[1], g.rot[2]);
          if (handBone) {
            handBone.add(prop);
            prop.position.set(g.pos[0], g.pos[1], g.pos[2]);
          } else {
            // Fallback if slot bone missing — still visible near right hip
            prop.position.set(0.55, 1.0, 0.12);
            G.add(prop);
          }
          return prop;
        }

        function clearAttachedGear() {
          const doomed = [];
          model.traverse((o) => {
            if (o.userData?.asgardWeapon || o.userData?.asgardHelmet) doomed.push(o);
          });
          G.children.slice().forEach((c) => {
            if (c.userData?.asgardWeapon || c.userData?.asgardHelmet) doomed.push(c);
          });
          doomed.forEach((n) => n.parent?.remove(n));
        }

        let weaponNode = null;
        let weaponBaseRot = [Math.PI, 0, Math.PI];
        let gearBusy = false;
        let lastGearSig = '';

        async function syncGear(force = false) {
          const k = keysRef.current;
          const sig = `${k.helmet}|${k.armor}|${k.weapon}|${k.cape}|${k.boots}|${k.face_paint}|${k.body}`;
          if (!force && sig === lastGearSig) return;
          if (gearBusy) return;
          gearBusy = true;
          lastGearSig = sig;
          gearDirtyRef.current = false;
          try {
            applyCosmetics(THREE, model, k, rankMeta, matStore);
            clearAttachedGear();
            weaponNode = null;

            const hMesh = helmetMeshKey(k.helmet);
            const hUrl = helmetUrl(hMesh);
            if (hUrl) {
              setBuiltinHatsVisible(model, false);
              const head = findHeadBone(model);
              await attachProp(hUrl, head, k.helmet, null, { helmet: true });
            } else {
              setBuiltinHatsVisible(model, true);
            }

            if (k.weapon) {
              const hand = findHandBone(model);
              const left = findLeftHandBone(model);
              const fam = weaponFamily(k.weapon);
              if (fam === 'axe_shield') {
                weaponNode = await attachProp(weaponUrl('axe'), hand, k.weapon, WEAPON_GRIP.axe);
                await attachProp(weaponUrl('shield'), left, k.weapon, WEAPON_GRIP.shield);
              } else if (fam === 'shield') {
                weaponNode = await attachProp(weaponUrl('shield'), left || hand, k.weapon, WEAPON_GRIP.shield);
              } else {
                const wUrl = weaponUrl(fam);
                if (wUrl) {
                  weaponNode = await attachProp(wUrl, hand, k.weapon, WEAPON_GRIP[fam] || WEAPON_GRIP.axe);
                }
              }
              if (weaponNode) {
                weaponBaseRot = [weaponNode.rotation.x, weaponNode.rotation.y, weaponNode.rotation.z];
              }
            }
          } catch (e) {
            console.warn('[VikingAvatar3D] syncGear', e);
          } finally {
            gearBusy = false;
            if (gearDirtyRef.current) syncGear();
          }
        }

        await syncGear(true);

        let mixer = null;
        const idleClip = pickIdleClip(gltf.animations);
        if (idleClip) {
          mixer = new THREE.AnimationMixer(model);
          const action = mixer.clipAction(idleClip);
          action.play();
        }

        let drag = false; let lx = 0; let ly = 0;
        // Wheel: face camera. Profile: slow orbit start.
        let targY = interactive ? (heroPunch ? 0.55 : 0.25) : 0.22;
        let targX = 0; let curY = targY; let curX = 0;
        let targetZoom = baseZoom;
        let curScale = 1;
        const onDown = (e) => {
          if (!interactive) return;
          drag = true;
          const p = e.touches ? e.touches[0] : e;
          lx = p.clientX; ly = p.clientY;
        };
        const onUp = () => { drag = false; };
        const onMove = (e) => {
          if (!drag || !interactive) return;
          const p = e.touches ? e.touches[0] : e;
          targY += (p.clientX - lx) * 0.012;
          targX += (p.clientY - ly) * 0.008;
          targX = Math.max(-0.35, Math.min(0.35, targX));
          lx = p.clientX; ly = p.clientY;
          if (e.cancelable) e.preventDefault();
        };
        const onWheel = (e) => {
          if (!interactive) return;
          targetZoom = Math.max(2.8, Math.min(6.2, targetZoom + e.deltaY * 0.004));
          e.preventDefault();
        };
        canvas.addEventListener('mousedown', onDown);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('mousemove', onMove);
        canvas.addEventListener('touchstart', onDown, { passive: true });
        canvas.addEventListener('touchend', onUp);
        canvas.addEventListener('touchmove', onMove, { passive: false });
        canvas.addEventListener('wheel', onWheel, { passive: false });

        const clock = new THREE.Clock();
        let raf = 0;
        let t0 = 0;
        let moodSince = 0;
        let lastMood = moodRef.current || 'idle';
        let paused = document.hidden;
        const onVis = () => { paused = document.hidden; };
        document.addEventListener('visibilitychange', onVis);
        let lastTick = tickRef.current;
        let tickPulse = 0;
        const animate = () => {
          raf = requestAnimationFrame(animate);
          if (paused) return;
          const dt = clock.getDelta();
          t0 += dt;
          const m = moodRef.current || 'idle';
          if (m !== lastMood) {
            lastMood = m;
            moodSince = t0;
          }
          const age = t0 - moodSince;

          if (tickRef.current !== lastTick) {
            lastTick = tickRef.current;
            tickPulse = 1;
          }
          tickPulse = Math.max(0, tickPulse - dt * 4);

          // Hot-swap try-on / equipped gear without remounting the GLB
          if (gearDirtyRef.current) {
            syncGear();
          }

          if (mixer) {
            mixer.timeScale = m === 'spin' || m === 'look' ? 1.85
              : (m === 'win' || m === 'epic' || m === 'nod' ? 1.45 : 1);
            mixer.update(dt);
          }

          // Weapon bob synced to reel ticks
          if (weaponNode) {
            const swing = tickPulse * 0.55 + (m === 'spin' ? Math.sin(t0 * 10) * 0.08 : 0);
            weaponNode.rotation.x = weaponBaseRot[0] - swing;
            weaponNode.rotation.z = weaponBaseRot[2] + swing * 0.35;
          }

          // Aura: epic/legendary win or high rank
          if (auraRing) {
            const wantAura = m === 'epic' || m === 'win' || rank.key === 'jarl' || rank.key === 'konung' || berserk0;
            const targetOp = m === 'epic' ? 0.7 : (m === 'win' ? 0.5 : ((rank.key === 'jarl' || rank.key === 'konung' || berserk0) ? 0.35 : 0));
            auraRing.material.opacity += (targetOp - auraRing.material.opacity) * 0.12;
            auraRing.visible = auraRing.material.opacity > 0.02;
            if (wantAura) auraRing.rotation.z += dt * (m === 'epic' ? 2.2 : 0.6);
            if (m === 'epic') auraRing.material.color.setHex(0xF0C850);
            else if (m === 'win') auraRing.material.color.setHex(0x3DDC84);
            else auraRing.material.color.setHex(rimCol);
          }

          const FACE = 0.22;
          if (interactive) {
            if (!drag) {
              if (m === 'spin') targY += 0.004;
              else if (m === 'win' || m === 'epic') targY += 0.0025;
              else targY += 0.0012;
            }
            if (m === 'spin') {
              targX = Math.sin(t0 * 5) * 0.08;
              targetZoom = 3.85 + Math.sin(t0 * 6) * 0.06;
            } else if (m === 'win' || m === 'epic') {
              targX = Math.sin(t0 * 4) * 0.05;
              targetZoom = 3.25 + Math.sin(t0 * 5) * 0.1;
            } else {
              targetZoom = baseZoom;
            }
            G.position.y = m === 'spin' ? Math.sin(t0 * 8) * 0.03
              : (m === 'win' || m === 'epic' ? Math.sin(t0 * 6) * 0.04 : 0);
            G.rotation.z = 0;
            curScale += (1 - curScale) * 0.1;
          } else if (m === 'spin') {
            targY = FACE + Math.sin(t0 * 4.5) * 0.05;
            targX = 0.2 + Math.sin(t0 * 7) * 0.06 + tickPulse * 0.04;
            G.position.y = Math.abs(Math.sin(t0 * 9)) * 0.06 + tickPulse * 0.03;
            G.rotation.z = Math.sin(t0 * 5.5) * 0.04;
            curScale += ((1.02 + tickPulse * 0.03) - curScale) * 0.2;
            targetZoom = 3.55 + Math.sin(t0 * 6) * 0.05;
          } else if (m === 'look') {
            // Near-miss: lean hard toward drum, hold breath
            targY = FACE + Math.sin(t0 * 2) * 0.03;
            targX = 0.32 + Math.sin(t0 * 3) * 0.02;
            G.position.y = Math.sin(t0 * 4) * 0.02;
            G.rotation.z = 0;
            curScale += (1.03 - curScale) * 0.15;
            targetZoom = 3.4;
          } else if (m === 'nod') {
            // Common win: polite nod
            const nodAmt = age < 0.7 ? Math.sin(age * Math.PI / 0.7) * 0.22 : 0;
            targY = FACE;
            targX = 0.08 + nodAmt;
            G.position.y = 0;
            G.rotation.z = 0;
            curScale += (1 - curScale) * 0.15;
            targetZoom = baseZoom;
          } else if (m === 'win') {
            targY = FACE + Math.sin(t0 * 5) * 0.06;
            targX = -0.08 + Math.sin(t0 * 6) * 0.04;
            G.position.y = Math.abs(Math.sin(t0 * 8)) * 0.1;
            G.rotation.z = Math.sin(t0 * 4) * 0.03;
            curScale += ((1.04 + Math.sin(t0 * 7) * 0.015) - curScale) * 0.15;
            targetZoom = 3.35 + Math.sin(t0 * 5) * 0.04;
          } else if (m === 'epic') {
            targY = FACE + Math.sin(t0 * 6) * 0.08;
            targX = -0.1 + Math.sin(t0 * 7) * 0.05;
            G.position.y = Math.abs(Math.sin(t0 * 10)) * 0.14;
            G.rotation.z = Math.sin(t0 * 5) * 0.05;
            curScale += ((1.06 + Math.sin(t0 * 9) * 0.02) - curScale) * 0.18;
            targetZoom = 3.1 + Math.sin(t0 * 6) * 0.07;
          } else {
            targY = FACE + Math.sin(t0 * 0.6) * 0.03;
            targX = Math.sin(t0 * 0.45) * 0.02;
            G.position.y = Math.sin(t0 * 1.2) * 0.012;
            G.rotation.z *= 0.85;
            curScale += (1 - curScale) * 0.12;
            targetZoom = baseZoom;
          }

          curY += (targY - curY) * (interactive ? 0.07 : 0.18);
          curX += (targX - curX) * (interactive ? 0.07 : 0.16);
          G.rotation.y = curY;
          G.rotation.x = curX;
          G.scale.setScalar(curScale);
          camera.position.z += (targetZoom - camera.position.z) * 0.1;
          try {
            renderer.render(scene, camera);
          } catch (renderErr) {
            // Three.js can throw "Cannot read properties of null (reading 'trim')"
            // when a material/program is broken or a WebGL context is lost mid-frame.
            console.warn('[VikingAvatar3D] render', renderErr);
            cancelAnimationFrame(raf);
            if (!disposed) {
              setFailed(true);
              onFail?.();
            }
          }
        };
        animate();

        cleanup = () => {
          cancelAnimationFrame(raf);
          document.removeEventListener('visibilitychange', onVis);
          canvas.removeEventListener('mousedown', onDown);
          window.removeEventListener('mouseup', onUp);
          window.removeEventListener('mousemove', onMove);
          canvas.removeEventListener('touchstart', onDown);
          canvas.removeEventListener('touchend', onUp);
          canvas.removeEventListener('touchmove', onMove);
          canvas.removeEventListener('wheel', onWheel);
          try {
            const gl = renderer.getContext?.();
            const lose = gl?.getExtension?.('WEBGL_lose_context');
            lose?.loseContext?.();
          } catch { /* ignore */ }
          try {
            renderer.dispose();
          } catch { /* ignore */ }
        };
      } catch (e) {
        console.warn('[VikingAvatar3D]', e);
        if (!disposed) {
          setFailed(true);
          onFail?.();
        }
      }
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [keySig, size, interactive, onFail, rank.key, transparentBg]);

  // onFail already called in catch — do not double-fire (wheel would remount twice)

  if (failed) {
    if (onFail) return null;
    return (
      <div style={{
        width: size, height: size, borderRadius: 22,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a1018', border: '1px solid rgba(212,168,67,0.28)',
        color: '#9ca3af', fontSize: 12, textAlign: 'center', padding: 16,
      }}>
        3D недоступно
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: transparentBg ? 0 : 22,
        display: 'block',
        cursor: interactive ? 'grab' : 'default',
        touchAction: 'none',
        boxShadow: transparentBg ? 'none' : '0 0 40px rgba(212,168,67,0.14)',
        border: transparentBg ? 'none' : '1px solid rgba(212,168,67,0.28)',
        background: 'transparent',
      }}
    />
  );
}

export default function VikingAvatar3D({
  assets = {},
  cosmetics = {},
  overrides = {},
  level = 1,
  size = 300,
  interactive = true,
  heroPunch = false,
  mood = 'idle',
  tick = 0,
  transparentBg = false,
  onFail,
}) {
  const noGl = !canUseWebGL();
  useEffect(() => {
    if (noGl) onFail?.();
  }, [noGl, onFail]);

  if (noGl) {
    if (onFail) return null;
    return (
      <div style={{
        width: size, height: size, borderRadius: 22,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a1018', border: '1px solid rgba(212,168,67,0.28)',
        color: '#9ca3af', fontSize: 12,
      }}>
        3D недоступно
      </div>
    );
  }

  return (
    <VikingCanvas
      assets={assets}
      cosmetics={cosmetics}
      overrides={overrides}
      level={level}
      size={size}
      interactive={interactive}
      heroPunch={heroPunch}
      mood={mood}
      tick={tick}
      transparentBg={transparentBg}
      onFail={onFail}
    />
  );
}

export { canUseWebGL };

export function VikingAvatarLazy(props) {
  return <VikingAvatar3D {...props} />;
}
