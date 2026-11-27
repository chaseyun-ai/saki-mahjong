import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { nellyTier } from '../src/abilities/nelly';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';

// 涅莉（重做）押了运势的局为什么会荒牌流局（scripts/nelly-remake.ts 那样：另外三家随机抽、座位随机，南风战）
// 这几个种子改之前都是她押了的局荒牌流局
const nelly = CHARACTERS.find((c) => c.id === 'nelly')!;
interface Bet { round: number; slot: number; bet: number; kind: string; reason?: string; won: boolean }
function play(seed: number, plan?: number[]) {
  const rng = new Rng(seed * 977);
  const others = rng.shuffle(CHARACTERS.filter((c) => c.id !== 'nelly')).slice(0, 3);
  const order = rng.shuffle([nelly, ...others]);
  const me = order.indexOf(nelly);
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  if (plan) (g.abilityGameState[me] as { plan?: number[] }).plan = plan;
  const bets: Bet[] = [];
  g.onEvent((e) => {
    if (e.type !== 'roundEnd') return;
    const bet = nellyTier(g, me);
    if (bet > 0) bets.push({ round: g.round, slot: g.roundWind * 4 + g.roundNumber, bet, kind: e.result.kind, reason: e.result.reason, won: e.result.wins.some((w) => w.seat === me) });
  });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 40000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  return bets;
}

describe('涅莉（重做）押了运势的局不再荒牌流局', () => {
  it('一发被吃掉、里宝牌凑不到三倍满：立直以后照样自摸（以前不到三倍满不和，听的牌摸光了荒牌流局）', () => {
    for (const [seed, round] of [
      [69, 2],
      [358, 6],
      [392, 4],
    ]) {
      const b = play(seed).find((x) => x.round === round)!;
      expect(b.bet, `种子 ${seed}`).toBe(1);
      expect(b.won, `种子 ${seed}`).toBe(true);
    }
  });

  it('叠着押 3 点等最后一次摸牌：她立直以后到那一次摸牌之间谁都鸣不了，碰牌跳不过她那一巡', () => {
    const b = play(91, [0, 0, 0, 3, 0, 0, 0, 0]).find((x) => x.bet === 3)!;
    expect(b.kind).toBe('win');
    expect(b.won).toBe(true);
  });

  it('别人九种九牌途中流局：押的运势退回来，本场重打的这一局照样押着', () => {
    const bets = play(57);
    const i = bets.findIndex((x) => x.reason === '九种九牌');
    expect(i).toBeGreaterThanOrEqual(0);
    const again = bets[i + 1];
    expect(again.slot).toBe(bets[i].slot);
    expect(again.bet).toBe(bets[i].bet);
  });
});
