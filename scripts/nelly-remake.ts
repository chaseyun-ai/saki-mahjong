// 涅莉（重做）押了运势的局打得怎么样：每场都让她上桌（电脑），另外三家从全部角色里随机抽，座位随机，南风战。
// 用法：npx vite-node scripts/nelly-remake.ts [场数] [起始种子] [对手：random|plain|id,id,id]
// 环境变量 PLAN='[0,0,0,2,0,0,0,1]' 照这个排运势（试叠着押），REMAKE_JSON 临时改 NELLY_REMAKE，VERBOSE=1 列出没准时的局（她自己没做成的：和小了、流局）
// 输出：押了几点的局各几局、第几巡自摸三倍满的有几局、没做成的去哪了（别人先和、流局、和小了），役种出现次数，三倍满的役种组合有几种
import { CHARACTERS } from '../src/abilities/characters';
import { NELLY_REMAKE, nellyDue, nellyTier } from '../src/abilities/nelly';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';

if (process.env.REMAKE_JSON) Object.assign(NELLY_REMAKE, JSON.parse(process.env.REMAKE_JSON));
const games = Number(process.argv[2] ?? 100);
const from = Number(process.argv[3] ?? 1);
const pool = process.argv[4] ?? 'random';
const nelly = CHARACTERS.find((c) => c.id === 'nelly')!;
const plain = CHARACTERS.find((c) => c.id === 'izumi')!;
const out: Record<string, number> = {};
const bump = (k: string, n = 1) => (out[k] = (out[k] ?? 0) + n);
const yaku = new Map<string, number>();
const combos = new Map<string, number>();
const lost = new Map<string, number>();
let rankSum = 0;
let first = 0;
const t0 = performance.now();
for (let seed = from; seed < from + games; seed++) {
  const rng = new Rng(seed * 977);
  const others =
    pool === 'plain' ? [plain, plain, plain] : pool.includes(',') ? pool.split(',').map((x) => CHARACTERS.find((c) => c.id === x)!) : rng.shuffle(CHARACTERS.filter((c) => c.id !== 'nelly')).slice(0, 3);
  const order = rng.shuffle([nelly, ...others]);
  const me = order.indexOf(nelly);
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  // PLAN='[0,0,0,2,0,0,0,1]'：照这个排运势（试叠着押）
  if (process.env.PLAN) (g.abilityGameState[me] as { plan?: number[] }).plan = JSON.parse(process.env.PLAN);
  g.onEvent((e) => {
    if (e.type !== 'roundEnd') return;
    const bet = nellyTier(g, me);
    if (bet <= 0) return;
    const due = nellyDue(g, me);
    bump(`bet${bet}`);
    const w = e.result.wins.find((x) => x.seat === me);
    if (w) {
      const turn = g.players[me].discards.length + 1;
      const r = w.result;
      const tag = `${w.from === null ? '自摸' : '荣和'}${r.limitName || r.han + '番'}`;
      bump(`bet${bet}·${tag}`);
      const onTime = w.from === null && r.limitName === '三倍满' && (turn === due || (due >= 18 && g.wall.remaining < 4));
      if (onTime) bump(`bet${bet}·准时三倍满`);
      else bump(`bet${bet}·第${turn}巡${tag}`);
      if (!onTime && process.env.VERBOSE) console.log(`  种子 ${seed} 第 ${g.round} 局 bet${bet}：第${turn}巡${tag}（${order.map((c) => c.id).join(',')}）`);
      if (r.limitName === '三倍满') {
        const names = r.yaku.map((y) => y.name).filter((n) => !['立直', '一发', '门前清自摸和'].includes(n));
        for (const n of names) yaku.set(n, (yaku.get(n) ?? 0) + 1);
        if (r.dora) yaku.set('(宝牌)', (yaku.get('(宝牌)') ?? 0) + 1);
        if (r.ura) yaku.set('(里宝牌)', (yaku.get('(里宝牌)') ?? 0) + 1);
        const key = names.join('+');
        combos.set(key, (combos.get(key) ?? 0) + 1);
        bump('三倍满局里宝牌番数', r.ura);
        bump('三倍满局宝牌番数', r.dora + r.aka);
      }
    } else {
      const why = e.result.kind !== 'win' ? `流局(${e.result.reason ?? '荒牌'})` : `别人和(第${g.players[me].discards.length + 1}巡)`;
      bump(`bet${bet}·没和`);
      if (process.env.VERBOSE && e.result.kind !== 'win') console.log(`  种子 ${seed} 第 ${g.round} 局 bet${bet}：${why}（${order.map((c) => c.id).join(',')}）`);
      lost.set(why, (lost.get(why) ?? 0) + 1);
    }
  });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 40000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  const rank = 1 + [0, 1, 2, 3].filter((s) => s !== me && g.players[s].score > g.players[me].score).length;
  rankSum += rank;
  if (rank === 1) first++;
}
const keys = Object.keys(out).sort();
console.log(JSON.stringify({ games, avgRank: +(rankSum / games).toFixed(2), first: +(first / games).toFixed(3), sec: +((performance.now() - t0) / 1000).toFixed(1) }));
for (const k of keys) console.log(k, out[k]);
console.log('没和：', [...lost].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('，'));
console.log('役：', [...yaku].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('，'));
console.log('组合', combos.size, '种：', [...combos].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k || '(只有宝牌里宝牌)'} ${v}`).join('，'));
