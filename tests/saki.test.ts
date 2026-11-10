import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { SAKI, bloomGap, sakiKanKinds, sakiKanOk, sakiKanTiles, sakiLine, sakiMood, sakiRinshan, sakiSeesThrough } from '../src/abilities/saki';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
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
  it('岭上牌配牌时定好，之后不变：谁开杠，摸到的都是她一开始看见的那一张', () => {
    let kans = 0;
    let rounds = 0;
    for (let seed = 1; seed <= 12; seed++) {
      play(seed, ['saki', 'nodoka', 'mihoko', 'hisa'], (g, me) => {
        // 这一局她看见的岭上牌，按摸的顺序
        let line: number[] = [];
        const start = () => {
          line = sakiRinshan(g, me);
          rounds++;
          // 四张都看得见（没人封她、削弱她）
          expect(line).toEqual(g.wall.rinshan);
          expect(line.length).toBe(4);
        };
        start();
        g.onEvent((e) => {
          if (e.type === 'roundStart') return start();
          if (e.type === 'draw' && g.rinshanDraw) {
            kans++;
            expect(g.players[e.seat].drawn).toBe(line.shift());
          }
          // 剩下的岭上牌一直是原来那几张、原来的顺序
          expect(g.wall.rinshan).toEqual(line);
        });
      });
    }
    expect(rounds).toBeGreaterThan(40);
    expect(kans).toBeGreaterThan(10);
  }, 120000);

  it('电脑的咲朝着岭上做牌：岭上开花不少，杠完和了的那一张就是岭上那张', () => {
    let kans = 0;
    let rinshanWins = 0;
    let wins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      play(seed, ['saki', 'nodoka', 'mihoko', 'hisa'], (g, me) => {
        g.onEvent((e) => {
          if (e.type === 'call' && e.seat === me && e.call.includes('杠')) kans++;
          if (e.type === 'roundEnd') {
            for (const w of e.result.wins) {
              if (w.seat !== me) continue;
              wins++;
              if (w.result.yaku.some((y) => y.name === '岭上开花')) rinshanWins++;
            }
          }
        });
      });
    }
    console.log({ kans, wins, rinshanWins });
    expect(kans).toBeGreaterThan(10);
    expect(rinshanWins).toBeGreaterThan(3);
    expect(rinshanWins).toBeGreaterThan(wins * 0.1);
  }, 120000);

  it('杠材：成刻之前不显示；成刻那一刻第四张落在她摸牌的路上，之后不再动', () => {
    let shown = 0;
    let onPath = 0;
    for (let seed = 1; seed <= 12; seed++) {
      play(seed, ['saki', 'nodoka', 'mihoko', 'hisa'], (g, me) => {
        // 看得见的第四张：它在牌山里从头数第几张（摸走的也算），现出来以后不该变
        const where = new Map<number, number>();
        // 刚现出来、还没看过在不在她路上的（等下一次有人打牌时看：那一刻谁接着摸是定的）
        let fresh: number[] = [];
        const check = () => {
          const w = g.wall;
          const kinds = sakiKanKinds(g, me);
          for (const t of sakiKanTiles(g, me)) {
            const at = w.frontDrawn + w.live.indexOf(t);
            if (!where.has(t)) {
              where.set(t, at);
              shown++;
              // 现出来的那一刻是她的杠材（手里成刻或者碰了）
              expect(kinds).toContain(kindOf(t));
              fresh.push(t);
            }
            expect(at).toBe(where.get(t));
          }
          // 没成刻的牌不显示
          for (const t of w.live) if (!where.has(t)) expect(sakiKanTiles(g, me).has(t)).toBe(false);
        };
        g.onEvent((e) => {
          if (e.type === 'roundStart') {
            where.clear();
            fresh = [];
          }
          if (e.type === 'discard') {
            for (const t of fresh) if (g.wall.live.includes(t) && (e.seat + 1 + g.wall.live.indexOf(t)) % 4 === me) onPath++;
            fresh = [];
          }
          // 成刻那一下发「杠的气息」，那一刻就看得见了
          if (e.type !== 'roundEnd') check();
        });
      });
    }
    console.log({ shown, onPath });
    expect(shown).toBeGreaterThan(20);
    // 现出来时都在她摸牌的路上（刚好被别人锁着、挪不了的除外）
    expect(onPath).toBeGreaterThan(shown * 0.9);
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

  it('电脑的咲看着岭上牌决定杠不杠：杠完正好听岭上那张才杠，废牌就留着', () => {
    const g = new Game({ seed: 3, players: [byId('saki'), byId('nodoka'), byId('mihoko'), byId('hisa')].map((c) => ({ name: c.id, ability: c.ability })) });
    const see = sakiSeesThrough(g, 0);
    for (const t of g.wall.rinshan) expect(see.has(t)).toBe(true);
    // 把第一张岭上牌摆成 k（测试里直接摆，照她看见的锁上）
    const setFirst = (k: number) => {
      const w = g.wall;
      const j = w.live.findIndex((t) => kindOf(t) === k && !w.locked.has(t));
      const old = w.rinshan[0];
      [w.rinshan[0], w.live[j]] = [w.live[j], old];
      w.locked.delete(old, 'saki-0');
      w.locked.add(w.rinshan[0], 'saki-0');
      expect(sakiLine(g, 0)[0]).toBe(k);
    };
    // 杠完的手牌 123m 456p 78s 白白，听 6s、9s
    const ready = toCounts(parseKinds('123m456p78s55z').map((k) => k * 4));
    // 岭上是 9s：杠了就是岭上开花
    setFirst(parseKinds('9s')[0]);
    expect(bloomGap(ready.slice(), 1, sakiLine(g, 0))).toBe(0);
    expect(sakiKanOk(g, 0, ready, 1)).toBe(true);
    // 岭上是废牌中：只差一张就能改成听它（单骑），先留着杠
    setFirst(33);
    expect(sakiKanOk(g, 0, ready, 1)).toBe(false);
    // 杠完离听牌还远，岭上的中也用不上：不杠
    const far = toCounts(parseKinds('19m19p19s1234z').map((k) => k * 4));
    expect(sakiKanOk(g, 0, far, 1)).toBe(false);
    // 单骑岭上那张：手里留一张中，杠了就和
    const tanki = toCounts(parseKinds('123m456p789s7z').map((k) => k * 4));
    expect(sakiKanOk(g, 0, tanki, 1)).toBe(true);
    // 再杠：岭上那张是手里暗刻的第四张，下一张岭上牌正好和了
    const w = g.wall;
    const second = kindOf(w.rinshan[1]);
    const chain = toCounts(parseKinds('123m456p').map((k) => k * 4));
    chain[33] = 3;
    chain[second] += 1;
    if (second !== 33 && chain[second] === 1) {
      expect(bloomGap(chain.slice(), 1, sakiLine(g, 0))).toBe(0);
      expect(sakiKanOk(g, 0, chain, 1)).toBe(true);
    }
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
