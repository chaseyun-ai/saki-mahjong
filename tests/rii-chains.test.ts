import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { RII, riiBind, riiKeys } from '../src/abilities/rii';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { keyTag } from '../src/ui/keyArt';
import { BREAK, chainLinks, chainOutcomes, chainPlan, dissolveAt, goldTime, lockTime, outcomeTime, skyStart, skyTime } from '../src/ui/riiChainPlan';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

describe('白水哩番缚的锁链特效', () => {
  it('缚几番就有几条锁链，最多七条，位置各不相同', () => {
    for (let n = 1; n <= RII.maxBind; n++) expect(chainPlan(n)).toHaveLength(n);
    expect(chainPlan(9)).toHaveLength(7);
    const all = chainPlan(7);
    expect(new Set(all.map((l) => l.x.toFixed(2))).size).toBe(7);
    // 从四面八方：上下左右都有射过来的
    expect(all.some((l) => Math.sin(l.angle) > 0.3) && all.some((l) => Math.sin(l.angle) < -0.3)).toBe(true);
    expect(all.some((l) => Math.cos(l.angle) > 0.3) && all.some((l) => Math.cos(l.angle) < -0.3)).toBe(true);
  });

  it('锁链从画面外射过来，最后箍在手牌上一圈', () => {
    const dims = { width: 14, height: 1.4, depth: 0.8, far: 20, pitch: 0.4 };
    for (const line of chainPlan(7)) {
      const { links, loopStart, length } = chainLinks(line, dims);
      // 第一节在很远的地方，箍着的那一圈都贴着手牌
      expect(Math.hypot(links[0].p[0] - line.x * 14, links[0].p[1])).toBeGreaterThan(15);
      const loop = links.slice(loopStart);
      expect(loop.length).toBeGreaterThan(8);
      for (const l of loop) {
        expect(l.loop).toBe(true);
        expect(Math.abs(l.p[1])).toBeLessThanOrEqual(1.4 * 0.62 * 1.05);
        expect(Math.abs(l.p[2])).toBeLessThanOrEqual(0.8 * 0.9 * 1.05 + 0.05);
      }
      // 一圈有前有后（绕到手牌后面）
      expect(loop.some((l) => l.p[2] > 0.3) && loop.some((l) => l.p[2] < -0.3)).toBe(true);
      expect(length).toBeGreaterThan(20);
    }
  });

  it('崩断时大部分消散，剩下一部分化成光', () => {
    const r = Array.from({ length: 200 }, (_, k) => dissolveAt(1, k));
    const kept = r.filter((x) => x >= 1 - BREAK.keep).length / r.length;
    expect(kept).toBeGreaterThan(0.25);
    expect(kept).toBeLessThan(0.55);
    expect(dissolveAt(2, 5)).toBe(dissolveAt(2, 5));
  });

  it('锁得越多锁上越久；钥匙那一段最长', () => {
    expect(lockTime(7)).toBeGreaterThan(lockTime(1));
    expect(outcomeTime('key')).toBe(goldTime());
    expect(goldTime()).toBeCloseTo(skyStart() + skyTime());
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
