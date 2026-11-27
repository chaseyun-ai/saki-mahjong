import { describe, expect, it } from 'vitest';
import { CHARACTERS, baseAi } from '../src/abilities/characters';
import { dealerStops } from '../src/ai/dealerStop';
import { Game, type RoundResult, type WinInfo } from '../src/engine/game';
import { TeamSim } from '../src/story/teamSim';
import { POSITIONS, dealerStopAt } from '../src/team/team';

// 团体赛：先锋到副将的南 4 局庄家和了以后，庄家可以宣布到此结束；大将战照常连庄

function teamGame(dealerStop: boolean, scores = [100000, 100000, 100000, 100000]) {
  return new Game({ seed: 3, format: 'team', dealerStop, startScore: 100000, scores, firstDealer: 0, players: ['a', 'b', 'c', 'd'].map((name) => ({ name })) });
}

// 摆到南 4 局（honba 本场）刚结算完：result 拿到的是南 4 局的庄家坐哪
function endSouth4(g: Game, result: (dealer: number) => Partial<RoundResult> & { kind: RoundResult['kind'] }, honba = 0): void {
  g.roundWind = 1;
  g.roundNumber = 3;
  g.honba = honba;
  g.roundResult = { wins: [], tenpai: [false, false, false, false], deltas: [0, 0, 0, 0], ...result(g.dealer) };
  g.phase = 'roundEnd';
}

const win = (seat: number): WinInfo => ({ seat, from: null }) as WinInfo;

describe('团体赛南 4 局庄家和了：到此结束还是连庄', () => {
  it('哪几个位置能喊停：先锋到副将能，大将战不能', () => {
    expect(POSITIONS.map((_, i) => dealerStopAt(i))).toEqual([true, true, true, true, false]);
  });

  it('庄家和了宣布到此结束：这一场马上结束，立直棒照样留给下一个位置', () => {
    const g = teamGame(true);
    endSouth4(g, (d) => ({ kind: 'win', wins: [win(d)] }));
    g.riichiSticks = 2;
    expect(g.mayStop()).toBe(true);
    g.nextRound(true);
    expect(g.phase).toBe('gameEnd');
    expect(g.stopped).toBe(true);
    expect(g.riichiSticks).toBe(2);
  });

  it('不喊停就照常连庄：还是南 4 局，本场加一；连庄的局再和了还能再选', () => {
    const g = teamGame(true);
    endSouth4(g, (d) => ({ kind: 'win', wins: [win(d)] }), 2);
    g.nextRound(false);
    expect(g.phase).not.toBe('gameEnd');
    expect([g.roundWind, g.roundNumber, g.honba]).toEqual([1, 3, 3]);
    expect(g.stopped).toBe(false);
    endSouth4(g, (d) => ({ kind: 'win', wins: [win(d)] }), 3);
    expect(g.mayStop()).toBe(true);
  });

  it('一炮多响里有庄家也能喊停', () => {
    const g = teamGame(true);
    endSouth4(g, (d) => ({ kind: 'win', wins: [win((d + 1) % 4), win(d)] }));
    expect(g.mayStop()).toBe(true);
  });

  it('不能喊停的情况：大将战、别人和了、流局听牌连庄、不是南 4 局、有人被击飞', () => {
    const anchor = teamGame(false);
    endSouth4(anchor, (d) => ({ kind: 'win', wins: [win(d)] }));
    expect(anchor.mayStop()).toBe(false);
    // 大将战传了 stop 也不算：照常连庄
    anchor.nextRound(true);
    expect(anchor.phase).not.toBe('gameEnd');
    expect(anchor.honba).toBe(1);

    const other = teamGame(true);
    endSouth4(other, (d) => ({ kind: 'win', wins: [win((d + 2) % 4)] }));
    expect(other.mayStop()).toBe(false);

    const tenpai = teamGame(true);
    endSouth4(tenpai, () => ({ kind: 'exhaustive', tenpai: [true, true, true, true] }));
    expect(tenpai.mayStop()).toBe(false);
    tenpai.nextRound(true);
    expect(tenpai.phase).not.toBe('gameEnd');

    const south3 = teamGame(true);
    south3.roundWind = 1;
    south3.roundNumber = 2;
    south3.roundResult = { kind: 'win', wins: [win(south3.dealer)], tenpai: [false, false, false, false], deltas: [0, 0, 0, 0] };
    south3.phase = 'roundEnd';
    expect(south3.mayStop()).toBe(false);

    const bust = teamGame(true, [100000, 100000, 100000, -2000]);
    endSouth4(bust, (d) => ({ kind: 'win', wins: [win(d)] }));
    expect(bust.mayStop()).toBe(false);
  });

  it('不是团体赛就没有这个选择', () => {
    const g = new Game({ seed: 3, format: 'south', dealerStop: true, players: ['a', 'b', 'c', 'd'].map((name) => ({ name })) });
    endSouth4(g, (d) => ({ kind: 'win', wins: [win(d)] }));
    expect(g.mayStop()).toBe(false);
  });

  it('电脑庄家：这一队单独第一就收手，不是第一（同分也算）就连庄；宫永照接着连和', () => {
    const top = teamGame(true, [130000, 90000, 95000, 85000]);
    expect(dealerStops(top, 0, baseAi)).toBe(true);
    const second = teamGame(true, [100000, 120000, 95000, 85000]);
    expect(dealerStops(second, 0, baseAi)).toBe(false);
    const tied = teamGame(true, [110000, 110000, 95000, 85000]);
    expect(dealerStops(tied, 0, baseAi)).toBe(false);
    const teru = CHARACTERS.find((c) => c.id === 'teru')!;
    expect(dealerStops(top, 0, teru.ai)).toBe(false);
  });

  it('后台的团体赛照样打得完', () => {
    const lineup = CHARACTERS.slice(0, 20);
    const lineups = [0, 1, 2, 3].map((t) => lineup.slice(t * 5, t * 5 + 5));
    const sim = new TeamSim(lineups, 11);
    const points = sim.runAll();
    expect(sim.done).toBe(true);
    expect(points).toHaveLength(4);
  });
});
