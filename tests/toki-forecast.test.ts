import { describe, expect, it } from 'vitest';
import { CHARACTERS, type Character } from '../src/abilities/characters';
import { kasumiSuit } from '../src/abilities/kasumi';
import { chooseAction } from '../src/ai/ai';
import { ForecastCache, forecastNextDraw } from '../src/ai/forecast';
import { Game } from '../src/engine/game';
import { TileId, kindOf, suitOf } from '../src/engine/tiles';
import { foresee } from '../src/ui/foresee';

// 怜的一巡先见改成演算以后：
// 1. 看不看预知（“你下一张”、“看下一巡”），正式牌局后面打出来一模一样
// 2. 已经生效的绝一门，不会因为怜在场、怜看预知而漏过
// 3. 有人鸣牌、开杠以后，界面拿到的是按新局面重新算的，不是旧的

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

interface Hooks {
  // 每一步之前（还没决定这一步怎么打）
  before?(g: Game): void;
  // 每一步之后
  after?(g: Game, seat: number): void;
}

function play(seed: number, seats: Character[], hooks: Hooks = {}, setup?: (g: Game) => void): Game {
  const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  setup?.(g);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    hooks.before?.(g);
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
    hooks.after?.(g, s);
  }
  return g;
}

// 玩家会做的所有预览：每张能打的牌的下一张（立直不立直都看），加上“看下一巡”
function previewEverything(g: Game, toki: number, seats: Character[]): void {
  forecastNextDraw(g, toki);
  if (g.phase !== 'turn' || g.turn !== toki) return;
  const ai = seats.map((c) => c.ai);
  for (const a of g.legalActions(toki)) {
    if (a.type !== 'discard') continue;
    forecastNextDraw(g, toki, { discard: a.tile, riichi: !!a.riichi });
  }
  const first = g.legalActions(toki).find((a) => a.type === 'discard');
  if (first?.type === 'discard') foresee(g, toki, first.tile, false, ai);
}

describe('园城寺怜：演算出来的下一张', () => {
  it('同一局面开启或不开启预览，正式牌局后面的结果一模一样', () => {
    for (const seed of [1, 2, 3]) {
      const seats = ['toki', 'awai', 'kasumi', 'koromo'].map(byId);
      const toki = 0;
      const plain = play(seed, seats);
      let previews = 0;
      const watched = play(seed, seats, {
        before: (g) => {
          previewEverything(g, toki, seats);
          previews++;
        },
      });
      // 一场里预览了很多次（淡在的话一场打得很快，少的时候不到一百次）
      expect(previews).toBeGreaterThan(50);
      expect(JSON.stringify(watched.events)).toBe(JSON.stringify(plain.events));
      expect(watched.players.map((p) => p.score)).toEqual(plain.players.map((p) => p.score));
    }
  }, 300000);

  it('这一巡没人鸣牌、开杠、和牌时，演算出的下一张就是她真的摸到的（控场都算在里面）', () => {
    let checked = 0;
    let controlled = 0;
    for (const seed of [4, 5, 6]) {
      const seats = ['toki', 'awai', 'kasumi', 'koromo'].map(byId);
      const toki = 0;
      let guess: { tile: TileId | null; from: number } | null = null;
      play(seed, seats, {
        before: (g) => {
          // 别人的回合、别人打牌后：按现在的局面算一次
          if (guess === null && !(g.phase === 'turn' && g.turn === toki)) guess = { tile: forecastNextDraw(g, toki), from: g.events.length };
        },
        after: (g) => {
          if (!guess) return;
          const since = g.events.slice(guess.from);
          if (since.some((e) => e.type === 'call' || e.type === 'roundEnd')) {
            guess = null;
            return;
          }
          if (!since.some((e) => e.type === 'draw' && e.seat === toki)) return;
          expect(g.players[toki].drawn).toBe(guess.tile);
          checked++;
          if (since.some((e) => e.type === 'ability' && e.seat !== toki)) controlled++;
          guess = null;
        },
      });
    }
    expect(checked).toBeGreaterThan(50);
    // 中间有控场发动过的也对得上
    expect(controlled).toBeGreaterThan(0);
  }, 300000);

  it('已经生效的绝一门，不因为怜在场或发动预知而额外漏过', () => {
    let checked = 0;
    let previews = 0;
    for (const seed of [1, 2, 3, 4]) {
      const seats = ['kasumi', 'toki', 'nodoka', 'saki'].map(byId);
      const kasumi = 0;
      const toki = 1;
      const inSuit = (suit: number) => (t: TileId) => kindOf(t) < 27 && suitOf(kindOf(t)) === suit;
      play(
        seed,
        seats,
        {
          before: (g) => {
            previewEverything(g, toki, seats);
            previews++;
          },
        },
        (g) => {
          // 从第一局起就请神
          (g.abilityGameState[kasumi] as { summoned?: boolean }).summoned = true;
          (g as unknown as { startRound(): void }).startRound();
          g.onEvent((e) => {
            if (e.type !== 'draw' || e.seat === kasumi || g.rinshanDraw) return;
            // 天使和挡得住一半的规矩，不算
            if ((g.active(e.seat)?.resist?.(g, e.seat) ?? 0) > 0) return;
            const suit = kasumiSuit(g, kasumi);
            if (suit === null) return;
            // 牌山里别的花色都摸光了（或被别的能力锁住）才挡不住；怜不锁牌，不算理由
            const other = g.wall.live.some((t) => !inSuit(suit)(t) && !g.wall.locked.has(t));
            if (!other) return;
            checked++;
            expect(inSuit(suit)(g.players[e.seat].drawn!)).toBe(false);
          });
        },
      );
    }
    expect(previews).toBeGreaterThan(100);
    expect(checked).toBeGreaterThan(200);
  }, 300000);

  it('鸣牌、开杠改变路线以后，界面拿到的是按新局面重新算的，不再给旧的', () => {
    let calls = 0;
    let kans = 0;
    let changed = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const seats = ['toki', 'saki', 'kuro', 'koromo'].map(byId);
      const toki = 0;
      const cache = new ForecastCache();
      let shown: TileId | null = null;
      let mark = 0;
      play(seed, seats, {
        before: (g) => {
          mark = g.events.length;
          if (!(g.phase === 'turn' && g.turn === toki)) shown = cache.get(g, toki);
        },
        after: (g) => {
          const call = g.events.slice(mark).find((e) => e.type === 'call');
          if (!call || (g.phase !== 'turn' && g.phase !== 'calls')) return;
          if (g.phase === 'turn' && g.turn === toki) return;
          calls++;
          if (call.type === 'call' && call.call.includes('杠')) kans++;
          const now = cache.get(g, toki);
          // 缓存跟着局面走：现在给的是按鸣牌以后的局面算的
          expect(cache.stateAt).toBe(ForecastCache.stateKey(g));
          expect(now).toBe(forecastNextDraw(g, toki));
          if (now !== shown) changed++;
        },
      });
    }
    expect(calls).toBeGreaterThan(10);
    expect(kans).toBeGreaterThan(0);
    // 确实有鸣牌以后下一张变了的情况：要是还给旧的，就是错的
    expect(changed).toBeGreaterThan(0);
  }, 300000);
});
