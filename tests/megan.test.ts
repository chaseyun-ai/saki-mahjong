import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { HIROKO_NOTES } from '../src/abilities/hiroko';
import { MEGAN, duelledBy, meganAbility, meganBlind, meganBlindsLeft, meganCanBlind, meganCertainYaku, meganDuel, meganDuelEnd, meganDuelTarget, meganSenses } from '../src/abilities/megan';
import { chooseAction } from '../src/ai/ai';
import { Game, type GameEvent } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { kindOf, parseKinds, toCounts, type TileId } from '../src/engine/tiles';
import { SCHOOLS } from '../src/ui/schools';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const newGame = (seed: number, ids: string[], manual = -1) =>
  new Game({ seed, format: 'south', players: ids.map((id, i) => ({ name: id, ability: byId(id).ability, manual: i === manual })) });

const defaults = { ...MEGAN, duel: [...MEGAN.duel] };
afterEach(() => Object.assign(MEGAN, defaults, { duel: [...defaults.duel] }));

// 把这一家的手牌换成指定的牌：缺的从牌山、王牌、还没摆过牌的人手里换（不凭空造牌），张数要和现在的手牌一样
const fixed = new WeakMap<Game, Set<number>>();
function setHand(g: Game, seat: number, s: string): boolean {
  const want = parseKinds(s);
  const p = g.players[seat];
  expect(want.length).toBe(p.hand.length);
  const done = fixed.get(g) ?? new Set<number>();
  fixed.set(g, done);
  done.add(seat);
  const rest = [...p.hand];
  const keep: TileId[] = [];
  const need: number[] = [];
  for (const k of want) {
    const i = rest.findIndex((t) => kindOf(t) === k);
    if (i >= 0) keep.push(rest.splice(i, 1)[0]);
    else need.push(k);
  }
  const sources = [g.wall.live, g.wall.rinshan, g.wall.uraIndicators, ...g.players.filter((q) => !done.has(q.seat)).map((q) => q.hand)];
  for (const k of need) {
    const src = sources.find((a) => a.some((t) => kindOf(t) === k));
    // 四张都已经打出去、翻出来了：这个种子摆不出来
    if (!src) return false;
    const j = src.findIndex((t) => kindOf(t) === k);
    keep.push(src[j]);
    src[j] = rest.pop()!;
  }
  p.hand = keep;
  if (p.drawn !== null) p.drawn = keep[keep.length - 1];
  return true;
}

const step = (g: Game, ids: string[]) => {
  const s = g.waitingSeats()[0];
  g.act(s, chooseAction(g, s, byId(ids[s]).ai));
};

// 电脑打到轮到 seat 出牌（摸完牌）为止。这一局先结束了返回 false
function until(g: Game, ids: string[], seat: number): boolean {
  let n = 0;
  while (!(g.phase === 'turn' && g.turn === seat && g.players[seat].drawn !== null)) {
    if (g.phase === 'roundEnd' || g.phase === 'gameEnd' || ++n > 400) return false;
    step(g, ids);
  }
  return true;
}

// 梅根（座位 0）听 2s、5s、8s，摸着一张东风；others 是另外三家的手牌（不给的不动）
const MEGAN_HAND = '234m456p34567s22z1z';
const TENPAI_69S = '456m789m123p66z78s';
const TENPAI_14P = '123m456m789m23p33z';
const JUNK = '1379m1379p1379s5z';
const JUNK_B = '2468m2468p2468s7z';
// 梅根算玩家操作的座位（电脑的她坐庄时会自己伏牌，伏牌的局不决斗）
function setup(seed: number, ids: string[], others: string[]): Game | null {
  const g = newGame(seed, ids, 0);
  if (!until(g, ids, 0)) return null;
  if (!setHand(g, 0, MEGAN_HAND)) return null;
  for (const [i, h] of others.entries()) if (!setHand(g, i + 1, h)) return null;
  return g;
}

const riichiEast = (g: Game) => {
  const a = g.legalActions(0).find((x) => x.type === 'discard' && x.riichi && kindOf(x.tile) === 27);
  expect(a).toBeTruthy();
  g.act(0, a!);
};

describe('梅根·达文：登记', () => {
  it('3 费，在临海女子的名单里，浩子的资料本里有她', () => {
    expect(byId('megan').cost).toBe(3);
    expect(SCHOOLS.find((s) => s.name === '临海女子')!.lineup).toEqual(['satoha', 'huiyu', 'myeonghwa', 'megan', 'nelly']);
    expect(HIROKO_NOTES.megan).toBeTruthy();
  });
});

describe('梅根·达文：感知', () => {
  it('只在她自己听牌时看得出谁听牌；没听牌时什么也看不出', () => {
    const ids = ['megan', 'izumi', 'izumi', 'izumi'];
    const g = setup(3, ids, [JUNK, TENPAI_69S, JUNK_B])!;
    expect(meganSenses(g, 0)).toEqual([2]);
    expect(meganDuelTarget(g, 0)).toBe(2);
    // 她自己没听牌
    setHand(g, 0, '1379m1379p1379s15z');
    expect(meganSenses(g, 0)).toEqual([]);
    expect(meganDuelTarget(g, 0)).toBeNull();
  });

  it('默听的智叶感知不到；两家听牌、管不到的照都不能决斗', () => {
    let ids = ['megan', 'izumi', 'satoha', 'izumi'];
    let g = setup(5, ids, [JUNK, TENPAI_69S, JUNK_B])!;
    expect(g.tenpaiHidden(2, 0)).toBe(true);
    expect(meganSenses(g, 0)).toEqual([]);

    ids = ['megan', 'izumi', 'izumi', 'izumi'];
    g = setup(5, ids, [TENPAI_14P, TENPAI_69S, JUNK])!;
    expect(meganSenses(g, 0)).toEqual([1, 2]);
    expect(meganDuelTarget(g, 0)).toBeNull();
    riichiEast(g);
    expect(meganDuel(g, 0)).toBeNull();

    ids = ['megan', 'izumi', 'teru', 'izumi'];
    g = setup(5, ids, [JUNK, TENPAI_69S, JUNK_B])!;
    expect(meganSenses(g, 0)).toEqual([2]);
    expect(meganDuelTarget(g, 0)).toBeNull();
    riichiEast(g);
    expect(meganDuel(g, 0)).toBeNull();
  });
});

describe('梅根·达文：决斗', () => {
  it('正好一家听牌时立直就是决斗；子弹上膛时对方摸到她的和了牌，立直的对方只能打出来', () => {
    const ids = ['megan', 'izumi', 'izumi', 'izumi'];
    let hits = 0;
    let tried = 0;
    for (let seed = 1; seed <= 10; seed++) {
      MEGAN.duel = [1, 1, 1];
      const g = setup(seed, ids, [JUNK, TENPAI_69S, JUNK_B]);
      if (!g) continue;
      const events: GameEvent[] = [];
      g.onEvent((e) => events.push(e));
      riichiEast(g);
      // 立直宣言牌被人和了、碰了的不算
      if ((g.phase as string) === 'roundEnd' || !meganDuel(g, 0)) continue;
      expect(meganDuel(g, 0)).toEqual({ target: 2, left: 3 });
      expect(duelledBy(g, 2)).toBe(0);
      expect(events.some((e) => e.type === 'ability' && e.ability === 'megan' && e.text === '决斗' && e.target === 2)).toBe(true);
      // 对方立直着：摸到什么打什么
      g.players[2].riichi = true;
      if (!until(g, ids, 2)) continue;
      tried++;
      const drawn = g.players[2].drawn!;
      expect([19, 22, 25], `种子 ${seed}`).toContain(kindOf(drawn));
      expect(meganDuel(g, 0)!.left).toBe(2);
      step(g, ids);
      // 她荣和
      expect(g.legalActions(0).some((a) => a.type === 'ron')).toBe(true);
      g.act(0, { type: 'ron' });
      if (g.phase !== 'roundEnd') for (const s of g.waitingSeats()) g.act(s, { type: 'pass' });
      expect(g.phase).toBe('roundEnd');
      expect(meganDuelEnd(g, 0)).toEqual({ target: 2, end: 'hit' });
      expect(meganDuel(g, 0)).toBeNull();
      hits++;
    }
    expect(tried).toBeGreaterThan(4);
    expect(hits).toBe(tried);
  });

  it('不立直也能决斗：玩家按技能栏的「决斗」，一局一次；电脑打完牌自己拔枪', () => {
    const ids = ['megan', 'izumi', 'izumi', 'izumi'];
    const g = setup(3, ids, [JUNK, TENPAI_69S, JUNK_B])!;
    let b = meganAbility.skill!(g, 0)!;
    expect(b.choices!.find((c) => c.id === 'duel')).toMatchObject({ enabled: true });
    meganAbility.pressSkill!(g, 0, 'duel');
    expect(meganDuel(g, 0)).toEqual({ target: 2, left: 3 });
    expect(g.players[0].riichi || g.players[0].riichiPending).toBe(false);
    b = meganAbility.skill!(g, 0)!;
    expect(b.active).toBe(true);
    // 再按没有用
    meganAbility.pressSkill!(g, 0, 'duel');
    expect(meganDuel(g, 0)).toEqual({ target: 2, left: 3 });

    // 电脑的她（坐南家，不坐庄就不伏牌）：打出一张以后正好一家听牌就决斗
    const ids2 = ['izumi', 'megan', 'izumi', 'izumi'];
    for (let seed = 1; seed <= 12; seed++) {
      const ai = newGame(seed, ids2);
      if (!until(ai, ids2, 1)) continue;
      if (!setHand(ai, 1, MEGAN_HAND) || !setHand(ai, 2, JUNK) || !setHand(ai, 3, TENPAI_69S) || !setHand(ai, 0, JUNK_B)) continue;
      step(ai, ids2);
      if ((ai.phase as string) === 'roundEnd') continue;
      expect(meganDuel(ai, 1), `种子 ${seed}`).toMatchObject({ target: 3 });
      return;
    }
    throw new Error('没有摆得出来的种子');
  });

  it('决斗的三巡：对方摸不到自己的和了牌，她也摸不到对方的；三步走完决斗结束', () => {
    const ids = ['megan', 'izumi', 'izumi', 'izumi'];
    let done = 0;
    for (let seed = 1; seed <= 16; seed++) {
      MEGAN.duel = [0, 0, 0];
      const g = setup(seed, ids, [JUNK, TENPAI_69S, JUNK_B]);
      if (!g) continue;
      riichiEast(g);
      if ((g.phase as string) === 'roundEnd' || !meganDuel(g, 0)) continue;
      g.players[2].riichi = true;
      let theirs = 0;
      let over = false;
      g.onEvent((e) => {
        if (e.type === 'ability' && e.ability === 'megan' && e.text === '决斗结束') over = true;
        if (e.type !== 'draw' || g.rinshanDraw) return;
        const k = kindOf(g.players[e.seat].drawn!);
        if (e.seat === 2 && !over) {
          theirs++;
          expect([23, 26], `种子 ${seed} 对方第 ${theirs} 次摸牌`).not.toContain(k);
        }
        if (e.seat === 0 && meganDuel(g, 0)) expect([23, 26], `种子 ${seed} 她的摸牌`).not.toContain(k);
      });
      let n = 0;
      while (g.phase !== 'roundEnd' && !over && ++n < 200) step(g, ids);
      if (!over) continue;
      expect(theirs).toBe(3);
      expect(meganDuel(g, 0)).toBeNull();
      expect(meganDuelEnd(g, 0)).toEqual({ target: 2, end: 'over' });
      expect(g.players[0].riichi).toBe(true);
      done++;
    }
    expect(done).toBeGreaterThan(4);
  });

  it('对方拆了听牌就逃掉了', () => {
    const ids = ['megan', 'izumi', 'izumi', 'izumi'];
    let escaped = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = setup(seed, ids, [JUNK, TENPAI_69S, JUNK_B]);
      if (!g) continue;
      riichiEast(g);
      if ((g.phase as string) === 'roundEnd' || !meganDuel(g, 0)) continue;
      const events: GameEvent[] = [];
      g.onEvent((e) => events.push(e));
      setHand(g, 2, JUNK);
      let n = 0;
      while (g.phase !== 'roundEnd' && meganDuel(g, 0) && ++n < 20) step(g, ids);
      expect(meganDuel(g, 0)).toBeNull();
      expect(meganDuelEnd(g, 0)).toEqual({ target: 2, end: 'escape' });
      expect(events.some((e) => e.type === 'ability' && e.ability === 'megan' && e.text === '逃脱' && e.target === 2)).toBe(true);
      escaped++;
    }
    expect(escaped).toBeGreaterThan(2);
  });
});

describe('梅根·达文：伏牌', () => {
  it('第一次出牌前按；没做出确定的役之前不能荣和、鸣牌；做出来就抬牌；一场两次', () => {
    const ids = ['megan', 'izumi', 'izumi', 'izumi'];
    const g = newGame(7, ids, 0);
    expect(until(g, ids, 0)).toBe(true);
    expect(meganBlindsLeft(g, 0)).toBe(2);
    expect(meganCanBlind(g, 0)).toBe(true);
    expect(meganAbility.skill!(g, 0)!.choices!.find((c) => c.id === 'blind')).toMatchObject({ enabled: true });
    const events: GameEvent[] = [];
    g.onEvent((e) => events.push(e));
    meganAbility.pressSkill!(g, 0, 'blind');
    expect(meganBlind(g, 0)).toBe(true);
    expect(meganBlindsLeft(g, 0)).toBe(1);
    expect(meganCanBlind(g, 0)).toBe(false);
    expect(events.some((e) => e.type === 'ability' && e.ability === 'megan' && e.text === '伏牌')).toBe(true);
    // 伏着：鸣不了牌，荣和不了，自摸照常
    expect(g.callsFrozen(0)).toBe(true);
    expect(g.callsFrozen(1)).toBe(false);
    const any = g.players[0].hand[0];
    expect(g.canWin(0, { tile: any, tsumo: false })).toBe(false);
    expect(g.canWin(0, { tile: any, tsumo: true })).toBe(true);
    expect(g.canWin(0)).toBe(true);
    // 伏牌的局不决斗
    // 听坎 8s，幺九刻子、没有平和：荣和没役
    expect(setHand(g, 0, '111m456789p79s33s1z')).toBe(true);
    expect(setHand(g, 1, JUNK)).toBe(true);
    expect(setHand(g, 2, TENPAI_69S)).toBe(true);
    expect(setHand(g, 3, JUNK_B)).toBe(true);
    expect(meganSenses(g, 0)).toEqual([2]);
    expect(meganDuelTarget(g, 0)).toBeNull();
    // 听牌但没有确定的役：打出一张以后还伏着
    const east = g.legalActions(0).find((x) => x.type === 'discard' && !x.riichi && kindOf(x.tile) === 27)!;
    g.act(0, east);
    expect(meganCertainYaku(g, 0)).toBe(false);
    expect(meganBlind(g, 0)).toBe(true);
    // 白板暗刻在手、听 6s 9s：每一张都有役，打出一张以后自动抬牌
    if (until(g, ids, 0)) {
      expect(setHand(g, 0, '234m456p78s22s555z1z')).toBe(true);
      const out = g.legalActions(0).find((x) => x.type === 'discard' && !x.riichi && kindOf(x.tile) === 27)!;
      g.act(0, out);
      expect(meganBlind(g, 0)).toBe(false);
      expect(events.some((e) => e.type === 'ability' && e.ability === 'megan' && e.text === '抬牌')).toBe(true);
      expect(g.callsFrozen(0)).toBe(false);
      expect(g.canWin(0, { tile: any, tsumo: false })).toBe(true);
    }
    // 打完这一局，下一局再伏一次，第三局就没有了
    let used = 1;
    let n = 0;
    while (g.phase !== 'gameEnd' && used < 3 && ++n < 4000) {
      if (g.phase === 'roundEnd') {
        g.nextRound();
        continue;
      }
      if (g.phase === 'turn' && g.turn === 0 && g.players[0].discards.length === 0 && !meganBlind(g, 0)) {
        if (used < 2) {
          expect(meganCanBlind(g, 0)).toBe(true);
          meganAbility.pressSkill!(g, 0, 'blind');
          expect(meganBlind(g, 0)).toBe(true);
          used++;
        } else {
          expect(meganBlindsLeft(g, 0)).toBe(0);
          expect(meganCanBlind(g, 0)).toBe(false);
          meganAbility.pressSkill!(g, 0, 'blind');
          expect(meganBlind(g, 0)).toBe(false);
          used++;
        }
      }
      step(g, ids);
    }
    expect(used).toBe(3);
  });

  it('伏着的局进张更顺：同样的种子，伏牌的那一局向听掉得更快', () => {
    const ids = ['megan', 'izumi', 'izumi', 'izumi'];
    const run = (blind: boolean) => {
      let total = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const g = newGame(seed, ids, 0);
        if (!until(g, ids, 0)) continue;
        if (blind) meganAbility.pressSkill!(g, 0, 'blind');
        // 只看她摸牌的效果：每次都打掉最没用的那张（电脑自己打），数第 8 次摸牌以后的向听
        let draws = 0;
        let n = 0;
        while (g.phase !== 'roundEnd' && draws < 8 && ++n < 400) {
          if (g.phase === 'turn' && g.turn === 0) draws++;
          step(g, ids);
        }
        const p = g.players[0];
        total += Math.max(0, shanten(toCounts(p.hand), p.melds.length));
      }
      return total;
    };
    expect(run(true)).toBeLessThan(run(false) - 5);
  }, 120000);

  it('电脑：坐庄的局伏牌，一场最多两次', () => {
    const ids = ['izumi', 'megan', 'izumi', 'izumi'];
    let all = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const g = newGame(seed, ids);
      let blinds = 0;
      g.onEvent((e) => {
        if (e.type === 'ability' && e.ability === 'megan' && e.text === '伏牌') blinds++;
      });
      let n = 0;
      while (g.phase !== 'gameEnd' && ++n < 60000) {
        if (g.phase === 'roundEnd') g.nextRound();
        else step(g, ids);
      }
      expect(g.phase).toBe('gameEnd');
      expect(blinds).toBeLessThanOrEqual(2);
      expect(meganBlindsLeft(g, 1)).toBe(2 - blinds);
      all += blinds;
    }
    expect(all).toBeGreaterThan(3);
  }, 120000);
});

describe('梅根·达文：整场', () => {
  it('和各种能力同桌打得完', async () => {
    const tables = [
      ['megan', 'teru', 'momo', 'satoha'],
      ['koromo', 'megan', 'kasumi', 'nelly'],
      ['toyone', 'awai', 'megan', 'nodoka'],
      ['kinue', 'sae', 'shizuno', 'megan'],
    ];
    for (let seed = 1; seed <= 8; seed++) {
      const ids = tables[seed % tables.length];
      const g = newGame(seed * 37, ids);
      let n = 0;
      while (g.phase !== 'gameEnd' && ++n < 60000) {
        if (g.phase === 'roundEnd') g.nextRound();
        else if ((g.phase as string) === 'predeal') g.deal();
        else step(g, ids);
      }
      expect(g.phase).toBe('gameEnd');
      await new Promise((r) => setTimeout(r, 0));
    }
  }, 180000);
});
