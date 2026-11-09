import type { Game } from '../engine/game';
import type { TileId } from '../engine/tiles';
import { MOON_PHASES, koromoMoon, koromoRouteOn, koromoRouteSet } from '../abilities/koromo';

// 天江衣的海底：牌桌上的海水涨到哪。海底路线上（谁都知道，发动时放了切入）越接近海底海水越高，
// 配完牌时（牌山 70 张）是薄薄一层，剩 SEA_FULL 张（她立直那一巡）时没过整个牌山。
// 海底被别人鸣牌错开时潮水退下去一大半，等海底回到她这边再涨回来

export const SEA_FROM = 70;
export const SEA_FULL = 4;
// 海底不归她时潮水留多少
export const SEA_EBB = 0.4;

// 牌山剩 remaining 张时海水涨到几成（0..1）：一开始涨得慢，越到后面越快
export function seaRise(remaining: number): number {
  const x = Math.min(1, Math.max(0, (SEA_FROM - remaining) / (SEA_FROM - SEA_FULL)));
  return x ** 1.6;
}

export interface SeaView {
  seat: number;
  level: number;
  on: boolean;
  moon: number;
  haitei: TileId | null;
}

// ids：每个座位的角色 id。被封印、雾遮住海底、不在海底路线上时没有海
export function koromoSea(g: Game, ids: (string | undefined)[]): SeaView | null {
  for (let s = 0; s < 4; s++) {
    if (ids[s] !== 'koromo' || g.active(s)?.id !== 'koromo' || !koromoRouteSet(g, s)) continue;
    const on = koromoRouteOn(g, s);
    const moon = koromoMoon(g, s);
    const live = g.wall.live;
    return {
      seat: s,
      level: seaRise(g.wall.remaining) * (on ? 1 : SEA_EBB),
      on,
      moon: moon ? MOON_PHASES.indexOf(moon) : 4,
      haitei: on && live.length ? live[live.length - 1] : null,
    };
  }
  return null;
}
