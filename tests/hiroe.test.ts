import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { bulbLevel, dangerKinds, readTenpai } from '../src/abilities/hiroe';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { kindOf } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const ids = (kinds: number[], copy = 3) => kinds.map((k) => k * 4 + copy);

describe('爱宕洋榎：读牌', () => {
  it('读得出谁听什么、多大；振听和没役的不算放铳牌', () => {
    const g = new Game({ seed: 3, players: ['hiroe', 'saki', 'nodoka', 'kuro'].map((id) => ({ name: id, ability: byId(id).ability })) });
    // 一家：123m 456p 789s 白白白 + 5m 单骑（有役：白）
    g.players[1].hand = [...ids([0, 1, 2, 12, 13, 14, 24, 25, 26]), ...[1, 2, 3].map((i) => 31 * 4 + i), 4 * 4 + 3];
    g.players[1].melds = [];
    g.players[1].discards = [];
    // 另一家：清一色 1112345678999m，九面听
    g.players[2].hand = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8].map((k, i) => k * 4 + (i % 3));
    g.players[2].melds = [];
    g.players[2].discards = [];
    // 第三家：听牌但没役（门清不立直、只能自摸）而且振听
    g.players[3].hand = ids([0, 1, 2, 12, 13, 14, 24, 25, 26, 27, 27, 9, 10], 1).map((t, i) => (i === 10 ? t + 1 : t));
    g.players[3].melds = [];
    g.players[3].discards = [{ tile: 11 * 4 + 2, riichi: false, called: false } as never];
    const a = readTenpai(g, 1)!;
    expect(a.ron).toEqual([4]);
    const b = readTenpai(g, 2)!;
    expect(b.ron.length).toBe(9);
    expect(bulbLevel(b.value)).toBeGreaterThan(bulbLevel(a.value));
    const c = readTenpai(g, 3);
    expect(c?.ron ?? []).toEqual([]);
    const danger = dangerKinds(g, 0);
    expect([...danger].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('电脑的洋榎：有别的牌可打时，不打读出来别人和得了的牌', () => {
    let checked = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const seats = ['hiroe', 'saki', 'nodoka', 'kuro'].map(byId);
      const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
      let steps = 0;
      while (g.phase !== 'gameEnd' && ++steps < 20000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        const s = g.waitingSeats()[0];
        const a = chooseAction(g, s, seats[s].ai);
        if (s === 0 && g.phase === 'turn' && a.type === 'discard' && !g.players[0].riichi) {
          const danger = dangerKinds(g, 0);
          const safe = g.legalActions(0).some((x) => x.type === 'discard' && !danger.has(kindOf(x.tile)));
          if (danger.size && safe) {
            checked++;
            expect(danger.has(kindOf(a.tile))).toBe(false);
          }
        }
        g.act(s, a);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});
