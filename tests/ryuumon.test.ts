import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { junAbility, junJamming, usefulKinds } from '../src/abilities/jun';
import { TOKA, roundMovement, tokaAbility, tokaChisui, tokaMoved } from '../src/abilities/toka';
import { chooseAction } from '../src/ai/ai';
import { Game, type RoundResult } from '../src/engine/game';
import { kindOf } from '../src/engine/tiles';
import type { Ability } from '../src/abilities/types';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function game(seed: number, at: number, ability: Ability, format: 'east' | 'south' = 'east') {
  return new Game({ seed, format, players: [0, 1, 2, 3].map((i) => ({ name: `p${i}`, ability: i === at ? ability : null })) });
}

// 电脑把这一场打完；每一步之前调 step
function play(g: Game, styles: (typeof CHARACTERS)[number]['ai'][], step?: () => void) {
  while (g.phase !== 'gameEnd') {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    step?.();
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, styles[s]));
  }
}

// 把牌山里一张 kind 的牌换到下一张
function putOnTop(g: Game, kind: number) {
  const live = g.wall.live;
  const i = live.findIndex((t) => kindOf(t) === kind);
  [live[0], live[i]] = [live[i], live[0]];
}

const result = (deltas: number[]): RoundResult => ({ kind: 'win', wins: [], tenpai: [false, false, false, false], deltas });

describe('龙门渊的四人', () => {
  it('角色表：透华、纯有能力，智纪、一没有', () => {
    expect(byId('toka').ability?.id).toBe('toka');
    expect(byId('jun').ability?.id).toBe('jun');
    expect(byId('tomoki').ability).toBeNull();
    expect(byId('hajime').ability).toBeNull();
    for (const id of ['toka', 'jun', 'tomoki', 'hajime', 'koromo']) expect(byId(id).school).toBe('龙门渊高中');
  });

  it('治水有自己的一套素材格子：形态动画、立直、和牌', () => {
    const ids = byId('toka').skillArts!.map((k) => k.id);
    expect(ids).toEqual(['chisui', 'chisui-riichi', 'chisui-win']);
    // 进入治水时发的字和形态动画格子的名字一样，素材页换了就放这一段
    expect(byId('toka').skillArts![0].name).toBe('治水');
  });
});

describe('井上纯', () => {
  it('鸣牌以后到她下一次摸牌之前，别人摸牌必定不进张', () => {
    const styles = [byId('jun').ai, byId('izumi').ai, byId('tomoki').ai, byId('hajime').ai];
    let jammed = 0;
    let bad = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const g = game(seed, 0, junAbility);
      let before: Set<number> | null = null;
      let drawer = -1;
      g.onEvent((e) => {
        if (e.type !== 'draw' || e.seat === 0 || before === null || e.seat !== drawer) return;
        const p = g.players[e.seat];
        jammed++;
        if (before.has(kindOf(p.drawn!))) bad++;
      });
      play(g, styles, () => {
        // 下一个摸牌的人这一刻的有效牌（只在纯错开流向时记）
        before = null;
        if (g.phase !== 'turn' || !junJamming(g, 0)) return;
        drawer = (g.turn + 1) % 4;
        if (drawer !== 0) before = usefulKinds(g, drawer);
      });
    }
    expect(jammed).toBeGreaterThan(20);
    expect(bad).toBe(0);
  }, 60_000);

  it('她自己摸牌这一巡就结束，暗杠不算鸣牌', () => {
    const g = game(3, 0, junAbility);
    junAbility.onCall!(g, 0, 0, '暗杠');
    expect(junJamming(g, 0)).toBe(false);
    junAbility.onCall!(g, 0, 1, '碰');
    expect(junJamming(g, 0)).toBe(false);
    junAbility.onCall!(g, 0, 0, '碰');
    expect(junJamming(g, 0)).toBe(true);
    g.rinshanDraw = true;
    junAbility.afterDraw!(g, 0);
    expect(junJamming(g, 0)).toBe(true);
    g.rinshanDraw = false;
    junAbility.afterDraw!(g, 0);
    expect(junJamming(g, 0)).toBe(false);
  });
});

describe('龙门渊透华', () => {
  it('点数变动：一家加一家减只算一次，交出去的立直棒算减', () => {
    const g = game(1, 0, tokaAbility);
    expect(roundMovement(g, result([8000, -8000, 0, 0]))).toBe(8000);
    expect(roundMovement(g, result([-1300, -2600, 5200, -1300]))).toBe(5200);
    g.players[1].riichi = true;
    // 1 号位立直以后 2 号位荣和 3 号位：立直棒还在桌上
    expect(roundMovement(g, result([0, 0, 3900, -3900]))).toBe(4900);
  });

  it('变动超过 10 万点的下一局起治水，一直到终局；平行宇宙清掉', () => {
    const g = game(2, 0, tokaAbility, 'south');
    const st = g.abilityGameState[0] as { moved?: number };
    st.moved = TOKA.threshold - 1000;
    expect(tokaChisui(g, 0)).toBe(false);
    tokaAbility.onRoundEnd!(g, 0, result([12000, -12000, 0, 0]));
    expect(tokaMoved(g, 0)).toBe(TOKA.threshold + 11000);
    // 这一局还不是
    expect(tokaChisui(g, 0)).toBe(false);
    g.round++;
    expect(tokaChisui(g, 0)).toBe(true);
    g.round += 3;
    expect(tokaChisui(g, 0)).toBe(true);
    tokaAbility.resetMarks!(g, 0);
    expect(tokaChisui(g, 0)).toBe(false);
    expect(tokaMoved(g, 0)).toBe(0);
  });

  it('选人页选了治水：开局就是治水，第一局发一次；平行宇宙打回常态', () => {
    const g = new Game({ seed: 4, format: 'east', players: [0, 1, 2, 3].map((i) => ({ name: `p${i}`, ability: i === 2 ? tokaAbility : null, startForm: i === 2 })) });
    expect(g.round).toBe(1);
    expect(tokaChisui(g, 2)).toBe(true);
    expect(g.events.filter((e) => e.type === 'ability' && e.text === '治水').length).toBe(1);
    tokaAbility.resetMarks!(g, 2);
    expect(tokaChisui(g, 2)).toBe(false);
    // 没选的透华开局是常态
    expect(tokaChisui(game(4, 2, tokaAbility), 2)).toBe(false);
  });

  it('治水：别人摸不到会被鸣的牌，手里有对子以后不再成对，换牌不改进不进张', () => {
    const g = game(1, 0, tokaAbility);
    (g.abilityGameState[0] as { at?: number }).at = 0;
    g.round = 1;
    const hand = (kinds: number[]) => kinds.map((k) => k * 4);
    // 0 号位（透华）：一万一对；2 号位：九饼一对，三饼五饼；3 号位：东一对
    g.players[0].hand = hand([0, 0, 4, 8, 12, 16, 20, 24, 28, 31, 32, 33, 30]);
    g.players[2].hand = hand([17, 17, 1, 5, 11, 13, 19, 22, 25, 29, 31, 32, 33]);
    g.players[3].hand = hand([27, 27, 3, 6, 10, 14, 18, 21, 23, 26, 32, 33, 30]);
    // 1 号位：两万一对，其他是单张（没听牌）
    g.players[1].hand = hand([1, 1, 3, 7, 11, 15, 19, 21, 23, 25, 28, 30, 32]);
    for (const p of g.players) {
      p.melds = [];
      p.riichi = false;
    }
    expect(g.waits(1)).toEqual([]);
    // 下一张是一万（透华手里成对，打出去会被碰）
    putOnTop(g, 0);
    const rule = tokaAbility.beforeAnyDraw!(g, 0, 1, false)!;
    expect(rule.deny(g.wall.live[0])).toBe(true);
    // 别人手里的对子（碰）
    for (const k of [0, 17, 27]) expect(rule.deny(k * 4 + 1)).toBe(true);
    // 下家 2 号位能吃的：她有三饼、五饼，四饼不来
    expect(rule.deny(12 * 4 + 1)).toBe(true);
    // 已经有一个对子：手里的单张不再成对
    expect(rule.deny(3 * 4 + 1)).toBe(true);
    // 换上来的牌进不进张照原来那张（一万）
    const useful = usefulKinds(g, 1);
    for (let k = 0; k < 34; k++) if (useful.has(k) !== useful.has(0)) expect(rule.deny(k * 4 + 1)).toBe(true);
    // 谁也鸣不了、也不进张的牌照常能来
    expect([...Array(34).keys()].some((k) => !rule.deny(k * 4 + 1))).toBe(true);
    // 下一张本来就是死牌：不用换
    const dead = [...Array(34).keys()].find((k) => !rule.deny(k * 4 + 1))!;
    putOnTop(g, dead);
    expect(tokaAbility.beforeAnyDraw!(g, 0, 1, false)).toBeFalsy();
    // 岭上牌不管
    expect(tokaAbility.beforeAnyDraw!(g, 0, 1, true)).toBeFalsy();
  });

  it('治水：别人听牌时摸到和了牌的，按 tsumoCut 换走', () => {
    const g = game(1, 0, tokaAbility);
    (g.abilityGameState[0] as { at?: number }).at = 0;
    g.round = 1;
    // 1 号位听五饼单骑：一二三、四五六、七八九万，一二三饼，五饼
    g.players[1].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13].map((k) => k * 4 + 3);
    g.players[1].melds = [];
    expect(g.waits(1)).toEqual([13]);
    // 下一张就是五饼
    putOnTop(g, 13);
    let denied = 0;
    for (let i = 0; i < 400; i++) {
      const rule = tokaAbility.beforeAnyDraw!(g, 0, 1, false);
      if (rule?.deny(g.wall.live[0])) denied++;
    }
    // 治水时牌山里和了牌比平常多（别人摸不走），砍得比一半多，算下来和常态比大约减半
    expect(denied / 400).toBeGreaterThan(TOKA.tsumoCut - 0.08);
    expect(denied / 400).toBeLessThan(TOKA.tsumoCut + 0.08);
    // 自己摸牌不管（她自己的在 beforeDraw 里）
    expect(tokaAbility.beforeAnyDraw!(g, 0, 0, false)).toBeFalsy();
  });
});
