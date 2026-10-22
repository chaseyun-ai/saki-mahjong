import type { Game } from '../engine/game';
import { waitingKinds } from '../engine/shanten';
import { kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 宫永咲：容易摸到能杠的牌，开杠后岭上牌经常就是她的和了牌。
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
  description: `摸牌时有 ${KAN_TILE_CHANCE * 100}% 的概率摸到能开杠的第四张牌，对子也更容易长成刻子；开杠时如果已经听牌，岭上牌有 ${RINSHAN_WIN_CHANCE * 100}% 的概率是和了牌。`,

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
};
