/**
 * Extract hat/helmet meshes into standalone glTF props (head-bone attach).
 * A — Adventurers hats from rank_*.glb
 * B — Skeletons hats from _tmp_kaykit/skeletons (KayKit CC0)
 *
 * Usage: node tools/extract_kaykit_helmets.mjs
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

const RANKS = path.join(ROOT, 'public/m/assets/avatars/ranks');
const OUT_DIRS = [
  path.join(ROOT, 'public/m/assets/avatars/helmets'),
  path.join(ROOT, 'public/mobile-app/public/assets/avatars/helmets'),
];
const TEX_SRC = path.join(ROOT, 'public/m/assets/avatars/weapons');

function findDirWith(fileName, base) {
  if (!fs.existsSync(base)) return null;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        const hit = walk(p);
        if (hit) return hit;
      } else if (e.name === fileName) return path.dirname(p);
    }
    return null;
  };
  return walk(base);
}

const SKELETONS = findDirWith('Skeleton_Warrior.glb', path.join(ROOT, '_tmp_kaykit/skeletons'));

const JOBS_A = [
  {
    srcDir: RANKS,
    src: 'rank_druzhina.glb',
    meshName: 'Barbarian_Hat',
    out: 'hat_barbarian',
    texture: 'barbarian_texture.png',
    textureSrc: path.join(TEX_SRC, 'barbarian_texture.png'),
    matName: 'barbarian_texture',
  },
  {
    srcDir: RANKS,
    src: 'rank_huskarl.glb',
    meshName: 'Knight_Helmet',
    out: 'hat_knight',
    texture: 'knight_texture.png',
    textureSrc: path.join(TEX_SRC, 'knight_texture.png'),
    matName: 'knight_texture',
  },
  {
    srcDir: RANKS,
    src: 'rank_vityaz.glb',
    meshName: 'Mage_Hat',
    out: 'hat_mage',
    texture: 'mage_texture.png',
    textureSrc: path.join(TEX_SRC, 'mage_texture.png'),
    matName: 'mage_texture',
  },
];

const JOBS_B = SKELETONS
  ? [
      {
        srcDir: SKELETONS,
        src: 'Skeleton_Warrior.glb',
        meshName: 'Skeleton_Warrior_Helmet',
        out: 'hat_skel_warrior',
        texture: 'skeleton_texture.png',
        textureSrc: path.join(SKELETONS, 'skeleton_texture.png'),
        matName: 'skeleton_texture',
      },
      {
        srcDir: SKELETONS,
        src: 'Skeleton_Mage.glb',
        meshName: 'Skeleton_Mage_Hat',
        out: 'hat_skel_mage',
        texture: 'skeleton_texture.png',
        textureSrc: path.join(SKELETONS, 'skeleton_texture.png'),
        matName: 'skeleton_texture',
      },
      {
        srcDir: SKELETONS,
        src: 'Skeleton_Rogue.glb',
        meshName: 'Skeleton_Rogue_Hood',
        out: 'hat_skel_hood',
        texture: 'skeleton_texture.png',
        textureSrc: path.join(SKELETONS, 'skeleton_texture.png'),
        matName: 'skeleton_texture',
      },
    ]
  : [];

const JOBS = [...JOBS_A, ...JOBS_B];
if (!SKELETONS) console.warn('Skeletons pack not found under _tmp_kaykit/skeletons — skipping B');

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

function findByName(root, name) {
  let hit = null;
  root.traverse((o) => {
    if (o.name === name) hit = o;
  });
  return hit;
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

function meshToGltf(mesh, { outName, matName, textureFile }) {
  const geo = mesh.geometry.index ? mesh.geometry : mesh.geometry.toNonIndexed();
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal?.array;
  const uv = geo.attributes.uv?.array;
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
    views.push({
      buffer: 0,
      byteOffset,
      byteLength: buf.length,
      ...(target != null ? { target } : {}),
    });
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
  const norView = nor ? pushView(f32(nor), 34962) : null;
  const uvView = uv ? pushView(f32(uv), 34962) : null;
  let maxIdx = 0;
  for (let i = 0; i < idx.length; i++) if (idx[i] > maxIdx) maxIdx = idx[i];
  const useU32 = maxIdx > 65535;
  const idxView = pushView(useU32 ? u32(idx) : u16(Array.from(idx)), 34963);

  const accessors = [];
  const posAcc = accessors.length;
  accessors.push({
    bufferView: posView,
    componentType: 5126,
    count: pos.length / 3,
    type: 'VEC3',
    max: posMax,
    min: posMin,
  });
  let norAcc = null;
  if (norView != null) {
    norAcc = accessors.length;
    accessors.push({
      bufferView: norView,
      componentType: 5126,
      count: nor.length / 3,
      type: 'VEC3',
    });
  }
  let uvAcc = null;
  if (uvView != null) {
    uvAcc = accessors.length;
    accessors.push({
      bufferView: uvView,
      componentType: 5126,
      count: uv.length / 2,
      type: 'VEC2',
    });
  }
  const idxAcc = accessors.length;
  accessors.push({
    bufferView: idxView,
    componentType: useU32 ? 5125 : 5123,
    count: idx.length,
    type: 'SCALAR',
  });

  const attributes = { POSITION: posAcc };
  if (norAcc != null) attributes.NORMAL = norAcc;
  if (uvAcc != null) attributes.TEXCOORD_0 = uvAcc;

  const [px, py, pz] = mesh.position.toArray();
  const q = mesh.quaternion;
  const [sx, sy, sz] = mesh.scale.toArray();

  const gltf = {
    asset: { generator: 'ASGARD extract_kaykit_helmets', version: '2.0' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [
      {
        mesh: 0,
        name: outName,
        translation: [px, py, pz],
        rotation: [q.x, q.y, q.z, q.w],
        scale: [sx, sy, sz],
      },
    ],
    materials: [
      {
        doubleSided: true,
        name: matName,
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.5,
        },
      },
    ],
    meshes: [
      {
        name: outName,
        primitives: [{ attributes, indices: idxAcc, material: 0 }],
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

async function main() {
  for (const dir of OUT_DIRS) fs.mkdirSync(dir, { recursive: true });

  for (const job of JOBS) {
    const buf = fs.readFileSync(path.join(job.srcDir, job.src));
    const gltfIn = await parseBuf(buf);
    const mesh = findByName(gltfIn.scene, job.meshName);
    if (!mesh?.isMesh) {
      console.error('MISSING mesh', job.meshName, 'in', job.src);
      continue;
    }
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();

    const { gltf, bin } = meshToGltf(mesh, {
      outName: job.out,
      matName: job.matName,
      textureFile: job.texture,
    });

    if (!fs.existsSync(job.textureSrc)) {
      console.error('MISSING texture', job.textureSrc);
      continue;
    }
    for (const dir of OUT_DIRS) {
      fs.writeFileSync(path.join(dir, `${job.out}.gltf`), JSON.stringify(gltf, null, 2));
      fs.writeFileSync(path.join(dir, `${job.out}.bin`), bin);
      fs.copyFileSync(job.textureSrc, path.join(dir, job.texture));
      console.log('wrote', path.join(dir, `${job.out}.gltf`), `(bin ${(bin.length / 1024).toFixed(1)} KB)`);
    }
  }
  console.log(`done: A=${JOBS_A.length} B=${JOBS_B.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
