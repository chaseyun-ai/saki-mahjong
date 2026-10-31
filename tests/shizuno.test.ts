import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { SHIZUNO, shizunoDora, shizunoMarks, shizunoMist, shizunoPower } from '../src/abilities/shizuno';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { doraFromIndicator, kindOf, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
// 对手都没有能力：看得清她自己的效果
const PLAIN = ['shizuno', 'izumi', 'izumi', 'izumi'];

function newGame(seed: number, ids: string[]) {
  return new Game({ seed, format: 'south', players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });
}

// 打完一整个半庄；每一局发完牌调 onDeal
function play(g: Game, ids: string[], onDeal?: () => void) {
  onDeal?.();
  g.onEvent((e) => {
    if (e.type === 'roundStart') onDeal?.();
  });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, byId(ids[s]).ai));
  }
}

describe('高鸭稳乃', () => {
  it('4 费；每开一局（本场也算）加一个深山标记，6 个起控制宝牌、起雾，之后每两个厚一级', () => {
    expect(byId('shizuno').cost).toBe(4);
    const g = newGame(1, PLAIN);
    const seen: number[] = [];
    play(g, PLAIN, () => seen.push(shizunoMarks(g)));
    // 第一局就有一个，之后每一局加一
    expect(seen[0]).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i] - seen[i - 1]).toBe(1);

    const at = (round: number) => {
      g.round = round;
      return { power: shizunoPower(g), dora: shizunoDora(g), mist: shizunoMist(g) };
    };
    const phase = g.phase;
    (g as { phase: string }).phase = 'turn';
    expect(at(1).power).toBeCloseTo(0.05);
    expect(at(5)).toEqual({ power: expect.closeTo(0.25), dora: false, mist: 0 });
    expect(at(6).mist).toBe(1);
    expect(at(7).mist).toBe(1);
    expect(at(8).mist).toBe(2);
    expect(at(10).mist).toBe(3);
    expect(at(12).mist).toBe(4);
    expect(at(20)).toEqual({ power: SHIZUNO.cap, dora: true, mist: 4 });
    (g as { phase: string }).phase = phase;
  }, 60000);

  it('别人的能力按标记数的概率不起作用；玄、照不受影响', () => {
    const g = newGame(3, ['shizuno', 'awai', 'kuro', 'teru']);
    g.round = 8; // 8 个标记：40%
    let awai = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      if (g.damped(1)) awai++;
      expect(g.damped(2)).toBe(false);
      expect(g.damped(3)).toBe(false);
      // 她自己不受影响
      expect(g.damped(0)).toBe(false);
    }
    expect(awai / N).toBeGreaterThan(0.36);
    expect(awai / N).toBeLessThan(0.44);
  });

  it('满 6 个以后，宝牌多半是她配牌里最多的那种牌', () => {
    let rounds = 0;
    let hits = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const g = newGame(seed, PLAIN);
      play(g, PLAIN, () => {
        if (!shizunoDora(g)) return;
        rounds++;
        const counts = toCounts(g.players[0].hand.slice(0, 13));
        const dora = doraFromIndicator(kindOf(g.wall.doraIndicators[0]));
        if (counts[dora] === Math.max(...counts)) hits++;
      });
    }
    expect(rounds).toBeGreaterThan(5);
    expect(hits / rounds).toBeGreaterThan(0.8);
  }, 120000);

  it('配牌、进张随标记变顺：她和牌比三家没有能力的对手多', () => {
    const wins = [0, 0, 0, 0];
    for (let seed = 1; seed <= 10; seed++) {
      const g = newGame(seed, PLAIN);
      g.onEvent((e) => {
        if (e.type === 'roundEnd') for (const w of e.result.wins) wins[w.seat]++;
      });
      play(g, PLAIN);
    }
    const others = (wins[1] + wins[2] + wins[3]) / 3;
    expect(wins[0]).toBeGreaterThan(others);
  }, 120000);
});
