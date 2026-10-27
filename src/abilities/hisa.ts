import type { Game } from '../engine/game';
import { shanten, waitingKinds } from '../engine/shanten';
import { Kind, TileId, kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 竹井久（清澄）：恶待。明明能听好型，她偏要听单骑、坎张、边张这种只等一种牌的烂听牌，结果反而和得出来。
// - 听烂听牌时（只听一种牌、没振听），她自己每次摸牌有 HISA.self 的概率摸到和了牌（和了要有役）
// - 别人摸牌时，有 HISA.lure 的概率摸到她的和了牌，而且一定是那个人用不上的（不会让他向听前进），
//   用不上的牌多半会被顺手打出来
// - 听两种以上的好型时能力不起作用
// 电脑的久：能听烂听牌就听烂的（剩的和了牌还有就行），然后立直
export const HISA = {
  self: 0.3, // 自己摸到和了牌的概率
  lure: 0.35, // 别人摸到她的和了牌的概率
};

// 她现在听的烂听牌（只听一种牌，没振听），没有就是 null。手里 14 张时按摸牌前的 13 张算
export function hisaBadWait(g: Game, seat: number): Kind | null {
  const p = g.players[seat];
  let hand = p.hand;
  if ((hand.length + 3 * p.melds.length) % 3 === 2) {
    if (p.drawn === null) return null;
    hand = hand.filter((t) => t !== p.drawn);
  }
  const waits = waitingKinds(toCounts(hand), p.melds.length);
  if (waits.length !== 1) return null;
  if (p.furitenRiichi || p.discards.some((d) => kindOf(d.tile) === waits[0])) return null;
  return waits[0];
}

// 摸到这张对 drawer 有没有用（能让向听前进）
function usefulTo(g: Game, drawer: number): (t: TileId) => boolean {
  const p = g.players[drawer];
  const counts = toCounts(p.hand);
  const sh = shanten(counts, p.melds.length);
  return (t) => {
    counts[kindOf(t)]++;
    const after = shanten(counts, p.melds.length);
    counts[kindOf(t)]--;
    return after < sh;
  };
}

export const hisaAbility: Ability = {
  id: 'hisa',
  name: '恶待',
  description: `明明能听好型，偏要听单骑、坎张、边张这种只等一种牌的烂听牌。听烂听牌时，她每次摸牌有 ${HISA.self * 100}% 摸到和了牌；别人每次摸牌有 ${HISA.lure * 100}% 摸到她的和了牌，而且是他们用不上、多半会打出来的。听好型时能力不起作用。`,

  // 别人摸牌：把她的和了牌送到一个用不上它的人手里
  beforeAnyDraw(g, seat, drawer, rinshan) {
    if (drawer === seat || rinshan || !g.binds(seat, drawer) || !g.canWin(seat)) return;
    const k = hisaBadWait(g, seat);
    if (k === null || !g.rng.chance(HISA.lure)) return;
    const w = g.wall;
    if (kindOf(w.live[0]) === k) return;
    if (usefulTo(g, drawer)(k * 4)) return;
    if (w.bringToLive(0, (t) => kindOf(t) === k, g.rng)) g.emit({ type: 'ability', seat, ability: 'hisa', text: '恶待', target: drawer });
  },

  beforeDraw(g, seat, rinshan) {
    if (!g.canWin(seat)) return;
    const k = hisaBadWait(g, seat);
    if (k === null || !g.rng.chance(HISA.self)) return;
    const p = g.players[seat];
    const wins = (t: TileId) => {
      if (kindOf(t) !== k) return false;
      p.hand.push(t);
      const ok = !!g.winResult(seat, t, true);
      p.hand.pop();
      return ok;
    };
    const w = g.wall;
    const ok = rinshan ? wins(w.rinshan[0]) || w.bringToRinshan(wins, g.rng) : wins(w.live[0]) || w.bringToLive(0, wins, g.rng);
    if (ok) g.emit({ type: 'ability', seat, ability: 'hisa', text: '恶待' });
  },

  skill(g, seat) {
    const k = hisaBadWait(g, seat);
    return { label: '', note: k !== null ? '听着烂听牌：恶待生效' : '听单骑、坎张、边张（只等一种牌）时恶待生效', enabled: false, active: k !== null };
  },

  badge(g, seat) {
    return hisaBadWait(g, seat) !== null ? '恶待' : null;
  },

  insight(g, seat) {
    return [hisaBadWait(g, seat) !== null ? '正听着烂听牌：她和别人都容易摸到她的和了牌' : '没在听烂听牌，恶待不起作用'];
  },
};
