import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { SAKI, sakiKanOk, sakiMood, sakiSeesThrough } from '../src/abilities/saki';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { waitingKinds } from '../src/engine/shanten';
import { kindOf, parseKinds, parseTiles, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function play(seed: number, ids: string[], hook: (g: Game, me: number) => void) {
  const seats = ids.map(byId);
  const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  const me = ids.indexOf('saki');
  hook(g, me);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return g;
}

describe('宫永咲', () => {
  it('听牌时开杠，岭上牌就是和了牌；电脑的咲大多在听牌后才杠', () => {
    let kans = 0;
    let ready = 0;
    let rinshanWins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      play(seed, ['saki', 'nodoka', 'mihoko', 'hisa'], (g, me) => {
        let tenpaiKan = false;
        g.onEvent((e) => {
          if (e.type === 'call' && e.seat === me && e.call.includes('杠')) {
            kans++;
            const p = g.players[me];
            tenpaiKan = waitingKinds(toCounts(p.hand), p.melds.length).length > 0 && !!g.active(me) && !g.isSealed(me);
            if (tenpaiKan) ready++;
          }
          if (e.type === 'draw' && e.seat === me && g.rinshanDraw && tenpaiKan) {
            tenpaiKan = false;
            const p = g.players[me];
            const waits = waitingKinds(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
            const left = [...g.wall.live, ...g.wall.rinshan, p.drawn!].some((t) => waits.includes(kindOf(t)));
            // 和了牌全被别人拿走、打出去了时没得摸
            if (left) expect(g.legalActions(me).some((a) => a.type === 'tsumo')).toBe(true);
          }
          if (e.type === 'roundEnd') {
            for (const w of e.result.wins) if (w.seat === me && w.result.yaku.some((y) => y.name === '岭上开花')) rinshanWins++;
          }
        });
      });
    }
    console.log({ kans, ready, rinshanWins });
    expect(kans).toBeGreaterThan(10);
    expect(ready).toBeGreaterThan(kans * 0.6);
    expect(rinshanWins).toBeGreaterThan(5);
  }, 120000);

  it('配牌偏对子：没人动她配牌时，配牌至少 2 个对子', () => {
    let deals = 0;
    let paired = 0;
    for (let seed = 1; seed <= 10; seed++) {
      play(seed, ['saki', 'nodoka', 'mihoko', 'hisa'], (g, me) => {
        const check = () => {
          const c = toCounts(g.players[me].hand.filter((t) => t !== g.players[me].drawn));
          deals++;
          if (c.filter((x) => x >= 2).length >= SAKI.dealPairs) paired++;
        };
        check();
        g.onEvent((e) => {
          if (e.type === 'roundStart') check();
        });
      });
    }
    expect(deals).toBeGreaterThan(30);
    expect(paired).toBeGreaterThan(deals * 0.9);
  }, 60000);

  it('天意：离正负零（30000）远了发力，领先太多收手', () => {
    const g = new Game({ seed: 1, players: [byId('saki'), byId('nodoka'), byId('mihoko'), byId('hisa')].map((c) => ({ name: c.id, ability: c.ability })) });
    g.players[0].score = 30000;
    expect(sakiMood(g, 0)).toBe('even');
    g.players[0].score = SAKI.target - SAKI.pushBelow;
    expect(sakiMood(g, 0)).toBe('push');
    g.players[0].score = SAKI.target + SAKI.calmAbove;
    expect(sakiMood(g, 0)).toBe('calm');
  });

  it('王牌感知：看得穿岭上牌和牌山里杠材的第四张；没听牌、岭上牌也用不上时不杠', () => {
    const g = new Game({ seed: 3, players: [byId('saki'), byId('nodoka'), byId('mihoko'), byId('hisa')].map((c) => ({ name: c.id, ability: c.ability })) });
    const see = sakiSeesThrough(g, 0);
    for (const t of g.wall.rinshan) expect(see.has(t)).toBe(true);
    // 杠完离听牌还远，岭上牌是一张用不上的中
    const after = toCounts(parseKinds('19m19p19s1234z').map((k) => k * 4));
    const junk = g.wall.live.findIndex((t) => kindOf(t) === 33);
    [g.wall.rinshan[0], g.wall.live[junk]] = [g.wall.live[junk], g.wall.rinshan[0]];
    expect(sakiKanOk(g, 0, after, 1)).toBe(false);
    // 岭上牌能让手牌前进：杠
    const ready = toCounts(parseKinds('123m456p78s1z5z').map((k) => k * 4));
    const five = g.wall.live.findIndex((t) => kindOf(t) === 31);
    [g.wall.rinshan[0], g.wall.live[five]] = [g.wall.live[five], g.wall.rinshan[0]];
    expect(sakiKanOk(g, 0, ready, 1)).toBe(true);
  });

  it('对子多的配牌：摸到成刻的牌不打，往一般型做、留着杠材（七对子开不了杠）', () => {
    const g = new Game({ seed: 1, players: [byId('saki'), byId('nodoka'), byId('mihoko'), byId('hisa')].map((c) => ({ name: c.id, ability: c.ability })) });
    const p = g.players[0];
    // 4477m 22s 33s 南南 加摸来的三索成刻：七对子、一般型都是一向听，按七对子的进张会打三索
    p.hand = parseTiles('13m4477m22333s22z3z');
    p.drawn = p.hand.filter((t) => kindOf(t) === parseKinds('3s')[0])[2];
    const steady = { mistakeRate: 0 };
    const saki = chooseAction(g, 0, { ...byId('saki').ai, ...steady });
    expect(saki.type).toBe('discard');
    if (saki.type === 'discard') expect(kindOf(saki.tile)).not.toBe(parseKinds('3s')[0]);
    // 没有杠的能力的人照七对子的进张打（通用电脑不变）
    const plain = chooseAction(g, 0, { ...byId('izumi').ai, ...steady });
    expect(plain.type === 'discard' && kindOf(plain.tile)).toBe(parseKinds('3s')[0]);
  });

  it('整场下来：门清没立直时摸到成刻的牌，很少当场打掉', () => {
    let drawn = 0;
    let broke = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const seats = ['saki', 'nodoka', 'mihoko', 'hisa'].map(byId);
      const g = new Game({ seed, format: 'south', players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
      let steps = 0;
      while (g.phase !== 'gameEnd' && ++steps < 20000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        const s = g.waitingSeats()[0];
        const a = chooseAction(g, s, seats[s].ai);
        const p = g.players[0];
        if (s === 0 && g.phase === 'turn' && a.type === 'discard' && p.drawn !== null && !p.riichi && p.melds.length === 0 && toCounts(p.hand)[kindOf(p.drawn)] === 3) {
          drawn++;
          if (kindOf(a.tile) === kindOf(p.drawn)) broke++;
        }
        g.act(s, a);
      }
    }
    console.log({ drawn, broke });
    // 改之前按七对子的进张打，一成多当场打掉；现在只剩失误和一般型里确实该打的
    expect(drawn).toBeGreaterThan(60);
    expect(broke).toBeLessThan(drawn * 0.05);
  }, 120000);
});
