import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/game';
import { parseTiles } from '../src/engine/tiles';

describe('立直宣言牌', () => {
  it('听牌时没立直，下一巡摸到和手里同一种的牌，也能把刚摸到的这张打出去立直', () => {
    const g = new Game({ seed: 1, players: [0, 1, 2, 3].map((i) => ({ name: `p${i}` })) });
    const p = g.players[g.turn];
    const ids = parseTiles('123m456p789s1122z1z');
    p.hand = ids;
    p.drawn = ids.at(-1)!;
    const riichi = g.legalActions(g.turn).filter((a) => a.type === 'discard' && a.riichi).map((a) => (a as { tile: number }).tile);
    // 三张东每一张都能当宣言牌，包括摸到的那张
    expect(riichi).toContain(p.drawn);
    expect(riichi.filter((t) => t >> 2 === 27)).toHaveLength(3);
    g.act(g.turn, { type: 'discard', tile: p.drawn, riichi: true });
    expect(p.riichi).toBe(true);
  });
});
