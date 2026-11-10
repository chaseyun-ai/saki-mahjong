// 宫永咲的岭上开花统计：随机对手或决赛大将桌（咲、稳乃、涅莉、淡），可以用 SAKI_JSON 临时改 SAKI 参数
// 用法：npx vite-node scripts/saki.ts [场数] [rand|final] [起始种子]
// 除了和了率、顺位，还数：
// - 杠材：她手里有刻子（或碰了）时，第四张被别人摸走几次、她自己摸到几次
// - 岭上牌：她摸的岭上牌有几张让手牌前进（或者直接和了）
// - 看见的岭上牌：她看见过的岭上牌，开杠时摸到的是不是同一张（不是就是“变了”）
import { CHARACTERS } from '../src/abilities/characters';
import { SAKI, sakiKanKinds, sakiSeesThrough } from '../src/abilities/saki';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { shanten } from '../src/engine/shanten';
import { type TileId, kindOf, toCounts } from '../src/engine/tiles';

if (process.env.SAKI_JSON) Object.assign(SAKI, JSON.parse(process.env.SAKI_JSON));
const games = Number(process.argv[2] ?? 200);
const table = process.argv[3] === 'final' ? ['saki', 'shizuno', 'nelly', 'awai'] : null;
const from = Number(process.argv[4] ?? 1);
const me = CHARACTERS.find((c) => c.id === 'saki')!;
const st = {
  rounds: 0, wins: 0, rs: 0, rankSum: 0, first: 0, last: 0, dealIns: 0, pts: 0, score: 0,
  awaiWins: 0, awaiRounds: 0, band: 0, absDev: 0, dealSh: 0, dealPairs: 0,
  kans: 0, tenpaiKans: 0, rinshanDraws: 0, rinshanUseful: 0, rinshanWin: 0,
  kanMine: 0, kanStolen: 0, seenChanged: 0, seenDrawn: 0, dealTrip1: 0, dealTrip2: 0, kanShown: 0, multiKan: 0, chainBloom: 0,
};
// 14 张时打一张以后最好的向听（-1 是和了）
const best14 = (hand: TileId[], melds: number) => {
  const c = toCounts(hand);
  if (shanten(c, melds) === -1) return -1;
  let b = 99;
  for (let k = 0; k < 34; k++) {
    if (!c[k]) continue;
    c[k]--;
    b = Math.min(b, shanten(c, melds));
    c[k]++;
  }
  return b;
};
for (let seed = from; seed < from + games; seed++) {
  const rng = new Rng(seed * 977);
  const order = table ? rng.shuffle(table.map((id) => CHARACTERS.find((c) => c.id === id)!)) : rng.shuffle([me, ...rng.shuffle(CHARACTERS.filter((c) => c.id !== 'saki')).slice(0, 3)]);
  const mine = order.indexOf(me);
  const awai = order.findIndex((c) => c.id === 'awai');
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  let before = 99;
  let seenRinshan: TileId | null = null;
  let roundKans = 0;
  const look = () => {
    // 她这一刻看得见的第一张岭上牌（看不见就不记）
    const r0 = g.wall.rinshan[0];
    if (r0 !== undefined && g.active(mine) && sakiSeesThrough(g, mine).has(r0)) seenRinshan = r0;
  };
  g.onEvent((e) => {
    if (e.type === 'roundStart') {
      const c = toCounts(g.players[mine].hand);
      st.dealSh += shanten(c);
      st.dealPairs += c.filter((x) => x >= 2).length;
      const trips = c.filter((x) => x >= 3).length;
      if (trips >= 1) st.dealTrip1++;
      if (trips >= 2) st.dealTrip2++;
      seenRinshan = null;
      roundKans = 0;
    }
    if (e.type === 'draw') {
      const p = g.players[e.seat];
      // 谁开杠摸岭上牌都算：她看见过的第一张岭上牌，摸上来的应该就是它
      if (g.rinshanDraw && seenRinshan !== null) {
        st.seenDrawn++;
        if (p.drawn !== seenRinshan) st.seenChanged++;
      }
      if (g.rinshanDraw) seenRinshan = null;
      if (e.seat === mine && g.rinshanDraw) {
        st.rinshanDraws++;
        const after = best14(p.hand, p.melds.length);
        if (after === -1) st.rinshanWin++;
        if (after < before) st.rinshanUseful++;
      } else if (!g.rinshanDraw && p.drawn !== null) {
        const k = kindOf(p.drawn);
        if (e.seat !== mine && sakiKanKinds(g, mine).includes(k)) st.kanStolen++;
        if (e.seat === mine) {
          const pon = p.melds.some((m) => m.type === 'pon' && kindOf(m.tiles[0]) === k);
          if (toCounts(p.hand)[k] === (pon ? 1 : 4)) st.kanMine++;
        }
      }
    }
    if (e.type === 'ability' && e.seat === mine && e.text === '杠的气息') st.kanShown++;
    if (e.type === 'call' && e.seat === mine && e.call.includes('杠')) {
      st.kans++;
      roundKans++;
      const p = g.players[mine];
      before = shanten(toCounts(p.hand), p.melds.length);
      if (before === 0) st.tenpaiKans++;
    }
    if (e.type !== 'roundEnd') {
      // 只在停下来等人操作的时候看（能力消息是摸牌途中发的，那一刻界面还没画出来）
      if (e.type === 'discard' || e.type === 'call' || (e.type === 'draw' && !g.rinshanDraw)) look();
      return;
    }
    st.rounds++;
    if (roundKans >= 2) st.multiKan++;
    if (awai >= 0) st.awaiRounds++;
    for (const w of e.result.wins) {
      if (w.from === mine) st.dealIns++;
      if (w.seat === awai) st.awaiWins++;
      if (w.seat === mine) {
        st.wins++;
        st.pts += e.result.deltas[mine];
        if (w.result.yaku.some((y) => y.name === '岭上开花')) {
          st.rs++;
          if (roundKans >= 2) st.chainBloom++;
        }
      }
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
  const r = g.ranking().indexOf(mine);
  st.rankSum += r + 1;
  if (r === 0) st.first++;
  if (r === 3) st.last++;
  const sc = g.players[mine].score;
  st.score += sc;
  st.absDev += Math.abs(sc - 30000);
  if (Math.abs(sc - 30000) <= 500) st.band++;
}
if (process.env.SAKI_RAW) {
  console.log(JSON.stringify({ games, ...st }));
} else {
  const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;
  console.log(
    [
      `局数 ${st.rounds}`,
      `和了率 ${pct(st.wins, st.rounds)}`,
      `岭上/局 ${pct(st.rs, st.rounds)}`,
      `岭上占和 ${pct(st.rs, st.wins)}`,
      `打点 ${Math.round(st.pts / Math.max(1, st.wins))}`,
      `顺位 ${(st.rankSum / games).toFixed(2)}`,
      `一位 ${pct(st.first, games)}`,
      `四位 ${pct(st.last, games)}`,
      `均分 ${Math.round(st.score / games)}`,
      `放铳 ${pct(st.dealIns, st.rounds)}`,
      `杠/局 ${(st.kans / st.rounds).toFixed(2)}（听牌杠 ${pct(st.tenpaiKans, st.kans)}）`,
      `第四张：她摸到 ${st.kanMine} 被别人摸走 ${st.kanStolen}`,
      `配牌有刻子 ${pct(st.dealTrip1, st.rounds)}（两个 ${pct(st.dealTrip2, st.rounds)}）`,
      `一局开两杠以上 ${pct(st.multiKan, st.rounds)}，连杠开花 ${st.chainBloom} 次`,
      `岭上牌有用 ${pct(st.rinshanUseful, st.rinshanDraws)}（${st.rinshanDraws} 张）`,
      `看见的岭上牌变了 ${st.seenChanged}/${st.seenDrawn}`,
      `正负零 ${st.band} 场`,
      table ? `淡和了率 ${pct(st.awaiWins, st.awaiRounds)}` : '',
    ]
      .filter(Boolean)
      .join(' | '),
  );
}
