import type { Game } from '../engine/game';
import type { Rng } from '../engine/rng';
import { shanten } from '../engine/shanten';
import { type Kind, type TileId, doraFromIndicator, isRed, kindLabel, kindOf, toCounts } from '../engine/tiles';
import { awaiWaitingForCorner } from './awai';
import { avoidOwnUra } from './doraControl';
import type { Ability } from './types';

// 宫永咲（清澄）：岭上开花。
// - 岭上的线：配牌那一刻（谁都还没看到牌）四张岭上牌就定下来，之后谁也换不走（锁住），她一直看得见
//   （界面上鼠标移到岭上牌上投影出来）。每一张随机是：再杠牌（她某个对子的同种牌：双碰能和，对子长成暗刻时摸到它接着再杠）、
//   搭子牌（补上她配牌里一个搭子：嵌张、两面）、孤张牌（她一张孤张的同种牌：单骑）、字牌（多半是废牌，留一张也能单骑）、不安排。
//   开杠那一刻不换牌：杠了摸到的就是看到的那张。玩家和电脑都朝着“杠完正好听岭上那张”做牌
// - 杠材：刻子形成之前，第四张在哪不显示、也不安排。手里成刻（或者碰出来）的那一刻，第四张还在牌山里的话，
//   落到她接下来某一次摸牌的位置上（隔几次随机），从此看得见（透明、牌山前面投影）、不再动。别人鸣牌把它错开就错开
// - 天意的手（看不见的引导）：配牌偏对子，对子的另外两张留在牌山里（不发进别人的配牌）；对子容易长成刻子；
//   有杠材、快做成的时候，容易摸到让手牌正好听岭上那张的牌
// - 淡的时间迟滞只把她压到 SAKI.awaiLag 向听（原作里别人五向听，她七对子四向听）。淡等着转角暗杠时，
//   她留着淡要摸的那张岭上牌的对子、刻子，等淡打出来大明杠
// - 天意（正负零）：她下意识地往 29500–30500 打。离得太远（落后）时天意发力，领先太多就收手
// - 她的杠一般不给自己加宝牌：她开杠翻出的杠宝牌、她和牌时的里宝牌不指向她自己的牌（doraControl），岭上摸到赤宝牌照常可以
// - 会被稳乃的深山削弱，满 6 个标记的稳乃在场时失效
// 强度参数（测试和平衡脚本会临时改它们）
export const SAKI = {
  // 配牌时每一张岭上牌按这个权重抽一种
  line: { kan: 3, shape: 4, single: 2, honor: 2, free: 2 },
  lineMin: 2, // 四张里至少几张贴着她的手牌（再杠牌、搭子牌、孤张牌）
  keepPairs: 1, // 配牌时把她对子的另外两张留在牌山里（发到别人配牌里的换出来）
  kanReach: [1, 4], // 成刻时第四张落在她接下来第几次摸牌上（这个范围里随机）
  pairTile: 0.3, // 没立直时，对子长成刻子
  guide: 0.35, // 有杠材时，摸到让手牌往“听岭上那张”前进的牌
  guideWithin: 2, // 离“开杠就和”还差这么几张以内才引导
  dealPairs: 2, // 配牌至少几个对子（刻子也算）
  dealPairExtra: 0.4, // 再多一个对子的概率
  awaiLag: 4, // 淡的时间迟滞只压到几向听
  // 天意：正负零的目标
  target: 30000,
  band: 500,
  pushBelow: 8000, // 比目标少这么多：天意发力
  calmAbove: 8000, // 比目标多这么多：收手
  push: { kanReach: [1, 2], pairTile: 0.5, guide: 0.6 },
  calm: { kanReach: [2, 5], pairTile: 0.12, guide: 0.15 },
  // 电脑的咲：牌山剩这么多张以内不再留着杠等岭上，能杠就杠
  late: 12,
  advance: false, // 只有一个杠材时也拿它杠来进手（不留着等开花）
  holdGap: 1, // 杠完听的不是岭上那张：差这么几张以内就能改成听它时，留着不杠
  lineLead: 1, // 朝着岭上做牌比一般做法慢这么多向听以内，还是朝着岭上做
  damaWithin: 1, // 朝着岭上做牌的向听在这以内时不立直
};

export type SakiMood = 'push' | 'even' | 'calm';

// 天意：现在离正负零多远
export function sakiMood(g: Game, seat: number): SakiMood {
  const d = g.players[seat].score - SAKI.target;
  if (d <= -SAKI.pushBelow) return 'push';
  if (d >= SAKI.calmAbove) return 'calm';
  return 'even';
}

function power(g: Game, seat: number) {
  const m = sakiMood(g, seat);
  return m === 'push' ? SAKI.push : m === 'calm' ? SAKI.calm : SAKI;
}

interface SakiState {
  // 已经安排过第四张的杠材（一种牌只安排一次）
  placed?: Kind[];
}
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as SakiState;

function handKinds(g: Game, seat: number, n: number): number[] {
  const counts = toCounts(g.players[seat].hand);
  const kinds: number[] = [];
  for (let k = 0; k < 34; k++) if (counts[k] === n) kinds.push(k);
  return kinds;
}

// 杠材：手里的暗刻、碰出去的刻子
export function sakiKanKinds(g: Game, seat: number): Kind[] {
  const kinds = handKinds(g, seat, 3);
  for (const m of g.players[seat].melds) if (m.type === 'pon') kinds.push(kindOf(m.tiles[0]));
  return kinds;
}

// 她看见的牌都锁着，记着是她看见的（别人的锁可以同时在）
const lockOf = (seat: number) => `saki-${seat}`;
const mine = (g: Game, seat: number, t: TileId) => g.wall.locked.ownersOf(t).includes(lockOf(seat));

// 牌山里她看得见的杠材第四张（成刻那一刻定下来的）
export function sakiKanTiles(g: Game, seat: number): Set<TileId> {
  const placed = stateOf(g, seat).placed ?? [];
  return new Set(g.wall.live.filter((t) => placed.includes(kindOf(t)) && mine(g, seat, t)));
}

// 她看得见的岭上牌（按摸的顺序）
export function sakiRinshan(g: Game, seat: number): TileId[] {
  return g.wall.rinshan.filter((t) => mine(g, seat, t));
}

// 她看得穿的全部牌：岭上牌和牌山里杠材的第四张
export function sakiSeesThrough(g: Game, seat: number): Set<TileId> {
  return new Set([...sakiRinshan(g, seat), ...sakiKanTiles(g, seat)]);
}

// 测试局自己摆牌山（sakiStage）：配牌时她定好、锁住的岭上牌先松开，摆完开局时（onRoundStart）再按摆好的锁上
export function sakiReleaseLine(g: Game, seat: number): void {
  for (const t of g.wall.rinshan) g.wall.locked.delete(t, lockOf(seat));
}

// 岭上的线：接下来几张岭上牌是哪种牌。只算她看得见的（从第一张起连着的）
export function sakiLine(g: Game, seat: number): Kind[] {
  const out: Kind[] = [];
  for (const t of g.wall.rinshan) {
    if (!mine(g, seat, t)) break;
    out.push(kindOf(t));
  }
  return out;
}

// 淡在等转角暗杠：她摸的岭上牌是现在的第一张岭上牌。淡立直了只能打出来
export function sakiAwaiFeed(g: Game, seat: number): Kind | null {
  if (!g.wall.rinshan.length) return null;
  for (let s = 0; s < 4; s++) {
    if (s === seat || g.active(s)?.id !== 'awai') continue;
    if (awaiWaitingForCorner(g, s) !== null) return kindOf(g.wall.rinshan[0]);
  }
  return null;
}

// ---------- 朝着岭上做牌 ----------

// 开花还差几张：rest 是去掉杠材以后的手牌（张数），melds 是开完这一杠的副露数，line 是接下来的岭上牌。
// 0：开杠摸到岭上牌就和了。岭上牌正好是手里暗刻的第四张时可以接着再杠，看下一张岭上牌
export function bloomGap(rest: number[], melds: number, line: readonly Kind[], i = 0): number {
  const x = line[i];
  // 一种牌只有四张：手里已经四张的（假设多摸一张时会碰到）不算。向听的缓存也只认 0–4 张
  if (x === undefined || rest[x] >= 4) return 99;
  rest[x]++;
  let best = shanten(rest, melds) + 1;
  rest[x]--;
  if (rest[x] === 3 && i + 1 < line.length) {
    rest[x] = 0;
    best = Math.min(best, bloomGap(rest, melds + 1, line, i + 1));
    rest[x] = 3;
  }
  return best;
}

export interface KanSource {
  kind: Kind;
  rest: number[]; // 去掉这个杠材以后的手牌
  melds: number; // 开完杠的副露数
  ready: boolean; // 第四张已经在手里
}

// 她能开（或者等第四张来了就能开）的杠。counts 是手牌张数，wallOnly：第四张不在手里的，只算牌山里看得见第四张的
export function sakiKanSources(g: Game, seat: number, counts: readonly number[], wallOnly = true): KanSource[] {
  const p = g.players[seat];
  const coming = new Set([...sakiKanTiles(g, seat)].map(kindOf));
  const out: KanSource[] = [];
  for (let k = 0; k < 34; k++) {
    if (counts[k] < 3) continue;
    const ready = counts[k] === 4;
    if (!ready && wallOnly && !coming.has(k)) continue;
    const rest = counts.slice();
    rest[k] = 0;
    out.push({ kind: k, rest, melds: p.melds.length + 1, ready });
  }
  for (const m of p.melds) {
    if (m.type !== 'pon') continue;
    const k = kindOf(m.tiles[0]);
    const ready = counts[k] >= 1;
    if (!ready && wallOnly && !coming.has(k)) continue;
    const rest = counts.slice();
    if (ready) rest[k]--;
    out.push({ kind: k, rest, melds: p.melds.length, ready });
  }
  return out;
}

// 朝着岭上做牌的向听数，和一般的向听数一个刻度（0：再来一张就和，相当于听牌）。counts 是打完牌的手牌（13 张那一型）。
// 第四张在手里的：差几张有用的牌就能开杠和，减一；还在牌山里的：等它来的那一下也算一张。没有杠材是 null
export function sakiLineShanten(g: Game, seat: number, counts: readonly number[]): { sh: number; src: KanSource } | null {
  const line = sakiLine(g, seat);
  if (line.length === 0 || g.totalKans() >= 4) return null;
  let best: { sh: number; src: KanSource } | null = null;
  for (const src of sakiKanSources(g, seat, counts)) {
    const gap = bloomGap(src.rest, src.melds, line);
    const sh = src.ready ? gap - 1 : gap;
    if (!best || sh < best.sh) best = { sh, src };
  }
  return best;
}

// ---------- 配牌 ----------

// 配牌偏对子：把孤张换成另一张孤张的同种牌，凑到 want 个对子
function pairUp(g: Game, seat: number, want: number): void {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  for (let n = 0; n < 4; n++) {
    const counts = toCounts(mine.map((i) => w.live[i]));
    if (counts.filter((c) => c >= 2).length >= want) return;
    const singles = new Set(counts.flatMap((c, k) => (c === 1 ? [k] : [])));
    if (singles.size < 2) return;
    let done = false;
    for (const i of g.rng.shuffle(mine.filter((j) => singles.has(kindOf(w.live[j]))))) {
      const k = kindOf(w.live[i]);
      if (w.bringToLive(i, (t) => kindOf(t) !== k && singles.has(kindOf(t)), g.rng, (j) => j >= 52)) {
        done = true;
        break;
      }
    }
    if (!done) return;
  }
}

// 她对子的另外两张留在牌山里：发到别人配牌里的换出来
function keepPairs(g: Game, seat: number): void {
  const w = g.wall;
  const own = new Set(g.dealIndices(seat));
  const counts = toCounts(g.dealHand(seat));
  for (let i = 0; i < 52; i++) {
    if (own.has(i) || counts[kindOf(w.live[i])] < 2 || !g.rng.chance(SAKI.keepPairs)) continue;
    w.bringToLive(i, (t) => counts[kindOf(t)] < 2, g.rng, (j) => j >= 52);
  }
}

type LineRole = keyof typeof SAKI.line;
const NEAR: LineRole[] = ['kan', 'shape', 'single'];

function pickRole(rng: Rng, roles: LineRole[]): LineRole {
  const total = roles.reduce((s, r) => s + SAKI.line[r], 0);
  if (total <= 0) return 'free';
  let x = rng.next() * total;
  for (const r of roles) {
    x -= SAKI.line[r];
    if (x < 0) return r;
  }
  return roles[roles.length - 1];
}

// 这种岭上牌可以是哪些牌：按她的配牌算
function roleKinds(role: LineRole, c: readonly number[]): Kind[] {
  const out: Kind[] = [];
  const has = (k: Kind, d: number) => k % 9 + d >= 0 && k % 9 + d <= 8 && c[k + d] > 0;
  for (let k = 0; k < 34; k++) {
    if (role === 'kan') {
      if (c[k] >= 2) out.push(k);
    } else if (role === 'shape') {
      if (k >= 27 || c[k] >= 3) continue;
      if ((has(k, -1) && has(k, 1)) || (has(k, -2) && has(k, -1)) || (has(k, 1) && has(k, 2))) out.push(k);
    } else if (role === 'single') {
      if (c[k] === 1) out.push(k);
    } else if (role === 'honor') {
      if (k >= 27 && c[k] <= 1) out.push(k);
    }
  }
  if (role !== 'single') return out;
  // 孤张：先挑旁边没有牌的（字牌、落单的数牌）
  const lone = out.filter((k) => k >= 27 || ![-2, -1, 1, 2].some((d) => has(k, d)));
  return lone.length ? lone : out;
}

// 配牌时定岭上的线：四张岭上牌各抽一种，从牌山后面（不动任何人的配牌）换进来，然后锁住
function setLine(g: Game, seat: number): void {
  const w = g.wall;
  const c = toCounts(g.dealHand(seat));
  const all = Object.keys(SAKI.line) as LineRole[];
  const roles = w.rinshan.map(() => pickRole(g.rng, all));
  const slots = g.rng.shuffle(roles.map((_, i) => i));
  for (const i of slots) {
    if (roles.filter((r) => NEAR.includes(r)).length >= SAKI.lineMin) break;
    if (!NEAR.includes(roles[i])) roles[i] = pickRole(g.rng, NEAR);
  }
  // 玄在场：宝牌只给玄，岭上不放宝牌
  const kuro = [0, 1, 2, 3].some((s) => s !== seat && g.isAbsolute(s));
  const dora = new Set(w.visibleDoraIndicators().map((t) => doraFromIndicator(kindOf(t))));
  const allowed = (t: TileId) => !kuro || (!isRed(t) && !dora.has(kindOf(t)));
  const used = new Set<Kind>();
  const from = (j: number) => j >= 52;
  roles.forEach((role, i) => {
    const kinds = roleKinds(role, c);
    const fresh = kinds.filter((k) => !used.has(k));
    const want = new Set(fresh.length ? fresh : kinds);
    if (!(want.size && w.bringToRinshan((t) => want.has(kindOf(t)) && allowed(t), g.rng, i, from))) w.bringToRinshan(allowed, g.rng, i, from);
    used.add(kindOf(w.rinshan[i]));
    w.locked.add(w.rinshan[i], lockOf(seat));
  });
}

// ---------- 杠材 ----------

// 手里成刻了（或者碰出来了）：第四张还在牌山里的话，落到她接下来某一次摸牌的位置上，从此看得见、不再动。
// first：假设没人鸣牌，她下一次摸的是 live 的第几张。被压住、削弱时不挪，在原来的位置现出来
function placeKan(g: Game, seat: number, first: number): void {
  const st = stateOf(g, seat);
  st.placed ??= [];
  const w = g.wall;
  for (const k of sakiKanKinds(g, seat)) {
    if (st.placed.includes(k)) continue;
    st.placed.push(k);
    const at = w.live.findIndex((t) => kindOf(t) === k);
    if (at < 0) continue;
    const t = w.live[at];
    const [lo, hi] = power(g, seat).kanReach;
    // 本来就在她这几次摸牌的路上：不动
    const near = at >= first && (at - first) % 4 === 0 && (at - first) / 4 < hi;
    if (!near && !w.locked.has(t) && !g.quelled(seat) && !g.damped(seat)) {
      const n = lo + g.rng.int(hi - lo + 1);
      // 抽到的那一次摸牌的位置换不了（锁着、牌山不够长）就往近处找，再往远处找
      const tries = [n, ...Array.from({ length: n - 1 }, (_, i) => n - 1 - i), n + 1, n + 2];
      for (const d of tries) {
        const j = first + 4 * (d - 1);
        if (j >= w.live.length - 1) continue;
        if (w.swapLive(at, j)) break;
      }
    }
    w.locked.add(t, lockOf(seat));
    g.emit({ type: 'ability', seat, ability: 'saki', text: '杠的气息', moved: true });
  }
}

export const sakiAbility: Ability = {
  id: 'saki',
  name: '岭上开花',
  description: `岭上的线：四张岭上牌配牌时就定好、一直看得见（鼠标移到岭上牌上投影出来），开杠时不会变，杠了摸到的就是看到的那张；它们多半贴着她的配牌（对子的同种牌、搭子缺的那张、孤张的同种牌），也会混进字牌。朝着“杠完正好听岭上那张”做牌，开杠就是岭上开花。杠材：手里成刻（或碰出来）时，牌山里的第四张落到她接下来第 ${SAKI.kanReach[0]}–${SAKI.kanReach[1]} 次摸牌的位置，变透明、牌山前面投影出牌面；别人鸣牌会把它错开。天意的手：配牌偏对子，对子容易长成刻子，快做成时容易摸到要的牌。淡的时间迟滞只压到 ${SAKI.awaiLag} 向听。天意：往正负零（${SAKI.target - SAKI.band}–${SAKI.target + SAKI.band}）打，落后 ${SAKI.pushBelow} 以上时天意发力，领先 ${SAKI.calmAbove} 以上收手。她的杠一般不给自己加宝牌、里宝牌（岭上的赤宝牌照拿）。`,

  lagShanten: SAKI.awaiLag,

  beforeDeal(g, seat) {
    pairUp(g, seat, SAKI.dealPairs + (g.rng.chance(SAKI.dealPairExtra) ? 1 : 0));
    keepPairs(g, seat);
    setLine(g, seat);
  },

  onRoundStart(g, seat) {
    // 配牌时被深山削弱、线没排成：岭上牌照样看得见，看见了就不再变
    for (const t of g.wall.rinshan) g.wall.locked.add(t, lockOf(seat));
    // 配牌就有暗刻
    placeKan(g, seat, (seat - g.dealer + 4) % 4);
  },

  // 摸成了刻子：打完这张，别人各摸一张，她再摸的是 live[3]
  afterDraw(g, seat) {
    if (!g.rinshanDraw) placeKan(g, seat, 3);
  },

  onCall(g, seat, caller, call) {
    if (caller === seat && call === '碰') placeKan(g, seat, 3);
  },

  beforeDraw(g: Game, seat: number, rinshan: boolean) {
    const p = g.players[seat];
    const pw = power(g, seat);
    const line = sakiLine(g, seat);
    if (rinshan) {
      // 岭上牌早就定好了，这里不换牌：摸上来正好和了就喊出来
      const c = toCounts(p.hand);
      if (line.length && bloomGap(c, p.melds.length, line.slice(0, 1)) === 0) g.emit({ type: 'ability', seat, ability: 'saki', text: '岭上开花' });
      return;
    }
    if (g.totalKans() >= 4 || g.wall.remaining <= 1) return;
    const counts = toCounts(p.hand);
    // 对子容易长成刻子，为开杠做准备。淡等着转角暗杠时，先长岭上那张牌的对子（等淡打出来大明杠）；
    // 再先长岭上有同种牌的对子（长成暗刻，杠上摸到它接着再杠）
    const pairs = handKinds(g, seat, 2);
    if (!p.riichi && pairs.length > 0 && g.rng.chance(pw.pairTile)) {
      const feed = sakiAwaiFeed(g, seat);
      if (feed !== null && pairs.includes(feed) && g.wall.bringToLive(0, (t) => kindOf(t) === feed, g.rng)) return;
      const chain = pairs.filter((k) => line.includes(k));
      if (chain.length && g.wall.bringToLive(0, (t) => chain.includes(kindOf(t)), g.rng)) return;
      if (g.wall.bringToLive(0, (t) => pairs.includes(kindOf(t)), g.rng)) return;
    }
    // 天意的手：有杠材、离开花不远时，摸到让手牌往“听岭上那张”前进的牌
    if (p.riichi || line.length === 0 || !g.rng.chance(pw.guide)) return;
    const srcs = sakiKanSources(g, seat, counts);
    if (srcs.length === 0) return;
    const gaps = srcs.map((s) => bloomGap(s.rest, s.melds, line));
    const gap = Math.min(...gaps);
    if (gap <= 0 || gap > SAKI.guideWithin) return;
    const want = new Set<Kind>();
    srcs.forEach((s, i) => {
      if (gaps[i] !== gap) return;
      for (let k = 0; k < 34; k++) {
        if (counts[k] >= 4) continue;
        s.rest[k]++;
        if (bloomGap(s.rest, s.melds, line) < gap) want.add(k);
        s.rest[k]--;
      }
    });
    if (want.size) g.wall.bringToLive(0, (t) => want.has(kindOf(t)), g.rng);
  },

  // 和牌时里宝牌不指向她自己的牌
  claimUra(g, seat, winTile) {
    avoidOwnUra(g, seat, winTile);
  },

  badge(g, seat) {
    const m = sakiMood(g, seat);
    return m === 'push' ? '天意' : null;
  },

  insight(g, seat) {
    const kinds = sakiKanKinds(g, seat);
    const m = sakiMood(g, seat);
    const mood = m === 'push' ? '天意发力中（离正负零太远）' : m === 'calm' ? '领先太多，收着打' : '在正负零附近';
    return [kinds.length ? `在等杠：${kinds.map(kindLabel).join('、')}` : '手里还没有能杠的刻子', '看得见岭上牌，朝着杠完正好听那一张做牌', mood];
  },
};

// 电脑的咲：要不要开这个杠。after 是杠完的手牌（张数），melds 是杠完的副露数
export function sakiKanOk(g: Game, seat: number, after: number[], melds: number): boolean {
  const p = g.players[seat];
  if (p.riichi || g.wall.remaining <= 8) return true;
  const sh = shanten(after, melds);
  const line = sakiLine(g, seat);
  // 看不见岭上牌（被封住之类）：听牌才杠
  if (line.length === 0) return sh === 0;
  // 开花：杠完摸到岭上牌就和了（或者接着再杠、最后和了）
  const gap = bloomGap(after, melds, line);
  if (gap === 0) return true;
  const k = line[0];
  const late = g.wall.remaining <= SAKI.late;
  // 再杠：岭上那张是手里暗刻的第四张，接着杠下去不比留着慢
  if (after[k] === 3 && line.length > 1) {
    const c = after.slice();
    c[k] = 0;
    if (bloomGap(c, melds + 1, line.slice(1)) <= gap) return true;
  }
  // 杠来进手：岭上那张摸进来能前进。手里还有别的杠材（留着开花）才这样用，不然留着这一杠等开花
  // （手里已经四张的牌不会再来一张：不算。向听的缓存也只认 0–4 张）
  const c = after.slice();
  if (c[k] < 4) {
    c[k]++;
    if (shanten(c, melds) < sh && (late || SAKI.advance || sakiKanSources(g, seat, after).length > 0)) return true;
  }
  // 杠完听牌，可是听的不是岭上那张：只差一张就能改成听它时先留着杠，不然就杠（多摸一张）
  return sh === 0 && (gap > SAKI.holdGap || late);
}
