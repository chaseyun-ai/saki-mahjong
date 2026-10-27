import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { Kind, TileId, isDragon, isHonor, kindOf, toCounts } from '../engine/tiles';
import { isDoraTile } from './kuro';
import type { Ability } from './types';

// 江口夕（千里山）：火力型，越大越好。
// - 配牌：有 dealChance 的概率，把最多 dealSwaps 张孤张换成宝牌，或者手里已有的役牌
// - 摸牌：有 draw 的概率换成用得上的宝牌（进张、连得上或凑得成对）、或者凑对凑刻的役牌
// 电脑的夕：从不默听、从不弃和；牌不到满贯先不和（牌山剩 holdLate 张以内才有什么和什么）；不吃，只碰役牌
export const SERA = {
  dealChance: 0.7,
  dealSwaps: 2,
  draw: 0.3,
  holdLate: 10,
  mangan: 8000,
};

// 这家的役牌：三元牌、自风、场风
export const seraYakuhai = (g: Game, seat: number, k: Kind): boolean => isDragon(k) || k === g.seatWind(seat) || k === 27 + g.roundWind;

// 能力这一局起作用
export const seraActive = (g: Game, seat: number): boolean => g.active(seat)?.id === 'sera';

export const seraAbility: Ability = {
  id: 'sera',
  name: '火力',
  description: `配牌和摸牌容易来宝牌、役牌（配牌最多换 ${SERA.dealSwaps} 张，摸牌 ${SERA.draw * 100}%）。电脑的夕从不默听、从不弃和，不到满贯先不和。`,

  // 配牌：孤张换成宝牌，或者凑成役牌对子
  beforeDeal(g, seat) {
    if (!g.rng.chance(SERA.dealChance)) return;
    const w = g.wall;
    const mine = g.dealIndices(seat);
    let swaps = 0;
    for (const i of g.rng.shuffle([...mine])) {
      if (swaps >= SERA.dealSwaps) break;
      const tiles = mine.map((j) => w.live[j]);
      const counts = toCounts(tiles);
      const t = w.live[i];
      const k = kindOf(t);
      if (isDoraTile(g, t) || seraYakuhai(g, seat, k) || counts[k] > 1) continue;
      // 只换孤张：数牌前后两格内没有同花色的牌
      if (!isHonor(k) && [-2, -1, 1, 2].some((d) => k % 9 + d >= 0 && k % 9 + d <= 8 && counts[k + d] > 0)) continue;
      const pairUp = (x: TileId) => seraYakuhai(g, seat, kindOf(x)) && counts[kindOf(x)] === 1;
      if (w.bringToLive(i, (x) => pairUp(x) || isDoraTile(g, x), g.rng, (j) => j >= 52)) swaps++;
    }
  },

  // 摸牌：宝牌（用得上的）或者凑对、凑刻的役牌
  beforeDraw(g, seat, rinshan) {
    if (rinshan || !g.rng.chance(SERA.draw)) return;
    const p = g.players[seat];
    const counts = toCounts(p.hand);
    const sh = shanten(counts, p.melds.length);
    const want = (t: TileId) => {
      const k = kindOf(t);
      if (seraYakuhai(g, seat, k) && counts[k] >= 1 && counts[k] <= 2) return true;
      if (!isDoraTile(g, t)) return false;
      // 宝牌要用得上：进张，或者和手里的牌连得上、凑得成对
      if (counts[k] >= 1 || (!isHonor(k) && [-1, 1].some((d) => k % 9 + d >= 0 && k % 9 + d <= 8 && counts[k + d] > 0))) return true;
      counts[k]++;
      const ok = shanten(counts, p.melds.length) < sh;
      counts[k]--;
      return ok;
    };
    if (!want(g.wall.live[0])) g.wall.bringToLive(0, want, g.rng);
  },

  insight() {
    return ['配牌、摸牌容易来宝牌和役牌；从不默听、不弃和，不到满贯先不和'];
  },
};
