import type { Game } from '../engine/game';
import { doraFromIndicator, isRed, kindOf } from '../engine/tiles';
import type { Ability } from './types';

// 松实玄：宝牌会聚集到她手里。一旦打出宝牌，这一局宝牌就不再来了。
export const DRAW_CHANCE = 0.4;

interface KuroState {
  lost?: boolean;
}

export function isDoraTile(g: Game, t: number): boolean {
  if (isRed(t)) return true;
  const doraKinds = g.wall.visibleDoraIndicators().map((i) => doraFromIndicator(kindOf(i)));
  return doraKinds.includes(kindOf(t));
}

export const kuroAbility: Ability = {
  id: 'kuro',
  name: '宝牌聚集',
  description: `每次摸牌有 ${DRAW_CHANCE * 100}% 的概率摸到宝牌或赤宝牌。打出宝牌后，本局能力失效。`,

  beforeDraw(g, seat, rinshan) {
    const st = g.abilityState[seat] as KuroState;
    if (st.lost || rinshan || !g.rng.chance(DRAW_CHANCE)) return;
    if (g.wall.bringToLive(0, (t) => isDoraTile(g, t), g.rng)) {
      g.emit({ type: 'ability', seat, ability: 'kuro', text: '宝牌聚集' });
    }
  },

  afterDiscard(g, seat, tile) {
    const st = g.abilityState[seat] as KuroState;
    if (st.lost || !isDoraTile(g, tile)) return;
    st.lost = true;
    g.emit({ type: 'ability', seat, ability: 'kuro', text: '打出了宝牌，本局宝牌不再聚集' });
  },
};
