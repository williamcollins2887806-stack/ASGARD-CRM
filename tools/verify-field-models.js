'use strict';
/**
 * S3 sentinel: рантайм-проверка, что сжатые meshopt-модели реально грузятся
 * GLTFLoader + MeshoptDecoder (иначе аватар молча не появится).
 *
 * Запуск: node tools/verify-field-models.js
 * Требует: public/mobile-app/node_modules/three (уже есть) + playwright (в корне).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'public', 'mobile-app');
const MODELS = path.join(APP, 'public', 'assets', 'avatars', 'ranks');

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.webp': 'image/webp' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(APP, rel);
      if (!file.startsWith(APP) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.statusCode = 404; res.end('nf'); return;
      }
      res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  // Import map: GLTFLoader внутри импортирует bare-specifier 'three' — без карты
  // браузер не резолвит его. Ровно так же резолвит Vite на проде.
  await page.goto(`${base}/`).catch(() => {});
  await page.setContent(`<!DOCTYPE html><html><head>
    <script type="importmap">{"imports":{
      "three":"${base}/node_modules/three/build/three.module.js",
      "three/addons/":"${base}/node_modules/three/examples/jsm/"
    }}<\/script></head><body></body></html>`, { waitUntil: 'load' });

  const models = fs.readdirSync(MODELS).filter((f) => f.endsWith('.glb'));
  const results = [];

  for (const m of models) {
    const r = await page.evaluate(async ({ base, model }) => {
      try {
        const three = await import('three');
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        const url = `${base}/public/assets/avatars/ranks/${model}`;
        const gltf = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
        let meshes = 0, verts = 0, hasSkin = false;
        gltf.scene.traverse((o) => {
          if (o.isMesh) { meshes++; const p = o.geometry?.attributes?.position; if (p) verts += p.count; }
          if (o.isSkinnedMesh) hasSkin = true;
        });
        const idle = (gltf.animations || []).find((a) => /idle/i.test(a.name));
        return { ok: true, meshes, verts, hasSkin, anims: (gltf.animations || []).length, idle: idle ? idle.name : null, threeVer: three.REVISION };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    }, { base, model: m });

    results.push({ model: m, ...r });
  }

  await browser.close();
  srv.close();

  const failed = results.filter((r) => !r.ok);
  console.log('# S3 — проверка загрузки сжатых моделей (meshopt)\n');
  console.log('| модель | OK | мешей | вершин | скин | анимаций | idle |');
  console.log('|---|:-:|--:|--:|:-:|--:|---|');
  for (const r of results) {
    console.log(`| ${r.model} | ${r.ok ? 'да' : 'НЕТ'} | ${r.meshes ?? '-'} | ${r.verts ?? '-'} | ${r.hasSkin ? 'да' : '-'} | ${r.anims ?? '-'} | ${r.idle ?? '-'} |`);
  }
  if (errors.length) {
    console.log('\nОшибки консоли:');
    for (const e of errors.slice(0, 10)) console.log(`  - ${e}`);
  }
  if (failed.length) {
    console.error(`\nFAIL: ${failed.length} моделей не загрузились`);
    for (const f of failed) console.error(`  - ${f.model}: ${f.error}`);
    process.exit(1);
  }
  console.log(`\nOK — все ${results.length} моделей грузятся с meshopt-декодером (three r${results[0].threeVer})`);
})().catch((e) => { console.error(e); process.exit(1); });
