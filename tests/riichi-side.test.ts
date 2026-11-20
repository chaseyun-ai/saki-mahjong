import { describe, expect, it } from 'vitest';
import { Action, Discard, Game } from '../src/engine/game';
import { riichiSideIndex } from '../src/engine/pond';
import { parseTiles } from '../src/engine/tiles';

const d = (riichi: boolean, called: boolean): Discard => ({ tile: 0, riichi, tsumogiri: false, called });

describe('牌河里横放的立直牌', () => {
  it('平时是宣言牌；宣言牌被鸣走了，换成她之后打出、还留在牌河里的第一张', () => {
    expect(riichiSideIndex([])).toBe(-1);
    expect(riichiSideIndex([d(false, false), d(false, true)])).toBe(-1);
    expect(riichiSideIndex([d(false, false), d(true, false), d(false, false)])).toBe(1);
    // 宣言牌被鸣走，下一巡还没打：没有横放的牌
    expect(riichiSideIndex([d(false, false), d(true, true)])).toBe(-1);
    // 下一巡打的那张横过来
    expect(riichiSideIndex([d(false, false), d(true, true), d(false, false), d(false, false)])).toBe(2);
    // 接替的那张也被鸣走了，再往后一张
    expect(riichiSideIndex([d(true, true), d(false, true), d(false, false)])).toBe(2);
    // 宣言牌之前被鸣走的牌不算
    expect(riichiSideIndex([d(false, true), d(true, false)])).toBe(1);
  });

  it('真打一局：立直宣言牌被碰走，她下一巡打的牌变成横放的立直牌', () => {
    const g = new Game({ seed: 1, players: [0, 1, 2, 3].map((i) => ({ name: `p${i}` })) });
    const t = g.turn;
    const o = (t + 2) % 4;
    // 一次 parse 保证两家的牌不重号：立直的人听 1z、2z 双碰，打 5z 立直；对家手里有一对 5z
    const ids = parseTiles('123m456p789s1122z5z' + '55z2468m2468p246s');
    const me = g.players[t];
    me.hand = ids.slice(0, 14);
    me.drawn = ids[13];
    g.players[o].hand = ids.slice(14);
    g.act(t, { type: 'discard', tile: ids[13], riichi: true });
    expect(g.phase).toBe('calls');
    expect(riichiSideIndex(me.discards)).toBe(0);
    const pon = g.legalActions(o).find((a) => a.type === 'pon') as Extract<Action, { type: 'pon' }>;
    expect(pon).toBeDefined();
    for (const s of g.waitingSeats()) g.act(s, s === o ? pon : { type: 'pass' });

    expect(me.riichi).toBe(true);
    expect(me.discards[0].called).toBe(true);
    // 碰走以后、下一巡打牌之前：牌河里没有横放的牌
    expect(riichiSideIndex(me.discards)).toBe(-1);

    // 一直打到立直的人再打出一张（别人鸣牌都跳过，轮到谁就打摸到的牌）
    let steps = 0;
    while (me.discards.length < 2 && g.phase !== 'roundEnd' && ++steps < 50) {
      if (g.phase === 'calls') {
        for (const s of g.waitingSeats()) g.act(s, { type: 'pass' });
        continue;
      }
      const s = g.turn;
      const p = g.players[s];
      const legal = g.legalActions(s).filter((a): a is Extract<Action, { type: 'discard' }> => a.type === 'discard' && !a.riichi);
      g.act(s, legal.find((a) => a.tile === p.drawn) ?? legal[0]);
    }
    expect(me.discards).toHaveLength(2);
    expect(me.discards[1].riichi).toBe(false);
    expect(riichiSideIndex(me.discards)).toBe(1);
  });
});
