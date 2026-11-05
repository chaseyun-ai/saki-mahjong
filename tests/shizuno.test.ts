import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { settleUra, tilesOf } from '../src/abilities/doraControl';
import { SHIZUNO, shizunoAbility, shizunoDora, shizunoMarks, shizunoMist, shizunoPower } from '../src/abilities/shizuno';
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
  it('4 费；东一局 0 个，之后每开一局（本场也算）加一个深山标记，6 个起控制宝牌、起雾，之后每两个厚一级', () => {
    expect(byId('shizuno').cost).toBe(4);
    const g = newGame(1, PLAIN);
    const seen: number[] = [];
    play(g, PLAIN, () => seen.push(shizunoMarks(g, 0)));
    // 东一局还是 0 个，之后每一局加一
    expect(seen[0]).toBe(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i] - seen[i - 1]).toBe(1);

    const at = (round: number) => {
      g.round = round;
      return { power: shizunoPower(g, 0), dora: shizunoDora(g, 0), mist: shizunoMist(g, 0) };
    };
    const phase = g.phase;
    (g as { phase: string }).phase = 'turn';
    expect(at(2).power).toBeCloseTo(0.05);
    expect(at(6)).toEqual({ power: expect.closeTo(0.25), dora: false, mist: 0 });
    expect(at(7).mist).toBe(1);
    expect(at(8).mist).toBe(1);
    expect(at(9).mist).toBe(2);
    expect(at(11).mist).toBe(3);
    expect(at(13).mist).toBe(4);
    expect(at(21)).toEqual({ power: SHIZUNO.cap, dora: true, mist: 4 });
    (g as { phase: string }).phase = phase;
  }, 60000);

  it('淡的平行宇宙清空深山标记，这一局也不算，下一局从 1 个重新数', () => {
    const g = newGame(2, PLAIN);
    g.round = 10;
    expect(shizunoMarks(g, 0)).toBe(9);
    shizunoAbility.resetMarks(g, 0);
    expect(shizunoMarks(g, 0)).toBe(0);
    expect(shizunoPower(g, 0)).toBe(0);
    expect(shizunoMist(g, 0)).toBe(0);
    g.round = 11;
    expect(shizunoMarks(g, 0)).toBe(1);
  });

  it('别人的能力按标记数的概率不起作用；玄、照不受影响', () => {
    const g = newGame(3, ['shizuno', 'awai', 'kuro', 'teru']);
    g.round = 9; // 8 个标记：40%
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
        if (!shizunoDora(g, 0)) return;
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
    // 10 场太少，随机数稍有变化就翻过来；30 场稳定
    for (let seed = 1; seed <= 30; seed++) {
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

describe('深山削弱别人的能力不会弄坏别人的状态', () => {
  // 削弱的概率拉满：别人每次发动都不起作用，能力自己的状态（衣的月相、涅莉的运势、淡的能量……）照样走下去
  const full = { ...shizunoAbility, id: 'shizuno', dampens: () => 1 };
  const groups = [
    ['koromo', 'nelly', 'awai'],
    ['sawaya', 'kasumi', 'toyone'],
    ['komaki', 'suzu', 'rii'],
    ['saki', 'himeko', 'teru'],
  ];
  it('别人的配牌、摸牌能力全被削弱时整场打得完', () => {
    for (const [i, ids] of groups.entries()) {
      for (let seed = 1; seed <= 3; seed++) {
        const all = ['shizuno', ...ids];
        const g = new Game({ seed: seed * 10 + i, format: 'east', players: all.map((id, s) => ({ name: id, ability: s === 0 ? full : byId(id).ability })) });
        let steps = 0;
        while (g.phase !== 'gameEnd' && ++steps < 20000) {
          if (g.phase === 'roundEnd') {
            g.nextRound();
            continue;
          }
          const s = g.waitingSeats()[0];
          g.act(s, chooseAction(g, s, byId(all[s]).ai));
        }
        expect(g.phase).toBe('gameEnd');
        expect(g.wall.allTiles().length + g.players.reduce((n, p) => n + p.hand.length + p.melds.reduce((m, x) => m + x.tiles.length, 0) + p.discards.filter((d) => !d.called).length, 0)).toBe(136);
      }
    }
  }, 120000);
});

// 一开局就让稳乃有 12 个深山标记（雾 4 级）：平行宇宙清空时记的那一局往前挪
function deepMist(g: Game, seat: number, marks = 12) {
  (g.abilityGameState[seat] as { reset?: number }).reset = g.round - marks;
}

describe('高鸭稳乃：起雾以后干扰别人', () => {
  // 雾 L 级要几个标记：6 个 1 级，之后每 2 个一级
  const marksFor = (L: number) => SHIZUNO.doraAt + (L - 1) * SHIZUNO.mistStep;

  it('淡的杠里：不受影响中四张（暗刻那种），雾 2 级最多中 2 张、3 级最多 1 张、4 级一张也不中', () => {
    let checked = 0;
    for (const [L, cap] of [[2, 2], [3, 1], [4, 0]]) {
      for (let seed = 1; seed <= 12; seed++) {
        const ids = ['shizuno', 'awai', 'izumi', 'izumi'];
        const g = newGame(seed, ids);
        deepMist(g, 0, marksFor(L));
        expect(shizunoMist(g, 0)).toBe(L);
        const kan = (g.abilityState[1] as { kanKind?: number }).kanKind;
        if (kan === undefined) continue;
        // 当成淡已经暗杠、杠里指示牌是第 1 张里宝牌，立直自摸
        (g.abilityState[1] as { kanUra?: number }).kanUra = 0;
        g.players[1].riichi = true;
        g.wall.bringToUra(0, (t) => doraFromIndicator(kindOf(t)) === kan, g.rng);
        const theirs = toCounts(tilesOf(g, 1));
        expect(theirs[kan]).toBeGreaterThan(cap);
        settleUra(g, [1]);
        expect(theirs[doraFromIndicator(kindOf(g.wall.uraIndicators[0]))]).toBeLessThanOrEqual(cap);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('别家立直和牌：雾 4 级时里宝牌几乎都避开和牌那家的牌', () => {
    let n = 0;
    let clean = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = newGame(seed, PLAIN);
      deepMist(g, 0);
      g.players[2].riichi = true;
      settleUra(g, [2]);
      n++;
      if (toCounts(tilesOf(g, 2))[doraFromIndicator(kindOf(g.wall.uraIndicators[0]))] === 0) clean++;
    }
    expect(clean / n).toBeGreaterThan(0.85);
  });

  it('衣：雾 4 级时海底一定被遮住，一次海底捞月也和不到', () => {
    const ids = ['shizuno', 'koromo', 'izumi', 'izumi'];
    let fogged = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = newGame(seed, ids);
      deepMist(g, 0);
      g.onEvent((e) => {
        if (e.type === 'ability' && e.seat === 1) expect(e.text).not.toBe('海底捞月');
        if (e.type === 'roundEnd' && (g.abilityState[1] as { fogged?: boolean }).fogged) fogged++;
      });
      play(g, ids);
    }
    expect(fogged).toBeGreaterThan(0);
  }, 240000);

  it('姬子拿钥匙的那一局：雾 4 级时照样自摸，只是晚了 4 巡以上', () => {
    const ids = ['himeko', 'shizuno', 'izumi', 'izumi'];
    for (let seed = 1; seed <= 6; seed++) {
      const g = new Game({ seed, format: 'east', keys: [[{ label: '东1局 0本场', round: 1, bind: 3, broken: false }], [], [], []], players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });
      deepMist(g, 1);
      let steps = 0;
      while (g.phase !== 'roundEnd' && ++steps < 5000) {
        const s = g.waitingSeats()[0];
        g.act(s, chooseAction(g, s, byId(ids[s]).ai));
      }
      const win = g.roundResult!.wins.find((w) => w.seat === 0);
      expect(win?.from).toBeNull();
      expect(g.players[0].discards.length).toBeGreaterThanOrEqual(4);
    }
  }, 60000);
});
