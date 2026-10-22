import type { AiStyle } from '../abilities/characters';
import { isDoraTile } from '../abilities/kuro';
import type { Action, Game } from '../engine/game';
import { kokushiShanten, shanten } from '../engine/shanten';
import {
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

function threats(g: Game, seat: number): number[] {
  return [0, 1, 2, 3].filter((s) => s !== seat && (g.players[s].riichi || g.players[s].melds.length >= 3));
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
  if (tsumo) return tsumo;

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
  // 怜：知道自己下一巡会摸到什么，把它算进来
  const fs = style.useForesight ? g.abilities[seat]?.foresight?.(g, seat) : null;
  const nextDraw = fs?.draws.find((d) => d.seat === seat)?.tile;
  type Cand = {
    a: Extract<Action, { type: 'discard' }>;
    sh: number;
    sh2: number;
    uke: number;
    val: number;
    risk: number;
  };
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
    const risk = ts.length ? Math.max(...ts.map((t) => danger(g, t, kindOf(a.tile), visible))) : 0;
    let sh2 = sh;
    if (nextDraw !== undefined) {
      c[kindOf(nextDraw)]++;
      sh2 = shanten(c, p.melds.length);
      c[kindOf(nextDraw)]--;
    }
    cands.push({ a, sh, sh2, uke: sh <= cur ? ukeire(c, p.melds.length, visible) : 0, val, risk });
  }

  const attackOrder = (x: Cand, y: Cand) => x.sh - y.sh || x.sh2 - y.sh2 || y.uke - x.uke || x.val - y.val;
  cands.sort(attackOrder);
  // 玄：只要还有别的牌可打，就不打宝牌
  if (style.keepDora) {
    const keep = cands.filter((x) => !isDoraTile(g, x.a.tile));
    if (keep.length) cands.splice(0, cands.length, ...keep, ...cands.filter((x) => !keep.includes(x)));
  }
  let best = cands[0];

  // 别人立直而自己离听牌还远：弃和
  if (threats(g, seat).length && best.sh >= 1) {
    const safest = [...cands].sort((x, y) => x.risk - y.risk || attackOrder(x, y));
    if (best.sh >= 2 || best.risk >= 6) best = safest[0];
  }

  if (cands.length > 1 && g.rng.chance(style.mistakeRate) && cands[1].sh === best.sh) best = cands[1];

  // 能立直就立直
  const riichi = discards.find((a) => a.riichi && kindOf(a.tile) === kindOf(best.a.tile));
  if (riichi && best.sh === 0) {
    const c = counts.slice();
    c[kindOf(best.a.tile)]--;
    if (ukeire(c, p.melds.length, visible) > 0) return riichi;
  }
  return best.a;
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
  if (ron) return ron;

  const p = g.players[seat];
  const tile = g.lastDiscard!.tile;
  const k = kindOf(tile);
  const counts = toCounts(p.hand);
  const cur = shanten(counts, p.melds.length);

  const kan = legal.find((a) => a.type === 'daiminkan');
  if (kan && style.kanEager) return kan;

  // 怜：先见到自己下一张有用的话，就不鸣牌打乱顺序
  if (style.useForesight) {
    const fs = g.abilities[seat]?.foresight?.(g, seat);
    const mine = fs?.draws.find((d) => d.seat === seat);
    if (mine) {
      const c = counts.slice();
      c[kindOf(mine.tile)]++;
      if (shanten(c, p.melds.length) < cur) return pass;
    }
  }

  const yakuhai = isDragon(k) || k === g.seatWind(seat) || k === 27 + g.roundWind;
  const tanyaoOk =
    isSimple(k) &&
    p.melds.every((m) => m.tiles.every((t) => isSimple(kindOf(t)))) &&
    p.hand.filter((t) => isYaochu(kindOf(t))).length <= 1;
  const yakuSecured = hasYakuhaiMeld(g, seat);

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
