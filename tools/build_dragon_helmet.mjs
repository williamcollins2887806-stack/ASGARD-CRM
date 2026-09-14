/**
 * Build hat_dragon.gltf = Knight_Helmet + low-poly dorsal crest (dragon silhouette).
 * Keeps KayKit atlas/proportions — not bear, not mage cone.
 *
 * Usage: node tools/build_dragon_helmet.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

globalThis.self = globalThis;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const THREE_ROOT = path.join(ROOT, 'public/mobile-app/node_modules');
const require = createRequire(path.join(THREE_ROOT, 'package.json'));
const THREE = require('three');
const { GLTFLoader } = await import(
  pathToFileURL(path.join(THREE_ROOT, 'three/examples/jsm/loaders/GLTFLoader.js')).href
);

const OUT_DIRS = [
  path.join(ROOT, 'public/m/assets/avatars/helmets'),
  path.join(ROOT, 'public/mobile-app/public/assets/avatars/helmets'),
];
const OUT = 'hat_dragon';
const TEX = 'knight_texture.png';
const TEX_SRC = path.join(ROOT, 'public/m/assets/avatars/weapons', TEX);
const RANK = path.join(ROOT, 'public/m/assets/avatars/ranks/rank_huskarl.glb');

const loader = new GLTFLoader();
function parseBuf(buf) {
  return new Promise((resolve, reject) => {
    loader.parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      '',
      resolve,
      reject,
    );
  });
}

function f32(arr) {
  return Buffer.from(new Float32Array(arr).buffer);
}
function u16(arr) {
  return Buffer.from(new Uint16Array(arr).buffer);
}
function u32(arr) {
  return Buffer.from(new Uint32Array(arr).buffer);
}

/** Sagittal dragon crest: jagged plates along Z, sitting on helmet crown. */
function makeCrestGeometry(crownY, crownZ, height = 0.55, length = 0.85, thick = 0.06) {
  // Profile points (z, y) from front → back, relative to crown
  const profile = [
    [0.35, 0.05],
    [0.22, 0.28],
    [0.08, 0.18],
    [-0.05, 0.42],
    [-0.18, 0.22],
    [-0.32, 0.55],
    [-0.42, 0.12],
    [-0.50, 0.02],
  ].map(([z, y]) => [z * length, y * height]);

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const hx = thick * 0.5;

  const pushV = (x, y, z, nx, ny, nz, u, v) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  for (let i = 0; i < profile.length - 1; i++) {
    const [z0, y0] = profile[i];
    const [z1, y1] = profile[i + 1];
    const yBase0 = crownY + 0.02;
    const yBase1 = crownY + 0.02;
    const yy0 = crownY + y0;
    const yy1 = crownY + y1;
    const zz0 = crownZ + z0;
    const zz1 = crownZ + z1;
    const u0 = i / (profile.length - 1);
    const u1 = (i + 1) / (profile.length - 1);

    // Left face (-X)
    const a = pushV(-hx, yBase0, zz0, -1, 0, 0, u0, 0);
    const b = pushV(-hx, yy0, zz0, -1, 0, 0, u0, 1);
    const c = pushV(-hx, yy1, zz1, -1, 0, 0, u1, 1);
    const d = pushV(-hx, yBase1, zz1, -1, 0, 0, u1, 0);
    indices.push(a, b, c, a, c, d);

    // Right face (+X)
    const e = pushV(hx, yBase0, zz0, 1, 0, 0, u0, 0);
    const f = pushV(hx, yy0, zz0, 1, 0, 0, u0, 1);
    const g = pushV(hx, yy1, zz1, 1, 0, 0, u1, 1);
    const h = pushV(hx, yBase1, zz1, 1, 0, 0, u1, 0);
    indices.push(e, g, f, e, h, g);

    // Top ridge
    const t0 = pushV(-hx, yy0, zz0, 0, 1, 0, u0, 0.5);
    const t1 = pushV(hx, yy0, zz0, 0, 1, 0, u0, 0.6);
    const t2 = pushV(hx, yy1, zz1, 0, 1, 0, u1, 0.6);
    const t3 = pushV(-hx, yy1, zz1, 0, 1, 0, u1, 0.5);
    indices.push(t0, t1, t2, t0, t2, t3);
  }

  // Small side horns (dragon cheeks)
  const horn = (side) => {
    const sx = side * 0.42;
    const baseY = crownY - 0.15;
    const tipY = crownY + 0.12;
    const baseZ = crownZ + 0.18;
    const tipZ = crownZ + 0.05;
    const tipX = side * 0.72;
    const r = 0.05;
    const ring = [
      [sx - r * 0.3, baseY, baseZ - r],
      [sx + r * 0.3, baseY, baseZ - r],
      [sx + r * 0.3, baseY + r, baseZ],
      [sx - r * 0.3, baseY + r, baseZ],
    ];
    const tip = pushV(tipX, tipY, tipZ, side, 0.4, -0.2, 0.9, 0.9);
    const ids = ring.map(([x, y, z], i) => pushV(x, y, z, side, 0, 0.2, 0.2 + i * 0.1, 0.2));
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      indices.push(ids[i], tip, ids[j]);
    }
  };
  horn(1);
  horn(-1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function mergeGeometries(geos) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let base = 0;
  for (const g of geos) {
    const indexed = g.index ? g : null;
    const src = indexed ? g.toNonIndexed() : g;
    if (!src.attributes.normal) src.computeVertexNormals();
    if (!src.attributes.uv) {
      const n = src.attributes.position.count;
      const u = new Float32Array(n * 2);
      src.setAttribute('uv', new THREE.BufferAttribute(u, 2));
    }
    const pos = src.attributes.position.array;
    const nor = src.attributes.normal.array;
    const uv = src.attributes.uv.array;
    for (let i = 0; i < pos.length; i++) positions.push(pos[i]);
    for (let i = 0; i < nor.length; i++) normals.push(nor[i]);
    for (let i = 0; i < uv.length; i++) uvs.push(uv[i]);
    const count = pos.length / 3;
    for (let i = 0; i < count; i++) indices.push(base + i);
    base += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(indices);
  return out;
}

function geometryToGltf(geo, { outName, matName, textureFile, translation }) {
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  const uv = geo.attributes.uv.array;
  const idx = geo.index.array;

  const parts = [];
  const views = [];
  let offset = 0;
  const align = () => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad));
      offset += pad;
    }
  };
  const pushView = (buf, target) => {
    align();
    const byteOffset = offset;
    parts.push(buf);
    offset += buf.length;
    views.push({ buffer: 0, byteOffset, byteLength: buf.length, target });
    return views.length - 1;
  };

  const posMin = [Infinity, Infinity, Infinity];
  const posMax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = pos[i + a];
      if (v < posMin[a]) posMin[a] = v;
      if (v > posMax[a]) posMax[a] = v;
    }
  }

  const posView = pushView(f32(pos), 34962);
  const norView = pushView(f32(nor), 34962);
  const uvView = pushView(f32(uv), 34962);
  let maxIdx = 0;
  for (let i = 0; i < idx.length; i++) if (idx[i] > maxIdx) maxIdx = idx[i];
  const useU32 = maxIdx > 65535;
  const idxView = pushView(useU32 ? u32(idx) : u16(Array.from(idx)), 34963);

  const accessors = [
    {
      bufferView: posView,
      componentType: 5126,
      count: pos.length / 3,
      type: 'VEC3',
      max: posMax,
      min: posMin,
    },
    { bufferView: norView, componentType: 5126, count: nor.length / 3, type: 'VEC3' },
    { bufferView: uvView, componentType: 5126, count: uv.length / 2, type: 'VEC2' },
    {
      bufferView: idxView,
      componentType: useU32 ? 5125 : 5123,
      count: idx.length,
      type: 'SCALAR',
    },
  ];

  const [px, py, pz] = translation;
  const gltf = {
    asset: { generator: 'ASGARD build_dragon_helmet', version: '2.0' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{ mesh: 0, name: outName, translation: [px, py, pz] }],
    materials: [
      {
        doubleSided: true,
        name: matName,
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0.15,
          roughnessFactor: 0.45,
        },
      },
    ],
    meshes: [
      {
        name: outName,
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    textures: [{ sampler: 0, source: 0 }],
    images: [{ mimeType: 'image/png', name: matName, uri: textureFile }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset, uri: `${outName}.bin` }],
  };
  return { gltf, bin: Buffer.concat(parts) };
}

const gltfIn = await parseBuf(fs.readFileSync(RANK));
let helm = null;
gltfIn.scene.traverse((o) => {
  if (o.name === 'Knight_Helmet') helm = o;
});
if (!helm?.isMesh) throw new Error('Knight_Helmet not found');

const helmGeo = helm.geometry.clone();
if (!helmGeo.attributes.normal) helmGeo.computeVertexNormals();
const box = new THREE.Box3().setFromBufferAttribute(helmGeo.attributes.position);
const size = new THREE.Vector3();
const center = new THREE.Vector3();
box.getSize(size);
box.getCenter(center);
const crownY = box.max.y - 0.02;
const crownZ = center.z;

const crest = makeCrestGeometry(crownY, crownZ);
const merged = mergeGeometries([helmGeo, crest]);

const { gltf, bin } = geometryToGltf(merged, {
  outName: OUT,
  matName: 'knight_texture',
  textureFile: TEX,
  translation: helm.position.toArray(),
});

for (const dir of OUT_DIRS) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${OUT}.gltf`), JSON.stringify(gltf, null, 2));
  fs.writeFileSync(path.join(dir, `${OUT}.bin`), bin);
  fs.copyFileSync(TEX_SRC, path.join(dir, TEX));
  console.log('wrote', path.join(dir, `${OUT}.gltf`), `${(bin.length / 1024).toFixed(1)} KB`);
}
console.log('crown', { crownY: +crownY.toFixed(3), crownZ: +crownZ.toFixed(3), size: size.toArray().map((n) => +n.toFixed(3)) });
