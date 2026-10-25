import type { AiStyle } from '../abilities/characters';
import { awaiWaitingForCorner } from '../abilities/awai';
import { dangerKinds } from '../abilities/hiroe';
import { forecastNextDraw } from './forecast';
import { kasumiSuit } from '../abilities/kasumi';
import { koromoCanShift } from '../abilities/koromo';
import { mihokoSafeKinds } from '../abilities/mihoko';
import { nellyLuck } from '../abilities/nelly';
import { TERU, teruKeeps, teruMirrored, teruWinValue } from '../abilities/teru';
import { isDoraTile, kuroLost } from '../abilities/kuro';
import type { Action, Game } from '../engine/game';
import { evaluateWin } from '../engine/score';
import { kokushiShanten, shanten, waitingKinds } from '../engine/shanten';
import {
  EAST,
  KIND_COUNT,
  Kind,
  TileId,
  doraFromIndicator,
  isDragon,
  isHonor,
  isSimple,
  isYaochu,
  kindOf,
  toCounts,
} from '../engine/tiles';

// 规则型电脑对手：牌效 + 简单防守 + 会用自己的能力

export function chooseAction(g: Game, seat: number, style: AiStyle): Action {
  const legal = g.legalActions(seat);
  if (legal.length === 0) throw new Error(`座位 ${seat} 没有可做的操作`);
  return g.phase === 'calls' ? chooseCall(g, seat, legal, style) : chooseTurn(g, seat, legal, style);
}

// ---------- 可见牌统计 ----------

function visibleCounts(g: Game, seat: number): number[] {
  const c = new Array<number>(KIND_COUNT).fill(0);
  const add = (t: TileId) => c[kindOf(t)]++;
  g.players[seat].hand.forEach(add);
  for (const p of g.players) {
    p.discards.forEach((d) => {
      if (!d.called) add(d.tile);
    });
    p.melds.forEach((m) => m.tiles.forEach(add));
  }
  g.wall.visibleDoraIndicators().forEach(add);
  return c;
}

function ukeire(counts: number[], melds: number, visible: number[]): number {
  const cur = shanten(counts, melds);
  let total = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    const left = 4 - visible[k];
    if (left <= 0) continue;
    counts[k]++;
    if (shanten(counts, melds) < cur) total += left;
    counts[k]--;
  }
  return total;
}

// 孤张价值：越低越该先打
function tileValue(g: Game, seat: number, k: Kind, counts: number[]): number {
  let v = 0;
  if (isHonor(k)) {
    const yakuhai = isDragon(k) || k === g.seatWind(seat) || k === 27 + g.roundWind;
    v = counts[k] >= 2 ? 4 : yakuhai ? 1 : 0;
  } else {
    const n = k % 9;
    for (const d of [-2, -1, 1, 2]) {
      const m = n + d;
      if (m >= 0 && m <= 8 && counts[k + d] > 0) v += Math.abs(d) === 1 ? 2 : 1;
    }
    if (counts[k] >= 2) v += 3;
    v += isYaochu(k) ? 0 : 1;
  }
  const doraKinds = g.wall.visibleDoraIndicators().map((i) => doraFromIndicator(kindOf(i)));
  if (doraKinds.includes(k)) v += 2;
  return v;
}

// ---------- 防守 ----------

// 团体赛（点数是队伍的点数）：没落后太多就以不放铳为先；落后很多才拼
const TEAM_CHASE = 30000;
function teamCareful(g: Game, seat: number): boolean {
  if (g.format !== 'team') return false;
  const top = Math.max(...g.players.filter((p) => p.seat !== seat).map((p) => p.score));
  return top - g.players[seat].score < TEAM_CHASE;
}

// 要防的人：立直的、副露三组以上的（团体赛里小心的时候两组就防）
function threats(g: Game, seat: number): number[] {
  const melds = teamCareful(g, seat) ? 2 : 3;
  return [0, 1, 2, 3].filter((s) => s !== seat && (g.players[s].riichi || g.players[s].melds.length >= melds));
}

function danger(g: Game, threat: number, k: Kind, visible: number[]): number {
  const p = g.players[threat];
  const discarded = new Set(p.discards.map((d) => kindOf(d.tile)));
  if (discarded.has(k)) return 0;
  // 立直之后别人打过而他没荣和的牌也安全
  const riichiIdx = p.discards.findIndex((d) => d.riichi);
  if (riichiIdx >= 0) {
    const riichiTime = g.events.findIndex((e) => e.type === 'discard' && e.seat === threat && e.riichi);
    const after = g.events
      .slice(riichiTime + 1)
      .filter((e) => e.type === 'discard')
      .map((e) => (e.type === 'discard' ? kindOf(e.tile) : -1));
    if (after.includes(k)) return 0;
  }
  if (isHonor(k)) return visible[k] >= 3 ? 1 : visible[k] === 2 ? 3 : 6;
  const n = k % 9;
  const suji = (d: number) => n + d >= 0 && n + d <= 8 && discarded.has(k + d);
  const lowSafe = n < 3 || suji(-3);
  const highSafe = n > 5 || suji(3);
  if (lowSafe && highSafe) return n === 0 || n === 8 ? 2 : 4;
  if (n === 0 || n === 8) return 6;
  if (n === 1 || n === 7) return 8;
  return 10;
}

// ---------- 自己的回合 ----------

function chooseTurn(g: Game, seat: number, legal: Action[], style: AiStyle): Action {
  const p = g.players[seat];
  const find = (t: Action['type']) => legal.find((a) => a.type === t);

  const tsumo = find('tsumo');
  if (tsumo && !(style.streak && teruWaits(g, seat, true))) return tsumo;

  const kyuushu = find('kyuushu');
  if (kyuushu && kokushiShanten(toCounts(p.hand)) > 2) return kyuushu;

  const counts = toCounts(p.hand);
  const cur = shanten(counts, p.melds.length);
  for (const a of legal) {
    if (a.type === 'ankan') {
      if (p.riichi || style.kanEager) return a;
      const after = counts.slice();
      after[a.kind] = 0;
      if (shanten(after, p.melds.length + 1) <= cur && threats(g, seat).length === 0) return a;
    }
    if (a.type === 'kakan' && (style.kanEager || threats(g, seat).length === 0)) {
      const after = counts.slice();
      after[kindOf(a.tile)]--;
      if (shanten(after, p.melds.length) <= cur) return a;
    }
  }

  const discards = legal.filter((a): a is Extract<Action, { type: 'discard' }> => a.type === 'discard');
  if (p.riichi) return discards[0];

  const visible = visibleCounts(g, seat);
  type Cand = {
    a: Extract<Action, { type: 'discard' }>;
    sh: number;
    sh2: number;
    uke: number;
    val: number;
    risk: number;
    hit: number; // 洋榎：读出来别人和得了这张
    trap: number; // 洋榎：听牌时听的是自己打过的牌的筋（引っ掛け）
  };
  // 被爽的霍亚乌封印时读不了牌
  const sealed = g.isSealed(seat);
  const readDanger = !sealed && (style.reads || (style.mirror && teruMirrored(g, seat))) ? dangerKinds(g, seat) : null;
  // 美穗子睁眼：立直的人手里没有的花色是安全牌
  const eyeSafe = style.eye && !sealed ? new Map(threats(g, seat).map((t) => [t, mihokoSafeKinds(g, seat, t)])) : null;
  const myDiscards = new Set(p.discards.map((d) => kindOf(d.tile)));
  const cands: Cand[] = [];
  const seen = new Set<string>();
  for (const a of discards) {
    if (a.riichi) continue;
    const key = `${kindOf(a.tile)}-${isDoraTile(g, a.tile)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = counts.slice();
    c[kindOf(a.tile)]--;
    const sh = shanten(c, p.melds.length);
    let val = tileValue(g, seat, kindOf(a.tile), counts);
    if (style.keepDora && isDoraTile(g, a.tile)) val += 20;
    const ts = threats(g, seat);
    const risk = ts.length ? Math.max(...ts.map((t) => (eyeSafe?.get(t)?.has(kindOf(a.tile)) ? 0 : danger(g, t, kindOf(a.tile), visible)))) : 0;
    const sh2 = sh;
    const hit = readDanger?.has(kindOf(a.tile)) ? 1 : 0;
    let trap = 0;
    if (style.trapWait && sh === 0) {
      const out = new Set([...myDiscards, kindOf(a.tile)]);
      const suji = (w: Kind) => w < 27 && [-3, 3].some((d) => w % 9 + d >= 0 && w % 9 + d <= 8 && out.has(w + d));
      trap = waitingKinds(c, p.melds.length).some(suji) ? 1 : 0;
    }
    cands.push({ a, sh, sh2, uke: sh <= cur ? ukeire(c, p.melds.length, visible) : 0, val, risk, hit, trap });
  }

  // 霞：请神后同样向听时，先打别的花色，留下绝掉的那门和字牌
  const suit = style.suitFocus ? kasumiSuit(g, seat) : null;
  const keep = (c: Cand) => (suit !== null && (kindOf(c.a.tile) >= 27 || Math.floor(kindOf(c.a.tile) / 9) === suit) ? 1 : 0);
  // 洋榎听牌时：两种听法都有牌可和，挑引っ掛け的
  const trapOrder = (x: Cand, y: Cand) => (x.sh === 0 && y.sh === 0 && x.uke > 0 && y.uke > 0 ? y.trap - x.trap : 0);
  const attackOrder = (x: Cand, y: Cand) =>
    x.hit - y.hit || x.sh - y.sh || keep(x) - keep(y) || trapOrder(x, y) || x.sh2 - y.sh2 || y.uke - x.uke || x.val - y.val;
  cands.sort(attackOrder);
  // 怜：假设打掉现在最想打的那张，演算自己下一次摸到什么，按它重排。
  // 失误先掷（随机数用掉的时刻和别人一样），再演算：演算拿到的随机数和之后真的牌局一致
  let slip: boolean | null = null;
  if (style.useForesight && !sealed) {
    slip = cands.length > 1 && g.rng.chance(style.mistakeRate);
    const t = forecastNextDraw(g, seat, { discard: cands[0].a.tile });
    if (t !== null) {
      for (const x of cands) {
        const c = counts.slice();
        c[kindOf(x.a.tile)]--;
        c[kindOf(t)]++;
        x.sh2 = shanten(c, p.melds.length);
      }
      cands.sort(attackOrder);
    }
  }
  // 玄：只要还有别的牌可打，就不打宝牌
  if (style.keepDora) {
    const keep = cands.filter((x) => !isDoraTile(g, x.a.tile));
    if (keep.length) cands.splice(0, cands.length, ...keep, ...cands.filter((x) => !keep.includes(x)));
  }
  // 淡：等转角暗杠，暗刻不拆
  const kanKind = style.cornerKan ? awaiWaitingForCorner(g, seat) : null;
  if (kanKind !== null) {
    const keep = cands.filter((x) => kindOf(x.a.tile) !== kanKind);
    if (keep.length) cands.splice(0, cands.length, ...keep);
  }
  let best = cands[0];

  // 别人立直而自己离听牌还远：弃和。团体赛里少失点就是帮队伍：一向听就弃，听牌了手里这张也危险也弃
  const careful = teamCareful(g, seat);
  if (threats(g, seat).length && (best.sh >= 1 || !g.canWin(seat) || (careful && best.risk >= 6))) {
    // 玄弃和也不打宝牌（还有别的牌可打时）
    const dora = (x: Cand) => (style.keepDora && isDoraTile(g, x.a.tile) ? 1 : 0);
    const safest = [...cands].sort((x, y) => dora(x) - dora(y) || x.hit - y.hit || x.risk - y.risk || attackOrder(x, y));
    // 涅莉运势很差的局不拼；这一局和不了（被七姐妹封住、照魔镜那一局）也不拼
    if (best.sh >= 2 || best.risk >= 6 || style.defensive || (style.waves && nellyLuck(g, seat) <= -2) || !g.canWin(seat) || careful) best = safest[0];
  }

  const slipped = slip ?? (cands.length > 1 && g.rng.chance(style.mistakeRate));
  // 读得出别人听什么时，失误也不会失误到放铳的牌上
  // 玄失误也不会失误到宝牌上
  const doraSlip = style.keepDora && isDoraTile(g, cands[1]?.a.tile ?? -1) && !isDoraTile(g, best.a.tile);
  if (slipped && cands[1].sh === best.sh && cands[1].hit <= best.hit && !doraSlip) best = cands[1];

  // 能立直就立直
  const riichi = discards.find((a) => a.riichi && kindOf(a.tile) === kindOf(best.a.tile));
  // 这一局和不了时立直白扔 1000 点
  if (riichi && best.sh === 0 && g.canWin(seat)) {
    const c = counts.slice();
    c[kindOf(best.a.tile)]--;
    if (style.foresightRiichi && !sealed) {
      // 怜：先见到立直以后下一次摸的牌正好和牌才立直（一发自摸），否则默听
      const nextDraw = forecastNextDraw(g, seat, { discard: riichi.tile, riichi: true });
      if (nextDraw === null) return best.a;
      c[kindOf(nextDraw)]++;
      return shanten(c, p.melds.length) === -1 ? riichi : best.a;
    }
    if (style.keepDora && !kuroMustRiichi(g, seat, p.hand.filter((t) => t !== best.a.tile))) return best.a;
    // 衣：海底不是自己的、这一局也没法再挪给自己，就不立直，留着吃碰把海底挪过来（打掉这张以后，最后一张轮到谁：从下家起数）
    if (style.haitei && (seat + 1 + g.wall.live.length - 1) % 4 !== seat && !koromoCanShift(g, seat)) return best.a;
    // 洋榎：有役、默听也够大就默听，别人看不出她听牌了
    if (style.damaMin && damaRon(g, seat, p.hand.filter((t) => t !== best.a.tile)) >= style.damaMin) return best.a;
    if (ukeire(c, p.melds.length, visible) > 0) return riichi;
  }
  return best.a;
}

// 玄：立直以后只能摸切，宝牌聚集送来的宝牌全得打掉，能力当场失效。所以听牌了默听为主，非进攻不可时才立直：
// 能力已经没了（打出过宝牌）；默听荣和不到 3900 点（没役只能自摸，或者太便宜，靠立直加番）；最后一局不是第一、默听和了也追不上。
// hand 是打掉这张以后的 13 张
const KURO_DAMA_MIN = 3900;
function kuroMustRiichi(g: Game, seat: number, hand: TileId[]): boolean {
  if (kuroLost(g, seat)) return true;
  const p = g.players[seat];
  const best = damaRon(g, seat, hand);
  if (best < KURO_DAMA_MIN) return true;
  if (g.isLastRounds(1)) {
    const top = Math.max(...g.players.filter((q) => q.seat !== seat).map((q) => q.score));
    const gain = best + g.honba * 300 + g.riichiSticks * 1000;
    if (p.score <= top && p.score + gain <= top) return true;
  }
  return false;
}

// 默听荣和最多能拿多少点（振听、没役是 0）。hand 是打掉一张以后的 13 张
function damaRon(g: Game, seat: number, hand: TileId[]): number {
  const p = g.players[seat];
  const waits = waitingKinds(toCounts(hand), p.melds.length);
  const discarded = new Set([...p.discards.map((d) => kindOf(d.tile)), ...g.players[seat].hand.filter((t) => !hand.includes(t)).map(kindOf)]);
  const furiten = waits.some((k) => discarded.has(k));
  const dora = g.wall.visibleDoraIndicators().map(kindOf);
  // 默听荣和最多能拿多少点（振听、没役是 0）
  let best = 0;
  if (!furiten) {
    for (const k of waits) {
      const tile = k * 4 + 1;
      const r = evaluateWin({
        closed: [...hand, tile],
        melds: p.melds,
        winTile: tile,
        tsumo: false,
        seatWind: g.seatWind(seat),
        roundWind: EAST + g.roundWind,
        isDealer: seat === g.dealer,
        riichi: false,
        doubleRiichi: false,
        ippatsu: false,
        doraIndicators: dora,
      });
      if (r) best = Math.max(best, r.ron);
    }
  }
  return best;
}

// 照：这一手和了接不上连和（比上一次小），牌山还多，就先不和、等更大的
function teruWaits(g: Game, seat: number, tsumo: boolean): boolean {
  if (g.wall.remaining <= TERU.aiForceWin) return false;
  const p = g.players[seat];
  const tile = tsumo ? p.drawn! : g.callKind === 'chankan' ? g.kakanInfo!.tile : g.lastDiscard!.tile;
  const r = g.winResult(seat, tile, tsumo);
  return !!r && !teruKeeps(g, seat, teruWinValue(r, tsumo, seat === g.dealer));
}

// ---------- 别人打牌后 ----------

function hasYakuhaiMeld(g: Game, seat: number): boolean {
  return g.players[seat].melds.some((m) => {
    const k = kindOf(m.tiles[0]);
    return m.type !== 'chi' && (isDragon(k) || k === g.seatWind(seat) || k === 27 + g.roundWind);
  });
}

function chooseCall(g: Game, seat: number, legal: Action[], style: AiStyle): Action {
  const pass = legal.find((a) => a.type === 'pass')!;
  const ron = legal.find((a) => a.type === 'ron');
  // 淡：等转角暗杠自摸，不荣和
  if (ron && !(style.cornerKan && awaiWaitingForCorner(g, seat) !== null) && !(style.streak && teruWaits(g, seat, false))) return ron;

  const p = g.players[seat];
  const tile = g.lastDiscard!.tile;
  const k = kindOf(tile);
  const counts = toCounts(p.hand);
  const cur = shanten(counts, p.melds.length);

  const kan = legal.find((a) => a.type === 'daiminkan');
  if (kan && style.kanEager) return kan;

  // 怜：先见到自己下一张有用的话，就不鸣牌打乱顺序
  if (style.useForesight && !g.isSealed(seat)) {
    const mine = forecastNextDraw(g, seat);
    if (mine !== null) {
      const c = counts.slice();
      c[kindOf(mine)]++;
      if (shanten(c, p.melds.length) < cur) return pass;
    }
  }

  const yakuhai = isDragon(k) || k === g.seatWind(seat) || k === 27 + g.roundWind;
  const tanyaoOk =
    isSimple(k) &&
    p.melds.every((m) => m.tiles.every((t) => isSimple(kindOf(t)))) &&
    p.hand.filter((t) => isYaochu(kindOf(t))).length <= 1;
  const yakuSecured = hasYakuhaiMeld(g, seat);

  // 衣：听牌了、海底不是自己的，找一手吃碰把海底挪到自己（海底摸月本身就是役）；
  // 海底已经是自己的，就不吃不碰，免得把它挪走
  // 还差一步听牌时，能一手吃碰同时听牌、拿到海底的也鸣
  if (style.haitei && !p.riichi && cur <= 1) {
    const last = g.wall.live.length - 1;
    if (cur === 0 && (g.lastDiscard!.seat + 1 + last) % 4 === seat) return pass;
    if (last >= 4 && (seat + 1 + last) % 4 === seat) {
      for (const a of legal) {
        if (a.type !== 'pon' && a.type !== 'chi') continue;
        const c = counts.slice();
        for (const t of a.tiles) c[kindOf(t)]--;
        if (shanten(c, p.melds.length + 1) === 0) return a;
      }
    }
  }

  let best: Action = pass;
  let bestSh = cur;
  for (const a of legal) {
    if (a.type !== 'pon' && a.type !== 'chi') continue;
    if (a.type === 'pon' && !(yakuhai || tanyaoOk || yakuSecured)) continue;
    if (a.type === 'chi' && !(tanyaoOk || yakuSecured)) continue;
    if (a.type === 'chi' && !yakuSecured && cur > 2) continue;
    const c = counts.slice();
    for (const t of a.tiles) c[kindOf(t)]--;
    const sh = shanten(c, p.melds.length + 1);
    if (sh < bestSh) {
      best = a;
      bestSh = sh;
    }
  }
  return best;
}
