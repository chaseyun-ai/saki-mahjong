import type { Game } from '../engine/game';
import type { Ability } from './types';

// 末原恭子（姬松）：凡人的抗争。她自己说自己是凡人，没有超能力，靠研究对手和鸣牌搅乱牌的流向来对抗怪物。
// - 打乱流向：她每吃、碰、明杠一次，从那一刻起到她下一次摸牌之前，场上别人的能力都不起作用（和被封印一样）。
//   作者钦定的（玄）和别人动不了的（照）不受影响
// - 没有控场，牌山一张都不动
// 电脑的恭子：桌上有能力起作用的人时，能鸣就鸣（不退向听也鸣），用鸣牌打断他们
export const KYOUKO = {
  // 电脑：牌山剩这么多以上才为了打断而鸣（太晚了鸣也没意义）
  aiMinWall: 8,
};

interface KyoukoState {
  melds?: number; // 上一次看到的副露数（吃、碰、明杠、加杠都算）
  breaking?: boolean; // 正在打乱流向
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as KyoukoState;

const calls = (g: Game, seat: number) => g.players[seat].melds.filter((m) => m.type !== 'ankan').length;

// 现在是不是正在打乱流向
export function kyoukoBreaking(g: Game, seat: number): boolean {
  return !!stateOf(g, seat).breaking;
}

// 她打断得了的人：有能力、不是玄和照、这一局没被别人封印（她自己正在打断的也算）
export function kyoukoTargets(g: Game, seat: number): number[] {
  return [0, 1, 2, 3].filter((s) => {
    const a = g.abilities[s];
    if (s === seat || !a || a.immune || a.absolute) return false;
    return !g.abilities.some((b, o) => o !== s && o !== seat && !!b?.seals?.(g, o, g.round));
  });
}

export const kyoukoAbility: Ability = {
  id: 'kyouko',
  name: '凡人的抗争',
  description: '没有超能力，靠研究对手和鸣牌搅乱牌的流向。她每吃、碰、明杠一次，到她下一次摸牌之前，场上别人的能力都不起作用（玄和照除外）。',

  onRoundStart(g, seat) {
    stateOf(g, seat).melds = 0;
  },

  // 鸣牌以后打出那张牌：从这里开始打乱流向
  afterDiscard(g, seat) {
    const st = stateOf(g, seat);
    const n = calls(g, seat);
    if (n > (st.melds ?? 0) && !st.breaking) {
      st.breaking = true;
      if (kyoukoTargets(g, seat).length) g.emit({ type: 'ability', seat, ability: 'kyouko', text: '打乱流向' });
    }
    st.melds = n;
  },

  // 明杠、加杠以后的岭上牌：杠完摸牌那一刻也算打乱了
  beforeDraw(g, seat, rinshan) {
    const st = stateOf(g, seat);
    if (!rinshan) {
      st.breaking = false;
      st.melds = calls(g, seat);
    }
  },

  // 打乱流向时，这一局别人的能力都不起作用
  seals(g, seat, round) {
    return round === g.round && g.phase !== 'predeal' && kyoukoBreaking(g, seat);
  },

  skill(g, seat) {
    const on = kyoukoBreaking(g, seat);
    return { label: '', note: on ? '打乱流向中：到下一次摸牌之前，别人的能力不起作用' : '吃、碰、明杠以后打乱流向', enabled: false, active: on };
  },

  badge(g, seat) {
    return kyoukoBreaking(g, seat) ? '打乱' : null;
  },

  insight(g, seat) {
    return [kyoukoBreaking(g, seat) ? '正在打乱流向：到她下一次摸牌之前，别人的能力不起作用' : '吃、碰、明杠以后，到她下一次摸牌之前，别人的能力不起作用'];
  },
};
