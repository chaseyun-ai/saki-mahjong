import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { RII, riiBind, riiKeys } from '../src/abilities/rii';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { keyTag } from '../src/ui/keyArt';
import { GOLD, chainOutcomes, chainPlan, goldTime, linkOffsets, lockTime, outcomeTime } from '../src/ui/riiChainPlan';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

describe('白水哩番缚的锁链特效', () => {
  it('缚几番就有几条锁链，最多七条，位置各不相同', () => {
    for (let n = 1; n <= RII.maxBind; n++) expect(chainPlan(n)).toHaveLength(n);
    expect(chainPlan(9)).toHaveLength(7);
    const all = chainPlan(7);
    expect(new Set(all.map((l) => l.x.toFixed(2))).size).toBe(7);
    // 从四面八方：有往上斜的也有往下斜的，两头都有射过来的
    expect(all.some((l) => l.angle > 0) && all.some((l) => l.angle < 0)).toBe(true);
    expect(all.some((l) => l.from === 1) && all.some((l) => l.from === -1)).toBe(true);
  });

  it('锁链的节从一头排到另一头', () => {
    const o = linkOffsets(10, 0.5);
    expect(o[0]).toBe(-10);
    expect(o[o.length - 1]).toBeCloseTo(10);
    expect(o.length).toBeGreaterThan(30);
  });

  it('锁得越多锁上越久；钥匙那一段最长', () => {
    expect(lockTime(7)).toBeGreaterThan(lockTime(1));
    expect(outcomeTime('key')).toBe(goldTime());
    expect(goldTime()).toBeGreaterThan(GOLD.hold);
    expect(outcomeTime('key')).toBeGreaterThan(outcomeTime('broken'));
    expect(outcomeTime('broken')).toBeGreaterThan(outcomeTime('fade'));
  });

  it('吊牌上的局：东 2 局 1 本场写成 E-2-1', () => {
    expect(keyTag(0, 1, 1)).toBe('E-2-1');
    expect(keyTag(1, 3, 0)).toBe('S-4-0');
  });

  it('结算的结果和 rii.ts 拿钥匙的判法一样', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const ids = ['rii', 'kirame', 'mieko', 'hitomi'];
      const seats = ids.map(byId);
      const g = new Game({ seed, format: 'east', players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
      let steps = 0;
      while (g.phase !== 'roundEnd' && g.phase !== 'gameEnd' && ++steps < 5000) {
        const s = g.waitingSeats()[0];
        g.act(s, chooseAction(g, s, seats[s].ai));
      }
      const bind = riiBind(g, 0);
      const out = chainOutcomes(g, g.roundResult!);
      if (bind === null) {
        expect(out).toHaveLength(0);
        continue;
      }
      expect(out).toHaveLength(1);
      const keys = riiKeys(g, 0);
      const kind = out[0].kind;
      if (kind === 'fade') expect(keys).toHaveLength(0);
      else {
        expect(keys).toHaveLength(1);
        expect(keys[0].broken).toBe(kind === 'broken');
      }
    }
  });
});
