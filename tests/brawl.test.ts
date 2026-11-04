import { describe, expect, it } from 'vitest';
import { newStats, playBrawl, sampleCombos } from './brawl/harness';
import { brawlPool } from './brawl/probes';

const GAMES = Number(process.env.BRAWL_GAMES ?? 2);

describe('能力大乱斗', () => {
  const pool = brawlPool();
  // 全部组合太多时只打一部分（任意两人都同桌过）
  const all = sampleCombos(pool, 4, 60);

  it('挑出来的组合里任意两个人都同桌过', () => {
    for (const a of pool) for (const b of pool) if (a !== b) expect(all.some((c) => c.includes(a) && c.includes(b))).toBe(true);
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
    // 角色越来越多，要打的组合也越来越多（龙门渊四人加进来以后单跑也要 10 分钟出头）
  }, 1500000);
});
