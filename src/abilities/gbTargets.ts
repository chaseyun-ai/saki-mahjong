import { KIND_COUNT, Kind } from '../engine/tiles';

// 郝慧宇的番种牌库：国标里值钱、日麻里却不是役（或只有小役）的番种，每个展开成具体牌型。
// 两类：
// - 核心面子：三组固定的面子（步高、龙、节高、同顺、三同刻）加任意一组面子、任意雀头；三色双龙会是四组固定面子加 5 的雀头
// - 只准用某些牌：全中、全大、全小、大于五、小于五、推不倒、全带五，四组面子、雀头都从准用的里挑
// 不放七对（日麻里是两番的七对子，反差小又最好凑）、清一色、对对和这些日麻里也大的。

export interface GbSet {
  pung: boolean;
  kind: Kind; // 顺子写最小的那张
}

export interface GbTarget {
  key: string; // 每个具体牌型一个（“一色三步高·万1”）
  name: string; // 番种名
  short: string; // 头像框上的简称
  fan: number; // 番种本身的国标番数
  riichiHan: number; // 做成了日麻里一般带几番役（选番种时扣分，越不是役越先做）
  fixed: GbSet[];
  pool: GbSet[]; // 剩下几组面子能从哪些里挑
  pairs: Kind[]; // 雀头能是哪些
}

// 番种做到哪一步了
export interface TargetFit {
  target: GbTarget;
  missing: number; // 还差几张
  tiles: Kind[]; // 一副做成的门内牌（不含副露），从小到大
  lit: boolean[]; // tiles 里哪几张手里已经有了
  need: Kind[]; // 还要的牌（几种拆法差的张数一样少时合起来）
  lack: Kind[]; // tiles 这一副里还差的牌
  sets: GbSet[]; // 这副牌的四组面子（含副露）
  pair: Kind;
}

// 分数 = 番数 − 5 × 还差几张 − 4 × 日麻役番：一样好做时先做日麻里不是役的
export const GB_PICK = { perMissing: 5, perRiichiHan: 4 };

const SHORT: Record<string, string> = {
  一色三步高: '步高',
  三色三步高: '三步',
  花龙: '花龙',
  一色三节高: '节高',
  一色三同顺: '同顺',
  清龙: '清龙',
  三色三节高: '三节',
  三同刻: '同刻',
  三色双龙会: '双龙',
  全中: '全中',
  全小: '全小',
  全大: '全大',
  小于五: '小五',
  大于五: '大五',
  推不倒: '推倒',
  全带五: '带五',
};

// 方案里“在日麻里”那一列：一色三节高、三色三节高门清常带三暗刻
const RIICHI_HAN: Record<string, number> = { 清龙: 2, 一色三同顺: 1, 一色三节高: 2, 三同刻: 2, 全中: 1, 全带五: 1, 三色三节高: 2 };

const SUIT = ['万', '筒', '索'];
const K = (s: number, r: number): Kind => s * 9 + r - 1;
const chow = (s: number, r: number): GbSet => ({ pung: false, kind: K(s, r) });
const pung = (k: Kind): GbSet => ({ pung: true, kind: k });
const setKinds = (x: GbSet): Kind[] => (x.pung ? [x.kind, x.kind, x.kind] : [x.kind, x.kind + 1, x.kind + 2]);

const ALL_SETS: GbSet[] = [];
for (let s = 0; s < 3; s++) for (let r = 1; r <= 7; r++) ALL_SETS.push(chow(s, r));
for (let k = 0; k < KIND_COUNT; k++) ALL_SETS.push(pung(k));
const ALL_PAIRS = Array.from({ length: KIND_COUNT }, (_, k) => k);

const PERMS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function within(kinds: Kind[]): { pool: GbSet[]; pairs: Kind[] } {
  const ok = new Set(kinds);
  return { pool: ALL_SETS.filter((x) => setKinds(x).every((k) => ok.has(k))), pairs: kinds.filter((k) => ok.has(k)) };
}

const nums = (ranks: number[]) => [0, 1, 2].flatMap((s) => ranks.map((r) => K(s, r)));

function build(): GbTarget[] {
  const out: GbTarget[] = [];
  const core = (name: string, fan: number, tag: string, fixed: GbSet[]) =>
    out.push({ key: `${name}·${tag}`, name, short: SHORT[name], fan, riichiHan: RIICHI_HAN[name] ?? 0, fixed, pool: ALL_SETS, pairs: ALL_PAIRS });
  const listed = (name: string, fan: number, pool: GbSet[], pairs: Kind[]) =>
    out.push({ key: name, name, short: SHORT[name], fan, riichiHan: RIICHI_HAN[name] ?? 0, fixed: [], pool, pairs });

  for (const [a, b, c] of PERMS) core('花龙', 8, `${SUIT[a]}${SUIT[b]}${SUIT[c]}`, [chow(a, 1), chow(b, 4), chow(c, 7)]);
  for (let st = 1; st <= 5; st++) for (const [a, b, c] of PERMS) core('三色三步高', 6, `${st}${SUIT[a]}${SUIT[b]}${SUIT[c]}`, [chow(a, st), chow(b, st + 1), chow(c, st + 2)]);
  for (let s = 0; s < 3; s++) {
    for (let st = 1; st <= 5; st++) core('一色三步高', 16, `${SUIT[s]}${st}`, [0, 1, 2].map((i) => chow(s, st + i)));
    for (let st = 1; st <= 3; st++) core('一色三步高', 16, `${SUIT[s]}${st}跳`, [0, 2, 4].map((i) => chow(s, st + i)));
    for (let st = 1; st <= 7; st++) core('一色三节高', 24, `${SUIT[s]}${st}`, [0, 1, 2].map((i) => pung(K(s, st + i))));
    for (let st = 1; st <= 7; st++) core('一色三同顺', 24, `${SUIT[s]}${st}`, [0, 1, 2].map(() => chow(s, st)));
    core('清龙', 16, SUIT[s], [chow(s, 1), chow(s, 4), chow(s, 7)]);
  }
  for (let st = 1; st <= 7; st++) for (const [a, b, c] of PERMS) core('三色三节高', 8, `${st}${SUIT[a]}${SUIT[b]}${SUIT[c]}`, [pung(K(a, st)), pung(K(b, st + 1)), pung(K(c, st + 2))]);
  for (let r = 1; r <= 9; r++) core('三同刻', 16, String(r), [0, 1, 2].map((s) => pung(K(s, r))));
  for (let x = 0; x < 3; x++) {
    const [a, b] = [0, 1, 2].filter((s) => s !== x);
    out.push({ key: `三色双龙会·${SUIT[x]}`, name: '三色双龙会', short: SHORT['三色双龙会'], fan: 16, riichiHan: 0, fixed: [chow(a, 1), chow(a, 7), chow(b, 1), chow(b, 7)], pool: [], pairs: [K(x, 5)] });
  }
  const w = (ranks: number[]) => within(nums(ranks));
  listed('全中', 24, w([4, 5, 6]).pool, w([4, 5, 6]).pairs);
  listed('全小', 24, w([1, 2, 3]).pool, w([1, 2, 3]).pairs);
  listed('全大', 24, w([7, 8, 9]).pool, w([7, 8, 9]).pairs);
  listed('小于五', 12, w([1, 2, 3, 4]).pool, w([1, 2, 3, 4]).pairs);
  listed('大于五', 12, w([6, 7, 8, 9]).pool, w([6, 7, 8, 9]).pairs);
  const five = ALL_SETS.filter((x) => x.kind < 27 && setKinds(x).some((k) => k % 9 === 4));
  listed('全带五', 16, five, [K(0, 5), K(1, 5), K(2, 5)]);
  const tbd = within([...[1, 2, 3, 4, 5, 8, 9].map((r) => K(1, r)), ...[2, 4, 5, 6, 8, 9].map((r) => K(2, r)), 31]);
  listed('推不倒', 8, tbd.pool, tbd.pairs);
  return out;
}

export const GB_TARGETS: GbTarget[] = build();

const sameSet = (a: GbSet, b: GbSet) => a.pung === b.pung && a.kind === b.kind;

// 几种拆法差的张数一样少时，最多看这么多种（合起来算“还要的牌”）
const MAX_TIES = 48;

// 这个番种离做成还差几张。hand：门内的牌（每种几张）；melds：副露（都得是这个番种的面子）；
// cap：门内每种牌最多能有几张（手里的 + 自己没看到的），要的牌都见光了就做不成，返回 null
export function fitTarget(t: GbTarget, hand: readonly number[], melds: readonly GbSet[], cap: readonly number[]): TargetFit | null {
  const fixed = t.fixed.slice();
  let free = 4 - fixed.length;
  for (const m of melds) {
    const i = fixed.findIndex((x) => sameSet(x, m));
    if (i >= 0) fixed.splice(i, 1);
    else if (free > 0 && t.pool.some((x) => sameSet(x, m))) free--;
    else return null;
  }
  const need = new Array<number>(KIND_COUNT).fill(0);
  let cost = 0;
  // 加一组牌：超过 cap 返回 -1，否则返回多差几张
  const add = (ks: Kind[]): number => {
    let d = 0;
    let bad = false;
    for (const k of ks) {
      need[k]++;
      if (need[k] > cap[k]) bad = true;
      if (need[k] > hand[k]) d++;
    }
    return bad ? -1 : d;
  };
  const drop = (ks: Kind[]) => {
    for (const k of ks) need[k]--;
  };
  for (const x of fixed) {
    const d = add(setKinds(x));
    if (d < 0) return null;
    cost += d;
  }
  let best = Infinity;
  const ties: { need: number[]; sets: GbSet[]; pair: Kind }[] = [];
  const chosen: GbSet[] = [];
  // 单独加上去要多差几张（之后再加别的只会更多）：从小到大排，超过目前最好的就不用往下看
  const alone = (ks: Kind[]) => {
    const d = add(ks);
    drop(ks);
    return d;
  };
  const pool = t.pool
    .map((x) => ({ x, ks: setKinds(x), d: alone(setKinds(x)) }))
    .filter((y) => y.d >= 0)
    .sort((a, b) => a.d - b.d);
  const pairs = t.pairs
    .map((p) => ({ p, d: alone([p, p]) }))
    .filter((y) => y.d >= 0)
    .sort((a, b) => a.d - b.d);
  const leaf = () => {
    for (const { p, d: low } of pairs) {
      if (cost + low > best) break;
      const d = add([p, p]);
      if (d >= 0) {
        const c = cost + d;
        if (c < best) {
          best = c;
          ties.length = 0;
        }
        if (c === best && ties.length < MAX_TIES) ties.push({ need: need.slice(), sets: [...chosen], pair: p });
      }
      drop([p, p]);
    }
  };
  const dfs = (slots: number, from: number) => {
    if (slots === 0) {
      leaf();
      return;
    }
    for (let i = from; i < pool.length; i++) {
      const { x, ks, d: low } = pool[i];
      if (cost + low > best) break;
      const d = add(ks);
      if (d >= 0) {
        cost += d;
        chosen.push(x);
        dfs(slots - 1, i);
        chosen.pop();
        cost -= d;
      }
      drop(ks);
    }
  };
  dfs(free, 0);
  if (!ties.length) return null;
  const first = ties[0];
  const tiles: Kind[] = [];
  for (let k = 0; k < KIND_COUNT; k++) for (let n = 0; n < first.need[k]; n++) tiles.push(k);
  const left = hand.slice();
  const lit = tiles.map((k) => left[k]-- > 0);
  const want = new Set<Kind>();
  for (const x of ties) for (let k = 0; k < KIND_COUNT; k++) if (x.need[k] > hand[k]) want.add(k);
  return {
    target: t,
    missing: best,
    tiles,
    lit,
    lack: tiles.filter((_, i) => !lit[i]),
    need: [...want].sort((a, b) => a - b),
    sets: [...melds, ...fixed, ...first.sets],
    pair: first.pair,
  };
}

export function pickScore(f: TargetFit): number {
  return f.target.fan - GB_PICK.perMissing * f.missing - GB_PICK.perRiichiHan * f.target.riichiHan;
}

// 至少还差几张（只看固定的面子，或者手里有几张准用的牌），用来先排除没希望的番种
function lowerBound(t: GbTarget, hand: readonly number[], melds: readonly GbSet[]): number {
  if (!t.fixed.length) {
    const ok = new Set<Kind>(t.pairs);
    for (const x of t.pool) for (const k of setKinds(x)) ok.add(k);
    let have = 0;
    for (const k of ok) have += hand[k];
    return Math.max(0, 14 - 3 * melds.length - have);
  }
  const need = new Array<number>(KIND_COUNT).fill(0);
  for (const x of t.fixed) if (!melds.some((m) => sameSet(m, x))) for (const k of setKinds(x)) need[k]++;
  let d = 0;
  for (let k = 0; k < KIND_COUNT; k++) d += Math.max(0, need[k] - hand[k]);
  return d;
}

// 还做得成的番种，分数高的在前（一样高时差得少的在前）。
// families：只要分数最高的这么多个番种（每个番种的最好牌型一定在里面），别的没希望的不细算
export function rankTargets(hand: readonly number[], melds: readonly GbSet[], cap: readonly number[], families = Infinity): TargetFit[] {
  const pen = (t: GbTarget) => t.fan - GB_PICK.perRiichiHan * t.riichiHan;
  const order = GB_TARGETS.map((t) => ({ t, ub: pen(t) - GB_PICK.perMissing * lowerBound(t, hand, melds) })).sort((a, b) => b.ub - a.ub);
  const out: TargetFit[] = [];
  const bestOf = new Map<string, number>();
  for (const { t, ub } of order) {
    if (bestOf.size >= families) {
      const top = [...bestOf.values()].sort((a, b) => b - a)[families - 1];
      if (ub < top) break;
    }
    const f = fitTarget(t, hand, melds, cap);
    if (!f) continue;
    out.push(f);
    const sc = pickScore(f);
    if (sc > (bestOf.get(t.name) ?? -Infinity)) bestOf.set(t.name, sc);
  }
  return out.sort((a, b) => pickScore(b) - pickScore(a) || a.missing - b.missing);
}

// 每个番种只留最好的那个牌型，取前 n 个（给玩家挑的三张番种牌）
export function topFamilies(ranked: readonly TargetFit[], n: number): TargetFit[] {
  const seen = new Set<string>();
  const out: TargetFit[] = [];
  for (const f of ranked) {
    if (seen.has(f.target.name)) continue;
    seen.add(f.target.name);
    out.push(f);
    if (out.length >= n) break;
  }
  return out;
}

export function targetByKey(key: string): GbTarget | undefined {
  return GB_TARGETS.find((t) => t.key === key);
}
