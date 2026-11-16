// 星符汇聚做得成几成：npx vite-node scripts/awai-stars.ts [场数] [starsSeed] [对手：random|plain]
// 每一局她第一次轮到就按星符汇聚（能量给够），别的主动技能不按
import { AWAI, awaiCanUse } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';

const games = Number(process.argv[2] ?? 50);
AWAI.starsSeed = Number(process.argv[3] ?? 7);
AWAI.starsPull = process.argv[5] !== "nopull";
const pool = process.argv[4] ?? 'random';
AWAI.aiSkills = false;
AWAI.energyMax = 100000;
const me = CHARACTERS.find((c) => c.id === 'awai')!;
const plain = CHARACTERS.find((c) => c.id === 'izumi')!;
const S = { rounds: 0, pressed: 0, yakuman: 0, tsumo: 0, otherWin: 0, dealIn: 0, draw: 0, smallWin: 0, turns: [] as number[], endTurns: [] as number[] };
for (let seed = 1; seed <= games; seed++) {
  const rng = new Rng(seed * 977);
  const others = pool === 'plain' ? [plain, plain, plain] : rng.shuffle(CHARACTERS.filter((c) => c.id !== 'awai')).slice(0, 3);
  const order = rng.shuffle([me, ...others]);
  const mine = order.indexOf(me);
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  let pressed = false;
  g.onEvent((e) => {
    if (e.type === 'roundStart') pressed = false;
    if (e.type !== 'roundEnd') return;
    S.rounds++;
    if (!pressed) return;
    S.pressed++;
    const turn = g.players[mine].discards.length;
    S.endTurns.push(turn);
    const w = e.result.wins.find((x) => x.seat === mine);
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
    if (s === mine && !pressed && g.phase === 'turn' && g.turn === mine && awaiCanUse(g, mine, 'stars')) {
      g.abilities[mine]!.pressSkill!(g, mine, 'stars');
      pressed = true;
    }
    g.act(s, chooseAction(g, s, order[s].ai));
  }
}
const pc = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const avg = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-');
const hist = (a: number[]) => { const h: Record<number, number> = {}; for (const x of a) h[x] = (h[x] ?? 0) + 1; return h; };
console.log(`starsSeed ${AWAI.starsSeed}，对手 ${pool}，${games} 场 ${S.rounds} 局，按了 ${S.pressed} 局`);
console.log(`役满和了 ${pc(S.yakuman, S.pressed)}（自摸 ${S.tsumo}），平均第 ${avg(S.turns)} 巡；别的和了 ${pc(S.smallWin, S.pressed)}；别人先和 ${pc(S.otherWin, S.pressed)}（她放铳 ${pc(S.dealIn, S.pressed)}）；流局 ${pc(S.draw, S.pressed)}`);
console.log('役满巡目', JSON.stringify(hist(S.turns)));
