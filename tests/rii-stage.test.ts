import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { riiBind, riiKeys } from '../src/abilities/rii';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { isHonor, kindOf, toCounts } from '../src/engine/tiles';
import { RIICHI_HAND, riichiTsumoStage } from '../src/ui/riiStage';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

// 「白水哩 · 姬子测试」的「立直就能自摸」：配牌听牌，第一张摸到字牌打出去立直，下一张自摸
describe('立直就能自摸的测试局', () => {
  for (const [seed, ids] of [
    [1, ['rii', 'teru', 'kuro', 'koromo']],
    [2, ['rii', 'awai', 'saki', 'himeko']],
    [3, ['rii', 'toki', 'nodoka', 'shizuno']],
    [4, ['rii', 'kuro', 'awai', 'teru']],
  ] as [number, string[]][]) {
    it(`${ids.slice(1).join('、')} 同桌：缚 4 番、立直、一发自摸拿到钥匙（5 番）`, () => {
      const seats = ids.map(byId);
      const g = new Game({ seed, format: 'east', firstDealer: seed % 4, stage: riichiTsumoStage(0), players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: i === 0 })) });
      if (g.phase === 'predeal') g.deal();
      if (g.phase === 'postdeal') g.deal();
      const p = g.players[0];
      expect(toCounts(p.hand.filter((t) => t !== p.drawn)).join()).toBe(toCounts(RIICHI_HAND.map((k) => k * 4)).join());
      let steps = 0;
      let declared = false;
      while (g.phase !== 'roundEnd' && g.phase !== 'gameEnd' && ++steps < 2000) {
        const s = g.waitingSeats()[0];
        if (s === 0 && g.phase === 'turn' && p.discards.length === 0) {
          // 第一张摸到的是字牌，听牌没变
          expect(isHonor(kindOf(p.drawn!))).toBe(true);
          seats[0].ability!.pressSkill!(g, 0, '4');
          const rii = g.legalActions(0).find((a) => a.type === 'discard' && a.riichi && a.tile === p.drawn);
          expect(rii).toBeTruthy();
          g.act(0, rii!);
          declared = true;
          continue;
        }
        if (s === 0 && g.phase === 'turn' && p.riichi) {
          expect(g.legalActions(0).some((a) => a.type === 'tsumo')).toBe(true);
          g.act(0, { type: 'tsumo' });
          continue;
        }
        g.act(s, s === 0 ? g.legalActions(0).find((a) => a.type === 'pass') ?? g.legalActions(0)[0] : chooseAction(g, s, seats[s].ai));
      }
      expect(declared).toBe(true);
      expect(shanten(toCounts(RIICHI_HAND.map((k) => k * 4)), 0)).toBe(0);
      const win = g.roundResult!.wins.find((w) => w.seat === 0)!;
      expect(win.from).toBeNull();
      const names = win.result.yaku.map((y) => y.name);
      expect(names.some((n) => n === '立直' || n === '两立直')).toBe(true);
      for (const y of ['一发', '门前清自摸和', '平和']) expect(names).toContain(y);
      expect(win.result.han).toBeGreaterThanOrEqual(names.includes('两立直') ? 5 : 4);
      expect(riiBind(g, 0)).toBe(4);
      expect(riiKeys(g, 0).at(-1)).toMatchObject({ bind: 4, broken: false });
    });
  }
});
