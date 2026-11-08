import type { Game } from '../engine/game';
import { GbInput, GbMeld, GbResult, gbFan } from '../engine/gbFan';
import { evaluateWin, type Meld } from '../engine/score';
import { shanten, waitingKinds } from '../engine/shanten';
import { EAST, KIND_COUNT, Kind, TileId, kindLabel, kindOf, toCounts } from '../engine/tiles';
import { GbSet, GbTarget, TargetFit, fitTarget, pickScore, rankTargets, targetByKey, topFamilies } from './gbTargets';
import type { Ability, PreDealOption, SkillButton } from './types';

// 郝慧宇（临海）：国标。她的运气是国标的运气。
// - 配完牌挑一个国标番种（gbTargets.ts 的牌库，偏向日麻里不是役的）：玩家从分数最高的三张番种牌里挑，或者不做；电脑拿最高的
// - 配牌：番种用不到的 2 张换成牌山后面番种要的牌
// - 进张：下一张不是番种要的牌时，有 HUIYU.luck 的概率换一张要的过来；听牌以后只送国标够 8 番的和了牌
// - 截张：别人立直以后，她摸牌前有 HUIYU.snipe 的概率把一张立直家的和了牌换到自己这一巡摸，一局最多两张（电脑扣着不打）
// - 八番起和：牌山还多于 24 张时，国标不到 8 番的和牌她和不了（玩家、电脑都一样，被封印也一样）
// - 她不立直。玩家按了立直，这一局能力停掉：不送牌、不截张、八番起和解除
// 做不成的番种（要的牌都见光了）自动换成分数最高的；玩家可以用技能按钮「换番种」，换了以后下一次摸牌不送牌
export const HUIYU = {
  dealSwaps: 2, // 配牌换几张
  // 进张、截张的概率：方案里是 15%、25%，整场跑下来偏强（对无能力平均顺位 2.13、对随机 2.61），
  // 调到 12%、15% 以后是 2.32、2.77（各 300 场），落在 2 费的目标（2.25–2.35、2.70–2.80）里
  luck: 0.12, // 进张送牌的概率
  snipe: 0.15, // 截张的概率
  snipeMax: 2, // 一局最多截几张
  minFan: 8, // 八番起和
  freeAt: 24, // 牌山剩这么多张以下放开八番起和
  cards: 3, // 配牌后给玩家挑几张番种牌
};

interface RoundState {
  key?: string | null; // 现在做的番种（GbTarget.key）；null 是不做；undefined 是还没挑
  cards?: string[]; // 配牌后给玩家的番种牌
  noLuck?: number; // 接下来几次摸牌不送牌（换了番种）
  sniped?: TileId[]; // 截来的牌
  done?: boolean; // 这一局已经“成”过（听牌且够 8 番）
  bubble?: boolean; // 这一局已经冒过“日麻无役”的气泡
  flips?: number; // 换过几次番种（界面上番种栏翻面）
  cache?: { sig: string; fit: TargetFit | null };
  ranked?: { sig: string; list: TargetFit[] };
  won?: GbResult; // 这一局她和了：国标算出来的番（结算面板用）
}

const roundOf = (g: Game, seat: number) => g.abilityState[seat] as RoundState;

const isHuiyu = (g: Game, seat: number) => g.abilities[seat]?.id === 'huiyu';

// 立直了：这一局国标停掉
export function huiyuOff(g: Game, seat: number): boolean {
  const p = g.players[seat];
  return p.riichi || p.riichiPending;
}

// 八番起和这一刻管不管用
export function huiyuMinFanOn(g: Game, seat: number): boolean {
  return isHuiyu(g, seat) && !huiyuOff(g, seat) && g.wall.remaining > HUIYU.freeAt;
}

// ---------- 国标算番 ----------

const meldOf = (m: Meld): GbMeld => ({
  type: m.type === 'chi' ? 'chi' : m.type === 'pon' ? 'pon' : m.type === 'ankan' ? 'ankan' : 'minkan',
  kind: Math.min(...m.tiles.map(kindOf)),
});

const setOf = (m: Meld): GbSet => ({ pung: m.type !== 'chi', kind: Math.min(...m.tiles.map(kindOf)) });

// seat 看得见的牌（自己的手牌、所有副露、看得见的牌河、宝牌指示牌）
function seenBy(g: Game, seat: number): number[] {
  const c = new Array<number>(KIND_COUNT).fill(0);
  for (const t of g.players[seat].hand) c[kindOf(t)]++;
  for (const p of g.players) {
    p.melds.forEach((m) => m.tiles.forEach((t) => c[kindOf(t)]++));
    if (g.stealthed(p.seat, seat)) continue;
    p.discards.forEach((d) => !d.called && c[kindOf(d.tile)]++);
  }
  g.wall.visibleDoraIndicators().forEach((t) => c[kindOf(t)]++);
  return c;
}

// 和 closed（门内的牌，含和了牌 win）的国标番。kong：自摸是岭上、荣和是抢杠
export function huiyuGb(g: Game, seat: number, closed: readonly Kind[], win: Kind, tsumo: boolean, kong = false): GbResult | null {
  const p = g.players[seat];
  // 和绝张：和了牌另外三张都亮出来了（荣和的那张自己在牌河里，不算）
  const seen = seenBy(g, seat);
  const own = closed.filter((k) => k === win).length;
  let shown = seen[win] - p.hand.filter((t) => kindOf(t) === win).length;
  if (!tsumo && g.lastDiscard && kindOf(g.lastDiscard.tile) === win && g.callKind === 'discard') shown--;
  const inp: GbInput = {
    hand: closed,
    melds: p.melds.map(meldOf),
    win,
    tsumo,
    fourth: own === 1 && shown >= 3,
    kong,
    last: g.wall.remaining === 0,
    seat: g.seatWind(seat) - EAST,
    round: g.roundWind,
  };
  return gbFan(inp);
}

// 她用 tile 和牌的国标番（自摸时 tile 已经在手里也行）
export function huiyuWinFan(g: Game, seat: number, tile: TileId, tsumo: boolean): GbResult | null {
  const p = g.players[seat];
  const kinds = p.hand.map(kindOf);
  const n = p.hand.length + 3 * p.melds.length;
  const closed = n % 3 === 2 ? kinds : [...kinds, kindOf(tile)];
  const kong = tsumo ? g.rinshanDraw : g.callKind === 'chankan';
  return huiyuGb(g, seat, closed, kindOf(tile), tsumo, kong);
}

// 听牌时每种和了牌自摸的国标番（13 张的时候算）。没听牌是空的
export function huiyuWaitFans(g: Game, seat: number, hand: readonly TileId[] = g.players[seat].hand): Map<Kind, number> {
  const p = g.players[seat];
  const out = new Map<Kind, number>();
  if ((hand.length + 3 * p.melds.length) % 3 !== 1) return out;
  const counts = toCounts(hand);
  const kinds = hand.map(kindOf);
  for (const w of waitingKinds(counts, p.melds.length)) out.set(w, huiyuGb(g, seat, [...kinds, w], w, true)?.total ?? 0);
  return out;
}

// ---------- 番种 ----------

function capOf(g: Game, seat: number): number[] {
  const seen = seenBy(g, seat);
  const hand = toCounts(g.players[seat].hand);
  return seen.map((s, k) => hand[k] + 4 - s);
}

function fitOf(g: Game, seat: number, t: GbTarget, hand: readonly TileId[] = g.players[seat].hand): TargetFit | null {
  return fitTarget(t, toCounts(hand), g.players[seat].melds.map(setOf), capOf(g, seat));
}

// 手牌、副露、看得见的牌没变就不重算
function sigOf(g: Game, seat: number): string {
  const p = g.players[seat];
  return `${p.hand.join(',')}|${p.melds.length}|${g.players.map((x) => x.discards.length).join(',')}|${g.wall.doraRevealed}`;
}

export function huiyuRank(g: Game, seat: number): TargetFit[] {
  const st = roundOf(g, seat);
  const sig = sigOf(g, seat);
  if (st.ranked?.sig === sig) return st.ranked.list;
  const list = rankTargets(toCounts(g.players[seat].hand), g.players[seat].melds.map(setOf), capOf(g, seat), HUIYU.cards + 1);
  st.ranked = { sig, list };
  return list;
}

// 现在做的番种（不看封印、立直）
export function huiyuTarget(g: Game, seat: number): GbTarget | null {
  if (!isHuiyu(g, seat)) return null;
  const key = roundOf(g, seat).key;
  return key ? targetByKey(key) ?? null : null;
}

// 现在做的番种做到哪一步了。只读，不换番种（界面用）；做不成了是 null
export function huiyuFit(g: Game, seat: number): TargetFit | null {
  const t = huiyuTarget(g, seat);
  if (!t) return null;
  const st = roundOf(g, seat);
  const sig = `${t.key}|${sigOf(g, seat)}`;
  if (st.cache?.sig === sig) return st.cache.fit;
  const fit = fitOf(g, seat, t);
  st.cache = { sig, fit };
  return fit;
}

function setTarget(g: Game, seat: number, key: string | null, why: string | null): void {
  const st = roundOf(g, seat);
  if (st.key === key) return;
  const had = st.key !== undefined;
  st.key = key;
  st.cache = undefined;
  if (had) st.flips = (st.flips ?? 0) + 1;
  const t = key ? targetByKey(key) : null;
  if (why && t) g.emit({ type: 'ability', seat, ability: 'huiyu', text: why });
}

// 番种做不成了（或者还没挑）：换成现在分数最高的。玩家选了不做就不管
function refresh(g: Game, seat: number): TargetFit | null {
  const st = roundOf(g, seat);
  if (st.key === null) return null;
  const cur = st.key ? huiyuFit(g, seat) : null;
  if (cur) return cur;
  const best = huiyuRank(g, seat)[0];
  if (!best) return null;
  // 玩家的番种栏翻面时出字；电脑悄悄换（不然别人看得出她的番种做不成了）
  setTarget(g, seat, best.target.key, st.key === undefined || !g.manual[seat] ? null : '换番种');
  return huiyuFit(g, seat);
}

// 电脑：有分数更高的番种就换（一样高不换，免得来回跳）
function aiRepick(g: Game, seat: number): TargetFit | null {
  const cur = refresh(g, seat);
  const best = huiyuRank(g, seat)[0];
  if (best && (!cur || pickScore(best) > pickScore(cur))) {
    setTarget(g, seat, best.target.key, null);
    return huiyuFit(g, seat);
  }
  return cur;
}

// 电脑照着打的番种：做哪个、手里哪些牌用不到（先打这些）。立直了、不做番种时是 null
export interface HuiyuPlan {
  fit: TargetFit;
  extra: TileId[];
  sniped: TileId[]; // 截来的牌：扣着不打
}

// repick：电脑看看有没有分数更高的番种（别人打牌时问鸣不鸣不用换）
export function huiyuPlan(g: Game, seat: number, repick = true): HuiyuPlan | null {
  if (!isHuiyu(g, seat) || huiyuOff(g, seat)) return null;
  const fit = g.manual[seat] || !repick ? refresh(g, seat) : aiRepick(g, seat);
  if (!fit) return null;
  const want = new Array<number>(KIND_COUNT).fill(0);
  for (const k of fit.tiles) want[k]++;
  const extra: TileId[] = [];
  for (const t of g.players[seat].hand) {
    if (want[kindOf(t)] > 0) want[kindOf(t)]--;
    else extra.push(t);
  }
  const hand = new Set(g.players[seat].hand);
  return { fit, extra, sniped: (roundOf(g, seat).sniped ?? []).filter((t) => hand.has(t)) };
}

// 打掉 t 以后离番种还差几张（电脑挑打哪张用）
export function huiyuMissingAfter(g: Game, seat: number, plan: HuiyuPlan, t: TileId): number {
  const hand = g.players[seat].hand.filter((x) => x !== t);
  return fitOf(g, seat, plan.fit.target, hand)?.missing ?? 99;
}

// 电脑鸣不鸣：鸣了以后离番种更近，而且做成了日麻里还有役（不然和不了）
export function huiyuCallOk(g: Game, seat: number, plan: HuiyuPlan, used: TileId[], called: TileId, type: Meld['type']): boolean {
  const p = g.players[seat];
  const hand = p.hand.filter((t) => !used.includes(t));
  const meld: Meld = { type, tiles: [...used, called], calledTile: called };
  const melds = [...p.melds, meld];
  // 鸣出去的牌离开门内：门内最多能有的张数跟着少（鸣的那张本来就见光了）
  const cap = capOf(g, seat);
  for (const t of used) cap[kindOf(t)]--;
  const after = fitTarget(plan.fit.target, toCounts(hand), melds.map(setOf), cap);
  // 鸣的那组得是番种用得上的：鸣完差的张数比现在少
  if (!after || after.missing >= plan.fit.missing) return false;
  const closed: TileId[] = [];
  const used2 = new Array<number>(KIND_COUNT).fill(0);
  for (const k of after.tiles) closed.push(k * 4 + 1 + (used2[k]++ % 3));
  const r = evaluateWin({
    closed,
    melds,
    kuitan: g.rules.kuitan,
    winTile: closed[closed.length - 1],
    tsumo: false,
    seatWind: g.seatWind(seat),
    roundWind: EAST + g.roundWind,
    isDealer: seat === g.dealer,
    doraIndicators: [],
  });
  return !!g.minHanOk(r);
}

// ---------- 番种牌（界面） ----------

export interface HuiyuCard {
  key: string;
  name: string;
  missing: number;
  tiles: Kind[];
  lit: boolean[];
  gb: number; // 做成了国标约几番（门清自摸）
  points: number; // 日麻约几点（门清自摸、不算宝牌）
  ronOk: boolean; // 日麻里荣和有没有役
}

export function huiyuCard(g: Game, seat: number, fit: TargetFit): HuiyuCard {
  const closed = fit.tiles;
  const win = fit.lack[0] ?? closed[closed.length - 1];
  const gb = huiyuGb(g, seat, closed, win, true)?.total ?? fit.target.fan;
  const ids: TileId[] = [];
  const used = new Array<number>(KIND_COUNT).fill(0);
  for (const k of closed) ids.push(k * 4 + 1 + (used[k]++ % 3));
  const winTile = ids[closed.lastIndexOf(win)];
  const base = {
    closed: ids,
    melds: g.players[seat].melds,
    kuitan: g.rules.kuitan,
    winTile,
    seatWind: g.seatWind(seat),
    roundWind: EAST + g.roundWind,
    isDealer: seat === g.dealer,
    doraIndicators: [] as Kind[],
  };
  const tsumo = g.minHanOk(evaluateWin({ ...base, tsumo: true }));
  const ron = g.minHanOk(evaluateWin({ ...base, tsumo: false }));
  const points = tsumo ? (seat === g.dealer ? tsumo.tsumoOtherPays * 3 : tsumo.tsumoDealerPays + 2 * tsumo.tsumoOtherPays) : 0;
  return { key: fit.target.key, name: fit.target.name, missing: fit.missing, tiles: fit.tiles, lit: fit.lit, gb, points, ronOk: !!ron };
}

// 配牌后给玩家的番种牌（每个番种只留最好的一个）
export function huiyuCards(g: Game, seat: number): HuiyuCard[] {
  const st = roundOf(g, seat);
  const fits = topFamilies(huiyuRank(g, seat), HUIYU.cards);
  st.cards = fits.map((f) => f.target.key);
  return fits.map((f) => huiyuCard(g, seat, f));
}

// 现在做的番种在界面上怎么画（番种栏）
export function huiyuBar(g: Game, seat: number): { card: HuiyuCard; off: boolean; flips: number } | null {
  const fit = huiyuFit(g, seat);
  if (!fit) return null;
  return { card: huiyuCard(g, seat, fit), off: huiyuOff(g, seat) || g.isSealed(seat), flips: roundOf(g, seat).flips ?? 0 };
}

// 听牌而且国标够 8 番（“成”）
export function huiyuReady(g: Game, seat: number): boolean {
  if (!isHuiyu(g, seat) || huiyuOff(g, seat)) return false;
  return [...huiyuWaitFans(g, seat).values()].some((f) => f >= HUIYU.minFan);
}

// 别人打出 tile：她和得了、国标够 8 番，日麻里却没役荣和不了（气泡用）。返回国标番数
export function huiyuMissedRon(g: Game, seat: number, from: number, tile: TileId): number | null {
  if (!isHuiyu(g, seat) || from === seat || huiyuOff(g, seat)) return null;
  const p = g.players[seat];
  if ((p.hand.length + 3 * p.melds.length) % 3 !== 1) return null;
  const counts = toCounts(p.hand);
  counts[kindOf(tile)]++;
  if (shanten(counts, p.melds.length) !== -1 || g.isFuriten(seat)) return null;
  if (g.winResult(seat, tile, false)) return null;
  const fan = huiyuWinFan(g, seat, tile, false)?.total ?? 0;
  return fan >= HUIYU.minFan ? fan : null;
}

// 这一局她和牌的国标番（结算面板、和牌切入用）。没和是 null
export function huiyuWinGb(g: Game, seat: number): GbResult | null {
  return isHuiyu(g, seat) ? roundOf(g, seat).won ?? null : null;
}

// ---------- 运气 ----------

// 截张：别人立直以后，把一张立直家的和了牌换到自己这一巡摸
function snipe(g: Game, seat: number): boolean {
  const st = roundOf(g, seat);
  if ((st.sniped?.length ?? 0) >= HUIYU.snipeMax) return false;
  const waits = new Set<Kind>();
  for (let o = 0; o < 4; o++) if (o !== seat && g.players[o].riichi && g.seesRiichi(o, seat)) g.waits(o).forEach((k) => waits.add(k));
  if (!waits.size || waits.has(kindOf(g.wall.live[0] ?? -4)) || !g.rng.chance(HUIYU.snipe)) return false;
  if (!g.wall.bringToLive(0, (t) => waits.has(kindOf(t)), g.rng)) return false;
  (st.sniped ??= []).push(g.wall.live[0]);
  g.emit({ type: 'ability', seat, ability: 'huiyu', text: '截张' });
  return true;
}

// 进张：要的牌（听牌了就是国标够 8 番的和了牌）
function luck(g: Game, seat: number, rinshan: boolean, fit: TargetFit): void {
  const waits = huiyuWaitFans(g, seat);
  const big = [...waits].filter(([, f]) => f >= HUIYU.minFan).map(([k]) => k);
  // 听着不够 8 番的牌：不送这几张（送来也和不了），送番种要的别的牌
  const want = new Set<Kind>(big.length ? big : fit.need.filter((k) => !waits.has(k)));
  if (!want.size) return;
  const next = rinshan ? g.wall.rinshan[0] : g.wall.live[0];
  if (next === undefined || want.has(kindOf(next)) || !g.rng.chance(HUIYU.luck)) return;
  const ok = (t: TileId) => want.has(kindOf(t));
  if (rinshan) g.wall.bringToRinshan(ok, g.rng);
  else g.wall.bringToLive(0, ok, g.rng);
}

// ---------- 能力 ----------

export const huiyuAbility: Ability = {
  id: 'huiyu',
  name: '国标',
  description: `她的运气是国标的运气。配完牌挑一个国标番种（偏向日麻里不是役的：一色三步高、花龙、全小……），配牌把番种用不到的 ${HUIYU.dealSwaps} 张换成番种要的牌，每次摸牌有 ${HUIYU.luck * 100}% 的概率送一张番种要的牌，听牌以后只送国标够 ${HUIYU.minFan} 番的和了牌。别人立直以后有 ${HUIYU.snipe * 100}% 的概率截走一张立直家的和了牌（一局最多 ${HUIYU.snipeMax} 张）。她不立直，牌山多于 ${HUIYU.freeAt} 张时国标不到 ${HUIYU.minFan} 番不和。立直了这一局能力就停掉。`,

  // 配牌：挑一个番种，用不到的牌换成牌山后面番种要的
  beforeDeal(g, seat) {
    const w = g.wall;
    const mine = g.dealIndices(seat);
    const cap = new Array<number>(KIND_COUNT).fill(4);
    const counts = () => toCounts(mine.map((i) => w.live[i]));
    const best = rankTargets(counts(), [], cap, 1)[0];
    if (!best) return;
    const t = best.target;
    for (let n = 0; n < HUIYU.dealSwaps; n++) {
      const c = counts();
      const f = fitTarget(t, c, [], cap);
      if (!f || f.missing <= 1) break;
      const need = new Set(f.need);
      const spare = g.rng.shuffle([...mine]).filter((i) => {
        const k = kindOf(w.live[i]);
        c[k]--;
        const after = fitTarget(t, c, [], cap);
        c[k]++;
        return !!after && after.missing === f.missing;
      });
      if (!spare.some((i) => w.bringToLive(i, (x) => need.has(kindOf(x)), g.rng, (j) => j >= 52))) break;
    }
  },

  // 配牌后的番种牌（玩家挑）
  postDeal(g, seat): PreDealOption[] {
    if (huiyuOff(g, seat)) return [];
    const cards = huiyuCards(g, seat);
    const out: PreDealOption[] = cards.map((c, i) => ({
      id: c.key,
      name: c.name,
      desc: `还差 ${c.missing} 张 · 国标约 ${c.gb} 番 / 日麻约 ${c.points} 点${c.ronOk ? '' : ' · 荣和无役'}`,
      enabled: true,
      picked: i === 0,
      group: 'gb',
      note: c.tiles.map(kindLabel).join(' '),
    }));
    out.push({ id: 'none', name: '不做番种', desc: '这一局没有运气，可以照常立直（立直以后八番起和也解除）', enabled: true, picked: false, group: 'gb' });
    return out;
  },

  setPostDeal(g, seat, picked) {
    const st = roundOf(g, seat);
    const id = picked[0];
    if (id === 'none') st.key = null;
    else if (id && st.cards?.includes(id)) st.key = id;
  },

  // 配完牌：没挑的（电脑）挑分数最高的
  afterDeal(g, seat) {
    const st = roundOf(g, seat);
    if (st.key === undefined) refresh(g, seat);
  },

  onRoundStart(g, seat) {
    if (huiyuTarget(g, seat)) g.emit({ type: 'ability', seat, ability: 'huiyu', text: '番种' });
  },

  beforeDraw(g, seat, rinshan) {
    if (huiyuOff(g, seat)) return;
    const st = roundOf(g, seat);
    if (!rinshan && snipe(g, seat)) return;
    const fit = refresh(g, seat);
    if (st.noLuck) {
      st.noLuck--;
      return;
    }
    if (fit) luck(g, seat, rinshan, fit);
  },

  // 打完牌听牌了、国标够 8 番：成
  afterDiscard(g, seat) {
    const st = roundOf(g, seat);
    if (st.done || !huiyuReady(g, seat)) return;
    st.done = true;
    g.emit({ type: 'ability', seat, ability: 'huiyu', text: '成' });
  },

  onCall(g, seat, caller) {
    if (caller === seat) roundOf(g, seat).cache = undefined;
  },

  // 和牌了：记下国标的番（被封印也照样记）
  onRoundEnd(g, seat, result) {
    const w = result.wins.find((x) => x.seat === seat);
    if (!w) return;
    const tsumo = w.from === null;
    const won = huiyuGb(g, seat, w.hand.map(kindOf), kindOf(w.tile), tsumo, tsumo ? g.rinshanDraw : g.callKind === 'chankan');
    if (won) roundOf(g, seat).won = won;
  },

  // 八番起和：只看这一张和得了的牌（没给牌时当和得了，免得电脑以为这一局和不了）
  canWin(g, seat, win) {
    if (!win || !huiyuMinFanOn(g, seat)) return true;
    return (huiyuWinFan(g, seat, win.tile, win.tsumo)?.total ?? 0) >= HUIYU.minFan;
  },

  skill(g, seat): SkillButton | null {
    const st = roundOf(g, seat);
    const t = huiyuTarget(g, seat);
    const fit = huiyuFit(g, seat);
    if (huiyuOff(g, seat)) return { label: '换番种', note: '立直了：这一局国标停掉', enabled: false };
    const playing = g.phase === 'turn' || g.phase === 'calls';
    const status = t ? `番种：${t.name}${fit ? `（还差 ${fit.missing} 张）` : '（做不成了）'}` : st.key === null ? '这一局不做番种' : '还没挑番种';
    const choices = playing
      ? topFamilies(huiyuRank(g, seat), HUIYU.cards + 1)
          .filter((f) => f.target.name !== t?.name)
          .slice(0, HUIYU.cards)
          .map((f) => ({ id: f.target.key, label: `${f.target.short}·差${f.missing}`, enabled: true }))
      : [];
    return { label: '换番种', note: `${status}。换了以后下一次摸牌不送牌`, enabled: playing && choices.length > 0, active: !!fit, choices };
  },

  pressSkill(g, seat, choice) {
    if (!choice || huiyuOff(g, seat) || !targetByKey(choice)) return;
    const st = roundOf(g, seat);
    if (st.key === choice) return;
    setTarget(g, seat, choice, '换番种');
    st.noLuck = 1;
  },

  badge(g, seat) {
    if (huiyuOff(g, seat)) return null;
    return huiyuTarget(g, seat)?.short ?? null;
  },

  powered(g, seat) {
    return huiyuReady(g, seat);
  },

  insight(g, seat) {
    if (huiyuOff(g, seat)) return ['立直了：这一局国标停掉'];
    const t = huiyuTarget(g, seat);
    if (!t) return [roundOf(g, seat).key === null ? '这一局不做番种' : '还没挑番种'];
    const fit = huiyuFit(g, seat);
    const sn = roundOf(g, seat).sniped?.length ?? 0;
    return [`番种：${t.name}${fit ? `（还差 ${fit.missing} 张）` : '（做不成了）'}`, ...(sn ? [`截了 ${sn} 张立直家的和了牌`] : [])];
  },
};
