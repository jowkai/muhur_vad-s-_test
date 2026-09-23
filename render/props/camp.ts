import {
  ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshStandardMaterial,
  OctahedronGeometry, PointLight, TorusGeometry,
} from 'three';
import type { VecXZ } from '../../contracts';
import type { ResourceRegistry } from '../resources/registry';

export interface CampProps { readonly group: Group; update(seconds: number, reducedMotion: boolean): void; dispose(): void }
/**
 * The safe camp is deliberately free of obstacles, so it needs landmarks instead: a tent, a fire
 * and the seal stone the valley is named after. Everything is shared through the registry and
 * released on dispose; none of it collides or affects gameplay.
 */
export function createCampProps(registry: ResourceRegistry, camp: VecXZ): CampProps {
  const group = new Group();
  group.name = 'camp-props';
  group.position.set(camp.x, 0, camp.z);
  const keys: string[] = [];
  const piece = (key: string, geometry: () => Mesh['geometry'], colour: number, options: { emissive?: number; intensity?: number } = {}) => {
    const geometryKey = `camp:${key}:geometry`;
    const materialKey = `camp:${key}:material`;
    keys.push(geometryKey, materialKey);
    const material = registry.material(materialKey, () => {
      const created = new MeshStandardMaterial({ color: colour, roughness: 0.85, flatShading: true });
      if (options.emissive !== undefined) { created.emissive.set(options.emissive); created.emissiveIntensity = options.intensity ?? 1; }
      return created;
    });
    const mesh = new Mesh(registry.geometry(geometryKey, geometry), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const tent = piece('tent', () => new ConeGeometry(2.4, 3.1, 4), 0x7a5a33);
  tent.position.set(-6, 1.55, 3.5);
  tent.rotation.y = Math.PI / 4;
  const tentDoor = piece('tent-door', () => new ConeGeometry(0.9, 2, 3), 0x2c3629);
  tentDoor.position.set(-6, 1, 5.1);
  const plinth = piece('plinth', () => new CylinderGeometry(2.1, 2.4, 0.45, 8), 0x55605a);
  plinth.position.set(0, 0.22, 0);
  const pedestal = piece('pedestal', () => new CylinderGeometry(1.5, 1.85, 0.35, 8), 0x6d7a72);
  pedestal.position.set(0, 0.6, 0);
  const seal = piece('seal', () => new OctahedronGeometry(1.15), 0x7fd8b0, { emissive: 0x2c7a5c, intensity: 0.7 });
  seal.position.set(0, 2.6, 0);
  const halo = piece('halo', () => new TorusGeometry(1.7, 0.05, 6, 48), 0xbcd79a);
  halo.position.set(0, 2.6, 0);
  halo.rotation.x = Math.PI / 2.6;
  const fire = piece('fire', () => new ConeGeometry(0.45, 1.2, 5), 0xe08a3c, { emissive: 0xd4521a, intensity: 1.2 });
  fire.position.set(5.5, 0.6, 2.5);
  for (let index = 0; index < 7; index++) {
    const angle = (index / 7) * Math.PI * 2;
    const stone = piece(`fire-stone-${index % 2}`, () => new IcosahedronGeometry(0.3, 0), 0x6a6f63);
    stone.position.set(5.5 + Math.cos(angle) * 1.1, 0.16, 2.5 + Math.sin(angle) * 1.1);
    stone.rotation.set(index, index * 0.7, 0);
  }
  const glow = new PointLight(0xffb066, 6, 14, 2);
  glow.position.set(5.5, 1.4, 2.5);
  group.add(glow);
  let disposed = false;
  return {
    group,
    update(seconds, reducedMotion) {
      if (disposed) return;
      if (reducedMotion) { seal.position.y = 2.6; glow.intensity = 5; return; }
      seal.rotation.y = seconds * 0.4;
      seal.position.y = 2.6 + Math.sin(seconds * 1.3) * 0.14;
      halo.rotation.z = seconds * 0.18;
      glow.intensity = 5 + Math.sin(seconds * 6.2) * 1.4;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      for (const key of keys) registry.release(key);
    },
  };
}
