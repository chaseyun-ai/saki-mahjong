import type { Game } from '../engine/game';
import { waitingKinds } from '../engine/shanten';
import { kindLabel, kindOf, toCounts } from '../engine/tiles';
import { avoidOwnUra } from './doraControl';
import type { Ability } from './types';

// 宫永咲：容易摸到能杠的牌，开杠后岭上牌经常就是她的和了牌。
// 她的杠一般不给自己加宝牌：她开杠翻出的杠宝牌、她和牌时的里宝牌不指向她自己的牌（doraControl），岭上摸到赤宝牌照常可以。
// 会被稳乃的深山削弱，满 6 个标记的稳乃在场时失效。
export const KAN_TILE_CHANCE = 0.45;
export const PAIR_TILE_CHANCE = 0.12;
export const RINSHAN_WIN_CHANCE = 0.75;

function handKinds(g: Game, seat: number, n: number): number[] {
  const counts = toCounts(g.players[seat].hand);
  const kinds: number[] = [];
  for (let k = 0; k < 34; k++) if (counts[k] === n) kinds.push(k);
  return kinds;
}

function kanCandidates(g: Game, seat: number): number[] {
  const kinds = handKinds(g, seat, 3);
  for (const m of g.players[seat].melds) if (m.type === 'pon') kinds.push(kindOf(m.tiles[0]));
  return kinds;
}

export const sakiAbility: Ability = {
  id: 'saki',
  name: '岭上开花',
  description: `摸牌时有 ${KAN_TILE_CHANCE * 100}% 的概率摸到能开杠的第四张牌，对子也更容易长成刻子；开杠时如果已经听牌，岭上牌有 ${RINSHAN_WIN_CHANCE * 100}% 的概率是和了牌。她的杠一般不给自己加宝牌、里宝牌（岭上的赤宝牌照拿）。`,

  beforeDraw(g: Game, seat: number, rinshan: boolean) {
    const p = g.players[seat];
    if (rinshan) {
      const waits = waitingKinds(toCounts(p.hand), p.melds.length);
      if (waits.length === 0 || !g.rng.chance(RINSHAN_WIN_CHANCE)) return;
      if (g.wall.bringToRinshan((t) => waits.includes(kindOf(t)), g.rng)) {
        g.emit({ type: 'ability', seat, ability: 'saki', text: '岭上开花' });
      }
      return;
    }
    if (g.totalKans() >= 4 || g.wall.remaining <= 1) return;
    const kinds = kanCandidates(g, seat);
    if (kinds.length > 0 && g.rng.chance(KAN_TILE_CHANCE)) {
      if (g.wall.bringToLive(0, (t) => kinds.includes(kindOf(t)), g.rng)) {
        g.emit({ type: 'ability', seat, ability: 'saki', text: '杠的气息' });
        return;
      }
    }
    // 对子容易长成刻子，为开杠做准备
    if (p.riichi) return;
    const pairs = handKinds(g, seat, 2);
    if (pairs.length > 0 && g.rng.chance(PAIR_TILE_CHANCE)) {
      g.wall.bringToLive(0, (t) => pairs.includes(kindOf(t)), g.rng);
    }
  },

  // 和牌时里宝牌不指向她自己的牌
  claimUra(g, seat, winTile) {
    avoidOwnUra(g, seat, winTile);
  },

  insight(g, seat) {
    const kinds = kanCandidates(g, seat);
    return [kinds.length ? `在等杠：${kinds.map(kindLabel).join('、')}` : '手里还没有能杠的刻子', `听牌后开杠，岭上牌 ${RINSHAN_WIN_CHANCE * 100}% 是和了牌`];
  },
};
