import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { toCounts } from '../src/engine/tiles';
import { SEA_FROM, SEA_FULL, koromoSea, seaRise } from '../src/ui/koromoSea';
import { SEA_HAND, SEA_TEST_OPPONENTS, koromoSeaStage } from '../src/ui/waterStage';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

describe('衣的海水涨多高', () => {
  it('配完牌时是 0，剩 SEA_FULL 张时涨满，中间一直往上涨', () => {
    expect(seaRise(SEA_FROM)).toBe(0);
    expect(seaRise(SEA_FULL)).toBe(1);
    expect(seaRise(0)).toBe(1);
    let last = -1;
    for (let r = SEA_FROM; r >= 0; r--) {
      expect(seaRise(r)).toBeGreaterThanOrEqual(last);
      last = seaRise(r);
    }
    // 一开始涨得慢
    expect(seaRise((SEA_FROM + SEA_FULL) / 2)).toBeLessThan(0.5);
  });
});

// 「衣 · 海底捞月测试」：电脑替她打，每一局都平静地打到海底，最后一张自摸海底捞月
describe('海底捞月测试局', () => {
  for (let seed = 1; seed <= 16; seed++) {
    it(`种子 ${seed}：海水一路涨到满，海底自摸`, () => {
      const seats = [byId('koromo'), ...SEA_TEST_OPPONENTS.map(byId)];
      const ids = seats.map((c) => c.id);
      const g = new Game({ seed, format: 'east', firstDealer: 3, stage: koromoSeaStage(0), players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
      if (g.phase === 'predeal') g.deal();
      if (g.phase === 'postdeal') g.deal();
      const p = g.players[0];
      expect(toCounts(p.hand).join()).toBe(toCounts(SEA_HAND.map((k) => k * 4)).join());
      const levels: number[] = [];
      let steps = 0;
      while (g.phase !== 'roundEnd' && g.phase !== 'gameEnd' && ++steps < 2000) {
        const sea = koromoSea(g, ids);
        expect(sea?.on).toBe(true);
        levels.push(sea!.level);
        const s = g.waitingSeats()[0];
        if (s === 0 && g.phase === 'turn' && g.wall.remaining === 0) {
          expect(g.legalActions(0).some((a) => a.type === 'tsumo')).toBe(true);
          // 海底牌就是她摸到的这张
          expect(sea!.haitei).toBe(null);
          g.act(0, { type: 'tsumo' });
          continue;
        }
        g.act(s, chooseAction(g, s, seats[s].ai));
      }
      expect(levels[0]).toBeLessThan(0.05);
      expect(levels.at(-1)).toBe(1);
      const win = g.roundResult!.wins.find((w) => w.seat === 0)!;
      expect(win.from).toBeNull();
      expect(win.result.yaku.map((y) => y.name)).toContain('海底捞月');
      expect(g.events.some((e) => e.type === 'ability' && e.seat === 0 && e.text === '海底自摸')).toBe(true);
    });
  }
});
