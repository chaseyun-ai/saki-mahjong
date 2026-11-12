import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { TERU, TERU_LADDER, TERU_TOP, teruDanger, teruLadder, teruMirrored, teruTier, teruWinValue } from '../src/abilities/teru';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import type { WinResult } from '../src/engine/score';
import { shanten } from '../src/engine/shanten';
import { parseKinds, parseTiles, toCounts } from '../src/engine/tiles';

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

// 默认是按打点递增的连和；原来的天梯留着，那一组测试换回去跑
const POINTS = { ...TERU };

describe('宫永照（按打点递增的连和）', () => {
  it('每次和了的点数比上一次高就接上；和小了算新一轮的第一次；别人和了、流局就断', () => {
    const n = { up: 0, restart: 0, broke: 0, max: 0 };
    for (let seed = 1; seed <= 30; seed++) {
      play(seed, LINEUPS[seed % 4], {
        setup: (g, me) => {
          // 自己按规则记一份，和能力里的对照
          let streak: number[] = [];
          let dealer = false;
          g.onEvent((e) => {
            if (e.type === 'roundStart') {
              const l = teruLadder(g, me);
              expect(l.level).toBe(Math.min(streak.length, 8));
              expect(l.last).toBe(streak.at(-1) ?? 0);
              expect(l.streak).toEqual(streak.slice(-8));
              dealer = me === g.dealer;
              n.max = Math.max(n.max, streak.length);
            }
            if (e.type !== 'roundEnd' || e.result.kind === 'abortive') return;
            // 淡这一局开过平行宇宙：连和已经清掉了
            if (teruLadder(g, me).broke === '平行宇宙') streak = [];
            const w = e.result.wins.find((x) => x.seat === me);
            if (!w) {
              if (streak.length) n.broke++;
              streak = [];
              return;
            }
            const v = teruWinValue(w.result, w.from === null, dealer);
            if (!streak.length || v > streak.at(-1)!) {
              streak.push(v);
              n.up++;
            } else {
              streak = [v];
              n.restart++;
            }
          });
        },
      });
    }
    expect(n.up).toBeGreaterThan(40);
    expect(n.max).toBeGreaterThanOrEqual(4);
    expect(n.broke).toBeGreaterThan(0);
    console.log(n);
  }, 300000);

  it('起胡便宜、宝牌少：起胡的那一次多半在 2000 点以内，她和的牌里宝牌平均不到半张', () => {
    const first: number[] = [];
    let wins = 0;
    let dora = 0;
    for (let seed = 1; seed <= 30; seed++) {
      play(seed, LINEUPS[seed % 4], {
        setup: (g, me) => {
          let dealer = false;
          let level = 0;
          g.onEvent((e) => {
            if (e.type === 'roundStart') {
              dealer = me === g.dealer;
              level = teruLadder(g, me).level;
            }
            if (e.type !== 'roundEnd') return;
            const w = e.result.wins.find((x) => x.seat === me);
            if (!w) return;
            wins++;
            dora += w.result.dora + w.result.aka;
            if (level === 0) first.push(teruWinValue(w.result, w.from === null, dealer) / (dealer ? 1.5 : 1));
          });
        },
      });
    }
    const cheap = first.filter((v) => v <= 2000).length / first.length;
    console.log({ first: first.length, cheap: cheap.toFixed(2), dora: (dora / wins).toFixed(2) });
    expect(first.length).toBeGreaterThan(20);
    expect(cheap).toBeGreaterThan(0.5);
    expect(dora / wins).toBeLessThan(0.5);
  }, 240000);
});

describe('宫永照（原来的天梯）', () => {
  beforeAll(() => {
    Object.assign(TERU, TERU_LADDER);
  });
  afterAll(() => {
    Object.assign(TERU, POINTS);
  });

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
            // 淡这一局开过平行宇宙：天梯已经被打回塔底
            if (teruLadder(g, me).broke === '平行宇宙') level = 0;
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
  }, 180000);

  it('叽叽叽：自摸满八次，下一局配牌是九莲宝灯的听牌，和出九莲宝灯以后从头数', () => {
    let chuuren = 0;
    let tries = 0;
    for (let seed = 1; seed <= 12; seed++) {
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
      for (let seed = 1; seed <= 40; seed++) {
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
    // 实际差距在 0.05 左右（80 场：0.22 对 0.28），12 场、门槛 0.05 时随机数流向一变就可能过不了，所以多打几场、门槛放到 0.04
    expect(withTeru).toBeLessThan(without - 0.04);
  }, 240000);
  it('铳牌：照魔镜看过以后，读得出立直的人听的牌；没立直的、第一局都不算', () => {
    const g = new Game({ seed: 1, players: ['teru', 'kuro', 'mako', 'ako'].map((id) => ({ name: id, ability: byId(id).ability })) });
    const p = g.players[1];
    p.hand = parseTiles('13m456p678s789m55s');
    p.melds = [];
    p.riichi = true;
    const gs = (g.abilityGameState[0] ??= {}) as { rounds?: number };
    gs.rounds = 1;
    expect(teruDanger(g, 0).size).toBe(0);
    gs.rounds = 2;
    expect([...teruDanger(g, 0)]).toEqual(parseKinds('2m'));
    p.riichi = false;
    expect(teruDanger(g, 0).size).toBe(0);
  });
});
