import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/game';
import { Meld } from '../src/engine/score';
import { kindOf, parseKinds, parseTiles, toCounts } from '../src/engine/tiles';
import { hanLabel, waitInfo, waitStatus } from '../src/ui/waitInfo';

const SEAT = 1; // 南家，不是庄家，东风也不是他的役牌

// 清空牌桌，只摆测试要的牌。宝牌指示牌是白（宝牌是发），下面的手牌都没有发
function table(hand: string, melds: Meld[] = []) {
  const g = new Game({ seed: 1, players: [0, 1, 2, 3].map((i) => ({ name: `p${i}` })) });
  for (const p of g.players) {
    p.hand = [];
    p.melds = [];
    p.discards = [];
    p.drawn = null;
  }
  g.wall.doraIndicators[0] = parseTiles('5z')[0];
  g.wall.doraRevealed = 1;
  const me = g.players[SEAT];
  me.hand = parseTiles(hand);
  me.melds = melds;
  return { g, me };
}

const chi = (tiles: string): Meld => {
  const ids = parseTiles(tiles);
  return { type: 'chi', tiles: ids, calledTile: ids[0], from: 0 };
};
const discard = (tile: string, called = false) => ({ tile: parseTiles(tile)[0], riichi: false, tsumogiri: false, called });
const kinds = (s: string) => parseKinds(s);

describe('待和提示', () => {
  it('吃了带幺九的顺子以后没役：荣和、自摸都不行', () => {
    const { g } = table('23m456p678s55s', [chi('123p')]);
    const w = waitInfo(g, SEAT);
    expect(w.tiles.map((t) => t.kind)).toEqual(kinds('14m'));
    expect(w.tiles.map((t) => waitStatus(t, w.furiten))).toEqual(['none', 'none']);
  });

  it('副露后一四万听：和四万有断幺，和一万没役', () => {
    const { g } = table('23m456p678s55s', [chi('345p')]);
    const w = waitInfo(g, SEAT);
    const [one, four] = w.tiles;
    expect(waitStatus(one, w.furiten)).toBe('none');
    expect(waitStatus(four, w.furiten)).toBe('ron');
    expect(four.ron!.yaku.map((y) => y.name)).toEqual(['断幺九']);
    expect(hanLabel(four.ron!)).toBe('1番');
  });

  it('门清没立直也没别的役：只能自摸', () => {
    const { g } = table('13m456p678s789m55s');
    const w = waitInfo(g, SEAT);
    expect(w.tiles.map((t) => t.kind)).toEqual(kinds('2m'));
    expect(w.tiles[0].ron).toBeNull();
    expect(w.tiles[0].tsumo!.yaku.map((y) => y.name)).toEqual(['门前清自摸和']);
    expect(waitStatus(w.tiles[0], w.furiten)).toBe('tsumo');
  });

  it('立直以后同一手牌能荣和', () => {
    const { g, me } = table('13m456p678s789m55s');
    me.riichi = true;
    const w = waitInfo(g, SEAT);
    expect(waitStatus(w.tiles[0], w.furiten)).toBe('ron');
    expect(w.tiles[0].ron!.yaku.map((y) => y.name)).toEqual(['立直']);
  });

  it('宝牌算进番数，满贯以上写名字', () => {
    const { g } = table('234m66m456p678s55s');
    g.wall.doraIndicators[0] = parseTiles('4s')[0]; // 宝牌五索，手里两张，和了是三张
    const w = waitInfo(g, SEAT);
    expect(w.tiles.map((t) => t.kind)).toEqual(kinds('6m5s'));
    // 和五索：断幺 + 宝牌 3 = 4 番 30 符，满贯
    const five = w.tiles.find((t) => t.kind === kinds('5s')[0])!;
    expect(five.ron!.han).toBe(4);
    expect(hanLabel(five.ron!)).toBe('满贯');
  });

  it('自己打过待和牌就是振听：能荣和的也只能自摸', () => {
    const { g, me } = table('23m456p678s55s', [chi('345p')]);
    me.discards = [discard('1m')];
    const w = waitInfo(g, SEAT);
    expect(w.furiten).toBe(true);
    expect(w.tiles.map((t) => waitStatus(t, w.furiten))).toEqual(['none', 'tsumo']);
  });

  it('剩几张：扣掉自己手里、四家牌河、副露、宝牌指示牌，被叫走的牌不重复算', () => {
    const { g } = table('23m456p678s55s', [chi('345p')]);
    g.wall.doraIndicators[0] = parseTiles('4m')[0];
    g.players[0].discards = [discard('4m'), discard('1m', true)];
    g.players[2].melds = [{ type: 'pon', tiles: parseTiles('111m'), calledTile: parseTiles('1m')[0], from: 0 }];
    g.players[3].discards = [discard('4m')];
    const w = waitInfo(g, SEAT);
    const [one, four] = w.tiles;
    expect(one.left).toBe(1); // 对家碰了三张，上家打的那张被叫走了不算两次
    expect(four.left).toBe(1); // 宝牌指示牌一张，上家、下家各打一张
  });

  it('全都看见了就是 0 张', () => {
    const { g } = table('234m456p789p678s7z'); // 中单骑
    g.players[0].discards = [discard('7z'), discard('7z'), discard('7z')];
    const w = waitInfo(g, SEAT);
    expect(w.tiles.map((t) => t.kind)).toEqual(kinds('7z'));
    expect(w.tiles[0].left).toBe(0);
  });

  it('没听牌就没有提示', () => {
    const { g } = table('13m459p1278s2357z');
    expect(waitInfo(g, SEAT).tiles).toEqual([]);
  });

  it('轮到自己时可以预先算打掉某张以后听什么，打掉的那张也算振听', () => {
    const { g } = table('1m23m456p678s789m55s');
    const one = g.players[SEAT].hand.find((t) => kindOf(t) === kinds('1m')[0])!;
    const w = waitInfo(g, SEAT, one);
    expect(w.tiles.map((t) => t.kind)).toEqual(kinds('14m'));
    expect(w.furiten).toBe(true);
    // 手里 14 张不打牌的时候没法算
    expect(waitInfo(g, SEAT).tiles).toEqual([]);
  });

  it('预先算的时候可以按立直算番', () => {
    const { g } = table('13m456p678s789m55s1z');
    const east = g.players[SEAT].hand.find((t) => kindOf(t) === kinds('1z')[0])!;
    expect(waitInfo(g, SEAT, east).tiles[0].ron).toBeNull();
    expect(waitInfo(g, SEAT, east, true).tiles[0].ron!.yaku.map((y) => y.name)).toEqual(['立直']);
  });
});

describe('打牌前预览', () => {
  // 随便凑一手差不多和了的牌：四组面子加一对，再把其中一张换成随机的牌，一共 14 张
  function nearlyComplete(rng: () => number): number[] {
    const counts = new Array(34).fill(0);
    const kinds: number[] = [];
    const add = (k: number) => {
      if (counts[k] >= 4) return false;
      counts[k]++;
      kinds.push(k);
      return true;
    };
    const pick = (n: number) => Math.floor(rng() * n);
    while (kinds.length < 12) {
      if (rng() < 0.6) {
        const k = pick(3) * 9 + pick(7);
        if (counts[k] < 4 && counts[k + 1] < 4 && counts[k + 2] < 4) [k, k + 1, k + 2].forEach(add);
      } else {
        const k = pick(34);
        if (counts[k] <= 1) [k, k, k].forEach(add);
      }
    }
    for (;;) {
      const k = pick(34);
      if (counts[k] <= 2) {
        add(k);
        add(k);
        break;
      }
    }
    kinds[pick(14)] = -1;
    counts.fill(0);
    for (const k of kinds) if (k >= 0) counts[k]++;
    for (;;) {
      const k = pick(34);
      if (counts[k] < 4) {
        kinds[kinds.indexOf(-1)] = k;
        break;
      }
    }
    const used = new Map<number, number>();
    return kinds.map((k) => {
      const n = used.get(k) ?? 0;
      used.set(k, n + 1);
      return k * 4 + n;
    });
  }

  it('打出去能听牌的牌，就是规则那边允许立直的牌（除了只差自己已经拿满四张的那种）', () => {
    let s = 12345;
    const rng = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    let marked = 0;
    for (let n = 0; n < 300; n++) {
      const { g, me } = table('');
      me.hand = nearlyComplete(rng);
      me.drawn = me.hand[13];
      g.phase = 'turn';
      g.turn = SEAT;
      const riichi = new Set(g.legalActions(SEAT).flatMap((a) => (a.type === 'discard' && a.riichi ? [kindOf(a.tile)] : [])));
      for (const t of me.hand) {
        const tenpai = waitInfo(g, SEAT, t).tiles.length > 0;
        if (tenpai) {
          expect(riichi.has(kindOf(t))).toBe(true);
          marked++;
        } else if (riichi.has(kindOf(t))) {
          // 牌形听了，但要等的牌自己手里已经有四张，一张也来不了：不标
          const rest = toCounts(me.hand.filter((x) => x !== t));
          expect(rest.some((c) => c === 4)).toBe(true);
        }
      }
    }
    // 确实测到了不少能听牌的情况
    expect(marked).toBeGreaterThan(200);
  }, 20000);
});
