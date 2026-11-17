// 星符汇聚做得成几成：npx vite-node scripts/awai-stars.ts [场数] [starsDeal，默认 0.1] [对手：random|plain] [能量：real|free] [差几张以内才按，默认 10]
// 她当成玩家的淡（拿得到字牌手），第一次轮到自己、大七星差得不多就按星符汇聚，别的主动技能不按。
// real：能量照实扣（开局 100，不回复）；free：能量给够，每次拿到都能按
// 最后一行是她整场的成绩（平均顺位、一位率、终局均分、和了率、每场役满几次），拿 starsDeal 0 跑一遍当对照
import { AWAI, awaiCanUse } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';

const games = Number(process.argv[2] ?? 50);
AWAI.starsDeal = Number(process.argv[3] ?? 0.1);
const maxShort = Number(process.argv[6] ?? 10);
const short = (hand: number[]) => {
  const c = new Array<number>(34).fill(0);
  for (const t of hand) c[t >> 2]++;
  let n = 14;
  for (let k = 27; k < 34; k++) n -= Math.min(2, c[k]);
  return n;
};
const byShort: Record<number, [number, number]> = {};
const pool = process.argv[4] ?? 'random';
AWAI.aiSkills = false;
if (process.argv[5] === 'free') AWAI.energyMax = 100000;
const me = CHARACTERS.find((c) => c.id === 'awai')!;
const plain = CHARACTERS.find((c) => c.id === 'izumi')!;
const G = { rank: 0, first: 0, last: 0, score: 0, wins: 0, winPts: 0, yakuman: 0, dealIn: 0 };
const S = { rounds: 0, pressed: 0, yakuman: 0, tsumo: 0, otherWin: 0, dealIn: 0, draw: 0, smallWin: 0, turns: [] as number[], endTurns: [] as number[] };
for (let seed = 1; seed <= games; seed++) {
  const rng = new Rng(seed * 977);
  const others = pool === 'plain' ? [plain, plain, plain] : rng.shuffle(CHARACTERS.filter((c) => c.id !== 'awai')).slice(0, 3);
  const order = rng.shuffle([me, ...others]);
  const mine = order.indexOf(me);
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability, manual: c === me })) });
  let pressed = false;
  let pressedAt = 0;
  g.onEvent((e) => {
    if (e.type === 'roundStart') pressed = false;
    if (e.type !== 'roundEnd') return;
    S.rounds++;
    for (const w of e.result.wins) {
      if (w.seat === mine) { G.wins++; G.winPts += e.result.deltas[mine]; if (w.result.yakuman) G.yakuman++; }
      else if (w.from === mine) G.dealIn++;
    }
    if (!pressed) return;
    S.pressed++;
    const turn = g.players[mine].discards.length;
    S.endTurns.push(turn);
    const w = e.result.wins.find((x) => x.seat === mine);
    (byShort[pressedAt] ??= [0, 0])[0]++;
    if (w?.result.yakuman) byShort[pressedAt][1]++;
    if (w) {
      if (w.result.yakuman) { S.yakuman++; S.turns.push(turn + 1); if (w.from === undefined || w.from === null || w.from === mine) S.tsumo++; }
      else S.smallWin++;
    } else if (e.result.kind === 'win') { S.otherWin++; if (e.result.wins.some((x) => x.from === mine)) S.dealIn++; }
    else S.draw++;
  });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 100000) {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    const s = g.waitingSeats()[0];
    if (s === mine && !pressed && g.phase === 'turn' && g.turn === mine && awaiCanUse(g, mine, 'stars') && short(g.players[mine].hand) <= maxShort) {
      pressedAt = short(g.players[mine].hand);
      g.abilities[mine]!.pressSkill!(g, mine, 'stars');
      pressed = true;
    }
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  const pts = g.players.map((p) => p.score);
  const rank = 1 + pts.filter((x, i) => x > pts[mine] || (x === pts[mine] && i < mine)).length;
  G.rank += rank;
  if (rank === 1) G.first++;
  if (rank === 4) G.last++;
  G.score += pts[mine];
}
const pc = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const avg = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-');
const hist = (a: number[]) => { const h: Record<number, number> = {}; for (const x of a) h[x] = (h[x] ?? 0) + 1; return h; };
console.log(`starsDeal ${AWAI.starsDeal}，对手 ${pool}，${games} 场 ${S.rounds} 局，按了 ${S.pressed} 局（每场 ${(S.pressed / games).toFixed(2)} 次，${pc(S.pressed, S.rounds)} 的局）`);
console.log(`役满和了 ${pc(S.yakuman, S.pressed)}（自摸 ${S.tsumo}），平均第 ${avg(S.turns)} 巡；别的和了 ${pc(S.smallWin, S.pressed)}；别人先和 ${pc(S.otherWin, S.pressed)}（她放铳 ${pc(S.dealIn, S.pressed)}）；流局 ${pc(S.draw, S.pressed)}`);
console.log('役满巡目', JSON.stringify(hist(S.turns)));
console.log(`整场：平均顺位 ${(G.rank / games).toFixed(2)}，一位 ${pc(G.first, games)}，四位 ${pc(G.last, games)}，终局均分 ${Math.round(G.score / games)}，和了率 ${pc(G.wins, S.rounds)}，平均打点 ${G.wins ? Math.round(G.winPts / G.wins) : '-'}，放铳率 ${pc(G.dealIn, S.rounds)}，每场役满 ${(G.yakuman / games).toFixed(2)} 次`);
console.log('按下时差几张: [按了几局, 役满几局]', JSON.stringify(byShort));
