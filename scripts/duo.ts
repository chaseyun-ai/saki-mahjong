// 江口夕、爱宕洋榎强度：主角 1-2 人，其余座位是无能力电脑或随机角色，座位随机，南风战
// 用法：npx vite-node scripts/duo.ts 角色id[,角色id] none|rand [场数] [起始seed]
import { CHARACTERS, baseAi } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';

const ids = (process.argv[2] ?? 'sera').split(',').filter((x) => x !== 'none');
const opp = process.argv[3] ?? 'none';
const games = Number(process.argv[4] ?? 300);
const start = Number(process.argv[5] ?? 1);
const NONE = { id: 'none', name: '无能力', ability: null, ai: baseAi } as any;
const heroes = ids.length ? ids.map((id) => CHARACTERS.find((c) => c.id === id)!) : [NONE];
type St = { rank: number; first: number; last: number; score: number; wins: number; dealIns: number; pts: number; tsumo: number; riichi: number };
const st: Record<string, St> = {};
const S = (k: string) => (st[k] ??= { rank: 0, first: 0, last: 0, score: 0, wins: 0, dealIns: 0, pts: 0, tsumo: 0, riichi: 0 });
const pair: Record<string, number> = {};
let rounds = 0, oppRank = 0, oppN = 0;
for (let seed = start; seed < start + games; seed++) {
  const rng = new Rng(seed * 977);
  const pool = CHARACTERS.filter((c) => !['sera', 'hiroe'].includes(c.id));
  const others = opp === 'rand' ? rng.shuffle(pool).slice(0, 4 - heroes.length) : Array(4 - heroes.length).fill(NONE);
  const order = rng.shuffle([...heroes, ...others]);
  const mine = heroes.map((h) => order.indexOf(h));
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  g.onEvent((e: any) => {
    if (e.type !== 'roundEnd') return;
    rounds++;
    for (const w of e.result.wins) mine.forEach((m, i) => {
      const s = S(heroes[i].id);
      if (w.seat === m) { s.wins++; s.pts += e.result.deltas[m]; if (w.from == null || w.from === m) s.tsumo++; }
      if (w.from === m && w.seat !== m) s.dealIns++;
    });
  });
  while (g.phase !== 'gameEnd') {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  const rk = g.ranking();
  mine.forEach((m, i) => { const s = S(heroes[i].id); const r = rk.indexOf(m); s.rank += r + 1; if (r === 0) s.first++; if (r === 3) s.last++; s.score += g.players[m].score; });
  order.forEach((_, j) => { if (!mine.includes(j)) { oppRank += rk.indexOf(j) + 1; oppN++; } });
  if (heroes.length === 2) { const a = rk.indexOf(mine[0]) < rk.indexOf(mine[1]) ? heroes[0].id : heroes[1].id; pair[a] = (pair[a] ?? 0) + 1; }
}
console.log(JSON.stringify({ ids: heroes.map((h) => h.id), opp, games, rounds, st, oppRank: oppRank / oppN, pair }));
