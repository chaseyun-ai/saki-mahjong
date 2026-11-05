import type { Game } from '../engine/game';
import { Rng } from '../engine/rng';
import { shanten, waitingKinds } from '../engine/shanten';
import { KIND_COUNT, Kind, TileId, doraFromIndicator, kindLabel, kindOf, toCounts } from '../engine/tiles';
import { isCornerDraw, stackAt } from '../engine/wall';
import { seatCost } from './costs';
import { suzuBurst } from './suzu';
import { teruLadder } from './teru';
import { PRIORITY, type Ability } from './types';

// 大星淡（白糸台）：星空能量，开局 AWAI.energyMax 点，每过一局回复 AWAI.regen 点（不超过上限）。
// 两个被动一直起作用，七个主动技能在牌局里随时按（各扣能量，每样一局一次）。
//
// 被动
// - 时间迟滞：另外三家的配牌 5–6 向听。挡得住别人影响（天使和、哩）或者自己会支配牌山（定配牌规矩、调整牌山、给别人的摸牌定规矩）
//   的人只压到 AWAI.slowShantenWeak 向听。照这样 immune 的人管不到
// - 命运支配：天听，配牌就听牌，但永远不给天和。配牌里有一个暗刻，第四张放在开局后摸牌经过的第 2 个转角前、轮到她摸的位置（锁住）。
//   不坐庄时第一张也不给地和。第一张就立直（双立直）的话：转角之前不让她提前和，摸到第四张暗杠，杠里指示牌指向她杠的牌（四张都是里宝牌），下一张就是和了牌。
//   第一张没立直（或者别人先鸣了牌，双立直不成立）就不留转角暗杠，第四张解锁
//   破法：有人鸣牌，摸牌顺序错开，第四张就轮不到她；被别人的能力挡住和了牌，也和不了
//
// 主动（能量）
// - 星符汇聚（30）：配牌后、打出第一张牌前。之后每次摸牌都是还没凑成对子的字牌，往大七星（东南西北白发中各两张）发展。转角暗杠不留了
// - 高维领域（20）：这一局黑暗笼罩牌桌：别人控牌山的能力失效（Ability.quells），别人摸牌有 AWAI.domainSlow 的概率摸不到进张
// - 退相干（10）：下一次摸牌必定是进张；听牌（或立直）时必定自摸
// - 引力波（10）：听牌后才能按。这一局牌山里她的和了牌都亮出来（只有她看得到），挑立直的时机
// - 平行宇宙（30）：把牌桌换成平行世界的：牌山里没锁住的牌重新洗过，别人锁的牌解开；
//   别人累计的标记全部清空（照的连续和了、漫的计数器、和的计数、小莳的神乐、尧深种下的牌……见 Ability.resetMarks），这一局也不算数
// - 加速驱动（10）：听牌后才能按。这一局另外三家摸的都是她的和了牌（铳牌）；她能摸到的最后一张先留一张和了牌，别人都守住了就海底前自摸
// - 巨引力源（10）：黑色的引力圆和四边牌山的外沿相切，罩住每边中间的几墩（墩的中心在圆里：离正中 AWAI.sourceSpan 墩以内，每边 7 墩）。
//   这一局摸到圆里的牌时：别人控牌山的能力失效，她没听牌时必定摸进有效牌。圆外的牌照常
//
// 电脑的淡：被动照常，听牌就立直（第一张就是双立直）；退相干在有人立直、牌山快见底时用；
// 桌上有强的控场能力、自己没领先时开高维领域或巨引力源；照的连续和了爬到 3 层以上、漫爆发时开平行宇宙；落后很多的最后两局开星符汇聚
// 强度参数（测试和平衡脚本会临时改它们）
export const AWAI = {
  energyMax: 100,
  regen: 5,
  // 时间迟滞：别人的配牌压到几向听（slowShanten 和 slowShanten + 1 各一半）；挡得住、会支配牌山的人只压到 slowShantenWeak
  slowShanten: 5,
  slowShantenWeak: 3,
  // 高维领域：别人这次摸牌摸不到进张的概率
  domainSlow: 0.5,
  // 电脑：落后第一这么多就开星符汇聚（最后两局）
  aiStarsBehind: 24000,
  // 巨引力源罩住每边正中那墩左右各几墩（圆和牌山外沿相切，墩的中心在圆里的：17 墩里的第 6–12 墩）
  sourceSpan: 3,
  // 电脑按不按主动技能（测试别的角色时关掉，免得平行宇宙把他们的标记清掉）
  aiSkills: true,
};

export type AwaiSkillId = 'stars' | 'domain' | 'decohere' | 'wave' | 'parallel' | 'accel' | 'source';

export const AWAI_SKILLS: { id: AwaiSkillId; name: string; cost: number; desc: string }[] = [
  { id: 'stars', name: '星符汇聚', cost: 30, desc: '配牌后、打出第一张牌前：之后摸牌都往大七星（东南西北白发中各两张）走' },
  { id: 'domain', name: '高维领域', cost: 20, desc: '这一局黑暗笼罩牌桌：别人控牌山的能力失效，摸牌也变慢' },
  { id: 'decohere', name: '退相干', cost: 10, desc: '下一次摸牌必定是进张；听牌、立直时必定自摸' },
  { id: 'wave', name: '引力波', cost: 10, desc: '听牌后：牌山里所有和了牌亮出来，挑立直的时机' },
  { id: 'parallel', name: '平行宇宙', cost: 30, desc: '换成平行世界的牌桌：牌山重洗，别人累计的标记全部清空（照的连续和了也是），这一局也不算数' },
  { id: 'accel', name: '加速驱动', cost: 10, desc: '听牌后：另外三家不断摸进你的铳牌；都守住了，最后一张留给你自摸' },
  { id: 'source', name: '巨引力源', cost: 10, desc: '黑色引力圆罩住每边牌山中间的几墩：摸到圆里的牌时别人控制不了，你没听牌时必定摸进有效牌' },
];

const skillOf = (id: string) => AWAI_SKILLS.find((k) => k.id === id);

interface AwaiGameState {
  energy?: number;
  at?: number; // 能量回复算到第几局了
}

interface AwaiState {
  goals?: Record<number, number>; // 时间迟滞：别人的配牌要压到几向听
  tenpaiDeal?: boolean; // 这一局是天听配牌（不给天和）
  kanKind?: Kind; // 暗刻是哪种牌（转角暗杠还有戏时才有）
  corner?: TileId; // 放在转角的第四张
  kanned?: boolean; // 已经暗杠了
  kanUra?: number; // 杠里那张里宝指示牌是第几张（稳乃的雾会把它改走，见 doraControl.mistUra）
  riichiChecked?: boolean; // 第一张打出去了：看过是不是双立直
  used?: AwaiSkillId[]; // 这一局按过的技能
  decohere?: boolean; // 退相干等着下一次摸牌
  last?: TileId; // 加速驱动：留给她最后摸的那张和了牌（锁住）
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as AwaiState;

// 这一局杠里的里宝指示牌是第几张（没杠过是 undefined）
export function awaiKanUra(g: Game, seat: number): number | undefined {
  return stateOf(g, seat).kanUra;
}
const gameStateOf = (g: Game, seat: number) => {
  const gs = g.abilityGameState[seat] as AwaiGameState;
  if (gs.energy === undefined) {
    gs.energy = AWAI.energyMax;
    gs.at = Math.max(1, g.round);
  }
  // 每过一局回复一次
  while ((gs.at ?? 1) < g.round) {
    gs.at = (gs.at ?? 1) + 1;
    gs.energy = Math.min(AWAI.energyMax, gs.energy + AWAI.regen);
  }
  return gs;
};

const on = (g: Game, seat: number, id: AwaiSkillId) => !!stateOf(g, seat).used?.includes(id);

// 现在的能量（界面用）
export function awaiEnergy(g: Game, seat: number): number {
  return gameStateOf(g, seat).energy!;
}

// 转角暗杠还有没有戏：第四张还在牌山里、还没杠（电脑的淡这时不荣和、不拆暗刻）
export function awaiWaitingForCorner(g: Game, seat: number): Kind | null {
  const st = stateOf(g, seat);
  if (st.kanKind === undefined || st.kanned || st.corner === undefined) return null;
  return g.wall.live.includes(st.corner) ? st.kanKind : null;
}

// 不再留转角暗杠：第四张解锁
function dropCorner(g: Game, seat: number): void {
  const st = stateOf(g, seat);
  if (st.corner !== undefined) g.wall.locked.delete(st.corner, 'awai');
  st.corner = undefined;
  st.kanKind = undefined;
}

// 她听的牌：轮到她、手里 14 张时按摸进来之前的 13 张算
function curWaits(g: Game, seat: number): Kind[] {
  const p = g.players[seat];
  if ((p.hand.length + 3 * p.melds.length) % 3 === 2) {
    if (p.drawn === null) return [];
    const rest = p.hand.filter((t) => t !== p.drawn);
    return waitingKinds(toCounts(rest), p.melds.length);
  }
  return g.waits(seat);
}

// 听牌了没有（轮到她、手里 14 张时：打掉一张能听牌也算）
function tenpaiNow(g: Game, seat: number): boolean {
  const p = g.players[seat];
  if ((p.hand.length + 3 * p.melds.length) % 3 === 2) return shanten(toCounts(p.hand), p.melds.length) <= 0;
  return g.waits(seat).length > 0;
}

// ---------- 大七星 ----------

const HONORS = [27, 28, 29, 30, 31, 32, 33];

// 星符汇聚发动了，大七星还在做（没鸣过牌）
export function awaiStarPlan(g: Game, seat: number): boolean {
  return !!g.active(seat) && on(g, seat, 'stars') && g.players[seat].melds.length === 0;
}

// 大七星还缺的字牌
function starNeed(g: Game, seat: number): Set<Kind> {
  const counts = toCounts(g.players[seat].hand);
  return new Set(HONORS.filter((k) => counts[k] < 2));
}

// 大七星用不上的牌（数牌，字牌第三、四张）：电脑的淡先打它们
export function awaiStarsExtra(g: Game, seat: number): TileId[] {
  const seen = new Map<Kind, number>();
  return g.players[seat].hand.filter((t) => {
    const k = kindOf(t);
    if (k < 27) return true;
    seen.set(k, (seen.get(k) ?? 0) + 1);
    return seen.get(k)! > 2;
  });
}

// ---------- 画面用 ----------

// 桌上有没有淡开着高维领域（所有人都看得到黑暗）
export function awaiDomainOn(g: Game): boolean {
  return [0, 1, 2, 3].some((s) => g.abilities[s]?.id === 'awai' && !!g.active(s) && on(g, s, 'domain'));
}

// 巨引力源的引力圆罩不罩得到这一张：正在摸的那一张（岭上牌也算）在每边中间的几墩里。不在摸牌时不算
export function sourceCovers(g: Game): boolean {
  const d = g.drawing;
  if (!d) return false;
  const w = g.wall;
  const sum = g.dice[0] + g.dice[1];
  // 第几墩：牌山从摸牌起点顺时针数；岭上牌从分开处往回数（和 ui3d/wallLayout 的 deadSlot 一样）
  const p = d.rinshan ? 67 - Math.floor((4 - w.rinshan.length) / 2) : Math.floor(w.frontDrawn / 2);
  return Math.abs(stackAt(g.dealer, sum, p).stack - 9) <= AWAI.sourceSpan;
}

// 桌上有没有淡开着巨引力源（所有人都看得到引力圆）
export function awaiSourceOn(g: Game): boolean {
  return [0, 1, 2, 3].some((s) => g.abilities[s]?.id === 'awai' && !!g.active(s) && on(g, s, 'source'));
}

// 引力波：牌山里她的和了牌（只有她自己看得到）
export function awaiWaveTiles(g: Game, seat: number): Set<TileId> {
  if (g.abilities[seat]?.id !== 'awai' || !g.active(seat) || !on(g, seat, 'wave')) return new Set();
  const waits = curWaits(g, seat);
  return new Set(g.wall.live.filter((t) => waits.includes(kindOf(t))));
}

// 引力波：她接下来第几次摸牌会摸到和了牌（假设没人鸣牌）
function waveDraws(g: Game, seat: number): number[] {
  const waits = curWaits(g, seat);
  const out: number[] = [];
  let n = 0;
  g.wall.live.forEach((t, k) => {
    if (g.drawerOf(k) !== seat) return;
    n++;
    if (waits.includes(kindOf(t))) out.push(n);
  });
  return out;
}

// ---------- 双立直的配牌 ----------

// 随机配一手听牌：一个暗刻 + 两个顺子 + 一个对子 + 一个两面搭子。暗杠以后听的牌不能变
// accept：别人对她配牌的规矩也得满足（比如霞绝掉的花色）
function planHand(avail: number[], rng: Rng, accept: (kinds: Kind[]) => boolean): { kinds: Kind[]; kan: Kind } | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    const need = new Array<number>(KIND_COUNT).fill(0);
    const kan = rng.int(KIND_COUNT);
    need[kan] = 4; // 第四张也得在牌山里
    const seq = () => {
      const k = rng.int(3) * 9 + rng.int(7);
      need[k]++;
      need[k + 1]++;
      need[k + 2]++;
    };
    seq();
    seq();
    need[rng.int(KIND_COUNT)] += 2;
    const r = rng.int(3) * 9 + 1 + rng.int(6);
    need[r]++;
    need[r + 1]++;
    if (need.some((n, k) => n > avail[k] || n > 4)) continue;
    const hand = need.slice();
    hand[kan] = 3;
    const waits = waitingKinds(hand, 0);
    if (waits.length === 0 || waits.includes(kan)) continue;
    const afterKan = hand.slice();
    afterKan[kan] = 0;
    if (waitingKinds(afterKan, 1).join() !== waits.join()) continue;
    const kinds: Kind[] = [];
    hand.forEach((n, k) => {
      for (let i = 0; i < n; i++) kinds.push(k);
    });
    if (!accept(kinds)) continue;
    return { kinds, kan };
  }
  return null;
}

// 转角暗杠的位置（live 的下标，配牌前算）：开局后摸牌经过的第 2 个转角前、轮到她摸的那张。
// 要在她立直之后（她至少摸过三次），杠完还得再摸一次；第 2 个转角来不及（太靠近海底）时退到第 1 个转角
function cornerSlot(g: Game, seat: number): number | null {
  const sum = g.dice[0] + g.dice[1];
  const rel = (seat - g.dealer + 4) % 4;
  const corners: number[] = [];
  for (let d = 52; d <= 121; d++) if (isCornerDraw(g.dealer, sum, d)) corners.push(d);
  const near = (d: number) => {
    for (let h = d; h > d - 4; h--) if ((h - 52) % 4 === rel && h >= 52 + 4 * 3 && h + 5 <= 121) return h;
    return null;
  };
  for (const d of [corners[1], corners[0]]) {
    if (d === undefined) continue;
    const h = near(d);
    if (h !== null) return h;
  }
  return null;
}

// 把 kinds 摆到她的配牌位置上：已经是要的牌种就不动，缺的先从发完牌以后的牌山里拿
export function placeHand(g: Game, mine: number[], kinds: Kind[]): boolean {
  const w = g.wall;
  const need = new Array<number>(KIND_COUNT).fill(0);
  for (const k of kinds) need[k]++;
  const todo: number[] = [];
  for (const i of mine) {
    const k = kindOf(w.live[i]);
    if (need[k] > 0) need[k]--;
    else todo.push(i);
  }
  const mineSet = new Set(mine);
  for (const i of todo) {
    const wanted = (t: TileId) => need[kindOf(t)] > 0;
    if (!w.bringToLive(i, wanted, g.rng, (j) => j >= 52) && !w.bringToLive(i, wanted, g.rng, (j) => !mineSet.has(j))) return false;
    need[kindOf(w.live[i])]--;
  }
  return true;
}

// ---------- 时间迟滞 ----------

// 挡得住别人影响，或者自己会支配牌山：时间迟滞对他减弱
function shielded(g: Game, s: number): boolean {
  const a = g.active(s);
  if (!a) return false;
  return !!a.absolute || (a.resist?.(g, s) ?? 0) > 0 || !!(a.dealRules || a.beforeDeal || a.beforeAnyDraw);
}

// 把一家的配牌压到 goal 向听以上。做到了返回 true。
// 别人对这家配牌也有规矩（比如霞绝掉的花色）：先换掉违反规矩的牌，换进来的牌尽量也不违反，后动的人就不用再换
function worsen(g: Game, seat: number, target: number, goal: number): boolean {
  const w = g.wall;
  const idx = g.dealIndices(target);
  const rules = g.dealRules.filter((r) => r.target === target && r.seat !== seat);
  const fits = (t: TileId) => rules.every((r) => r.bad([t]) === 0);
  for (let guard = 0; guard < 100; guard++) {
    const counts = toCounts(idx.map((i) => w.live[i]));
    const sh = shanten(counts);
    if (sh >= goal) {
      // 压够了：再把违反别人规矩的牌换成不违反、向听也不变好的
      const dirty = idx.filter((i) => !fits(w.live[i]));
      const fixed = dirty.some((i) => {
        const old = kindOf(w.live[i]);
        return w.bringToLive(
          i,
          (t) => {
            if (!fits(t)) return false;
            counts[old]--;
            counts[kindOf(t)]++;
            const ok = shanten(counts) >= goal;
            counts[kindOf(t)]--;
            counts[old]++;
            return ok;
          },
          g.rng,
          (j) => j >= 52,
        );
      });
      if (!fixed) return true;
      continue;
    }
    // 换一张：能让向听变差最好；哪张都换不差（几个搭子互相顶替）时，先横着换一张，打散手牌再说
    const swap = (i: number, need: number) => {
      const old = kindOf(w.live[i]);
      return (t: TileId) => {
        if (kindOf(t) === old) return false;
        counts[old]--;
        counts[kindOf(t)]++;
        const ok = shanten(counts) >= need;
        counts[kindOf(t)]--;
        counts[old]++;
        return ok;
      };
    };
    const shuffled = g.rng.shuffle(idx.slice());
    const order = [...shuffled.filter((i) => !fits(w.live[i])), ...shuffled.filter((i) => fits(w.live[i]))];
    const clean = (f: (t: TileId) => boolean) => (t: TileId) => fits(t) && f(t);
    if (order.some((i) => w.bringToLive(i, clean(swap(i, sh + 1)), g.rng, (j) => j >= 52))) continue;
    if (order.some((i) => w.bringToLive(i, swap(i, sh + 1), g.rng, (j) => j >= 52))) continue;
    if (!order.some((i) => w.bringToLive(i, clean(swap(i, sh)), g.rng, (j) => j >= 52)) && !order.some((i) => w.bringToLive(i, swap(i, sh), g.rng, (j) => j >= 52))) return false;
  }
  return shanten(toCounts(idx.map((i) => w.live[i]))) >= goal;
}

// ---------- 摸牌 ----------

// seat 摸到 t 会不会进张（向听变小）
function useful(g: Game, seat: number): (t: TileId) => boolean {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const sh = shanten(counts, p.melds.length);
  return (t) => {
    counts[kindOf(t)]++;
    const after = shanten(counts, p.melds.length);
    counts[kindOf(t)]--;
    return after < sh;
  };
}

// 把她下一张换成符合条件的牌
function bring(g: Game, rinshan: boolean, pred: (t: TileId) => boolean): boolean {
  const w = g.wall;
  return rinshan ? pred(w.rinshan[0]) || w.bringToRinshan(pred, g.rng) : pred(w.live[0]) || w.bringToLive(0, pred, g.rng);
}

// 和了牌：有役的优先（先放进手里试一下），换不出来再随便一张能和的
function bringWin(g: Game, seat: number, rinshan: boolean): boolean {
  const p = g.players[seat];
  const waits = g.waits(seat);
  if (!waits.length || !g.canWin(seat)) return false;
  const wins = (t: TileId) => {
    if (!waits.includes(kindOf(t))) return false;
    p.hand.push(t);
    const prev = g.rinshanDraw;
    g.rinshanDraw = rinshan;
    const ok = !!g.winResult(seat, t, true, g.wall.remaining === 1 && !rinshan);
    g.rinshanDraw = prev;
    p.hand.pop();
    return ok;
  };
  const any = (t: TileId) => waits.includes(kindOf(t));
  // 牌山里没有了就从王牌里找（岭上牌、还没翻的里宝牌指示牌）
  return bring(g, rinshan, wins) || bring(g, rinshan, any) || g.wall.bringFromDead(rinshan, any, g.rng);
}

// 加速驱动：她能摸到的最后一张（从 drawer 摸的 live[0] 起数，假设没人鸣牌）留一张和了牌，锁住
function keepLast(g: Game, seat: number, drawer: number): void {
  const st = stateOf(g, seat);
  const w = g.wall;
  const waits = g.waits(seat);
  if (!waits.length) return;
  let k = -1;
  for (let i = w.live.length - 1; i >= 0; i--) {
    if ((drawer + i) % 4 === seat) {
      k = i;
      break;
    }
  }
  if (st.last !== undefined) {
    if (k >= 0 && w.live[k] === st.last && waits.includes(kindOf(st.last))) return;
    w.locked.delete(st.last, 'awai');
    st.last = undefined;
  }
  if (k > 0 && w.bringToLive(k, (t) => waits.includes(kindOf(t)), g.rng)) {
    st.last = w.live[k];
    w.locked.add(st.last, 'awai');
  }
}

// ---------- 主动技能 ----------

// 这一局现在能不能按 id
export function awaiCanUse(g: Game, seat: number, id: AwaiSkillId): boolean {
  const k = skillOf(id);
  if (!k || !g.active(seat) || (g.phase !== 'turn' && g.phase !== 'calls')) return false;
  if (on(g, seat, id) || awaiEnergy(g, seat) < k.cost) return false;
  const p = g.players[seat];
  if (id === 'stars') return p.discards.length === 0 && p.melds.length === 0;
  if (id === 'wave' || id === 'accel') return tenpaiNow(g, seat);
  return true;
}

// 平行宇宙：没锁住的牌山重新洗过，别人锁的牌解开；别人累计的标记清空
function parallel(g: Game, seat: number): void {
  const w = g.wall;
  for (const t of [...w.locked]) for (const o of w.locked.ownersOf(t)) if (o !== 'awai') w.locked.delete(t, o);
  const idx = w.live.map((_, i) => i).filter((i) => !w.locked.has(w.live[i]));
  const tiles = g.rng.shuffle(idx.map((i) => w.live[i]));
  idx.forEach((i, j) => (w.live[i] = tiles[j]));
  for (let s = 0; s < 4; s++) if (s !== seat) g.abilities[s]?.resetMarks?.(g, s);
}

function use(g: Game, seat: number, id: AwaiSkillId): void {
  const st = stateOf(g, seat);
  const gs = gameStateOf(g, seat);
  gs.energy! -= skillOf(id)!.cost;
  st.used = [...(st.used ?? []), id];
  if (id === 'stars') dropCorner(g, seat);
  if (id === 'decohere') st.decohere = true;
  if (id === 'parallel') parallel(g, seat);
  g.emit({ type: 'ability', seat, ability: 'awai', text: skillOf(id)!.name });
}

function behind(g: Game, seat: number): number {
  return Math.max(...g.players.filter((p) => p.seat !== seat).map((p) => p.score)) - g.players[seat].score;
}

// 桌上有强的控场能力（3 费以上、会动别人的牌或者封住别人）
function strongControl(g: Game, seat: number): boolean {
  return [0, 1, 2, 3].some((o) => {
    const a = g.active(o);
    return o !== seat && !!a && !a.absolute && seatCost(g, o) >= 3 && !!(a.beforeAnyDraw || a.dealRules || a.forbidsWin || a.seals);
  });
}

// 别人累计的标记涨得很危险：照的连续和了 3 层以上、漫在爆发
function marksDanger(g: Game, seat: number): boolean {
  return [0, 1, 2, 3].some((o) => {
    if (o === seat || !g.active(o)) return false;
    const id = g.abilities[o]!.id;
    if (id === 'teru') return teruLadder(g, o).level >= 3;
    if (id === 'suzu') return suzuBurst(g, o) === 'full';
    return false;
  });
}

// 电脑的淡：自己摸牌前决定按什么
function aiPress(g: Game, seat: number): void {
  if (!AWAI.aiSkills) return;
  const p = g.players[seat];
  const try_ = (id: AwaiSkillId) => awaiCanUse(g, seat, id) && (use(g, seat, id), true);
  if (marksDanger(g, seat)) try_('parallel');
  if (p.discards.length === 0 && g.isLastRounds(2) && behind(g, seat) >= AWAI.aiStarsBehind) try_('stars');
  if (behind(g, seat) > 0 && strongControl(g, seat) && !on(g, seat, 'source')) try_('domain');
  if (!tenpaiNow(g, seat) && !on(g, seat, 'domain') && strongControl(g, seat) && awaiEnergy(g, seat) >= 40) try_('source');
  const threat = g.players.some((q) => q.seat !== seat && q.riichi && g.seesRiichi(q.seat, seat));
  if (g.waits(seat).length && awaiWaitingForCorner(g, seat) === null && !stateOf(g, seat).decohere && (threat || g.wall.remaining < 30)) try_('decohere');
}

// ---------- 能力 ----------

export const awaiAbility: Ability = {
  id: 'awai',
  name: '星空',
  description: `星空能量开局 ${AWAI.energyMax} 点，每局回复 ${AWAI.regen} 点。被动：时间迟滞（别人配牌 5–6 向听，挡得住或会支配牌山的人减弱）、命运支配（天听但永远不天和；双立直的话在第 2 个转角前暗杠，杠里四张都是里宝牌，下一张自摸）。主动：星符汇聚 30、高维领域 20、退相干 10、引力波 10、平行宇宙 30、加速驱动 10、巨引力源 10（罩住每边牌山中间 7 墩）。`,
  priority: PRIORITY.awai,

  // 时间迟滞定规矩：另外三家的配牌至少 5–6 向听（减弱的人 3 向听）
  dealRules(g, seat) {
    gameStateOf(g, seat);
    const s = stateOf(g, seat);
    s.goals = {};
    for (let o = 0; o < 4; o++) {
      if (o === seat) continue;
      s.goals[o] = g.active(o)?.lagShanten ?? (shielded(g, o) ? AWAI.slowShantenWeak : AWAI.slowShanten + (g.rng.chance(0.5) ? 1 : 0));
    }
    return [0, 1, 2, 3]
      .filter((o) => o !== seat)
      .map((o) => ({ seat, ability: 'awai', text: '时间迟滞', target: o, bad: (hand: TileId[]) => Math.max(0, s.goals![o] - shanten(toCounts(hand))) }));
  },

  // 能量条和七个主动技能
  skill(g, seat) {
    const s = stateOf(g, seat);
    const p = g.players[seat];
    const lines: string[] = [];
    if (s.tenpaiDeal && !s.riichiChecked && !on(g, seat, 'stars')) lines.push('天听：第一张就立直（双立直）会在第 2 个转角暗杠、下一张自摸');
    else if (awaiWaitingForCorner(g, seat) !== null) lines.push(`等第 2 个转角暗杠：${kindLabel(s.kanKind!)}`);
    if (awaiStarPlan(g, seat)) {
      const need = [...starNeed(g, seat)];
      lines.push(need.length ? `大七星还差：${need.map(kindLabel).join(' ')}` : '大七星凑齐了');
    }
    if (on(g, seat, 'domain')) lines.push('高维领域展开中');
    if (on(g, seat, 'source')) lines.push('巨引力源罩住了每边牌山中间的几墩');
    if (s.decohere) lines.push('退相干：下一次摸牌');
    if (on(g, seat, 'accel')) lines.push('加速驱动中');
    if (on(g, seat, 'wave')) {
      const n = awaiWaveTiles(g, seat).size;
      const draws = waveDraws(g, seat);
      lines.push(`引力波：牌山里还有 ${n} 张和了牌${draws.length ? `，你接下来第 ${draws.slice(0, 4).join('、')} 次摸牌会摸到` : '，轮到你摸的位置一张都没有'}`);
    }
    const playing = g.phase === 'turn' || g.phase === 'calls';
    const choices = AWAI_SKILLS.map((k) => ({ id: k.id, label: `${k.name} ${k.cost}`, enabled: awaiCanUse(g, seat, k.id) }));
    const note = lines.length ? lines.join('；') : p.riichi ? '立直中' : '技能每样一局一次';
    return { label: '星空', note, enabled: playing, meter: { value: awaiEnergy(g, seat), max: AWAI.energyMax }, active: (s.used?.length ?? 0) > 0, choices };
  },

  pressSkill(g, seat, choice) {
    const id = choice as AwaiSkillId;
    if (!awaiCanUse(g, seat, id)) return;
    use(g, seat, id);
  },

  // 高维领域：整局；巨引力源：只管摸到引力圆里的那几张
  quells(g, seat) {
    return on(g, seat, 'domain') || (on(g, seat, 'source') && sourceCovers(g));
  },

  badge(g, seat) {
    const names = (stateOf(g, seat).used ?? []).filter((id) => id === 'domain' || id === 'source' || id === 'stars').map((id) => skillOf(id)!.name);
    return names.length ? names.join('·') : null;
  },

  insight(g, seat) {
    const s = stateOf(g, seat);
    const used = (s.used ?? []).map((id) => skillOf(id)!.name);
    const out = [`星空能量 ${awaiEnergy(g, seat)}/${AWAI.energyMax}`, used.length ? `这一局：${used.join('、')}` : '这一局还没按主动技能'];
    if (awaiWaitingForCorner(g, seat) !== null) out.push(`等转角暗杠：${kindLabel(s.kanKind!)}`);
    return out;
  },

  beforeDeal(g, seat) {
    const w = g.wall;
    const s = stateOf(g, seat);
    const mine = g.dealIndices(seat);
    const mineSet = new Set(mine);
    // 命运支配：双立直的配牌。先找一手满足别人规矩的（规矩只看牌种，所以拿每种牌里的一张代表来算）
    const others = g.dealRules.filter((r) => r.target === seat && r.seat !== seat);
    // 只数单拿一张也不违反别人规矩的牌（比如玄在场时赤五不算：同种的普通牌够了才行）
    const avail = toCounts(w.live.filter((t) => others.every((r) => r.bad([t]) === 0)));
    let plan = planHand(avail, g.rng, (kinds) => others.every((r) => r.bad(kinds.map((k) => k * 4 + 1)) === 0));
    // 无解时降级：不顾比她后动的人的规矩，换牌也一样
    if (!plan) plan = planHand(toCounts(w.live), g.rng, () => true);
    if (plan) {
      const placed = placeHand(g, mine, plan.kinds) || g.dealFallback(seat, () => placeHand(g, mine, plan!.kinds));
      if (placed) {
        s.tenpaiDeal = true;
        s.kanKind = plan.kan;
        const want = [...plan.kinds].sort((a, b) => a - b).join();
        g.addDealRule({ seat, ability: 'awai', text: '天听配牌', target: seat, bad: (hand) => ([...hand].map(kindOf).sort((a, b) => a - b).join() === want ? 0 : 1) });
        // 第四张放在第 2 个转角前她摸的位置，锁住
        const slot = cornerSlot(g, seat);
        const kan = plan.kan;
        const isKan = (t: TileId) => kindOf(t) === kan;
        if (slot !== null && (w.bringToLive(slot, isKan, g.rng, (j) => j >= 52) || w.bringToLive(slot, isKan, g.rng, (j) => !mineSet.has(j)))) {
          s.corner = w.live[slot];
          w.locked.add(s.corner, 'awai');
        }
        // 杠里要用的指示牌先藏在后面的里宝牌里：开局时牌山里一定还有，等到转角时可能早被摸光了
        const indicator = (t: TileId) => doraFromIndicator(kindOf(t)) === kan;
        w.bringToUra(1, indicator, g.rng, (j) => j >= 52);
        w.bringToUra(2, indicator, g.rng, (j) => j >= 52);
      }
    }
    // 时间迟滞：把别人配牌里有用的牌换成没用的，换到发完牌以后的牌山里。别人的规矩（比如霞绝掉的花色）不能变差；
    // 这样打不到时降级，不顾比她后动的人的规矩
    for (let o = 0; o < 4; o++) {
      if (o === seat) continue;
      const goal = s.goals?.[o] ?? AWAI.slowShanten;
      if (!worsen(g, seat, o, goal)) g.dealFallback(seat, () => worsen(g, seat, o, goal));
    }
  },

  noTenhou(g, seat) {
    return !!stateOf(g, seat).tenpaiDeal;
  },

  onRoundStart(g, seat) {
    g.emit({ type: 'ability', seat, ability: 'awai', text: '时间迟滞' });
    if (stateOf(g, seat).tenpaiDeal) g.emit({ type: 'ability', seat, ability: 'awai', text: '天听' });
  },

  // 别人摸牌：加速驱动让他们摸进她的铳牌；高维领域让他们摸不到进张
  beforeAnyDraw(g, seat, drawer, rinshan) {
    const accel = on(g, seat, 'accel') && g.waits(seat).length > 0 && g.canWin(seat);
    if (accel && !rinshan) keepLast(g, seat, drawer);
    if (drawer === seat) {
      // 命运支配：第一张不给天和（不坐庄时是地和）。定成规矩，后面对账换牌时也不会换来和了牌
      const p = g.players[seat];
      if (!rinshan && stateOf(g, seat).tenpaiDeal && g.noCallsYet && p.discards.length === 0) {
        const waits = g.waits(seat);
        if (waits.length) return { seat, ability: 'awai', text: '命运支配', deny: (t: TileId) => waits.includes(kindOf(t)) };
      }
      return;
    }
    if (accel) {
      const waits = g.waits(seat);
      return { seat, ability: 'awai', text: '加速驱动', deny: (t: TileId) => !waits.includes(kindOf(t)) };
    }
    if (on(g, seat, 'domain') && g.rng.chance(AWAI.domainSlow)) return { seat, ability: 'awai', text: '高维领域', deny: useful(g, drawer) };
  },

  beforeDraw(g, seat, rinshan) {
    const s = stateOf(g, seat);
    if (!g.manual[seat]) aiPress(g, seat);
    const waits = g.waits(seat);
    // 退相干：下一次摸牌必定进张，听牌时必定自摸
    if (s.decohere) {
      s.decohere = false;
      const ok = waits.length ? bringWin(g, seat, rinshan) : bring(g, rinshan, useful(g, seat));
      if (ok) g.emit({ type: 'ability', seat, ability: 'awai', text: waits.length ? '退相干·自摸' : '退相干' });
      return;
    }
    // 星符汇聚：摸还没凑成对子的字牌
    if (awaiStarPlan(g, seat)) {
      const need = starNeed(g, seat);
      if (need.size && waits.length === 0) {
        bring(g, rinshan, (t) => need.has(kindOf(t)));
        return;
      }
    }
    // 巨引力源：摸到引力圆里的牌、没听牌时必定是进张
    if (on(g, seat, 'source') && waits.length === 0 && sourceCovers(g)) {
      bring(g, rinshan, useful(g, seat));
      return;
    }
    if (rinshan || s.kanKind === undefined || waits.length === 0) return;
    if (s.kanned) {
      // 杠完下一张就是和了牌
      if (g.wall.bringToLive(0, (t) => waits.includes(kindOf(t)), g.rng)) {
        s.kanKind = undefined;
        g.emit({ type: 'ability', seat, ability: 'awai', text: '杠里' });
      }
      return;
    }
    // 转角之前不提前和
    if (awaiWaitingForCorner(g, seat) !== null) g.wall.bringToLive(0, (t) => !waits.includes(kindOf(t)), g.rng);
  },

  afterDraw(g, seat) {
    const s = stateOf(g, seat);
    if (!g.rinshanDraw || s.kanned || s.kanKind === undefined) return;
    const m = g.players[seat].melds.at(-1);
    if (m?.type !== 'ankan' || kindOf(m.tiles[0]) !== s.kanKind) return;
    s.kanned = true;
    // 杠以后翻的那张宝牌下面的里宝牌，指向她杠的牌
    const kan = s.kanKind;
    s.kanUra = g.wall.doraRevealed - 1;
    g.wall.bringToUra(s.kanUra, (t) => doraFromIndicator(kindOf(t)) === kan, g.rng);
  },

  // 第一张打出去：不是双立直就不留转角暗杠
  afterDiscard(g, seat) {
    const s = stateOf(g, seat);
    if (s.riichiChecked) return;
    s.riichiChecked = true;
    const p = g.players[seat];
    if (!(p.riichiPending && p.doubleRiichi)) dropCorner(g, seat);
  },
};
