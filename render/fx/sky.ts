import type { Color, Fog, HemisphereLight, DirectionalLight, Scene } from 'three';
import { phaseAt, skyLight } from '../../world/daynight';

export interface SkySetting {
  readonly sky: number; readonly fog: number; readonly ambient: number;
  readonly sun: number; readonly shadows: boolean; readonly near: number; readonly far: number;
}
/**
 * The whole look of the hour in one record, derived from the save's day tick. Shadows are a
 * daytime feature: at night the sun is below the valley and a shadow map would only cost frames.
 */
export function skySetting(dayTick: number): SkySetting {
  const light = skyLight(dayTick);
  const night = phaseAt(dayTick) === 'night';
  return Object.freeze({
    sky: light.sky, fog: light.fog, ambient: light.ambient, sun: light.sun,
    shadows: !night,
    // Night closes the valley in: the fog starts sooner and ends sooner.
    near: night ? 45 : 75, far: night ? 110 : 160,
  });
}
export interface SkyTargets {
  readonly scene: Scene; readonly hemisphere: HemisphereLight; readonly sun: DirectionalLight;
  readonly setShadows: (enabled: boolean) => void;
}
/** Applies a setting to the live scene. Pure data in, three.js objects mutated, nothing read back. */
export function applySky(targets: SkyTargets, setting: SkySetting): void {
  (targets.scene.background as Color | null)?.setHex(setting.sky);
  const fog = targets.scene.fog as Fog | null;
  if (fog) { fog.color.setHex(setting.fog); fog.near = setting.near; fog.far = setting.far; }
  targets.hemisphere.intensity = 2 * setting.ambient;
  targets.sun.intensity = 2.5 * setting.sun;
  targets.sun.color.setHex(setting.sky);
  targets.sun.castShadow = setting.shadows;
  targets.setShadows(setting.shadows);
}
