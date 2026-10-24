import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AWAI } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { doraFromIndicator, kindOf, toCounts } from '../src/engine/tiles';

// 能力每局都发动，方便检查
const saved = { ...AWAI };
beforeAll(() => Object.assign(AWAI, { circleChance: 1, cornerKanChance: 1 }));
afterAll(() => Object.assign(AWAI, saved));

const lineup = ['awai', 'saki', 'nodoka', 'kuro'].map((id) => CHARACTERS.find((c) => c.id === id)!);

function play(seed: number, onGame: (g: Game) => void) {
  // 淡轮流坐四个座位
  const seats = [0, 1, 2, 3].map((i) => lineup[(i + seed) % 4]);
  const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  onGame(g);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return { g, awai: seats.findIndex((c) => c.id === 'awai') };
}

describe('大星淡', () => {
  it('绝对安全圈：别人的配牌至少 5 向听，前四巡没人鸣牌时摸牌不进向听；她自己配牌就听牌', () => {
    let deals = 0;
    let draws = 0;
    let leaks = 0;
    for (let seed = 1; seed <= 12; seed++) {
      let awai = -1;
      const before = new Map<number, number>();
      play(seed, (g) => {
        awai = g.players.findIndex((p) => p.name === 'awai');
        g.onEvent((e) => {
          if (e.type === 'roundStart') {
            before.clear();
            for (const p of g.players) {
              const sh = shanten(toCounts(p.hand));
              if (p.seat === awai) expect(sh).toBe(0);
              else expect(sh).toBeGreaterThanOrEqual(AWAI.safeShanten);
              deals++;
            }
          }
          if (e.type === 'discard') before.set(e.seat, shanten(toCounts(g.players[e.seat].hand), g.players[e.seat].melds.length));
          if (e.type === 'draw' && e.seat !== awai && g.noCallsYet && g.players[e.seat].discards.length < AWAI.safeTurns) {
            const p = g.players[e.seat];
            const prev = before.get(e.seat) ?? shanten(toCounts(p.hand.filter((t) => t !== p.drawn)));
            // 5 向听的手几乎什么牌都有用，能换的废牌被换光时才挡不住
            if (shanten(toCounts(p.hand), p.melds.length) < prev) leaks++;
            draws++;
          }
        });
        // 第一局在挂上监听之前就发完了牌
        for (const p of g.players) if (p.seat !== awai) expect(shanten(toCounts(p.hand.filter((t) => t !== p.drawn)))).toBeGreaterThanOrEqual(AWAI.safeShanten);
      });
    }
    console.log({ deals, draws, leaks });
    expect(deals).toBeGreaterThan(100);
    expect(draws).toBeGreaterThan(100);
    expect(leaks).toBeLessThan(draws * 0.1);
  }, 120000);

  it('转角暗杠：没人鸣牌就在转角前暗杠，杠里指向她杠的牌，下一张自摸', () => {
    let kans = 0;
    let wins = 0;
    let uraHits = 0;
    for (let seed = 1; seed <= 20; seed++) {
      play(seed, (g) => {
        const awai = g.players.findIndex((p) => p.name === 'awai');
        let kanKind = -1;
        g.onEvent((e) => {
          if (e.type === 'roundStart') kanKind = -1;
          if (e.type === 'call' && e.seat === awai && e.call === '暗杠') {
            kans++;
            kanKind = kindOf(g.players[awai].melds.at(-1)!.tiles[0]);
          }
          if (e.type === 'roundEnd' && kanKind >= 0) {
            const w = e.result.wins.find((x) => x.seat === awai);
            if (w && w.from === null) {
              wins++;
              if (w.uraIndicators.some((i) => doraFromIndicator(kindOf(i)) === kanKind)) uraHits++;
            }
          }
        });
      });
    }
    console.log({ kans, wins, uraHits });
    expect(kans).toBeGreaterThan(10);
    // 杠完以后被别人和掉、被流局，都有可能；但大多数时候她会自摸，而且里宝牌就是杠的那张
    expect(wins).toBeGreaterThan(kans * 0.6);
    // 杠里的指示牌开局就藏好了；只有那种牌开局全在别人手里时才藏不了
    expect(uraHits).toBeGreaterThan(wins * 0.9);
  }, 120000);
});
