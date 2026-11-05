import type { Game } from '../engine/game';
import { luckyDeal, luckyDraw } from './luck';
import type { Ability } from './types';

// 池田华菜（风越）：背水。被动。
// 自己的点数低于 10000 点时（团体赛里就是队伍的点数）越打越凶：配牌、进张比没有能力的人顺 15%。
// 配牌看发牌那一刻的点数，进张看摸牌那一刻的点数（立直交出去的 1000 点也算）
export const KANA = {
  below: 10000, // 点数低于这么多起作用
  luck: 0.15, // 配牌、进张顺多少
};

export const kanaCornered = (g: Game, seat: number): boolean => g.players[seat].score < KANA.below;

export const kanaAbility: Ability = {
  id: 'kana',
  name: '背水',
  description: `被动。自己的点数低于 ${KANA.below} 点时（团体赛是队伍的点数），配牌、进张比没有能力的人顺 ${KANA.luck * 100}%。`,

  beforeDeal(g, seat) {
    if (kanaCornered(g, seat)) luckyDeal(g, seat, KANA.luck);
  },

  onRoundStart(g, seat) {
    if (kanaCornered(g, seat)) g.emit({ type: 'ability', seat, ability: 'kana', text: '背水' });
  },

  beforeDraw(g, seat, rinshan) {
    if (kanaCornered(g, seat)) luckyDraw(g, seat, rinshan, KANA.luck);
  },

  skill(g, seat) {
    const on = kanaCornered(g, seat);
    return { label: '', note: on ? `背水：配牌、进张顺 ${KANA.luck * 100}%` : `点数低于 ${KANA.below} 点时配牌、进张变顺`, enabled: false, active: on };
  },

  badge(g, seat) {
    return kanaCornered(g, seat) ? '背水' : null;
  },

  insight(g, seat) {
    return [kanaCornered(g, seat) ? `背水中：配牌、进张顺 ${KANA.luck * 100}%` : `还有 ${g.players[seat].score} 点，低于 ${KANA.below} 点才发动`];
  },
};
