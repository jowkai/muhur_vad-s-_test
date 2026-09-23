/** Shared simulation constants; rendering never owns gameplay time. */
export const GAME_CONFIG = Object.freeze({
  seed: 'wildseal-01', worldSize: 2048, chunkSize: 64, cellSize: 2,
  fixedStep: 1 / 60, maxSubsteps: 5, maxFrameDelta: 5 / 60,
  visualChunkRadius: 2, simulationChunkRadius: 1, maxResidentChunks: 49,
  safeCampRadius: 40, interactionRadius: 6, proximityRadius: 24,
});
