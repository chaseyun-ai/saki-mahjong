import type { Game } from '../engine/game';
import { waitingKinds } from '../engine/shanten';
import { TileId, kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 鹿仓胡桃（宫守）：默听。被动。
// 听牌以后只要没立直（门清默听、副露听牌都算），每次摸牌有一点概率把和了牌换上来：自摸率些许上升。
// 和了要成立（副露没役的听牌不算）；立直以后就没有了。
// 电脑的胡桃从不立直（被封印的局照常立直）
export const KURUMI = {
  boost: 0.1, // 听牌没立直时，每次摸牌把和了牌换上来的概率
};

// 现在听牌、没立直：能力起作用的状态
export function kurumiReady(g: Game, seat: number): boolean {
  const p = g.players[seat];
  if (p.riichi) return false;
  // 摸牌后（14 张）看不出听没听，只看 13 张时
  if (p.hand.length % 3 !== 1) return false;
  return waitingKinds(toCounts(p.hand), p.melds.length).length > 0;
}

export const kurumiAbility: Ability = {
  id: 'kurumi',
  name: '默听',
  description: `被动。听牌以后只要没立直（默听、副露听牌都算），每次摸牌有 ${Math.round(KURUMI.boost * 100)}% 的概率摸到和了牌（和了要成立）。立直以后不起作用。`,

  beforeDraw(g, seat, rinshan) {
    const p = g.players[seat];
    if (!kurumiReady(g, seat) || !g.canWin(seat)) return;
    const waits = waitingKinds(toCounts(p.hand), p.melds.length);
    // 有役的和了牌：先放进手里试一下
    const wins = (t: TileId) => {
      if (!waits.includes(kindOf(t))) return false;
      p.hand.push(t);
      const ok = !!g.winResult(seat, t, true);
      p.hand.pop();
      return ok;
    };
    const w = g.wall;
    const next = rinshan ? w.rinshan[0] : w.live[0];
    // 本来就摸得到，或者这次没轮到
    if (next === undefined || wins(next) || !g.rng.chance(KURUMI.boost)) return;
    const ok = rinshan ? w.bringToRinshan(wins, g.rng) : w.bringToLive(0, wins, g.rng);
    if (ok) g.emit({ type: 'ability', seat, ability: 'kurumi', text: '默听' });
  },

  skill(g, seat) {
    const ready = kurumiReady(g, seat);
    const note = g.players[seat].riichi ? '立直了：默听不起作用' : ready ? '默听中：自摸率上升' : '听牌以后不立直，自摸率上升';
    return { label: '', note, enabled: false, active: ready };
  },

  insight(g, seat) {
    return [g.players[seat].riichi ? '立直了，默听不起作用' : kurumiReady(g, seat) ? '默听中：自摸率上升' : '还没听牌'];
  },
};
