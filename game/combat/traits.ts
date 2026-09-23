import type { DayPhase } from '../../contracts';
import { TRAIT_IDS, type Element, type TraitId } from '../../content/schema';

/**
 * Species passives. COMBAT.md is the authority for the numbers; this file is the only place
 * that turns a trait id into a rule.
 *
 * One invariant governs every entry: **a trait never draws a die.** Every effect is a
 * multiplier, a threshold or a counter, so the dice budget, the replay determinism and the
 * idempotency ledger all stay exactly as they were before traits existed. A trait that wanted
 * a chance roll would have to change the RNG contract, and it is not allowed to.
 */

/** Per-side bookkeeping a few traits need across turns; everything else is derived. */
export interface TraitState {
  /** Attacks this side has already absorbed; `siperci` softens the first one only. */
  readonly hitsTaken: number;
  /** Consecutive attacking turns; `sarjor` banks these into power. */
  readonly streak: number;
  /** Whether the once-per-battle rescue has been spent. */
  readonly rescued: boolean;
  /** Whether this side guarded on its previous action; `yankikalkan` cashes that in. */
  readonly guardedLast: boolean;
}
export const EMPTY_TRAIT_STATE: TraitState =
  Object.freeze({ hitsTaken: 0, streak: 0, rescued: false, guardedLast: false });

/** Everything a trait may read. Pure inputs: the same context always yields the same modifiers. */
export interface TraitContext {
  readonly trait: TraitId;
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly element: Element;
  readonly state: TraitState;
  readonly dayPhase: DayPhase;
  /** Standing team mates besides the fighter itself; `suru` scales with them. */
  readonly allies: number;
  readonly enemyLevel: number;
  readonly enemyElement: Element;
  /** Effectiveness of the move about to land, so `element_emici` can read a weak hit. */
  readonly effectiveness: number;
  readonly guarded: boolean;
}

/** What a trait may change. Neutral values leave the fight exactly as it was. */
export interface TraitMods {
  readonly outgoing: number;
  readonly incoming: number;
  readonly powerBonus: number;
  readonly accuracy: number;
  readonly staminaDiscount: number;
  readonly ignoreGuard: boolean;
  readonly maxHpBonus: number;
  /** Turn-end regeneration, as a divisor of maxHp; 0 is none. */
  readonly regenDivisor: number;
  /** Statuses this trait refuses outright. */
  readonly immune: readonly string[];
  /** A weak hit heals instead of hurting. */
  readonly absorbWeak: boolean;
  /** Survives one lethal blow per battle at 1 HP. */
  readonly rescues: boolean;
  /** Added to a status move's chance threshold; still exactly one die, just a kinder cut. */
  readonly statusBonus: number;
  /** Poisons an attacker on every Nth landed hit; 0 is never. Deterministic by count. */
  readonly contactPoison: number;
  /** Heals each standing team mate by this fraction when the holder leaves the field. */
  readonly switchHeal: number;
  /** Extra turns shaved off this side's status clocks each turn end. */
  readonly statusTick: number;
  /** Sends the next creature in with a guard already up when this one faints. */
  readonly guardsSuccessor: boolean;
}
const NEUTRAL: TraitMods = Object.freeze({
  outgoing: 1, incoming: 1, powerBonus: 0, accuracy: 0, staminaDiscount: 0, ignoreGuard: false,
  maxHpBonus: 0, regenDivisor: 0, immune: Object.freeze([]), absorbWeak: false, rescues: false,
  statusBonus: 0, contactPoison: 0, switchHeal: 0, statusTick: 0, guardsSuccessor: false,
});

/**
 * Trait strength opens with the creature: the base rule at level 1, a sharper one at twenty
 * and its full form at thirty-five. This is what makes levels past ten mean something.
 */
export function traitTier(level: number): 1 | 2 | 3 {
  return level >= 35 ? 3 : level >= 20 ? 2 : 1;
}
/** Scales a bonus by tier: a +40 % rule reads +40 / +50 / +60 %. */
const step = (level: number, base: number, per: number) => base + per * (traitTier(level) - 1);


export { TRAIT_IDS };
/** Short Turkish blurbs; the battle card and the bestiary both read these. */
export const TRAIT_LABELS: Readonly<Record<TraitId, { readonly name: string; readonly hint: string }>> = Object.freeze({
  siperci: { name: 'Siperci', hint: 'Savaşta aldığı ilk vuruşu yarıya indirir' },
  agir_zirh: { name: 'Ağır Zırh', hint: 'Gelen hasarı azaltır, kendi hasarını biraz düşürür' },
  inatci: { name: 'İnatçı', hint: 'Savaşta bir kez ölümcül vuruştan 1 canla kurtulur' },
  element_emici: { name: 'Element Emici', hint: 'Zayıf gelen saldırılar can yazar' },
  berserk: { name: 'Berserk', hint: 'Canı üçte birin altındayken çok daha sert vurur' },
  sarjor: { name: 'Şarjör', hint: 'Üst üste saldırdıkça güç biriktirir' },
  avci: { name: 'Avcı', hint: 'Kendinden düşük seviyeli rakibe daha sert vurur' },
  yirtici_pence: { name: 'Yırtıcı Pençe', hint: 'Siperi yok sayar' },
  kor_zirhi: { name: 'Kor Zırhı', hint: 'Yanmaz; yanık onu iyileştirir' },
  buz_kabuk: { name: 'Buz Kabuk', hint: 'Yavaşlamaz' },
  zehirli_deri: { name: 'Zehirli Deri', hint: 'Vuranı zamanla zehirler' },
  isik_halesi: { name: 'Işık Halesi', hint: 'Üzerindeki statüler daha hızlı geçer' },
  simbiyoz: { name: 'Simbiyoz', hint: 'Sahadan çekilince takımına can verir' },
  suru: { name: 'Sürü', hint: 'Ayakta duran her dost için güçlenir' },
  tohumcu: { name: 'Tohumcu', hint: 'Bayılınca yerine geleni siperle sokar' },
  yanki: { name: 'Yankı', hint: 'Statü etkilerini daha sık yazar' },
  gececi: { name: 'Gececi', hint: 'Gece güçlenir' },
  gunesci: { name: 'Güneşçi', hint: 'Gündüz güçlenir' },
  ruzgar_binici: { name: 'Rüzgâr Binici', hint: 'İsabeti yüksektir' },
  kok_saldi: { name: 'Kök Saldı', hint: 'Her tur sonunda az miktarda can toplar' },
  tas_yurek: { name: 'Taş Yürek', hint: 'Canı türünün üstündedir' },
  golge_avi: { name: 'Gölge Avı', hint: 'Kendi elementinden rakibe sert vurur' },
  hizli_refleks: { name: 'Hızlı Refleks', hint: 'Hareketleri daha az enerji yakar' },
  yankikalkan: { name: 'Yankı Kalkan', hint: 'Siperden sonraki vuruşu ağırdır' },
});

/**
 * The one passive the stat curve itself has to know about, so `stats()` can stay a pure
 * function of species and level.
 */
export function traitMaxHpBonus(trait: TraitId, level: number): number {
  return trait === 'tas_yurek' ? step(level, .15, .05) : 0;
}
/** The whole rule set. Pure: no dice, no clock, no reads outside the context. */
export function traitModifiers(context: TraitContext): TraitMods {
  const { trait, level, hp, maxHp, state, dayPhase, allies, enemyLevel, element, enemyElement, effectiveness } = context;
  const low = maxHp > 0 && hp / maxHp < .3;
  switch (trait) {
    case 'siperci':
      return { ...NEUTRAL, incoming: state.hitsTaken === 0 ? 1 - step(level, .5, .05) : 1 };
    case 'agir_zirh':
      return { ...NEUTRAL, incoming: 1 - step(level, .2, .05), outgoing: .9 };
    case 'inatci':
      return { ...NEUTRAL, rescues: !state.rescued };
    case 'element_emici':
      return { ...NEUTRAL, absorbWeak: effectiveness < 1 };
    case 'berserk':
      return { ...NEUTRAL, outgoing: low ? 1 + step(level, .4, .1) : 1 };
    case 'sarjor':
      return { ...NEUTRAL, powerBonus: Math.min(step(level, 6, 3), 2 * state.streak) };
    case 'avci':
      return { ...NEUTRAL, outgoing: enemyLevel < level ? 1 + step(level, .25, .05) : 1 };
    case 'yirtici_pence':
      return { ...NEUTRAL, ignoreGuard: true };
    case 'kor_zirhi':
      return { ...NEUTRAL, immune: Object.freeze(['burn']) };
    case 'buz_kabuk':
      return { ...NEUTRAL, immune: Object.freeze(['slow']) };
    case 'zehirli_deri':
      // Every third blow landed on this hide leaves the striker poisoned; no die is drawn.
      return { ...NEUTRAL, contactPoison: traitTier(level) >= 3 ? 2 : 3 };
    case 'isik_halesi':
      return { ...NEUTRAL, statusTick: traitTier(level) >= 2 ? 2 : 1 };
    case 'simbiyoz':
      return { ...NEUTRAL, switchHeal: step(level, .10, .03) };
    case 'suru':
      return { ...NEUTRAL, outgoing: 1 + Math.min(.3, step(level, .05, .02) * allies) };
    case 'tohumcu':
      return { ...NEUTRAL, guardsSuccessor: true };
    case 'yanki':
      return { ...NEUTRAL, statusBonus: step(level, .15, .05) };
    case 'gececi':
      return { ...NEUTRAL, outgoing: dayPhase === 'night' ? 1 + step(level, .2, .05) : 1, incoming: dayPhase === 'night' ? .9 : 1 };
    case 'gunesci':
      return { ...NEUTRAL, outgoing: dayPhase === 'day' ? 1 + step(level, .2, .05) : 1, incoming: dayPhase === 'day' ? .9 : 1 };
    case 'ruzgar_binici':
      return { ...NEUTRAL, accuracy: step(level, .05, .02) };
    case 'kok_saldi':
      return { ...NEUTRAL, regenDivisor: traitTier(level) >= 3 ? 10 : traitTier(level) === 2 ? 13 : 16 };
    case 'tas_yurek':
      return { ...NEUTRAL, maxHpBonus: step(level, .15, .05) };
    case 'golge_avi':
      return { ...NEUTRAL, outgoing: element === enemyElement ? 1 + step(level, .3, .05) : 1 };
    case 'hizli_refleks':
      return { ...NEUTRAL, staminaDiscount: traitTier(level) >= 2 ? 1 : 0 };
    case 'yankikalkan':
      return { ...NEUTRAL, outgoing: state.guardedLast ? 1 + step(level, .5, .1) : 1 };
  }
}
/** Advances the per-side counters a trait reads. Called once per action, never with a die. */
export function advanceTraitState(
  state: TraitState, event: 'attacked' | 'took-hit' | 'guarded' | 'other' | 'rescued',
): TraitState {
  switch (event) {
    case 'attacked': return { ...state, streak: Math.min(8, state.streak + 1), guardedLast: false };
    case 'took-hit': return { ...state, hitsTaken: state.hitsTaken + 1 };
    case 'guarded': return { ...state, streak: 0, guardedLast: true };
    case 'rescued': return { ...state, rescued: true };
    case 'other': return { ...state, streak: 0, guardedLast: false };
  }
}
