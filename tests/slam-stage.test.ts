import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { kindOf } from '../src/engine/tiles';
import { slamStage } from '../src/ui/slamStage';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

// 和「自摸动作测试」开的局一样：star 坐 seat、坐庄，别人坐三位没有特别动作的人，谁都不用能力，电脑替所有人打
function testGame(seed: number, star: string, seat: number): { g: Game; chars: ReturnType<typeof byId>[] } {
  const fill = ['hajime', 'tomoki', 'izumi', 'kana'].filter((id) => id !== star).map(byId);
  const chars = [0, 1, 2, 3].map((s) => (s === seat ? byId(star) : fill.shift()!));
  const g = new Game({ seed, format: 'east', firstDealer: seat, rules: { tobi: false }, stage: slamStage(seat), players: chars.map((c) => ({ name: c.id, ability: null })) });
  return { g, chars };
}

// 打到这一局结束
function playRound(g: Game, chars: ReturnType<typeof byId>[]): void {
  while (g.phase === 'predeal' || g.phase === 'postdeal') g.deal();
  let steps = 0;
  while (g.phase === 'turn' || g.phase === 'calls') {
    if (++steps > 2000) throw new Error('这一局没有结束');
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, chars[s].ai));
  }
}

describe('自摸动作测试局', () => {
  for (const star of ['hisa', 'nodoka']) {
    it(`${star} 坐哪一家都是第二张摸到 5s 自摸，一直连庄`, () => {
      for (let seat = 0; seat < 4; seat++) {
        for (let seed = 1; seed <= 6; seed++) {
          const { g, chars } = testGame(seed * 17 + seat, star, seat);
          for (let r = 0; r < 3; r++) {
            playRound(g, chars);
            const wins = g.roundResult?.wins ?? [];
            expect(wins.length).toBe(1);
            const w = wins[0];
            expect(w.seat).toBe(seat);
            expect(w.from).toBeNull();
            expect(kindOf(w.tile)).toBe(22);
            expect(g.players[seat].discards.length).toBe(1);
            expect(w.result.yaku.map((y) => y.name)).not.toContain('天和');
            g.nextRound();
            expect(g.dealer).toBe(seat);
          }
        }
      }
    });
  }
});
