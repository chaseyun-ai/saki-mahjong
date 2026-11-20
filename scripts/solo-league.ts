import { writeFileSync } from 'node:fs';
import { createLeague, PRELIM_ROUNDS, prelimStandings, runLeague, standingOf, standings } from '../src/story/league';

// 全国大赛个人赛：用真牌局一口气打完几届（玩家那桌也交给电脑），记下每届的积分榜和冠军
// 用法：npx vite-node scripts/solo-league.ts <起始种子> <几届> <输出 json>
const [from = '1', count = '1', out = 'solo-league.json'] = process.argv.slice(2);
const runs = [];
for (let k = 0; k < Number(count); k++) {
  const seed = Number(from) + k;
  const t0 = performance.now();
  const l = runLeague(createLeague(seed, 'saki'));
  const pre = prelimStandings(l);
  runs.push({
    seed,
    ms: Math.round(performance.now() - t0),
    podium: l.podium!.map((p) => l.players[p].id),
    finalists: l.finalists!.map((p) => l.players[p].id),
    places: standings(l).map((s) => l.players[s.p].id),
    prelim: pre.map((s) => ({ id: l.players[s.p].id, total: s.total, games: s.games.slice(0, PRELIM_ROUNDS) })),
    final: l.finalists!.map((p) => ({ id: l.players[p].id, final: standingOf(l, p).final })),
  });
  console.log(seed, `${((performance.now() - t0) / 1000).toFixed(1)}s`, '冠军', l.players[l.podium![0]].name, '决赛', l.finalists!.map((p) => l.players[p].name).join(' '));
  writeFileSync(out, JSON.stringify(runs));
}
