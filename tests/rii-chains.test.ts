import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { RII, riiBind, riiKeys } from '../src/abilities/rii';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { keyTag } from '../src/ui/keyArt';
import { CHAIN_LOOKS, PLOCK_LOOKS, chainLook } from '../src/ui/riiLook';
import { plockHtml } from '../src/ui/riiPlock';
import { BREAK, chainEnd, chainLinks, chainOutcomes, chainPlan, dissolveAt, goldTime, lockTime, outcomeTime, skyStart, skyTime } from '../src/ui/riiChainPlan';

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

  it('锁链从画面外射过来，压过手牌，另一头伸到画面外', () => {
    const dims = { width: 14, depth: 0.8, far: 20, pitch: 0.4 };
    for (const line of chainPlan(7)) {
      const { links, contactS, length } = chainLinks(line, dims);
      const cx = line.x * 14;
      // 两头都在很远的地方，中间那一节压在手牌上
      expect(Math.hypot(links[0].p[0] - cx, links[0].p[1])).toBeGreaterThan(15);
      const last = links[links.length - 1];
      expect(Math.hypot(last.p[0] - cx, last.p[1])).toBeGreaterThan(15);
      const hit = links.reduce((a, l) => (Math.abs(l.s - contactS) < Math.abs(a.s - contactS) ? l : a));
      expect(Math.hypot(hit.p[0] - cx, hit.p[1])).toBeLessThan(0.4);
      // 从射过来的那个方向来
      expect(links[0].p[0] - cx).toBeCloseTo(Math.cos(line.angle) * 20, 3);
      expect(links.every((l) => l.p[2] > 0)).toBe(true);
      expect(length).toBeCloseTo(40);
    }
  });

  it('几种锁链样子都有，存下来的样子读得回来', () => {
    expect(new Set(CHAIN_LOOKS.map((c) => c.id)).size).toBe(CHAIN_LOOKS.length);
    expect(CHAIN_LOOKS.length).toBeGreaterThanOrEqual(3);
    expect(chainLook('silver').id).toBe('silver');
  });

  it('头像上的锁几种样子都画得出来，都有大锁飞过去落的位置', () => {
    expect(new Set(PLOCK_LOOKS.map((c) => c.id)).size).toBe(PLOCK_LOOKS.length);
    expect(PLOCK_LOOKS.length).toBeGreaterThanOrEqual(3);
    for (const c of PLOCK_LOOKS)
      for (const place of ['seat', 'net', 'plate'] as const) {
        const html = plockHtml(c.id, place, 3, null, -9, 0);
        expect(html).toContain(`rii-plock pl-${c.id} at-${place}`);
        expect(html).toContain('class="rpl-lock"');
        expect(html).not.toContain('NaN');
      }
    // 锁徽、缚印在头像框上写缚几番，小名牌上不写
    expect(plockHtml('badge', 'seat', 3, null, 0, 0)).toContain('缚三');
    expect(plockHtml('seal', 'seat', 5, null, 0, 0)).toContain('五番');
    expect(plockHtml('seal', 'plate', 5, null, 0, 0)).not.toContain('五番');
    expect(plockHtml('frame', 'seat', 2, 'broken', -1, -0.5)).toContain('pl-frame at-seat broken');
  });

  it('崩断时每一节轮流碎成粒子，先后撒得开，放完前都碎完', () => {
    const r = Array.from({ length: 200 }, (_, k) => dissolveAt(1, k));
    expect(Math.min(...r)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...r)).toBeLessThan(1);
    // 前一半、后一半时间里碎的都不少（不是一下子全没了）
    const early = r.filter((x) => x < 0.5).length / r.length;
    expect(early).toBeGreaterThan(0.3);
    expect(early).toBeLessThan(0.7);
    expect(dissolveAt(2, 5)).toBe(dissolveAt(2, 5));
    expect(outcomeTime('broken')).toBeCloseTo(BREAK.show + BREAK.crack + BREAK.dissolve + BREAK.crumble + BREAK.drift);
  });

  it('锁得越多锁上越久；钥匙那一段最长', () => {
    expect(lockTime(7)).toBeGreaterThan(lockTime(1));
    expect(outcomeTime('key')).toBe(goldTime());
    expect(goldTime()).toBeCloseTo(skyStart() + skyTime());
    expect(outcomeTime('key')).toBeGreaterThan(outcomeTime('broken'));
    // 番数不够和没和成一样崩断
    expect(outcomeTime('short')).toBe(outcomeTime('broken'));
    expect(chainEnd('short')).toBe('broken');
    expect(chainEnd('key')).toBe('key');
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
      if (kind === 'short') expect(keys).toHaveLength(0);
      else {
        expect(keys).toHaveLength(1);
        expect(keys[0].broken).toBe(kind === 'broken');
      }
    }
  });
});
