import { kuroSeat } from '../src/abilities/doraControl';
import { afterEach, describe, expect, it } from 'vitest';
import { stackAt } from '../src/engine/wall';
import { AWAI, awaiCanUse, awaiDomainOn, awaiEnergy, awaiStarPlan, awaiWaitingForCorner, awaiWaveTiles } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { suzuCounter } from '../src/abilities/suzu';
import { teruLadder } from '../src/abilities/teru';
import { chooseAction } from '../src/ai/ai';
import { nodokaAngel } from '../src/abilities/nodoka';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { doraFromIndicator, kindOf, toCounts } from '../src/engine/tiles';
import { isCornerDraw } from '../src/engine/wall';

const saved = { ...AWAI };
afterEach(() => Object.assign(AWAI, saved));

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const lineup = ['awai', 'saki', 'nodoka', 'kuro'].map(byId);

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

// 淡坐 0 号位、玩家操作（不会自己按技能）。ids 是另外三家
function manualGame(ids: string[], seed = 7) {
  const chars = ['awai', ...ids].map(byId);
  const g = new Game({ seed, players: chars.map((c, i) => ({ name: c.id, ability: c.ability, manual: i === 0 })) });
  return { g, chars };
}

// 电脑替所有人打，直到 stop 为真或者这一局结束
function runUntil(g: Game, chars: { ai: Parameters<typeof chooseAction>[2] }[], stop: () => boolean, max = 400): boolean {
  for (let i = 0; i < max; i++) {
    if (stop()) return true;
    if (g.phase !== 'turn' && g.phase !== 'calls') return false;
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, chars[s].ai));
  }
  return stop();
}

const restart = (g: Game) => (g as unknown as { startRound(): void }).startRound();
const goals = (g: Game, seat: number) => (g.abilityState[seat] as { goals: Record<number, number> }).goals;

describe('大星淡：被动', () => {
  it('时间迟滞：别人的配牌 5–6 向听，挡得住、会支配牌山的人（玄）只压到 3 向听；她自己配牌就听牌', () => {
    let deals = 0;
    let unmet = 0;
    for (let seed = 1; seed <= 12; seed++) {
      play(seed, (g) => {
        const awai = g.players.findIndex((p) => p.name === 'awai');
        const check = () => {
          for (const r of g.dealUnmet) if (r.ability === 'awai') unmet++;
          for (const p of g.players) {
            const sh = shanten(toCounts(p.hand.filter((t) => t !== p.drawn)));
            if (p.seat === awai) {
              expect(sh).toBe(0);
              continue;
            }
            const goal = goals(g, awai)[p.seat];
            // 玄、天使和（挡得住别人的影响）只压到 slowShantenWeak
            const weak = p.name === 'kuro' || (p.name === 'nodoka' && nodokaAngel(g, p.seat));
            expect(goal).toBe(weak ? AWAI.slowShantenWeak : goal >= AWAI.slowShanten ? goal : -1);
            // 天使和有一半的概率挡掉这条规矩（挡掉的不算没满足），不查她的向听
            if (!g.dealUnmet.some((r) => r.ability === 'awai' && r.target === p.seat) && !(p.name === 'nodoka' && weak)) expect(sh).toBeGreaterThanOrEqual(goal);
            deals++;
          }
        };
        // 第一局在挂上监听之前就发完了牌
        check();
        g.onEvent((e) => {
          if (e.type === 'roundStart') check();
        });
      });
    }
    console.log({ deals, unmet });
    expect(deals).toBeGreaterThan(100);
    expect(unmet).toBeLessThan(deals * 0.05);
  }, 120000);

  it('命运支配：双立直以后在第 2 个转角前暗杠，杠里指向她杠的牌，下一张自摸；永远不天和、地和', () => {
    let kans = 0;
    let wins = 0;
    let uraHits = 0;
    let kuroWins = 0;
    let tenhou = 0;
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
          if (e.type === 'roundEnd') {
            const w = e.result.wins.find((x) => x.seat === awai);
            if (w?.result.yaku.some((y) => y.name === '天和' || y.name === '地和')) tenhou++;
            if (kanKind >= 0 && w && w.from === null) {
              const hit = w.uraIndicators.some((i) => doraFromIndicator(kindOf(i)) === kanKind);
              // 玄的能力还在：谁都中不了里宝牌，淡的杠里也一样
              if (kuroSeat(g) !== null) {
                kuroWins++;
                expect(w.result.ura).toBe(0);
                return;
              }
              wins++;
              if (hit) uraHits++;
            }
          }
        });
      });
    }
    console.log({ kans, wins, kuroWins, uraHits, tenhou });
    expect(tenhou).toBe(0);
    expect(kans).toBeGreaterThan(10);
    // 杠完以后被别人和掉、被流局，都有可能；但大多数时候她会自摸，而且玄的能力不在时里宝牌就是杠的那张
    expect(wins + kuroWins).toBeGreaterThan(kans * 0.6);
    expect(uraHits).toBeGreaterThan(wins * 0.9);
  }, 120000);

  it('转角的第四张放在开局后摸牌经过的第 2 个转角前（来不及时退到第 1 个）', () => {
    let checked = 0;
    let second = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { g } = manualGame(['saki', 'nodoka', 'mako'], seed);
      const corner = (g.abilityState[0] as { corner?: number }).corner;
      if (corner === undefined) continue;
      const sum = g.dice[0] + g.dice[1];
      const d = g.wall.frontDrawn + g.wall.live.indexOf(corner);
      const corners: number[] = [];
      for (let x = 52; x <= 121; x++) if (isCornerDraw(g.dealer, sum, x)) corners.push(x);
      // 转角前 4 张以内
      const near = corners.findIndex((c) => d <= c && d > c - 4);
      expect(near === 0 || near === 1).toBe(true);
      if (near === 1) second++;
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    expect(second).toBeGreaterThan(checked * 0.6);
  });

  it('第一张没立直：不留转角暗杠，第四张解锁', () => {
    const { g, chars } = manualGame(['saki', 'nodoka', 'mako'], 3);
    expect(awaiWaitingForCorner(g, 0)).not.toBeNull();
    const corner = (g.abilityState[0] as { corner?: number }).corner!;
    runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0);
    const discard = g.legalActions(0).find((a) => a.type === 'discard' && !a.riichi)!;
    g.act(0, discard);
    expect(awaiWaitingForCorner(g, 0)).toBeNull();
    expect(g.wall.locked.ownersOf(corner)).not.toContain('awai');
  });
});

describe('大星淡：星空能量', () => {
  it('开局 100 点，每局回复 5 点，不超过 100；按技能扣能量，每样一局一次', () => {
    const { g, chars } = manualGame(['saki', 'nodoka', 'mako']);
    expect(awaiEnergy(g, 0)).toBe(100);
    runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0);
    g.abilities[0]!.pressSkill!(g, 0, 'domain');
    expect(awaiEnergy(g, 0)).toBe(80);
    expect(awaiCanUse(g, 0, 'domain')).toBe(false);
    g.abilities[0]!.pressSkill!(g, 0, 'domain');
    expect(awaiEnergy(g, 0)).toBe(80);
    restart(g);
    expect(awaiEnergy(g, 0)).toBe(85);
    expect(awaiCanUse(g, 0, 'domain')).toBe(true);
    restart(g);
    restart(g);
    restart(g);
    restart(g);
    expect(awaiEnergy(g, 0)).toBe(100);
    (g.abilityGameState[0] as { energy: number }).energy = 15;
    expect(awaiCanUse(g, 0, 'parallel')).toBe(false);
    expect(awaiCanUse(g, 0, 'decohere')).toBe(true);
  });
});

describe('大星淡：主动技能', () => {
  it('退相干：没听牌时下一张必定进张；听牌时必定自摸', () => {
    let improved = 0;
    let tsumo = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { g, chars } = manualGame(['saki', 'nodoka', 'mako'], seed);
      // 不听牌的情况：把她的手牌打乱（直接换掉立直的念头），按完退相干看下一张
      runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0);
      g.abilities[0]!.pressSkill!(g, 0, 'decohere');
      const p = g.players[0];
      // 打一张让手牌退听，下一次摸牌应该进张
      const counts = toCounts(p.hand);
      const back = g.legalActions(0).find((a) => {
        if (a.type !== 'discard' || a.riichi) return false;
        counts[kindOf(a.tile)]--;
        const sh = shanten(counts);
        counts[kindOf(a.tile)]++;
        return sh === 1;
      });
      if (!back || back.type !== 'discard') continue;
      g.act(0, back);
      const before = shanten(toCounts(p.hand));
      if (!runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0 && p.drawn !== null)) continue;
      expect(shanten(toCounts(p.hand))).toBeLessThan(before);
      improved++;
      // 现在听牌了：再按一次（下一局才能再按，这里直接清掉记录）
      (g.abilityState[0] as { used: string[] }).used = [];
      g.abilities[0]!.pressSkill!(g, 0, 'decohere');
      const keep = g.legalActions(0).find((a) => a.type === 'discard' && !a.riichi && shanten(toCounts(p.hand.filter((t) => t !== a.tile))) === 0);
      if (!keep) continue;
      g.act(0, keep);
      // 和了牌全在别人手里、牌河里时（王牌里也没有）没得摸
      const w = g.waits(0);
      const hidden = [...g.wall.live, ...g.wall.rinshan, ...g.wall.uraIndicators].filter((t) => w.includes(kindOf(t))).length;
      if (!hidden || !runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0 && p.drawn !== null)) continue;
      expect(g.legalActions(0).some((a) => a.type === 'tsumo')).toBe(true);
      tsumo++;
    }
    console.log({ improved, tsumo });
    expect(improved).toBeGreaterThan(4);
    expect(tsumo).toBeGreaterThan(3);
  });

  it('星符汇聚：只能在打出第一张牌前按；之后每次摸牌都是大七星还缺的字牌', () => {
    const { g, chars } = manualGame(['saki', 'nodoka', 'mako'], 11);
    runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0);
    expect(awaiCanUse(g, 0, 'stars')).toBe(true);
    g.abilities[0]!.pressSkill!(g, 0, 'stars');
    expect(awaiStarPlan(g, 0)).toBe(true);
    expect(awaiWaitingForCorner(g, 0)).toBeNull();
    const p = g.players[0];
    const honorPairs = () => {
      const c = toCounts(p.hand);
      return [27, 28, 29, 30, 31, 32, 33].reduce((n, k) => n + Math.min(2, c[k]), 0);
    };
    let draws = 0;
    for (let i = 0; i < 12 && g.phase !== 'roundEnd'; i++) {
      // 电脑替她打：先打数牌
      g.act(0, chooseAction(g, 0, chars[0].ai));
      const before = honorPairs();
      if (!runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0 && p.drawn !== null)) break;
      if (before < 14) expect(honorPairs()).toBe(before + 1);
      draws++;
    }
    console.log({ draws, honors: honorPairs() });
    expect(draws).toBeGreaterThan(5);
  });

  it('星符汇聚：打出第一张牌以后按不了', () => {
    const { g, chars } = manualGame(['saki', 'nodoka', 'mako'], 11);
    runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0);
    g.act(0, g.legalActions(0).find((a) => a.type === 'discard' && !a.riichi)!);
    expect(awaiCanUse(g, 0, 'stars')).toBe(false);
  });

  it('高维领域：别人控牌山的能力失效（玄照样），黑暗笼罩牌桌', () => {
    const { g, chars } = manualGame(['saki', 'kuro', 'koromo']);
    runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0);
    expect(g.quelled(1)).toBe(false);
    g.abilities[0]!.pressSkill!(g, 0, 'domain');
    expect(awaiDomainOn(g)).toBe(true);
    expect(g.quelled(1)).toBe(true);
    expect(g.quelled(3)).toBe(true);
    expect(g.quelled(2)).toBe(false); // 玄是作者钦定
    expect(g.quelled(0)).toBe(false);
    expect(g.rulesBind(3, 1)).toBe(false);
    // 只压牌山：不许和牌（七姐妹）、封印这些照样管得到
    expect(g.binds(3, 1)).toBe(true);
    restart(g);
    expect(awaiDomainOn(g)).toBe(false);
    expect(g.quelled(1)).toBe(false);
  });

  it('引力波：听牌后才能按，亮出牌山里所有和了牌', () => {
    const { g, chars } = manualGame(['saki', 'nodoka', 'mako']);
    runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0);
    expect(awaiCanUse(g, 0, 'wave')).toBe(true);
    g.abilities[0]!.pressSkill!(g, 0, 'wave');
    const p = g.players[0];
    const waits = shanten(toCounts(p.hand.filter((t) => t !== p.drawn))) === 0 ? g.legalActions(0) : [];
    expect(waits.length).toBeGreaterThan(0);
    g.act(0, g.legalActions(0).find((a) => a.type === 'discard' && a.tile === p.drawn)!);
    const w = g.waits(0);
    expect(w.length).toBeGreaterThan(0);
    const lit = awaiWaveTiles(g, 0);
    expect([...lit].every((t) => w.includes(kindOf(t)))).toBe(true);
    expect(lit.size).toBe(g.wall.live.filter((t) => w.includes(kindOf(t))).length);
  });

  it('平行宇宙：照的连续和了、漫的计数器清零，牌山重洗，扣 30', () => {
    const { g, chars } = manualGame(['teru', 'suzu', 'nodoka']);
    runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0);
    (g.abilityGameState[1] as { level: number }).level = 4;
    (g.abilityGameState[2] as { counter: number }).counter = 7;
    const before = [...g.wall.live];
    g.abilities[0]!.pressSkill!(g, 0, 'parallel');
    expect(teruLadder(g, 1).level).toBe(0);
    expect(suzuCounter(g, 2)).toBe(0);
    expect(awaiEnergy(g, 0)).toBe(70);
    expect([...g.wall.live].sort((a, b) => a - b)).toEqual([...before].sort((a, b) => a - b));
    expect(g.wall.live).not.toEqual(before);
  });

  it('加速驱动：另外三家摸进她的铳牌（牌山里还有就一定是），她能摸到的最后一张留着和了牌', () => {
    let hits = 0;
    let leaks = 0;
    let kept = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { g, chars } = manualGame(['saki', 'nodoka', 'mako'], seed);
      runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0);
      // 不双立直（不然要等转角），打一张保持听牌
      const p = g.players[0];
      const keep = g.legalActions(0).find((a) => a.type === 'discard' && !a.riichi && shanten(toCounts(p.hand.filter((t) => t !== a.tile))) === 0);
      if (!keep) continue;
      g.abilities[0]!.pressSkill!(g, 0, 'accel');
      g.act(0, keep);
      let n = 0;
      let left = 0;
      g.onEvent((e) => {
        if (e.type === 'discard' || e.type === 'call') {
          const w = g.waits(0);
          left = g.wall.live.filter((t) => w.includes(kindOf(t)) && !g.wall.locked.has(t)).length;
        }
        if (e.type !== 'draw' || e.seat === 0 || g.rinshanDraw) return;
        n++;
        const w = g.waits(0);
        if (w.includes(kindOf(g.players[e.seat].drawn!))) hits++;
        else if (left > 0) leaks++;
      });
      runUntil(g, chars, () => n >= 9 || g.phase === 'roundEnd', 200);
      const last = (g.abilityState[0] as { last?: number }).last;
      if (last !== undefined && g.wall.live.includes(last)) {
        expect(g.waits(0)).toContain(kindOf(last));
        kept++;
      }
    }
    console.log({ hits, leaks, kept });
    expect(hits).toBeGreaterThan(5);
    expect(leaks).toBe(0);
    expect(kept).toBeGreaterThan(2);
  });

  it('巨引力源：引力圆只罩住每边中间 7 墩，摸到圆里的牌时别人控牌山的能力失效、她没听牌必定进张', () => {
    const { g, chars } = manualGame(['saki', 'nodoka', 'koromo'], 5);
    runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0);
    g.abilities[0]!.pressSkill!(g, 0, 'source');
    // 不在摸牌的时候不算
    expect(g.quelled(1)).toBe(false);
    // 第 d 张摸到的牌在不在圆里：每边 17 墩里的第 6–12 墩
    const covered = (d: number) => Math.abs(stackAt(g.dealer, g.dice[0] + g.dice[1], Math.floor(d / 2)).stack - 9) <= AWAI.sourceSpan;
    // 咲摸牌前整理牌山的能力：圆里的那几张一次都不该动
    const called = new Set<number>();
    const before = g.abilities[1]!.beforeAnyDraw;
    g.abilities[1]!.beforeAnyDraw = (gg, seat, drawer, rinshan) => {
      if (!rinshan) called.add(gg.wall.frontDrawn);
      return before?.call(g.abilities[1], gg, seat, drawer, rinshan);
    };
    let inside = 0;
    let outside = 0;
    let quelledDraws = 0;
    g.onEvent((e) => {
      if (e.type !== 'draw' || g.rinshanDraw) return;
      const d = g.wall.frontDrawn - 1;
      if (covered(d)) {
        quelledDraws++;
        expect(called.has(d)).toBe(false);
      } else expect(called.has(d)).toBe(true);
    });
    const p = g.players[0];
    for (let i = 0; i < 12; i++) {
      // 打成一向听
      const back = g.legalActions(0).find((a) => a.type === 'discard' && !a.riichi && shanten(toCounts(p.hand.filter((t) => t !== a.tile))) >= 1);
      if (!back) break;
      g.act(0, back);
      const sh = shanten(toCounts(p.hand));
      if (!runUntil(g, chars, () => g.phase === 'turn' && g.turn === 0 && p.drawn !== null)) break;
      if (g.rinshanDraw) continue;
      if (covered(g.wall.frontDrawn - 1)) {
        inside++;
        expect(shanten(toCounts(p.hand))).toBeLessThan(sh);
      } else outside++;
    }
    console.log({ inside, outside, quelledDraws });
    expect(inside).toBeGreaterThan(1);
    expect(outside).toBeGreaterThan(0);
    expect(quelledDraws).toBeGreaterThan(3);
  });
});
