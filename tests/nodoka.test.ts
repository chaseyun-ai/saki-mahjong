import { describe, expect, it } from 'vitest';
import { CHARACTERS, baseAi } from '../src/abilities/characters';
import { NODOKA, angelDanger, nodokaAngel, nodokaCounter } from '../src/abilities/nodoka';
import { setCosts as setNodokaCosts } from '../src/abilities/costs';
import { readOthers } from '../src/abilities/hiroe';
import type { Ability } from '../src/abilities/types';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { TileId, kindOf } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const COSTS = Object.fromEntries(CHARACTERS.map((c) => [c.id, c.cost]));
const slotOf = (g: Game) => g.roundWind * 4 + g.roundNumber;

function play(seed: number, seats: { id: string; ability: Ability | null }[], format: 'east' | 'south', on: (g: Game, me: number) => void) {
  const g = new Game({ seed, format, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  const me = seats.findIndex((c) => c.id === 'nodoka');
  on(g, me);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].id === 'probe' ? baseAi : byId(seats[s].id).ai));
  }
  return g;
}

// 测试用的控场：除了自己，谁都摸不到万子（岭上牌除外）
const probe: Ability = {
  id: 'probe',
  name: '探针',
  description: '',
  beforeAnyDraw(_g, seat, drawer, rinshan) {
    if (rinshan || drawer === seat) return;
    return { seat, ability: 'probe', text: '不给万子', deny: (t: TileId) => kindOf(t) < 9 };
  },
};

describe('原村和', () => {
  it('2 费；计数从 9 开始，每过完一局（本场不算）减去比她强的人数，减到 0 的下一局起一直是天使和', () => {
    expect(byId('nodoka').cost).toBe(2);
    const cases: [string[], number | null][] = [
      [['nodoka', 'awai', 'teru', 'koromo'], 3], // 三个强者：东 4 局起
      [['nodoka', 'saki', 'awai', 'kuro'], 5], // 两个：南 2 局起
      [['nodoka', 'kuro', 'mako', 'ako'], null], // 没有比她强的：一直不变
    ];
    for (const [ids, from] of cases) {
      for (let seed = 1; seed <= 3; seed++) {
        const seats = ids.map(byId);
        const seen = new Map<number, boolean>();
        const g = play(seed, seats, 'south', (g, me) =>
          g.onEvent((e) => {
            if (e.type !== 'roundStart') return;
            const slot = slotOf(g);
            const angel = nodokaAngel(g, me);
            // 连庄的本场和这一局开头一样
            if (seen.has(slot)) expect(angel).toBe(seen.get(slot));
            seen.set(slot, angel);
            expect(angel).toBe(from !== null && slot >= from && !g.isSealed(me));
            if (from === null) expect(nodokaCounter(g, me)).toBe(NODOKA.start);
          }),
        );
        expect(g.phase).toBe('gameEnd');
      }
    }
  }, 120000);

  it('变身那一局出一次“天使和”，头像框挂“天使”', () => {
    const seats = ['nodoka', 'awai', 'teru', 'koromo'].map(byId);
    // 有的场在她变身之前就有人被打飞了：只看变了身的场
    let games = 0;
    for (let seed = 1; seed <= 6; seed++) {
      let shown = 0;
      let badge = false;
      let angel = false;
      play(seed, seats, 'south', (g, me) =>
        g.onEvent((e) => {
          if (e.type === 'ability' && e.seat === me && e.text === '天使和') shown++;
          if (e.type === 'draw' && nodokaAngel(g, me)) {
            angel = true;
            badge ||= g.abilities[me]!.badge!(g, me) === '天使';
          }
        }),
      );
      if (!angel) continue;
      games++;
      expect(shown).toBe(1);
      expect(badge).toBe(true);
    }
    expect(games).toBeGreaterThan(2);
  }, 60000);

  it('天使和：别人摸牌的规矩一半不算（摸得到被挡的牌，但比没人挡时少）', () => {
    setNodokaCosts({ ...COSTS, probe: 5 });
    try {
      const n = { angel: 0, angelHit: 0, before: 0, beforeHit: 0 };
      for (let seed = 1; seed <= 16; seed++) {
        const seats = [{ id: 'probe', ability: probe }, byId('awai'), byId('nodoka'), byId('teru')];
        play(seed, seats, 'south', (g, me) =>
          g.onEvent((e) => {
            if (e.type !== 'draw' || e.seat !== me || g.rinshanDraw) return;
            // 万子以外的牌被摸光了，挡也挡不住：不算
            if (!g.wall.live.some((t) => kindOf(t) >= 9)) return;
            const man = kindOf(g.players[me].drawn!) < 9 ? 1 : 0;
            if (nodokaAngel(g, me)) {
              n.angel++;
              n.angelHit += man;
            } else {
              n.before++;
              n.beforeHit += man;
            }
          }),
        );
      }
      expect(n.angel).toBeGreaterThan(200);
      // 平时牌山里还有别的牌时摸不到万子
      expect(n.beforeHit / n.before).toBeLessThan(0.05);
      // 天使和：一半的规矩不算，大约摸到平常（约 1/4）的一半
      const rate = n.angelHit / n.angel;
      expect(rate).toBeGreaterThan(0.06);
      expect(rate).toBeLessThan(0.22);
    } finally {
      setNodokaCosts(COSTS);
    }
  }, 120000);

  it('天使和读得出 8000 点以上的铳牌，电脑的天使和不打', () => {
    let checked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const seats = ['nodoka', 'awai', 'teru', 'koromo'].map(byId);
      play(seed, seats, 'south', (g, me) =>
        g.onEvent((e) => {
          if (e.type !== 'draw' || e.seat !== me || !nodokaAngel(g, me) || g.players[me].riichi) return;
          const big = angelDanger(g, me);
          const all = readOthers(g, me);
          for (const k of big) expect(all.some((r) => r.ron.some((x, i) => x === k && r.pay[i] >= NODOKA.bigPay))).toBe(true);
          if (!big.size) return;
          const hand = g.players[me].hand;
          if (hand.every((t) => big.has(kindOf(t)))) return;
          const a = chooseAction(g, me, byId('nodoka').ai);
          if (a.type !== 'discard') return;
          checked++;
          expect(big.has(kindOf(a.tile))).toBe(false);
        }),
      );
    }
    expect(checked).toBeGreaterThan(0);
  }, 120000);
  it('天使和封印不了，变身前照样被封', () => {
    const sealer: Ability = { id: 'probe', name: '封印', description: '', seals: () => true };
    const seats = ['nodoka', 'awai', 'teru'].map((id) => ({ name: id, ability: byId(id).ability }));
    const g = new Game({ seed: 1, players: [...seats, { name: 'probe', ability: sealer }] });
    g.events.length = 0;
    expect(g.isSealed(0)).toBe(true);
    expect(nodokaAngel(g, 0)).toBe(false);
    // 两个强者：过完 5 局计数到 -1
    g.roundWind = 1;
    g.roundNumber = 1;
    for (let slot = 0; slot < 5; slot++) g.events.push({ type: 'roundStart', label: '', slot });
    expect(nodokaCounter(g, 0)).toBeLessThanOrEqual(0);
    expect(g.isSealed(0)).toBe(false);
    expect(nodokaAngel(g, 0)).toBe(true);
    expect(g.isSealed(1)).toBe(true);
  });
});
