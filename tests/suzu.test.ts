import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { SUZU, isHigh, suzuBurst, suzuCounter } from '../src/abilities/suzu';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { kindOf } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
// 三个 3 费以上：每局加三，第 4 局爆发
const STRONG = ['suzu', 'teru', 'koromo', 'awai'];
// 三个 3 费以上、都不控别人摸牌的
const MILD = ['suzu', 'sera', 'hisa', 'mihoko'];

function newGame(seed: number, ids: string[], format: 'east' | 'south' = 'south') {
  return new Game({ seed, format, players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });
}

// 每一局开局时：第几局（东一是 0）、本场、爆发状态、计数器、发完牌她的手牌
interface Snap {
  slot: number;
  honba: number;
  burst: 'full' | 'weak' | null;
  counter: number;
  hand: number[];
}

function run(g: Game, ids: string[], me: number, draws?: { burst: boolean; high: boolean }[]) {
  const snaps: Snap[] = [];
  const snap = (slot: number) => snaps.push({ slot, honba: g.honba, burst: suzuBurst(g, me), counter: suzuCounter(g, me), hand: g.players[me].hand.slice() });
  // 第一局在建好牌局时就开了；只看配牌，庄家第一张摸牌不算
  const first = g.players[me].hand.slice(0, 13);
  snap(0);
  snaps[0].hand = first;
  g.onEvent((e) => {
    if (e.type === 'roundStart') snap(e.slot ?? -1);
    if (draws && e.type === 'draw' && e.seat === me) {
      const t = g.players[me].drawn;
      if (t !== null) draws.push({ burst: !!suzuBurst(g, me), high: isHigh(kindOf(t)) });
    }
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
  return snaps;
}

describe('上重漫', () => {
  it('3 费；每一局（连庄不算）加上强敌数，超过 9 爆发并清零', () => {
    expect(byId('suzu').cost).toBe(3);
    for (let seed = 1; seed <= 6; seed++) {
      const snaps = run(newGame(seed, STRONG), STRONG, 0);
      // 自己按规则重算一遍
      let counter = 0;
      let burst = false;
      let prev = -1;
      for (const s of snaps) {
        if (s.slot !== prev) {
          counter += 3;
          if (counter > SUZU.trigger) {
            counter = 0;
            burst = true;
          }
        }
        prev = s.slot;
        expect(s.counter).toBe(counter);
        expect(!!s.burst).toBe(burst);
      }
      // 第 4 个不同的局开始爆发
      const fourth = snaps.findIndex((_, i) => new Set(snaps.slice(0, i + 1).map((x) => x.slot)).size === 4);
      if (fourth >= 0) {
        expect(snaps[fourth].burst).toBe('full');
        if (fourth > 0) expect(snaps[fourth - 1].burst).toBeNull();
      }
    }
  }, 60000);

  it('没有强敌就一直不爆发', () => {
    const ids = ['suzu', 'mako', 'ako', 'izumi'];
    const snaps = run(newGame(3, ids), ids, 0);
    expect(snaps.every((s) => s.burst === null && s.counter === 0)).toBe(true);
  });

  it('爆发中配牌、摸牌明显偏向 6–9；和一次以后减弱', () => {
    let dealHigh = [0, 0];
    let dealAll = [0, 0];
    const draws: { burst: boolean; high: boolean }[] = [];
    let weakSeen = false;
    for (let seed = 1; seed <= 15; seed++) {
      const snaps = run(newGame(seed, MILD), MILD, 0, draws);
      for (const s of snaps) {
        const b = s.burst === 'full' ? 1 : s.burst === null ? 0 : -1;
        if (b < 0) {
          weakSeen = true;
          continue;
        }
        dealHigh[b] += s.hand.filter((t) => isHigh(kindOf(t))).length;
        dealAll[b] += s.hand.length;
      }
    }
    const dealRate = dealHigh.map((h, i) => h / dealAll[i]);
    const on = draws.filter((d) => d.burst);
    const off = draws.filter((d) => !d.burst);
    const drawOn = on.filter((d) => d.high).length / on.length;
    const drawOff = off.filter((d) => d.high).length / off.length;
    // 不爆发时 6–9 大约 4/9 × 27/34 ≈ 35%
    expect(dealRate[0]).toBeLessThan(0.4);
    expect(dealRate[1]).toBeGreaterThan(dealRate[0] + 0.1);
    expect(drawOn).toBeGreaterThan(drawOff + 0.15);
    expect(weakSeen).toBe(true);
  }, 120000);
});
