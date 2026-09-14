let threePromise = null;

export function loadThree() {
  if (!threePromise) {
    threePromise = import('three');
  }
  return threePromise;
}

export function canUseWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

export function makeRenderer(THREE, canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    premultipliedAlpha: false,
    ...opts,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1.18;
  renderer.shadowMap.enabled = opts.shadows !== false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function resizeRenderer(renderer, camera, w, h) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(Math.max(1, w), Math.max(1, h), false);
  if (camera.isPerspectiveCamera) {
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
}
