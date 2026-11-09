import { decompose, isKokushi } from './agari';
import { KIND_COUNT, Kind, isHonor, isTerminal, isYaochu } from './tiles';

// 国标麻将（《中国麻将竞赛规则》，MCR 2006）算番。郝慧宇的能力、电脑和界面都用它。
// 只算日麻和牌形能出现的番：四面子一雀头、七对、十三幺。不算花牌，也不做全不靠、组合龙、七星不靠。
// 标准答案在 tests/fixtures/gb-fan.json（PyMahjongGB 离线生成），tests/gb-fan.test.ts 逐手对。

export type GbMeldType = 'chi' | 'pon' | 'minkan' | 'ankan';

export interface GbMeld {
  type: GbMeldType;
  kind: Kind; // 顺子写最小的那张
}

export interface GbInput {
  hand: readonly Kind[]; // 门内的牌（含和了牌），14 − 3 × 副露数 张
  melds: readonly GbMeld[];
  win: Kind;
  tsumo: boolean;
  fourth?: boolean; // 和绝张：和了牌另外三张都已经亮出来
  kong?: boolean; // 自摸是杠上开花，荣和是抢杠和
  last?: boolean; // 自摸是妙手回春，荣和是海底捞月
  seat: number; // 门风 0 东 1 南 2 西 3 北
  round: number; // 圈风
}

export interface GbFan {
  name: string;
  fan: number; // 每个的番数
  count: number;
}

export interface GbResult {
  fans: GbFan[];
  total: number;
}

export const GB_FAN_VALUE: Record<string, number> = {
  大四喜: 88, 大三元: 88, 绿一色: 88, 九莲宝灯: 88, 四杠: 88, 连七对: 88, 十三幺: 88,
  清幺九: 64, 小四喜: 64, 小三元: 64, 字一色: 64, 四暗刻: 64, 一色双龙会: 64,
  一色四同顺: 48, 一色四节高: 48,
  一色四步高: 32, 三杠: 32, 混幺九: 32,
  七对: 24, 全双刻: 24, 清一色: 24, 一色三同顺: 24, 一色三节高: 24, 全大: 24, 全中: 24, 全小: 24,
  清龙: 16, 三色双龙会: 16, 一色三步高: 16, 全带五: 16, 三同刻: 16, 三暗刻: 16,
  大于五: 12, 小于五: 12, 三风刻: 12,
  花龙: 8, 推不倒: 8, 三色三同顺: 8, 三色三节高: 8, 无番和: 8, 妙手回春: 8, 海底捞月: 8, 杠上开花: 8, 抢杠和: 8,
  碰碰和: 6, 混一色: 6, 三色三步高: 6, 五门齐: 6, 全求人: 6, 双暗杠: 6, 双箭刻: 6,
  明暗杠: 5,
  全带幺: 4, 不求人: 4, 双明杠: 4, 和绝张: 4,
  箭刻: 2, 圈风刻: 2, 门风刻: 2, 门前清: 2, 平和: 2, 四归一: 2, 双同刻: 2, 双暗刻: 2, 暗杠: 2, 断幺: 2,
  一般高: 1, 喜相逢: 1, 连六: 1, 老少副: 1, 幺九刻: 1, 明杠: 1, 缺一门: 1, 无字: 1, 边张: 1, 坎张: 1, 单钓将: 1, 自摸: 1,
};

// 番种在结果里的先后：番大的在前，同番数按上面的顺序
const ORDER = Object.keys(GB_FAN_VALUE);

type Table = Map<string, number>;

interface Pack {
  t: 'chow' | 'pung' | 'kong';
  k: Kind; // 顺子是最小的那张
  melded: boolean; // 吃、碰、明杠
  concealed: boolean; // 算暗刻（暗杠、门内没被荣和破掉的刻子）
}

const suit = (k: Kind) => Math.floor(k / 9);
const rank = (k: Kind) => (k % 9) + 1;
const GREEN = new Set([19, 20, 21, 23, 25, 32]);
// 推不倒：1234589 筒、245689 索、白
const REVERSIBLE = new Set([9, 10, 11, 12, 13, 16, 17, 19, 21, 22, 23, 25, 26, 31]);

export function gbFan(inp: GbInput): GbResult | null {
  const hand = toCounts(inp.hand);
  let best: Table | null = null;
  let bestTotal = -1;
  let bestChows = -1;
  // 番数一样时取顺子多的拆法（和 PyMahjongGB 一致）
  const consider = (t: Table | null, chows = 0) => {
    if (!t) return;
    const total = sumTable(t);
    if (total > bestTotal || (total === bestTotal && chows > bestChows)) {
      best = t;
      bestTotal = total;
      bestChows = chows;
    }
  };

  if (inp.melds.length === 0 && isKokushi(hand)) consider(scoreKokushi(inp));
  if (inp.melds.length === 0 && isSevenPairs(hand)) consider(scoreChiitoi(inp, hand));
  const waits = standardWaits(inp);
  for (const d of decompose(hand)) {
    consider(scoreStandard(inp, hand, d.head, d.blocks, waits), d.blocks.filter((b) => b.type === 'shuntsu').length);
  }
  if (!best) return null;
  return toResult(best);
}

// 国标的七对可以有四张一样的（算两对）
function isSevenPairs(c: readonly number[]): boolean {
  return c.reduce((a, b) => a + b, 0) === 14 && c.every((n) => n % 2 === 0);
}

function toCounts(kinds: readonly Kind[]): number[] {
  const c = new Array<number>(KIND_COUNT).fill(0);
  for (const k of kinds) c[k]++;
  return c;
}

function sumTable(t: Table): number {
  let s = 0;
  for (const [name, n] of t) s += GB_FAN_VALUE[name] * n;
  return s;
}

function toResult(t: Table): GbResult {
  const fans: GbFan[] = [];
  for (const [name, count] of t) if (count > 0) fans.push({ name, fan: GB_FAN_VALUE[name], count });
  fans.sort((a, b) => b.fan - a.fan || ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
  return { fans, total: fans.reduce((s, f) => s + f.fan * f.count, 0) };
}

// 门内 13 张（去掉和了牌）听几种牌，用来判断“只听一种”（边张、坎张、单钓将）。
// 和 PyMahjongGB 一样：七对的听也算（四张一样的算两对），手里已经有四张的牌也算听
function standardWaits(inp: GbInput): number {
  const c = toCounts(inp.hand);
  c[inp.win]--;
  const closed = inp.melds.length === 0;
  let n = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    c[k]++;
    if (decompose(c).length > 0 || (closed && isSevenPairs(c))) n++;
    c[k]--;
  }
  return n;
}

// 全手牌的牌种计数（暗杠、明杠算 4 张）
function allCounts(inp: GbInput): number[] {
  const c = toCounts(inp.hand);
  for (const m of inp.melds) {
    if (m.type === 'chi') for (let i = 0; i < 3; i++) c[m.kind + i]++;
    else c[m.kind] += m.type === 'pon' ? 3 : 4;
  }
  return c;
}

// 与拆法无关的花色、牌种类番
function composition(c: readonly number[], t: Table): void {
  const kinds: Kind[] = [];
  for (let k = 0; k < KIND_COUNT; k++) if (c[k]) kinds.push(k);
  const suits = new Set(kinds.filter((k) => k < 27).map(suit));
  const honors = kinds.some(isHonor);
  const nums = kinds.filter((k) => k < 27).map(rank);
  const allNum = !honors;
  const set = (n: string) => t.set(n, 1);

  if (kinds.every((k) => GREEN.has(k))) set('绿一色');
  if (kinds.every(isHonor)) set('字一色');
  else if (kinds.every((k) => isTerminal(k))) set('清幺九');
  else if (kinds.every(isYaochu)) set('混幺九');

  if (suits.size === 1 && allNum) set('清一色');
  else if (suits.size === 1 && honors) set('混一色');

  if (allNum) {
    if (nums.every((r) => r >= 7)) set('全大');
    else if (nums.every((r) => r >= 4 && r <= 6)) set('全中');
    else if (nums.every((r) => r <= 3)) set('全小');
    if (nums.every((r) => r >= 6)) set('大于五');
    if (nums.every((r) => r <= 4)) set('小于五');
  }
  if (kinds.every((k) => REVERSIBLE.has(k))) set('推不倒');
  if (kinds.every((k) => !isYaochu(k))) set('断幺');
  if (suits.size === 3 && kinds.some((k) => k >= 27 && k <= 30) && kinds.some((k) => k >= 31)) set('五门齐');
  if (suits.size === 2) set('缺一门');
  if (allNum) set('无字');
}

const CHOW2_ORDER = ['一般高', '喜相逢', '连六', '老少副'];

// 两组顺子的番（只取一个）
function chow2(a: Kind, b: Kind): string | null {
  if (a === b) return '一般高';
  if (rank(a) === rank(b)) return '喜相逢';
  if (suit(a) === suit(b) && Math.abs(a - b) === 3) return '连六';
  if (suit(a) === suit(b) && Math.abs(a - b) === 6) return '老少副';
  return null;
}

function chow3(a: Kind, b: Kind, c: Kind): string | null {
  const s = [a, b, c].sort((x, y) => x - y);
  const ss = s.map(suit);
  const rr = s.map(rank);
  const sameSuit = ss[0] === ss[1] && ss[1] === ss[2];
  const diffSuit = new Set(ss).size === 3;
  if (diffSuit) {
    const r = [...rr].sort((x, y) => x - y);
    if (r[1] === r[0] + 1 && r[2] === r[1] + 1) return '三色三步高';
    if (r[0] === r[1] && r[1] === r[2]) return '三色三同顺';
    if (r[0] === 1 && r[1] === 4 && r[2] === 7) return '花龙';
    return null;
  }
  if (!sameSuit) return null;
  if ((rr[1] === rr[0] + 1 && rr[2] === rr[1] + 1) || (rr[1] === rr[0] + 2 && rr[2] === rr[1] + 2)) return '一色三步高';
  if (rr[0] === rr[1] && rr[1] === rr[2]) return '一色三同顺';
  if (rr[0] === 1 && rr[1] === 4 && rr[2] === 7) return '清龙';
  return null;
}

function chow4(m: readonly Kind[]): string | null {
  const s = [...m].sort((x, y) => x - y);
  if (new Set(s.map(suit)).size !== 1) return null;
  const d = [s[1] - s[0], s[2] - s[1], s[3] - s[2]];
  if (d.every((x) => x === 1) || d.every((x) => x === 2)) return '一色四步高';
  if (d.every((x) => x === 0)) return '一色四同顺';
  return null;
}

function chowFans(chows: readonly Kind[], t: Table): void {
  const add = (n: string) => t.set(n, (t.get(n) ?? 0) + 1);
  const n = chows.length;
  if (n < 2) return;
  if (n === 4) {
    const f = chow4(chows);
    if (f) {
      add(f);
      return;
    }
  }
  if (n >= 3) {
    const triples = n === 4 ? [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] : [[0, 1, 2]];
    for (const tr of triples) {
      const f = chow3(chows[tr[0]], chows[tr[1]], chows[tr[2]]);
      if (!f) continue;
      add(f);
      if (n === 4) {
        const rest = [0, 1, 2, 3].find((i) => !tr.includes(i))!;
        // 余下那组只和三组里的一组算一次，番种按一般高、喜相逢、连六、老少副的先后挑
        const found = tr.map((i) => chow2(chows[i], chows[rest])).filter((g): g is string => !!g);
        found.sort((a, b) => CHOW2_ORDER.indexOf(a) - CHOW2_ORDER.indexOf(b));
        if (found.length) add(found[0]);
      }
      return;
    }
  }
  // 没有三组顺子的番：两两组合，按套算一次原则不成环（n 组最多 n − 1 个）
  const parent = chows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  // 番种按一般高、喜相逢、连六、老少副的先后挑，同一种先看相邻的两组
  const pairs: { i: number; j: number; g: string; o: number }[] = [];
  for (let gap = 1; gap < n; gap++) {
    for (let i = 0; i + gap < n; i++) {
      const g = chow2(chows[i], chows[i + gap]);
      if (g) pairs.push({ i, j: i + gap, g, o: CHOW2_ORDER.indexOf(g) * 10 + pairs.length });
    }
  }
  pairs.sort((a, b) => a.o - b.o);
  for (const { i, j, g } of pairs) {
    {
      const a = find(i);
      const b = find(j);
      if (a === b) continue;
      parent[a] = b;
      add(g);
    }
  }
}

function pung2(a: Kind, b: Kind): string | null {
  if (a < 27 && b < 27 && a !== b && rank(a) === rank(b)) return '双同刻';
  if (a >= 31 && b >= 31) return '双箭刻';
  return null;
}

function pung3(a: Kind, b: Kind, c: Kind): string | null {
  const s = [a, b, c].sort((x, y) => x - y);
  if (s[2] < 27) {
    const ss = s.map(suit);
    const r = s.map(rank).sort((x, y) => x - y);
    const consecutive = r[1] === r[0] + 1 && r[2] === r[1] + 1;
    if (new Set(ss).size === 3 && consecutive) return '三色三节高';
    if (ss[0] === ss[1] && ss[1] === ss[2] && s[1] === s[0] + 1 && s[2] === s[1] + 1) return '一色三节高';
    if (new Set(ss).size === 3 && r[0] === r[1] && r[1] === r[2]) return '三同刻';
    return null;
  }
  if (s[0] >= 27 && s[2] <= 30) return '三风刻';
  if (s[0] === 31 && s[1] === 32 && s[2] === 33) return '大三元';
  return null;
}

function pung4(m: readonly Kind[]): string | null {
  const s = [...m].sort((x, y) => x - y);
  if (s[3] < 27 && new Set(s.map(suit)).size === 1 && s[1] === s[0] + 1 && s[2] === s[1] + 1 && s[3] === s[2] + 1) {
    return '一色四节高';
  }
  if (s[0] === 27 && s[1] === 28 && s[2] === 29 && s[3] === 30) return '大四喜';
  return null;
}

function pungFans(pungs: readonly Kind[], t: Table): void {
  const add = (n: string) => t.set(n, (t.get(n) ?? 0) + 1);
  const n = pungs.length;
  if (n < 2) return;
  if (n === 4) {
    const f = pung4(pungs);
    if (f) {
      add(f);
      return;
    }
  }
  if (n >= 3) {
    const triples = n === 4 ? [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] : [[0, 1, 2]];
    for (const tr of triples) {
      const f = pung3(pungs[tr[0]], pungs[tr[1]], pungs[tr[2]]);
      if (!f) continue;
      add(f);
      if (n === 4) {
        const rest = [0, 1, 2, 3].find((i) => !tr.includes(i))!;
        for (const i of [...tr].reverse()) {
          const g = pung2(pungs[i], pungs[rest]);
          if (g) {
            add(g);
            break;
          }
        }
      }
      return;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const g = pung2(pungs[i], pungs[j]);
      if (g) add(g);
    }
  }
}

function scoreStandard(
  inp: GbInput,
  hand: readonly number[],
  head: Kind,
  blocks: readonly { type: 'shuntsu' | 'koutsu'; kind: Kind }[],
  waits: number,
): Table | null {
  const t: Table = new Map();
  const add = (n: string, c = 1) => t.set(n, (t.get(n) ?? 0) + c);
  const set = (n: string) => t.set(n, 1);
  const has = (n: string) => (t.get(n) ?? 0) > 0;
  const del = (...ns: string[]) => ns.forEach((n) => t.delete(n));

  const packs: Pack[] = [];
  for (const m of inp.melds) {
    if (m.type === 'chi') packs.push({ t: 'chow', k: m.kind, melded: true, concealed: false });
    else if (m.type === 'pon') packs.push({ t: 'pung', k: m.kind, melded: true, concealed: false });
    else packs.push({ t: 'kong', k: m.kind, melded: m.type === 'minkan', concealed: m.type === 'ankan' });
  }
  // 荣和的那张如果只能落在门内的刻子里，这组刻子算明刻
  const winInChow = blocks.some((b) => b.type === 'shuntsu' && inp.win >= b.kind && inp.win <= b.kind + 2);
  const winInHead = head === inp.win;
  for (const b of blocks) {
    if (b.type === 'shuntsu') packs.push({ t: 'chow', k: b.kind, melded: false, concealed: false });
    else {
      const broken = !inp.tsumo && b.kind === inp.win && !winInChow && !winInHead;
      packs.push({ t: 'pung', k: b.kind, melded: false, concealed: !broken });
    }
  }
  const chows = packs.filter((p) => p.t === 'chow').map((p) => p.k).sort((a, b) => a - b);
  const pungs = packs.filter((p) => p.t !== 'chow').map((p) => p.k).sort((a, b) => a - b);
  const all = allCounts(inp);

  composition(all, t);

  // 九莲宝灯：门清一色，去掉和了牌是 1112345678999
  if (inp.melds.length === 0 && has('清一色')) {
    const s = suit(head);
    const c = hand.slice(s * 9, s * 9 + 9);
    c[inp.win - s * 9]--;
    if (c.every((n, i) => n === (i === 0 || i === 8 ? 3 : 1))) set('九莲宝灯');
  }

  // 每组牌、雀头都带幺九 / 带五
  const packHas = (p: Pack, ok: (k: Kind) => boolean) => (p.t === 'chow' ? [p.k, p.k + 1, p.k + 2].some(ok) : ok(p.k));
  if (packs.every((p) => packHas(p, isYaochu)) && isYaochu(head)) set('全带幺');
  const isFive = (k: Kind) => k < 27 && rank(k) === 5;
  if (packs.every((p) => packHas(p, isFive)) && isFive(head)) set('全带五');
  // 全双刻：都是刻子，牌都是双数
  const even = (k: Kind) => k < 27 && rank(k) % 2 === 0;
  if (chows.length === 0 && pungs.every(even) && even(head)) set('全双刻');

  if (chows.length === 4 && head < 27) set('平和');
  if (pungs.length === 4) set('碰碰和');

  // 双龙会：一组 123、789 加 5 的雀头
  let dragonPair = false;
  if (chows.length === 4 && head < 27 && rank(head) === 5) {
    const r = chows.map(rank);
    const ss = chows.map(suit);
    if (new Set(ss).size === 1 && ss[0] === suit(head) && r[0] === 1 && r[1] === 1 && r[2] === 7 && r[3] === 7) {
      set('一色双龙会');
      dragonPair = true;
    } else {
      const bySuit = new Map<number, number[]>();
      chows.forEach((k) => bySuit.set(suit(k), [...(bySuit.get(suit(k)) ?? []), rank(k)]));
      const ok =
        bySuit.size === 2 &&
        [...bySuit.values()].every((rs) => rs.length === 2 && rs.includes(1) && rs.includes(7)) &&
        !bySuit.has(suit(head));
      if (ok) {
        set('三色双龙会');
        dragonPair = true;
      }
    }
  }
  if (!dragonPair) chowFans(chows, t);
  pungFans(pungs, t);

  // 四喜、三元
  const windPungs = pungs.filter((k) => k >= 27 && k <= 30).length;
  const dragonPungs = pungs.filter((k) => k >= 31).length;
  if (windPungs === 3 && head >= 27 && head <= 30) set('小四喜');
  if (dragonPungs === 2 && head >= 31) set('小三元');

  // 单个刻子：箭刻、风刻、幺九刻
  const bigWinds = has('大四喜');
  const windNoYaochu = has('三风刻') || has('混幺九') || has('字一色') || has('小四喜') || bigWinds;
  for (const k of pungs) {
    if (k >= 31) {
      if (!has('大三元') && !has('小三元')) add('箭刻');
    } else if (k >= 27) {
      let deducted = windNoYaochu;
      if (!bigWinds && k - 27 === inp.round) {
        set('圈风刻');
        deducted = true;
      }
      if (!bigWinds && k - 27 === inp.seat) {
        set('门风刻');
        deducted = true;
      }
      if (!deducted) add('幺九刻');
    } else if (isTerminal(k)) {
      if (!has('清幺九') && !has('混幺九')) add('幺九刻');
    }
  }
  if (has('大三元') || has('小三元')) del('双箭刻');

  // 杠
  const kongs = packs.filter((p) => p.t === 'kong');
  const ankan = kongs.filter((p) => !p.melded).length;
  const minkan = kongs.length - ankan;
  if (kongs.length === 4) set('四杠');
  else if (kongs.length === 3) set('三杠');
  else if (kongs.length === 2) set(ankan === 2 ? '双暗杠' : minkan === 2 ? '双明杠' : '明暗杠');
  else if (kongs.length === 1) set(ankan ? '暗杠' : '明杠');

  // 暗刻
  const concealed = packs.filter((p) => p.t !== 'chow' && p.concealed).length;
  if (concealed === 4) set('四暗刻');
  else if (concealed === 3) set('三暗刻');
  else if (concealed === 2 && !has('双暗杠')) set('双暗刻');

  // 四归一：同一种牌四张都用上，又不是杠
  const kongKinds = new Set(kongs.map((p) => p.k));
  for (let k = 0; k < KIND_COUNT; k++) if (all[k] === 4 && !kongKinds.has(k)) add('四归一');

  winFans(inp, packs, t);

  // 边张、坎张、单钓将：只听一种牌时才算
  if (waits === 1 && !has('全求人') && !has('四杠')) {
    // 同一种拆法里几种都说得通时，先算边张，再坎张，最后单钓将
    const edge = blocks.some(
      (b) => b.type === 'shuntsu' && ((rank(b.kind) === 1 && b.kind + 2 === inp.win) || (rank(b.kind) === 7 && b.kind === inp.win)),
    );
    if (edge) set('边张');
    else if (blocks.some((b) => b.type === 'shuntsu' && b.kind + 1 === inp.win)) set('坎张');
    else if (head === inp.win) set('单钓将');
  }

  exclude(t);
  if (sumTable(t) === 0) set('无番和');
  return t;
}

function winFans(inp: GbInput, packs: readonly Pack[], t: Table): void {
  const set = (n: string) => t.set(n, 1);
  const melded = packs.filter((p) => p.melded).length;
  if (melded === 0) set(inp.tsumo ? '不求人' : '门前清');
  else if (melded === 4) set(inp.tsumo ? '自摸' : '全求人');
  else if (inp.tsumo) set('自摸');
  // 和绝张、抢杠和：门内只有和了的这一张，不然场上凑不齐另外三张（自己副露里的算亮出来的）
  const solo = inp.hand.filter((k) => k === inp.win).length === 1;
  // 另外三张都在自己的副露里，也是和绝张
  const inMelds = allCounts(inp)[inp.win] - inp.hand.filter((k) => k === inp.win).length;
  if ((inp.fourth || inMelds === 3) && solo) set('和绝张');
  if (inp.last) set(inp.tsumo ? '妙手回春' : '海底捞月');
  if (inp.kong && inp.tsumo) set('杠上开花');
  // 抢杠和：别人加杠的那张，自己手里连副露都不能再有
  if (inp.kong && !inp.tsumo && allCounts(inp)[inp.win] === 1) set('抢杠和');
}

// 不计：含在大番里的小番
const EXCLUDES: Record<string, string[]> = {
  大四喜: ['圈风刻', '门风刻', '三风刻', '碰碰和'],
  大三元: ['箭刻', '双箭刻'],
  绿一色: ['混一色'],
  九莲宝灯: ['清一色', '门前清', '不求人', '无字'],
  四杠: ['碰碰和', '单钓将'],
  连七对: ['清一色', '七对', '不求人', '门前清', '单钓将', '无字'],
  十三幺: ['五门齐', '不求人', '门前清', '单钓将', '混幺九'],
  清幺九: ['混幺九', '碰碰和', '全带幺', '幺九刻', '无字', '双同刻'],
  小四喜: ['三风刻'],
  小三元: ['箭刻', '双箭刻'],
  字一色: ['碰碰和', '全带幺', '幺九刻', '混幺九'],
  四暗刻: ['门前清', '碰碰和', '不求人'],
  一色双龙会: ['平和', '七对', '清一色', '一般高', '老少副', '无字'],
  一色四同顺: ['一色三节高', '一般高', '四归一', '一色三同顺'],
  一色四节高: ['一色三同顺', '碰碰和', '一色三节高'],
  一色四步高: ['一色三步高'],
  混幺九: ['碰碰和', '幺九刻', '全带幺'],
  七对: ['不求人', '门前清', '单钓将'],
  全双刻: ['碰碰和', '断幺', '无字'],
  清一色: ['无字'],
  一色三同顺: ['一色三节高'],
  一色三节高: ['一色三同顺'],
  全大: ['无字', '大于五'],
  全中: ['断幺', '无字'],
  全小: ['无字', '小于五'],
  三色双龙会: ['喜相逢', '老少副', '无字', '平和'],
  全带五: ['断幺', '无字'],
  大于五: ['无字'],
  小于五: ['无字'],
  推不倒: ['缺一门'],
  妙手回春: ['自摸'],
  杠上开花: ['自摸'],
  抢杠和: ['和绝张'],
  全求人: ['单钓将'],
  双箭刻: ['箭刻'],
  平和: ['无字'],
  断幺: ['无字'],
};

// 这些番不计不求人，但自摸照算
const KEEP_TSUMO = ['七对', '连七对', '十三幺', '四暗刻', '九莲宝灯'];

function exclude(t: Table): void {
  if (t.get('不求人') && KEEP_TSUMO.some((n) => t.get(n))) t.set('自摸', 1);
  // 九莲宝灯不计一个幺九刻
  if (t.get('九莲宝灯') && t.get('幺九刻')) t.set('幺九刻', t.get('幺九刻')! - 1);
  for (const [big, smalls] of Object.entries(EXCLUDES)) {
    if (!t.get(big)) continue;
    for (const s of smalls) t.delete(s);
  }
}

function scoreKokushi(inp: GbInput): Table {
  const t: Table = new Map([['十三幺', 1]]);
  winFans(inp, [], t);
  exclude(t);
  return t;
}

function scoreChiitoi(inp: GbInput, hand: readonly number[]): Table {
  const t: Table = new Map();
  const kinds: Kind[] = [];
  for (let k = 0; k < KIND_COUNT; k++) if (hand[k]) kinds.push(k);
  const run = kinds.length === 7 && kinds.every((k) => k < 27) && new Set(kinds.map(suit)).size === 1 && kinds[6] - kinds[0] === 6;
  t.set(run ? '连七对' : '七对', 1);
  composition(hand, t);
  for (let k = 0; k < KIND_COUNT; k++) if (hand[k] === 4) t.set('四归一', (t.get('四归一') ?? 0) + 1);
  // 全带幺、全带五、全双刻对七对也照样看每个对子
  winFans(inp, [], t);
  exclude(t);
  return t;
}
