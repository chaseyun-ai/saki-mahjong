import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { TERU, TERU_TOP, teruLadder, teruMirrored, teruTier } from '../src/abilities/teru';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import type { WinResult } from '../src/engine/score';
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

  it('天梯只算役的番数：宝牌、赤宝牌、里宝牌加的番不算', () => {
    const r = (han: number, dora = 0, aka = 0, ura = 0, yakuman = 0) => ({ han, dora, aka, ura, yakuman }) as WinResult;
    expect(teruTier(r(3, 1, 1, 0))).toBe(1);
    expect(teruTier(r(4, 0, 0, 2))).toBe(2);
    expect(teruTier(r(7, 2, 0, 0))).toBe(5);
    expect(teruTier(r(9, 1, 1, 1))).toBe(6);
    expect(teruTier(r(10, 2, 0, 0))).toBe(7);
    expect(teruTier(r(12, 1, 0, 0))).toBe(8);
    expect(teruTier(r(16, 3, 0, 0))).toBe(TERU_TOP);
    expect(teruTier(r(0, 0, 0, 0, 1))).toBe(TERU_TOP);
  });

  it('天梯：起胡 1 番，每次正好和出下一层才往上爬；大了小了、别人和、流局都从塔底重来，役满直接登顶', () => {
    let climbed = 0;
    let broken = 0;
    let top = 0;
    for (let seed = 1; seed <= 30; seed++) {
      play(seed, LINEUPS[seed % 4], {
        setup: (g, me) => {
          // 自己按规则记一份，和能力里的对照
          let level = 0;
          g.onEvent((e) => {
            if (e.type === 'roundStart') expect(teruLadder(g, me).level).toBe(level);
            if (e.type !== 'roundEnd' || e.result.kind === 'abortive') return;
            const w = e.result.wins.find((x) => x.seat === me);
            const next = level >= TERU_TOP ? 1 : level + 1;
            const tier = w ? teruTier(w.result) : 0;
            if (w && (tier === next || tier === TERU_TOP)) {
              climbed++;
              level = tier === TERU_TOP ? TERU_TOP : next;
              if (level === TERU_TOP) top++;
            } else {
              if (level > 0 && level < TERU_TOP) broken++;
              level = 0;
            }
          });
        },
      });
    }
    expect(climbed).toBeGreaterThan(5);
    expect(broken).toBeGreaterThan(0);
    console.log({ climbed, broken, top });
  }, 120000);

  it('站得越高摸牌越容易是进张（还没听牌时）；电脑的照不和比下一层小的牌（牌山还多时）', () => {
    const n = { high: 0, highGood: 0, low: 0, lowGood: 0, skipped: 0 };
    for (let seed = 1; seed <= 30; seed++) {
      play(seed, LINEUPS[seed % 4], {
        before: (g, me) => {
          if (g.phase === 'turn' && g.turn !== me) return;
          if (!teruMirrored(g, me) || g.wall.remaining <= TERU.aiForceWin) return;
          const win = g.legalActions(me).find((a) => a.type === 'tsumo' || a.type === 'ron');
          if (!win) return;
          const tsumo = win.type === 'tsumo';
          const tile = tsumo ? g.players[me].drawn! : g.callKind === 'chankan' ? g.kakanInfo!.tile : g.lastDiscard!.tile;
          const tier = teruTier(g.winResult(me, tile, tsumo)!);
          const a = chooseAction(g, me, byId('teru').ai).type;
          if (tier < teruLadder(g, me).next) {
            n.skipped++;
            expect(a).not.toBe(win.type);
          } else if (!g.isLastRounds(1)) expect(a).toBe(win.type);
        },
        setup: (g, me) => {
          // 隔一局把她放到跳满那一层（配牌已经发完，只看摸牌）
          let rounds = 0;
          g.onEvent((e) => {
            if (e.type === 'roundStart' && ++rounds % 2 === 0) (g.abilityGameState[me] as { level?: number }).level = 6;
            if (e.type !== 'draw' || e.seat !== me || g.rinshanDraw || !teruMirrored(g, me)) return;
            const p = g.players[me];
            const before = shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
            // 听牌时只给接得上天梯的和了牌，只比较还没听牌的摸牌
            if (before <= 0) return;
            const good = shanten(toCounts(p.hand), p.melds.length) < before ? 1 : 0;
            const level = teruLadder(g, me).level;
            if (level === 6) {
              n.high++;
              n.highGood += good;
            } else if (level === 0) {
              n.low++;
              n.lowGood += good;
            }
          });
        },
      });
    }
    expect(n.high).toBeGreaterThan(40);
    expect(n.highGood / n.high).toBeGreaterThan(n.lowGood / n.low + 0.1);
    console.log({ high: (n.highGood / n.high).toFixed(2), low: (n.lowGood / n.low).toFixed(2), skipped: n.skipped });
  }, 120000);

  it('叽叽叽：自摸满八次，下一局配牌是九莲宝灯的听牌，和出九莲宝灯以后从头数', () => {
    let chuuren = 0;
    let tries = 0;
    for (let seed = 1; seed <= 8; seed++) {
      play(seed, LINEUPS[seed % 4], {
        setup: (g, me) => {
          let armed = false;
          let fired = false;
          let done = false;
          g.onEvent((e) => {
            // 第一局结束时把自摸次数拨到 8
            if (e.type === 'roundEnd' && !armed) {
              armed = true;
              (g.abilityGameState[me] as { kiki?: number }).kiki = TERU.kiki;
            }
            if (e.type === 'ability' && e.seat === me && e.text === '叽叽叽') {
              tries++;
              fired = true;
              const p = g.players[me];
              expect(shanten(toCounts(p.hand.slice(0, 13)), 0)).toBeLessThanOrEqual(0);
            }
            if (e.type === 'roundEnd' && fired) {
              fired = false;
              const w = e.result.wins.find((x) => x.seat === me);
              if (w?.result.yaku.some((y) => y.name.includes('九莲宝灯'))) {
                chuuren++;
                done = true;
              }
            }
            if (e.type === 'roundStart' && done) expect(teruLadder(g, me).kiki).toBeLessThan(TERU.kiki);
          });
        },
      });
    }
    expect(tries).toBeGreaterThan(4);
    expect(chuuren / tries).toBeGreaterThan(0.6);
    console.log({ tries, chuuren });
  }, 120000);
  it('压制：照魔镜看过以后，别人摸到进张的比例比没有照的桌子低', () => {
    const rate = (ids: string[]) => {
      const n = [0, 0];
      for (let seed = 1; seed <= 12; seed++) {
        play(seed, ids, {
          setup: (g) => {
            g.onEvent((e) => {
              if (e.type !== 'draw' || g.rinshanDraw || g.round === 0) return;
              const p = g.players[e.seat];
              if (ids[e.seat] === 'teru') return;
              const before = shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
              if (before <= 0) return;
              n[0]++;
              if (shanten(toCounts(p.hand), p.melds.length) < before) n[1]++;
            });
          },
        });
      }
      return n[1] / n[0];
    };
    const withTeru = rate(['teru', 'izumi', 'izumi', 'izumi']);
    const without = rate(['izumi', 'izumi', 'izumi', 'izumi']);
    console.log({ withTeru: withTeru.toFixed(2), without: without.toFixed(2) });
    expect(withTeru).toBeLessThan(without - 0.05);
  }, 120000);
});
