import { evaluateWin } from '../engine/score';
import { type Kind, type TileId, isDragon, isRed, isYaochu, kindOf, suitOf } from '../engine/tiles';

// 涅莉（重做）押了运势的局：照手里的牌挑一手三倍满（立直、一发、门前清自摸和，再加役、宝牌、里宝牌凑到 11–12 番）。
// 把所有“4 组面子加一对雀头”和七对子的做法都摸一遍：缺的牌不超过 budget 张（每巡来一张，最后一张是自摸的牌），
// 先粗估役的番数挑出几十手，再一手一手正式算番（evaluateWin），挑役多、役大、宝牌里宝牌靠得少、这一场前面没做过的役
// （所以不会老是混一色、清一色）。宝牌能动的话顺便定宝牌指向哪种牌，里宝牌在和牌时补到正好 11–12 番

export interface RecipeAsk {
  have: number[]; // 手里的牌（按种类数）
  held: TileId[]; // 手里的牌（看赤宝牌）
  cap: number[]; // 每种牌最多凑得到几张（手里的加上牌山里摸得到的，最多 4）
  pool?: TileId[]; // 牌山里摸得到的牌（缺的牌照这些算赤宝牌：普通的五没了只剩赤五，算上赤宝牌）
  budget: number; // 最多缺几张（算上最后自摸的那张）
  seatWind: Kind;
  roundWind: Kind;
  isDealer: boolean;
  // free：宝牌指示牌还能换（kinds 是能换成的宝牌）；不能换就照 kinds（现在的宝牌）算
  dora: { free: boolean; kinds: Kind[] };
  ura: Kind[] | null; // 和牌时里宝牌能变成哪几种（null：中不了里宝牌，玄在场）
  haitei?: boolean; // 最后一张是海底
  kan?: boolean; // 开杠路线：要有一组刻子，第四张牌山里摸得到
  used?: string[][]; // 这一场前面几手三倍满的役（换着做）
  jitter?: () => number; // [0, 1)，一样好的挑哪手
  bigHan?: number; // 三倍满最少几番（11）
  maxHan?: number; // 最多几番（12，不冲累计役满）
  suit?: number; // 只用这一门花色和字牌（缺得多时用，算得快）
}

export interface Recipe {
  plan: number[]; // 要做成的 14 张（按种类数）
  win: Kind; // 最后摸进来自摸的那张
  dora: Kind | null; // 宝牌能动时把宝牌定成这种（null：宝牌不中她的牌）
  yaku: string[]; // 役（立直、一发、自摸、海底这些不算）
  han: number; // 不算里宝牌的番（立直一发自摸、役、宝牌、赤宝牌）
  ura: number; // 还要里宝牌补几番
  missing: number; // 还缺几张
}

// 立直、一发、自摸、海底、岭上这些是每一手都有的，不算“役种丰富”
// 挑哪手的分数：每缺一张扣几分；混一色、清一色扣几分（原来的涅莉总是做这两种，换着做别的）；
// 一发被鸣牌打断（少 1 番）里宝牌还补得回来的加几分
export const RECIPE_W = { miss: 1.2, flush: 2, robust: 8 };
const FLUSH = new Set(['混一色', '清一色']);
const PLAIN = new Set(['立直', '一发', '门前清自摸和', '海底捞月', '岭上开花']);

type Block = { run: boolean; k: Kind };
const BLOCKS: Block[] = [];
for (let s = 0; s < 3; s++) for (let i = 0; i < 7; i++) BLOCKS.push({ run: true, k: s * 9 + i });
for (let k = 0; k < 34; k++) BLOCKS.push({ run: false, k });

const yakuhai = (k: Kind, a: RecipeAsk) => (isDragon(k) ? 1 : 0) + (k === a.seatWind ? 1 : 0) + (k === a.roundWind ? 1 : 0);

// 粗估：4 组面子加雀头（门清、自摸）的役有几番（不算立直一发自摸、宝牌），役满是 null
function roughSets(sets: Block[], head: Kind, t: number[], a: RecipeAsk): { han: number; names: string[] } | null {
  const names: string[] = [];
  let han = 0;
  const add = (n: string, h: number) => {
    names.push(n);
    han += h;
  };
  const runs = sets.filter((s) => s.run).map((s) => s.k);
  const trips = sets.filter((s) => !s.run).map((s) => s.k);
  if (trips.length >= 4) return null; // 四暗刻
  const dragons = trips.filter(isDragon).length;
  if (dragons >= 3) return null; // 大三元
  const winds = trips.filter((k) => k >= 27 && k <= 30).length;
  if (winds >= 3 && head >= 27 && head <= 30) return null; // 小四喜
  let honors = false;
  const suits = new Set<number>();
  let simple = true;
  for (let k = 0; k < 34; k++) {
    if (!t[k]) continue;
    if (k >= 27) honors = true;
    else suits.add(suitOf(k));
    if (isYaochu(k)) simple = false;
  }
  if (!suits.size) return null; // 字一色
  if (simple) add('断幺九', 1);
  if (suits.size === 1) add(honors ? '混一色' : '清一色', honors ? 3 : 6);
  const rc = new Map<number, number>();
  for (const k of runs) rc.set(k, (rc.get(k) ?? 0) + 1);
  const dups = [...rc.values()].reduce((n, c) => n + Math.floor(c / 2), 0);
  if (dups >= 2) add('二杯口', 3);
  else if (dups === 1) add('一杯口', 1);
  for (let n = 0; n < 7; n++) if (runs.includes(n) && runs.includes(9 + n) && runs.includes(18 + n)) add('三色同顺', 2);
  for (let s = 0; s < 3; s++) if (runs.includes(s * 9) && runs.includes(s * 9 + 3) && runs.includes(s * 9 + 6)) add('一气通贯', 2);
  if (runs.length && sets.every((s) => (s.run ? s.k % 9 === 0 || s.k % 9 === 6 : isYaochu(s.k))) && isYaochu(head)) add(honors ? '混全带幺九' : '纯全带幺九', honors ? 2 : 3);
  if (trips.length === 3) add('三暗刻', 2);
  for (let n = 0; n < 9; n++) if (trips.includes(n) && trips.includes(9 + n) && trips.includes(18 + n)) add('三色同刻', 2);
  for (const k of trips) {
    const v = yakuhai(k, a);
    if (v) add(`役牌`, v);
  }
  if (dragons === 2 && isDragon(head)) add('小三元', 2);
  if (!trips.length && yakuhai(head, a) === 0) add('平和', 1);
  return { han, names };
}

// 粗估七对子的役
function roughPairs(t: number[]): { han: number; names: string[] } | null {
  const names = ['七对子'];
  let han = 2;
  let honors = false;
  let simple = true;
  let terminal = true;
  const suits = new Set<number>();
  for (let k = 0; k < 34; k++) {
    if (!t[k]) continue;
    if (k >= 27) honors = true;
    else suits.add(suitOf(k));
    if (isYaochu(k)) simple = false;
    else terminal = false;
  }
  if (!suits.size) return null; // 字一色
  const add = (n: string, h: number) => {
    names.push(n);
    han += h;
  };
  if (simple) add('断幺九', 1);
  if (terminal) add('混老头', 2);
  if (suits.size === 1) add(honors ? '混一色' : '清一色', honors ? 3 : 6);
  return { han, names };
}

// 这一场前面做过的役：做过的扣分，没做过的加分
function novelty(names: string[], used: string[][]): number {
  let s = names.some((n) => FLUSH.has(n)) ? -RECIPE_W.flush : 0;
  if (!used.length) return s;
  const seen = new Set(used.flat());
  for (const n of names) s += seen.has(n) ? -2 : 1;
  // 上一手一模一样
  const last = used[used.length - 1];
  if (last && last.length === names.length && last.every((n) => names.includes(n))) s -= 4;
  return s;
}

// 宝牌、里宝牌怎么定：lo 是不算宝牌、里宝牌的番。挑宝牌靠得最少、又经得起一发被打断（少 1 番里宝牌补得回来）的那种。
// 返回 null 是凑不成 11–12 番
function settle(lo: number, t: number[], a: RecipeAsk): { dora: Kind | null; d: number; u: number; robust: boolean } | null {
  const big = a.bigHan ?? 11;
  const max = a.maxHan ?? 12;
  const us = [0];
  if (a.ura) for (const k of a.ura) if (t[k] > 0) us.push(t[k]);
  const ds: { dora: Kind | null; d: number }[] = [];
  if (a.dora.free) {
    ds.push({ dora: null, d: 0 });
    for (const k of a.dora.kinds) if (t[k] > 0 && !ds.some((x) => x.d === t[k])) ds.push({ dora: k, d: t[k] });
  } else ds.push({ dora: null, d: a.dora.kinds.reduce((n, k) => n + t[k], 0) });
  let best: { dora: Kind | null; d: number; u: number; robust: boolean } | null = null;
  let bestKey = -Infinity;
  for (const x of ds) {
    const base = lo + x.d;
    if (base > max) continue;
    const u = us.filter((v) => base + v >= big && base + v <= max).sort((p, q) => p - q)[0];
    if (u === undefined) continue;
    const robust = us.some((v) => base - 1 + v >= big && base - 1 + v <= max);
    // 经得起打断的先；宝牌加里宝牌靠得少的先
    const key = (robust ? 100 : 0) - (x.d + u);
    if (key > bestKey) [best, bestKey] = [{ ...x, u, robust }, key];
  }
  return best;
}

interface Cand {
  t: number[];
  missing: number;
  rough: number;
  pairs: boolean;
}

// 手里的牌和缺的牌换成牌（缺的用不是赤宝牌的那几张），算正式的番
function tilesFor(t: number[], a: RecipeAsk, win: Kind): { closed: TileId[]; winTile: TileId } | null {
  const closed: TileId[] = [];
  let winTile: TileId | null = null;
  const byKind = new Map<number, TileId[]>();
  for (const id of a.held) byKind.set(kindOf(id), [...(byKind.get(kindOf(id)) ?? []), id]);
  for (let k = 0; k < 34; k++) {
    if (!t[k]) continue;
    // 手里的赤宝牌留着
    const mine = (byKind.get(k) ?? []).slice().sort((x, y) => Number(isRed(y)) - Number(isRed(x)));
    const keep = mine.slice(0, Math.min(t[k], mine.length));
    const avail = a.pool ? a.pool.filter((id) => kindOf(id) === k) : [0, 1, 2, 3].map((n) => k * 4 + n);
    const spare = avail.filter((id) => !mine.includes(id)).sort((x, y) => Number(isRed(x)) - Number(isRed(y)));
    const extra = spare.slice(0, t[k] - keep.length);
    if (keep.length + extra.length < t[k]) return null;
    // 最后摸进来的那张是缺的牌
    if (k === win) {
      if (!extra.length) return null;
      winTile = extra[0];
    }
    closed.push(...keep, ...extra);
  }
  return winTile === null ? null : { closed, winTile };
}

export function planRecipe(a: RecipeAsk): Recipe | null {
  const t = new Array<number>(34).fill(0);
  const { have, budget } = a;
  // 只用一门花色和字牌：别的牌当没有
  const cap = a.suit === undefined ? a.cap : a.cap.map((n, k) => (k >= 27 || suitOf(k) === a.suit ? n : 0));
  const base = 3 + (a.haitei ? 1 : 0); // 立直、一发、自摸（海底）
  const keep: Cand[] = [];
  let floor = -Infinity;
  const push = (c: Cand) => {
    if (c.rough < floor) return;
    keep.push(c);
    if (keep.length > 600) {
      keep.sort((x, y) => y.rough - x.rough);
      keep.length = 300;
      floor = keep[keep.length - 1].rough;
    }
  };
  const used = a.used ?? [];
  const aka = (tt: number[]) => {
    let n = 0;
    const per = new Map<number, number>();
    for (const id of a.held) if (isRed(id)) per.set(kindOf(id), (per.get(kindOf(id)) ?? 0) + 1);
    for (const [k, c] of per) n += Math.min(c, tt[k]);
    return n;
  };
  const rate = (r: { han: number; names: string[] }, missing: number, pairs: boolean) => {
    const lo = base + r.han + aka(t);
    if (lo > (a.maxHan ?? 12)) return;
    const s = settle(lo, t, a);
    if (!s) return;
    const distinct = new Set(r.names).size;
    const rough = 3 * distinct + 1.5 * Math.min(r.han, 8) - (s.d + s.u) - RECIPE_W.miss * missing + (s.robust ? RECIPE_W.robust : 0) + novelty(r.names, used);
    push({ t: t.slice(), missing, rough, pairs });
  };
  // 4 组面子加雀头
  const sets: Block[] = [];
  const kanOk = () => !a.kan || sets.some((s) => !s.run && cap[s.k] >= 4);
  const pick = (from: number, left: number, missing: number) => {
    if (left === 0) {
      for (let k = 0; k < 34; k++) {
        if (t[k] + 2 > cap[k]) continue;
        const add = Math.max(0, t[k] + 2 - have[k]) - Math.max(0, t[k] - have[k]);
        if (missing + add > budget) continue;
        t[k] += 2;
        if (kanOk()) {
          const r = roughSets(sets, k, t, a);
          if (r) rate(r, missing + add, false);
        }
        t[k] -= 2;
      }
      return;
    }
    for (let i = from; i < BLOCKS.length; i++) {
      const b = BLOCKS[i];
      const ks = b.run ? [b.k, b.k + 1, b.k + 2] : [b.k, b.k, b.k];
      let add = 0;
      let ok = true;
      for (const k of ks) {
        if (t[k] >= cap[k]) ok = false;
        if (t[k] >= have[k]) add++;
        t[k]++;
      }
      if (ok && missing + add <= budget) {
        sets.push(b);
        // 刻子不重复（同一种牌两组刻子要 6 张）
        pick(b.run ? i : i + 1, left - 1, missing + add);
        sets.pop();
      }
      for (const k of ks) t[k]--;
    }
  };
  pick(0, 4, 0);
  // 七对子（开杠路线不做）
  if (!a.kan) {
    const kinds = Array.from({ length: 34 }, (_, k) => k).filter((k) => cap[k] >= 2);
    const choose = (from: number, left: number, missing: number) => {
      if (left === 0) {
        const r = roughPairs(t);
        if (r) rate(r, missing, true);
        return;
      }
      for (let i = from; i <= kinds.length - left; i++) {
        const k = kinds[i];
        const add = Math.max(0, 2 - have[k]);
        if (missing + add > budget) continue;
        t[k] = 2;
        choose(i + 1, left - 1, missing + add);
        t[k] = 0;
      }
    };
    choose(0, 7, 0);
  }
  if (!keep.length) return null;
  keep.sort((x, y) => y.rough - x.rough);
  // 正式算番：前面几十手，每手试一遍最后自摸哪张
  let best: Recipe | null = null;
  let bestScore = -Infinity;
  let checked = 0;
  for (const c of keep.slice(0, 80)) {
    for (let w = 0; w < 34; w++) {
      if (c.t[w] <= have[w]) continue;
      const tiles = tilesFor(c.t, a, w);
      if (!tiles) continue;
      const r = evaluateWin({
        closed: tiles.closed,
        melds: [],
        winTile: tiles.winTile,
        tsumo: true,
        seatWind: a.seatWind,
        roundWind: a.roundWind,
        isDealer: a.isDealer,
        riichi: true,
        ippatsu: true,
        haitei: a.haitei,
        doraIndicators: [],
        uraIndicators: [],
      });
      if (!r || r.yakuman > 0) continue;
      // 开杠路线：杠的那组刻子不能是最后自摸那张凑的
      if (a.kan && !Array.from({ length: 34 }, (_, k) => k).some((k) => k !== w && c.t[k] === 3 && cap[k] >= 4)) continue;
      const s = settle(r.han, c.t, a);
      if (!s) continue;
      const names = r.yaku.map((y) => y.name).filter((n) => !PLAIN.has(n));
      const yakuHan = r.yaku.filter((y) => !PLAIN.has(y.name)).reduce((n, y) => n + y.han, 0);
      const score =
        3 * names.length + 1.5 * Math.min(yakuHan, 8) - (s.d + s.u) - RECIPE_W.miss * c.missing + (s.robust ? RECIPE_W.robust : 0) + novelty(names, used) + 3 * (a.jitter?.() ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = { plan: c.t.slice(), win: w, dora: s.dora, yaku: names, han: r.han + s.d, ura: s.u, missing: c.missing };
      }
    }
    if (best && ++checked >= 40) break;
  }
  return best;
}

// 先在 budget 张以内挑；挑不出来（玄在场、宝牌里宝牌都用不上的时候常见）就只看一门花色加字牌，缺得多一点也行（far 张以内）。
// 缺得比能摸的次数还多，由调用的人换几张配牌
export function planBest(a: RecipeAsk, far: number): Recipe | null {
  const r = planRecipe(a);
  if (r || far <= a.budget) return r;
  let best: Recipe | null = null;
  for (let s = 0; s < 3; s++) {
    const x = planRecipe({ ...a, suit: s, budget: far });
    if (x && (!best || x.missing < best.missing)) best = x;
  }
  return best;
}
