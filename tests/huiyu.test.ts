import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { GB_TARGETS, fitTarget, rankTargets } from '../src/abilities/gbTargets';
import { HUIYU, huiyuAbility, huiyuMissedRon, huiyuTarget, huiyuWinFan } from '../src/abilities/huiyu';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { gbFan } from '../src/engine/gbFan';
import { kindOf, parseKinds, parseTiles, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const cap4 = () => new Array<number>(34).fill(4);
const counts = (s: string) => {
  const c = new Array<number>(34).fill(0);
  for (const k of parseKinds(s)) c[k]++;
  return c;
};

// 慧宇坐 1 号位，三个没能力的人（爱立直）
function table(seed: number, manual = false) {
  const ids = ['izumi', 'huiyu', 'izumi', 'izumi'];
  return new Game({ seed, players: ids.map((id, i) => ({ name: id, ability: byId(id).ability, manual: manual && i === 1 })) });
}

describe('郝慧宇：番种牌库', () => {
  it('每个牌型做成以后，国标番数不低于番种本身', () => {
    for (const t of GB_TARGETS) {
      const f = fitTarget(t, new Array(34).fill(0), [], cap4())!;
      expect(f.tiles).toHaveLength(14);
      const r = gbFan({ hand: f.tiles, melds: [], win: f.tiles[13], tsumo: false, seat: 1, round: 0 });
      expect(r?.total, t.key).toBeGreaterThanOrEqual(t.fan);
    }
  });

  it('还差几张：一色三步高差单钓那张、花龙差一组', () => {
    const bugao = GB_TARGETS.find((t) => t.key === '一色三步高·万1')!;
    expect(fitTarget(bugao, counts('123234345m678p9s'), [], cap4())!.missing).toBe(1);
    expect(fitTarget(bugao, counts('123234345m678p9s'), [], cap4())!.need).toEqual(parseKinds('9s'));
    const dragon = GB_TARGETS.find((t) => t.key === '花龙·万筒索')!;
    expect(fitTarget(dragon, counts('123m456p789s22z55s'), [], cap4())!.missing).toBe(1);
    expect(fitTarget(dragon, counts('19m19p19s1234567z'), [], cap4())!.missing).toBeGreaterThanOrEqual(10);
  });

  it('要的牌见光了就换别的做法，全见光了做不成', () => {
    const bugao = GB_TARGETS.find((t) => t.key === '一色三步高·万1')!;
    const cap = cap4();
    // 另外三张 9 索都见光了：单钓 9 索做不成，要另找雀头
    cap[parseKinds('9s')[0]] = 1;
    expect(fitTarget(bugao, counts('123234345m678p9s'), [], cap)!.missing).toBe(2);
    // 3 万全见光了（手里一张都没有）：123、234、345 万都做不成
    const cap2 = cap4();
    cap2[parseKinds('3m')[0]] = 0;
    expect(fitTarget(bugao, counts('124m678p9s1122z'), [], cap2)).toBeNull();
  });

  it('只要前几个番种时，挑出来的和全算一遍一样', () => {
    const hand = counts('1234m3456p56789s');
    const full = rankTargets(hand, [], cap4());
    const fast = rankTargets(hand, [], cap4(), 4);
    expect(fast[0].target.key).toBe(full[0].target.key);
  });
});

describe('郝慧宇：能力', () => {
  it('2 费，临海女子', () => {
    expect(byId('huiyu').cost).toBe(2);
    expect(byId('huiyu').school).toBe('临海女子');
  });

  it('牌山多于 24 张时国标不到 8 番和不了，24 张以下放开', () => {
    const g = table(3);
    const p = g.players[1];
    p.melds = [];
    p.riichi = false;
    // 小牌：日麻里东（场风）能荣和，国标只有圈风刻、门前清、单钓将
    p.hand = parseTiles('234m456p678s111z5s');
    const tile = parseTiles('5s')[0] + 1;
    expect(huiyuWinFan(g, 1, tile, false)!.total).toBeLessThan(HUIYU.minFan);
    expect(g.wall.remaining).toBeGreaterThan(HUIYU.freeAt);
    expect(g.canWin(1, { tile, tsumo: false })).toBe(false);
    // 不给和了牌时不拦（电脑问“这一局能不能和”）
    expect(g.canWin(1)).toBe(true);
    // 立直了：八番起和解除
    p.riichi = true;
    expect(g.canWin(1, { tile, tsumo: false })).toBe(true);
    p.riichi = false;
    g.wall.live = g.wall.live.slice(0, HUIYU.freeAt);
    expect(g.canWin(1, { tile, tsumo: false })).toBe(true);
  });

  it('国标大牌、日麻无役：荣和不了，气泡写国标几番', () => {
    const g = table(4);
    const p = g.players[1];
    p.melds = [];
    p.hand = parseTiles('123234345m678p9s');
    p.discards = [];
    const tile = parseTiles('9s')[0] + 2;
    expect(g.canWin(1, { tile, tsumo: false })).toBe(true);
    expect(g.winResult(1, tile, false)).toBeNull();
    expect(huiyuMissedRon(g, 1, 0, tile)).toBe(21);
  });

  it('配牌后三张番种牌加“不做番种”，选了就照选的做', () => {
    const g = table(5, true);
    expect(g.phase).toBe('postdeal');
    const opts = huiyuAbility.postDeal!(g, 1);
    expect(opts).toHaveLength(HUIYU.cards + 1);
    expect(opts.every((o) => o.group === 'gb')).toBe(true);
    expect(opts.at(-1)!.id).toBe('none');
    huiyuAbility.setPostDeal!(g, 1, [opts[1].id]);
    g.deal();
    expect(huiyuTarget(g, 1)?.key).toBe(opts[1].id);

    const g2 = table(6, true);
    huiyuAbility.setPostDeal!(g2, 1, ['none']);
    g2.deal();
    expect(huiyuTarget(g2, 1)).toBeNull();
    expect(huiyuAbility.badge!(g2, 1)).toBeNull();
  });

  it('配牌换牌：番种比没有能力时近', () => {
    let withAb = 0;
    let without = 0;
    for (let seed = 1; seed <= 30; seed++) {
      for (const ab of [true, false]) {
        const g = new Game({ seed, players: [0, 1, 2, 3].map((i) => ({ name: String(i), ability: ab && i === 1 ? huiyuAbility : null })) });
        const hand = g.players[1].hand.slice();
        // 庄家（0 号位）已经摸了第一张，慧宇手里是配牌的 13 张
        const best = rankTargets(toCounts(hand), [], cap4(), 1)[0];
        if (ab) withAb += best.missing;
        else without += best.missing;
      }
    }
    expect(without / 30 - withAb / 30).toBeGreaterThan(1);
  });

  it('电脑的慧宇从不立直，截张一局最多两张，八番起和管着她的每一次和牌', () => {
    let wins = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = table(seed);
      const ids = ['izumi', 'huiyu', 'izumi', 'izumi'];
      let snipes = 0;
      let steps = 0;
      g.onEvent((e) => {
        if (e.type === 'roundStart') snipes = 0;
        if (e.type === 'discard' && e.seat === 1) expect(e.riichi).toBe(false);
        if (e.type === 'ability' && e.seat === 1 && e.text === '截张') expect(++snipes).toBeLessThanOrEqual(HUIYU.snipeMax);
      });
      while (g.phase !== 'gameEnd' && ++steps < 30000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        const s = g.waitingSeats()[0];
        const a = chooseAction(g, s, byId(ids[s]).ai);
        if (s === 1 && (a.type === 'tsumo' || a.type === 'ron')) {
          wins++;
          const tile = a.type === 'tsumo' ? g.players[1].drawn! : g.callKind === 'chankan' ? g.kakanInfo!.tile : g.lastDiscard!.tile;
          if (g.wall.remaining > HUIYU.freeAt) expect(huiyuWinFan(g, 1, tile, a.type === 'tsumo')!.total).toBeGreaterThanOrEqual(HUIYU.minFan);
          expect(kindOf(tile)).toBeGreaterThanOrEqual(0);
        }
        g.act(s, a);
      }
      expect(g.phase).toBe('gameEnd');
    }
    expect(wins).toBeGreaterThan(0);
  }, 120000);
});
