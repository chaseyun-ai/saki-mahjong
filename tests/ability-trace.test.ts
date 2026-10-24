import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game, PlayerConfig } from '../src/engine/game';
import { TileId, doraFromIndicator, isRed, kindOf } from '../src/engine/tiles';
import { Wall } from '../src/engine/wall';
import { AbilityTrace, TraceEntry, traceLine } from '../src/ui/abilityTrace';

// 测试里偷偷记下牌山真正被换过的地方（换到最前面的那张变了才算），拿来和记录员的说法对账
type Swap = { wall: Wall; before: TileId; after: TileId };
const swaps: Swap[] = [];
const origLive = Wall.prototype.bringToLive;
const origRinshan = Wall.prototype.bringToRinshan;

beforeAll(() => {
  Wall.prototype.bringToLive = function (this: Wall, ...args: Parameters<Wall['bringToLive']>) {
    const before = this.live[args[0]];
    const ok = origLive.apply(this, args);
    if (this.live[args[0]] !== before) swaps.push({ wall: this, before, after: this.live[args[0]] });
    return ok;
  };
  Wall.prototype.bringToRinshan = function (this: Wall, ...args: Parameters<Wall['bringToRinshan']>) {
    const before = this.rinshan[0];
    const ok = origRinshan.apply(this, args);
    if (this.rinshan[0] !== before) swaps.push({ wall: this, before, after: this.rinshan[0] });
    return ok;
  };
});

afterAll(() => {
  Wall.prototype.bringToLive = origLive;
  Wall.prototype.bringToRinshan = origRinshan;
});

const withAbilities: PlayerConfig[] = CHARACTERS.map((c) => ({ name: c.name, ability: c.ability }));
const noAbilities: PlayerConfig[] = CHARACTERS.map((c) => ({ name: c.name }));

// 四个电脑打完一整场。trace 为真时挂上记录员，每局结束时收下这一局的记录
function play(seed: number, players = withAbilities, trace = true) {
  const g = new Game({ seed, players });
  const tracer = trace ? new AbilityTrace(g) : null;
  const rounds: { entries: TraceEntry[]; wall: Wall }[] = [];
  const calls: string[][] = [];
  let roundCalls: string[] = [];
  const nearMissChecks: boolean[] = [];
  const checked = new Set<TraceEntry>();
  g.onEvent((e) => {
    if (e.type === 'call') {
      roundCalls.push(e.call);
      // 记录员刚记的“差一点”：那家真的在等这张牌
      for (const x of tracer?.entries ?? []) {
        if (x.kind !== 'nearMiss' || checked.has(x)) continue;
        checked.add(x);
        nearMissChecks.push(g.waits(x.seat).includes(kindOf(x.tile)));
      }
    }
    if (e.type === 'roundEnd') {
      rounds.push({ entries: [...(tracer?.entries ?? [])], wall: g.wall });
      calls.push(roundCalls);
      roundCalls = [];
    }
  });
  let steps = 0;
  while (g.phase !== 'gameEnd') {
    if (++steps > 20000) throw new Error('对局没有结束');
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const seat = g.waitingSeats()[0];
    g.act(seat, chooseAction(g, seat, CHARACTERS[seat].ai));
  }
  return { g, rounds, calls, nearMissChecks };
}

const GAMES = 20;

describe('能力痕迹', () => {
  it('开不开记录员，牌局一模一样', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const a = play(seed, withAbilities, false).g;
      const b = play(seed, withAbilities, true).g;
      expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
      expect(b.players.map((p) => p.score)).toEqual(a.players.map((p) => p.score));
    }
  }, 120000);

  it('记下的每一次换牌，都和牌山真正被换的地方对得上（包括第一局庄家的第一张）', () => {
    let total = 0;
    let firstDraw = 0;
    for (let seed = 1; seed <= GAMES; seed++) {
      swaps.length = 0;
      const { rounds } = play(seed);
      for (const r of rounds) {
        const real = swaps.filter((s) => s.wall === r.wall).map((s) => [s.before, s.after]);
        const told = r.entries.filter((x) => x.kind === 'swap').map((x) => [x.expected, x.got]);
        expect(told).toEqual(real);
        total += told.length;
      }
      const first = rounds[0].entries.find((x) => x.kind === 'swap');
      if (first && first.seat === 0 && first.turn === 1) firstDraw++;
    }
    expect(total).toBeGreaterThan(30);
    expect(firstDraw).toBeGreaterThan(0);
  }, 120000);

  it('松实玄换来的牌都是宝牌，宫永咲的岭上开花换来的都是和了牌', () => {
    let kuro = 0;
    let rinshan = 0;
    // 岭上开花要咲听牌时开杠才会发动，多打几场才碰得到
    for (let seed = 1; seed <= 45; seed++) {
      for (const r of play(seed).rounds) {
        for (const x of r.entries) {
          if (x.kind !== 'swap') continue;
          if (x.ability === 'kuro') {
            kuro++;
            expect(x.text).toBe('宝牌聚集');
            const dora = r.wall.visibleDoraIndicators().map((t) => doraFromIndicator(kindOf(t)));
            expect(isRed(x.got) || dora.includes(kindOf(x.got))).toBe(true);
          }
          if (x.rinshan) {
            rinshan++;
            expect(x.ability).toBe('saki');
            expect(x.text).toBe('岭上开花');
            expect(x.madeWin).toBe(true);
          }
        }
      }
    }
    expect(kuro).toBeGreaterThan(10);
    expect(rinshan).toBeGreaterThan(0);
  }, 120000);

  it('没有能力的对局：不会出现换牌，鸣牌错位和吃、碰、明杠一一对应', () => {
    let shifts = 0;
    for (let seed = 1; seed <= GAMES; seed++) {
      const { rounds, calls } = play(seed, noAbilities);
      rounds.forEach((r, i) => {
        expect(r.entries.filter((x) => x.kind === 'swap' || x.kind === 'note')).toEqual([]);
        const told = r.entries.filter((x) => x.kind === 'shift').map((x) => (x.kind === 'shift' ? x.call : ''));
        expect(told).toEqual(calls[i].filter((c) => ['吃', '碰', '杠'].includes(c)));
        shifts += told.length;
      });
    }
    expect(shifts).toBeGreaterThan(20);
  }, 120000);

  it('鸣牌错位：下一张本来归打牌的下家，现在归鸣牌的下家；中间的人少摸一巡', () => {
    let n = 0;
    let missed = 0;
    for (let seed = 1; seed <= GAMES; seed++) {
      const { rounds, nearMissChecks } = play(seed);
      expect(nearMissChecks.every(Boolean)).toBe(true);
      missed += nearMissChecks.length;
      for (const r of rounds) {
        for (const x of r.entries) {
          if (x.kind !== 'shift') continue;
          n++;
          expect(x.nextWas).toBe((x.from + 1) % 4);
          expect(x.nextNow).toBe((x.seat + 1) % 4);
          expect(x.nextNow).not.toBe(x.nextWas);
          const gap = (x.seat - x.from + 4) % 4;
          expect(x.skipped.length).toBe(gap - 1);
          if (x.call === '吃') expect(x.skipped).toEqual([]);
        }
      }
    }
    expect(n).toBeGreaterThan(20);
    expect(missed).toBeGreaterThan(0);
  }, 120000);

  it('每条记录都能写成一句完整的解说', () => {
    const tags = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      for (const r of play(seed).rounds) {
        for (const x of r.entries) {
          const l = traceLine(x, (s) => CHARACTERS[s].name, (t) => `[${t}]`);
          tags.add(l.tag);
          expect(l.html).not.toMatch(/undefined|null|NaN/);
          expect(l.html.endsWith('。')).toBe(true);
          expect(l.turn).toBeGreaterThan(0);
        }
      }
    }
    expect([...tags].sort()).toEqual(['差一点', '能力', '错位'].sort());
  }, 120000);
});
