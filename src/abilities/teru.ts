import type { Game, WinInfo } from '../engine/game';
import { evaluateWin, type Meld, type WinResult } from '../engine/score';
import { shanten, standardShanten, waitingKinds } from '../engine/shanten';
import { EAST, HAKU, Kind, TileId, isRed, kindOf, toCounts } from '../engine/tiles';
import { readOthers } from './hiroe';
import { isDoraTile } from './kuro';
import type { Ability } from './types';

// 宫永照（白糸台）：
// - 照魔镜：第一局只看不和（这一局她和不了牌），看过以后整场都看得穿别人：
//   玩家操作她时，别人的头像旁边多一面镜子，点开能看到这家能力现在的状态（Ability.insight）；
//   读得出立直的人听什么（teruDanger）：电脑的照不打给他们，玩家操作她时手里的这种铳牌标红
// - 别人的能力动不了她（Ability.immune）：不被封印，别人对她的配牌、摸牌定的规矩不算；只有玄的宝牌她也得守
// - 连续和了（按打点递增，原作的规矩）：每次和了拿到的点数（本场、立直棒不算，坐庄的 1.5 倍照算）比上一次高，连和就接得上；
//   从多少点起胡都行。和小了算新一轮连和的第一次；别人和了、流局就断。
//   起胡前帮得很少（配牌往“副露 1000 点”的形状送：一对役牌，或者断幺九），起胡以后帮得多：
//   快听牌时先送“刚好比上一次高一档”的和了牌（TERU.tight），台阶踩得小连和才长；宝牌、赤宝牌多半被换走（TERU.doraOut）。
//   要的打点高了，配牌和进张先偏断幺九，再偏混一色、清一色。
//   压制：别人要摸的进张有 TERU.press 的概率被换走。
//   电脑的照按真实的番符挑打法（TERU.plan）：能默听就不立直，鸣了刚好高一档才鸣，会和大的高目放过去等安目
// - 叽叽叽：一轮连和里自摸满 TERU.kiki 次，下一局配牌直接是九莲宝灯的听牌
// 原来的天梯（八层，正好和出下一层）还留着：Object.assign(TERU, TERU_LADDER) 就换回去
export const TERU = {
  // 站在第几层（0 是还没起胡、9 是登顶）时，摸牌换成进张的概率
  boost: [0.05, 0.7, 0.75, 0.8, 0.8, 0.8, 0.8, 0.8, 0.9, 0.05],
  // 站在第几层时，配牌最多几向听（多了就换几张）
  dealMax: [3, 2, 2, 2, 2, 2, 2, 2, 2, 3],
  dealSwaps: 2, // 配牌最多换几张来降向听
  tiltSwaps: 4, // 配牌往混一色、清一色偏最多换几张
  aiForceWin: 12, // 电脑的照：牌山剩这么多张以内，不是下一层也和（免得白白流局）
  kiki: 8, // 自摸几次以后下一局九莲宝灯
  // 压制：站在第几层时，别人要摸的进张被换走的概率。刚起步压得最狠，越往上越轻（大牌要跟别人抢时间）
  press: [0.3, 0.5, 0.5, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.3],
  // —— 打点递增的连和（原作的规矩） ——
  // ladder：现在的天梯（正好和出下一层）；points：每次和了的打点比上一次高就接得上，站在第几层 = 连和了几次（最多 8）
  // steps：还是八层天梯，但只要比站着的那一层高就接得上（可以跳层），从哪一层起胡都行，站在哪一层 = 上一次和了的那一层
  mode: 'points' as 'ladder' | 'points' | 'steps',
  countDora: false, // steps：层数连宝牌、赤宝牌、里宝牌的番一起算（true），还是只算役（false）
  soft: 2.1, // points：送和了牌时先挑“刚好比上一次高”的（不超过上一次的这么多倍），挑不到再送更大的
  start: 1300, // points：还没起胡时先挑不超过这么多点的和了牌
  gatesAll: false, // points：九莲宝灯数的是这一轮连和的次数（荣和也算一道门），不只数自摸
  gatesStrict: false, // points：九莲宝灯数的是连和里的自摸；true 的话中间荣和一次就从头数
  mirrorImmune: false, // true：照魔镜看过以后别人的能力才动不了她（第一局照样吃别人的能力）
  smallRestart: true, // points：和小了算新的一轮连和的第一次（false：直接断到没起胡）
  doraOut: 0.85, // 宝牌少找她：配牌里、要摸的宝牌和赤宝牌，每张有这么大的概率被换走（0 是不管）；能力送来的进张不挑宝牌
  dama: 2, // 电脑的照：1 = 起胡以后，默听自摸就接得上的时候不立直，等能力把自摸送来；2 = 没起胡时也一律默听
  menzen: false, // 电脑的照：起胡以后不吃不碰（门清自摸、立直才抬得动打点）
  aiTilt: true, // 电脑的照：同样向听时先打不在目标里的牌（要断幺九就先打幺九，要染手就先打别的花色）
  simplesFrom: 1300, // points：要比这么多点高（坐庄折回去）起，配牌和进张偏断幺九（0 是不偏）；3900 起混一色、8000 起清一色照旧
  raise: true, // points：听牌了但怎么和都不比上一次高，就送一张换完以后接得上的牌
  tight: 1.55, // points：“只高一档”的上限是上一次的这么多倍（1.55 正好卡住下一档；0 是不分这一级）。和了牌、进张、电脑的打法都先挑这一级
  tightStart: 1100, // tight：没起胡时“最便宜的一档”到多少点
  cheapStart: true, // points：没起胡时配牌往“副露 1000 点”的形状送：没有役牌对子就送一对（中张已经够多就偏断幺九）
  cheapSimples: 10, // cheapStart：配牌里中张有这么多张就走断幺九，不送役牌
  plan: true, // 电脑的照：听牌、一向听时按“和出来接不接得上、是不是刚好高一档”挑打法（所有役都按真实的番符算）
  skipBig: true, // 电脑的照：起胡以后，和了牌会和大（超过刚好高一档）、而别的听牌自摸正好，就放过这张等安目
  callSoft: true, // 电脑的照：起胡以后只有“鸣了就听牌、而且和出来刚好高一档”才吃碰（代替 menzen）
  softDraw: true, // 一向听时，能力先送“摸进来能听成刚好高一档”的牌
  alarm: 0, // 另外三家：她连和到这么多次起就警觉（多吃碰抢和小牌、不躲彼此的立直）；0 是不管
  strict: true, // points：立直后的一发巡，只送“刚好高一档”的自摸；一发会和大的话这一巡先不送
  callFree: false, // 压制管不到副露了的人（吃碰过的那家照常进张）：鸣牌就是破她的办法
  riichiOpen: false, // 她立直以后压制停掉（别人能正常进张）
  wallAware: true, // 听的牌牌山里还有没有，她和她的能力都看得见：电脑挑牌山里还有的听法，能力也只往这样的听牌送；听死了就送换听的牌
  settle: true, // 电脑的照：这一手怎么换都接不上连和（牌山里也没有能换上去的牌），碰上能和的就和（和小了重新起头，好过白白流局）
  settleDraw: false, // 这种时候能力还主动送一张普通的和了牌（试过，太强：和小了还留在起胡以后的档位上，等于断不掉）
  startRiichi: true, // 电脑的照：没起胡时，默听荣和不了（没役）就立直
  readFold: true, // 电脑的照：读得出听牌的立直家，不是铳牌的牌一律当安全牌（不再照一般人那样弃和拆搭子）
};

// 原来的天梯和它的数值：Object.assign(TERU, TERU_LADDER) 换回去
export const TERU_LADDER: Partial<typeof TERU> = {
  boost: [0.55, 0.7, 0.75, 0.8, 0.85, 0.85, 0.85, 0.85, 0.9, 0.55],
  press: [0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.5],
  mode: 'ladder',
  start: 2000,
  doraOut: 0,
  dama: 0,
  aiTilt: false,
  simplesFrom: 0,
  raise: false,
  tight: 0,
  cheapStart: false,
  plan: false,
  skipBig: false,
  callSoft: false,
  softDraw: false,
  strict: false,
};

// 八层加塔尖的名字（第 1 层是 TERU_TIERS[0]）
export const TERU_TIERS = ['1番', '2番', '3番', '4番', '满贯', '跳满', '倍满', '三倍满', '役满'];
export const TERU_TOP = 9;

interface TeruGameState {
  rounds?: number; // 开过几局
  seen?: number; // g.events 里看到哪了（上一局的结算从这里往后找）
  dealer?: boolean; // 这一局她是不是庄家
  level?: number; // 站在第几层（0 是塔底）
  broke?: string; // 上一次天梯断掉的原因（给界面看）
  kiki?: number; // 这一场自摸了几次（九莲宝灯以后清零）
  last?: number; // points：这一轮连和里上一次和了的打点
  streak?: number[]; // points：这一轮连和里每一次和了的打点（给界面看，最多留 8 个）
}
interface TeruState {
  boosted?: boolean; // 这一局已经提示过“连续和了”
  chuuren?: number; // 这一局叽叽叽：九莲宝灯做在哪一门（0 万、1 筒、2 索）
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as TeruGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as TeruState;

// 她这次和了拿到多少（不算本场、立直棒）
export function teruWinValue(r: WinResult, tsumo: boolean, dealer: boolean): number {
  if (!tsumo) return r.ron;
  return dealer ? r.tsumoOtherPays * 3 : r.tsumoDealerPays + r.tsumoOtherPays * 2;
}

// 这手和了在第几层，只按役的番数算（宝牌、赤宝牌、里宝牌加的番不算）：
// 1–4 番是第 1–4 层，5 番满贯、6–7 番跳满、8–10 番倍满、11–12 番三倍满，役满（13 番以上也算）是塔尖
export function teruTier(r: WinResult): number {
  if (r.yakuman > 0) return TERU_TOP;
  const han = TERU.mode === 'steps' && TERU.countDora ? r.han : r.han - r.dora - r.aka - r.ura;
  return han >= 13 ? TERU_TOP : han >= 11 ? 8 : han >= 8 ? 7 : han >= 6 ? 6 : han >= 5 ? 5 : Math.max(1, han);
}

// 照魔镜看过了没有（第一局结束以后）
export function teruMirrored(g: Game, seat: number): boolean {
  return (gameStateOf(g, seat).rounds ?? 0) > 1;
}

// 牌山里（没被别人锁住的活牌）还有哪些牌：她的能力送得来的牌
export function teruWallHas(g: Game): (k: Kind) => boolean {
  const has = new Array<boolean>(34).fill(false);
  for (const t of g.wall.live) if (!g.wall.locked.has(t)) has[kindOf(t)] = true;
  return (k) => has[k];
}

// 照魔镜读得出听牌的是哪几家（立直了、镜子照得进去）
export function teruReads(g: Game, seat: number): Set<number> {
  if (!teruMirrored(g, seat)) return new Set();
  return new Set(readOthers(g, seat).filter((r) => g.seesRiichi(r.seat, seat) && !g.active(r.seat)?.mirrorProof?.(g, r.seat)).map((r) => r.seat));
}

// 照魔镜读得出的铳牌：看得见立直的人听的牌（小莳的天照照不进去）；第一局只看不和，不算
export function teruDanger(g: Game, seat: number): Set<Kind> {
  if (!teruMirrored(g, seat)) return new Set();
  return new Set(readOthers(g, seat).filter((r) => g.seesRiichi(r.seat, seat) && !g.active(r.seat)?.mirrorProof?.(g, r.seat)).flatMap((r) => r.ron));
}

// 天梯：站在第几层、下一次要和第几层、上一次断掉的原因、叽叽叽的次数
// points：level 是连和了几次（最多 8），last 是上一次和了多少点，streak 是这一轮每一次的点数
export function teruLadder(g: Game, seat: number): { level: number; next: number; broke: string | null; kiki: number; last: number; streak: number[] } {
  const gs = gameStateOf(g, seat);
  const level = gs.level ?? 0;
  return { level, next: level >= TERU_TOP ? 1 : level + 1, broke: gs.broke ?? null, kiki: gs.kiki ?? 0, last: level > 0 ? (gs.last ?? 0) : 0, streak: level > 0 ? (gs.streak ?? []) : [] };
}

// 这一手（tier 层）接不接得上天梯：正好是下一层，或者役满
export function teruFits(g: Game, seat: number, tier: number): boolean {
  if (TERU.mode === 'steps') return tier > 0 && (tier === TERU_TOP || tier >= teruLadder(g, seat).next);
  return tier === TERU_TOP || tier === teruLadder(g, seat).next;
}

export const teruPoints = (): boolean => TERU.mode === 'points';
// points：这一轮连和里上一次和了的打点（没起胡是 0）
export const teruLast = (g: Game, seat: number): number => ((gameStateOf(g, seat).level ?? 0) > 0 ? (gameStateOf(g, seat).last ?? 0) : 0);
// 这一手（r）接不接得上连和。ladder：正好是下一层；points：打点比上一次高（没起胡时什么都行）
export function teruAccepts(g: Game, seat: number, r: WinResult, tsumo: boolean): boolean {
  if (!teruPoints()) return teruFits(g, seat, teruTier(r));
  return teruWinValue(r, tsumo, seat === g.dealer) > teruLast(g, seat);
}
// points：“刚好高一档”最多到多少点（没起胡时是 TERU.start，坐庄乘 1.5）
export function teruSoftCap(g: Game, seat: number, tight = false): number {
  const level = gameStateOf(g, seat).level ?? 0;
  const t = tight && TERU.tight > 0;
  return (level === 0 ? (t ? TERU.tightStart : TERU.start) : teruLast(g, seat) * (t ? TERU.tight : TERU.soft)) * (level === 0 && seat === g.dealer ? 1.5 : 1);
}
// 一手听牌（hand 是门内的牌，不含和了牌）和出来怎么样：
// 4 = 默听就接得上，而且只高一档（TERU.tight 开着才有这一级）；3 = 默听就接得上，而且刚好高一档；2 = 默听接得上，但会和大；1 = 立直了才接得上；0 = 怎么和都接不上（或者没听牌）
// 振听只算自摸；tsumoOnly：只看自摸（放过一张和了牌以后）；live：这种牌还摸不摸得到
export function teruOutlook(g: Game, seat: number, hand: TileId[], melds: Meld[], opts: { tsumoOnly?: boolean; live?: (k: Kind) => boolean } = {}): number {
  const p = g.players[seat];
  const c = toCounts(hand);
  const waits = waitingKinds(c, melds.length);
  if (!waits.length) return 0;
  const menzen = melds.every((m) => m.type === 'ankan');
  const furiten = opts.tsumoOnly || p.furitenRiichi || waits.some((k) => p.discards.some((d) => kindOf(d.tile) === k));
  const cap = teruSoftCap(g, seat);
  const tightCap = TERU.tight > 0 ? teruSoftCap(g, seat, true) : -1;
  const top = TERU.tight > 0 ? 4 : 3;
  const dealer = seat === g.dealer;
  const dora = g.wall.visibleDoraIndicators().map(kindOf);
  let best = 0;
  for (const k of waits) {
    if (c[k] >= 4 || (opts.live && !opts.live(k))) continue;
    const t = [0, 1, 2, 3].map((i) => k * 4 + i).find((x) => !hand.includes(x) && !isRed(x)) ?? k * 4 + 1;
    for (const tsumo of [true, false]) {
      if (!tsumo && furiten) continue;
      for (const riichi of p.riichi ? [true] : menzen ? [false, true] : [false]) {
        const r = evaluateWin({ closed: [...hand, t], melds, kuitan: g.rules.kuitan, winTile: t, tsumo, seatWind: g.seatWind(seat), roundWind: EAST + g.roundWind, isDealer: dealer, riichi, doubleRiichi: riichi && p.doubleRiichi, ippatsu: false, doraIndicators: dora });
        if (!r || !teruAccepts(g, seat, r, tsumo)) continue;
        const v = teruWinValue(r, tsumo, dealer);
        best = Math.max(best, riichi && !p.riichi ? 1 : v <= tightCap ? 4 : v <= cap ? 3 : 2);
      }
    }
    if (best === top) return top;
  }
  return best;
}

// 另外三家看得见的警报：同桌有照、而且连和到 TERU.alarm 次了，返回她的座位；没有是 null
export function teruRising(g: Game, seat: number): number | null {
  if (!TERU.alarm) return null;
  for (let s = 0; s < 4; s++) {
    if (s === seat || g.abilities[s]?.id !== 'teru') continue;
    const level = gameStateOf(g, s).level ?? 0;
    if (level >= TERU.alarm && level < TERU_TOP) return s;
  }
  return null;
}

// 这一手比连和要的小（电脑的照牌山还多时先不和）
export function teruUnder(g: Game, seat: number, r: WinResult, tsumo: boolean): boolean {
  if (!teruPoints()) return teruTier(r) < teruLadder(g, seat).next;
  return teruWinValue(r, tsumo, seat === g.dealer) <= teruLast(g, seat);
}
// 下一次要和的是小牌（电脑的照多吃碰、快和）
export function teruCheapNext(g: Game, seat: number): boolean {
  if (TERU.mode === 'steps') return (gameStateOf(g, seat).level ?? 0) <= 1 || (gameStateOf(g, seat).level ?? 0) >= TERU_TOP;
  if (!teruPoints()) return teruLadder(g, seat).next <= 2;
  return teruLast(g, seat) / (seat === g.dealer ? 1.5 : 1) < 2000;
}

// 上一局的结算算进天梯和叽叽叽
function settle(g: Game, seat: number): void {
  const gs = gameStateOf(g, seat);
  const from = gs.seen ?? 0;
  gs.seen = g.events.length;
  let end: Extract<(typeof g.events)[number], { type: 'roundEnd' }> | undefined;
  for (let i = g.events.length - 1; i >= from; i--) {
    const e = g.events[i];
    if (e.type === 'roundEnd') {
      end = e;
      break;
    }
  }
  if (!end) return;
  const r = end.result;
  if (r.kind === 'abortive') return;
  const level = gs.level ?? 0;
  const mine: WinInfo | undefined = r.wins.find((w) => w.seat === seat);
  if (teruPoints()) {
    if (!mine) {
      if (level > 0) gs.broke = r.kind === 'win' ? '别人和了' : '流局';
      gs.level = 0;
      gs.last = 0;
      gs.streak = [];
      gs.kiki = 0;
      return;
    }
    const tsumo = mine.from === null;
    const value = teruWinValue(mine.result, tsumo, !!gs.dealer);
    const up = level === 0 || value > (gs.last ?? 0);
    if (up) {
      gs.level = Math.min(level + 1, 8);
      gs.broke = undefined;
      gs.last = value;
      gs.streak = [...(level === 0 ? [] : (gs.streak ?? [])), value].slice(-8);
      if (tsumo || TERU.gatesAll) gs.kiki = (gs.kiki ?? 0) + 1;
      else if (TERU.gatesStrict) gs.kiki = 0;
    } else {
      gs.broke = `和了 ${value} 点，没有比上一次的 ${gs.last ?? 0} 点高`;
      gs.level = TERU.smallRestart ? 1 : 0;
      gs.last = TERU.smallRestart ? value : 0;
      gs.streak = TERU.smallRestart ? [value] : [];
      gs.kiki = TERU.smallRestart && (tsumo || TERU.gatesAll) ? 1 : 0;
    }
    if (mine.result.yaku.some((y) => y.name.includes('九莲宝灯'))) gs.kiki = 0;
    return;
  }
  if (!mine) {
    if (level > 0 && level < TERU_TOP) gs.broke = r.kind === 'win' ? '别人和了' : '流局';
    gs.level = 0;
    if (TERU.mode === 'steps') gs.kiki = 0;
    return;
  }
  if (TERU.mode === 'steps') {
    const tier = teruTier(mine.result);
    const tsumo = mine.from === null;
    const up = level === 0 || level >= TERU_TOP || tier > level;
    gs.broke = up ? undefined : `和了${TERU_TIERS[tier - 1]}，没有比${TERU_TIERS[level - 1]}高`;
    if (up && level > 0 && level < TERU_TOP) {
      if (tsumo) gs.kiki = (gs.kiki ?? 0) + 1;
      else if (TERU.gatesStrict) gs.kiki = 0;
    } else gs.kiki = tsumo ? 1 : 0;
    gs.level = up || TERU.smallRestart ? tier : 0;
    if (!up && !TERU.smallRestart) gs.kiki = 0;
    if (mine.result.yaku.some((y) => y.name.includes('九莲宝灯'))) gs.kiki = 0;
    return;
  }
  if (mine.from === null) gs.kiki = (gs.kiki ?? 0) + 1;
  const tier = teruTier(mine.result);
  // 九莲宝灯（叽叽叽）以后从头数
  if (mine.result.yaku.some((y) => y.name.includes('九莲宝灯'))) gs.kiki = 0;
  const next = level >= TERU_TOP ? 1 : level + 1;
  if (tier === TERU_TOP || tier === next) {
    gs.level = tier === TERU_TOP ? TERU_TOP : next;
    gs.broke = undefined;
  } else {
    if (level > 0 && level < TERU_TOP) gs.broke = `和了${TERU_TIERS[tier - 1]}，不是${TERU_TIERS[next - 1]}`;
    else if (level === 0) gs.broke = `起胡要 1 番，和了${TERU_TIERS[tier - 1]}不算`;
    gs.level = 0;
  }
}

const SUIT = (k: number) => (k < 27 ? Math.floor(k / 9) : 3);
const isSimple = (k: number) => k < 27 && k % 9 > 0 && k % 9 < 8;

// 叽叽叽：把她的配牌换成某一门的 1112345678999（九面听）。挑一门换得出来的（不碰宝牌，玄的规矩也不违反）
function dealChuuren(g: Game, seat: number): number | null {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  const ok = (t: TileId) => !isDoraTile(g, t) && !w.locked.has(t);
  for (const suit of g.rng.shuffle([0, 1, 2])) {
    const need = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8].map((n) => suit * 9 + n);
    // 先看换不换得出来：每种牌在她配牌里和配牌以外的牌山里（没锁住、不是宝牌）够不够
    const pool = [...mine.map((i) => w.live[i]), ...w.live.slice(52)].filter(ok);
    if (need.some((k) => pool.filter((t) => kindOf(t) === k).length < need.filter((x) => x === k).length)) continue;
    // 她配牌里已经有的、要用的牌先留着，剩下的位置一张张换
    const left = need.slice();
    const free: number[] = [];
    for (const i of mine) {
      const j = left.indexOf(kindOf(w.live[i]));
      if (j >= 0 && ok(w.live[i])) left.splice(j, 1);
      else free.push(i);
    }
    let done = true;
    for (const i of free) {
      const k = left.shift()!;
      if (!w.bringToLive(i, (t) => kindOf(t) === k && ok(t), g.rng, (j) => j >= 52)) {
        done = false;
        break;
      }
    }
    if (done) return suit;
  }
  return null;
}

// 配牌往一门花色偏：inSet 里的牌（这一门，混一色再加字牌）不到 want 张，就把别的牌换成 inSet 里的，向听不变差
// 配牌的向听都只看一般形（见 beforeDeal）
function tiltDeal(g: Game, seat: number, honors: boolean, want: number, simples = false): void {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  const per = [0, 0, 0];
  for (const i of mine) if (kindOf(w.live[i]) < 27) per[SUIT(kindOf(w.live[i]))]++;
  const suit = per.indexOf(Math.max(...per));
  const inSet = (t: TileId) => (simples ? isSimple(kindOf(t)) : SUIT(kindOf(t)) === suit || (honors && kindOf(t) >= 27));
  for (let n = 0; n < TERU.tiltSwaps; n++) {
    const tiles = mine.map((i) => w.live[i]);
    if (tiles.filter(inSet).length >= want) return;
    const counts = toCounts(tiles);
    const cur = standardShanten(counts, 0);
    let done = false;
    for (const i of g.rng.shuffle(mine.filter((i) => !inSet(w.live[i])))) {
      const k = kindOf(w.live[i]);
      counts[k]--;
      const fine = (t: TileId) => {
        if (!inSet(t)) return false;
        counts[kindOf(t)]++;
        const sh = standardShanten(counts, 0);
        counts[kindOf(t)]--;
        return sh <= cur;
      };
      done = w.bringToLive(i, fine, g.rng, (j) => j >= 52);
      counts[k]++;
      if (done) break;
    }
    if (!done) return;
  }
}

// 没起胡时的配牌：往副露也有役、1000 点就能和的形状送。已经有役牌对子就不动；中张够多就偏断幺九；不然送一对役牌
function cheapDeal(g: Game, seat: number): void {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  const yaku = [...new Set([HAKU, HAKU + 1, HAKU + 2, g.seatWind(seat), EAST + g.roundWind])];
  const tiles = () => mine.map((i) => w.live[i]);
  const cnt = (k: number) => tiles().filter((t) => kindOf(t) === k).length;
  if (yaku.some((k) => cnt(k) >= 2)) return;
  if (tiles().filter((t) => isSimple(kindOf(t))).length >= TERU.cheapSimples) {
    tiltDeal(g, seat, false, 13, true);
    return;
  }
  // 手里已经有一张的役牌先试
  for (const k of g.rng.shuffle(yaku).sort((a, b) => cnt(b) - cnt(a))) {
    for (let need = 2 - cnt(k); need > 0; need--) {
      const counts = toCounts(tiles());
      const cur = standardShanten(counts, 0);
      // 换掉哪一张：换完向听最少的那张，向听不能变差
      const slots = mine
        .filter((i) => kindOf(w.live[i]) !== k)
        .map((i) => {
          counts[kindOf(w.live[i])]--;
          counts[k]++;
          const sh = standardShanten(counts, 0);
          counts[k]--;
          counts[kindOf(w.live[i])]++;
          return { i, sh };
        })
        .sort((a, b) => a.sh - b.sh);
      let done = false;
      for (const x of slots) {
        if (x.sh > cur) break;
        if (w.bringToLive(x.i, (t) => kindOf(t) === k && !isDoraTile(g, t), g.rng, (j) => j >= 52)) {
          done = true;
          break;
        }
      }
      if (!done) break;
    }
    if (cnt(k) >= 2) return;
  }
}

// points：按“要比多少点高”算（坐庄时打点是 1.5 倍，折回去）：要 4 番左右偏混一色，要跳满以上偏清一色
function tiltNow(g: Game, seat: number): { honors: boolean; want: number; simples?: boolean } | null {
  if (!teruPoints()) return tiltOf(gameStateOf(g, seat).level ?? 0);
  const v = teruLast(g, seat) / (seat === g.dealer ? 1.5 : 1);
  if (v >= 8000) return { honors: false, want: v >= 12000 ? 11 : 10 };
  if (v >= 3900) return { honors: true, want: v >= 5200 ? 10 : 9 };
  if (TERU.simplesFrom && v >= TERU.simplesFrom) return { honors: false, want: 13, simples: true };
  return null;
}

// 电脑的照做牌的方向：这一局该留哪些牌（断幺九的中张、染手的那门和字牌）；没有方向是 null
export function teruTiltSet(g: Game, seat: number): ((k: Kind) => boolean) | null {
  if (!teruMirrored(g, seat)) return null;
  const tilt = tiltNow(g, seat);
  if (!tilt) return null;
  if (tilt.simples) return isSimple;
  const per = [0, 0, 0];
  for (const t of g.players[seat].hand) if (kindOf(t) < 27) per[SUIT(kindOf(t))]++;
  const suit = per.indexOf(Math.max(...per));
  return (k) => SUIT(k) === suit || (tilt.honors && k >= 27);
}

// 4 番以上配牌偏混一色，跳满以上偏清一色：要几张、带不带字牌（按要和的下一层算）
function tiltOf(level: number): { honors: boolean; want: number } | null {
  if (level >= 5 && level < TERU_TOP) return { honors: false, want: level >= 6 ? 11 : 10 };
  if (level >= 3 && level < TERU_TOP) return { honors: true, want: level >= 4 ? 10 : 9 };
  return null;
}

// 一手听牌（13 张）自摸接不接得上连和（门清的话立直也算），而且那张牌牌山里还有
function fitsAfterHand(g: Game, seat: number, hand: TileId[], inWall: (k: Kind) => boolean): boolean {
  const p = g.players[seat];
  const menzen = p.melds.every((m) => m.type === 'ankan');
  const c = toCounts(hand);
  return waitingKinds(c, p.melds.length).some((k) => {
    if (!inWall(k)) return false;
    const t = [0, 1, 2, 3].map((i) => k * 4 + i).find((x) => !hand.includes(x) && !isRed(x)) ?? k * 4 + 1;
    return [false, true].some((riichi) => {
      if (riichi && !menzen) return false;
      const r = evaluateWin({ closed: [...hand, t], melds: p.melds, winTile: t, tsumo: true, seatWind: g.seatWind(seat), roundWind: EAST + g.roundWind, isDealer: seat === g.dealer, riichi, doubleRiichi: false, ippatsu: false, doraIndicators: g.wall.visibleDoraIndicators().map(kindOf) });
      return !!r && teruAccepts(g, seat, r, true);
    });
  });
}

// 摸进 t、换一张打出去以后，听成接得上连和的牌
function raisesWith(g: Game, seat: number, hand: TileId[], t: TileId, inWall: (k: Kind) => boolean): boolean {
  const melds = g.players[seat].melds.length;
  const tried = new Set<number>();
  for (const d of hand) {
    if (tried.has(kindOf(d))) continue;
    tried.add(kindOf(d));
    const next = [...hand.filter((x) => x !== d), t];
    if (shanten(toCounts(next), melds) === 0 && fitsAfterHand(g, seat, next, inWall)) return true;
  }
  return false;
}

// 听着接不上的牌（hand 是 13 张）：牌山里还有没有换一张就接得上的牌（她的能力会送来）
export function teruRaisable(g: Game, seat: number, hand: TileId[]): boolean {
  const inWall = TERU.wallAware ? teruWallHas(g) : () => true;
  const seen = new Set<number>();
  for (const t of g.wall.live) {
    const k = kindOf(t);
    if (seen.has(k) || g.wall.locked.has(t) || (TERU.doraOut && isDoraTile(g, t))) continue;
    seen.add(k);
    if (raisesWith(g, seat, hand, t, inWall)) return true;
  }
  return false;
}

export const teruAbility: Ability = {
  id: 'teru',
  name: '照魔镜·连续和了',
  immune: true,
  // 平行宇宙：天梯回到塔底，叽叽叽从头数
  resetMarks(g, seat) {
    const gs = gameStateOf(g, seat);
    gs.level = 0;
    gs.kiki = 0;
    gs.last = 0;
    gs.streak = [];
    gs.broke = '平行宇宙';
  },
  description:
    '别人的能力动不了她（只有玄的宝牌她也得守）。第一局用照魔镜只看不和，之后看得穿每家的能力（玩家能点开别人头像旁的镜子看），也读得出立直的人听什么（手里打出去会放铳的牌标红）。连续和了：每次和了拿到的点数比上一次高，连和就接得上（本场、立直棒不算，坐庄的 1.5 倍算），从多少点起胡都行；和小了算新一轮的第一次，别人和了、流局就断。起胡前牌运平平，配牌多半带一对役牌或者偏断幺九，适合鸣牌和个 1000 点；起胡以后配牌和摸牌帮得多，快听牌时先送“刚好比上一次高一档”的和了牌，宝牌多半不找她。压制：别人的进张常被换走。叽叽叽：一轮连和里自摸满八次，下一局必定九莲宝灯。',

  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    settle(g, seat);
    gs.rounds = (gs.rounds ?? 0) + 1;
    gs.dealer = seat === g.dealer;
  },

  // 照魔镜看过以后：叽叽叽满了就做九莲宝灯；不然配牌超过这一层的向听上限就换几张，高层再往一门花色偏
  // 只看一般形的向听：七对子的向听也算的话，凑对子的牌也算“降向听”，配牌会偏成七对子
  beforeDeal(g, seat) {
    if (!teruMirrored(g, seat)) return;
    const gs = gameStateOf(g, seat);
    if ((gs.kiki ?? 0) >= TERU.kiki) {
      const suit = dealChuuren(g, seat);
      if (suit !== null) {
        stateOf(g, seat).chuuren = suit;
        return;
      }
    }
    const level = gs.level ?? 0;
    const w = g.wall;
    const mine = g.dealIndices(seat);
    for (let n = 0; n < TERU.dealSwaps; n++) {
      const counts = toCounts(mine.map((i) => w.live[i]));
      const cur = standardShanten(counts, 0);
      if (cur <= TERU.dealMax[level]) break;
      let done = false;
      for (const i of g.rng.shuffle([...mine])) {
        const k = kindOf(w.live[i]);
        counts[k]--;
        const better = (t: number) => {
          counts[kindOf(t)]++;
          const sh = standardShanten(counts, 0);
          counts[kindOf(t)]--;
          return sh < cur;
        };
        done = w.bringToLive(i, better, g.rng, (j) => j >= 52);
        counts[k]++;
        if (done) break;
      }
      if (!done) break;
    }
    if (teruPoints() && TERU.cheapStart && level === 0) cheapDeal(g, seat);
    const tilt = tiltNow(g, seat);
    if (tilt) tiltDeal(g, seat, tilt.honors, tilt.want, tilt.simples);
    // 宝牌不找她：配牌里的宝牌、赤宝牌换成别的（向听不变差）
    if (TERU.doraOut) {
      for (const i of mine) {
        if (!isDoraTile(g, w.live[i]) || !g.rng.chance(TERU.doraOut)) continue;
        const counts = toCounts(mine.map((j) => w.live[j]));
        const cur = standardShanten(counts, 0);
        counts[kindOf(w.live[i])]--;
        const fine = (t: TileId) => {
          if (isDoraTile(g, t)) return false;
          counts[kindOf(t)]++;
          const sh = standardShanten(counts, 0);
          counts[kindOf(t)]--;
          return sh <= cur;
        };
        if (!w.bringToLive(i, fine, g.rng, (j) => j >= 52)) w.bringToLive(i, (t) => !isDoraTile(g, t), g.rng, (j) => j >= 52);
      }
    }
  },

  onRoundStart(g, seat) {
    const gs = gameStateOf(g, seat);
    if (gs.rounds === 1) g.emit({ type: 'ability', seat, ability: 'teru', text: '照魔镜' });
    if (stateOf(g, seat).chuuren !== undefined) g.emit({ type: 'ability', seat, ability: 'teru', text: '叽叽叽' });
  },

  // 叽叽叽的九莲宝灯听牌：坐庄时第一张不给天和
  noTenhou(g, seat) {
    return stateOf(g, seat).chuuren !== undefined;
  },

  canWin(g, seat) {
    return teruMirrored(g, seat);
  },


  // 压制：照魔镜看过以后，别人要摸的进张有时被换走（悄悄换，结算时能力痕迹里讲）
  beforeAnyDraw(g, seat, drawer, rinshan) {
    if (drawer === seat || rinshan || !teruMirrored(g, seat)) return;
    if (TERU.riichiOpen && g.players[seat].riichi) return;
    if (TERU.callFree && g.players[drawer].melds.some((m) => m.type !== 'ankan')) return;
    if (!g.rng.chance(TERU.press[teruLadder(g, seat).level])) return;
    const p = g.players[drawer];
    const base = toCounts(p.hand);
    const melds = p.melds.length;
    const sh = shanten(base, melds);
    return {
      seat,
      ability: 'teru',
      text: '压制',
      deny: (t: TileId) => {
        base[kindOf(t)]++;
        const after = shanten(base, melds);
        base[kindOf(t)]--;
        return after < sh;
      },
    };
  },

  // 摸牌换成进张：概率按站在第几层；快听牌时只给正好够得上下一层的和了牌
  beforeDraw(g, seat, rinshan) {
    if (rinshan || !teruMirrored(g, seat)) return;
    const st = stateOf(g, seat);
    const p = g.players[seat];
    const counts = toCounts(p.hand);
    // 叽叽叽：九莲宝灯听牌，这一门哪张都和
    if (st.chuuren !== undefined) {
      const suit = st.chuuren;
      if (shanten(counts, p.melds.length) === 0 && p.melds.length === 0) g.wall.bringToLive(0, (t) => SUIT(kindOf(t)) === suit, g.rng);
      return;
    }
    const { level } = teruLadder(g, seat);
    const sh = shanten(counts, p.melds.length);
    if (sh < 0) return;
    // 宝牌不找她：下一张是宝牌、赤宝牌就先换走
    const plain = (t: number) => !TERU.doraOut || !isDoraTile(g, t);
    if (!plain(g.wall.live[0]) && g.rng.chance(TERU.doraOut)) g.wall.bringToLive(0, plain, g.rng);
    const tilt = tiltNow(g, seat);
    // 摸了 t 和了的话是第几层（和不了是 0）
    const tierOf = (t: number, tsumo: boolean) => {
      const r = winOf(t, tsumo);
      return r ? teruTier(r) : 0;
    };
    const winOf = (t: number, tsumo: boolean) => {
      counts[kindOf(t)]++;
      const done = shanten(counts, p.melds.length) < 0;
      counts[kindOf(t)]--;
      if (!done) return null;
      return evaluateWin({
        closed: [...p.hand, t],
        melds: p.melds,
        winTile: t,
        tsumo,
        seatWind: g.seatWind(seat),
        roundWind: EAST + g.roundWind,
        isDealer: seat === g.dealer,
        riichi: p.riichi,
        doubleRiichi: p.doubleRiichi,
        ippatsu: p.ippatsu,
        doraIndicators: g.wall.visibleDoraIndicators().map(kindOf),
      });
    };
    const points = teruPoints();
    const accepts = (t: number, tsumo: boolean) => {
      if (!points) return teruFits(g, seat, tierOf(t, tsumo));
      const r = winOf(t, tsumo);
      return !!r && teruAccepts(g, seat, r, tsumo);
    };
    const useful = (t: number) => {
      counts[kindOf(t)]++;
      const after = shanten(counts, p.melds.length);
      counts[kindOf(t)]--;
      if (after >= sh || !plain(t)) return false;
      return after >= 0 || accepts(t, true);
    };
    // points：和了牌先挑“刚好比上一次高”的，台阶踩得小，连和才长
    const softCap = teruSoftCap(g, seat);
    const tightCap = teruSoftCap(g, seat, true);
    const softest = (t: number) => {
      if (!useful(t)) return false;
      const r = winOf(t, true);
      return !r || teruWinValue(r, true, seat === g.dealer) <= tightCap;
    };
    const soft = (t: number) => {
      if (!useful(t)) return false;
      const r = winOf(t, true);
      if (!r || points) return !r || teruWinValue(r, true, seat === g.dealer) <= softCap;
      // steps：先挑正好高一层的（没起胡先挑 1 番、2 番）
      const tier = teruTier(r);
      return tier === TERU_TOP || tier <= (level === 0 || level >= TERU_TOP ? 2 : level + 1);
    };
    // 高层：先挑混一色、清一色那一门的
    const per = [0, 0, 0];
    for (const t of p.hand) if (kindOf(t) < 27) per[SUIT(kindOf(t))]++;
    const suit = per.indexOf(Math.max(...per));
    const onSuit = (t: number) => !tilt || (tilt.simples ? isSimple(kindOf(t)) : SUIT(kindOf(t)) === suit || (tilt.honors && kindOf(t) >= 27));
    const before = g.wall.live[0];
    // points：听牌了、没立直，但哪张和了都不比上一次高：送一张“摸进来、换一张打出去以后接得上”的牌
    const inWall = TERU.wallAware ? teruWallHas(g) : () => true;
    const fitsAfter = (hand: TileId[]) => fitsAfterHand(g, seat, hand, inWall);
    // 接得上的和了牌牌山里一张都没有（听死了）也算
    const stuck = points && TERU.raise && sh === 0 && !p.riichi && (level > 0 || TERU.wallAware) && !fitsAfter(p.hand);
    const raiseMemo = new Map<number, boolean>();
    const raise = (t: number) => {
      if (!plain(t)) return false;
      const k = kindOf(t);
      let ok = raiseMemo.get(k);
      if (ok === undefined) raiseMemo.set(k, (ok = raisesWith(g, seat, p.hand, t, inWall)));
      return ok;
    };
    // points：一向听时，先送“摸进来、打一张以后听成刚好高一档”的牌
    const leadMemo = new Map<number, number>();
    const leadClass = (t: number) => {
      if (!useful(t)) return 0;
      const k = kindOf(t);
      let best = leadMemo.get(k);
      if (best === undefined) {
        best = 0;
        const tried = new Set<number>();
        for (const d of p.hand) {
          if (tried.has(kindOf(d))) continue;
          tried.add(kindOf(d));
          best = Math.max(best, teruOutlook(g, seat, [...p.hand.filter((x) => x !== d), t], p.melds, { live: inWall }));
        }
        leadMemo.set(k, best);
      }
      return best;
    };
    const lead = (t: number) => leadClass(t) >= 3;
    if (stuck) {
      if (g.rng.chance(TERU.boost[level]) && !g.wall.bringToLive(0, raise, g.rng) && TERU.settleDraw && level > 0) {
        // 怎么换都接不上了：送一张普通的和了牌，和小了重新起头
        const any = (t: number) => plain(t) && !!winOf(t, true);
        g.wall.bringToLive(0, any, g.rng);
      }
    } else if (points && TERU.softDraw && sh === 1) {
      if (g.rng.chance(TERU.boost[level]) && !(leadClass(before) === (TERU.tight > 0 ? 4 : 3) && onSuit(before))) {
        if (!(TERU.tight > 0 && g.wall.bringToLive(0, (t) => leadClass(t) === 4, g.rng)) && !(lead(before) && onSuit(before)) && !g.wall.bringToLive(0, (t) => lead(t) && onSuit(t), g.rng) && !g.wall.bringToLive(0, lead, g.rng) && !(useful(before) && onSuit(before)) && !g.wall.bringToLive(0, (t) => useful(t) && onSuit(t), g.rng) && !useful(before)) g.wall.bringToLive(0, useful, g.rng);
      }
    } else if (points || TERU.mode === 'steps') {
      const tightOn = points && TERU.tight > 0 && sh === 0;
      if (g.rng.chance(TERU.boost[level]) && !((tightOn ? softest(before) : soft(before)) && onSuit(before))) {
        const hold = TERU.strict && points && sh === 0 && p.ippatsu;
        if (!(tightOn && g.wall.bringToLive(0, softest, g.rng)) && !(tightOn && soft(before) && onSuit(before)) && !g.wall.bringToLive(0, (t) => soft(t) && onSuit(t), g.rng) && !hold && !(useful(before) && onSuit(before)) && !g.wall.bringToLive(0, (t) => useful(t) && onSuit(t), g.rng) && !useful(before)) g.wall.bringToLive(0, useful, g.rng);
      }
    } else if (g.rng.chance(TERU.boost[level]) && !(useful(before) && onSuit(before))) {
      if (!g.wall.bringToLive(0, (t) => useful(t) && onSuit(t), g.rng) && !useful(before)) g.wall.bringToLive(0, useful, g.rng);
    }
    // 听牌了、荣和接得上天梯：摸到会自摸错层的牌就换成和不了的，留着等荣和（牌山快摸完了不挡）
    if (sh === 0 && g.wall.remaining > TERU.aiForceWin) {
      const top = tierOf(g.wall.live[0], true);
      const topFits = () => accepts(g.wall.live[0], true);
      const ronFits = () => {
        const waits = waitingKinds(counts, p.melds.length);
        if (p.furitenRiichi || waits.some((k) => p.discards.some((d) => kindOf(d.tile) === k))) return false;
        return waits.some((k) => {
          const t = [0, 1, 2, 3].map((i) => k * 4 + i).find((x) => !p.hand.includes(x) && !isRed(x)) ?? k * 4 + 1;
          return accepts(t, false);
        });
      };
      if (top && !topFits() && ronFits()) g.wall.bringToLive(0, (t) => !tierOf(t, true), g.rng);
    }
    if (g.wall.live[0] === before) return;
    if (!st.boosted && level > 0) g.emit({ type: 'ability', seat, ability: 'teru', text: '连续和了' });
    st.boosted = true;
  },

  badge(g, seat) {
    if (!teruMirrored(g, seat)) return '照魔镜';
    const { level, last } = teruLadder(g, seat);
    if (!teruPoints()) return level ? `天梯·${TERU_TIERS[level - 1]}` : null;
    return level ? `${level} 连和·${last}点` : null;
  },

  skill(g, seat) {
    if (!teruMirrored(g, seat)) return { label: '照魔镜', note: '这一局只看不和；看过以后，点别人头像旁的镜子看他的能力', enabled: false };
    const { level, next, broke, kiki } = teruLadder(g, seat);
    if (teruPoints()) return { label: '连续和了', note: `${teruNote(g, seat)}；叽叽叽 ${kiki}/${TERU.kiki}`, enabled: false, active: level > 0 };
    const head = level ? `站在${TERU_TIERS[level - 1]}，下一次要正好和${TERU_TIERS[next - 1]}` : broke ? `天梯断了（${broke}），从 1 番起胡` : '先和一个 1 番起胡';
    return { label: '连续和了', note: `${head}；叽叽叽 ${kiki}/${TERU.kiki}`, enabled: false, active: level > 0 };
  },

  insight(g, seat) {
    if (!teruMirrored(g, seat)) return ['照魔镜：这一局只看不和'];
    const { level, next, kiki, last } = teruLadder(g, seat);
    if (teruPoints()) return [level ? `连和 ${level} 次，上一次 ${last} 点，这一局和出比它高的就接上` : '还没起胡（和多少点都算起胡）', `叽叽叽：这一轮连和里自摸 ${kiki}/${TERU.kiki}`];
    return [level ? `天梯站在${TERU_TIERS[level - 1]}，下一次要正好和${TERU_TIERS[next - 1]}` : '还没起胡（要先和 1 番）', `叽叽叽：自摸 ${kiki}/${TERU.kiki}`];
  },
};

// points：现在连和到哪了、下一次要和多少（技能说明、头像旁的塔都用这一句）
export function teruNote(g: Game, seat: number): string {
  const { level, broke, last, streak } = teruLadder(g, seat);
  if (!level) return broke ? `连和断了（${broke}），和多少点都算重新起胡` : '还没起胡：和多少点都算，越便宜后面越好接';
  const tail = `这一局要和出比 ${last} 点高的才接得上（本场、立直棒不算）`;
  if (level === 1 && broke) return `${broke}，从这一次重新数；${tail}`;
  return `连和 ${level} 次（${streak.join('、')}）；${tail}`;
}
