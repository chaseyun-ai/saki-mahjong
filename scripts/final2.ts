// 决赛大将战连打两个半庄：淡、涅莉、稳乃、咲，100000 点起，点数接着算到第二个半庄（座位、起家第二个半庄重新随机）。
// 淡的星空能量、涅莉的运势不回满，接着第一个半庄剩下的自然恢复；涅莉的七姐妹按“一场 7 次”每个半庄重新算；
// 稳乃的深山第二个半庄从 6 个标记开始（之后照常每局加一）。第一个半庄有人被击飞就整场结束
// 用法：npx vite-node scripts/final2.ts [场数] [开局点数] [起始种子] [输出 JSON（不写就打印）]
import { writeFileSync } from 'node:fs';
import { AWAI, awaiEnergy } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { NELLY, nellyPool, nellyTier } from '../src/abilities/nelly';
import { shizunoMarks } from '../src/abilities/shizuno';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';

const matches = Number(process.argv[2] ?? 200);
const start = Number(process.argv[3] ?? 100000);
const from = Number(process.argv[4] ?? 1);
const out = process.argv[5];
const ids = ['awai', 'nelly', 'shizuno', 'saki'];
const chars = ids.map((id) => CHARACTERS.find((c) => c.id === id)!);

// 第二个半庄发第一局牌之前把带过来的能力状态放进去（Game 的构造函数里就发牌了）
let inject: ((g: Game) => void) | null = null;
const proto = Game.prototype as unknown as { startOrWait(this: Game): void };
const startOrWait = proto.startOrWait;
proto.startOrWait = function (this: Game) {
  if (inject && this.round === 0) { inject(this); inject = null; }
  startOrWait.call(this);
};

type H = { rounds: number; wins: number[]; pts: number[]; dealIns: number[]; delta: number[]; rank: number[]; firsts: number[]; nellyBets: number; nellyBetPts: number; nellyBetWins: number; dr: number; kanUra: number; awaiSkills: Record<string, number>; mist: number; games: number };
const mkH = (): H => ({ rounds: 0, wins: [0, 0, 0, 0], pts: [0, 0, 0, 0], dealIns: [0, 0, 0, 0], delta: [0, 0, 0, 0], rank: [0, 0, 0, 0], firsts: [0, 0, 0, 0], nellyBets: 0, nellyBetPts: 0, nellyBetWins: 0, dr: 0, kanUra: 0, awaiSkills: {}, mist: 0, games: 0 });
const H1 = mkH(), H2 = mkH();
const fin = { matches: 0, tobi1: 0, rank: [0, 0, 0, 0], ranks: ids.map(() => [0, 0, 0, 0]), score: [0, 0, 0, 0], energyAt2: 0, poolAt2: 0, energyEnd1: 0, poolEnd1: 0 };

function play(g: Game, order: typeof chars, h: H): void {
  const idx = (s: number) => ids.indexOf(order[s].id);
  const aw = order.findIndex((c) => c.id === 'awai'), ne = order.findIndex((c) => c.id === 'nelly');
  let first = true, bet = 0;
  g.onEvent((e: any) => {
    if (e.type === 'roundStart') { first = true; bet = 0; }
    if (e.type === 'discard') {
      if (first) { bet = nellyTier(g, ne); if (bet > 0) h.nellyBets += bet; if (e.seat === aw && e.riichi) h.dr++; }
      first = false;
    }
    if (e.type === 'ability' && e.seat === aw) {
      if (e.text === '杠里') h.kanUra++;
      if (e.target === undefined && !['时间迟滞', '天听', '杠里', '命运支配', '退相干·自摸'].includes(e.text)) h.awaiSkills[e.text] = (h.awaiSkills[e.text] ?? 0) + 1;
    }
    if (e.type !== 'roundEnd') return;
    h.rounds++;
    for (const w of e.result.wins) {
      const i = idx(w.seat); h.wins[i]++; h.pts[i] += e.result.deltas[w.seat];
      if (w.from !== null) h.dealIns[idx(w.from)]++;
      if (w.seat === ne && bet > 0) { h.nellyBetWins++; h.nellyBetPts += e.result.deltas[ne]; }
    }
  });
  const before = g.players.map((p) => p.score);
  while (g.phase !== 'gameEnd') {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  h.games++;
  // 这个半庄自己的顺位：按这个半庄的得失点排
  const d = g.players.map((p, s) => p.score - before[s]);
  [0, 1, 2, 3].sort((x, y) => d[y] - d[x]).forEach((s, r) => { h.rank[idx(s)] += r + 1; if (r === 0) h.firsts[idx(s)]++; });
  d.forEach((x, s) => { h.delta[idx(s)] += x; });
}

for (let m = from; m < from + matches; m++) {
  const rng = new Rng(m * 7919 + 13);
  // 第一个半庄
  const o1 = rng.shuffle([...chars]);
  const g1 = new Game({ seed: m * 31 + 7, format: 'south', startScore: start, firstDealer: rng.int(4), players: o1.map((c) => ({ name: c.name, ability: c.ability })) });
  play(g1, o1, H1);
  fin.matches++;
  const score: Record<string, number> = Object.fromEntries(o1.map((c, s) => [c.id, g1.players[s].score]));
  const aw1 = o1.findIndex((c) => c.id === 'awai'), ne1 = o1.findIndex((c) => c.id === 'nelly');
  const energy = awaiEnergy(g1, aw1);
  const pool = NELLY.start + Math.floor(Math.max(0, g1.round - 1) / NELLY.every) - ((g1.abilityGameState[ne1] as { spent?: number }).spent ?? 0);
  void nellyPool;
  fin.energyEnd1 += energy; fin.poolEnd1 += pool;
  let finalOrder = o1, gFinal = g1;
  if (g1.players.some((p) => p.score < 0)) fin.tobi1++;
  else {
    // 第二个半庄：点数接着算，能力状态带过来
    const o2 = rng.shuffle([...chars]);
    const aw = o2.findIndex((c) => c.id === 'awai'), ne = o2.findIndex((c) => c.id === 'nelly'), sz = o2.findIndex((c) => c.id === 'shizuno');
    inject = (g) => {
      g.abilityGameState[aw] = { energy, at: 1 };
      g.abilityGameState[ne] = { spent: NELLY.start - pool };
      // 深山：第一局就是 6 个（shizunoMarks 在有 reset 时算 round - reset）
      g.abilityGameState[sz] = { reset: -5 };
    };
    const g2 = new Game({ seed: m * 31 + 100007, format: 'south', scores: o2.map((c) => score[c.id]), firstDealer: rng.int(4), players: o2.map((c) => ({ name: c.name, ability: c.ability })) });
    fin.energyAt2 += awaiEnergy(g2, aw); fin.poolAt2 += nellyPool(g2, ne);
    if (shizunoMarks(g2, sz) >= 6) H2.mist++;
    play(g2, o2, H2);
    finalOrder = o2; gFinal = g2;
  }
  gFinal.ranking().forEach((s, r) => { const i = ids.indexOf(finalOrder[s].id); fin.rank[i] += r + 1; fin.ranks[i][r]++; });
  finalOrder.forEach((c, s) => { fin.score[ids.indexOf(c.id)] += gFinal.players[s].score; });
}
void AWAI;
const data = { ids, H1, H2, fin };
if (out) writeFileSync(out, JSON.stringify(data));
else console.log(JSON.stringify(data));
