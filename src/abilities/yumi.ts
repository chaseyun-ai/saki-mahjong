import { luckyDeal, luckyDraw } from './luck';
import type { Ability } from './types';

// 加治木由美（鹤贺）：沉着。被动，一直起作用：配牌、进张比没有能力的人顺 5%（和龙门渊透华常态一样）
export const YUMI = {
  luck: 0.05,
};

export const yumiAbility: Ability = {
  id: 'yumi',
  name: '沉着',
  description: `被动。配牌、进张比没有能力的人顺 ${YUMI.luck * 100}%。`,

  beforeDeal(g, seat) {
    luckyDeal(g, seat, YUMI.luck);
  },

  beforeDraw(g, seat, rinshan) {
    luckyDraw(g, seat, rinshan, YUMI.luck);
  },

  skill() {
    return { label: '', note: `配牌、进张顺 ${YUMI.luck * 100}%`, enabled: false };
  },

  insight() {
    return [`配牌、进张顺 ${YUMI.luck * 100}%`];
  },
};
