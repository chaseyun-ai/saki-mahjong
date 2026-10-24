import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { dealIndex, drawSlot, stackAt, wallSlots } from '../src/ui3d/wallLayout';

const key = (s: { wall: number; stack: number; level: number }) => `${s.wall}-${s.stack}-${s.level}`;

describe('牌山摆放', () => {
  it('68 墩正好铺满四家的牌山，不重叠', () => {
    for (let dealer = 0; dealer < 4; dealer++) {
      for (let sum = 2; sum <= 12; sum++) {
        const seen = new Set<string>();
        for (let p = 0; p < 68; p++) {
          const s = stackAt(dealer, sum, p);
          expect(s.stack).toBeGreaterThanOrEqual(1);
          expect(s.stack).toBeLessThanOrEqual(17);
          seen.add(`${s.wall}-${s.stack}`);
        }
        expect(seen.size).toBe(68);
      }
    }
  });

  it('按骰子点数从庄家起逆时针数，决定开谁的牌山', () => {
    // 5 点：庄家数 1，下家 2，对家 3，上家 4，庄家 5
    expect(stackAt(0, 5, 0)).toEqual({ wall: 0, stack: 6 });
    // 7 点开对家，从对家右端数 7 墩处分开
    expect(stackAt(0, 7, 0)).toEqual({ wall: 2, stack: 8 });
    // 摸牌往左手方向走，走完这家接着上家的牌山
    expect(stackAt(0, 7, 10)).toEqual({ wall: 1, stack: 1 });
  });

  it('配牌的 52 张各不相同', () => {
    const ds = new Set<number>();
    for (let k = 0; k < 4; k++) for (let i = 0; i < 13; i++) ds.add(dealIndex(k, i).d);
    expect(ds.size).toBe(52);
    expect(Math.max(...ds)).toBe(51);
  });

  it('打牌过程中牌山里的牌位置永远不重叠，也不和配牌位置冲突', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const g = new Game({ seed, players: CHARACTERS.map((c) => ({ name: c.name, ability: c.ability })) });
      let steps = 0;
      while (g.phase !== 'gameEnd' && steps++ < 4000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        const slots = wallSlots(g);
        const keys = [...slots.values()].map(key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(slots.size).toBe(g.wall.allTiles().length);
        // 还在牌山里的牌不会占用已经摸走的位置
        const sum = g.dice[0] + g.dice[1];
        const dealt = new Set<string>();
        for (let d = 0; d < 52; d++) dealt.add(key(drawSlot(g.dealer, sum, d)));
        for (const k of keys) expect(dealt.has(k)).toBe(false);
        const seat = g.waitingSeats()[0];
        g.act(seat, chooseAction(g, seat, CHARACTERS[seat].ai));
      }
    }
  }, 60000);
});
