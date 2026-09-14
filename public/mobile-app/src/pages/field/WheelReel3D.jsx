import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { loadThree, makeRenderer, resizeRenderer, canUseWebGL } from '@/lib/game3d/loadThree';
import { makeWoodMap, makeBrassMap, makeStudioEnv, woodMat, brassMat } from '@/lib/game3d/procTextures';
import { makePrizeCardTexture } from '@/lib/prizeToken';

const CARD_COUNT = 12;
const ITEM_H = 66;
const RADIUS = 0.92;

const WheelReel3D = forwardRef(function WheelReel3D({ onReady, onFail }, ref) {
  const canvasRef = useRef(null);
  const apiRef = useRef(null);

  useImperativeHandle(ref, () => ({
    setItems(items) { apiRef.current?.setItems(items); },
    setOffset(y) { apiRef.current?.setOffset(y); },
    flash(tier) { apiRef.current?.flash(tier); },
    land() { apiRef.current?.land(); },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canUseWebGL()) {
      onFail?.();
      return undefined;
    }
    let disposed = false;
    let raf = 0;
    let THREE;

    (async () => {
      try {
        THREE = await loadThree();
      } catch {
        if (!disposed) onFail?.();
        return;
      }
      if (disposed) return;

      const renderer = makeRenderer(THREE, canvas, { exposure: 1.22, shadows: true });
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.08, 40);
      camera.position.set(0, 0.06, 3.15);
      camera.lookAt(0, 0, 0);

      const env = makeStudioEnv(THREE);
      scene.environment = env;
      const woodMap = makeWoodMap(THREE);
      const brassMap = makeBrassMap(THREE);
      const wood = woodMat(THREE, woodMap, env);
      const brass = brassMat(THREE, brassMap, env);
      const brassDark = brassMat(THREE, brassMap, env, { color: 0xb8860b, roughness: 0.38 });
      const wellMat = new THREE.MeshStandardMaterial({
        color: 0x07080e, roughness: 0.9, metalness: 0.1, envMap: env, envMapIntensity: 0.2,
      });

      const root = new THREE.Group();
      scene.add(root);

      // Housing — carved wooden drum with brass hoops
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.38, 1.38, 1.72, 48, 1, true), wood);
      shell.rotation.z = Math.PI / 2;
      shell.castShadow = true;
      shell.receiveShadow = true;
      root.add(shell);

      const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 1.55, 48, 1, true), wellMat);
      inner.rotation.z = Math.PI / 2;
      inner.scale.x = -1;
      root.add(inner);

      const endGeo = new THREE.CylinderGeometry(1.4, 1.4, 0.14, 48);
      const leftCap = new THREE.Mesh(endGeo, wood);
      leftCap.rotation.z = Math.PI / 2;
      leftCap.position.x = -0.86;
      leftCap.castShadow = true;
      const rightCap = leftCap.clone();
      rightCap.position.x = 0.86;
      root.add(leftCap, rightCap);

      const hoopGeo = new THREE.TorusGeometry(1.39, 0.045, 10, 48);
      const hoopL = new THREE.Mesh(hoopGeo, brass);
      hoopL.rotation.y = Math.PI / 2;
      hoopL.position.x = -0.78;
      const hoopR = hoopL.clone();
      hoopR.position.x = 0.78;
      const hoopM = hoopL.clone();
      hoopM.position.x = 0;
      hoopM.scale.setScalar(1.01);
      root.add(hoopL, hoopR, hoopM);

      // Window frame (front opening)
      const frame = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.055, 8, 40, Math.PI * 0.92), brassDark);
      frame.rotation.y = Math.PI / 2;
      frame.rotation.z = Math.PI * 0.54;
      frame.position.z = 0.42;
      root.add(frame);

      const pointerGeo = new THREE.ConeGeometry(0.07, 0.22, 8);
      const pL = new THREE.Mesh(pointerGeo, brass);
      pL.rotation.z = Math.PI / 2;
      pL.position.set(-1.05, 0, 1.05);
      const pR = pL.clone();
      pR.rotation.z = -Math.PI / 2;
      pR.position.x = 1.05;
      root.add(pL, pR);

      const floor = new THREE.Mesh(
        new THREE.CircleGeometry(2.4, 40),
        new THREE.MeshStandardMaterial({ color: 0x1a1208, roughness: 0.35, metalness: 0.2, envMap: env }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -1.05;
      floor.receiveShadow = true;
      scene.add(floor);

      const key = new THREE.DirectionalLight(0xfff0d0, 2.4);
      key.position.set(1.6, 2.8, 3.2);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 12;
      scene.add(key);
      scene.add(new THREE.AmbientLight(0x2a2430, 0.55));
      const rim = new THREE.PointLight(0xf0c850, 2.2, 8);
      rim.position.set(-1.4, 0.8, 1.6);
      scene.add(rim);
      const fill = new THREE.PointLight(0x4a70ff, 0.9, 7);
      fill.position.set(1.8, -0.2, 1.2);
      scene.add(fill);

      const reel = new THREE.Group();
      root.add(reel);

      const cards = [];
      const plane = new THREE.PlaneGeometry(1.55, 0.48);
      const slotAngle = (Math.PI * 2) / CARD_COUNT;
      for (let i = 0; i < CARD_COUNT; i++) {
        const mat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.42,
          metalness: 0.18,
          envMap: env,
          envMapIntensity: 0.55,
        });
        const mesh = new THREE.Mesh(plane, mat);
        const holder = new THREE.Group();
        holder.rotation.x = (i - 5) * slotAngle;
        mesh.position.z = RADIUS;
        mesh.castShadow = true;
        holder.add(mesh);
        reel.add(holder);
        cards.push({ holder, mesh, mat, tex: null, itemKey: '' });
      }

      // Gold dust
      const sparkCount = 80;
      const sparkPos = new Float32Array(sparkCount * 3);
      const sparkGeo = new THREE.BufferGeometry();
      sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
      const sparkMat = new THREE.PointsMaterial({
        color: 0xffe17a, size: 0.045, transparent: true, opacity: 0, depthWrite: false,
      });
      const sparks = new THREE.Points(sparkGeo, sparkMat);
      scene.add(sparks);
      let sparkLife = 0;

      let items = [];
      let offsetY = -ITEM_H;
      let lastBase = null;
      let flashT = 0;
      let landKick = 0;
      let time = 0;
      brass.emissive = new THREE.Color(0x000000);

      function modIndex(i) {
        if (!items.length) return 0;
        return ((i % items.length) + items.length) % items.length;
      }

      function applyCard(slot, prize) {
        const key = `${prize?.name}|${prize?.tier}|${prize?.icon || ''}|${prize?.icon_svg ? 's' : ''}`;
        if (slot.itemKey === key) return;
        slot.itemKey = key;
        if (slot.tex) slot.tex.dispose();
        slot.tex = makePrizeCardTexture(THREE, prize || { name: '—', tier: 'common' }, 256, 80);
        slot.mat.map = slot.tex;
        slot.mat.needsUpdate = true;
      }

      function paintWindow(base) {
        if (!items.length) return;
        for (let i = 0; i < CARD_COUNT; i++) {
          applyCard(cards[i], items[modIndex(base + i - 5)]);
        }
        lastBase = base;
      }

      function shiftWindow(base, dir) {
        if (!items.length) return;
        if (dir > 0) {
          const drop = cards[0];
          if (drop.tex) drop.tex.dispose();
          for (let i = 0; i < CARD_COUNT - 1; i++) {
            cards[i].tex = cards[i + 1].tex;
            cards[i].itemKey = cards[i + 1].itemKey;
            cards[i].mat.map = cards[i].tex;
            cards[i].mat.needsUpdate = true;
          }
          cards[CARD_COUNT - 1].tex = null;
          cards[CARD_COUNT - 1].itemKey = '';
          applyCard(cards[CARD_COUNT - 1], items[modIndex(base + 6)]);
        } else {
          const drop = cards[CARD_COUNT - 1];
          if (drop.tex) drop.tex.dispose();
          for (let i = CARD_COUNT - 1; i > 0; i--) {
            cards[i].tex = cards[i - 1].tex;
            cards[i].itemKey = cards[i - 1].itemKey;
            cards[i].mat.map = cards[i].tex;
            cards[i].mat.needsUpdate = true;
          }
          cards[0].tex = null;
          cards[0].itemKey = '';
          applyCard(cards[0], items[modIndex(base - 5)]);
        }
        lastBase = base;
      }

      function refreshCards() {
        if (!items.length) return;
        const base = Math.floor(-offsetY / ITEM_H);
        if (lastBase == null) {
          paintWindow(base);
          return;
        }
        const delta = base - lastBase;
        if (delta === 0) return;
        if (Math.abs(delta) === 1) shiftWindow(base, delta);
        else paintWindow(base);
      }

      function setItems(next) {
        items = Array.isArray(next) && next.length ? next : items;
        lastBase = null;
        refreshCards();
      }

      function setOffset(y) {
        offsetY = y;
      }

      function flash(tier) {
        flashT = tier === 'legendary' ? 1 : 0.7;
        sparkLife = 1;
        for (let i = 0; i < sparkCount; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 0.3 + Math.random() * 1.1;
          sparkPos[i * 3] = Math.cos(a) * r;
          sparkPos[i * 3 + 1] = (Math.random() - 0.5) * 1.2;
          sparkPos[i * 3 + 2] = 0.6 + Math.random() * 0.8;
        }
        sparkGeo.attributes.position.needsUpdate = true;
      }

      function land() {
        landKick = 1;
      }

      apiRef.current = { setItems, setOffset, flash, land };

      function tick(now) {
        if (disposed) return;
        const dt = Math.min(0.033, (now - (tick._t || now)) / 1000);
        tick._t = now;
        time += dt;
        refreshCards();
        const turns = -offsetY / ITEM_H;
        const frac = turns - Math.floor(turns);
        reel.rotation.x = frac * slotAngle;
        if (landKick > 0) {
          landKick = Math.max(0, landKick - dt * 3.2);
          reel.rotation.x += Math.sin(landKick * Math.PI) * 0.045;
        }
        root.rotation.y = Math.sin(time * 0.35) * 0.06;
        root.rotation.x = Math.sin(time * 0.22) * 0.02;
        if (flashT > 0) flashT = Math.max(0, flashT - dt * 1.1);
        rim.intensity = 2.2 + flashT * 8;
        brass.emissive.setRGB(0.94 * flashT, 0.78 * flashT, 0.31 * flashT);
        if (sparkLife > 0) {
          sparkLife = Math.max(0, sparkLife - dt * 0.85);
          sparkMat.opacity = sparkLife * 0.9;
          const pos = sparkGeo.attributes.position.array;
          for (let i = 0; i < sparkCount; i++) {
            pos[i * 3 + 1] += dt * 0.55;
          }
          sparkGeo.attributes.position.needsUpdate = true;
        } else sparkMat.opacity = 0;

        const w = canvas.clientWidth || 1;
        const h = canvas.clientHeight || 1;
        resizeRenderer(renderer, camera, w, h);
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      }
      raf = requestAnimationFrame(tick);
      onReady?.();
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      apiRef.current = null;
    };
  }, [onFail, onReady]);

  return <canvas ref={canvasRef} className="wn-reel3d" aria-hidden />;
});

export default WheelReel3D;
export { ITEM_H as REEL_ITEM_H };
