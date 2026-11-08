import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { HARU, haruAbility, haruRush } from '../src/abilities/haru';
import { hatsumiAbility, hatsumiGale, hatsumiGlowMelds, hatsumiOpen, hatsumiWindsComing } from '../src/abilities/hatsumi';
import { HATSUMI_AI, chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { shanten } from '../src/engine/shanten';
import { EAST, NORTH, SOUTH, TileId, WEST, isDragon, isWind, kindOf, toCounts } from '../src/engine/tiles';
import type { Ability } from '../src/abilities/types';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function game(seed: number, at: number, ability: Ability) {
  return new Game({ seed, format: 'east', players: [0, 1, 2, 3].map((i) => ({ name: `p${i}`, ability: i === at ? ability : null })) });
}

// 把 seat 手里多出来的那张（庄家第一张）放回牌山
function settle(g: Game, seat: number) {
  const p = g.players[seat];
  if (p.hand.length === 14) {
    g.wall.live.unshift(p.drawn!);
    p.hand = p.hand.filter((t) => t !== p.drawn);
    p.drawn = null;
  }
}

const count = (hand: TileId[], k: number) => hand.filter((t) => kindOf(t) === k).length;

describe('永水的三人', () => {
  it('角色表：狩宿巴没有能力、泷见春、薄墨初美', () => {
    expect(byId('tomoe').ability).toBeNull();
    expect(byId('haru').ability?.id).toBe('haru');
    expect(byId('hatsumi').ability?.id).toBe('hatsumi');
    for (const id of ['tomoe', 'haru', 'hatsumi']) expect(byId(id).school).toBe('永水女子');
  });
});

describe('薄墨初美', () => {
  it('坐北家时配牌必定有两张东风、两张北风，偶尔一种是暗刻', () => {
    let triplets = 0;
    for (let seed = 1; seed <= 120; seed++) {
      // 起家是 0 号位，东 1 局 3 号位坐北家
      const g = game(seed, 3, hatsumiAbility);
      expect(g.seatWind(3)).toBe(NORTH);
      const h = g.players[3].hand;
      expect(count(h, EAST)).toBeGreaterThanOrEqual(2);
      expect(count(h, NORTH)).toBeGreaterThanOrEqual(2);
      if (count(h, EAST) >= 3 || count(h, NORTH) >= 3) triplets++;
    }
    expect(triplets).toBeGreaterThan(5);
    expect(triplets).toBeLessThan(60);
  });

  it('坐北家的局别人配牌里没有西风、南风，摸也摸不到', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = game(seed, 3, hatsumiAbility);
      for (const s of [0, 1, 2]) {
        const h = g.players[s].hand.filter((t) => t !== g.players[s].drawn);
        expect(count(h, WEST) + count(h, SOUTH)).toBe(0);
      }
      const rule = hatsumiAbility.beforeAnyDraw!(g, 3, 1, false);
      expect(rule && rule.deny(WEST * 4)).toBe(true);
      expect(rule && rule.deny(SOUTH * 4)).toBe(true);
      expect(rule && rule.deny(0)).toBe(false);
    }
  });

  it('不坐北家时鸣出东北也不算里鬼门、不发光', () => {
    const g = game(1, 1, hatsumiAbility);
    const p = g.players[1];
    p.melds.push({ type: 'pon', tiles: [EAST * 4, EAST * 4 + 1, EAST * 4 + 2] }, { type: 'pon', tiles: [NORTH * 4, NORTH * 4 + 1, NORTH * 4 + 2] });
    expect(hatsumiOpen(g, 1)).toBe(false);
    expect(hatsumiGlowMelds(g, 1)).toEqual([]);
    expect(hatsumiGale(g, 1)).toBe(0);
  });

  it('不坐北家时配牌照常', () => {
    let both = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = game(seed, 1, hatsumiAbility);
      const h = g.players[1].hand;
      if (count(h, EAST) >= 2 && count(h, NORTH) >= 2) both++;
    }
    expect(both).toBeLessThan(5);
  });

  it('东北都鸣出来以后，接下来摸到西风、南风（一刻一对），风越聚越浓，听牌时最浓', () => {
    let done = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const g = game(seed, 3, hatsumiAbility);
      settle(g, 3);
      const p = g.players[3];
      // 把手里的东、北鸣出来（各三张；第三张从别处拿来，换一张手里的数牌过去）
      const pools = [g.wall.live, g.wall.rinshan, g.wall.uraIndicators, ...[0, 1, 2].map((s) => g.players[s].hand)];
      for (const k of [EAST, NORTH]) {
        const tiles: TileId[] = [];
        for (let j = 0; j < 4 && tiles.length < 3; j++) {
          const t = k * 4 + j;
          if (g.wall.doraIndicators.includes(t)) continue;
          if (!p.hand.includes(t)) {
            const pool = pools.find((a) => a.includes(t));
            if (!pool) continue;
            const spare = p.hand.findIndex((x) => kindOf(x) < 27);
            pool[pool.indexOf(t)] = p.hand[spare];
            p.hand[spare] = t;
          }
          tiles.push(t);
        }
        p.hand = p.hand.filter((t) => !tiles.includes(t));
        p.melds.push({ type: 'pon', tiles, calledTile: tiles[0], from: 0 });
      }
      // 剩下的东北（暗刻多出来的那张）也放回牌山，手里只留数牌
      for (const t of p.hand.filter((t) => kindOf(t) >= 27)) {
        const i = p.hand.indexOf(t);
        const swap = g.wall.live.findIndex((x) => kindOf(x) < 27);
        [p.hand[i], g.wall.live[swap]] = [g.wall.live[swap], t];
      }
      while (p.hand.length > 7) g.wall.live.push(p.hand.pop()!);
      expect(hatsumiOpen(g, 3)).toBe(true);
      expect(hatsumiGlowMelds(g, 3)).toEqual([0, 1]);
      const start = hatsumiGale(g, 3);
      expect(start).toBeGreaterThan(0);
      // 摸 5 次：每次都是西风或南风，摸进来打一张数牌
      for (let i = 0; i < 5; i++) {
        hatsumiAbility.beforeDraw!(g, 3, false);
        const t = g.wall.live.shift()!;
        if (kindOf(t) !== WEST && kindOf(t) !== SOUTH) {
          // 牌山里没剩的了（别人手里有），这一局凑不齐
          break;
        }
        p.hand.push(t);
        const out = p.hand.findIndex((x) => kindOf(x) < 27);
        p.hand.splice(out, 1);
      }
      const w = count(p.hand, WEST);
      const s = count(p.hand, SOUTH);
      const ok = Math.max(w, s) >= 3 && Math.min(w, s) >= 2;
      // 别人手里拿着西南时凑不齐；牌山够的局一定凑齐
      if (ok) {
        done++;
        expect(hatsumiGale(g, 3)).toBeGreaterThan(start);
        if (shanten(toCounts(p.hand), p.melds.length) === 0) expect(hatsumiGale(g, 3)).toBe(1);
      }
    }
    // 别人手里拿着西南、牌山里剩的不够时凑不齐（实战里可以碰别人打出来的）
    expect(done).toBeGreaterThan(14);
  });
});

describe('电脑的初美', () => {
  it('鸣出东北以后不打西南、不小和，奔小四喜；不坐北家时不碰没役的客风', () => {
    const me = byId('hatsumi');
    let opened = 0;
    let suushii = 0;
    let windOut = 0;
    let cheap = 0;
    let guest = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rng = new Rng(seed * 977);
      const others = rng.shuffle(CHARACTERS.filter((c) => c.id !== me.id)).slice(0, 3);
      const order = rng.shuffle([me, ...others]);
      const mine = order.indexOf(me);
      const g = new Game({ seed, format: 'east', players: order.map((c) => ({ name: c.id, ability: c.ability })) });
      // 能力这一局起作用（没被封印、没被压住）、东北都鸣出来了
      const kimon = () => hatsumiOpen(g, mine) && !g.isSealed(mine) && !g.quelled(mine);
      let wasOpen = false;
      g.onEvent((e) => {
        if (e.type === 'roundStart') wasOpen = false;
        if (e.type === 'ability' && e.seat === mine && e.text === '里鬼门') {
          wasOpen = true;
          opened++;
        }
        if (e.type === 'roundEnd' && wasOpen && e.result.wins.some((w) => w.seat === mine && w.result.yaku.some((y) => y.name.includes('四喜')))) suushii++;
      });
      let steps = 0;
      while (g.phase !== 'gameEnd' && ++steps < 20000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        const s = g.waitingSeats()[0];
        const a = chooseAction(g, s, order[s].ai);
        if (s === mine) {
          const p = g.players[mine];
          // 西南是能力送来的：手里还有别的牌可打时不打（凑刻的留三张、凑对的留两张，两张以内一定不打）
          if (a.type === 'discard' && kimon() && (kindOf(a.tile) === WEST || kindOf(a.tile) === SOUTH) && count(p.hand, kindOf(a.tile)) <= 2 && p.hand.some((t) => !isWind(kindOf(t)))) windOut++;
          // 西南还没凑齐、牌山还多时，不是役满的和不和
          if ((a.type === 'tsumo' || a.type === 'ron') && kimon() && hatsumiWindsComing(g, mine) && g.wall.remaining > HATSUMI_AI.holdLate && p.melds.length <= 3) {
            const tile = a.type === 'tsumo' ? p.drawn! : g.lastDiscard!.tile;
            if (!g.winResult(mine, tile, a.type === 'tsumo')?.yakuman) cheap++;
          }
          // 不坐北家：客风碰了没役（手里没有役牌副露时不碰）
          if (a.type === 'pon' && g.seatWind(mine) !== NORTH) {
            const k = kindOf(g.lastDiscard!.tile);
            const yakuhai = (x: number) => isDragon(x) || x === g.seatWind(mine) || x === 27 + g.roundWind;
            if (isWind(k) && !yakuhai(k) && !p.melds.some((m) => m.type !== 'chi' && yakuhai(kindOf(m.tiles[0])))) guest++;
          }
        }
        g.act(s, a);
      }
    }
    console.log({ opened, suushii, windOut, cheap, guest });
    expect(opened).toBeGreaterThan(8);
    expect(windOut).toBe(0);
    expect(cheap).toBe(0);
    expect(guest).toBe(0);
    // 鸣出东北的局多半做成小四喜（改之前这些局里有四成把送来的西南打掉了，四喜只有三分之一）
    expect(suushii / opened).toBeGreaterThan(0.45);
  }, 120000);
});

describe('泷见春', () => {
  it('别人立直以后，没听牌时摸牌进展变快', () => {
    let off = 0;
    let on = 0;
    const n = 200;
    for (let seed = 1; seed <= n; seed++) {
      for (const rush of [false, true]) {
        const g = game(seed, 1, haruAbility);
        settle(g, 1);
        const p = g.players[1];
        g.players[2].riichi = rush;
        expect(haruRush(g, 1)).toBe(rush);
        const sh = shanten(toCounts(p.hand), p.melds.length);
        haruAbility.beforeDraw!(g, 1, false);
        const c = toCounts([...p.hand, g.wall.live[0]]);
        // 摸进来以后打掉一张能不能前进
        let best = sh;
        for (let k = 0; k < 34; k++) {
          if (!c[k]) continue;
          c[k]--;
          best = Math.min(best, shanten(c, p.melds.length));
          c[k]++;
        }
        if (best < sh) rush ? on++ : off++;
      }
    }
    expect(on / n).toBeGreaterThan(off / n + HARU.speed * 0.5);
  });
});
