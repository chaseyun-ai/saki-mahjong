// 一个角色的强度：每场都让她上桌，另外三家从对手池里抽，座位随机，南风战。
// 用法：npx vite-node scripts/strength.ts 角色id [场数] [对手：random|plain] [起始种子]
// random：从全部角色里随机抽三人（不含她）；plain：三个没有能力的人（二条泉）；也可以写三个角色 id，用逗号隔开（固定对手）
// 输出一行 JSON：平均顺位、一位率、四位率、终局均分、和了率、平均打点、放铳率，还有角色自己的计数（佳织的役满局等）
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';

const id = process.argv[2] ?? 'izumi';
const games = Number(process.argv[3] ?? 200);
const pool = process.argv[4] ?? 'random';
const from = Number(process.argv[5] ?? 1);
const me = CHARACTERS.find((c) => c.id === id)!;
const plain = CHARACTERS.find((c) => c.id === 'izumi')!;
let rankSum = 0, first = 0, last = 0, score = 0, wins = 0, dealIns = 0, rounds = 0, winPts = 0, yakuman = 0, special = 0;
for (let seed = from; seed < from + games; seed++) {
  const rng = new Rng(seed * 977);
  const others =
    pool === 'plain'
      ? [plain, plain, plain]
      : pool.includes(',')
        ? pool.split(',').map((x) => CHARACTERS.find((c) => c.id === x)!)
        : rng.shuffle(CHARACTERS.filter((c) => c.id !== id)).slice(0, 3);
  const order = rng.shuffle([me, ...others]);
  const mine = order.indexOf(me);
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  g.onEvent((e) => {
    if (e.type === 'ability' && e.seat === mine && (e.text === '新手运' || e.text === '背水')) special++;
    if (e.type !== 'roundEnd') return;
    rounds++;
    for (const w of e.result.wins) {
      if (w.seat === mine) {
        wins++;
        winPts += e.result.deltas[mine];
        if (w.result.yaku.some((y) => y.han >= 13)) yakuman++;
      }
      if (w.from === mine) dealIns++;
    }
  });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 100000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  const rank = g.ranking().indexOf(mine);
  rankSum += rank + 1;
  if (rank === 0) first++;
  if (rank === 3) last++;
  score += g.players[mine].score;
}
console.log(JSON.stringify({ id, pool, games, rankSum, first, last, score, wins, dealIns, rounds, winPts, yakuman, special }));
