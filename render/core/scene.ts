import * as THREE from 'three';
import { FollowCamera } from '../camera/follow-camera';

/** Owns the renderer, lights and host listeners. Callers own meshes they add to scene. */
export function createRenderCore(host: HTMLElement) {
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  host.append(status);
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch (error) { status.textContent = 'WebGL açılamadı. Donanım hızlandırmasını kontrol edip yenileyin.'; throw error; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#142a28');
  scene.fog = new THREE.Fog('#142a28', 75, 160);
  const hemisphere = new THREE.HemisphereLight('#d5ebcb', '#3b4d49', 2);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight('#ffe4bb', 2.5); sun.position.set(-20, 40, 10); sun.castShadow = true; scene.add(sun);
  const followCamera = new FollowCamera();
  let lost = false, disposed = false;
  const resize = () => {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height); followCamera.resize(width, height);
  };
  const contextLost = (event: Event) => { event.preventDefault(); lost = true; status.hidden = false; status.textContent = 'Grafik bağlantısı kesildi. Yeniden bağlanması bekleniyor.'; };
  const contextRestored = () => { lost = false; status.hidden = true; resize(); };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
  host.append(renderer.domElement); status.hidden = true;
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  return {
    scene, renderer, followCamera, hemisphere, sun,
    /** Shadows follow the world clock; the sky layer turns them off after dusk. */
    setShadows(enabled: boolean) { renderer.shadowMap.enabled = enabled; },
    render() { if (!disposed && !lost) renderer.render(scene, followCamera.camera); },
    dispose() {
      if (disposed) return; disposed = true;
      observer.disconnect(); renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
      sun.shadow.dispose(); scene.clear(); renderer.dispose(); renderer.forceContextLoss();
      renderer.domElement.remove(); status.remove();
    },
  };
}
