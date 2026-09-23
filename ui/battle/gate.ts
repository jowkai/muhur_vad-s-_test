import type { CommandIntent } from '../../contracts';

export type GateResult = 'sent' | 'busy' | 'rejected';
/**
 * One action at a time. While a command is in flight — and while the presentation plays its
 * receipt — further presses are ignored, so a double click can never spend two turns. The gate
 * holds no battle rules; it only serialises what reaches the shared command bus.
 */
export class BattleActionGate {
  private inFlight = false;
  private sent = 0;
  constructor(private readonly send: (intent: CommandIntent) => Promise<unknown>, private readonly allowed: () => boolean = () => true) {}
  get busy(): boolean { return this.inFlight; }
  get count(): number { return this.sent; }
  async submit(intent: CommandIntent | null): Promise<GateResult> {
    if (!intent) return 'rejected';
    if (this.inFlight) return 'busy';
    if (!this.allowed()) return 'rejected';
    this.inFlight = true;
    this.sent++;
    try { await this.send(intent); return 'sent'; }
    finally { this.inFlight = false; }
  }
}
