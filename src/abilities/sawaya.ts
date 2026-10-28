import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { CHUN, Kind, TileId, isHonor, isWind, kindOf, numOf, suitOf, toCounts } from '../engine/tiles';
import { PRIORITY, type Ability, type DealRule, type PreDealOption } from './types';

// 狮子原爽（有珠山）：五色云和神威（kamuy），每样一场只能发动一次，可以叠着用。
// 五色云在发牌前选，神威在配完牌、看过手牌以后选（瘟神威要等听牌，用技能按钮发动）。
// 她最先动（PRIORITY.sawaya），定下的配牌规矩别人不能违反。
// - 红云：字牌的流向，1 局。对自己用：别人配牌里没有字牌、也摸不到，她容易摸到用得上的字牌；
//   对一家对手用：字牌只流向那一家（摸到的多是没用的字牌），别人（包括她自己）摸不到
// - 黄云：她配牌的数牌换成 1–4，摸牌偏向 1–4，2 局
// - 青云：她配牌的数牌换成 6–9，摸牌偏向 6–9，2 局
// - 白云：她配牌、摸牌偏向索子，1 局
// - 黑云：她配牌、摸牌偏向筒子，1 局
// - 瘟神威：她听牌时发动，指定一家，这一局那一家摸到的都是她的和了牌（可以拆牌防守）
// - 海神威：她大幅容易摸到万子和红中，别人容易摸到用不上的万子；里宝牌换成她手里最多的那种万子，1 局
// - 鸟神威：她大幅容易摸到不是自风的风牌，2 局
// - 蛇神威：封印对手所有能力，3 局（包括这一局）
export const SAWAYA = {
  drawChance: 0.5, // 云让她摸到想要的牌的概率
  strongChance: 0.75, // 海神威、鸟神威（大幅）
  seaJunk: 0.35, // 海神威：别人摸到用不上的万子的概率
  redJunk: 0.6, // 红云给了对手：那一家摸到没用的字牌的概率
};

type CloudId = 'red' | 'yellow' | 'blue' | 'white' | 'black';
type KamuyId = 'pakoro' | 'akkoro' | 'huri' | 'hoyau';
type SkillId = CloudId | KamuyId;

// id 沿用以前的（素材页按 id 存动画）：帕科罗＝瘟神威，阿科罗＝海神威，胡里＝鸟神威，霍亚乌＝蛇神威
export const SAWAYA_SKILLS: { id: SkillId; name: string; desc: string; kamuy: boolean; rounds: number }[] = [
  { id: 'red', name: '红云', desc: '字牌的流向：对自己用，字牌只有她摸得到；对一家对手用，字牌只流向那一家', kamuy: false, rounds: 1 },
  { id: 'yellow', name: '黄云', desc: '她配牌的数牌换成 1–4，摸牌也偏向 1–4', kamuy: false, rounds: 2 },
  { id: 'blue', name: '青云', desc: '她配牌的数牌换成 6–9，摸牌也偏向 6–9', kamuy: false, rounds: 2 },
  { id: 'white', name: '白云', desc: '她配牌、摸牌偏向索子', kamuy: false, rounds: 1 },
  { id: 'black', name: '黑云', desc: '她配牌、摸牌偏向筒子', kamuy: false, rounds: 1 },
  { id: 'pakoro', name: '瘟神威', desc: '听牌时发动，指定一家：这一局那一家摸到的都是她的和了牌（对手可以拆牌防守）', kamuy: true, rounds: 1 },
  { id: 'akkoro', name: '海神威', desc: '她很容易摸到万子和红中，别人容易摸到用不上的万子；里宝牌换成她手里最多的那种万子', kamuy: true, rounds: 1 },
  { id: 'huri', name: '鸟神威', desc: '她很容易摸到不是自风的风牌', kamuy: true, rounds: 2 },
  { id: 'hoyau', name: '蛇神威', desc: '封印对手所有能力', kamuy: true, rounds: 3 },
];
const skillOf = (id: SkillId) => SAWAYA_SKILLS.find((k) => k.id === id)!;
const nameOf = (id: SkillId) => skillOf(id).name;
const CLOUDS = SAWAYA_SKILLS.filter((k) => !k.kamuy).map((k) => k.id as CloudId);
const REL = ['自己', '下家', '对家', '上家'];

interface SawayaGameState {
  used?: SkillId[]; // 这一场用过的
  since?: Partial<Record<SkillId, number>>; // 从第几局（g.round）到第几局起作用
  until?: Partial<Record<SkillId, number>>;
  redTarget?: number; // 红云给了谁
  plagueTarget?: number; // 瘟神威给了谁（只在发动的那一局）
  picks?: string[]; // 玩家发牌前选的云（红云带对象：red@1 是下家）
  kamuyPicks?: string[]; // 玩家配牌后选的神威
}

const gameStateOf = (g: Game, seat: number) => {
  const gs = g.abilityGameState[seat] as SawayaGameState;
  gs.used ??= [];
  gs.since ??= {};
  gs.until ??= {};
  return gs;
};

// 第 round 局（不写是这一局）这样技能起不起作用
export function sawayaOn(g: Game, seat: number, id: SkillId, round = g.round): boolean {
  const gs = gameStateOf(g, seat);
  return gs.since![id] !== undefined && round >= gs.since![id]! && round <= gs.until![id]!;
}

// 这一局起作用的全部
const activeIds = (g: Game, seat: number) => SAWAYA_SKILLS.map((k) => k.id).filter((id) => sawayaOn(g, seat, id));

// 红云给了谁（这一局没开是 null）
export function sawayaRedTarget(g: Game, seat: number): number | null {
  return sawayaOn(g, seat, 'red') ? gameStateOf(g, seat).redTarget ?? seat : null;
}

// 瘟神威给了谁（这一局没开是 null）
export function sawayaPlagueTarget(g: Game, seat: number): number | null {
  return sawayaOn(g, seat, 'pakoro') ? gameStateOf(g, seat).plagueTarget ?? null : null;
}

// 还能不能用。不能用时给原因
function blocked(g: Game, seat: number, id: SkillId): string | null {
  return gameStateOf(g, seat).used!.includes(id) ? '这一场用过了' : null;
}

function start(g: Game, seat: number, id: SkillId): void {
  const gs = gameStateOf(g, seat);
  if (gs.used!.includes(id)) return;
  gs.used!.push(id);
  gs.since![id] = g.round;
  gs.until![id] = g.round + skillOf(id).rounds - 1;
}

// 点数最高的对手（管不到的人不算）
const leader = (g: Game, seat: number) =>
  [0, 1, 2, 3].filter((s) => s !== seat && g.binds(seat, s)).sort((a, b) => g.players[b].score - g.players[a].score)[0];

// 听牌了没有（自己摸牌后 14 张时：打一张能听牌）
const tenpai = (g: Game, seat: number) => {
  const p = g.players[seat];
  return shanten(toCounts(p.hand), p.melds.length) <= 0;
};

// ---------- 电脑的爽 ----------

// 每局先算这一局值不值得动手，动手就叠着用（一局最多两样，连着起作用的不算），不动手就留着。
// - 值不值得：坐庄、落后、配牌正合某朵云、到了最后两局、剩下的比剩下的局多，都加分；
//   同桌有攒着最后几局的人（涅莉）时前半场也加分
// - 云：配牌已经合得上才叫；落后很多、到了最后几局时把红云给领先的那家（塞没用的字牌）
// - 神威：万子多叫海神威，手里有客风对子叫鸟神威；同桌能封的控场对手有两个以上（最后几局一个）叫蛇神威，
//   但不单独叫，一定配着合得上的云或神威；瘟神威听牌了、不是第一的时候（或者最后几局）对准领先的那家
// - 打牌：留住云、神威送来的牌（sawayaFocus），往那门的混一色做，能鸣就鸣
export const SAWAYA_AI = {
  act: 3, // 「值不值得」到这个分就动手
  behindPer: 8000, // 落后多少点加 1 分
  maxPerRound: 2, // 一局最多新叫几样
  redPush: 12000, // 落后这么多、最后几局时把红云给领先的那家
};

// 能被蛇神威封住、而且会控场的对手（只读牌的洋榎、美穗子，只挡别人影响的天使和不算；照、玄封不了）
const CONTROL_FREE = ['hiroe', 'mihoko', 'nodoka'];
const controllers = (g: Game, seat: number) =>
  [0, 1, 2, 3].filter((s) => s !== seat && g.abilities[s] && !CONTROL_FREE.includes(g.abilities[s]!.id) && g.binds(seat, s) && !g.abilities[s]!.immune && !g.abilities[s]!.absolute);

// 同桌有没有把运势攒到最后几局的人
const lateHeavy = (g: Game, seat: number) => [0, 1, 2, 3].some((s) => s !== seat && g.abilities[s]?.id === 'nelly');

const ok = (g: Game, seat: number, id: SkillId) => blocked(g, seat, id) === null;
const behind = (g: Game, seat: number) => Math.max(...g.players.filter((p) => p.seat !== seat).map((p) => p.score)) - g.players[seat].score;
// 到门槛的 3/4 就算合得上，最后两局再放低一些
const loose = (g: Game, need: number) => Math.ceil(need * 0.75 * (g.isLastRounds(2) ? 0.75 : 1));

// 这一局值不值得动手
function worth(g: Game, seat: number, fits: boolean, sh: number): boolean {
  const ready = SAWAYA_SKILLS.filter((k) => ok(g, seat, k.id)).length;
  if (!ready) return false;
  const total = g.fullHanchan ? 8 : 4;
  const slot = g.roundWind * 4 + g.roundNumber;
  const roundsLeft = Math.max(1, total - slot);
  let w = 0;
  if (seat === g.dealer) w += 1.5;
  w += Math.max(0, behind(g, seat) / SAWAYA_AI.behindPer);
  if (fits) w += 1.5;
  if (sh <= 3) w += 0.5;
  if (lateHeavy(g, seat) && slot < total / 2) w += 1;
  if (ready >= roundsLeft * 2) w += 2;
  if (-behind(g, seat) > 16000 && !g.isLastRounds(2)) w -= 1.5;
  return g.isLastRounds(2) || w >= SAWAYA_AI.act;
}

// 配牌合哪朵云：[云, 合的牌数, 门槛]
function cloudFits(hand: Kind[]): [CloudId, number, number][] {
  const nums = hand.filter((k) => k < 27);
  const honorPair = hand.some((k) => isHonor(k) && hand.filter((x) => x === k).length >= 2);
  return [
    ['red', honorPair ? hand.filter(isHonor).length : 0, 4],
    ['yellow', nums.filter((k) => numOf(k) <= 4).length, 9],
    ['blue', nums.filter((k) => numOf(k) >= 6).length, 9],
    ['white', nums.filter((k) => suitOf(k) === 2).length, 6],
    ['black', nums.filter((k) => suitOf(k) === 1).length, 6],
  ];
}

// 发牌前：叫哪朵云（玩家的选法：red@n 是红云给第 n 家）
function aiClouds(g: Game, seat: number): string[] {
  const tiles = g.dealHand(seat);
  const hand = tiles.map(kindOf);
  const fits = cloudFits(hand)
    .filter(([id, n, need]) => ok(g, seat, id) && n >= loose(g, need))
    .sort((a, b) => b[1] / b[2] - a[1] / a[2]);
  const sh = shanten(toCounts(tiles), 0);
  // 落后很多的最后几局：红云给领先的那家，塞给他没用的字牌
  const top = leader(g, seat);
  if (ok(g, seat, 'red') && top !== undefined && g.isLastRounds(3) && behind(g, seat) >= SAWAYA_AI.redPush) return [`red@${(top - seat + 4) % 4}`];
  if (!fits.length || !worth(g, seat, true, sh)) return [];
  return [fits[0][0]];
}

// 配牌后：叫哪些神威（这一局已经新叫了 already 样）
function aiKamuy(g: Game, seat: number, already: number): KamuyId[] {
  const tiles = g.players[seat].hand;
  const hand = tiles.map(kindOf);
  const man = hand.filter((k) => k < 9 || k === CHUN).length;
  const guestPair = hand.some((k) => isWind(k) && k !== g.seatWind(seat) && hand.filter((x) => x === k).length >= 2);
  const sh = shanten(toCounts(tiles), 0);
  const cands: [KamuyId, number][] = [];
  // 海神威和白云、黑云冲突（一个要万子一个要别的花色）
  const otherSuit = sawayaOn(g, seat, 'white') || sawayaOn(g, seat, 'black');
  if (ok(g, seat, 'akkoro') && !otherSuit && man >= loose(g, 6)) cands.push(['akkoro', man / 6]);
  if (ok(g, seat, 'huri') && guestPair) cands.push(['huri', 1 + (sawayaRedTarget(g, seat) === seat ? 0.5 : 0)]);
  cands.sort((a, b) => b[1] - a[1]);
  if (!already && !worth(g, seat, cands.length > 0, sh)) return [];
  const out: KamuyId[] = [];
  for (const [id] of cands) if (already + out.length < SAWAYA_AI.maxPerRound) out.push(id);
  // 蛇神威不单独用：一定配着这一局新叫的云或神威
  const ctrl = controllers(g, seat).length;
  if (ok(g, seat, 'hoyau') && already + out.length > 0 && (ctrl >= 2 || (g.isLastRounds(2) && ctrl >= 1))) {
    if (already + out.length >= SAWAYA_AI.maxPerRound) out.pop();
    if (already + out.length < SAWAYA_AI.maxPerRound) out.push('hoyau');
  }
  return out;
}

// 听牌时：瘟神威给谁（不用是 null）
function aiPlague(g: Game, seat: number): number | null {
  if (!ok(g, seat, 'pakoro') || !tenpai(g, seat)) return null;
  const top = leader(g, seat);
  if (top === undefined) return null;
  if (behind(g, seat) <= 0 && !g.isLastRounds(3)) return null;
  return top;
}

// ---------- 起作用 ----------

// 这一局起作用、能帮她和牌的（蛇神威只封人，红云给了别人只是捣乱，不算）
export function sawayaActive(g: Game, seat: number): boolean {
  return activeIds(g, seat).some((id) => id !== 'hoyau' && !(id === 'red' && sawayaRedTarget(g, seat) !== seat));
}

// 电脑打牌时要留的牌（云、神威送来的）和往混一色做的那门花色。没发动是 null
export function sawayaFocus(g: Game, seat: number): { keep: (k: Kind) => boolean; suit: number | null } | null {
  if (!sawayaActive(g, seat)) return null;
  const on = (id: SkillId) => sawayaOn(g, seat, id);
  const nums = g.players[seat].hand.map(kindOf).filter((k) => k < 27);
  const per = [0, 1, 2].map((s) => nums.filter((k) => suitOf(k) === s).length);
  const redSelf = sawayaRedTarget(g, seat) === seat;
  // 海神威做万子、白云做索子、黑云做筒子；只开红云就做手里最多的那门
  const suit = on('akkoro') ? 0 : on('white') ? 2 : on('black') ? 1 : redSelf ? per.indexOf(Math.max(...per)) : null;
  const guest = (k: Kind) => isWind(k) && k !== g.seatWind(seat);
  const keep = (k: Kind) =>
    (suit !== null && (isHonor(k) || suitOf(k) === suit)) ||
    (redSelf && isHonor(k)) ||
    (on('akkoro') && k === CHUN) ||
    (on('huri') && guest(k)) ||
    (on('yellow') && k < 27 && numOf(k) <= 4) ||
    (on('blue') && k < 27 && numOf(k) >= 6);
  return { keep, suit };
}

// 云要的数牌：黄云 1–4、青云 6–9、白云索子、黑云筒子（同时开了几样就都要满足）。字牌不管
function numberWant(g: Game, seat: number): ((k: Kind) => boolean) | null {
  const on = (id: SkillId) => sawayaOn(g, seat, id);
  const range = on('yellow') || on('blue');
  const suits = [on('black') ? 1 : -1, on('white') ? 2 : -1].filter((s) => s >= 0);
  if (!range && !suits.length) return null;
  return (k) =>
    k < 27 && (!range || (on('yellow') && numOf(k) <= 4) || (on('blue') && numOf(k) >= 6)) && (!suits.length || suits.includes(suitOf(k)));
}

// 她自己的摸牌：按起作用的云、神威，有时换成想要的牌
function wants(g: Game, seat: number): ((t: TileId) => boolean)[] {
  const on = (id: SkillId) => sawayaOn(g, seat, id);
  const out: ((t: TileId) => boolean)[] = [];
  const k = (pred: (k: Kind) => boolean) => (t: TileId) => pred(kindOf(t));
  if (on('akkoro') && g.rng.chance(SAWAYA.strongChance)) out.push(k((x) => x < 9 || x === CHUN));
  if (on('huri') && g.rng.chance(SAWAYA.strongChance)) out.push(k((x) => isWind(x) && x !== g.seatWind(seat)));
  if (sawayaRedTarget(g, seat) === seat && g.rng.chance(SAWAYA.drawChance)) out.push(k(isHonor));
  const nw = numberWant(g, seat);
  if (nw && g.rng.chance(SAWAYA.drawChance)) out.push(k(nw));
  return out;
}

// 对这家有用的牌：进张，或者和手里的牌凑得成对子、搭子
function helps(g: Game, seat: number): (t: TileId) => boolean {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const sh = shanten(counts, p.melds.length);
  return (t) => {
    const k = kindOf(t);
    if (counts[k] > 0) return true;
    if (k < 27 && [-2, -1, 1, 2].some((d) => numOf(k) + d >= 1 && numOf(k) + d <= 9 && counts[k + d] > 0)) return true;
    counts[k]++;
    const after = shanten(counts, p.melds.length);
    counts[k]--;
    return after < sh;
  };
}

// 海神威：里宝牌换成她手里最多的那种万子（换第一张里宝牌指示牌）
function seaUra(g: Game, seat: number): void {
  const counts = toCounts(g.players[seat].hand);
  let best = -1;
  for (let k = 0; k < 9; k++) if (counts[k] > 0 && (best < 0 || counts[k] > counts[best])) best = k;
  if (best < 0) return;
  const indicator = best === 0 ? 8 : best - 1;
  g.wall.bringToUra(0, (t) => kindOf(t) === indicator, g.rng);
}

// 她自己的配牌调整好以后定规矩：后动的人换牌时不能让它变差
function sawayaKeep(g: Game, seat: number): void {
  const hand = g.dealHand(seat);
  const nw = numberWant(g, seat);
  if (!nw) return;
  const count = (h: TileId[]) => h.filter((t) => kindOf(t) < 27 && !nw(kindOf(t))).length;
  const done = count(hand);
  g.addDealRule({ seat, ability: 'sawaya', text: '五色云', target: seat, bad: (h) => Math.max(0, count(h) - done) });
}

export const sawayaAbility: Ability = {
  id: 'sawaya',
  name: '五色云·神威',
  description:
    '五色云发牌前选，神威配牌后选（瘟神威听牌时发动），每样一场一次。红云：字牌只流向她或指定一家；黄云/青云：数牌偏 1–4/6–9（2 局）；白云/黑云：偏索子/筒子；瘟神威：指定一家摸到的都是她的和了牌；海神威：万子、红中涌向她，里宝牌变成她的万子；鸟神威：客风牌涌向她（2 局）；蛇神威：封印对手 3 局。',
  priority: PRIORITY.sawaya,

  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    const picks = g.manual[seat] ? gs.picks ?? [] : aiClouds(g, seat);
    gs.picks = undefined;
    gs.plagueTarget = undefined;
    for (const p of picks) {
      const [id, rel] = p.split('@') as [CloudId, string | undefined];
      if (!CLOUDS.includes(id) || !ok(g, seat, id)) continue;
      if (id === 'red') {
        const target = (seat + Number(rel ?? 0)) % 4;
        if (!g.binds(seat, target)) continue;
        gs.redTarget = target;
      }
      start(g, seat, id);
    }
    const rules: DealRule[] = [];
    // 红云：字牌只流向那一家，别人的配牌里不能有字牌
    const red = sawayaRedTarget(g, seat);
    if (red !== null) {
      for (let s = 0; s < 4; s++) {
        if (s !== red) rules.push({ seat, ability: 'sawaya', text: '红云', target: s, bad: (hand) => hand.filter((t) => isHonor(kindOf(t))).length });
      }
    }
    return rules;
  },

  // 配牌：换不过来时降级（她最先动，只顾不了比她后动的人的规矩）
  beforeDeal(g, seat) {
    const w = g.wall;
    const mine = g.dealIndices(seat);
    const later = (j: number) => j >= 52;
    const bring = (i: number, pred: (t: TileId) => boolean) => {
      const swap = () => w.bringToLive(i, pred, g.rng, later);
      return swap() || g.dealFallback(seat, swap);
    };
    const red = sawayaRedTarget(g, seat);
    if (red !== null) {
      for (let s = 0; s < 4; s++) {
        if (s === red) continue;
        for (const i of g.dealIndices(s)) if (isHonor(kindOf(w.live[i]))) bring(i, (t) => !isHonor(kindOf(t)));
      }
    }
    const on = (id: SkillId) => sawayaOn(g, seat, id);
    // 黄云、青云：数牌全换；白云、黑云：不是那门的牌换掉一半（红云给了自己时字牌留着）
    const nw = numberWant(g, seat);
    if (nw) {
      const range = on('yellow') || on('blue');
      const suits = on('white') || on('black');
      for (const i of mine) {
        const k = kindOf(w.live[i]);
        if (k >= 27 ? red === seat || !suits : nw(k)) continue;
        if ((k < 27 && range) || g.rng.chance(0.5)) bring(i, (t) => nw(kindOf(t)));
      }
    }
    sawayaKeep(g, seat);
  },

  // 配完牌：叫神威（瘟神威不在这里，听牌时用技能按钮）
  afterDeal(g, seat) {
    const gs = gameStateOf(g, seat);
    const fresh = activeIds(g, seat).filter((id) => gs.since![id] === g.round).length;
    const picks = g.manual[seat] ? gs.kamuyPicks ?? [] : aiKamuy(g, seat, fresh);
    gs.kamuyPicks = undefined;
    for (const id of picks as KamuyId[]) if (['akkoro', 'huri', 'hoyau'].includes(id) && ok(g, seat, id)) start(g, seat, id);
  },

  // 这一局新叫的出一次字（连着起作用的不再出）
  onRoundStart(g, seat) {
    const gs = gameStateOf(g, seat);
    for (const id of activeIds(g, seat)) {
      if (gs.since![id] !== g.round) continue;
      const to = id === 'red' && gs.redTarget !== seat ? `→${g.players[gs.redTarget!].name}` : '';
      g.emit({ type: 'ability', seat, ability: 'sawaya', text: nameOf(id) + to });
    }
    if (sawayaOn(g, seat, 'akkoro')) seaUra(g, seat);
  },

  seals(g, seat, round) {
    return sawayaOn(g, seat, 'hoyau', round);
  },

  beforeAnyDraw(g, seat, drawer, rinshan) {
    if (drawer === seat || rinshan) return;
    // 电脑的爽：听牌了，看要不要叫瘟神威
    if (!g.manual[seat]) {
      const t = aiPlague(g, seat);
      if (t !== null) sawayaAbility.pressSkill!(g, seat, String(t));
    }
    // 瘟神威：那一家摸到的就是她的和了牌（定成规矩，后动的人也不能换走）
    const waits = sawayaPlagueTarget(g, seat) === drawer ? g.waits(seat) : [];
    const plague = waits.length ? (t: TileId) => !waits.includes(kindOf(t)) : null;
    // 海神威：别人容易摸到用不上的万子
    if (sawayaOn(g, seat, 'akkoro') && g.binds(seat, drawer) && g.rng.chance(SAWAYA.seaJunk)) {
      const good = helps(g, drawer);
      g.wall.bringToLive(0, (t) => kindOf(t) < 9 && !good(t), g.rng);
    }
    const red = sawayaRedTarget(g, seat);
    // 红云给了这一家：塞给他手里没有的字牌
    if (red !== null && drawer === red && !plague) {
      const counts = toCounts(g.players[drawer].hand);
      if (g.rng.chance(SAWAYA.redJunk)) g.wall.bringToLive(0, (t) => isHonor(kindOf(t)) && counts[kindOf(t)] === 0, g.rng);
    }
    const noHonor = red !== null && drawer !== red;
    if (plague && noHonor) return { seat, ability: 'sawaya', text: '瘟神威', deny: (t) => plague(t) || isHonor(kindOf(t)) };
    if (plague) return { seat, ability: 'sawaya', text: '瘟神威', deny: plague };
    if (noHonor) return { seat, ability: 'sawaya', text: '红云', deny: (t) => isHonor(kindOf(t)) };
  },

  beforeDraw(g, seat, rinshan) {
    if (rinshan) return;
    // 红云给了别人：她自己也摸不到字牌
    const red = sawayaRedTarget(g, seat);
    if (red !== null && red !== seat) g.wall.bringToLive(0, (t) => !isHonor(kindOf(t)), g.rng);
    if (sawayaOn(g, seat, 'akkoro')) seaUra(g, seat);
    const good = helps(g, seat);
    for (const want of wants(g, seat)) if (g.wall.bringToLive(0, (t) => want(t) && good(t) && (red === null || red === seat || !isHonor(kindOf(t))), g.rng)) return;
  },

  afterDiscard(g, seat) {
    if (sawayaOn(g, seat, 'akkoro')) seaUra(g, seat);
  },

  // 发牌前：五色云。红云要选给谁（一组里只能选一个）
  preDeal(g, seat): PreDealOption[] {
    const out: PreDealOption[] = [];
    for (const k of SAWAYA_SKILLS.filter((x) => !x.kamuy)) {
      const why = blocked(g, seat, k.id);
      const note = why ?? `一场一次 · ${k.rounds} 局`;
      if (k.id !== 'red') {
        out.push({ id: k.id, name: k.name, desc: k.desc, enabled: why === null, picked: false, note });
        continue;
      }
      for (let rel = 0; rel < 4; rel++) {
        const target = (seat + rel) % 4;
        const reach = g.binds(seat, target);
        const desc = rel === 0 ? '字牌只有她摸得到：别人配牌里没有字牌、也摸不到；她容易摸到用得上的字牌' : `字牌只流向${REL[rel]}（${g.players[target].name}），多是没用的字牌；别人（包括她）摸不到`;
        out.push({ id: rel ? `red@${rel}` : 'red', name: `红云·${REL[rel]}`, desc, enabled: why === null && reach, picked: false, note: why ?? (reach ? note : '管不到'), group: 'red' });
      }
    }
    return out;
  },

  setPreDeal(g, seat, picked) {
    const red = picked.filter((id) => id.startsWith('red'));
    gameStateOf(g, seat).picks = [...picked.filter((id) => CLOUDS.includes(id as CloudId) && id !== 'red'), ...red.slice(0, 1)];
  },

  // 配牌后：神威。瘟神威要听牌，这里只列出来
  postDeal(g, seat): PreDealOption[] {
    return SAWAYA_SKILLS.filter((x) => x.kamuy).map((k) => {
      const why = blocked(g, seat, k.id);
      if (k.id === 'pakoro') return { id: k.id, name: k.name, desc: k.desc, enabled: false, picked: false, note: why ?? '听牌后用技能按钮' };
      return { id: k.id, name: k.name, desc: k.desc, enabled: why === null, picked: false, note: why ?? `一场一次 · ${k.rounds} 局` };
    });
  },

  setPostDeal(g, seat, picked) {
    gameStateOf(g, seat).kamuyPicks = picked.filter((id) => ['akkoro', 'huri', 'hoyau'].includes(id));
  },

  // 瘟神威的按钮：听牌时选给哪一家
  skill(g, seat) {
    const on = activeIds(g, seat);
    const status = on.length ? `起作用：${on.map(nameOf).join('、')}` : '这一局没召唤';
    const plague = sawayaPlagueTarget(g, seat);
    if (plague !== null) return { label: '', note: `${status}（瘟神威→${g.players[plague].name}）`, enabled: false, active: true };
    if (!ok(g, seat, 'pakoro')) return { label: '', note: status, enabled: false, active: on.length > 0 };
    const ready = tenpai(g, seat) && (g.phase === 'turn' || g.phase === 'calls');
    const choices = [1, 2, 3].map((rel) => {
      const t = (seat + rel) % 4;
      return { id: String(t), label: `瘟神威→${REL[rel]}`, enabled: ready && g.binds(seat, t) };
    });
    return { label: '瘟神威', note: ready ? `${status}。指定一家，这一局他摸到的都是你的和了牌` : `${status}。瘟神威听牌后才能发动`, enabled: ready, active: on.length > 0, choices };
  },

  pressSkill(g, seat, choice) {
    const t = Number(choice);
    if (!ok(g, seat, 'pakoro') || !tenpai(g, seat) || !Number.isInteger(t) || t === seat || t < 0 || t > 3 || !g.binds(seat, t)) return;
    start(g, seat, 'pakoro');
    gameStateOf(g, seat).plagueTarget = t;
    g.emit({ type: 'ability', seat, ability: 'sawaya', text: nameOf('pakoro') });
  },

  // 起作用的全列出来
  badge(g, seat) {
    const names = activeIds(g, seat).map(nameOf).join('·');
    return names || null;
  },

  insight(g, seat) {
    const gs = gameStateOf(g, seat);
    const on = activeIds(g, seat).map((id) => {
      const left = gs.until![id]! - g.round;
      return nameOf(id) + (left > 0 ? `（还有 ${left} 局）` : '');
    });
    const ready = SAWAYA_SKILLS.filter((k) => ok(g, seat, k.id)).map((k) => k.name);
    return [on.length ? `起作用：${on.join('、')}` : '这一局没召唤', ready.length ? `还能用：${ready.join('、')}` : '云和神威都用完了'];
  },
};
