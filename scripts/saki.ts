// 宫永咲的岭上开花统计：随机对手或决赛大将桌（咲、稳乃、涅莉、淡），可以用 SAKI_JSON 临时改 SAKI 参数
// 用法：npx vite-node scripts/saki.ts [场数] [rand|final]
import { CHARACTERS } from '../src/abilities/characters';
import { SAKI } from '../src/abilities/saki';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { shanten } from '../src/engine/shanten';
import { toCounts } from '../src/engine/tiles';

if (process.env.SAKI_JSON) Object.assign(SAKI, JSON.parse(process.env.SAKI_JSON));
const games = Number(process.argv[2] ?? 200);
const table = process.argv[3] === 'final' ? ['saki', 'shizuno', 'nelly', 'awai'] : null;
const me = CHARACTERS.find((c) => c.id === 'saki')!;
const st = { rounds: 0, wins: 0, rs: 0, rankSum: 0, first: 0, dealIns: 0, pts: 0, awaiWins: 0, awaiRounds: 0, eastWins: 0, eastRounds: 0, band: 0, absDev: 0, dealSh: 0, dealPairs: 0, minkanAwai: 0, push: 0 };
for (let seed = 1; seed <= games; seed++) {
  const rng = new Rng(seed * 977);
  const order = table ? rng.shuffle(table.map((id) => CHARACTERS.find((c) => c.id === id)!)) : rng.shuffle([me, ...rng.shuffle(CHARACTERS.filter((c) => c.id !== 'saki')).slice(0, 3)]);
  const mine = order.indexOf(me);
  const awai = order.findIndex((c) => c.id === 'awai');
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability })) });

  g.onEvent((e: any) => {
    if (e.type === 'roundStart' || e.type === 'dealt') {
      if (e.type === 'roundStart') { const c = toCounts(g.players[mine].hand); st.dealSh += shanten(c); st.dealPairs += c.filter((x) => x >= 2).length; }
    }

    if (e.type === 'call' && e.seat === mine && e.call === '杠' && g.lastDiscard?.seat === awai) st.minkanAwai++;
    if (e.type !== 'roundEnd') return;
    st.rounds++;
    if (awai >= 0) st.awaiRounds++;
    const east = g.round < 4; if (east) st.eastRounds++;
    for (const w of e.result.wins) {
      if (w.from === mine) st.dealIns++;
      if (w.seat === awai) st.awaiWins++;
      if (w.seat === mine) { st.wins++; if (east) st.eastWins++; st.pts += e.result.deltas[mine]; if (w.result.yaku.some((y: any) => y.name === '岭上开花')) st.rs++; }
    }
  });
  while (g.phase !== 'gameEnd') {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  const r = g.ranking().indexOf(mine); st.rankSum += r + 1; if (r === 0) st.first++;
  const sc = g.players[mine].score; st.absDev += Math.abs(sc - 30000); if (Math.abs(sc - 30000) <= 500) st.band++;
}
const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;
console.log(`局数 ${st.rounds} | 配牌向听 ${(st.dealSh / st.rounds).toFixed(2)} 对子 ${(st.dealPairs / st.rounds).toFixed(2)} | 和了率 ${pct(st.wins, st.rounds)} | 岭上/局 ${pct(st.rs, st.rounds)} | 岭上占和 ${pct(st.rs, st.wins)} | 打点 ${Math.round(st.pts / st.wins)} | 顺位 ${(st.rankSum / games).toFixed(2)} | 一位 ${pct(st.first, games)} | 放铳 ${pct(st.dealIns, st.rounds)} | 东场和了率 ${pct(st.eastWins, st.eastRounds)} | 终局离30000 ${Math.round(st.absDev / games)} 正负零 ${st.band} 场 | 淡和了率 ${pct(st.awaiWins, st.awaiRounds)} | 大明杠淡 ${st.minkanAwai}`);
