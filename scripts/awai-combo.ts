// 大星淡的连招（双立直 → 转角暗杠 → 杠里 → 自摸）和出来多大：
// npx vite-node scripts/awai-combo.ts [场数] [对手：random|plain|a,b,c] [版本：new|classic] [起始种子]
// 只数开过转角暗杠、杠里定下来以后的和牌。点数是和牌本身的大小（不含本场、立直棒）
import { awaiKanUra, awaiKanUraHit } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';

const games = Number(process.argv[2] ?? 100);
const pool = process.argv[3] ?? 'random';
const classic = process.argv[4] === 'classic';
const from = Number(process.argv[5] ?? 1);
const me = CHARACTERS.find((c) => c.id === 'awai')!;
const plain = CHARACTERS.find((c) => c.id === 'izumi')!;
const S = { rounds: 0, combo: 0, pts: 0, child: [] as number[], dealer: [] as number[], han: {} as Record<number, number>, limit: {} as Record<string, number>, yaku: {} as Record<string, number>, dora: 0, aka: 0, ura: 0, inRange: 0, rank: 0, first: 0, score: 0, wins: 0, winPts: 0 };
for (let seed = from; seed < from + games; seed++) {
  const rng = new Rng(seed * 977);
  const others = pool === 'plain' ? [plain, plain, plain] : pool.includes(',') ? pool.split(',').map((x) => CHARACTERS.find((c) => c.id === x)!) : rng.shuffle(CHARACTERS.filter((c) => c.id !== 'awai')).slice(0, 3);
  const order = rng.shuffle([me, ...others]);
  const mine = order.indexOf(me);
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability, startForm: c === me && classic })) });
  g.onEvent((e) => {
    if (e.type !== 'roundEnd') return;
    S.rounds++;
    const w = e.result.wins.find((x) => x.seat === mine);
    if (!w) return;
    S.wins++;
    S.winPts += e.result.deltas[mine];
    if (!awaiKanUraHit(g, mine)) return;
    const r = w.result;
    const dealer = mine === g.dealer;
    const pts = w.from === null ? (dealer ? 3 * r.tsumoOtherPays : r.tsumoDealerPays + 2 * r.tsumoOtherPays) : r.ron;
    S.combo++;
    S.pts += pts;
    (dealer ? S.dealer : S.child).push(pts);
    if (pts >= 12000 && pts <= 18000) S.inRange++;
    S.han[r.han] = (S.han[r.han] ?? 0) + 1;
    const key = r.yakuman ? '役满' : r.limitName || `${r.han}番`;
    S.limit[key] = (S.limit[key] ?? 0) + 1;
    for (const y of r.yaku) S.yaku[y.name] = (S.yaku[y.name] ?? 0) + 1;
    S.dora += r.dora;
    S.aka += r.aka;
    S.ura += r.ura;
    // 不是跳满的列出来看（ODD=1）
    if (process.env.ODD && r.han !== 6 && r.han !== 7) console.log(`  种子 ${seed} ${g.roundLabel()} 对手 ${others.map((c) => c.id).join()}：${r.han} 番 ${r.yaku.map((y) => y.name).join(' ')} 宝 ${r.dora} 赤 ${r.aka} 里 ${r.ura}${w.from === null ? '' : ' 荣和'} 杠里第 ${awaiKanUra(g, mine)} 张 / 翻了 ${g.wall.doraRevealed} 张`);
  });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 100000) {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  const rank = g.ranking().indexOf(mine);
  S.rank += rank + 1;
  if (rank === 0) S.first++;
  S.score += g.players[mine].score;
}
const pc = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : '-');
const hist = (a: number[]) => { const h: Record<number, number> = {}; for (const x of a) h[x] = (h[x] ?? 0) + 1; return h; };
console.log(`${classic ? '初版' : '重做版'}，对手 ${pool}，${games} 场 ${S.rounds} 局；顺位 ${(S.rank / games).toFixed(2)} 一位 ${pc(S.first, games)} 终局均分 ${Math.round(S.score / games)} 和了率 ${pc(S.wins, S.rounds)} 平均打点 ${Math.round(S.winPts / Math.max(1, S.wins))}`);
console.log(`连招和了 ${S.combo} 次：平均 ${Math.round(S.pts / Math.max(1, S.combo))} 点，落在 12000–18000 的 ${pc(S.inRange, S.combo)}；平均宝牌 ${(S.dora / Math.max(1, S.combo)).toFixed(2)} 赤 ${(S.aka / Math.max(1, S.combo)).toFixed(2)} 里 ${(S.ura / Math.max(1, S.combo)).toFixed(2)}`);
console.log(`闲家 ${S.child.length} 次 平均 ${avg(S.child)}`, JSON.stringify(hist(S.child)));
console.log(`庄家 ${S.dealer.length} 次 平均 ${avg(S.dealer)}`, JSON.stringify(hist(S.dealer)));
console.log('番数', JSON.stringify(S.han));
console.log('大小', JSON.stringify(S.limit));
console.log('役', JSON.stringify(S.yaku));
