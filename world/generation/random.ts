/** Versioned, order-independent hashes; no global random stream or wall clock. */
export function hash(seed: string, subsystem: string, ...coordinates: number[]): number {
  let value = 2166136261;
  const key = `${seed.length}:${seed}|${subsystem}|${coordinates.join(',')}`;
  for (let i = 0; i < key.length; i++) value = Math.imul(value ^ key.charCodeAt(i), 16777619);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}
export function randomAt(seed: string, subsystem: string, ...coordinates: number[]): number {
  return hash(seed, subsystem, ...coordinates) / 4294967296;
}
