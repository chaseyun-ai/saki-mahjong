// 臼泽塞对能力者的限制：一个能力者 X、塞、两个二条泉打南风战；对照桌把塞换成第三个二条泉。
// 用法：npx vite-node scripts/sae-vs.ts 能力者id [场数] [sae|base] [起始种子]
// 输出一行 JSON：X 的顺位、一位、和了（自摸 / 荣和）、放铳、立直局数；塞的顺位；塞盯 X 的次数、换掉 X 和了牌的次数
import { CHARACTERS } from '../src/abilities/characters';
import { saeTarget } from '../src/abilities/sae';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';

const id = process.argv[2] ?? 'awai';
const games = Number(process.argv[3] ?? 100);
const mode = process.argv[4] ?? 'sae';
const from = Number(process.argv[5] ?? 1);
const byId = (x: string) => CHARACTERS.find((c) => c.id === x)!;
const me = byId(id);
const plain = byId('izumi');
const sae = mode === 'sae' ? byId('sae') : plain;

const out = { id, mode, games, rankSum: 0, first: 0, last: 0, score: 0, rounds: 0, tsumo: 0, ron: 0, dealIns: 0, riichiRounds: 0, saeRankSum: 0, shotsOnMe: 0, shots: 0, blocksOnMe: 0 };
for (let seed = from; seed < from + games; seed++) {
  const rng = new Rng(seed * 977);
  const order = rng.shuffle([me, sae, plain, { ...plain }]);
  const mine = order.indexOf(me);
  const saeSeat = order.indexOf(sae);
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  let riichi = false;
  g.onEvent((e) => {
    if (e.type === 'ability' && e.ability === 'sae' && e.seat === saeSeat) {
      if (e.text === '镜片') {
        out.shots++;
        if (saeTarget(g, saeSeat) === mine) out.shotsOnMe++;
      } else if (e.target === mine) out.blocksOnMe++;
    }
    if (e.type !== 'roundEnd') return;
    out.rounds++;
    if (riichi) out.riichiRounds++;
    riichi = false;
    for (const w of e.result.wins) {
      if (w.seat === mine) w.from === null ? out.tsumo++ : out.ron++;
      if (w.from === mine) out.dealIns++;
    }
  });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 100000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    if (g.players[mine].riichi) riichi = true;
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  const ranking = g.ranking();
  const rank = ranking.indexOf(mine);
  out.rankSum += rank + 1;
  if (rank === 0) out.first++;
  if (rank === 3) out.last++;
  out.score += g.players[mine].score;
  if (mode === 'sae') out.saeRankSum += ranking.indexOf(saeSeat) + 1;
}
console.log(JSON.stringify(out));
