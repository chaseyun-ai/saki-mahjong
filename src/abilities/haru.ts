import type { Game } from '../engine/game';
import { shanten, waitingKinds } from '../engine/shanten';
import { TileId, kindOf, toCounts } from '../engine/tiles';
import { isDoraTile } from './kuro';
import type { Ability } from './types';

// 泷见春（永水）：黑糖。被动。别人立直以后，她只想快点把这一局结束掉：
// 手牌最终和出来不到 2 番（算宝牌）的话，进展速度加快：
// - 没听牌时，摸牌有一定概率换成让向听前进的牌（手里宝牌已经有 2 张以上就不管：和出来一定不止 1 番）
// - 听牌以后，摸牌有一定概率换成和了牌，但只换和出来不到 2 番的那种
// 原作里她一直在吃黑糖，打得快、和得小。电脑的春有人立直时不立直、能鸣就鸣
export const HARU = {
  speed: 0.4, // 有人立直、没听牌时，摸牌换成有用的牌的概率
  win: 0.3, // 有人立直、听牌以后，摸牌换成小和了牌的概率
  maxHan: 1, // 和出来最多几番才算“小”（小于 2 番）
  doraCap: 2, // 手里（含副露）宝牌这么多张就不加速
};

// 别人（她看得见的）立直了
export const haruRush = (g: Game, seat: number) => g.players.some((p) => p.seat !== seat && p.riichi && g.seesRiichi(p.seat, seat));

// 手里（含副露）有几张宝牌（赤宝牌算）
function doraIn(g: Game, seat: number): number {
  const p = g.players[seat];
  return [...p.hand, ...p.melds.flatMap((m) => m.tiles)].filter((t) => isDoraTile(g, t)).length;
}

export const haruAbility: Ability = {
  id: 'haru',
  name: '黑糖',
  description: `被动。别人立直以后，如果手牌最终和出来不到 2 番，进展速度加快：没听牌时摸牌有 ${Math.round(HARU.speed * 100)}% 的概率换成让向听前进的牌，听牌以后有 ${Math.round(HARU.win * 100)}% 的概率摸到和了牌（只算和出来不到 2 番的）。`,

  beforeDraw(g, seat, rinshan) {
    if (!haruRush(g, seat)) return;
    const p = g.players[seat];
    if (p.riichi || p.hand.length % 3 !== 1) return;
    const counts = toCounts(p.hand);
    const sh = shanten(counts, p.melds.length);
    const w = g.wall;
    if (sh === 0) {
      if (!g.canWin(seat) || !g.rng.chance(HARU.win)) return;
      const waits = waitingKinds(counts, p.melds.length);
      // 和出来要成立、而且不到 2 番
      const small = (t: TileId) => {
        if (!waits.includes(kindOf(t))) return false;
        p.hand.push(t);
        const r = g.winResult(seat, t, true);
        p.hand.pop();
        return !!r && r.yakuman === 0 && r.han <= HARU.maxHan;
      };
      const next = rinshan ? w.rinshan[0] : w.live[0];
      if (next === undefined || small(next)) return;
      const ok = rinshan ? w.bringToRinshan(small, g.rng) : w.bringToLive(0, small, g.rng);
      if (ok) g.emit({ type: 'ability', seat, ability: 'haru', text: '快和' });
      return;
    }
    if (rinshan || doraIn(g, seat) >= HARU.doraCap || !g.rng.chance(HARU.speed)) return;
    const better = new Set<number>();
    for (let k = 0; k < counts.length; k++) {
      if (counts[k] >= 4) continue;
      counts[k]++;
      if (shanten(counts, p.melds.length) < sh) better.add(k);
      counts[k]--;
    }
    if (better.size) w.bringToLive(0, (t) => better.has(kindOf(t)), g.rng);
  },

  skill(g, seat) {
    const on = haruRush(g, seat);
    return { label: '', note: on ? '有人立直：不到 2 番的手进展加快' : '别人立直以后，小牌进展加快', enabled: false, active: on };
  },

  insight(g, seat) {
    return [haruRush(g, seat) ? '有人立直了：和出来不到 2 番的话进张变快' : '没人立直，和平常一样'];
  },
};
