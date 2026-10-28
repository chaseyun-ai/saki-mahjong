import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { KOMAKI, bigHand, komakiAsleep, komakiGod, type GodId } from '../src/abilities/komaki';
import { chooseAction } from '../src/ai/ai';
import { Game, type RoundResult } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { isHonor, isYaochu, kindOf, parseTiles, suitOf, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
// 没有 3 费以上的对手：她整场都在睡
const WEAK = ['komaki', 'mako', 'ako', 'izumi'];

function newGame(seed: number, ids: string[], format: 'east' | 'south' = 'south') {
  return new Game({ seed, format, players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });
}

function run(g: Game, ids: string[]) {
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, byId(ids[s]).ai));
  }
  return g;
}

// 初始神是 god 的种子
function seedsFor(god: GodId, ids: string[], n: number): number[] {
  const out: number[] = [];
  for (let seed = 1; out.length < n && seed < 2000; seed++) {
    const g = newGame(seed, ids);
    if (komakiGod(g, ids.indexOf('komaki'), 1) === god) out.push(seed);
  }
  return out;
}

// 每一局发完牌（庄家摸第一张之前）她的手牌
function dealtHands(g: Game, me: number): number[][] {
  const out: number[][] = [];
  g.onEvent((e) => {
    if (e.type === 'roundStart') out.push(g.players[me].hand.slice());
  });
  return out;
}

const fakeEnd = (wins: { seat: number; from: number | null }[]): RoundResult =>
  ({ kind: wins.length ? 'win' : 'exhaustive', wins, tenpai: [false, false, false, false], deltas: [0, 0, 0, 0] }) as unknown as RoundResult;

describe('神代小莳', () => {
  it('5 费；计时器 10 点，每过一局减去 3 费以上的对手数，归零的下一局醒来、没有能力', () => {
    expect(byId('komaki').cost).toBe(5);
    const strong = ['komaki', 'teru', 'koromo', 'awai']; // 三个：第 5 局醒
    const g = newGame(1, strong);
    expect([1, 2, 3, 4].every((r) => komakiAsleep(g, 0, r))).toBe(true);
    expect(komakiAsleep(g, 0, 5)).toBe(false);
    expect(komakiGod(g, 0, 5)).toBeNull();
    const two = newGame(1, ['komaki', 'saki', 'sawaya', 'mako']); // 两个：第 6 局醒
    expect(komakiAsleep(two, 0, 5)).toBe(true);
    expect(komakiAsleep(two, 0, 6)).toBe(false);
    // 没有强者：一直睡
    const weak = newGame(1, WEAK);
    expect(komakiAsleep(weak, 0, 30)).toBe(true);
  });

  it('初始神按种子随机、不会是天宇受卖命，睡着时一直是同一位', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const g = newGame(seed, WEAK);
      const first = komakiGod(g, 0, 1)!;
      expect(first).not.toBe('uzume');
      seen.add(first);
      expect([2, 5, 9].every((r) => komakiGod(g, 0, r) === first)).toBe(true);
    }
    expect(seen.size).toBe(8);
  });

  it('神乐：醒来以后被自摸、放铳满 3 次，下一局降下和初始神不同的新神；醒来之前放铳不算', () => {
    const g = newGame(7, ['komaki', 'teru', 'koromo', 'awai'], 'east');
    const first = komakiGod(g, 0, 1);
    // 从头数：只看下面这几局的结算
    g.events.length = 0;
    g.abilityGameState[0] = { first };
    const ends = [
      fakeEnd([{ seat: 1, from: 0 }]), // 第 1 局：还在睡，不算
      fakeEnd([{ seat: 0, from: 1 }]), // 第 2 局：她和了，计时器多减一
      fakeEnd([]),
      fakeEnd([{ seat: 2, from: 0 }]), // 第 4 局：10 - 3×3 - 1 = 0，醒了，1 点
      fakeEnd([{ seat: 1, from: 3 }]), // 别人之间放铳，不算
      fakeEnd([{ seat: 1, from: null }]), // 第 6 局：别人自摸，2 点
      fakeEnd([{ seat: 3, from: 0 }]), // 第 7 局：3 点，降神
    ];
    for (const result of ends) g.events.push({ type: 'roundEnd', result });
    expect(komakiGod(g, 0, 7)).toBeNull();
    const second = komakiGod(g, 0, 8);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second).not.toBe('uzume');
    expect(komakiGod(g, 0, 12)).toBe(second);
  });

  it('她自己和一次计时器减一；神乐封印不了，睡着时照样被封', () => {
    const sealer = { id: 'probe', name: '封印', description: '', seals: () => true };
    const g = new Game({ seed: 2, players: [...WEAK.slice(0, 3).map((id) => ({ name: id, ability: byId(id).ability })), { name: 'probe', ability: sealer }] });
    const first = komakiGod(g, 0, 1);
    g.events.length = 0;
    g.abilityGameState[0] = { first };
    for (let i = 0; i < KOMAKI.timer; i++) g.events.push({ type: 'roundEnd', result: fakeEnd([{ seat: 0, from: null }]) });
    expect(komakiAsleep(g, 0, KOMAKI.timer)).toBe(true);
    expect(komakiAsleep(g, 0, KOMAKI.timer + 1)).toBe(false);
    expect(g.isSealed(0, 3)).toBe(true);
    expect(g.isSealed(0, KOMAKI.timer + 1)).toBe(false);
  });

  it('天听配牌的人坐庄时不会天和：淡的天听、小莳的琼琼杵尊', () => {
    let tenpaiDeals = 0;
    for (const [ids, me] of [
      [['awai', 'mako', 'ako', 'izumi'], 0],
      [WEAK, 0],
    ] as [string[], number][]) {
      for (let seed = 1; seed <= 150; seed++) {
        const g = new Game({ seed, firstDealer: me, players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });
        if (!g.abilities[me]!.noTenhou!(g, me)) continue;
        tenpaiDeals++;
        const p = g.players[me];
        expect(p.hand.length).toBe(14);
        expect(shanten(toCounts(p.hand))).toBeGreaterThanOrEqual(0);
      }
    }
    expect(tenpaiDeals).toBeGreaterThan(100);
  });

  it('琼琼杵尊：配牌就听牌', () => {
    let rounds = 0;
    let tenpai = 0;
    for (const seed of seedsFor('ninigi', WEAK, 4)) {
      const g = newGame(seed, WEAK);
      const hands = dealtHands(g, 0);
      run(g, WEAK);
      for (const h of hands) {
        rounds++;
        if (shanten(toCounts(h)) === 0) tenpai++;
      }
    }
    expect(rounds).toBeGreaterThan(10);
    expect(tenpai / rounds).toBeGreaterThan(0.9);
  }, 120000);

  it('木花咲耶姬：配牌有两组暗刻，杠得多', () => {
    let rounds = 0;
    let two = 0;
    let kans = 0;
    for (const seed of seedsFor('sakuya', WEAK, 4)) {
      const g = newGame(seed, WEAK);
      const hands = dealtHands(g, 0);
      g.onEvent((e) => {
        if (e.type === 'call' && e.seat === 0 && e.call.includes('杠')) kans++;
      });
      run(g, WEAK);
      for (const h of hands) {
        rounds++;
        if (toCounts(h).filter((n) => n >= 3).length >= 2) two++;
      }
    }
    expect(two / rounds).toBeGreaterThan(0.9);
    expect(kans / rounds).toBeGreaterThan(0.8);
  }, 120000);

  it('须佐之男：配牌偏幺九牌和风牌', () => {
    let rounds = 0;
    let yaochu = 0;
    for (const seed of seedsFor('susanoo', WEAK, 4)) {
      const g = newGame(seed, WEAK);
      const hands = dealtHands(g, 0);
      run(g, WEAK);
      for (const h of hands) {
        rounds++;
        yaochu += h.filter((t) => isYaochu(kindOf(t))).length;
      }
    }
    // 不偏的话平均 13 × 13/34 ≈ 5 张
    expect(yaochu / rounds).toBeGreaterThan(8);
  }, 120000);

  it('稻荷神：摸到的几乎都是手里最多的那门数牌（牌山里还有的话）', () => {
    let draws = 0;
    let hit = 0;
    for (const seed of seedsFor('inari', WEAK, 3)) {
      const g = newGame(seed, WEAK);
      g.onEvent((e) => {
        if (e.type !== 'draw' || e.seat !== 0 || g.rinshanDraw) return;
        const p = g.players[0];
        const per = [0, 0, 0];
        for (const t of p.hand) if (t !== p.drawn && !isHonor(kindOf(t))) per[suitOf(kindOf(t))]++;
        const suit = per.indexOf(Math.max(...per));
        // 那一门在牌山里已经摸光了的不算
        if (suitOf(kindOf(p.drawn!)) !== suit && !g.wall.live.some((t) => suitOf(kindOf(t)) === suit)) return;
        draws++;
        if (suitOf(kindOf(p.drawn!)) === suit) hit++;
      });
      run(g, WEAK);
    }
    expect(draws).toBeGreaterThan(100);
    expect(hit / draws).toBeGreaterThan(0.8);
  }, 120000);

  it('大国主神、天照：进张比平常多', () => {
    const rate = (god: GodId | null) => {
      let draws = 0;
      let useful = 0;
      const seeds = god ? seedsFor(god, WEAK, 3) : [11, 12, 13];
      for (const seed of seeds) {
        const ids = god ? WEAK : ['mako', 'ako', 'izumi', 'kyouko'];
        const g = newGame(seed, ids);
        let before = 0;
        g.onEvent((e) => {
          if (e.type !== 'draw' || e.seat !== 0 || g.rinshanDraw) return;
          const p = g.players[0];
          const c = toCounts(p.hand.filter((t) => t !== p.drawn));
          before = shanten(c, p.melds.length);
          c[kindOf(p.drawn!)]++;
          draws++;
          if (shanten(c, p.melds.length) < before) useful++;
        });
        run(g, ids);
      }
      return useful / draws;
    };
    const base = rate(null);
    expect(rate('okuni')).toBeGreaterThan(base + 0.1);
    expect(rate('amaterasu')).toBeGreaterThan(base + 0.1);
  }, 120000);

  it('磐长姬：看得出对手往大牌走', () => {
    const g = newGame(1, WEAK);
    g.players[1].hand = parseTiles('1112345678999m1z');
    expect(bigHand(g, 1)).toBe(true);
    g.players[1].hand = parseTiles('123m456p789s1234z5z');
    expect(bigHand(g, 1)).toBe(false);
  });

  it('天照：其他人的能力全部失效，照不算；照魔镜照不穿她', () => {
    const ids = ['komaki', 'teru', 'saki', 'koromo'];
    const seed = seedsFor('amaterasu', ids, 1)[0];
    const g = newGame(seed, ids);
    expect(g.isSealed(2)).toBe(true);
    expect(g.isSealed(3)).toBe(true);
    expect(g.isSealed(1)).toBe(false);
    expect(g.active(0)!.mirrorProof!(g, 0)).toBe(true);
  });

  it('建御雷神：立直以后一发很容易自摸', () => {
    let riichis = 0;
    let ippatsu = 0;
    for (const seed of seedsFor('take', WEAK, 6)) {
      const g = newGame(seed, WEAK);
      run(g, WEAK);
      for (const e of g.events) {
        if (e.type === 'discard' && e.seat === 0 && e.riichi) riichis++;
        if (e.type === 'roundEnd') for (const w of e.result.wins) if (w.seat === 0 && w.result.yaku.some((y) => y.name === '一发')) ippatsu++;
      }
    }
    expect(riichis).toBeGreaterThan(5);
    expect(ippatsu / riichis).toBeGreaterThan(KOMAKI.takeIppatsu * 0.5);
  }, 120000);
});
