// 姊带丰音的强度：每场都让她上桌，另外三家从对手池里抽，座位随机，南风战。按这一局起作用的六曜分开统计
// 用法：npx vite-node scripts/toyone-strength.ts [角色id] [场数] [对手：random|plain|三个id] [起始种子]
// 角色 id 不是 toyone 时只出总成绩（拿来跑基准，抽对手、座位和 strength.ts 一样）
// 关技能（只在这个脚本里换掉能力的钩子，不改游戏代码）：
//   OFF=senbu,chase,sensho,shakku,tomobiki,taian,butsumetsu  照常发动、占住这一局，但不起作用（chase：先负追立后不送铳牌）
//   BLOCK=同上的名字  这一种永远不发动（这一局可能换成别的一种）
//   PARAMS='{"dealerSensho":0}'  改 TOYONE 的数
//   VOID=1  每局一开始就占住一个假的六曜：什么技能都没有，电脑照常立直，别家也不再怕先负（只剩她的身子）
// 输出一行 JSON
import { CHARACTERS } from '../src/abilities/characters';
import { TOYONE, toyoneAbility, type RokuyouId } from '../src/abilities/toyone';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { shanten } from '../src/engine/shanten';
import { isRed, kindOf, toCounts } from '../src/engine/tiles';

const id = process.argv[2] ?? 'toyone';
const games = Number(process.argv[3] ?? 200);
const pool = process.argv[4] ?? 'random';
const from = Number(process.argv[5] ?? 1);
const OFF = new Set((process.env.OFF ?? '').split(',').filter(Boolean));
const BLOCK = new Set((process.env.BLOCK ?? '').split(',').filter(Boolean));
const VOID = !!process.env.VOID;
if (process.env.PARAMS) Object.assign(TOYONE, JSON.parse(process.env.PARAMS));

type St = { mode?: RokuyouId; chase?: number[] };
const st = (g: Game, s: number) => g.abilityState[s] as St;

// ---------- 关技能 ----------
const ab = toyoneAbility;
const orig = { beforeDraw: ab.beforeDraw!, beforeAnyDraw: ab.beforeAnyDraw!, dealRules: ab.dealRules!, resist: ab.resist!, nullifies: ab.nullifies! };
const NAME: Record<RokuyouId, string> = { senbu: '先负', sensho: '先胜', shakku: '赤口', tomobiki: '友引', taian: '大安', butsumetsu: '佛灭' };
if (OFF.size || BLOCK.size || VOID) {
  ab.dealRules = (g, seat) => {
    if (VOID) {
      (st(g, seat) as any).mode = '__none';
      return;
    }
    orig.dealRules(g, seat);
    const s = st(g, seat);
    if (s.mode && BLOCK.has(s.mode)) {
      const gs = g.abilityGameState[seat] as { used?: RokuyouId[] };
      gs.used = (gs.used ?? []).filter((x) => x !== s.mode);
      s.mode = undefined;
    }
  };
  ab.beforeDraw = (g, seat, rinshan) => {
    const s = st(g, seat);
    const p = g.players[seat];
    // 被动的三种由这里先判（顺序和 toyone.ts 一样），跳过 BLOCK 的
    if (!s.mode) {
      const tomobikiReady = p.melds.length === 4 && g.waits(seat).length > 0;
      const emit = (m: RokuyouId) => g.emit({ type: 'ability', seat, ability: 'toyone', text: NAME[m] });
      if (!BLOCK.has('senbu') && !p.riichi && g.players.some((q) => q.seat !== seat && q.riichi && g.seesRiichi(q.seat, seat))) (s.mode = 'senbu'), emit('senbu');
      else if (!BLOCK.has('tomobiki') && tomobikiReady) s.mode = 'tomobiki';
      else if (!BLOCK.has('shakku') && !g.manual[seat] && p.hand.some(isRed)) (s.mode = 'shakku'), emit('shakku');
      // 没有能发动的：先占一个假的，原来的钩子就不会再开被挡掉的那种
      if (!s.mode) {
        (s as any).mode = '__none';
        orig.beforeDraw(g, seat, rinshan);
        s.mode = undefined;
        return;
      }
    }
    // 不起作用的那一种：这一次摸牌里不许它动牌山
    if (s.mode && OFF.has(s.mode)) {
      const w = g.wall;
      const [a, b] = [w.bringToLive, w.bringToRinshan];
      w.bringToLive = () => false;
      w.bringToRinshan = () => false;
      try {
        orig.beforeDraw(g, seat, rinshan);
      } finally {
        w.bringToLive = a;
        w.bringToRinshan = b;
      }
      return;
    }
    orig.beforeDraw(g, seat, rinshan);
  };
  ab.beforeAnyDraw = (g, seat, drawer, rinshan) => {
    const r = orig.beforeAnyDraw(g, seat, drawer, rinshan);
    if (!r) return r;
    if (r.text === '先负' && (OFF.has('chase') || OFF.has('senbu'))) return undefined;
    if (r.text === '赤口' && OFF.has('shakku')) return undefined;
    return r;
  };
  ab.resist = (g, seat, from) => (OFF.has('taian') ? 0 : orig.resist(g, seat, from));
  ab.nullifies = (g, seat) => (OFF.has('butsumetsu') ? false : orig.nullifies(g, seat));
}

// 量一下她自己的能力每次摸牌换没换牌：换成进张的（听牌时就是和了牌）、换走进张或者换成别人铳牌的
type Swap = { mode: string; good: boolean; win: boolean; tile: number };
let lastSwap: Swap | null = null;
const inner = ab.beforeDraw!;
ab.beforeDraw = (g, seat, rinshan) => {
  const w = g.wall;
  const p = g.players[seat];
  const before = rinshan ? w.rinshan[0] : w.live[0];
  // NOWIN=1：先负、先胜、赤口加速的时候不直接换成她的和了牌（只帮她进向听；友引照旧）
  const mode0 = st(g, seat).mode;
  const c0 = toCounts(p.hand);
  if (process.env.NOWIN && mode0 !== 'tomobiki' && shanten(c0, p.melds.length) === 0) {
    const winTile = (t: number) => {
      c0[kindOf(t)]++;
      const sh = shanten(c0, p.melds.length);
      c0[kindOf(t)]--;
      return sh < 0;
    };
    const [a, b] = [w.bringToLive, w.bringToRinshan];
    w.bringToLive = (target, pred, rng, from) => a.call(w, target, (t) => pred(t) && !winTile(t), rng, from);
    w.bringToRinshan = (pred, rng) => b.call(w, (t) => pred(t) && !winTile(t), rng);
    try {
      inner(g, seat, rinshan);
    } finally {
      w.bringToLive = a;
      w.bringToRinshan = b;
    }
  } else inner(g, seat, rinshan);
  const after = rinshan ? w.rinshan[0] : w.live[0];
  lastSwap = null;
  if (after === before || after === undefined) return;
  const c = toCounts(p.hand);
  const sh = shanten(c, p.melds.length);
  c[kindOf(after)]++;
  const sh2 = shanten(c, p.melds.length);
  lastSwap = { mode: String(st(g, seat).mode ?? 'none'), good: sh2 < sh, win: sh2 < 0, tile: after };
};

// ---------- 统计 ----------
const me = CHARACTERS.find((c) => c.id === id)!;
const plain = CHARACTERS.find((c) => c.id === 'izumi')!;
const MODES = ['senbu', 'sensho', 'shakku', 'tomobiki', 'taian', 'butsumetsu', 'none'] as const;
type M = (typeof MODES)[number];
const mk = () => ({ rounds: 0, wins: 0, tsumo: 0, dealIns: 0, winPts: 0, net: 0, riichi: 0, tenpai: 0, tenpaiTurn: 0, startTurn: 0, othersRiichiFirst: 0, dealer: 0, othersWin: 0, draw: 0 });
const by: Record<M, ReturnType<typeof mk>> = Object.fromEntries(MODES.map((m) => [m, mk()])) as any;
const tot = { games, rankSum: 0, first: 0, second: 0, third: 0, last: 0, score: 0, rounds: 0, wins: 0, tsumo: 0, dealIns: 0, winPts: 0, riichi: 0, othersRank: 0, othersRounds: 0, othersRiichi: 0, othersWins: 0, othersDealIns: 0, busted: 0 };
const senbu = { chase: 0, chaseWin: 0, chaseRonChased: 0, chaseLost: 0, chaseDealIn: 0, noChaseRiichiWin: 0, gifts: 0 };
const tomo = { delivered: 0, tomoWin: 0, tried: 0 };
const once = { taian: 0, butsumetsu: 0, taianGames: 0, butsumetsuGames: 0 };
const shakkuFirstTurn: number[] = [];
// 每种六曜：换成进张几次、其中直接换成和了牌几次、靠换来的牌自摸了几次；换走进张/换成别人铳牌几次
const swaps: Record<string, { good: number; winTile: number; tsumoBySwap: number; bad: number }> = {};
const sw = (m: string) => (swaps[m] ??= { good: 0, winTile: 0, tsumoBySwap: 0, bad: 0 });

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
  // 第一局的 roundStart 在建 Game 时就发了，这里先记上开局点数
  let startScore = g.players[mine].score;
  let tenpaiTurn: number | null = null;
  let modeTurn: number | null = null;
  let firstOtherRiichi: number | null = null; // 别人第一次立直时她打了几张
  let gifts = 0;
  let delivered = false;
  let drawSwap: Swap | null = null;
  g.onEvent((e) => {
    if (e.type === 'draw' && e.seat === mine) {
      drawSwap = lastSwap && g.players[mine].drawn === lastSwap.tile ? lastSwap : null;
      lastSwap = null;
      if (drawSwap) {
        const x = sw(drawSwap.mode);
        if (drawSwap.good) x.good++;
        else x.bad++;
        if (drawSwap.win) x.winTile++;
      }
    } else if (e.type === 'draw') lastSwap = null;
    if (e.type === 'roundStart') {
      startScore = g.players[mine].score;
      tenpaiTurn = modeTurn = firstOtherRiichi = null;
      gifts = 0;
      delivered = false;
    }
    if (e.type === 'discard' && e.riichi && e.seat !== mine && firstOtherRiichi === null) firstOtherRiichi = g.players[mine].discards.length;
    if (e.type === 'ability' && e.seat === mine && id === 'toyone') {
      if (modeTurn === null && ['先负', '先胜', '赤口', '大安', '佛灭'].includes(e.text)) modeTurn = g.players[mine].discards.length;
      if (e.text === '友引') delivered = true;
    }
    // 先负追立以后真把她的铳牌换给了别人
    if (e.type === 'ability' && e.seat === mine && e.text === '先负' && (e as any).target !== undefined) gifts++;
    if (e.type !== 'roundEnd') return;
    const r = e.result;
    tot.rounds++;
    const won = r.wins.find((w) => w.seat === mine);
    const net = g.players[mine].score - startScore;
    if (won) {
      tot.wins++;
      tot.winPts += r.deltas[mine];
      if (won.from === null) tot.tsumo++;
      if (won.from === null && drawSwap?.win) sw(drawSwap.mode).tsumoBySwap++;
    }
    if (r.wins.some((w) => w.from === mine)) tot.dealIns++;
    if (g.players[mine].riichi) tot.riichi++;
    for (let s = 0; s < 4; s++) {
      if (s === mine) continue;
      tot.othersRounds++;
      if (g.players[s].riichi) tot.othersRiichi++;
      if (r.wins.some((w) => w.seat === s)) tot.othersWins++;
      if (r.wins.some((w) => w.from === s)) tot.othersDealIns++;
    }
    if (id !== 'toyone') return;
    const s = st(g, mine);
    // VOID 占的假六曜算成没有
    const m: M = s.mode && s.mode in by ? (s.mode as M) : 'none';
    const b = by[m];
    b.rounds++;
    if (mine === g.dealer) b.dealer++;
    if (won) {
      b.wins++;
      b.winPts += r.deltas[mine];
      if (won.from === null) b.tsumo++;
    } else if (r.wins.length) b.othersWin++;
    else b.draw++;
    if (r.wins.some((w) => w.from === mine)) b.dealIns++;
    b.net += net;
    if (g.players[mine].riichi) b.riichi++;
    if (tenpaiTurn !== null) {
      b.tenpai++;
      b.tenpaiTurn += tenpaiTurn;
    }
    if (modeTurn !== null) b.startTurn += modeTurn;
    if (firstOtherRiichi !== null) b.othersRiichiFirst++;
    if (m === 'shakku' && modeTurn !== null) shakkuFirstTurn.push(modeTurn);
    if (m === 'senbu') {
      senbu.gifts += gifts;
      if (s.chase) {
        senbu.chase++;
        if (won) senbu.chaseWin++;
        if (won && won.from !== null && s.chase.includes(won.from)) senbu.chaseRonChased++;
        if (!won && r.wins.length) senbu.chaseLost++;
        if (r.wins.some((w) => w.from === mine)) senbu.chaseDealIn++;
      } else if (r.wins.some((w) => w.seat !== mine && g.players[w.seat].riichi)) senbu.noChaseRiichiWin++;
    }
    if (m === 'tomobiki') {
      tomo.tried++;
      if (delivered) tomo.delivered++;
      if (won) tomo.tomoWin++;
    }
    if (m === 'taian') once.taian++;
    if (m === 'butsumetsu') once.butsumetsu++;
  });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 100000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
    const p = g.players[mine];
    if (tenpaiTurn === null && p.hand.length % 3 === 1 && shanten(toCounts(p.hand), p.melds.length) <= 0) tenpaiTurn = p.discards.length;
  }
  const rank = g.ranking().indexOf(mine);
  for (let s = 0; s < 4; s++) if (s !== mine) tot.othersRank += g.ranking().indexOf(s) + 1;
  tot.rankSum += rank + 1;
  [() => tot.first++, () => tot.second++, () => tot.third++, () => tot.last++][rank]();
  tot.score += g.players[mine].score;
  if (g.players[mine].score < 0) tot.busted++;
  if (id === 'toyone') {
    const used = ((g.abilityGameState[mine] as { used?: RokuyouId[] }).used ?? []) as RokuyouId[];
    if (used.includes('taian')) once.taianGames++;
    if (used.includes('butsumetsu')) once.butsumetsuGames++;
  }
}
const sorted = shakkuFirstTurn.sort((a, b) => a - b);
console.log(JSON.stringify({ id, pool, from, off: [...OFF], block: [...BLOCK], params: process.env.PARAMS ?? null, tot, by: id === 'toyone' ? by : undefined, senbu, tomo, once, swaps, shakkuMedianTurn: sorted[Math.floor(sorted.length / 2)] ?? null }));
