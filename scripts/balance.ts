// 平衡测试：让四个电脑角色打很多场，统计每个角色的成绩
// 用法：npx vite-node scripts/balance.ts [场数]
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';

const games = Number(process.argv[2] ?? 200);
const stats = new Map(CHARACTERS.map((c) => [c.id, { rankSum: 0, first: 0, score: 0, wins: 0, dealIns: 0, rinshan: 0, winPoints: 0 }]));
let rounds = 0;

for (let seed = 1; seed <= games; seed++) {
  // 每场轮换座位，消除座位影响
  const order = [0, 1, 2, 3].map((i) => CHARACTERS[(i + seed) % 4]);
  const g = new Game({ seed, players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  g.onEvent((e) => {
    if (e.type !== 'roundEnd') return;
    rounds++;
    for (const w of e.result.wins) {
      const s = stats.get(order[w.seat].id)!;
      s.wins++;
      s.winPoints += e.result.deltas[w.seat];
      if (w.result.yaku.some((y) => y.name === '岭上开花')) s.rinshan++;
      if (w.from !== null) stats.get(order[w.from].id)!.dealIns++;
    }
  });
  while (g.phase !== 'gameEnd') {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const seat = g.waitingSeats()[0];
    g.act(seat, chooseAction(g, seat, order[seat].ai));
  }
  g.ranking().forEach((seat, rank) => {
    const s = stats.get(order[seat].id)!;
    s.rankSum += rank + 1;
    if (rank === 0) s.first++;
    s.score += g.players[seat].score;
  });
}

console.log(`${games} 场，${rounds} 局`);
console.log('角色\t平均顺位\t一位率\t平均点数\t和了率\t平均打点\t放铳率\t岭上开花');
for (const c of CHARACTERS) {
  const s = stats.get(c.id)!;
  console.log(
    [
      c.name,
      (s.rankSum / games).toFixed(2),
      `${((s.first / games) * 100).toFixed(0)}%`,
      Math.round(s.score / games),
      `${((s.wins / rounds) * 100).toFixed(1)}%`,
      Math.round(s.winPoints / Math.max(1, s.wins)),
      `${((s.dealIns / rounds) * 100).toFixed(1)}%`,
      s.rinshan,
    ].join('\t'),
  );
}
