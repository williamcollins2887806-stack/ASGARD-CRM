/**
 * Convert OGA CC0 viking helm OBJ → hat_external_viking.gltf (option C).
 * Source: https://opengameart.org/content/viking-helm (CC0)
 *
 * Usage: node tools/convert_external_viking_helm.mjs
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const THREE_ROOT = path.join(ROOT, 'public/mobile-app/node_modules');
const require = createRequire(path.join(THREE_ROOT, 'package.json'));
const THREE = require('three');
const { OBJLoader } = await import(
  pathToFileURL(path.join(THREE_ROOT, 'three/examples/jsm/loaders/OBJLoader.js')).href
);

const OUT_DIRS = [
  path.join(ROOT, 'public/m/assets/avatars/helmets'),
  path.join(ROOT, 'public/mobile-app/public/assets/avatars/helmets'),
];
const OBJ = path.join(ROOT, '_tmp_kaykit/viking_helm/viking helm.obj');
const OUT = 'hat_external_viking';
const TARGET_HEIGHT = 1.05; // KayKit hat ballpark

function f32(arr) {
  return Buffer.from(new Float32Array(arr).buffer);
}
function u16(arr) {
  return Buffer.from(new Uint16Array(arr).buffer);
}
function u32(arr) {
  return Buffer.from(new Uint32Array(arr).buffer);
}

function geometryToGltf(geo, outName) {
  if (!geo.index) geo = geo.toNonIndexed();
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
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
    {
      bufferView: idxView,
      componentType: useU32 ? 5125 : 5123,
      count: idx.length,
      type: 'SCALAR',
    },
  ];

  const gltf = {
    asset: { generator: 'ASGARD convert_external_viking_helm', version: '2.0' },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{ mesh: 0, name: outName }],
    materials: [
      {
        doubleSided: true,
        name: 'metal',
        pbrMetallicRoughness: {
          baseColorFactor: [0.55, 0.58, 0.62, 1],
          metallicFactor: 0.35,
          roughnessFactor: 0.45,
        },
      },
    ],
    meshes: [
      {
        name: outName,
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            indices: 2,
            material: 0,
          },
        ],
      },
    ],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: offset, uri: `${outName}.bin` }],
  };
  return { gltf, bin: Buffer.concat(parts) };
}

const text = fs.readFileSync(OBJ, 'utf8');
const group = new OBJLoader().parse(text);
const geos = [];
group.traverse((o) => {
  if (o.isMesh) geos.push(o.geometry.clone());
});
if (!geos.length) throw new Error('no meshes in OBJ');

// Merge
let geo = geos[0];
for (let i = 1; i < geos.length; i++) {
  // naive: convert all to one BufferGeometry via mergeVertices not available — use Group bake
}
const tmp = new THREE.Group();
geos.forEach((g) => {
  const m = new THREE.Mesh(g);
  tmp.add(m);
});
tmp.updateMatrixWorld(true);

// Bake world positions into a single non-indexed geometry
const positions = [];
const normals = [];
tmp.traverse((o) => {
  if (!o.isMesh) return;
  const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
  const pos = g.attributes.position;
  const nor = g.attributes.normal || (() => {
    g.computeVertexNormals();
    return g.attributes.normal;
  })();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
    positions.push(v.x, v.y, v.z);
    n.fromBufferAttribute(nor, i).transformDirection(o.matrixWorld).normalize();
    normals.push(n.x, n.y, n.z);
  }
});

const merged = new THREE.BufferGeometry();
merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
// trivial index
const idxArr = new Array(positions.length / 3);
for (let i = 0; i < idxArr.length; i++) idxArr[i] = i;
merged.setIndex(idxArr);

merged.computeBoundingBox();
const size = new THREE.Vector3();
const center = new THREE.Vector3();
merged.boundingBox.getSize(size);
merged.boundingBox.getCenter(center);

const s = TARGET_HEIGHT / Math.max(size.y, 0.01);
// Center XZ, sit bottom near head bone (y≈0); KayKit hats are ~1 tall
merged.translate(-center.x, -merged.boundingBox.min.y, -center.z);
merged.scale(s, s, s);
merged.translate(0, 0.02, 0);
merged.computeVertexNormals();
merged.computeBoundingBox();
console.log(
  'fitted size',
  new THREE.Vector3().subVectors(merged.boundingBox.max, merged.boundingBox.min).toArray().map((n) => +n.toFixed(3)),
);

const { gltf, bin } = geometryToGltf(merged, OUT);
for (const dir of OUT_DIRS) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${OUT}.gltf`), JSON.stringify(gltf, null, 2));
  fs.writeFileSync(path.join(dir, `${OUT}.bin`), bin);
  console.log('wrote', path.join(dir, `${OUT}.gltf`), `${(bin.length / 1024).toFixed(1)} KB`);
}
