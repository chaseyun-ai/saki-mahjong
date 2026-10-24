import type { Ability, Foresight } from './types';

// 园城寺怜：一巡先见。平时只看自己下一巡会摸到的牌（假设没人鸣牌）；
// 玩家操作她时可以花体力“看下一巡”，看到这一巡每家打什么、谁鸣牌谁和牌（见 src/ui/foresee.ts）。
// 接下来一巡的四张牌会被“锁定”，其他人的能力不能再改动这些位置。
export const FORESIGHT_TILES = 4;

export const tokiAbility: Ability = {
  id: 'toki',
  name: '一巡先见',
  description: '平时能看到自己下一巡摸到的牌；花体力“看下一巡”时，能看到这一巡每家会打什么、有没有人鸣牌或和牌。接下来一巡的牌，其他人的能力无法改变。',

  afterDraw(g) {
    for (const t of g.wall.live.slice(0, FORESIGHT_TILES)) g.wall.locked.add(t);
  },

  // 只给她自己下一张：第几张轮到她，就是牌山里的第几张
  foresight(g, seat): Foresight | null {
    if (g.phase !== 'turn' && g.phase !== 'calls') return null;
    const i = (seat - g.nextDrawer() + 4) % 4;
    const tile = g.wall.live[i];
    return tile === undefined ? null : { title: '一巡先见', draws: [{ seat, tile }] };
  },
};
