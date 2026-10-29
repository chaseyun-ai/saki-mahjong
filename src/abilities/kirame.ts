import type { Ability } from './types';

// 花田煌（新道寺）：不会被击飞。规则全在引擎里（Ability.unbustable）：
// - 别人摸不到自摸了会把她击飞的牌（换成别的牌发过去）
// - 她自己放铳会被击飞的牌打不出去（加杠被抢杠会被击飞也不行）；她摸牌时保证摸完至少还有一张打得出去
// - 流局不听罚符最多付到 0 点
// 一直起作用：不看封印、佛灭，宫永照这样别人管不到的人也一样
export const kirameAbility: Ability = {
  id: 'kirame',
  name: '不会被击飞',
  description: '被动。无论如何都不会被击飞：别人永远摸不到自摸了会把她击飞的牌；放铳会被击飞的牌她打不出去；流局罚符最多付到 0 点。封印、佛灭都挡不住。',
  unbustable: true,

  skill() {
    return { label: '', note: '被动：不会被击飞。放铳会被击飞的牌是灰的，打不出去', enabled: false };
  },

  insight(g, seat) {
    return [`不会被击飞：现在 ${g.players[seat].score} 点，自摸、放铳都不会让她低于 0`];
  },
};
