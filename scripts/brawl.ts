// 能力大乱斗：角色池里任选四个，每种组合打很多场，检查能力撞在一起会不会出错
// 用法：npx vite-node scripts/brawl.ts [每种组合打几场]
import { combos, newStats, playBrawl } from '../tests/brawl/harness';
import { brawlPool } from '../tests/brawl/probes';

const games = Number(process.argv[2] ?? 20);
const pool = brawlPool();
const all = combos(pool, 4);
const stats = newStats();
const t0 = Date.now();
all.forEach((chars, i) => {
  for (let n = 1; n <= games; n++) playBrawl(chars, 100000 + i * 1000 + n, stats);
});
console.log(`角色池 ${pool.map((c) => c.name).join('、')}`);
console.log(`${all.length} 种组合 × ${games} 场 = ${stats.games} 场打完，${stats.rounds} 局，${stats.draws} 次摸牌，${Math.round((Date.now() - t0) / 1000)} 秒`);
console.log(`控场规矩对账 ${stats.ruleChecks} 次`);
console.log('能力发动次数', Object.fromEntries(stats.abilityEvents));
console.log(stats.problems.length ? stats.problems.join('\n') : '没有发现问题');
