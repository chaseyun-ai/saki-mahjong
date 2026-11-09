import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game, Rules } from '../src/engine/game';
import { Meld, evaluateWin } from '../src/engine/score';
import { EAST, RED_FIVES, SOUTH, isRed, kindOf, parseKinds, parseTiles, setRedFives } from '../src/engine/tiles';
import { Rng } from '../src/engine/rng';
import { DEFAULT_SETTINGS, parseTarget, pickOpponents, rulesOf, setOption } from '../src/ui/matchSetup';

// 赤宝牌是整页共用的，别的测试照三赤
afterEach(() => setRedFives(3));

function newGame(format: 'one' | 'east' | 'south', rules: Partial<Rules> = {}, startScore = 25000) {
  return new Game({ seed: 7, format, startScore, rules, players: ['a', 'b', 'c', 'd'].map((name) => ({ name })) });
}

function playOut(g: Game): number {
  let rounds = 0;
  g.onEvent((e) => e.type === 'roundEnd' && rounds++);
  for (let steps = 0; g.phase !== 'gameEnd'; steps++) {
    if (steps > 20000) throw new Error('对局没有结束');
    if (g.phase === 'roundEnd') g.nextRound();
    else for (const s of g.waitingSeats()) g.act(s, chooseAction(g, s, CHARACTERS[0].ai));
  }
  return rounds;
}

describe('对局规则', () => {
  it('一局战：打完一局就结束', () => {
    expect(playOut(newGame('one'))).toBe(1);
  });

  it('起始点数', () => {
    expect(newGame('south', {}, 100000).players.map((p) => p.score)).toEqual([100000, 100000, 100000, 100000]);
  });

  it('一位必要点数：没人到就南入、西入，一直打', () => {
    // 起始 25000、要 10 万点：东风战东 4 局打完也不结束
    const g = newGame('east', { target: 100000 });
    g.roundWind = 0;
    g.roundNumber = 3;
    g.roundResult = { kind: 'exhaustive', wins: [], tenpai: [false, false, false, false], deltas: [0, 0, 0, 0] };
    g.phase = 'roundEnd';
    g.nextRound();
    expect(g.phase).not.toBe('gameEnd');
    expect(g.roundWind).toBe(1);
  });

  it('击飞关掉：负分照打', () => {
    const end = (tobi: boolean) => {
      const g = newGame('south', { tobi });
      g.players[1].score = -3000;
      g.roundResult = { kind: 'exhaustive', wins: [], tenpai: [true, false, false, false], deltas: [0, 0, 0, 0] };
      g.phase = 'roundEnd';
      g.nextRound();
      return g.phase;
    };
    expect(end(true)).toBe('gameEnd');
    expect(end(false)).not.toBe('gameEnd');
  });

  it('赤宝牌：关闭、三赤、四赤', () => {
    newGame('south', { red: 0 });
    expect(RED_FIVES.length).toBe(0);
    newGame('south', { red: 4 });
    expect(RED_FIVES.length).toBe(4);
    expect([...Array(136).keys()].filter((t) => isRed(t) && kindOf(t) === 13)).toHaveLength(2);
    newGame('south');
    expect(RED_FIVES.length).toBe(3);
  });

  it('食断关掉：鸣了牌的断幺九不算', () => {
    const pon: Meld = { type: 'pon', tiles: parseTiles('666p'), from: 1 };
    const closed = parseTiles('234m456m678s55s');
    const winTile = closed.find((t) => kindOf(t) === parseKinds('2m')[0])!;
    const ctx = { closed, melds: [pon], winTile, tsumo: false, seatWind: SOUTH, roundWind: EAST, isDealer: false, doraIndicators: parseKinds('5z') };
    expect(evaluateWin(ctx)?.yaku.map((y) => y.name)).toEqual(['断幺九']);
    expect(evaluateWin({ ...ctx, kuitan: false })).toBeNull();
    // 门清的照算
    expect(evaluateWin({ ...ctx, closed: [...closed, ...pon.tiles], melds: [], kuitan: false })?.yaku.map((y) => y.name)).toContain('断幺九');
  });

  it('番缚：只数役的番，宝牌不算', () => {
    const g = newGame('south', { minHan: 2 });
    const base = { yaku: [{ name: '断幺九', han: 1 }], dora: 2, aka: 0, ura: 0, han: 3, fu: 30, yakuman: 0, base: 0, limitName: '', ron: 0, tsumoDealerPays: 0, tsumoOtherPays: 0 };
    expect(g.minHanOk(base)).toBeNull();
    expect(g.minHanOk({ ...base, yaku: [{ name: '七对子', han: 2 }], han: 4 })).not.toBeNull();
    expect(g.minHanOk({ ...base, yaku: [{ name: '国士无双', han: 13 }], yakuman: 1 })).not.toBeNull();
  });

  it('四番缚、四赤也能打完整场', () => {
    expect(playOut(newGame('south', { minHan: 4, red: 4, kuitan: false }))).toBeGreaterThan(0);
  });
});

describe('设置弹窗', () => {
  it('默认：半庄、25000、30000、击飞开、四赤、食断开、一番缚、不公开手牌', () => {
    expect(DEFAULT_SETTINGS).toEqual({ length: 'south', start: 25000, target: 30000, tobi: true, red: 4, kuitan: true, minHan: 1, open: false, drawPath: 'on', vary: true, opponents: ['', '', ''], chisui: false, layout: 'classic', hand: 'B', result: 'classic' });
  });

  it('选对手：选了的照坐，随机、重复的、选了自己的从剩下的抽', () => {
    const [a, b, c] = CHARACTERS.map((x) => x.id);
    for (let seed = 1; seed < 20; seed++) {
      const got = pickOpponents({ ...DEFAULT_SETTINGS, opponents: [b, '', a] }, a, new Rng(seed)).map((x) => x.id);
      expect(got[0]).toBe(b);
      expect(new Set([a, ...got]).size).toBe(4);
      const dup = pickOpponents({ ...DEFAULT_SETTINGS, opponents: [c, c, ''] }, a, new Rng(seed)).map((x) => x.id);
      expect(dup[0]).toBe(c);
      expect(new Set([a, ...dup]).size).toBe(4);
    }
  });

  it('按钮上的值换回设置', () => {
    const s = { ...DEFAULT_SETTINGS };
    setOption(s, 'red', '0');
    setOption(s, 'tobi', 'false');
    setOption(s, 'length', 'one');
    setOption(s, 'minHan', '7'); // 没有这个选项，不变
    expect([s.red, s.tobi, s.length, s.minHan]).toEqual([0, false, 'one', 1]);
    expect(rulesOf(s)).toEqual({ target: 30000, tobi: false, red: 0, kuitan: true, minHan: 1 });
  });

  it('一位必要点数自由输入', () => {
    expect(parseTarget('40000')).toBe(40000);
    expect(parseTarget('35,050')).toBe(35100);
    expect(parseTarget('abc')).toBe(30000);
  });
});
