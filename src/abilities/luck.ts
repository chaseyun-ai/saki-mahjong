import type { Game } from '../engine/game';
import { shanten, standardShanten } from '../engine/shanten';
import { TileId, kindOf, toCounts } from '../engine/tiles';

// “配牌、进张比没有能力的人顺 p”的通用做法（和龙门渊透华常态的 5% 一样）：
// - 配牌：最多 tries 次，每次按 p 的概率把一张不影响向听的牌换成让向听前进的牌（从发完牌以后的牌山里拿）
//   只看一般形的向听：七对子的向听也算的话，凑对子的牌也算“降向听”，配牌会偏成七对子
// - 进张：每次摸牌按 p 的概率把下一张换成有效进张（听牌时就是和了牌）
// 只交换没公开的牌，别人的规矩由 Wall.guard / 摸牌规矩把关

export function luckyDeal(g: Game, seat: number, p: number, tries = 4): void {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  for (let n = 0; n < tries; n++) {
    if (!g.rng.chance(p)) continue;
    const counts = toCounts(mine.map((j) => w.live[j]));
    const cur = standardShanten(counts, 0);
    if (cur <= 0) break;
    const spare = g.rng.shuffle([...mine]).filter((i) => {
      const k = kindOf(w.live[i]);
      counts[k]--;
      const ok = standardShanten(counts, 0) === cur;
      counts[k]++;
      return ok;
    });
    for (const i of spare) {
      const k = kindOf(w.live[i]);
      counts[k]--;
      const better = (t: TileId) => {
        counts[kindOf(t)]++;
        const sh = standardShanten(counts, 0);
        counts[kindOf(t)]--;
        return sh < cur;
      };
      const done = w.bringToLive(i, better, g.rng, (j) => j >= 52);
      counts[k]++;
      if (done) break;
    }
  }
}

// 下一张换成有效进张。返回换没换（本来就是有效进张也算没换）
export function luckyDraw(g: Game, seat: number, rinshan: boolean, p: number): boolean {
  const pl = g.players[seat];
  const counts = toCounts(pl.hand);
  const sh = shanten(counts, pl.melds.length);
  const useful = (t: TileId) => {
    counts[kindOf(t)]++;
    const after = shanten(counts, pl.melds.length);
    counts[kindOf(t)]--;
    return after < sh;
  };
  const next = rinshan ? g.wall.rinshan[0] : g.wall.live[0];
  if (next === undefined || useful(next) || !g.rng.chance(p)) return false;
  return rinshan ? g.wall.bringToRinshan(useful, g.rng) : g.wall.bringToLive(0, useful, g.rng);
}
