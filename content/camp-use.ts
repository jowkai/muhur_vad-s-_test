import type { SavePort } from '../contracts';
import { itemById } from './catalog';
import { ContentError, contentTransaction, planInventory, type ContentState } from './alchemy';
import { grantXp, type OwnedCreature } from '../game/progression';

export function useCampItem<T extends ContentState>(save: SavePort<T>, commandId: string, itemId: string, creatureId?: string): Promise<T> {
  return contentTransaction(save, commandId, (draft) => {
    if (!draft.atCamp || (draft.mode !== 'exploring' && draft.mode !== 'panel')) throw new ContentError('context', 'Eşyalar yalnız güvenli kampta kullanılabilir.');
    const item = itemById(itemId);
    const effect = item?.effect;
    if (!effect || effect.context !== 'camp') throw new ContentError('invalid-item', 'Bu eşya kampta kullanılamaz.');
    const input = [{ itemId, quantity: 1 }];
    if (effect.kind === 'grant_heat_herb') {
      draft.inventory = planInventory(draft.inventory, input, [{ itemId: 'heat_herb', quantity: effect.value }]);
      return;
    }
    const target = draft.creatures.find((creature) => creature.id === creatureId);
    if (!target) throw new ContentError('invalid-target', 'Geçerli bir yaratık seçin.');
    if (effect.kind === 'grant_xp') {
      // A training tonic pays experience through the same ladder a battle uses.
      if (target.hp === 0) throw new ContentError('invalid-target', 'Baygın yaratık eğitilemez.');
      const inventory = planInventory(draft.inventory, input, []);
      draft.inventory = inventory;
      // The content projection carries the narrower creature shape; progression owns the ladder.
      Object.assign(target, grantXp(target as OwnedCreature, effect.value));
      return;
    }
    let hp: number;
    if (effect.kind === 'revive_fraction') {
      if (target.hp !== 0) throw new ContentError('invalid-target', 'Uyanış Tuzu yalnız baygın yaratıklarda kullanılabilir.');
      hp = Math.ceil(target.maxHp * effect.value);
    } else {
      if (target.hp === 0) throw new ContentError('invalid-target', 'Baygın yaratık için Uyanış Tuzu gerekir.');
      if (target.hp === target.maxHp) throw new ContentError('invalid-target', 'Yaratığın canı zaten tam.');
      if (effect.kind !== 'heal' && effect.kind !== 'heal_full') throw new ContentError('invalid-item', 'Bu eşya burada kullanılamaz.');
      hp = effect.kind === 'heal_full' ? target.maxHp : Math.min(target.maxHp, target.hp + effect.value);
    }
    const inventory = planInventory(draft.inventory, input, []);
    // Both changes are made only after every validation and capacity check succeeds.
    draft.inventory = inventory;
    target.hp = hp;
  });
}
