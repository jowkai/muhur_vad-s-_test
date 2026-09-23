import { GAME_CONFIG } from '../../config';

export class FixedStepClock {
  private accumulator = 0;
  droppedSeconds = 0;
  reset(): void { this.accumulator = 0; }
  advance(delta: number, step: (seconds: number) => void, paused = false): { steps: number; alpha: number } {
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError('Geçersiz kare süresi.');
    if (paused) { this.reset(); return { steps: 0, alpha: 0 }; }
    const accepted = Math.min(delta, GAME_CONFIG.maxFrameDelta);
    this.droppedSeconds += delta - accepted;
    this.accumulator += accepted;
    let steps = 0;
    while (this.accumulator + 1e-12 >= GAME_CONFIG.fixedStep && steps < GAME_CONFIG.maxSubsteps) {
      step(GAME_CONFIG.fixedStep);
      this.accumulator = Math.max(0, this.accumulator - GAME_CONFIG.fixedStep);
      steps++;
    }
    return { steps, alpha: this.accumulator / GAME_CONFIG.fixedStep };
  }
}
