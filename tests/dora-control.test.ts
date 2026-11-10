import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { kuroSeat, settleUra, shizunoMountain, tilesOf } from '../src/abilities/doraControl';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { doraFromIndicator, kindOf, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function play(seed: number, ids: string[], setup: (g: Game) => void) {
  const seats = ids.map(byId);
  const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  setup(g);
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

// 每翻开一张新的杠宝牌调一次 onFlip(第几张, 开杠的人)
function watchFlips(g: Game, onFlip: (i: number, kanner: number) => void) {
  let seen = 1;
  g.onEvent((e) => {
    if (e.type === 'roundStart') seen = g.wall.doraRevealed;
    while (g.wall.doraRevealed > seen) {
      onFlip(seen, g.kanBy[seen - 1]);
      seen++;
    }
  });
}

const pointsAt = (g: Game, i: number) => doraFromIndicator(kindOf(g.wall.doraIndicators[i]));

describe('宝牌控制：松实玄', () => {
  const LINEUPS = [
    ['kuro', 'saki', 'nelly', 'sawaya'],
    ['saki', 'kuro', 'shizuno', 'nodoka'],
    ['awai', 'saki', 'kuro', 'nelly'],
    ['shizuno', 'nelly', 'saki', 'kuro'],
  ];

  it('能力还在时，别人立直和牌中不了里宝牌', async () => {
    let wins = 0;
    for (let seed = 1; seed <= 24; seed++) {
      play(seed, LINEUPS[seed % 4], (g) => {
        g.onEvent((e) => {
          if (e.type !== 'roundEnd' || e.result.kind !== 'win') return;
          const kuro = kuroSeat(g);
          if (kuro === null) return;
          for (const w of e.result.wins) {
            if (w.seat === kuro || !g.players[w.seat].riichi) continue;
            wins++;
            expect(w.result.ura).toBe(0);
          }
        });
      });
      // 打完一场歇一下，让测试进程能回应主进程（文件里第一个测试一口气算一分钟以上，vitest 会报 Timeout calling "onTaskUpdate"）
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(wins).toBeGreaterThan(10);
  }, 180000);

  it('能力还在时，新翻的杠宝牌几乎不指向别人手里、副露已有的牌', () => {
    let flips = 0;
    let clean = 0;
    for (let seed = 1; seed <= 24; seed++) {
      play(seed, LINEUPS[seed % 4], (g) => {
        watchFlips(g, (i) => {
          const kuro = kuroSeat(g);
          if (kuro === null) return;
          flips++;
          const others = toCounts([0, 1, 2, 3].filter((s) => s !== kuro).flatMap((s) => tilesOf(g, s)));
          if (others[pointsAt(g, i)] === 0) clean++;
        });
      });
    }
    console.log(`玄在场：杠宝牌 ${flips} 张，不指向别人的 ${clean} 张`);
    expect(flips).toBeGreaterThan(10);
    expect(clean / flips).toBeGreaterThan(0.9);
  }, 180000);
});

describe('宝牌控制：宫永咲', () => {
  it('她开杠翻出的杠宝牌一般不指向她自己的牌（没有稳乃、玄时）', () => {
    const LINEUPS = [
      ['saki', 'nodoka', 'yuuki', 'mako'],
      ['hisa', 'saki', 'koromo', 'nodoka'],
      ['toki', 'teru', 'saki', 'mihoko'],
      ['sera', 'kasumi', 'hiroe', 'saki'],
    ];
    let flips = 0;
    let clean = 0;
    for (let seed = 1; seed <= 28; seed++) {
      const ids = LINEUPS[seed % 4];
      const saki = ids.indexOf('saki');
      play(seed, ids, (g) => {
        watchFlips(g, (i, kanner) => {
          if (kanner !== saki || g.isSealed(saki) || g.quelled(saki)) return;
          flips++;
          if (toCounts(tilesOf(g, saki))[pointsAt(g, i)] === 0) clean++;
        });
      });
    }
    console.log(`咲开杠：杠宝牌 ${flips} 张，不指向她的 ${clean} 张`);
    expect(flips).toBeGreaterThan(20);
    expect(clean / flips).toBeGreaterThan(0.9);
  }, 180000);

  it('满 6 个标记的稳乃在场时，咲的杠有时会给自己杠出宝牌', () => {
    let flips = 0;
    let hit = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const ids = seed % 2 ? ['saki', 'shizuno', 'nodoka', 'yuuki'] : ['shizuno', 'saki', 'mako', 'hisa'];
      const saki = ids.indexOf('saki');
      play(seed, ids, (g) => {
        // 稳乃一开场就有 6 个以上标记（当作被平行宇宙清掉的那一局是第 -6 局）
        (g.abilityGameState[ids.indexOf('shizuno')] as { reset?: number }).reset = -6;
        watchFlips(g, (i, kanner) => {
          if (kanner !== saki || !shizunoMountain(g)) return;
          flips++;
          if (toCounts(tilesOf(g, saki))[pointsAt(g, i)] > 0) hit++;
        });
      });
    }
    console.log(`稳乃深山里咲开杠：杠宝牌 ${flips} 张，指向咲的 ${hit} 张`);
    expect(flips).toBeGreaterThan(5);
    expect(hit).toBeGreaterThan(0);
  }, 180000);
});

describe('宝牌控制：里宝牌按和牌的人定', () => {
  it('涅莉押 2 点和爽的海神威同桌：谁和牌里宝牌就听谁的（押 3 点另有 11–12 番的定法）', () => {
    let checks = 0;
    let hits = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const ids = seed % 2 ? ['nelly', 'sawaya', 'nodoka', 'saki'] : ['sawaya', 'mako', 'nelly', 'yuuki'];
      const nelly = ids.indexOf('nelly');
      play(seed, ids, (g) => {
        g.onEvent((e) => {
          // 爽刚打完牌（以前她在这里把里宝牌改回万子），假装涅莉这时押了 2 点、立直荣和
          if (e.type !== 'discard' || e.seat === nelly || g.isSealed(nelly) || g.quelled(nelly)) return;
          const p = g.players[nelly];
          const counts = toCounts([...p.hand, ...p.melds.filter((m) => m.type === 'ankan').flatMap((m) => m.tiles)]);
          const most = Math.max(...counts);
          // 指示牌全都在明处时换不到，不算
          const w = g.wall;
          const pool = [...w.uraIndicators, ...w.live, ...w.rinshan].filter((t) => !w.locked.has(t)).map((t) => doraFromIndicator(kindOf(t)));
          if (!counts.some((n, k) => n === most && pool.includes(k))) return;
          const st = g.abilityState[nelly] as { bet?: number };
          const was = [p.riichi, st.bet] as const;
          p.riichi = true;
          st.bet = 2;
          // 押 2 点的局爽的蛇神威封得住她（押 3 点才挡得住）
          const sealed = g.isSealed(nelly);
          if (!sealed) settleUra(g, [nelly]);
          [p.riichi, st.bet] = was;
          if (sealed) return;
          checks++;
          if (counts[doraFromIndicator(kindOf(g.wall.uraIndicators[0]))] === most) hits++;
        });
      });
    }
    console.log(`涅莉荣和时里宝牌：${checks} 次，指向她最多的牌 ${hits} 次`);
    expect(checks).toBeGreaterThan(20);
    expect(hits / checks).toBeGreaterThan(0.85);
  }, 180000);
});
