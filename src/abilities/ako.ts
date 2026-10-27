import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, isDragon, kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 新子憧（阿知贺）：速攻。很早就吃碰，看起来不好的鸣牌也能让她很快听牌；看得准别人离和牌还有多远。
// - 速攻：她每鸣一次，之后摸牌换成进张的概率加 AKO.perCall（叠加，鸣得越多越快）
// - 配牌里容易有役牌对子（有单张三元牌时补成对子），方便开局就鸣
// - 距离感：鸣过牌以后看得出每家离听牌还差几步（玩家操作时头像旁边 1–3 个点，0 是听牌了），不显示听什么
// 电脑的憧：能鸣就鸣，小牌快攻；用距离感决定拼还是收
export const AKO = {
  perCall: 0.25,
  maxGood: 0.7,
  pairChance: 0.6, // 配牌有单张三元牌时补成对子的概率
};

const calls = (g: Game, seat: number) => g.players[seat].melds.filter((m) => m.type !== 'ankan').length;

// 距离感开着没有（鸣过牌）
export function akoSense(g: Game, seat: number): boolean {
  return calls(g, seat) > 0 && !g.isSealed(seat);
}

// 距离感看到的：这家离听牌还差几步（0 是听牌了）
export function akoDistance(g: Game, target: number): number {
  const p = g.players[target];
  let hand = p.hand;
  if ((hand.length + 3 * p.melds.length) % 3 === 2 && p.drawn !== null) hand = hand.filter((t) => t !== p.drawn);
  return Math.max(0, shanten(toCounts(hand), p.melds.length));
}

const useful = (g: Game, seat: number) => {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const sh = shanten(counts, p.melds.length);
  return (t: TileId) => {
    counts[kindOf(t)]++;
    const after = shanten(counts, p.melds.length);
    counts[kindOf(t)]--;
    return after < sh;
  };
};

export const akoAbility: Ability = {
  id: 'ako',
  name: '速攻·距离感',
  description: `速攻：每鸣一次，之后摸牌更容易是进张（每次加 ${AKO.perCall * 100}%，叠加）。配牌容易有役牌对子。距离感：鸣过牌以后看得出每家离听牌还差几步，不显示听什么。`,

  // 配牌里有单张三元牌，补成对子
  beforeDeal(g, seat) {
    if (!g.rng.chance(AKO.pairChance)) return;
    const w = g.wall;
    const mine = g.dealIndices(seat);
    const kinds = mine.map((i) => kindOf(w.live[i]));
    const single = kinds.find((k) => isDragon(k) && kinds.filter((x) => x === k).length === 1);
    if (single === undefined) return;
    // 换掉一张孤立的字牌或幺九牌以外的牌：挑和别的牌最不搭的那张
    const counts = toCounts(mine.map((i) => w.live[i]));
    const sh = shanten(counts, 0);
    for (const i of g.rng.shuffle([...mine])) {
      const k = kindOf(w.live[i]);
      if (k === single) continue;
      counts[k]--;
      counts[single]++;
      const ok = shanten(counts, 0) <= sh;
      counts[k]++;
      counts[single]--;
      if (ok && w.bringToLive(i, (t) => kindOf(t) === single, g.rng, (j) => j >= 52)) return;
    }
  },

  beforeDraw(g, seat, rinshan) {
    const n = calls(g, seat);
    if (rinshan || !n || !g.rng.chance(Math.min(AKO.maxGood, AKO.perCall * n))) return;
    const good = useful(g, seat);
    if (!good(g.wall.live[0])) g.wall.bringToLive(0, good, g.rng);
  },

  skill(g, seat) {
    const n = calls(g, seat);
    return { label: '', note: n ? `鸣了 ${n} 次：摸牌进张 +${Math.round(Math.min(AKO.maxGood, AKO.perCall * n) * 100)}%，看得出每家离听牌几步` : '还没鸣牌', enabled: false, active: n > 0 };
  },

  badge(g, seat) {
    const n = calls(g, seat);
    return n ? `速攻${n}` : null;
  },

  insight(g, seat) {
    const n = calls(g, seat);
    return [n ? `鸣了 ${n} 次，摸牌更容易是进张` : '还没鸣牌', akoSense(g, seat) ? '距离感：看得出每家离听牌几步' : '鸣牌以后才有距离感'];
  },
};
