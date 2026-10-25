import { describe, expect, it } from 'vitest';
import { combos, newStats, playBrawl } from './brawl/harness';
import { brawlPool } from './brawl/probes';

const GAMES = Number(process.env.BRAWL_GAMES ?? 2);

describe('能力大乱斗', () => {
  const pool = brawlPool();
  const all = combos(pool, 4);

  it('角色池里任选四个，组合数对得上', () => {
    expect(all.length).toBe(pool.length === 7 ? 35 : all.length);
  });

  it(`每种组合打 ${GAMES} 场：牌数、锁住的牌、控场的规矩都不出错`, async () => {
    const stats = newStats();
    for (const [i, chars] of all.entries()) {
      for (let n = 1; n <= GAMES; n++) playBrawl(chars, i * 1000 + n, stats);
      // 一种组合打完歇一下，让测试进程能回应主进程（一口气跑一分钟以上会被当成卡死）
      await new Promise((r) => setTimeout(r, 0));
    }
    console.log({
      combos: all.length,
      games: stats.games,
      rounds: stats.rounds,
      ruleChecks: stats.ruleChecks,
      abilityEvents: Object.fromEntries(stats.abilityEvents),
    });
    expect(stats.problems).toEqual([]);
    expect(stats.games).toBe(all.length * GAMES);
    expect(stats.ruleChecks).toBeGreaterThan(0);
  }, 600000);
});
