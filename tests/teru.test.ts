import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { TERU, teruMirrored, teruStreak, teruWinValue } from '../src/abilities/teru';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function play(seed: number, ids: string[], hooks: { before?(g: Game, me: number): void; setup?(g: Game, me: number): void } = {}) {
  const seats = ids.map(byId);
  const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  const me = ids.indexOf('teru');
  hooks.setup?.(g, me);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    hooks.before?.(g, me);
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return { g, me };
}

const LINEUPS = [
  ['teru', 'saki', 'nodoka', 'kuro'],
  ['koromo', 'teru', 'hiroe', 'awai'],
  ['toki', 'kasumi', 'teru', 'nodoka'],
  ['nodoka', 'saki', 'hiroe', 'teru'],
];

describe('宫永照', () => {
  it('照魔镜：第一局和不了牌，第二局起可以和', () => {
    let firstRoundChecks = 0;
    let laterWins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { g, me } = play(seed, LINEUPS[seed % 4], {
        before: (g, me) => {
          const acts = g.legalActions(me);
          if (!teruMirrored(g, me)) {
            firstRoundChecks++;
            expect(acts.some((a) => a.type === 'tsumo' || a.type === 'ron')).toBe(false);
          }
        },
        setup: (g, me) => {
          // 第一局在建对局时就开始了，监听装上时已经在第一局
          let round = 1;
          g.onEvent((e) => {
            if (e.type === 'roundStart') round++;
            if (e.type === 'roundEnd' && e.result.wins.some((w) => w.seat === me)) {
              expect(round).toBeGreaterThan(1);
              laterWins++;
            }
          });
        },
      });
      expect(teruMirrored(g, me)).toBe(g.events.filter((e) => e.type === 'roundStart').length > 1);
    }
    expect(firstRoundChecks).toBeGreaterThan(20);
    expect(laterWins).toBeGreaterThan(3);
  }, 120000);

  it('连续和了：每次和了都不小于上一次才接上；和小了、别人和、流局就断', () => {
    let kept = 0;
    let broken = 0;
    for (let seed = 1; seed <= 30; seed++) {
      play(seed, LINEUPS[seed % 4], {
        setup: (g, me) => {
          // 自己按规则记一份，和能力里的对照
          let count = 0;
          let last = 0;
          let dealer = false;
          g.onEvent((e) => {
            if (e.type === 'roundStart') {
              expect(teruStreak(g, me).count).toBe(count);
              if (count) expect(teruStreak(g, me).min).toBe(last);
              dealer = g.dealer === me;
            }
            if (e.type !== 'roundEnd' || e.result.kind === 'abortive') return;
            const w = e.result.wins.find((x) => x.seat === me);
            if (!w) {
              if (count) broken++;
              count = 0;
              return;
            }
            const v = teruWinValue(w.result, w.from === null, dealer);
            if (count === 0 || v >= last) {
              if (count) kept++;
              count++;
              last = v;
            } else {
              broken++;
              count = 0;
            }
          });
        },
      });
    }
    expect(kept).toBeGreaterThan(0);
    expect(broken).toBeGreaterThan(0);
  }, 120000);

  it('连和中摸牌容易摸到进张；电脑的照不和不够大的牌（牌山还多时）', () => {
    let streakDraws = 0;
    let streakUseful = 0;
    let plainDraws = 0;
    let plainUseful = 0;
    let smallSkipped = 0;
    for (let seed = 1; seed <= 30; seed++) {
      play(seed, LINEUPS[seed % 4], {
        before: (g, me) => {
          if (g.phase === 'turn' && g.turn !== me) return;
          const acts = g.legalActions(me);
          const win = acts.find((a) => a.type === 'tsumo' || a.type === 'ron');
          const { count, min } = teruStreak(g, me);
          if (!win || count === 0 || g.wall.remaining <= TERU.aiForceWin) return;
          const tsumo = win.type === 'tsumo';
          const tile = tsumo ? g.players[me].drawn! : g.callKind === 'chankan' ? g.kakanInfo!.tile : g.lastDiscard!.tile;
          const v = teruWinValue(g.winResult(me, tile, tsumo)!, tsumo, me === g.dealer);
          if (v < min) {
            smallSkipped++;
            expect(chooseAction(g, me, byId('teru').ai).type).not.toBe(win.type);
          }
        },
        setup: (g, me) => {
          g.onEvent((e) => {
            if (e.type !== 'draw' || e.seat !== me || g.rinshanDraw) return;
            const p = g.players[me];
            const before = shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
            const useful = shanten(toCounts(p.hand), p.melds.length) < before;
            if (teruStreak(g, me).count) {
              streakDraws++;
              if (useful) streakUseful++;
            } else {
              plainDraws++;
              if (useful) plainUseful++;
            }
          });
        },
      });
    }
    expect(streakDraws).toBeGreaterThan(100);
    expect(streakUseful / streakDraws).toBeGreaterThan(plainUseful / plainDraws + 0.05);
    console.log({ streak: (streakUseful / streakDraws).toFixed(2), plain: (plainUseful / plainDraws).toFixed(2), smallSkipped });
  }, 120000);
});
