import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, isRed, kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 松实宥（阿知贺）：怕冷的姐姐，身边聚集「暖色」的牌（牌面上红色为主的牌）。
// 暖色牌：万子、中、赤五，还有五索、七索、九索、一筒、三筒、五筒、七筒、九筒。
// - 她的配牌偏向暖色牌，摸牌常换成暖色牌里有用的
// - 别人配牌里的暖色牌少一些（不像霞的绝一门那么绝对）
// - 和玄同桌时赤五归玄（玄的宝牌是作者钦定最高），宥不拿赤五
// 电脑的宥：同样向听时留暖色牌，做万子染手、留中，稳着打。不控别人的摸牌
export const YU = {
  deal: 0.35, // 她配牌里不是暖色的牌换成暖色牌的概率
  draw: 0.12, // 摸牌换成暖色牌里有用的牌的概率
  others: 0.3, // 别人配牌里的暖色牌换走的概率
};

const WARM_KINDS = new Set<number>([
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8], // 万子
  33, // 中
  22, 24, 26, // 五索、七索、九索
  9, 11, 13, 15, 17, // 一三五七九筒
]);

// 和玄同桌时赤五不算她的
const kuroAtTable = (g: Game, seat: number) => [0, 1, 2, 3].some((s) => s !== seat && g.abilities[s]?.id === 'kuro');

// 这张牌对她来说是不是暖色牌
export function yuWarm(g: Game, seat: number): (t: TileId) => boolean {
  const kuro = kuroAtTable(g, seat);
  return (t) => (isRed(t) ? !kuro : WARM_KINDS.has(kindOf(t)));
}

// 按牌种算（AI 留牌用）：这种牌是不是暖色的（赤五按普通五算）
export const warmKind = (k: number) => WARM_KINDS.has(k);

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

export const yuAbility: Ability = {
  id: 'yu',
  name: '暖色牌',
  description: '身边聚集暖色的牌（万子、中、赤五、五七九索、一三五七九筒）：她的配牌偏向暖色牌，摸牌常换成暖色牌里有用的；别人配牌里的暖色牌少一些。和玄同桌时赤五归玄。',

  // 别人配牌里的暖色牌有时换走；她自己不是暖色的牌有时换成暖色牌（换不了就算了，不压别人的规矩）
  beforeDeal(g, seat) {
    const w = g.wall;
    const warm = yuWarm(g, seat);
    const later = (j: number) => j >= 52;
    for (let s = 0; s < 4; s++) {
      if (s === seat || !g.binds(seat, s)) continue;
      for (const i of g.dealIndices(s)) if (warm(w.live[i]) && g.rng.chance(YU.others)) w.bringToLive(i, (t) => !warm(t), g.rng, later);
    }
    for (const i of g.dealIndices(seat)) if (!warm(w.live[i]) && g.rng.chance(YU.deal)) w.bringToLive(i, warm, g.rng, later);
  },

  onRoundStart(g, seat) {
    if (g.roundWind === 0 && g.roundNumber === 0 && g.honba === 0) g.emit({ type: 'ability', seat, ability: 'yu', text: '暖色牌' });
  },

  beforeDraw(g, seat, rinshan) {
    if (rinshan || !g.rng.chance(YU.draw)) return;
    const warm = yuWarm(g, seat);
    const good = useful(g, seat);
    g.wall.bringToLive(0, (t) => warm(t) && good(t), g.rng) || g.wall.bringToLive(0, warm, g.rng);
  },

  skill(g, seat) {
    return { label: '', note: kuroAtTable(g, seat) ? '暖色牌聚过来（赤五归玄）' : '暖色牌聚过来', enabled: false, active: true };
  },

  insight(g, seat) {
    return [`暖色牌聚过来：万子、中、${kuroAtTable(g, seat) ? '' : '赤五、'}五七九索、一三五七九筒`];
  },
};
