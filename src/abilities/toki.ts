import type { Game } from '../engine/game';
import type { Ability, Foresight } from './types';

// 园城寺怜：一巡先见。能看到接下来一巡四个人各自会摸到的牌（假设没人鸣牌）。
// 她看见的牌会被“锁定”，其他人的能力不能再改动这些位置。
export const FORESIGHT_TILES = 4;

function nextDrawer(g: Game): number {
  if (g.phase === 'turn') return (g.turn + 1) % 4;
  return ((g.lastDiscard?.seat ?? g.turn) + 1) % 4;
}

export const tokiAbility: Ability = {
  id: 'toki',
  name: '一巡先见',
  description: '能看到接下来一巡每个人会摸到的牌。她看到的牌，其他人的能力无法改变。',

  afterDraw(g) {
    for (const t of g.wall.live.slice(0, FORESIGHT_TILES)) g.wall.locked.add(t);
  },

  foresight(g): Foresight | null {
    if (g.phase !== 'turn' && g.phase !== 'calls') return null;
    const start = nextDrawer(g);
    const draws = g.wall.live.slice(0, FORESIGHT_TILES).map((tile, i) => ({ seat: (start + i) % 4, tile }));
    return { title: '一巡先见', draws };
  },
};
