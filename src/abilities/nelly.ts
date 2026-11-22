import type { Game } from '../engine/game';
import { Rng } from '../engine/rng';
import { shanten, waitingKinds } from '../engine/shanten';
import { EAST, HAKU, TileId, doraFromIndicator, isRed, kindOf, suitOf, toCounts } from '../engine/tiles';
import { kuroSeat } from './doraControl';
import { isDoraTile, kuroLost } from './kuro';
import { type Recipe, type RecipeAsk, planBest } from './nellyRecipe';
import { teruWinValue } from './teru';
import { PRIORITY, type Ability, type PreDealOption } from './types';

// 涅莉·薇萨拉兹（临海女子）：分配运势的人。家里穷，打得亮眼才拉得到赞助，所以她要和就和大牌。
// - 运势开局排好（NELLY.plan，试验中）：东一局发牌前把 10 点运势分到这一场的各局（每局 0–3 点），之后不能改。
//   连庄、流局重打的本场不再用那一局的运势；比赛提前结束，排在后面的就浪费了。电脑也在开局排好（nellyAiPlan）。
//   NELLY.plan 是 null 时用下面的攒运势：
// - 运势是攒出来的：开场 0 点，每忍一局（没押运势的局，连庄、流局重打的也算）打完攒 1 点，最多攒 6 点（NELLY.charge）。
//   原作里她前面趴在地上挨打、把浪头攒起来，最好的牌留到最后：忍三局才换得来一手三倍满，大牌自然落在后半场。
//   （原来是开场 10 点、每打满 4 局恢复 1 点，东一局就能出三倍满、一个半庄三手；NELLY.charge 设成 null 还是那样，测试里用）
// - 分配运势（每一局发牌前）：这一局押几点，押了就扣掉，和没和都不退：
//   · 1 点：进张朝 3 番到满贯发展，第 15 巡左右（快流局时）和
//   · 2 点：朝跳满发展，第 12 巡左右和
//   · 3 点：朝三倍满发展，第 7 巡左右立直、一发自摸三倍满（立直、一发、自摸加里宝牌，里宝牌往她手里最多的牌上变）。照配牌定好一手三倍满：
//     宝牌能动就做混一色加宝牌刻子（宝牌指示牌指向它），玄在场宝牌动不了就做清一色（七对子也算），每巡来缺的那张；听牌了别人摸不走她要和的牌。而且这一局她的和牌别人挡不住（别人的能力管不到她：不许和、换走和了牌、封印都不算）
//   配牌照常发，不动（押 2、3 点时宝牌指示牌指向她配牌里最多的那种牌）。装装样子：到那一巡之前摸不到和了牌（摸牌按巡数慢慢变好，听牌了先来把牌做大的牌：
//   那门花色、宝牌、字牌对子），到了那一巡牌够大就来和了牌。押 2、3 点立直了里宝牌往她手里最多的牌上变，有宝牌暗刻就在那一巡来第四张开暗杠、岭上开花。押了几点只有她自己知道
// - 感知听牌：手里还有运势（押完这一局还剩 1 点以上）就看得出别人听没听牌（不知道听什么）。
// - 七姐妹：一场 7 次，不恢复。押了运势的局自动开着：每有一家听牌，用掉一次给他上一个软封印：这一局他摸不到和了牌
//   （轮到他摸、岭上摸的和了牌都被换走，自摸不了；他自己的能力锁好的和了牌，比如咲的岭上牌，也照换），别人打出来的牌照样能荣和。
//   他的能力照用、照样能听牌。被封的人要和的牌谁都摸不到（埋到牌山后面），所以他们只能荣和别人手里本来就有的牌；
//   涅莉看得见被封的人在等什么，自己打牌避开（电脑），少点炮给他们。
//   押几点这一局最多封几家（3 点封三家）。别人能力管不到的人封不住；次数用完了就不封了
//   （试验，NELLY.slow）押了运势的局还让别人慢点听牌：一向听的人摸牌时摸不到让她听牌的牌（不用次数，吃碰照样能听）
// - （试验，NELLY.kanRoute）押 3 点有一成的局走开杠路线：目标牌里留一组刻子（第四张别人摸不走），立直以后先摸第四张开暗杠，
//   岭上牌自摸三倍满（一发换成岭上开花；杠了翻的宝牌不中她的牌，番数交给里宝牌调）。手里凑不出这样的刻子就照常一发自摸
// 电脑的涅莉：把剩下的局怎么押都算一遍（nellyAiCharge），挑加起来和得最多的押法：3 点最划算（九成和出三倍满），所以多半忍到攒够 3 点、
// 等自己坐庄的局押下去；别人能力最强的局（优希的东场、尧深的收获局、爽最后两局）不押；一样多就往后留。
// 押了运势的局门清做大，到那一巡之前不和，牌不够大先不和。
// （NELLY.charge 是 null 时照原来的 nellyAiBet：坐庄押 3 点，后面坐庄的局留着，多出来的落后或快结束时押）
// 重做（试验，NELLY_REMAKE）：开场 3 点运势，东一局发牌前照样分到这一场的各局（每局 0–3 点），之后不能改。押了运势的局就是三倍满的局：
// - 押 1 点：第 7 巡（她第 7 次摸牌）自摸三倍满，前一巡立直、一发自摸。同一局叠着押，每多 1 点晚 6 巡：2 点第 13 巡，
//   3 点第 19 巡（一局里摸不到那么多次，就是她最后一次摸牌，海底也算）；七姐妹押几点封几家，叠着押换来多封几家
// - 三倍满照配牌挑做法（nellyRecipe）：所有 4 组面子加雀头、七对子的做法摸一遍，挑役多、役大、这一场前面没做过的役
//   （平和、断幺九、一杯口、三色、一气通贯、全带幺九、三暗刻、役牌、小三元、七对子……不再老是混一色、清一色），
//   宝牌（宝牌能动时发牌前定好指向哪种牌）、里宝牌（和牌时定）只补差的番数，补到正好 11–12 番。缺的牌一巡来一张，最后自摸的那张留到最后；
//   配牌太差（玄在场宝牌里宝牌都用不上）缺的牌比摸得到的次数还多，就换几张配牌
// - 这一局她的和牌别人挡不住（和牌那一次摸牌，下一张被别人锁着也照换，锁留在原来的位置）；感知听牌、七姐妹、慢点听牌照旧
// - 叠着押拖得久，七姐妹封住的人等的牌她躲着打，躲的时候少拆定好的那手；到了该立直的那一巡就不躲了
// 选人页的“重做 / 初版”切换：初版（PlayerConfig.startForm）就是上面原来的涅莉（10 点运势、押 1/2/3 点做 3 番/跳满/三倍满）。电脑的涅莉用重做
export const NELLY_REMAKE = {
  on: true, // false：谁都用初版（测试里用）
  total: 3, // 开场的运势
  turn: 7, // 押 1 点：第几巡自摸三倍满
  delay: 6, // 同一局每多押 1 点晚几巡
  budget: 7, // 一手三倍满最多缺几张（缺得多算得慢）
  far: 11, // 挑不出来时只看一门花色加字牌，最多缺几张（多出来的换配牌）
  last: 4, // 她摸牌前牌山剩这么多以下：这是她最后一次摸牌
  kanRoute: 0.15, // 有这么大的机会走开杠路线（立直以后先开暗杠，岭上开花代替一发）
};

// 这一位涅莉用重做（选人页选了初版的是 startForm）
export function nellyRemade(g: Game, seat: number): boolean {
  return NELLY_REMAKE.on && !g.startForm?.[seat];
}

export const NELLY = {
  start: 10, // 原来的规矩（charge 是 null 时）：开场的运势
  every: 4, // 原来的规矩：每打满几局恢复 1 点
  maxBet: 3, // 一局最多押几点
  sisters: 7,
  hide: true, // 七姐妹：被封的人要和的牌谁都摸不到（她们只能荣和别人手里本来就有的牌）
  dodge: true, // 七姐妹：涅莉看得见被封的人在等什么，打牌、摸牌避开
  // 试验：押了运势的局让别人慢点听牌：一向听的人摸牌时，这么大的机会摸不到让她听牌的牌（按押几点；0 是不管）
  slow: [0, 1, 1, 1] as number[],
  // 开局排运势（试验中）：东一局发牌前把 total 点分到各局，每局最多 maxBet 点；null 是下面的攒运势
  plan: { total: 10 } as null | { total: number },
  // 攒运势：开场 start 点，没押运势的局打完攒 gain 点，最多攒到 cap 点（null 是原来那样开场一大笔）。
  // 随机对手 400 半庄：开场 0 点平均顺位 1.39、一位 77%；开场 3 点 1.18、87%；原来开场 10 点 1.12、89.5%
  charge: { start: 0, gain: 1, cap: 6 } as null | { start: number; gain: number; cap: number },
  // 攒运势时电脑估一局押 1/2/3 点大概和得到多少（子家；庄家 1.5 倍），拿来排剩下的局怎么押
  worth: [0, 4000, 10000, 21000],
  // 押 1/2/3 点时这一局要做到多大（子家的点数，庄家按 1.5 倍）：3 番（30 符）、跳满、三倍满
  target: [0, 3900, 12000, 24000],
  // 和了牌先挑不超过这么大的（1 点到满贯为止、2 点就是跳满）
  cap: [0, 8000, 12000, Infinity],
  // 押 2、3 点：发牌前把宝牌指示牌换成指向她配牌里最多的那种牌（配牌本身不动）
  dora: [false, false, true, true],
  // 押 1/2/3 点时第几巡和（她摸第几张牌）：之前摸不到和了牌
  turn: [0, 15, 12, 7], // 押 3 点原来是第 8 巡；软封印的人照样能荣和，提早到第 7 巡，给她们和牌的时间少一点
  // 到了那一巡牌还不够大，再等几巡就有什么和什么
  grace: 3,
  late: 8, // 牌山剩这么多以下就有什么和什么
  // 押 3 点做染手（配牌里最多的那门花色）
  flush: [false, false, false, true],
  // 三倍满：11 番，押 3 点最多做到 12 番（不冲累计役满）
  bigHan: 11,
  maxHan: 12,
  // 试验：押 3 点的局有这么大的机会走开杠的路线：立直以后先摸到暗刻的第四张开暗杠，岭上牌自摸三倍满
  // （一发没了，换成岭上开花；多翻一张宝牌、一张里宝牌）。手里没有杠了不改听牌的暗刻就照常一发自摸
  kanRoute: 0.1,
};

const TIER_NAMES = ['', '3番–满贯', '跳满', '三倍满'];

interface NellyGameState {
  recipes?: string[][]; // 重做：这一场前面几手三倍满做的役（换着做）
  spent?: number; // 一共押掉了几点
  pick?: number; // 玩家在发牌前界面押的
  sisters?: number; // 七姐妹还剩几次
  log?: number[]; // 每一局押了几点（照魔镜看得到）
  plan?: number[]; // 开局排好的：第几局（东 1 是 0）押几点
  used?: number[]; // 已经用过运势的局（连庄、流局重打的本场不再用）
}
interface NellyState {
  bet?: number; // 这一局押了几点
  blocked?: number[]; // 这一局被七姐妹软封印的人（摸不到和了牌，荣和照样可以）
  suit?: number; // 这一局做的花色
  honors?: boolean; // 做染手：带字牌（混一色）还是不带（清一色）。undefined 是不做染手
  plan?: number[]; // 押 3 点：要做成的那手牌（14 张，按种类数）
  kan?: boolean; // 押 3 点：这一局走开杠的路线（试验）
  kanned?: boolean; // 开杠路线：杠过了
  recipe?: Recipe; // 重做：这一局要做成的三倍满（plan 是它的 14 张）
  logged?: number; // 重做：这一局的三倍满记在 recipes 的第几个
  tried?: string; // 重做：重挑过的手牌（同一手不再挑）
  stashed?: boolean; // 重做：自摸的那张藏进王牌了
}

const gameStateOf = (g: Game, seat: number) => {
  const gs = g.abilityGameState[seat] as NellyGameState;
  gs.sisters ??= NELLY.sisters;
  gs.spent ??= 0;
  gs.log ??= [];
  return gs;
};
const stateOf = (g: Game, seat: number) => {
  const st = g.abilityState[seat] as NellyState;
  st.blocked ??= [];
  return st;
};

// 第 round 局（从 1 数）开始时一共恢复了几点
const regen = (round: number) => Math.floor(Math.max(0, round - 1) / NELLY.every);

// 一局打完到下一局发牌之间（还没押）。电脑的局发牌时 phase 还是 roundEnd，要看这一局结算了没有
const between = (g: Game) => g.round === 0 || g.phase === 'predeal' || (g.phase === 'roundEnd' && g.roundResult !== null);

// 攒运势：照每一局押了几点从头算一遍（押了的局扣掉，没押的局打完攒一点）。n：算到第几局为止
const charged = (log: number[], n = log.length) => {
  const c = NELLY.charge!;
  let p = c.start;
  for (let i = 0; i < n; i++) p = log[i] > 0 ? p - log[i] : Math.min(c.cap, p + c.gain);
  return p;
};

// 还剩几点运势。一局打完以后、发牌前（还没押）算的是马上要开的那一局能押的（算上这一局恢复的）
export function nellyPool(g: Game, seat: number): number {
  if (NELLY.plan) {
    const gs = gameStateOf(g, seat);
    // 这一局的先定下来（用掉了就不算在“还剩”里）
    if (!between(g)) tierOf(g, seat);
    // 还没排：整笔都在手里
    if (!gs.plan) return planTotal(g, seat);
    return gs.plan.reduce((n, v, i) => n + (gs.used?.includes(i) ? 0 : v), 0);
  }
  if (NELLY.charge) {
    const log = gameStateOf(g, seat).log!;
    if (between(g)) return charged(log);
    // 这一局押的扣掉；没押的话攒的那一点打完才到手
    const bet = tierOf(g, seat);
    return charged(log, log.length - 1) - bet;
  }
  const round = between(g) ? g.round + 1 : g.round;
  if (!between(g)) tierOf(g, seat);
  return NELLY.start + regen(round) - gameStateOf(g, seat).spent!;
}

// 别人能力最强的局（第几局，东 1 是 0；8 局或 4 局）：这几局别人也要和，涅莉不去抢
const HOT: Record<string, (slots: number) => number[]> = {
  yuuki: (n) => (n === 8 ? [0, 1, 2, 3, 7] : [0, 1, 2, 3]), // 东场；最后一局有塔可饼
  takami: (n) => [n - 1], // 收获的局
  sawaya: (n) => [n - 2, n - 1], // 最后两局把云和神威用掉
};

// 电脑押几点。pool：现在能押的运势；plan：算上剩下的局还会恢复的；left：包括这一局还剩几局；dealer：这一局她坐庄（连庄的不算）；
// dealersLeft：这一局以后她还要坐几次庄；contested：这一局是别人能力最强的局；behind：她是第三、四名
export interface NellyBetSpot {
  pool: number;
  plan: number;
  left: number;
  dealer: boolean;
  dealersLeft: number;
  contested: boolean;
  behind: boolean;
}
export function nellyAiBet(o: NellyBetSpot): number {
  const cap = Math.min(NELLY.maxBet, o.pool);
  if (cap <= 0) return 0;
  // 最后一局押光
  if (o.left <= 1) return cap;
  if (o.dealer) return cap >= 3 ? 3 : 0;
  if (o.contested) return 0;
  // 后面坐庄的局各留 3 点，多出来的才在这一局用
  const spare = Math.min(o.pool, o.plan - 3 * o.dealersLeft);
  const others = o.left - 1 - o.dealersLeft; // 这一局以后不坐庄的局
  if (spare >= 3) {
    // 落后就押；不然等到剩下的局刚好够把多出来的 3 点押完
    // （零头也要留一局押）
    if (o.behind || others < Math.ceil((o.plan - 3 * o.dealersLeft) / 3)) return 3;
    return 0;
  }
  // 零头（1、2 点）：后面没有不坐庄的局了就押掉
  if (spare > 0 && others <= 0) return Math.min(cap, spare);
  return 0;
}

// 这一场照计划有几局（东风战 4 局、半庄和团体赛 8 局、一局战 1 局）
export const nellySlots = (g: Game) => (g.format === 'one' ? 1 : g.fullHanchan ? 8 : 4);

// 开局排运势，电脑的排法。dealers：她坐庄的局；hot：别人能力最强的局（不排）。
// 坐庄的局先排满 3 点（三倍满庄家 1.5 倍）；剩下的从最后一局往前排（最好的牌留到最后），每局排满再排前一局
export function nellyAiPlan(slots: number, dealers: number[], hot: number[] = []): number[] {
  const plan = Array.from({ length: slots }, () => 0);
  let left = NELLY.plan!.total;
  const put = (i: number) => {
    const n = Math.min(NELLY.maxBet - plan[i], left);
    plan[i] += n;
    left -= n;
  };
  for (const i of dealers) if (i < slots && !hot.includes(i)) put(i);
  for (let i = slots - 1; i >= 0 && left > 0; i--) if (!hot.includes(i)) put(i);
  // 还有剩（能排的局太少）：别人最强的局也排上
  for (let i = slots - 1; i >= 0 && left > 0; i--) put(i);
  return plan;
}

// 开场的运势（重做 3 点，初版 10 点）
const planTotal = (g: Game, seat: number) => (nellyRemade(g, seat) ? NELLY_REMAKE.total : NELLY.plan!.total);

// 重做的电脑排法：一局押 1 点（叠着押只会晚和），坐庄的局先（三倍满庄家 36000），剩下的从最后一局往前排，别人最强的局不排。
// 局比点数少（一局战）就只押局数那么多，剩下的不用
export function nellyRemakePlan(slots: number, dealers: number[], hot: number[] = [], total = NELLY_REMAKE.total): number[] {
  const plan = Array.from({ length: slots }, () => 0);
  let left = total;
  const put = (i: number) => {
    if (left > 0 && plan[i] === 0) {
      plan[i] = 1;
      left--;
    }
  };
  for (const i of dealers) if (i < slots && !hot.includes(i)) put(i);
  for (let i = slots - 1; i >= 0; i--) if (!hot.includes(i)) put(i);
  for (let i = slots - 1; i >= 0; i--) put(i);
  return plan;
}

const planFor = (g: Game, seat: number) => {
  const slots = nellySlots(g);
  const all = Array.from({ length: slots }, (_, i) => i);
  return (nellyRemade(g, seat) ? nellyRemakePlan : nellyAiPlan)(
    slots,
    all.filter((i) => (g.firstDealer + (i % 4)) % 4 === seat),
    all.filter((i) => [0, 1, 2, 3].some((s) => s !== seat && (HOT[g.abilities[s]?.id ?? '']?.(slots) ?? []).includes(i))),
  );
};

// 攒运势时电脑押几点。pool：现在能押的；rounds：这一局和后面的每一局（她坐不坐庄、是不是别人能力最强的局）。
// 把剩下的局怎么押都算一遍，挑加起来和得最多的；一样多就往后留（最好的牌留到最后）
export function nellyAiCharge(pool: number, rounds: { dealer: boolean; contested: boolean }[]): number {
  const c = NELLY.charge!;
  const memo = new Map<number, { v: number; bet: number }>();
  const best = (i: number, p: number): { v: number; bet: number } => {
    if (i >= rounds.length) return { v: 0, bet: 0 };
    const key = i * 100 + p;
    const hit = memo.get(key);
    if (hit) return hit;
    let out = { v: -1, bet: 0 };
    for (let b = 0; b <= Math.min(NELLY.maxBet, p); b++) {
      const now = rounds[i].contested ? 0 : NELLY.worth[b] * (rounds[i].dealer ? 1.5 : 1);
      const v = now + best(i + 1, b > 0 ? p - b : Math.min(c.cap, p + c.gain)).v;
      // 一样多：这一局少押（留到后面）
      if (v > out.v) out = { v, bet: b };
    }
    memo.set(key, out);
    return out;
  };
  return best(0, pool).bet;
}

const aiBet = (g: Game, seat: number) => {
  const slots = g.fullHanchan ? 8 : 4;
  const slot = g.roundWind * 4 + g.roundNumber;
  const left = Math.max(1, slots - slot);
  const hot = (x: number) => [0, 1, 2, 3].some((s) => s !== seat && (HOT[g.abilities[s]?.id ?? '']?.(slots) ?? []).includes(x));
  const contested = hot(slot);
  // 第 x 局（东 1 是 0）谁坐庄：起家往下数
  const mine = (x: number) => (g.firstDealer + (x % 4)) % 4 === seat;
  if (NELLY.charge) {
    const rounds = [{ dealer: seat === g.dealer, contested }];
    for (let x = slot + 1; x < slots; x++) rounds.push({ dealer: mine(x), contested: hot(x) });
    return nellyAiCharge(nellyPoolBefore(g, seat), rounds);
  }
  let dealersLeft = 0;
  for (let x = slot + 1; x < slots; x++) if (mine(x)) dealersLeft++;
  const score = g.players[seat].score;
  const behind = [0, 1, 2, 3].filter((s) => s !== seat && g.players[s].score > score).length >= 2;
  const pool = nellyPoolBefore(g, seat);
  return nellyAiBet({
    pool,
    // 后面还会恢复的（连庄、流局多出来的局不算）
    plan: pool + regen(g.round + left - 1) - regen(g.round),
    left,
    dealer: seat === g.dealer && g.honba === 0,
    dealersLeft,
    contested,
    behind,
  });
};

// 这一局押之前有几点
const nellyPoolBefore = (g: Game, seat: number) => (NELLY.charge ? charged(gameStateOf(g, seat).log!) : NELLY.start + regen(g.round) - gameStateOf(g, seat).spent!);

// 这一局押了几点：一局开始以后第一次问到时定下来、扣掉（谁先问都一样：别人定配牌规矩时就要知道她是不是三倍满的局）
function tierOf(g: Game, seat: number): number {
  const st = stateOf(g, seat);
  if (st.bet !== undefined) return st.bet;
  if (between(g)) return 0;
  const gs = gameStateOf(g, seat);
  if (NELLY.plan) {
    // 开局排好的：照这一局排的押；这一局用过了（连庄、流局重打的本场）就不再押。玩家没排就是一点都没排
    gs.plan ??= g.manual[seat] ? [] : planFor(g, seat);
    gs.used ??= [];
    const slot = g.roundWind * 4 + g.roundNumber;
    const bet = gs.used.includes(slot) ? 0 : Math.max(0, Math.min(NELLY.maxBet, gs.plan[slot] ?? 0));
    if (!gs.used.includes(slot)) gs.used.push(slot);
    st.bet = bet;
    gs.spent! += bet;
    gs.log!.push(bet);
    return bet;
  }
  const pool = nellyPoolBefore(g, seat);
  const want = g.manual[seat] ? gs.pick ?? 0 : aiBet(g, seat);
  // 玩家押的不够就不押（发牌前界面上押不了）
  const bet = want > pool ? (g.manual[seat] ? 0 : pool) : Math.max(0, Math.min(NELLY.maxBet, want));
  st.bet = bet;
  gs.spent! += bet;
  gs.log!.push(bet);
  return bet;
}

// 这一局押了几点（0 是没押）
export function nellyTier(g: Game, seat: number): number {
  return tierOf(g, seat);
}

// 这一局是三倍满的局：重做押了就是，初版押 3 点
const big = (g: Game, seat: number) => tierOf(g, seat) >= (nellyRemade(g, seat) ? 1 : 3);
export function nellyBig(g: Game, seat: number): boolean {
  return big(g, seat);
}

// 这一局要做到多大（按她的点数算：庄家 1.5 倍）
export function nellyTarget(g: Game, seat: number): number {
  const t = NELLY.target[big(g, seat) ? 3 : tierOf(g, seat)];
  return seat === g.dealer ? t * 1.5 : t;
}

export function nellySisters(g: Game, seat: number): number {
  return gameStateOf(g, seat).sisters!;
}

// 被七姐妹软封印的人：这一局摸不到和了牌（自摸不了），荣和照样可以
export function nellyBlocked(g: Game, seat: number): number[] {
  return stateOf(g, seat).blocked!;
}

// 被七姐妹软封印的人在等的牌（涅莉看得见；能力管不到的人不算）
export function nellySealedWaits(g: Game, seat: number): Set<number> {
  const st = stateOf(g, seat);
  return new Set(st.blocked!.flatMap((o) => (g.binds(seat, o) ? waitingKinds(toCounts(g.players[o].hand), g.players[o].melds.length) : [])));
}

// 这一局做的花色（没押是 null）
export function nellySuit(g: Game, seat: number): number | null {
  return tierOf(g, seat) > 0 ? stateOf(g, seat).suit ?? null : null;
}

// 这一局做染手：做哪门花色、带不带字牌（不做是 null）
export function nellyFlush(g: Game, seat: number): { suit: number; honors: boolean } | null {
  const st = stateOf(g, seat);
  return tierOf(g, seat) > 0 && st.suit !== undefined && st.honors !== undefined ? { suit: st.suit, honors: st.honors } : null;
}

const inFlush = (f: { suit: number; honors: boolean }) => (k: number) => (k >= 27 ? f.honors : suitOf(k) === f.suit);

// 只看染手那几种牌的向听
const flushShanten = (counts: number[], melds: number, f: { suit: number; honors: boolean }) => {
  const ok = inFlush(f);
  return shanten(counts.map((n, k) => (ok(k) ? n : 0)), melds);
};

// 还有运势：看得出别人听没听牌
export function nellySenses(g: Game, seat: number): boolean {
  return g.round >= 1 && nellyPool(g, seat) > 0;
}

// target 听牌了没有（涅莉感知到的，只看听没听）。viewer 是涅莉的座位：智叶藏着的听牌感知不到
export function nellySensesTenpai(g: Game, target: number, viewer?: number): boolean {
  const p = g.players[target];
  if (viewer !== undefined && g.tenpaiHidden(target, viewer)) return false;
  return shanten(toCounts(p.hand), p.melds.length) <= 0;
}

// 七姐妹：押了运势的局，每有一家听牌用掉一次给他上软封印
function sweep(g: Game, seat: number): void {
  if (tierOf(g, seat) <= 0) return;
  const gs = gameStateOf(g, seat);
  const st = stateOf(g, seat);
  // 押几点这一局最多封几家
  for (let o = 0; o < 4 && gs.sisters! > 0 && st.blocked!.length < tierOf(g, seat); o++) {
    if (o === seat || st.blocked!.includes(o) || !g.binds(seat, o) || !nellySensesTenpai(g, o, seat)) continue;
    gs.sisters!--;
    st.blocked!.push(o);
    // 不写 target：七姐妹要放切入（写了 target 的是悄悄换牌）
    g.emit({ type: 'ability', seat, ability: 'nelly', text: '七姐妹' });
  }
}

// 慢点听牌（试验）：押了运势的局，drawer 一向听时让她听牌的那几种牌（不管的话是空的）
function slowKinds(g: Game, seat: number, drawer: number): number[] {
  const chance = NELLY.slow[tierOf(g, seat)] ?? 0;
  if (chance <= 0 || drawer === seat || !g.binds(seat, drawer)) return [];
  const p = g.players[drawer];
  const counts = toCounts(p.hand);
  if (shanten(counts, p.melds.length) !== 1) return [];
  if (chance < 1 && g.rng.next() >= chance) return [];
  const out: number[] = [];
  for (let k = 0; k < 34; k++) {
    if (counts[k] >= 4) continue;
    counts[k]++;
    // 摸进来再打一张就听牌：14 张的向听是 0
    if (shanten(counts, p.melds.length) === 0) out.push(k);
    counts[k]--;
  }
  return out;
}

const useful = (g: Game, seat: number) => {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const sh = shanten(counts, p.melds.length);
  return (t: TileId) => {
    counts[kindOf(t)]++;
    const after = shanten(counts, p.melds.length);
    counts[kindOf(t)]--;
    return after < sh;
  };
};

// 摸到 t 自摸的话和多少（和不了是 0）
const drawValue = (g: Game, seat: number) => {
  const p = g.players[seat];
  const memo = new Map<number, number>();
  return (t: TileId) => {
    const k = kindOf(t);
    if (!memo.has(k)) {
      p.hand.push(t);
      try {
        const r = g.winResult(seat, t, true);
        memo.set(k, r ? teruWinValue(r, true, seat === g.dealer) : 0);
      } finally {
        p.hand.pop();
      }
    }
    return memo.get(k)!;
  };
};

// 听牌了、牌山里却一张和了牌都没有（死听）：摸了 t 以后打掉一张还能听牌、而且听的牌牌山里还有
// min：听的牌牌山里至少还有几张
const reshape = (g: Game, seat: number, min = 1) => {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const left = toCounts(g.wall.live.slice(1));
  return (t: TileId) => {
    counts[kindOf(t)]++;
    let ok = false;
    for (let d = 0; d < 34 && !ok; d++) {
      if (!counts[d] || d === kindOf(t)) continue;
      counts[d]--;
      if (shanten(counts, p.melds.length) === 0) ok = waitingKinds(counts, p.melds.length).reduce((n, k) => n + left[k], 0) >= min;
      counts[d]++;
    }
    counts[kindOf(t)]--;
    return ok;
  };
};

// 她这次摸的是第几张（第几巡）
export function nellyTurn(g: Game, seat: number): number {
  return g.players[seat].discards.length + 1;
}

// 13 张的手听的牌牌山里还有几张（她的运势知道）
export function nellyLiveWaits(g: Game, hand: TileId[], melds: number): number {
  const waits = waitingKinds(toCounts(hand), melds);
  return g.wall.live.filter((t) => waits.includes(kindOf(t))).length;
}

// 押了运势的局，这一巡之前不和（电脑）
// 重做押了运势的局：这一局定好的那手（14 张的张数、最后自摸的那种牌）；没押、初版是 null
export function nellyRecipePlan(g: Game, seat: number): { plan: number[]; win: number } | null {
  if (!nellyRemade(g, seat) || !big(g, seat)) return null;
  return stateOf(g, seat).recipe ?? null;
}

export function nellyDue(g: Game, seat: number): number {
  if (nellyRemade(g, seat)) return tierOf(g, seat) > 0 ? NELLY_REMAKE.turn + NELLY_REMAKE.delay * (tierOf(g, seat) - 1) : 0;
  return NELLY.turn[tierOf(g, seat)] ?? 0;
}

// 重做：她还摸得到几次牌（手里 13 张是还没摸，算上马上要摸的这一张；14 张是刚摸过，不算这一张）
function drawsLeft(g: Game, seat: number): number {
  const r = g.wall.remaining;
  if (g.players[seat].hand.length % 3 === 2) return Math.floor(r / 4);
  return r >= 1 ? Math.floor((r - 1) / 4) + 1 : 0;
}

export function nellyDrawsLeft(g: Game, seat: number): number {
  return drawsLeft(g, seat);
}

// 重做：做三倍满还有几次摸牌（过了该和的那一巡还没和，就是到这一局她最后一次摸牌）
function planDraws(g: Game, seat: number): number {
  return nellyDrawsToWin(g, seat) || drawsLeft(g, seat);
}

// 重做：到该和的那一次摸牌还有几次（算上它；第 19 巡摸不到就是最后一次摸牌）。0 是已经到了（刚摸的就是）或者过了
export function nellyDrawsToWin(g: Game, seat: number): number {
  const drawn = g.players[seat].hand.length % 3 === 2;
  const byTurn = nellyDue(g, seat) - nellyTurn(g, seat) + (drawn ? 0 : 1);
  return Math.max(0, Math.min(byTurn, drawsLeft(g, seat)));
}

const isDora = (g: Game, t: TileId) => g.wall.visibleDoraIndicators().some((d) => doraFromIndicator(kindOf(d)) === kindOf(t));

// 立直了：翻开的每一张里宝牌指示牌换成指向她手里最多的那种牌
function setUra(g: Game, seat: number): void {
  const p = g.players[seat];
  // 暗杠的牌也算
  const counts = toCounts([...p.hand, ...p.melds.filter((m) => m.type === 'ankan').flatMap((m) => m.tiles)]);
  const dora = new Set(g.wall.visibleDoraIndicators().map((d) => doraFromIndicator(kindOf(d))));
  // 张数多的先；一样多挑宝牌（宝牌再加里宝牌）
  const kinds = Array.from({ length: 34 }, (_, k) => k).sort((a, b) => counts[b] - counts[a] || Number(dora.has(b)) - Number(dora.has(a)));
  const n = g.wall.visibleUraIndicators().length;
  // 每一张从张数最多的那种牌挑起，指示牌找不到就换下一种
  let from = 0;
  for (let i = 0; i < n; i++) {
    for (let j = Math.min(from, kinds.length - 1); j < kinds.length && counts[kinds[j]] > 0; j++) {
      const k = kinds[j];
      if (g.wall.bringToUra(i, (t) => doraFromIndicator(kindOf(t)) === k, g.rng)) {
        from = j + 1;
        break;
      }
    }
  }
}

// 押 3 点和牌：翻开的里宝牌一张一张定，加起来让总番数落在 11–12 番（里宝牌之外已经超过 12 番就一张都不中）
// next：还没摸进来的那张（重做：摸牌前先把里宝牌定好，电脑看得出这一手够三倍满，last 是它是不是海底）
function fitUra(g: Game, seat: number, winTile?: TileId, next?: TileId, last?: boolean): void {
  const p = g.players[seat];
  if (next !== undefined) p.hand.push(next);
  try {
    fitUraNow(g, seat, winTile, next ?? p.drawn, last, next);
  } finally {
    if (next !== undefined) p.hand.pop();
  }
}
// keep：下一张要摸的牌（先定好里宝牌时），不能拿去当里宝牌指示牌
function fitUraNow(g: Game, seat: number, winTile: TileId | undefined, drawn: TileId | null, last?: boolean, keep?: TileId): void {
  const p = g.players[seat];
  const tile = winTile ?? drawn;
  if (tile === null || tile === undefined) return;
  const r = g.winResult(seat, tile, winTile === undefined, last);
  if (!r || r.yakuman > 0) return;
  const counts = toCounts([...p.hand, ...p.melds.flatMap((m) => m.tiles), ...(winTile !== undefined ? [winTile] : [])]);
  const lo = Math.max(0, NELLY.bigHan - (r.han - r.ura));
  const hi = NELLY.maxHan - (r.han - r.ura);
  const w = g.wall;
  let sum = 0;
  for (let i = 0; i < w.doraRevealed; i++) {
    // 还差多少：先挑正好补够的，补不够挑最多的，已经够了挑一张都不中的
    const room = Math.max(0, hi - sum);
    const want = Math.max(0, lo - sum);
    const kinds = Array.from({ length: 34 }, (_, k) => k)
      .filter((k) => counts[k] <= room)
      .sort((a, b) => Math.abs(Math.min(counts[a], room) - want) - Math.abs(Math.min(counts[b], room) - want) || counts[b] - counts[a]);
    for (const k of kinds) {
      if (w.bringToUra(i, (t) => t !== keep && doraFromIndicator(kindOf(t)) === k, g.rng)) {
        sum += counts[k];
        break;
      }
    }
  }
}

// 能拿来开暗杠做大的宝牌暗刻（立直了要杠了听的牌不变）
function kanKind(g: Game, seat: number): number | null {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const waits = waitingKinds(counts, p.melds.length).join();
  for (let k = 0; k < 34; k++) {
    if (counts[k] !== 3 || !isDora(g, k * 4)) continue;
    const after = counts.slice();
    after[k] = 0;
    if (shanten(after, p.melds.length + 1) !== 0) continue;
    if (p.riichi && waitingKinds(after, p.melds.length + 1).join() !== waits) continue;
    return k;
  }
  return null;
}

// 押 3 点这一局走不走开杠的路线（第一次问的时候定下来）
function kanRoute(g: Game, seat: number): boolean {
  const st = stateOf(g, seat);
  // 用开局的种子另起一个随机数（不动牌局的 rng，别的能力的随机照旧）
  const chance = nellyRemade(g, seat) ? NELLY_REMAKE.kanRoute : NELLY.kanRoute;
  st.kan ??= big(g, seat) && chance > 0 && new Rng((g.seed * 31 + g.round * 7919 + g.honba * 104729 + seat) ^ 0x6e6b616e).chance(chance);
  return st.kan;
}

// 开杠路线还没杠：目标牌里的刻子（第四张留给她）
function kanKinds(g: Game, seat: number): number[] {
  const st = stateOf(g, seat);
  if (!st.kan || st.kanned || !st.plan) return [];
  const have = toCounts(g.players[seat].hand);
  return st.plan.flatMap((n, k) => (n >= 3 && have[k] < 4 ? [k] : []));
}

// 开杠路线：立直了，手里杠了不改听牌的暗刻（宝牌先），牌山里摸得到第四张
function routeKan(g: Game, seat: number): number | null {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const waits = waitingKinds(counts, p.melds.length).join();
  const live = g.wall.live.filter((t) => reachable(g, seat, t));
  // 宝牌的刻子不杠（杠了多一张宝牌，容易冲过 12 番）
  const kinds = Array.from({ length: 34 }, (_, k) => k).sort((a, b) => Number(isDora(g, a * 4)) - Number(isDora(g, b * 4)));
  for (const k of kinds) {
    if (counts[k] !== 3 || !live.some((t) => kindOf(t) === k)) continue;
    const after = counts.slice();
    after[k] = 0;
    if (shanten(after, p.melds.length + 1) !== 0 || waitingKinds(after, p.melds.length + 1).join() !== waits) continue;
    return k;
  }
  return null;
}

// 手牌换成 hand（13 张）摸 t 自摸的话有几番：lo 是不算里宝牌的（还没立直的算上立直、一发），hi 是里宝牌最多能加到的。
// 里宝牌在和牌时才定（claimUra），押 3 点会把它定到 11–12 番之间，所以只要 lo ≤ 12 ≤ … hi ≥ 11 就做得成三倍满。
// 役满算 13 番；和不了是 0
function projHan(g: Game, seat: number, hand: TileId[], t: TileId, last = false): { lo: number; hi: number } {
  const p = g.players[seat];
  const keep = p.hand;
  p.hand = [...hand, t];
  try {
    const r = g.winResult(seat, t, true, last);
    if (!r) return { lo: 0, hi: 0 };
    if (r.yakuman > 0) return { lo: 13, hi: 13 };
    const lo = r.han - r.ura + (p.riichi ? 0 : 2);
    return { lo, hi: lo + Math.max(r.ura, uraGain(g, seat, hand)) };
  } finally {
    p.hand = keep;
  }
}

// 做得成三倍满（11–12 番，里宝牌在中间调）
const fitsBig = (r: { lo: number; hi: number }) => r.lo <= NELLY.maxHan && r.hi >= NELLY.bigHan;

// 玄的能力还在（不是她自己）：和牌中不了里宝牌
const kuroBlocks = (g: Game, seat: number) => {
  const k = kuroSeat(g);
  return k !== null && k !== seat;
};

// 立直以后第一张里宝牌指示牌能换成指向几张她的牌（和 setUra 一样按 13 张加暗杠里张数多的挑，指示牌找得到才算）
function uraGain(g: Game, seat: number, hand: TileId[]): number {
  const w = g.wall;
  const counts = toCounts([...hand, ...g.players[seat].melds.filter((m) => m.type === 'ankan').flatMap((m) => m.tiles)]);
  // 玄的能力还在：别人中不了里宝牌
  if (!w.uraIndicators.length || w.locked.has(w.uraIndicators[0]) || kuroBlocks(g, seat)) return 0;
  const pool = [w.uraIndicators[0], ...w.uraIndicators.slice(1), ...w.live, ...w.rinshan].filter((t) => !w.locked.has(t));
  const ok = new Set(pool.map((t) => doraFromIndicator(kindOf(t))));
  let best = 0;
  for (let k = 0; k < 34; k++) if (ok.has(k)) best = Math.max(best, counts[k]);
  return best;
}

// 13 张的手：牌山里（没锁的）能自摸出三倍满的牌有几张，和自摸能到几番（只看牌山里还有的）
function bigScore(g: Game, seat: number, hand: TileId[]): { big: number; han: number } {
  const melds = g.players[seat].melds.length;
  const counts = toCounts(hand);
  if (shanten(counts, melds) !== 0) return { big: 0, han: -1 };
  // 重做：藏在王牌里的那张也算摸得到；她下一次摸的是海底牌就算上海底捞月（立直那一巡牌山剩 4 张，别人不鸣牌的话）
  const remade = nellyRemade(g, seat);
  const live = remade ? mineToDraw(g, seat) : g.wall.live.filter((t) => reachable(g, seat, t));
  const last = remade && g.wall.remaining === (g.players[seat].hand.length % 3 === 2 ? 4 : 1);
  let big = 0;
  let han = 0;
  for (const k of waitingKinds(counts, melds)) {
    const tiles = live.filter((t) => kindOf(t) === k);
    if (!tiles.length) continue;
    const h = projHan(g, seat, hand, tiles[0], last);
    // 超过 12 番的不要（不冲累计役满）
    if (h.lo <= NELLY.maxHan) han = Math.max(han, Math.min(h.hi, NELLY.maxHan));
    if (fitsBig(h)) big += tiles.length;
  }
  return { big, han };
}
// 两张以上才算够（立直以后到她摸之前别人还要摸三张）
const rank = (x: { big: number; han: number }) => (x.big >= 1 ? 100 + Math.min(x.big, 4) : x.han);

// 她摸得到的牌：没锁、这一次摸牌的规矩不挡（玄在的话宝牌摸不到，谁的能力都挡不住玄）
function reachable(g: Game, seat: number, t: TileId): boolean {
  const w = g.wall;
  if (w.locked.has(t) || w.deny?.(t)) return false;
  return ![0, 1, 2, 3].some((s) => s !== seat && g.abilities[s]?.id === 'kuro' && g.isAbsolute(s) && !kuroLost(g, s) && isDoraTile(g, t));
}

// 押 3 点：定一手三倍满（立直、一发、自摸再加里宝牌）的目标牌，和手里的牌重合得越多越好，缺的牌牌山里要有：
// - 清一色（6 番）加立直一发自摸（3 番），再靠七对子、一气通贯、三暗刻、断幺九、一盃口、宝牌、里宝牌凑到 11–12 番
// - 混一色（3 番）：宝牌能动的时候，要有宝牌刻子（宝牌、里宝牌各 3 番）
// 玄的能力还在时中不了里宝牌，只能靠役。超过 12 番的不要（不冲累计役满）
function planBig(g: Game, seat: number): number[] | null {
  if (nellyRemade(g, seat)) return recipeOf(g, seat)?.plan ?? null;
  const st = stateOf(g, seat);
  const flush = nellyFlush(g, seat);
  if (!flush) return null;
  const w = g.wall;
  const have = toCounts(g.players[seat].hand);
  const cap = have.slice();
  for (const t of w.live) if (reachable(g, seat, t)) cap[kindOf(t)]++;
  for (let k = 0; k < 34; k++) cap[k] = Math.min(4, cap[k]);
  const uraOk = new Set(
    [w.uraIndicators[0], ...w.uraIndicators.slice(1), ...w.live, ...w.rinshan].filter((t) => t !== undefined && !w.locked.has(t)).map((t) => doraFromIndicator(kindOf(t))),
  );
  if (!w.uraIndicators.length || w.locked.has(w.uraIndicators[0]) || kuroBlocks(g, seat)) uraOk.clear();
  const dora = new Set(w.visibleDoraIndicators().map((d) => doraFromIndicator(kindOf(d))));
  const base = flush.suit * 9;
  const F = [...Array.from({ length: 9 }, (_, i) => base + i), ...(flush.honors ? [27, 28, 29, 30, 31, 32, 33] : [])];
  const sets: number[][] = [];
  for (let i = 0; i < 7; i++) sets.push([base + i, base + i + 1, base + i + 2]);
  for (const k of F) sets.push([k, k, k]);
  const t = new Array<number>(34).fill(0);
  const prev = st.plan?.join();
  let best: number[] | null = null;
  let bestScore = -1;
  // 估这手牌立直一发自摸能有几番（lo，不算里宝牌）、里宝牌最多再加几番（ura），lo ≤ 12 且 lo + ura ≥ 11 才要。
  // 玄的能力还在时中不了里宝牌，只能靠役：清一色加七对子、一气通贯、三暗刻、断幺九、一盃口这些凑够 11 番
  const noUra = kuroBlocks(g, seat);
  const chosen: number[] = []; // 4 组面子挑了 sets 里的哪几组
  const needSet = kanRoute(g, seat);
  const valid = (pairs: boolean) => {
    // 开杠路线：要有一组刻子，第四张还在牌山里摸得到
    if (needSet && (pairs || !chosen.some((i) => i >= 7 && cap[sets[i][0]] >= 4))) return false;
    const mixed = t.some((n, k) => n > 0 && k >= 27);
    let lo = (mixed ? 3 : 6) + 3; // 染手、立直一发自摸
    if (pairs) lo += 2;
    else {
      if ([0, 3, 6].every((i) => chosen.includes(i))) lo += 2; // 一气通贯
      if (chosen.some((i, j) => i < 7 && chosen.indexOf(i) !== j)) lo += 1; // 一盃口
      if (chosen.filter((i) => i >= 7).length >= 3) lo += 2; // 三暗刻（门清自摸）
      for (let k = 27; k < 34; k++) if (t[k] >= 3) lo += (k >= HAKU ? 1 : 0) + (k === g.seatWind(seat) ? 1 : 0) + (k === EAST + g.roundWind ? 1 : 0); // 役牌
    }
    if (!mixed && t[base] === 0 && t[base + 8] === 0) lo += 1; // 断幺九
    for (const k of dora) lo += t[k];
    let ura = 0;
    if (!noUra) for (const k of F) if (uraOk.has(k)) ura = Math.max(ura, t[k]);
    return lo <= NELLY.maxHan && lo + ura >= NELLY.bigHan;
  };
  const consider = (pairs: boolean) => {
    if (!valid(pairs)) return;
    let score = 0;
    for (const k of F) score += Math.min(have[k], t[k]);
    score *= 2;
    if (prev !== undefined && t.join() === prev) score += 1;
    if (score > bestScore) [best, bestScore] = [t.slice(), score];
  };
  const fits = (k: number) => t[k] <= cap[k];
  const pick = (from: number, left: number) => {
    if (left === 0) {
      for (const k of F) {
        t[k] += 2;
        if (fits(k)) consider(false);
        t[k] -= 2;
      }
      return;
    }
    for (let i = from; i < sets.length; i++) {
      for (const k of sets[i]) t[k]++;
      chosen.push(i);
      if (sets[i].every(fits)) pick(i, left - 1);
      chosen.pop();
      for (const k of sets[i]) t[k]--;
    }
  };
  pick(0, 4);
  // 七对子
  const pairKinds = F.filter((k) => cap[k] >= 2);
  const choose = (from: number, left: number) => {
    if (left === 0) return consider(true);
    for (let i = from; i <= pairKinds.length - left; i++) {
      t[pairKinds[i]] = 2;
      choose(i + 1, left - 1);
      t[pairKinds[i]] = 0;
    }
  };
  choose(0, 7);
  st.plan = best ?? undefined;
  return best;
}

// ---------- 重做：照配牌挑一手三倍满（nellyRecipe），每巡来缺的那张，该和的那一巡一发自摸 ----------

// 问 nellyRecipe 的条件。hand：手里的牌；live：她摸得到的牌（发牌前是还没发出去的那部分）；free：宝牌指示牌还能换
function remakeAsk(g: Game, seat: number, hand: TileId[], live: TileId[], budget: number, free: boolean): RecipeAsk {
  const w = g.wall;
  const st = stateOf(g, seat);
  const have = toCounts(hand);
  const left = toCounts(live);
  const open = (t: TileId | undefined): t is TileId => t !== undefined && !w.locked.has(t);
  // 能换成宝牌指示牌的牌：还没翻的王牌、没发出去的牌山
  const doraFrom = free ? [w.doraIndicators[0], ...w.doraIndicators.slice(w.doraRevealed), ...w.uraIndicators, ...w.rinshan, ...w.live.slice(52)].filter(open) : [];
  const uraFrom = [w.uraIndicators[0], ...w.uraIndicators.slice(1), ...w.live, ...w.rinshan].filter(open);
  const noUra = !w.uraIndicators.length || w.locked.has(w.uraIndicators[0]) || kuroBlocks(g, seat);
  const gs = gameStateOf(g, seat);
  const salt = (gs.recipes?.length ?? 0) * 977 + live.length;
  const rng = new Rng((g.seed * 17 + g.round * 131 + g.honba * 7 + seat * 3 + salt) ^ 0x72656369);
  return {
    have,
    held: hand,
    cap: have.map((n, k) => Math.min(4, n + left[k])),
    pool: live,
    budget,
    seatWind: g.seatWind(seat),
    roundWind: EAST + g.roundWind,
    isDealer: seat === g.dealer,
    dora: free ? { free: true, kinds: [...new Set(doraFrom.map((t) => doraFromIndicator(kindOf(t))))] } : { free: false, kinds: w.visibleDoraIndicators().map((d) => doraFromIndicator(kindOf(d))) },
    ura: noUra ? null : [...new Set(uraFrom.map((t) => doraFromIndicator(kindOf(t))))],
    kan: kanRoute(g, seat),
    used: (gs.recipes ?? []).filter((_, i) => i !== st.logged),
    jitter: () => rng.next(),
    bigHan: NELLY.bigHan,
    maxHan: NELLY.maxHan,
  };
}

// 挑一手：开杠路线挑不出来（凑不出第四张摸得到的刻子）就不走开杠路线
function pickRecipe(g: Game, seat: number, a: RecipeAsk, far: number): Recipe | null {
  const r = planBest(a, far);
  if (r || !a.kan) return r;
  stateOf(g, seat).kan = false;
  return planBest({ ...a, kan: false }, far);
}

// 这一局定的三倍满记下来（这一场后面换着做别的役）
// dealing：发牌前（牌山前 52 张是配牌，不能动）
function logRecipe(g: Game, seat: number, r: Recipe, dealing = false): void {
  const gs = gameStateOf(g, seat);
  const st = stateOf(g, seat);
  gs.recipes ??= [];
  if (st.logged === undefined) st.logged = gs.recipes.push(r.yaku) - 1;
  else gs.recipes[st.logged] = r.yaku;
  st.recipe = r;
  st.plan = r.plan;
  reserveUra(g, seat, r, dealing);
}

// 要靠里宝牌补番的：定好那手就先把第一张里宝牌指示牌换成指向那种牌的（还没翻开，没人看得见），
// 免得拖到和牌时那种指示牌都被摸光、打光了。和牌时 fitUra 还会照实际的番数再定一次
function reserveUra(g: Game, seat: number, r: Recipe, dealing: boolean): void {
  const w = g.wall;
  if (r.ura <= 0 || !w.uraIndicators.length || w.locked.has(w.uraIndicators[0]) || kuroBlocks(g, seat)) return;
  const kinds = Array.from({ length: 34 }, (_, k) => k).filter((k) => r.plan[k] === r.ura);
  const next = w.live[0];
  // 先不拿她那手要的牌当指示牌，没有再拿（和了牌那种不拿）
  for (const spare of [false, true])
    for (const k of kinds) {
      const ok = (t: TileId) => doraFromIndicator(kindOf(t)) === k && t !== next && kindOf(t) !== r.win && (spare || r.plan[kindOf(t)] === 0);
      if (w.bringToUra(0, ok, g.rng, dealing ? (j) => j >= 52 : undefined)) return;
    }
}

// 宝牌能动（没有玄这样的人在）。玄打出过宝牌、能力没了，宝牌就又能动了
const doraFree = (g: Game, seat: number) => ![0, 1, 2, 3].some((s) => s !== seat && g.isAbsolute(s) && !(g.abilities[s]?.id === 'kuro' && kuroLost(g, s)));

// 发牌前：照配牌挑一手三倍满，宝牌指示牌指向定好的那种牌；缺的牌比她摸得到的次数还多（配牌太差），换几张配牌
function remakeDeal(g: Game, seat: number): void {
  const w = g.wall;
  const idx = g.dealIndices(seat);
  const rel = (seat - g.dealer + 4) % 4;
  const draws = Math.min(nellyDue(g, seat), Math.floor((w.live.length - 52 - rel - 1) / 4) + 1);
  const budget = Math.min(NELLY_REMAKE.budget, draws);
  const live = () => w.live.filter((t, i) => i >= 52 && reachable(g, seat, t));
  const free = doraFree(g, seat);
  let r = pickRecipe(g, seat, remakeAsk(g, seat, g.dealHand(seat), live(), budget, free), Math.max(budget, NELLY_REMAKE.far));
  if (!r) return;
  if (free) {
    const dora = r.dora;
    const at = doraFromIndicator(kindOf(w.doraIndicators[0]));
    const ok =
      dora !== null
        ? w.bringToDora(0, (t) => doraFromIndicator(kindOf(t)) === dora, g.rng, (j) => j >= 52)
        : r.plan[at] === 0 || w.bringToDora(0, (t) => r!.plan[doraFromIndicator(kindOf(t))] === 0, g.rng, (j) => j >= 52);
    // 宝牌换不成：照现在的宝牌重挑
    if (!ok) r = pickRecipe(g, seat, remakeAsk(g, seat, g.dealHand(seat), live(), budget, false), Math.max(budget, NELLY_REMAKE.far)) ?? r;
  }
  // 缺得太多：手里用不上的牌换成缺的牌（最后自摸的那张留着摸）
  let over = r.missing - draws;
  if (over > 0) {
    const have = toCounts(g.dealHand(seat));
    for (const i of idx) {
      if (over <= 0) break;
      const k = kindOf(w.live[i]);
      if (have[k] <= r.plan[k]) continue;
      const need = (t: TileId) => {
        const x = kindOf(t);
        return r!.plan[x] > have[x] && (x !== r!.win || r!.plan[x] - have[x] >= 2) && reachable(g, seat, t);
      };
      if (w.bringToLive(i, (t) => need(t) && !isRed(t), g.rng, (j) => j >= 52) || w.bringToLive(i, need, g.rng, (j) => j >= 52)) {
        have[k]--;
        have[kindOf(w.live[i])]++;
        over--;
        r.missing--;
      }
    }
  }
  logRecipe(g, seat, r, true);
}

// 她摸得到的牌：牌山里的，加上藏进王牌的那张
function mineToDraw(g: Game, seat: number): TileId[] {
  const live = g.wall.live.filter((t) => reachable(g, seat, t));
  const stash = g.wall.uraIndicators[4];
  if (stateOf(g, seat).stashed && stash !== undefined) live.push(stash);
  return live;
}

// 定好的三倍满还做得成没有（缺的牌牌山里都还有、来得及摸），做不成就照现在的手重挑
function recipeOf(g: Game, seat: number): Recipe | null {
  const st = stateOf(g, seat);
  const p = g.players[seat];
  // 立直了、开过杠：照定好的
  if (p.riichi || p.melds.length || between(g)) return st.recipe ?? null;
  const live = mineToDraw(g, seat);
  const have = toCounts(p.hand);
  const left = toCounts(live);
  const draws = planDraws(g, seat);
  const r = st.recipe;
  if (r) {
    let missing = 0;
    let ok = r.plan[r.win] > have[r.win];
    for (let k = 0; k < 34; k++) {
      const n = r.plan[k] - have[k];
      if (n > 0) {
        missing += n;
        if (n > left[k]) ok = false;
      }
    }
    if (ok && missing <= draws) return r;
  }
  if (draws <= 0) return r ?? null;
  // 同一手牌、同一个牌山只重挑一次
  const key = `${p.hand.join()}|${g.wall.remaining}`;
  if (st.tried === key) return r ?? null;
  st.tried = key;
  const next = pickRecipe(g, seat, remakeAsk(g, seat, p.hand, live, Math.min(NELLY_REMAKE.budget, draws), false), Math.min(NELLY_REMAKE.budget, draws));
  if (next) logRecipe(g, seat, next);
  return st.recipe ?? null;
}

// 别人听的牌（她的运势知道）：这些牌不来她手里，免得打出去点炮
function calm(g: Game, seat: number): (t: TileId) => boolean {
  const danger = new Set<number>();
  for (let o = 0; o < 4; o++) {
    if (o === seat) continue;
    const q = g.players[o];
    const c = toCounts(q.hand);
    if (shanten(c, q.melds.length) === 0) for (const k of waitingKinds(c, q.melds.length)) danger.add(k);
  }
  return (t) => !danger.has(kindOf(t));
}

// 立直宣言牌打出去没人碰得了、下家吃不了（一发不被打断）
function quiet(g: Game, seat: number): (t: TileId) => boolean {
  const next = (seat + 1) % 4;
  const hands = g.players.map((q) => toCounts(q.hand));
  return (t) => {
    const k = kindOf(t);
    for (let o = 0; o < 4; o++) if (o !== seat && !g.players[o].riichi && hands[o][k] >= 2) return false;
    if (k >= 27 || g.players[next].riichi) return true;
    const h = hands[next];
    const has = (d: number) => (k % 9) + d >= 0 && (k % 9) + d <= 8 && h[k + d] > 0;
    return !((has(-2) && has(-1)) || (has(-1) && has(1)) || (has(1) && has(2)));
  };
}

// 重做的摸牌：每巡来定好的三倍满里缺的那张（照剩下的巡数摊开，最后自摸的那张留到最后），听着了来她打掉、又不点炮的牌；
// 该和的前一巡立直（电脑），那一巡来和了牌一发自摸，里宝牌在和牌时补到 11–12 番。到那一巡之前不来和了牌
function drawRemake(g: Game, seat: number): void {
  const w = g.wall;
  const p = g.players[seat];
  const st = stateOf(g, seat);
  const draws = nellyDrawsToWin(g, seat);
  const now = draws <= 1;
  const last = w.remaining === 1;
  const value = drawValue(g, seat);
  const wins = (t: TileId) => value(t) > 0;
  const safe = calm(g, seat);
  // 下一张锁着（咲的杠材、爱丽丝画好的牌）：到了和牌那一巡，她的和牌别人挡不住，照七姐妹的换法连锁一起换（锁留在这个位置上）
  const pinned = () => w.locked.has(w.live[0]);
  const toLive = (pred: (t: TileId) => boolean) => {
    if (!pinned()) return w.bringToLive(0, pred, g.rng);
    const ok = (t: TileId) => pred(t) && !w.deny?.(t);
    return ok(w.live[0]) || w.forceNext(false, ok, g.rng);
  };
  const fromDead = (pred: (t: TileId) => boolean) => !pinned() && w.bringFromDead(false, pred, g.rng);
  // 自摸 t 的番数（没立直的，不算里宝牌）；和不了是 0
  const han = (t: TileId) => {
    p.hand.push(t);
    try {
      const r = g.winResult(seat, t, true, last);
      return !r ? 0 : r.yakuman > 0 ? 13 : r.han - r.ura;
    } finally {
      p.hand.pop();
    }
  };
  // 凑不成三倍满：来不超过 12 番里最大的和了牌；都超过 12 番（赤宝牌多了一张之类）就来番数最少的
  const bestWin = () => {
    const ok = (t: TileId) => wins(t) && han(t) <= NELLY.maxHan;
    const top = Math.max(0, ...w.live.filter((t) => reachable(g, seat, t) && ok(t)).map(value));
    if (top > 0 && toLive((t) => ok(t) && value(t) >= top)) return true;
    // 牌山里没有：王牌里（藏起来的那张）换出来
    if (fromDead(ok)) return true;
    // 杠了多翻的宝牌之类冲过了 12 番：来番数最少的（牌山里没有就从王牌里换）
    const over = [...w.live.filter((t) => reachable(g, seat, t)), ...w.rinshan, ...w.uraIndicators].filter((t) => !w.locked.has(t) && wins(t)).map(han);
    if (!over.length) return false;
    const least = (t: TileId) => wins(t) && han(t) <= Math.min(...over);
    return toLive(least) || fromDead(least);
  };
  if (p.riichi) {
    if (!now) {
      // 还没到那一巡：不来和了牌，来的牌打出去也不点炮，也不来暗刻的第四张（杠了手就变了）
      const held = toCounts(p.hand);
      const idle = (t: TileId) => !wins(t) && held[kindOf(t)] < 3;
      if (idle(w.live[0]) && safe(w.live[0])) return;
      // 锁着的牌不是和了牌就照摸（不早和就行）
      if (pinned() && !wins(w.live[0])) return;
      toLive((t) => idle(t) && safe(t)) || toLive(idle) || toLive((t) => !wins(t));
      return;
    }
    // 开杠路线：先来暗刻的第四张（不是和了牌），开暗杠以后岭上牌自摸（摸的是海底牌就杠不了，照常自摸）
    if (kanRoute(g, seat) && !st.kanned && !last && g.totalKans() < 4) {
      const k = routeKan(g, seat);
      if (k !== null && w.bringToLive(0, (t) => kindOf(t) === k && !wins(t), g.rng)) {
        const held = toCounts(p.hand);
        const at = w.doraIndicators[w.doraRevealed];
        if (at !== undefined && !isDora(g, at)) w.bringToDora(w.doraRevealed, (t) => held[doraFromIndicator(kindOf(t))] === 0, g.rng, () => false);
        return;
      }
    }
    const fits = (t: TileId) => fitsBig(projHan(g, seat, p.hand, t, last));
    const win = st.recipe?.win;
    const got =
      (win !== undefined && toLive((t) => kindOf(t) === win && !isRed(t) && fits(t))) ||
      // 藏在王牌里的那张换出来
      (win !== undefined && fromDead((t) => kindOf(t) === win && fits(t))) ||
      toLive((t) => fits(t) && !isRed(t)) ||
      toLive(fits) ||
      bestWin();
    // 里宝牌先定好（和牌时还会再定一次）：电脑看得出这一手是三倍满
    if (got) fitUra(g, seat, undefined, w.live[0], last);
    return;
  }
  if (now) {
    // 没立直（点数不够、玩家自己不立直、听的牌没了）：来正好三倍满的和了牌；最后一次摸牌就来最大的，不然接着做（重挑一手，做好了立直）
    const exact = (t: TileId) => wins(t) && han(t) >= NELLY.bigHan && han(t) <= NELLY.maxHan;
    if (toLive(exact) || fromDead(exact)) return;
    if (drawsLeft(g, seat) <= 1) {
      bestWin();
      return;
    }
  }
  const r = recipeOf(g, seat);
  if (!r) {
    // 做不成三倍满：照常进张，不和
    const good = useful(g, seat);
    if (w.bringToLive(0, (t) => good(t) && !wins(t) && safe(t), g.rng)) return;
    if (wins(w.live[0])) w.bringToLive(0, (t) => !wins(t), g.rng);
    return;
  }
  const counts = toCounts(p.hand);
  const need = (t: TileId) => r.plan[kindOf(t)] > counts[kindOf(t)];
  const missing = r.plan.reduce((n, c, k) => n + Math.max(0, c - counts[k]), 0);
  if (missing >= 2) {
    // 最后自摸的那张留到最后
    const early = (t: TileId) => need(t) && !wins(t) && (kindOf(t) !== r.win || r.plan[r.win] - counts[r.win] >= 2);
    // 缺的牌一巡来一张（叠着押的局也先凑齐：拖着不来，牌会被别人摸走），听着了自摸的那张藏进王牌，等到那一巡
    {
      const left = toCounts(w.live.filter((t) => reachable(g, seat, t)));
      const scarce = Math.min(...r.plan.map((c, k) => (c > counts[k] && (k !== r.win || c - counts[k] >= 2) ? left[k] : 99)));
      if (
        w.bringToLive(0, (t) => early(t) && !isRed(t) && left[kindOf(t)] === scarce, g.rng) ||
        w.bringToLive(0, (t) => early(t) && !isRed(t), g.rng) ||
        w.bringToLive(0, early, g.rng)
      )
        return;
    }
  }
  // 听着这一手（或者这一巡先不进张）：来一张她用不上、打出去不点炮的牌；立直那一巡还要没人碰得了、吃得了
  const filler = (t: TileId) => !need(t) && !wins(t) && safe(t) && counts[kindOf(t)] < 3;
  const hush = quiet(g, seat);
  if (missing <= 1 && planDraws(g, seat) <= 2 && w.bringToLive(0, (t) => filler(t) && r.plan[kindOf(t)] === 0 && hush(t), g.rng)) return;
  w.bringToLive(0, (t) => filler(t) && r.plan[kindOf(t)] === 0, g.rng) || w.bringToLive(0, filler, g.rng) || w.bringToLive(0, (t) => !need(t) && !wins(t), g.rng) || w.bringToLive(0, (t) => !wins(t), g.rng);
}

// 押 3 点：14 张的手打哪张（听牌的打法里挑三倍满的牌最多、番最多的）；打哪张都听不了牌是 null
export function nellyBigDiscard(g: Game, seat: number): TileId | null {
  const p = g.players[seat];
  if (!big(g, seat) || p.riichi) return null;
  if (nellyRemade(g, seat)) {
    // 重做：打定好的那手里多出来的牌（先打不在那手里的；别人听的、被封的人等的不打；立直宣言牌挑没人鸣得了的；赤宝牌留着）
    const r = recipeOf(g, seat);
    if (!r) return null;
    const have = toCounts(p.hand);
    const extra = p.hand.filter((x) => have[kindOf(x)] > r.plan[kindOf(x)]);
    const safe = calm(g, seat);
    const sealed = nellySealedWaits(g, seat);
    if (!extra.length) {
      // 那手提前摸齐了（还没到该和的那一巡）：打一张摸得回来的（先打定好最后自摸的那种），听着等；
      // 换了最后自摸的那种牌，番数也要还在 11–12 番
      const left = toCounts(mineToDraw(g, seat));
      const kinds = [r.win, ...r.plan.flatMap((n, k) => (n > 0 && k !== r.win ? [k] : []))].filter((k) => left[k] > 0 && !sealed.has(k));
      for (const k of kinds) {
        const t = p.hand.filter((x) => kindOf(x) === k).sort((a, b) => Number(isRed(a)) - Number(isRed(b)))[0];
        const rest = p.hand.filter((x) => x !== t);
        const back = mineToDraw(g, seat).find((x) => kindOf(x) === k);
        if (back === undefined || (k !== r.win && !fitsBig(projHan(g, seat, rest, back)))) continue;
        if (k !== r.win) stateOf(g, seat).recipe = { ...r, win: k };
        return t;
      }
      return null;
    }
    const hush = quiet(g, seat);
    const riichiNow = nellyDrawsToWin(g, seat) <= 1;
    const score = (x: TileId) => (r.plan[kindOf(x)] === 0 ? 2 : 0) + (safe(x) ? 4 : 0) - (sealed.has(kindOf(x)) ? 8 : 0) + (riichiNow && hush(x) ? 1 : 0) - (isRed(x) ? 1 : 0);
    return extra.sort((a, b) => score(b) - score(a))[0];
  }
  // 有目标牌：打多出来的牌（先打目标里没有的）
  const plan = planBig(g, seat);
  if (plan) {
    const have = toCounts(p.hand);
    const extra = p.hand.filter((x) => have[kindOf(x)] > plan[kindOf(x)]);
    if (extra.length) return extra.find((x) => plan[kindOf(x)] === 0) ?? extra[0];
  }
  // 清一色还没做好（别的花色的牌不止一张）就照常打（先打别的花色）
  const flush = nellyFlush(g, seat);
  if (flush && p.hand.filter((t) => !inFlush(flush)(kindOf(t))).length > 1) return null;
  let best: TileId | null = null;
  let score = -1;
  const seen = new Set<number>();
  for (const t of p.hand) {
    if (seen.has(kindOf(t))) continue;
    seen.add(kindOf(t));
    const s = rank(bigScore(g, seat, p.hand.filter((x) => x !== t)));
    if (s > score) [best, score] = [t, s];
  }
  return score >= 0 ? best : null;
}

// 押 3 点：13 张的手立直下去下一巡就能一发自摸三倍满
export function nellyBigReady(g: Game, seat: number, hand: TileId[]): boolean {
  return rank(bigScore(g, seat, hand)) >= 100;
}

// 押 3 点的摸牌：配牌照常发，每一巡来目标牌里缺的那张（没有目标牌就来那门花色的牌）；听牌了来把牌做到三倍满的牌（来了别的牌她打掉）；
// 够三倍满了前一巡立直，下一巡一发自摸。到那一巡之前不来和了牌；牌山快摸完了有什么和什么
function drawBig(g: Game, seat: number): void {
  const w = g.wall;
  const p = g.players[seat];
  const turn = nellyTurn(g, seat);
  const due = NELLY.turn[3];
  const value = drawValue(g, seat);
  const wins = (t: TileId) => value(t) > 0;
  const bestWin = () => {
    const best = Math.max(0, ...w.live.filter((t) => !w.locked.has(t)).map(value));
    return best > 0 && w.bringToLive(0, (t) => value(t) >= best, g.rng);
  };
  if (p.riichi) {
    setUra(g, seat);
    // 开杠路线：先来暗刻的第四张（不是和了牌），开暗杠以后岭上牌自摸
    const st = stateOf(g, seat);
    if (kanRoute(g, seat) && !st.kanned) {
      const k = routeKan(g, seat);
      if (k !== null && w.bringToLive(0, (t) => kindOf(t) === k && !wins(t), g.rng)) {
        // 杠了要翻的宝牌指示牌先换成不中她手里牌的（番数留给里宝牌在和牌时调）
        const held = toCounts(p.hand);
        // 只在王牌里换（玄藏在王牌里的宝牌不挪进牌山）
        const at = w.doraIndicators[w.doraRevealed];
        if (at !== undefined && !isDora(g, at)) w.bringToDora(w.doraRevealed, (t) => held[doraFromIndicator(kindOf(t))] === 0, g.rng, () => false);
        return;
      }
    }
    if (w.bringToLive(0, (t) => fitsBig(projHan(g, seat, p.hand, t)), g.rng)) return;
    if (turn >= due + NELLY.grace && bestWin()) return;
    if (wins(w.live[0])) w.bringToLive(0, (t) => !wins(t), g.rng);
    return;
  }
  if (w.remaining <= NELLY.late) {
    bestWin();
    return;
  }
  const flush = nellyFlush(g, seat);
  const ok = flush ? (t: TileId) => inFlush(flush)(kindOf(t)) : () => true;
  const safe = (t: TileId) => !wins(t);
  const counts = toCounts(p.hand);
  const melds = p.melds.length;
  // 有目标牌：缺几张就一巡来一张（缺的牌里先来牌山里剩得少的）；只差一张、够三倍满了就来一张她会打掉的牌，等立直
  const plan = planBig(g, seat);
  if (plan) {
    const need = (t: TileId) => plan[kindOf(t)] > counts[kindOf(t)];
    const missing = plan.reduce((n, c, k) => n + Math.max(0, c - counts[k]), 0);
    if (missing >= 2) {
      const left = toCounts(w.live.filter((t) => reachable(g, seat, t)));
      const scarce = Math.min(...p.hand.length ? plan.map((c, k) => (c > counts[k] ? left[k] : 99)) : [99]);
      if (w.bringToLive(0, (t) => need(t) && safe(t) && left[kindOf(t)] === scarce, g.rng) || w.bringToLive(0, (t) => need(t) && safe(t), g.rng)) return;
    } else if (rank(bigScore(g, seat, p.hand)) >= 100) {
      w.bringToLive(0, (t) => plan[kindOf(t)] === 0 && safe(t), g.rng) || w.bringToLive(0, (t) => !need(t) && safe(t), g.rng);
      return;
    }
  }
  if (flush && p.hand.some((t) => !ok(t))) {
    // 手里还有别的牌：一张一张来那门的牌（先来让清一色向听变少的，再来连得上的）
    const fs = flushShanten(counts, melds, flush);
    const lower = (t: TileId) => {
      counts[kindOf(t)]++;
      const after = flushShanten(counts, melds, flush);
      counts[kindOf(t)]--;
      return after < fs;
    };
    const near = (t: TileId) => {
      const k = kindOf(t);
      return counts[k] > 0 || [-2, -1, 1, 2].some((d) => k + d >= 0 && k + d < 27 && Math.floor((k + d) / 9) === Math.floor(k / 9) && counts[k + d] > 0);
    };
    // 先凑宝牌刻子（立直以后里宝牌也变成它）
    const doraSet = (t: TileId) => isDora(g, t) && counts[kindOf(t)] >= 1 && counts[kindOf(t)] < 3;
    w.bringToLive(0, (t) => ok(t) && safe(t) && doraSet(t), g.rng) ||
      w.bringToLive(0, (t) => ok(t) && safe(t) && lower(t), g.rng) || w.bringToLive(0, (t) => ok(t) && safe(t) && near(t), g.rng) || w.bringToLive(0, (t) => ok(t) && safe(t), g.rng);
    return;
  }
  const sh = shanten(counts, melds);
  if (sh > 0) {
    const good = useful(g, seat);
    w.bringToLive(0, (t) => good(t) && ok(t) && safe(t), g.rng) || w.bringToLive(0, (t) => good(t) && safe(t), g.rng) || w.bringToLive(0, (t) => ok(t) && safe(t), g.rng);
    return;
  }
  // 听牌了
  const now = rank(bigScore(g, seat, p.hand));
  if (now >= 100) {
    // 够三倍满了：来一张她会打掉的别的花色的牌，等立直
    w.bringToLive(0, (t) => !ok(t) && safe(t), g.rng) || w.bringToLive(0, safe, g.rng);
    return;
  }
  // 还不够大：挑一张摸进来、打掉一张以后最接近三倍满的牌
  let pick: number | null = null;
  let score = now;
  const kinds = new Set(w.live.filter((t) => reachable(g, seat, t) && safe(t)).map(kindOf));
  for (const k of kinds) {
    const t = w.live.find((x) => kindOf(x) === k && reachable(g, seat, x))!;
    const hand = [...p.hand, t];
    const tried = new Set<number>();
    for (const d of hand) {
      if (tried.has(kindOf(d))) continue;
      tried.add(kindOf(d));
      const s = rank(bigScore(g, seat, hand.filter((x) => x !== d)));
      if (s > score) [pick, score] = [k, s];
    }
  }
  if (pick !== null && w.bringToLive(0, (t) => kindOf(t) === pick, g.rng)) return;
  const good = useful(g, seat);
  w.bringToLive(0, (t) => ok(t) && safe(t) && !good(t), g.rng) || w.bringToLive(0, safe, g.rng);
}

// 后面还没打的局排了几点（技能栏里给她自己看）
const planAhead = (g: Game, seat: number) => {
  const gs = gameStateOf(g, seat);
  const rest = (gs.plan ?? []).map((v, i) => ({ v, i })).filter((x) => x.v > 0 && !gs.used?.includes(x.i));
  return rest.length ? rest.map((x) => `${'东南西北'[Math.floor(x.i / 4)]}${x.i % 4 + 1} 押 ${x.v}`).join('、') : '没有了';
};

const inSuit = (suit: number) => (t: TileId) => kindOf(t) < 27 && suitOf(kindOf(t)) === suit;

// 重做：押 bet 点的局第几巡自摸（第 18 巡以后一局里摸不到，就是她最后一次摸牌）
const dueText = (bet: number) => {
  const d = NELLY_REMAKE.turn + NELLY_REMAKE.delay * (bet - 1);
  return d >= 18 ? '最后一次摸牌' : `第 ${d} 巡`;
};
const dueLabel = (g: Game, seat: number) => dueText(tierOf(g, seat));

// 一手牌写成 234m 456p 77z 这样（技能栏里给玩家看要做成哪一手）
const planText = (plan: number[]) =>
  ['m', 'p', 's', 'z']
    .map((c, s) => {
      const ks = Array.from({ length: s < 3 ? 9 : 7 }, (_, i) => s * 9 + i);
      const out = ks.flatMap((k) => Array.from({ length: plan[k] }, () => String(k - s * 9 + 1))).join('');
      return out ? out + c : '';
    })
    .filter(Boolean)
    .join(' ');

// 开局分运势的界面上那段说明
export function nellyPlanNote(g: Game, seat: number): string {
  if (nellyRemade(g, seat))
    return `把 ${NELLY_REMAKE.total} 点运势分到这一场的各局，开局排好就不能改：押了的局${dueText(1)}（前一巡立直）一发自摸三倍满，和牌挡不住；同一局叠着押，每多 1 点晚 ${NELLY_REMAKE.delay} 巡（2 点${dueText(2)}，3 点到她${dueText(3)}），七姐妹押几点封几家。连庄、流局重打的本场不再用；比赛提前结束，排在后面的就浪费了。先按电脑的排法填好了，可以改。`;
  return `把运势分到这一场的各局（每局最多 ${NELLY.maxBet} 点），开局排好就不能改：1 点朝 3 番到满贯，2 点朝跳满，3 点朝三倍满、和牌挡不住。连庄、流局重打的本场不再用；比赛提前结束，排在后面的就浪费了。先按电脑的排法填好了，可以改。`;
}

// 选人页照选的版本显示：重做的说明、初版的说明
export const NELLY_REMAKE_TEXT = `开场 ${NELLY_REMAKE.total} 点运势，东一局发牌前分到这一场的各局（每局最多 ${NELLY.maxBet} 点），之后不能改；连庄、流局重打的本场不再用。押了运势的局${dueText(1)}（前一巡立直）一发自摸三倍满，役种照配牌换着做（平和、断幺九、三色、一气通贯、全带幺九、三暗刻、役牌、七对子……），宝牌、里宝牌只补差的番数，这一局她的和牌别人挡不住；同一局叠着押，每多 1 点晚 ${NELLY_REMAKE.delay} 巡（2 点${dueText(2)}，3 点到她${dueText(3)}），七姐妹多封一家。手里还有运势就看得出别人听没听牌。七姐妹一场 ${NELLY.sisters} 次、不恢复：押了运势的局自动开着，每有一家听牌用掉一次给他上软封印，这一局他摸不到和了牌（自摸不了），别人打出来的照样能荣和；押几点最多封几家。押了运势的局别人一向听时也摸不到让她听牌的牌。`;
export const NELLY_CLASSIC_TEXT = `${NELLY.plan ? `开场 ${NELLY.plan.total} 点运势，东一局发牌前分到这一场的各局（每局最多 ${NELLY.maxBet} 点），之后不能改；连庄、流局重打的本场不再用，比赛提前结束后面的就浪费了` : NELLY.charge ? `运势是攒出来的：开场 ${NELLY.charge.start} 点，每忍一局（没押运势的局）打完攒 ${NELLY.charge.gain} 点，最多攒 ${NELLY.charge.cap} 点` : `开场 ${NELLY.start} 点运势，每打满 ${NELLY.every} 局恢复 1 点`}。押了运势的局（配牌照常发）：1 点进张朝 3 番到满贯发展，第 ${NELLY.turn[1]} 巡左右和；2 点朝跳满，第 ${NELLY.turn[2]} 巡左右和；3 点朝三倍满（混一色加宝牌刻子，玄在场做清一色），第 ${NELLY.turn[3]} 巡左右立直一发自摸，这一局她的和牌别人挡不住。手里还有运势就看得出别人听没听牌。七姐妹一场 ${NELLY.sisters} 次、不恢复：押了运势的局自动开着，每有一家听牌用掉一次给他上软封印，这一局他摸不到和了牌（自摸不了），别人打出来的照样能荣和；押几点最多封几家。押了运势的局别人一向听时也摸不到让她听牌的牌，听牌慢一些。`;

export const nellyAbility: Ability = {
  id: 'nelly',
  name: '运势·七姐妹',
  description: `（重做）${NELLY_REMAKE_TEXT}【初版】${NELLY_CLASSIC_TEXT}`,
  priority: PRIORITY.nelly,

  // 三倍满的局别人挡不住她（别人的能力管不到她）
  shielded(g, seat) {
    if (between(g)) return false;
    return big(g, seat);
  },

  dealRules(g, seat) {
    tierOf(g, seat);
  },

  // 配牌照常发，只记下她配牌里最多的花色（往这门做）。押 2、3 点时宝牌指示牌换成指向她配牌里最多的那种牌
  // （玄在的话宝牌是玄的，不换）
  beforeDeal(g, seat) {
    const v = tierOf(g, seat);
    if (v <= 0) return;
    // 重做：照配牌挑好三倍满，宝牌指向定好的那种牌
    if (nellyRemade(g, seat)) {
      remakeDeal(g, seat);
      return;
    }
    const hand = g.dealHand(seat).map(kindOf);
    const per = [0, 0, 0];
    for (const k of hand) if (k < 27) per[suitOf(k)]++;
    const st = stateOf(g, seat);
    st.suit = per.indexOf(Math.max(...per));
    // 宝牌能动（没有玄这样的人在）就做混一色、宝牌指示牌指向手里那门花色或字牌里最多的；动不了就做清一色
    // 玄打出过宝牌、能力没了，宝牌就又能动了
    const free = ![0, 1, 2, 3].some((s) => s !== seat && g.isAbsolute(s) && !(g.abilities[s]?.id === 'kuro' && kuroLost(g, s)));
    if (NELLY.flush[v]) st.honors = free;
    if (!NELLY.dora[v] || !free) return;
    const n = (k: number) => hand.filter((x) => x === k).length;
    // 张数多的先；一样多挑 5（有赤宝牌）
    const kinds = [...new Set(hand)].filter((k) => !NELLY.flush[v] || k >= 27 || suitOf(k) === st.suit).sort((a, b) => n(b) - n(a) || (b < 27 && b % 9 === 4 ? 1 : 0) - (a < 27 && a % 9 === 4 ? 1 : 0));
    for (const k of kinds.slice(0, 3)) if (g.wall.bringToDora(0, (t) => doraFromIndicator(kindOf(t)) === k, g.rng, (j) => j >= 52)) break;
  },

  onRoundStart(g, seat) {
    // 押了几点只有她自己知道：电脑的涅莉不报
    const v = tierOf(g, seat);
    if (!g.manual[seat] || v <= 0) return;
    g.emit({ type: 'ability', seat, ability: 'nelly', text: nellyRemade(g, seat) ? `运势·三倍满（${dueLabel(g, seat)}）` : `运势·${TIER_NAMES[v]}` });
  },

  // 每次有人摸牌前看一眼：谁听牌了就用七姐妹给他上软封印
  beforeAnyDraw(g, seat, drawer, rinshan) {
    sweep(g, seat);
    if (drawer === seat) return;
    // 押 3 点听着三倍满：别人摸不走她要和的牌
    let mine: number[] = [];
    if (big(g, seat)) {
      const p = g.players[seat];
      const w = g.wall;
      if (shanten(toCounts(p.hand), p.melds.length) === 0) mine = waitingKinds(toCounts(p.hand), p.melds.length);
      // 开杠路线：要杠的牌的第四张别人摸不走
      mine = [...mine, ...kanKinds(g, seat)];
      // 重做：定好的三倍满里还缺的牌，牌山里剩得刚好够的别人摸不走
      const r = nellyRemade(g, seat) && !p.riichi ? stateOf(g, seat).recipe : undefined;
      // 听着定好的那一手：自摸的那张先藏一张到王牌最里面（第五张里宝牌指示牌，开四次杠才翻得到），谁都摸不走，到了那一巡再换出来
      const hold = nellyRemade(g, seat) ? stateOf(g, seat).recipe : undefined;
      if (hold && !stateOf(g, seat).stashed && w.uraIndicators.length > 4 && w.doraRevealed <= 4) {
        const have = toCounts(p.hand);
        const missing = hold.plan.reduce((n, c, k) => n + Math.max(0, c - have[k]), 0);
        const at = w.uraIndicators[4];
        if (missing === 1 && hold.plan[hold.win] > have[hold.win] && !w.locked.has(at)) {
          stateOf(g, seat).stashed = kindOf(at) === hold.win || w.bringToUra(4, (t) => kindOf(t) === hold.win && !isRed(t), g.rng);
        }
      }
      if (r) {
        const have = toCounts(p.hand);
        // 赤五不算（定好的番数算的是普通的五，多一张赤宝牌可能冲过 12 番）
        const left = toCounts(w.live.filter((t) => reachable(g, seat, t) && !isRed(t)));
        for (let k = 0; k < 34; k++) if (r.plan[k] > have[k] && left[k] <= r.plan[k] - have[k]) mine.push(k);
      }
      const next = rinshan ? w.rinshan[0] : w.live[0];
      if (next !== undefined && mine.includes(kindOf(next))) {
        if (rinshan) w.bringToRinshan((t) => !mine.includes(kindOf(t)), g.rng);
        else w.bringToLive(0, (t) => !mine.includes(kindOf(t)), g.rng);
      }
    }
    // 七姐妹的软封印：被封的人要和的牌谁都摸不到（被封的人自摸不了；别人也摸不到、点不了给她们，她们只能荣和别人手里本来就有的牌）。
    // 换牌时也别把她要和的牌换进去
    const theirs = NELLY.hide ? nellySealedWaits(g, seat) : new Set<number>();
    const sealedDrawer = stateOf(g, seat).blocked!.includes(drawer);
    const d = g.players[drawer];
    // 慢点听牌（试验）：一向听的人摸不到让她听牌的牌
    const slow = sealedDrawer ? [] : slowKinds(g, seat, drawer);
    // 她要的牌（听的牌、开杠路线的第四张、重做定好还缺的牌）：摸牌的人自己的能力也换不走
    if (!stateOf(g, seat).blocked!.length && !slow.length) return mine.length ? { seat, ability: 'nelly', text: '七姐妹', deny: (t: TileId) => mine.includes(kindOf(t)) } : undefined;
    const waits = sealedDrawer ? waitingKinds(toCounts(d.hand), d.melds.length) : [];
    const deny = (t: TileId) => theirs.has(kindOf(t)) || waits.includes(kindOf(t)) || mine.includes(kindOf(t)) || slow.includes(kindOf(t));
    if (!sealedDrawer) return NELLY.hide || slow.length ? { seat, ability: 'nelly', text: '七姐妹', deny } : undefined;
    // 被封的人自己的能力锁好的和了牌（咲配牌时就定好的岭上牌之类）：用能力也不让她自摸，锁着也照换
    const w = g.wall;
    const next = rinshan ? w.rinshan[0] : w.live[0];
    const id = g.active(drawer)?.id;
    const owners = next === undefined ? [] : w.locked.ownersOf(next);
    // 牌山里换不出来（最后一张海底之类）也从王牌里换
    if (next !== undefined && waits.includes(kindOf(next))) {
      const own = owners.length > 0 && !!id && owners.every((o) => o === id || o === `${id}-${drawer}`);
      const moved = !owners.length && (rinshan ? w.bringToRinshan((t) => !deny(t), g.rng) : w.bringToLive(0, (t) => !deny(t), g.rng));
      if (!moved && (own || !owners.length) && w.forceNext(rinshan, (t) => !deny(t), g.rng)) g.emit({ type: 'ability', seat, ability: 'nelly', text: '七姐妹', target: drawer });
    }
    // 被封的人自己的能力定的摸牌规矩（淡的加速驱动之类）也越不过七姐妹；玄这样的作者钦定照样守
    return { seat, ability: 'nelly', text: '七姐妹', deny, first: !g.isAbsolute(drawer) };
  },

  beforeDraw(g, seat, rinshan) {
    const v = tierOf(g, seat);
    if (v <= 0) return;
    const w = g.wall;
    const p = g.players[seat];
    if (rinshan) {
      // 押 3 点（重做押了就是）立直以后开杠（开杠路线）：岭上牌是三倍满的和了牌
      if (big(g, seat) && p.riichi) {
        stateOf(g, seat).kanned = true;
        setUra(g, seat);
        // 摸岭上牌前引擎还没记成岭上：估番时算上岭上开花
        const prev = g.rinshanDraw;
        g.rinshanDraw = true;
        try {
          // 重做：岭上牌锁着（咲在场锁了岭上牌）也照换，锁留在这个位置上（她的和牌别人挡不住）
          const remade = nellyRemade(g, seat);
          // 牌山里没有就从王牌里换（听牌时藏起来的那张和了牌在里宝牌指示牌底下）
          const bring = (pred: (t: TileId) => boolean) => {
            if (!remade) return w.bringToRinshan(pred, g.rng);
            const ok = (t: TileId) => pred(t) && !w.deny?.(t);
            if (w.locked.has(w.rinshan[0])) return ok(w.rinshan[0]) || w.forceNext(true, ok, g.rng);
            return w.bringToRinshan(pred, g.rng) || w.bringFromDead(true, ok, g.rng);
          };
          if (bring((t) => fitsBig(projHan(g, seat, p.hand, t)))) {
            if (remade) fitUra(g, seat, undefined, w.rinshan[0]);
            return;
          }
          // 凑不出 11–12 番：来不超过 12 番的和了牌，都超过就来一张和不了的（不冲累计役满）
          const han = (t: TileId) => projHan(g, seat, p.hand, t).lo;
          if (bring((t) => han(t) > 0 && han(t) <= NELLY.maxHan)) return;
          w.bringToRinshan((t) => han(t) === 0, g.rng);
          return;
        } finally {
          g.rinshanDraw = prev;
        }
      }
      // 重做：立直之前不开杠（照定好的那手做）
      if (nellyRemade(g, seat)) return;
      // 到了那一巡开杠：岭上牌是最大的和了牌（岭上开花）
      if (p.riichi && NELLY.dora[v]) setUra(g, seat);
      if (nellyTurn(g, seat) < NELLY.turn[v] - 1 || shanten(toCounts(p.hand), p.melds.length) !== 0) return;
      const value = drawValue(g, seat);
      const best = Math.max(0, ...[...w.live, ...w.rinshan].filter((t) => !w.locked.has(t)).map(value));
      if (best > 0) w.bringToRinshan((t) => value(t) >= best, g.rng);
      return;
    }
    if (big(g, seat)) {
      if (nellyRemade(g, seat)) drawRemake(g, seat);
      else drawBig(g, seat);
      return;
    }
    // 立直了（押 2 点）：里宝牌变成她手里最多的那种牌
    if (p.riichi && NELLY.dora[v]) setUra(g, seat);
    const good = useful(g, seat);
    const value = drawValue(g, seat);
    const suit = stateOf(g, seat).suit;
    const pred = suit === undefined ? () => true : inSuit(suit);
    const sh = shanten(toCounts(p.hand), p.melds.length);
    const turn = nellyTurn(g, seat);
    const due = NELLY.turn[v];
    const late = w.remaining <= NELLY.late;
    const wins = (t: TileId) => value(t) > 0;
    // 把牌做大的牌：那门花色、宝牌、手里有的字牌
    const held = toCounts(p.hand);
    const shapes = (t: TileId) => pred(t) || isDora(g, t) || (kindOf(t) >= 27 && held[kindOf(t)] > 0 && stateOf(g, seat).honors !== false);
    if (turn < due && !late) {
      // 还没到那一巡：不给和了牌。离听牌还远就按剩下的巡数来进张，听牌了来把牌做大的牌
      if (sh > 0) {
        const need = (sh + 0.5) / Math.max(1, due - turn);
        if (g.rng.chance(Math.min(1, need)) && (w.bringToLive(0, (t) => good(t) && isDora(g, t), g.rng) || w.bringToLive(0, (t) => good(t) && shapes(t), g.rng) || w.bringToLive(0, good, g.rng))) return;
        // 这一张不给进张：押 2、3 点就顺手来一张手里成对的宝牌（凑宝牌暗刻）
        // （有宝牌暗刻就来第四张，开暗杠：宝牌、里宝牌各四张）
        if (NELLY.dora[v] && !good(w.live[0]) && w.bringToLive(0, (t) => isDora(g, t) && held[kindOf(t)] >= 2 && !wins(t), g.rng)) return;
        if (wins(w.live[0])) w.bringToLive(0, (t) => !wins(t), g.rng);
        return;
      }
      // 听牌了：听的牌牌山里不到两张，先来一张能换成好听牌的牌（至少三张）
      if (!p.riichi && nellyLiveWaits(g, p.hand, p.melds.length) < 2) {
        const fix = reshape(g, seat, 3);
        if (w.bringToLive(0, (t) => fix(t) && !wins(t), g.rng)) return;
      }
      // 牌还不够大就来把牌做大的牌（够大了就不再做，免得做过头）
      const big = Math.max(0, ...w.live.filter((t) => !w.locked.has(t)).map(value)) >= nellyTarget(g, seat);
      const kan = NELLY.dora[v] ? kanKind(g, seat) : null;
      if (!p.riichi && kan !== null && !big && w.bringToLive(0, (t) => kindOf(t) === kan && !wins(t), g.rng)) return;
      if (!p.riichi && !big && (w.bringToLive(0, (t) => isDora(g, t) && held[kindOf(t)] >= 2 && !wins(t), g.rng) || w.bringToLive(0, (t) => shapes(t) && !wins(t) && !good(t), g.rng))) return;
      if (wins(w.live[0])) w.bringToLive(0, (t) => !wins(t), g.rng);
      return;
    }
    // 到了那一巡
    if (sh > 0) {
      w.bringToLive(0, (t) => good(t) && isDora(g, t), g.rng) || w.bringToLive(0, (t) => good(t) && shapes(t), g.rng) || w.bringToLive(0, good, g.rng);
      return;
    }
    const target = nellyTarget(g, seat);
    const cap = NELLY.cap[v] * (seat === g.dealer ? 1.5 : 1);
    if (w.bringToLive(0, (t) => value(t) >= target && value(t) <= cap, g.rng) || w.bringToLive(0, (t) => value(t) >= target, g.rng)) return;
    // 和了牌不够大、手里有宝牌的暗刻：来第四张开暗杠（宝牌、里宝牌各四张，岭上开花）。立直了要杠了不改听牌
    const kan = kanKind(g, seat);
    if (kan !== null && w.bringToLive(0, (t) => kindOf(t) === kan, g.rng)) return;
    // 牌还不够大：再等几巡，接着做大
    if (turn < due + NELLY.grace && !late && !p.riichi && w.bringToLive(0, (t) => shapes(t) && !wins(t) && !good(t), g.rng)) return;
    // 做不大了：来最大的和了牌；死听就来一张能换听的牌
    const best = Math.max(0, ...w.live.filter((t) => !w.locked.has(t)).map(value));
    if (best > 0 && w.bringToLive(0, (t) => value(t) >= best, g.rng)) return;
    if (p.riichi) return;
    const fix = reshape(g, seat);
    w.bringToLive(0, (t) => fix(t) && shapes(t), g.rng) || w.bringToLive(0, fix, g.rng);
  },

  // 发牌前押运势：不选就是不押
  preDeal(g, seat): PreDealOption[] {
    const gs = gameStateOf(g, seat);
    if (NELLY.plan) {
      // 只在开局排一次
      if (gs.plan) return [];
      const base = planFor(g, seat);
      return base.map((v, i) => ({
        id: `slot${i}`,
        name: `${'东南西北'[Math.floor(i / 4)]}${i % 4 + 1}局`,
        desc: '',
        // 她坐庄的局标出来（三倍满庄家 1.5 倍）
        note: (g.firstDealer + (i % 4)) % 4 === seat ? '庄' : undefined,
        enabled: true,
        picked: false,
        stepper: { value: v, min: 0, max: NELLY.maxBet },
      }));
    }
    const pool = nellyPool(g, seat);
    return [1, 2, 3].map((n) => ({
      id: `luck${n}`,
      name: `押 ${n} 点 · ${TIER_NAMES[n]}`,
      desc:
        n === 3
          ? `进张朝三倍满发展（混一色加宝牌刻子，玄在场做清一色），第 ${NELLY.turn[3]} 巡左右立直一发自摸；和牌别人挡不住；七姐妹封三家`
          : `进张朝${TIER_NAMES[n]}发展，第 ${NELLY.turn[n]} 巡左右和；七姐妹封${n === 2 ? '两' : '一'}家`,
      cost: n,
      enabled: n <= pool,
      picked: gs.pick === n && n <= pool,
      note: n <= pool ? undefined : NELLY.charge ? '运势不够，忍一局攒一点' : '运势不够',
      group: 'luck',
    }));
  },

  // 开局排运势：加起来要正好是那一笔（局太少排不完就排满）
  preDealCheck(g, seat, values) {
    if (!NELLY.plan) return null;
    const slots = nellySlots(g);
    if (nellyRemade(g, seat)) {
      // 重做：一共 3 点不能多分；局够多就要分完（一局战只有一局，押 1 点就行，叠着押只会晚和）
      const total = NELLY_REMAKE.total;
      const need = Math.min(total, slots);
      let n = 0;
      for (let i = 0; i < slots; i++) n += values[`slot${i}`] ?? 0;
      return n > total ? `多分了 ${n - total} 点` : n < need ? `还有 ${need - n} 点没分` : null;
    }
    const need = Math.min(NELLY.plan.total, slots * NELLY.maxBet);
    let sum = 0;
    for (let i = 0; i < slots; i++) sum += values[`slot${i}`] ?? 0;
    return sum === need ? null : sum < need ? `还有 ${need - sum} 点没分` : `多分了 ${sum - need} 点`;
  },

  setPreDeal(g, seat, picked, values) {
    if (NELLY.plan) {
      // 没给数（没排）就留着，下一局发牌前还会问
      if (values) gameStateOf(g, seat).plan = Array.from({ length: nellySlots(g) }, (_, i) => Math.max(0, Math.min(NELLY.maxBet, values[`slot${i}`] ?? 0)));
      return;
    }
    const id = picked.find((p) => p.startsWith('luck'));
    gameStateOf(g, seat).pick = id ? Number(id.slice(4)) : 0;
  },

  skill(g, seat) {
    const gs = gameStateOf(g, seat);
    const pool = nellyPool(g, seat);
    const v = between(g) ? 0 : tierOf(g, seat);
    const remade = nellyRemade(g, seat);
    const r = remade && v > 0 ? stateOf(g, seat).recipe : undefined;
    const note =
      (v > 0
        ? remade
          ? `这一局押了 ${v} 点：${dueLabel(g, seat)}自摸三倍满${r ? `（照这一手做：${planText(r.plan)}，${r.yaku.join('、') || '立直一发自摸'}${r.ura ? `，里宝牌补 ${r.ura} 番` : ''}）` : ''}，七姐妹自动开着、最多封 ${v} 家`
          : `这一局押了 ${v} 点（${TIER_NAMES[v]}，第 ${NELLY.turn[v]} 巡左右和），七姐妹自动开着、最多封 ${v} 家`
        : `这一局没押运势，七姐妹不发动${!NELLY.plan && NELLY.charge && !between(g) ? (pool < NELLY.charge.cap ? `；忍过这一局攒 ${NELLY.charge.gain} 点` : '；运势攒满了') : ''}`) +
      (NELLY.plan && gs.plan ? `；后面排的：${planAhead(g, seat)}` : '') +
      `；七姐妹还剩 ${gs.sisters} 次${pool > 0 ? '；看得出别人听没听牌' : ''}`;
    return { label: '运势', note, enabled: false, meter: { value: pool, max: Math.max(NELLY.plan ? planTotal(g, seat) : NELLY.charge ? NELLY.charge.cap : NELLY.start, pool), label: '运势' }, active: v > 0 };
  },

  // 押了几点只有她自己知道：电脑的涅莉不挂
  badge(g, seat) {
    if (!g.manual[seat] || between(g)) return null;
    const v = tierOf(g, seat);
    if (nellyRemade(g, seat)) return v > 0 ? '三倍满' : null;
    return v > 0 ? TIER_NAMES[v] : null;
  },

  // 照魔镜看得到
  // 押 2、3 点立直和牌：里宝牌变成她手里最多的那种牌（摸牌时也先换好，算番用；和牌这一刻再定一次，见 doraControl）
  // 押 3 点：里宝牌定到正好三倍满（11–12 番），不多不少
  claimUra(g, seat, winTile) {
    const v = tierOf(g, seat);
    if (big(g, seat)) fitUra(g, seat, winTile);
    else if (NELLY.dora[v]) setUra(g, seat);
  },

  insight(g, seat) {
    const gs = gameStateOf(g, seat);
    const v = between(g) ? 0 : tierOf(g, seat);
    return [
      `运势还剩 ${nellyPool(g, seat)} 点${gs.log!.length ? `（押过：${gs.log!.join('、')}）` : ''}`,
      v > 0 ? (nellyRemade(g, seat) ? `这一局押了 ${v} 点，${dueLabel(g, seat)}自摸三倍满` : `这一局押了 ${v} 点，冲${TIER_NAMES[v]}`) : '这一局没押',
      `七姐妹还剩 ${gs.sisters} 次`,
    ];
  },
};

// 她自己摸牌：照常挑完以后，摸到的要是软封印的人在等的牌、她自己又用不上（不是她的和了牌、不进张、不是三倍满要的牌），换一张
// （不进她手里，免得打出去点给被封的人）
const ownDraw = nellyAbility.beforeDraw!;
nellyAbility.beforeDraw = (g, seat, rinshan) => {
  ownDraw(g, seat, rinshan);
  if (!NELLY.dodge) return;
  const theirs = nellySealedWaits(g, seat);
  const w = g.wall;
  const next = rinshan ? w.rinshan[0] : w.live[0];
  if (theirs.size === 0 || next === undefined || !theirs.has(kindOf(next))) return;
  const me = g.players[seat];
  const counts = toCounts(me.hand);
  const mine = shanten(counts, me.melds.length) === 0 ? waitingKinds(counts, me.melds.length) : [];
  const plan = big(g, seat) ? planBig(g, seat) : null;
  const good = useful(g, seat);
  const wanted = (t: TileId) => mine.includes(kindOf(t)) || good(t) || (!!plan && counts[kindOf(t)] < plan[kindOf(t)]);
  if (wanted(next)) return;
  const ok = (t: TileId) => !theirs.has(kindOf(t));
  // 重做：还没到该和的那一巡，换来的牌也不能让她提前和了、凑出第四张（照定好的那手等）
  const early = nellyRemade(g, seat) && big(g, seat) && nellyDrawsToWin(g, seat) > 1;
  const quiet = (t: TileId) => ok(t) && counts[kindOf(t)] < 3 && shanten(toCounts([...me.hand, t]), me.melds.length) >= 0;
  if (rinshan) (early && w.bringToRinshan(quiet, g.rng)) || w.bringToRinshan(ok, g.rng);
  else (early && w.bringToLive(0, quiet, g.rng)) || w.bringToLive(0, ok, g.rng);
};
