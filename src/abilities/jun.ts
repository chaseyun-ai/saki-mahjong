import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { KIND_COUNT, Kind, kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 井上纯（龙门渊）：流向。原作里她靠鸣牌把牌的流向错开，让别人的手牌一下子停住。
// 她每吃、碰、明杠、加杠一次，从那一刻起到她下一次摸牌之前（一巡），别人摸牌必定不进张：
// 让向听前进的牌（听牌的人就是和了牌）一张也摸不到。暗杠不改摸牌顺序，不算鸣牌。
// 只是控场的规矩（DrawRule）：照这样别人动不了的人、天使和挡掉一半、佛灭、高维领域照常起作用。
// 电脑的纯：平时照常鸣牌；别人立直了、牌山还多时，有役不退向听就鸣，用鸣牌错开流向
export const JUN = {
  // 电脑：牌山剩这么多以上才为了错开流向而鸣
  aiMinWall: 8,
};

interface JunState {
  // 鸣过牌、她还没再摸牌（这一巡）
  on?: boolean;
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as JunState;

// 现在别人摸牌是不是不进张：她鸣过牌，还没再摸牌
export function junJamming(g: Game, seat: number): boolean {
  return !!stateOf(g, seat).on;
}

// 这家摸到哪些牌种会进张（向听前进；听牌时是和了牌）
export function usefulKinds(g: Game, seat: number): Set<Kind> {
  const p = g.players[seat];
  const out = new Set<Kind>();
  if ((p.hand.length + 3 * p.melds.length) % 3 !== 1) return out;
  const counts = toCounts(p.hand);
  const cur = shanten(counts, p.melds.length);
  for (let k = 0; k < KIND_COUNT; k++) {
    if (counts[k] >= 4) continue;
    counts[k]++;
    if (shanten(counts, p.melds.length) < cur) out.add(k);
    counts[k]--;
  }
  return out;
}

export const junAbility: Ability = {
  id: 'jun',
  name: '流向',
  description: '她每吃、碰、明杠一次，从那一刻起到她下一次摸牌（一巡）之前，别人摸牌必定不进张：让向听前进的牌、和了牌都摸不到。',

  onRoundStart(g, seat) {
    stateOf(g, seat).on = false;
  },

  // 自己鸣牌（暗杠不算）：从这里起到她下一次摸牌之前，别人不进张
  onCall(g, seat, caller, call) {
    if (caller !== seat || call === '暗杠') return;
    const st = stateOf(g, seat);
    const fresh = !st.on;
    st.on = true;
    if (fresh) g.emit({ type: 'ability', seat, ability: 'jun', text: '错开流向' });
  },

  beforeAnyDraw(g, seat, drawer) {
    // 她自己摸牌不管（这一巡在 afterDraw 里结束）
    if (!junJamming(g, seat) || drawer === seat) return;
    const useful = usefulKinds(g, drawer);
    if (!useful.size) return;
    return { seat, ability: 'jun', text: '不进张', deny: (t) => useful.has(kindOf(t)) };
  },

  // 她自己摸牌（明杠、加杠后的岭上牌不算）：这一巡结束
  afterDraw(g, seat) {
    if (!g.rinshanDraw) stateOf(g, seat).on = false;
  },

  skill(g, seat) {
    const on = junJamming(g, seat);
    return { label: '', note: on ? '错开流向：到她下一次摸牌之前，别人不进张' : '吃、碰、杠以后一巡内，别人不进张', enabled: false, active: on };
  },

  badge(g, seat) {
    return junJamming(g, seat) ? '流向' : null;
  },

  insight(g, seat) {
    return [junJamming(g, seat) ? '刚鸣过牌：到她下一次摸牌之前，别人摸牌不进张' : '鸣牌以后一巡内，别人摸牌不进张'];
  },
};
