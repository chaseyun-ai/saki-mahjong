import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { kasumiSuit } from '../src/abilities/kasumi';
import { isDoraTile, kuroLost } from '../src/abilities/kuro';
import { nodokaAngel } from '../src/abilities/nodoka';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { TileId, kindOf, suitOf, toCounts } from '../src/engine/tiles';

const lineup = ['kasumi', 'saki', 'nodoka', 'kuro'].map((id) => CHARACTERS.find((c) => c.id === id)!);
const inSuit = (suit: number) => (t: TileId) => kindOf(t) < 27 && suitOf(kindOf(t)) === suit;

describe('石户霞', () => {
  it('落后才请神，请神后整场不退；别人配牌里没有那种花色，摸牌也摸不到（岭上牌除外）', () => {
    let rounds = 0;
    let summonedRounds = 0;
    let checkedDraws = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const seats = [0, 1, 2, 3].map((i) => lineup[(i + seed) % 4]);
      const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
      const me = seats.findIndex((c) => c.id === 'kasumi');
      // 第一局大家同分，不算落后
      expect(kasumiSuit(g, me)).toBeNull();
      let summoned = false;
      // 天使和有一半的概率挡掉霞的规矩，不查她
      const angel = (seat: number) => g.players[seat].name === 'nodoka' && nodokaAngel(g, seat);
      g.onEvent((e) => {
        if (e.type === 'roundStart') {
          rounds++;
          const suit = kasumiSuit(g, me);
          if (summoned) expect(suit).not.toBeNull();
          if (suit === null) return;
          summoned = true;
          summonedRounds++;
          for (const p of g.players) if (p.seat !== me && g.rulesBind(me, p.seat) && !angel(p.seat)) expect(p.hand.some(inSuit(suit))).toBe(false);
        }
        if (e.type === 'draw' && e.seat !== me && g.rulesBind(me, e.seat) && !angel(e.seat) && !g.rinshanDraw) {
          const suit = kasumiSuit(g, me);
          if (suit === null) return;
          const p = g.players[e.seat];
          // 牌山里别的花色被摸光（或被锁住、或者剩下的都是玄的宝牌）时才挡不住
          const kuro = g.players.findIndex((q) => q.name === 'kuro');
          const kuroHolds = (t: TileId) => !kuroLost(g, kuro) && isDoraTile(g, t);
          const other = g.wall.live.some((t) => !inSuit(suit)(t) && !g.wall.locked.has(t) && !kuroHolds(t));
          if (!other) return;
          checkedDraws++;
          expect(inSuit(suit)(p.drawn!)).toBe(false);
        }
      });
      let steps = 0;
      while (g.phase !== 'gameEnd' && ++steps < 20000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        const s = g.waitingSeats()[0];
        g.act(s, chooseAction(g, s, seats[s].ai));
      }
    }
    console.log({ rounds, summonedRounds, checkedDraws });
    expect(summonedRounds).toBeGreaterThan(10);
    expect(checkedDraws).toBeGreaterThan(100);
  }, 120000);

  it('和大星淡同场：两边的配牌规矩一起满足，淡的配牌照样听牌、别人照样压到时间迟滞的向听、别人手里没有霞的花色', async () => {
    const { AWAI } = await import('../src/abilities/awai');
    const saved = { ...AWAI };
    try {
      const both = ['kasumi', 'awai', 'nodoka', 'saki'].map((id) => CHARACTERS.find((c) => c.id === id)!);
      let checked = 0;
      let unmet = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const g = new Game({ seed, players: both.map((c) => ({ name: c.id, ability: c.ability })) });
        g.onEvent((e) => {
          const suit = kasumiSuit(g, 0);
          if (e.type !== 'roundStart' || suit === null) return;
          checked++;
          // 没满足的规矩都记在 dealUnmet 里，而且和手牌对得上
          for (const r of g.dealRules) {
            const hand = g.players[r.target].hand.filter((t) => t !== g.players[r.target].drawn);
            expect(r.bad(hand) > 0).toBe(g.dealUnmet.includes(r));
          }
          if (g.dealUnmet.length) {
            unmet++;
            return;
          }
          expect(shanten(toCounts(g.players[1].hand))).toBe(0);
          for (const p of g.players) {
            if (p.seat === 0) continue;
            // 天使和挡掉的规矩不算
            const ruled = (id: string) => g.dealRules.some((r) => r.ability === id && r.target === p.seat);
            if (ruled('kasumi')) expect(p.hand.some(inSuit(suit))).toBe(false);
            if (p.seat !== 1 && ruled('awai')) expect(shanten(toCounts(p.hand.filter((t) => t !== p.drawn)))).toBeGreaterThanOrEqual((g.abilityState[1] as { goals: Record<number, number> }).goals[p.seat]);
          }
        });
        let steps = 0;
        while (g.phase !== 'gameEnd' && ++steps < 20000) {
          if (g.phase === 'roundEnd') {
            g.nextRound();
            continue;
          }
          const s = g.waitingSeats()[0];
          g.act(s, chooseAction(g, s, both[s].ai));
        }
      }
      console.log({ checked, unmet });
      expect(checked).toBeGreaterThan(5);
      // 两边能兼容时应该都满足，降级只是少数。时间迟滞有一半是 6 向听：只剩两门花色和字牌时 6 向听的手很少，
      // 霞换不掉最后一张那门花色的牌（换了向听就变好），这时先动的淡说了算
      expect(unmet).toBeLessThan(checked * 0.3);
    } finally {
      Object.assign(AWAI, saved);
    }
  }, 120000);
});

describe('石户霞遇到做染手的对手', () => {
  it('桌上有宥、真子或爽时，电脑的霞落后也不请神', () => {
    let behind = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const other = ['yu', 'mako', 'sawaya'][seed % 3];
      const seats = ['kasumi', 'nodoka', 'hiroe', other].map((id) => CHARACTERS.find((c) => c.id === id)!);
      const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
      g.onEvent((e) => {
        if (e.type !== 'roundStart') return;
        if (g.players.some((p) => p.seat !== 0 && p.score > g.players[0].score)) behind++;
        expect(kasumiSuit(g, 0)).toBeNull();
      });
      let steps = 0;
      while (g.phase !== 'gameEnd' && ++steps < 20000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        const s = g.waitingSeats()[0];
        g.act(s, chooseAction(g, s, seats[s].ai));
      }
    }
    expect(behind).toBeGreaterThan(5);
  }, 60000);
});
