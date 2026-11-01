// 单个角色的强度：每场都让她上桌，另外三家随机抽，座位随机。和全体平均比
// 用法：npx vite-node scripts/focus.ts 角色id [场数] [east|south]
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';

const id = process.argv[2] ?? 'shizuno';
const games = Number(process.argv[3] ?? 200);
const format = (process.argv[4] as 'east' | 'south') ?? 'south';
const me = CHARACTERS.find((c) => c.id === id)!;
let rankSum = 0, first = 0, score = 0, wins = 0, dealIns = 0, rounds = 0, winPts = 0;
const late = { rounds: 0, wins: 0 }; // 第 6 局以后
const early = { rounds: 0, wins: 0 };
for (let seed = 1; seed <= games; seed++) {
  const rng = new Rng(seed * 977);
  const others = rng.shuffle(CHARACTERS.filter((c) => c.id !== id)).slice(0, 3);
  const order = rng.shuffle([me, ...others]);
  const mine = order.indexOf(me);
  const g = new Game({ seed, format, players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  g.onEvent((e) => {
    if (e.type !== 'roundEnd') return;
    rounds++;
    const bucket = g.round >= 6 ? late : early;
    bucket.rounds++;
    for (const w of e.result.wins) {
      if (w.seat === mine) { wins++; bucket.wins++; winPts += e.result.deltas[mine]; }
      if (w.from === mine) dealIns++;
    }
  });
  while (g.phase !== 'gameEnd') {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  const rank = g.ranking().indexOf(mine);
  rankSum += rank + 1;
  if (rank === 0) first++;
  score += g.players[mine].score;
}
const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;
console.log(`${me.name} ${games} 场 ${format}：平均顺位 ${(rankSum / games).toFixed(2)}，一位率 ${pct(first, games)}，平均点数 ${Math.round(score / games)}，和了率 ${pct(wins, rounds)}（前 5 局 ${pct(early.wins, early.rounds)}，第 6 局起 ${pct(late.wins, late.rounds)}），平均打点 ${Math.round(winPts / Math.max(1, wins))}，放铳率 ${pct(dealIns, rounds)}`);
