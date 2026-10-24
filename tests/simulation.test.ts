import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { TILE_COUNT } from '../src/engine/tiles';

function tilesInPlay(g: Game): number[] {
  const all = [...g.wall.allTiles()];
  // 加杠等别人抢杠时，那张牌既不在手里也还没进副露
  if (g.kakanInfo) all.push(g.kakanInfo.tile);
  for (const p of g.players) {
    all.push(...p.hand);
    p.melds.forEach((m) => all.push(...m.tiles));
    p.discards.forEach((d) => {
      if (!d.called) all.push(d.tile);
    });
  }
  return all;
}

// 让四个电脑打完整场，检查规则引擎不会出错，牌和点数守恒
function playGame(seed: number) {
  const g = new Game({ seed, players: CHARACTERS.map((c) => ({ name: c.name, ability: c.ability })) });
  const stats = { rounds: 0, wins: 0, abilityEvents: 0, yaku: new Map<string, number>() };
  g.onEvent((e) => {
    if (e.type === 'ability') stats.abilityEvents++;
    if (e.type === 'roundEnd') {
      stats.rounds++;
      for (const w of e.result.wins) {
        stats.wins++;
        for (const y of w.result.yaku) stats.yaku.set(y.name, (stats.yaku.get(y.name) ?? 0) + 1);
      }
    }
  });
  let steps = 0;
  while (g.phase !== 'gameEnd') {
    if (++steps > 20000) throw new Error('对局没有结束');
    if (g.phase === 'roundEnd') {
      const total = g.players.reduce((s, p) => s + p.score, 0) + g.riichiSticks * 1000;
      expect(total).toBe(100000);
      g.nextRound();
      continue;
    }
    const seat = g.waitingSeats()[0];
    g.act(seat, chooseAction(g, seat, CHARACTERS[seat].ai));
    if (g.phase === 'turn' || g.phase === 'calls') {
      const tiles = tilesInPlay(g);
      // 被吃碰的牌在副露里，已经从牌河里排除
      expect(tiles.length).toBe(TILE_COUNT);
      expect(new Set(tiles).size).toBe(TILE_COUNT);
    }
  }
  const total = g.players.reduce((s, p) => s + p.score, 0) + g.riichiSticks * 1000;
  expect(total).toBe(100000);
  return { g, stats };
}

const GAMES = Number(process.env.SIM_GAMES ?? 20);

describe('整场模拟', () => {
  it(`${GAMES} 场电脑对局都能正常结束`, () => {
    let rounds = 0;
    let wins = 0;
    let ability = 0;
    const yaku = new Map<string, number>();
    const winsBySeat = [0, 0, 0, 0];
    for (let seed = 1; seed <= GAMES; seed++) {
      const { g, stats } = playGame(seed);
      rounds += stats.rounds;
      wins += stats.wins;
      ability += stats.abilityEvents;
      stats.yaku.forEach((n, k) => yaku.set(k, (yaku.get(k) ?? 0) + n));
      winsBySeat[g.ranking()[0]]++;
    }
    console.log({ rounds, wins, ability, firstPlaceBySeat: winsBySeat });
    console.log([...yaku.entries()].sort((a, b) => b[1] - a[1]));
    expect(wins).toBeGreaterThan(rounds * 0.4);
  }, 120000);
});

describe('园城寺怜的立直', () => {
  it('立直后只要没人鸣牌，下一巡一定能自摸', () => {
    const toki = CHARACTERS.findIndex((c) => c.id === 'toki');
    let riichis = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const g = new Game({ seed, players: CHARACTERS.map((c) => ({ name: c.name, ability: c.ability })) });
      let watching = false;
      g.onEvent((e) => {
        if (e.type === 'discard' && e.seat === toki && e.riichi) {
          watching = true;
          riichis++;
        }
        if (e.type === 'call' || e.type === 'roundEnd') watching = false;
        if (e.type === 'draw' && e.seat === toki && watching) {
          expect(g.legalActions(toki).some((a) => a.type === 'tsumo')).toBe(true);
          watching = false;
        }
      });
      let steps = 0;
      while (g.phase !== 'gameEnd' && ++steps < 20000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        const seat = g.waitingSeats()[0];
        g.act(seat, chooseAction(g, seat, CHARACTERS[seat].ai));
      }
    }
    expect(riichis).toBeGreaterThan(0);
  }, 120000);
});
