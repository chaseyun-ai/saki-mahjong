import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { KOMAKI, bigHand, harvestShanten, komakiAsleep, komakiGod, type GodId } from '../src/abilities/komaki';
import { chooseAction } from '../src/ai/ai';
import { Game, type Action, type RoundResult } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { isHonor, isYaochu, kindOf, parseTiles, suitOf, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
// 没有 3 费以上的对手：她整场都在睡
const WEAK = ['komaki', 'mako', 'kirame', 'izumi'];

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

// 电脑的小莳会不会用附身的神。失误关掉，只看她本来想怎么打
describe('电脑的神代小莳', () => {
  const ai = { ...byId('komaki').ai, mistakeRate: 0 };

  // 轮到她出牌：手里是 hand（最后一张是刚摸的），melds 是已经开的暗杠
  function turn(god: GodId, hand: string, kans: string[] = []): { g: Game; a: Action } {
    const g = newGame(seedsFor(god, WEAK, 1)[0], WEAK);
    for (const p of g.players) {
      p.melds = [];
      p.discards = [];
      p.riichi = false;
    }
    const p = g.players[0];
    // 手牌和杠出去的牌一起排，免得用到同一张
    const all = parseTiles(hand + kans.join(''));
    p.hand = all.slice(0, all.length - kans.length * 4);
    p.melds = kans.map((_, i) => ({ type: 'ankan' as const, tiles: all.slice(p.hand.length + i * 4, p.hand.length + i * 4 + 4) }));
    p.drawn = p.hand[p.hand.length - 1];
    g.phase = 'turn';
    g.turn = 0;
    return { g, a: chooseAction(g, 0, ai) };
  }
  const out = (a: Action) => (a.type === 'discard' ? kindOf(a.tile) : a.type);
  const kind = (s: string) => kindOf(parseTiles(s)[0]);

  it('稻荷神：只靠那一门的进张算向听，别处现成的面子、雀头照用，搭子不算', () => {
    const sh = (hand: string, suit: number) => harvestShanten(toCounts(parseTiles(hand)), 0, suit);
    // 一般算法是听牌（嵌七筒），可七筒不是万子，等不来
    expect(shanten(toCounts(parseTiles('111334455m68p11s')))).toBe(0);
    expect(sh('111334455m68p11s', 0)).toBe(1);
    // 听九万、一索：九万等得来
    expect(sh('11133445599m11s', 0)).toBe(0);
    // 筒子、索子现成的面子照用
    expect(sh('2345678m456p789s', 0)).toBe(0);
    // 四五筒的搭子等不来：两组面子、一个搭子、雀头，还差两张
    expect(sh('12345678m45p9s11z', 0)).toBe(2);
    // 四组面子齐了，单骑的那张不是这一门的：摸一张这一门的换掉才听得到
    expect(sh('123456789m111z5p', 0)).toBe(1);
    expect(sh('123456789m111z5m', 0)).toBe(0);
  });

  it('稻荷神：听的牌里没有那一门的就不立直，拆掉别的花色的搭子换听；听得到那一门才立直', () => {
    // 打五索是嵌七筒听牌，她不这么立直
    const off = turn('inari', '111334455m68p11s5s').a;
    expect(off.type === 'discard' && !off.riichi).toBe(true);
    // 听九万、一索：打六筒立直
    const on = turn('inari', '11133445599m11s6p').a;
    expect(on).toMatchObject({ type: 'discard', riichi: true });
    expect(out(on)).toBe(kind('6p'));
    // 万子一向听、筒子有个两面搭子：一般会留着搭子打孤张的万子，她先拆筒子
    const tatsu = turn('inari', '123456m79m2m45p11z6s').a;
    expect([kind('4p'), kind('5p'), kind('6s')]).toContain(out(tatsu));
  });

  it('稻荷神、建御雷神：整场不吃不碰不明杠', () => {
    for (const god of ['inari', 'take'] as GodId[]) {
      let calls = 0;
      let rounds = 0;
      for (const seed of seedsFor(god, WEAK, 3)) {
        const g = newGame(seed, WEAK);
        g.onEvent((e) => {
          if (e.type === 'roundEnd') rounds++;
          if (e.type === 'call' && e.seat === 0 && e.call !== '暗杠') calls++;
        });
        run(g, WEAK);
      }
      expect(rounds).toBeGreaterThan(10);
      expect(calls).toBe(0);
    }
  }, 120000);

  it('建御雷神：门清听牌就立直', () => {
    const a = turn('take', '123456m234p5578s1z').a;
    expect(a).toMatchObject({ type: 'discard', riichi: true });
  });

  it('木花咲耶姬：听牌时不拆暗刻（杠材），宁可单骑', () => {
    // 打西是嵌三万（四张），打二万、四万是单骑（三张）：进张少也留着西的暗刻
    const a = turn('sakuya', '24m789p345s333z111p').a;
    expect([kind('2m'), kind('4m')]).toContain(out(a));
    // 别的神照进张多的打
    const b = turn('okuni', '24m789p345s333z111p').a;
    expect([kind('3z'), kind('1p')]).toContain(out(b));
  });

  it('听的牌自己杠光了不算听牌：不再摸什么打什么，换听', () => {
    // 四五六万、五筒对子、八九筒，听的七筒四张全在自己的暗杠里
    const { a } = turn('sakuya', '456m55p89p9s', ['7777p', '1111p']);
    expect(a.type).toBe('discard');
    expect(out(a)).not.toBe(kind('9s'));
  });
});

