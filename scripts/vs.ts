// 某个角色对其他角色的胜率：她 + 随机三个对手，随机座位打半庄（25000 点），统计她的顺位，和每个对手同桌时她排在对方前面的比例
// 用法：npx vite-node scripts/vs.ts [角色 id] [场数] [起始种子] [输出 JSON 路径（不写就直接打印）]
import { writeFileSync } from 'node:fs';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';

const hero = process.argv[2] ?? 'saki';
const games = Number(process.argv[3] ?? 300);
const from = Number(process.argv[4] ?? 1);
const out = process.argv[5];
const me = CHARACTERS.find((c) => c.id === hero)!;
const others = CHARACTERS.filter((c) => c.id !== hero);
const events = new Map<string, number>();
const tot = { games: 0, rankSum: 0, ranks: [0, 0, 0, 0], rounds: 0, wins: 0, winPts: 0, dealIns: 0, rinshan: 0, score: 0, band: 0 };
// 每个对手：同桌几场、她排在对方前面几场、对方的顺位和
const vs: Record<string, { n: number; above: number; theirRank: number; sakiRank: number }> = {};
for (let seed = from; seed < from + games; seed++) {
  const rng = new Rng(seed * 977 + 5);
  const opp = rng.shuffle([...others]).slice(0, 3);
  const order = rng.shuffle([me, ...opp]);
  const mine = order.indexOf(me);
  const g = new Game({ seed, format: 'south', startScore: 25000, players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  g.onEvent((e: any) => {
    if (e.type === 'ability' && e.seat === mine) events.set(e.text, (events.get(e.text) ?? 0) + 1);
    if (e.type !== 'roundEnd') return;
    tot.rounds++;
    for (const w of e.result.wins) {
      if (w.from === mine) tot.dealIns++;
      if (w.seat === mine) {
        tot.wins++;
        tot.winPts += e.result.deltas[mine];
        if (w.result.yaku.some((y: any) => y.name === '岭上开花')) tot.rinshan++;
      }
    }
  });
  while (g.phase !== 'gameEnd') {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  const rk = g.ranking();
  const r = rk.indexOf(mine);
  tot.games++; tot.rankSum += r + 1; tot.ranks[r]++; tot.score += g.players[mine].score;
  if (Math.abs(g.players[mine].score - 30000) <= 500) tot.band++;
  for (const c of opp) {
    const s = order.indexOf(c);
    const v = (vs[c.id] ??= { n: 0, above: 0, theirRank: 0, sakiRank: 0 });
    v.n++; v.theirRank += rk.indexOf(s) + 1; v.sakiRank += r + 1;
    if (r < rk.indexOf(s)) v.above++;
  }
}
const data = { tot, vs, events: Object.fromEntries(events) };
if (out) writeFileSync(out, JSON.stringify(data));
else console.log(JSON.stringify(data, null, 1));
