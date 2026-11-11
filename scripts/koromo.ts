// 天江衣的强度和“像不像原作”：每场都让她上桌，另外三家从对手池里抽，座位随机，南风战。
// 用法：npx vite-node scripts/koromo.ts [角色id] [场数] [对手：random|plain|三个id] [起始种子]
// 角色 id 不是 koromo 时只出总成绩（拿来跑基准，抽对手、座位和 strength.ts 一样）
// 只在这个脚本里改，不动游戏代码：
//   PARAMS='{"hellDepth":0}'  改 KOROMO 的数（hellDepth 0 关一向听地狱，flood/tide/night 0 关满潮/潮起潮落/夜之支配，dealDora 0 关月下的配牌，
//                             tenpaiFreeze false 关听牌后别家鸣不了牌，holdUnder 0 小牌也和，aiDisrupt 别家想到去错开的概率）。
//                             flood、tide、night、dealDora 写成 [新月, 满月] 两个数是跟月相走，写成一个数是不看月相
//   MOON=4                    每场都是这个月相（0 新月 … 4 满月 … 7 残月）
//   NOHAITEI=1                不定海底（海底捞月、海底挪移都不发动）
//   READERS=yumi,kana         另外这些人也看得穿海底（每局都会去错开，她听牌时照样能鸣）
// 输出一行 JSON
import { CHARACTERS } from '../src/abilities/characters';
import { KOROMO, KOROMO_READERS, MOON_PHASES, koromoAbility } from '../src/abilities/koromo';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { shanten } from '../src/engine/shanten';
import { toCounts } from '../src/engine/tiles';

const id = process.argv[2] ?? 'koromo';
const games = Number(process.argv[3] ?? 200);
const pool = process.argv[4] ?? 'random';
const from = Number(process.argv[5] ?? 1);
if (process.env.PARAMS) Object.assign(KOROMO, JSON.parse(process.env.PARAMS));
const MOON = process.env.MOON === undefined ? null : Number(process.env.MOON);
if (MOON !== null) {
  const orig = koromoAbility.beforeDeal!;
  koromoAbility.beforeDeal = (g, seat) => {
    (g.abilityGameState[seat] as { moon?: number }).moon ??= MOON;
    return orig(g, seat);
  };
}
if (process.env.NOHAITEI) {
  koromoAbility.afterDeal = () => {};
  const orig = koromoAbility.onCall!;
  koromoAbility.onCall = () => {};
  void orig;
}

if (process.env.READERS) KOROMO_READERS.push(...process.env.READERS.split(','));
type St = { route?: 'deal' | 'call'; on?: boolean; haitei?: number; fogged?: boolean };
const me = CHARACTERS.find((c) => c.id === id)!;
const plain = CHARACTERS.find((c) => c.id === 'izumi')!;
const isK = id === 'koromo';

const T = {
  id, pool, games,
  rankSum: 0, first: 0, second: 0, third: 0, last: 0, score: 0, rounds: 0,
  wins: 0, winPts: 0, tsumo: 0, ron: 0, dealIns: 0, dealInPts: 0, mangan: 0, haneman: 0, baiman: 0, yakuman: 0, hanSum: 0, doraSum: 0,
  riichiWins: 0, ippatsu: 0, busts: 0, // busts：这一场有别家被击飞
  // 衣自己的
  routeDeal: 0, routeCall: 0, noRoute: 0, fogged: 0,
  haiteiWins: 0, haiteiPts: 0, haiteiRiichiIppatsu: 0, haiteiCallWins: 0,
  routeWins: 0, routeWinPts: 0, routeEarlyTsumo: 0, routeRon: 0, // 海底路线的局里她和了：海底前自摸、荣和
  offWins: 0, offWinPts: 0, offRounds: 0,
  disrupted: 0, disruptedBy: {} as Record<string, number>, regained: 0, // 海底被错开过的局、错开以后又挪回来的局
  routeEndOn: 0, routeDrawTenpai: 0, routeDraw: 0, routeDrawOnNoWin: 0,
  routeOtherWin: 0, routeOtherTsumo: 0, routeOtherRon: 0, routeKoromoDealIn: 0,
  offOtherWin: 0, offOtherTsumo: 0,
  // 一向听地狱：海底路线的局流局或结束时，别家听牌的人次 / 总人次；不在路线上的局同样统计
  routeOppTenpai: 0, routeOppSeats: 0, offOppTenpai: 0, offOppSeats: 0,
  routeOppCalls: 0, offOppCalls: 0,
  byMoon: MOON_PHASES.map((m) => ({ name: m.name, games: 0, rankSum: 0, first: 0, rounds: 0, wins: 0, winPts: 0, haiteiWins: 0, route: 0 })),
};

for (let seed = from; seed < from + games; seed++) {
  const rng = new Rng(seed * 977);
  const others =
    pool === 'plain'
      ? [plain, plain, plain]
      : pool.includes(',')
        ? pool.split(',').map((x) => CHARACTERS.find((c) => c.id === x)!)
        : rng.shuffle(CHARACTERS.filter((c) => c.id !== id)).slice(0, 3);
  const order = rng.shuffle([me, ...others]);
  const mine = order.indexOf(me);
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  const st = () => g.abilityState[mine] as St;
  const moonOf = () => (g.abilityGameState[mine] as { moon?: number }).moon ?? 0;
  let wasOn = false, lost = false, regained = false, everRoute = false, oppCalls = 0, lastCaller = -1;
  let gRounds = 0, gWins = 0, gWinPts = 0, gHaitei = 0, gRoute = 0;
  g.onEvent((e) => {
    if (e.type === 'roundStart') {
      wasOn = lost = regained = everRoute = false;
      oppCalls = 0;
      lastCaller = -1;
    }
    if (e.type === 'call' && e.seat !== mine) {
      oppCalls++;
      lastCaller = e.seat;
    }
    if (isK && (e.type === 'draw' || e.type === 'dealt' || e.type === 'discard')) {
      const s = st();
      if (s.route) everRoute = true;
      if (wasOn && !s.on && !lost) {
        lost = true;
        const who = lastCaller >= 0 ? order[lastCaller].id : 'kan';
        T.disruptedBy[who] = (T.disruptedBy[who] ?? 0) + 1;
      }
      if (lost && s.on) regained = true;
      wasOn = !!s.on;
    }
    if (e.type !== 'roundEnd') return;
    T.rounds++;
    gRounds++;
    const s = st();
    const route = isK && (everRoute || !!s.route);
    const r = e.result;
    const myWin = r.wins.find((w) => w.seat === mine);
    for (const w of r.wins) {
      if (w.from === mine) {
        T.dealIns++;
        T.dealInPts -= r.deltas[mine];
      }
    }
    if (myWin) {
      const res = myWin.result;
      const names = res.yaku.map((y) => y.name);
      T.wins++;
      gWins++;
      T.winPts += r.deltas[mine];
      gWinPts += r.deltas[mine];
      if (myWin.from === null) T.tsumo++;
      else T.ron++;
      T.hanSum += res.han;
      T.doraSum += res.dora + res.aka + res.ura;
      if (res.limitName) T.mangan++;
      if (['跳满', '倍满', '三倍满', '累计役满', '役满'].includes(res.limitName) || res.yakuman) T.haneman++;
      if (['倍满', '三倍满', '累计役满', '役满'].includes(res.limitName) || res.yakuman) T.baiman++;
      if (res.yakuman || res.limitName === '累计役满') T.yakuman++;
      if (names.includes('立直') || names.includes('两立直')) T.riichiWins++;
      if (names.includes('一发')) T.ippatsu++;
      if (names.includes('海底捞月')) {
        T.haiteiWins++;
        gHaitei++;
        T.haiteiPts += r.deltas[mine];
        if (names.includes('一发')) T.haiteiRiichiIppatsu++;
        if (myWin.melds.some((m) => m.type !== 'ankan')) T.haiteiCallWins++;
      }
    }
    if (!isK) return;
    if (s.fogged) T.fogged++;
    if (route) {
      gRoute++;
      if (s.route === 'call') T.routeCall++;
      else T.routeDeal++;
      if (lost) T.disrupted++;
      if (regained) T.regained++;
      if (s.on) T.routeEndOn++;
      T.routeOppCalls += oppCalls;
      if (myWin) {
        T.routeWins++;
        T.routeWinPts += r.deltas[mine];
        if (!myWin.result.yaku.some((y) => y.name === '海底捞月')) {
          if (myWin.from === null) T.routeEarlyTsumo++;
          else T.routeRon++;
        }
      }
      for (const w of r.wins) {
        if (w.seat === mine) continue;
        T.routeOtherWin++;
        if (w.from === null) T.routeOtherTsumo++;
        else T.routeOtherRon++;
        if (w.from === mine) T.routeKoromoDealIn++;
      }
      if (r.kind === 'exhaustive') {
        T.routeDraw++;
        if (r.tenpai[mine]) T.routeDrawTenpai++;
        if (s.on) T.routeDrawOnNoWin++;
      }
    } else {
      T.noRoute++;
      T.offRounds++;
      T.offOppCalls += oppCalls;
      if (myWin) {
        T.offWins++;
        T.offWinPts += r.deltas[mine];
      }
      for (const w of r.wins) {
        if (w.seat === mine) continue;
        T.offOtherWin++;
        if (w.from === null) T.offOtherTsumo++;
      }
    }
    // 结束时别家听没听牌（和了的人也算听牌）
    for (let o = 0; o < 4; o++) {
      if (o === mine) continue;
      const p = g.players[o];
      const tenpai = r.wins.some((w) => w.seat === o) || (p.hand.length % 3 === 1 ? shanten(toCounts(p.hand), p.melds.length) === 0 : shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length) === 0);
      if (route) {
        T.routeOppSeats++;
        if (tenpai) T.routeOppTenpai++;
      } else {
        T.offOppSeats++;
        if (tenpai) T.offOppTenpai++;
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
  const rank = g.ranking().indexOf(mine);
  T.rankSum += rank + 1;
  if (rank === 0) T.first++;
  if (rank === 1) T.second++;
  if (rank === 2) T.third++;
  if (rank === 3) T.last++;
  T.score += g.players[mine].score;
  if (g.players.some((p, o) => o !== mine && p.score < 0)) T.busts++;
  if (isK) {
    const b = T.byMoon[moonOf()];
    b.games++;
    b.rankSum += rank + 1;
    if (rank === 0) b.first++;
    b.rounds += gRounds;
    b.wins += gWins;
    b.winPts += gWinPts;
    b.haiteiWins += gHaitei;
    b.route += gRoute;
  }
}
console.log(JSON.stringify(T));
