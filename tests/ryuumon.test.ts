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
    expect(g.legalActions(g.turn).some((a) => a.type === 'ankan' || a.type === 'kakan')).toBe(false);
    tokaAbility.resetMarks!(g, 2);
    expect(tokaChisui(g, 2)).toBe(false);
    // 没选的透华开局是常态
    expect(tokaChisui(game(4, 2, tokaAbility), 2)).toBe(false);
  });

  it('治水的局谁也吃、碰、杠不了，进入时发一次治水', () => {
    let rounds = 0;
    let chisuiEvents = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = new Game({ seed, format: 'east', players: ['toka', 'jun', 'saki', 'ako'].map((id) => ({ name: id, ability: byId(id).ability })) });
      // 一开局就过了门槛
      (g.abilityGameState[0] as { at?: number }).at = 0;
      g.onEvent((e) => {
        if (e.type === 'ability' && e.text === '治水') chisuiEvents++;
        if (e.type === 'roundEnd') rounds++;
      });
      const styles = ['toka', 'jun', 'saki', 'ako'].map((id) => byId(id).ai);
      play(g, styles, () => {
        if (!tokaChisui(g, 0)) return;
        for (const s of [0, 1, 2, 3]) {
          const calls = g.legalActions(s).filter((a) => ['chi', 'pon', 'daiminkan', 'ankan', 'kakan'].includes(a.type));
          expect(calls).toEqual([]);
        }
      });
    }
    expect(rounds).toBeGreaterThan(20);
    // 第一局开局时 at 还没设：之后第一局发一次
    expect(chisuiEvents).toBeLessThanOrEqual(6);
  }, 60_000);

  it('治水：别人听牌时有一半的概率摸不到和了牌', () => {
    const g = game(1, 0, tokaAbility);
    (g.abilityGameState[0] as { at?: number }).at = 0;
    g.round = 1;
    // 1 号位听五饼单骑：一二三、四五六、七八九万，一二三饼，五饼
    g.players[1].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13].map((k) => k * 4 + 3);
    g.players[1].melds = [];
    expect(g.waits(1)).toEqual([13]);
    let denied = 0;
    for (let i = 0; i < 400; i++) {
      const rule = tokaAbility.beforeAnyDraw!(g, 0, 1, false);
      if (!rule) continue;
      denied++;
      expect(rule.deny(13 * 4)).toBe(true);
      expect(rule.deny(12 * 4)).toBe(false);
    }
    expect(denied / 400).toBeGreaterThan(0.4);
    expect(denied / 400).toBeLessThan(0.6);
    // 自己摸牌、别人没听牌都不管
    expect(tokaAbility.beforeAnyDraw!(g, 0, 0, false)).toBeFalsy();
    expect(tokaAbility.beforeAnyDraw!(g, 0, 2, false)).toBeFalsy();
  });
});
