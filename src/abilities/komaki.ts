import type { Game } from '../engine/game';
import { Rng } from '../engine/rng';
import { shanten, waitingKinds } from '../engine/shanten';
import { KIND_COUNT, Kind, TileId, isHonor, isWind, isYaochu, kindOf, suitOf, toCounts } from '../engine/tiles';
import { placeHand } from './awai';
import { seatCost } from './costs';
import { isDoraTile } from './kuro';
import type { Ability } from './types';

// 神代小莳（永水）：东一局起在睡觉，开局时随机一位神明附身（初始神不会是天宇受卖命）。
// 看不见的计时器从 KOMAKI.timer 开始，每过一局（连庄也算一局），桌上每有一位 3 费以上的对手就减一；她自己每和一次也减一。
// 减到 0 以后的下一局起她醒了：没有能力，换成天宇受卖命的神乐：每被点和一次积一点，满 KOMAKI.kagura 点立刻降下新神（和初始神不同），
// 新神一直留到这一场结束。神乐封印不了（蛇神威、天照都封不住醒着的她）。
// 九位神明（id 也是素材页上的动画槽）：
// - 琼琼杵尊·降临：配牌就听牌（天听）
// - 木花咲耶姬·樱花火山：配牌有两组暗刻；容易摸到能杠的第四张；杠后岭上牌一定是进张（听牌时是和了牌）；开了第三杠以后，听牌就自摸
// - 磐长姬·诅咒：有对手的手牌朝大牌走（宝牌多、染手、字牌多）时，她的进张快得多，抢在前面和小牌
// - 天照·天岩户：其他人的能力全部失效（照这样别人动不了的不算）；照魔镜照不穿她；看得出手里哪张会放铳；进张效率上升
// - 须佐之男·暴风：配牌偏幺九牌和风牌；每碰一次，进张效率上升
// - 天宇受卖命·神乐：醒来以后才有（见上）
// - 稻荷神·丰收：手里万子、筒子、索子哪门最多，摸到的就几乎都是那一门
// - 大国主神·结缘：进张效率上升；有嵌张补嵌张，有孤张把孤张连成对子、刻子
// - 建御雷神·威压：立直以后强力压住其他三家的进张，一发的那一巡很容易自摸
export const KOMAKI = {
  timer: 10,
  strongCost: 3, // 几费以上算强者
  kagura: 3, // 被点和几次降下新神
  ninigiTries: 200,
  sakuyaKan: 0.5, // 摸到能杠的第四张
  iwanaga: 0.7,
  amaterasu: 0.4,
  susanooBase: 0.1,
  susanooPerPon: 0.15,
  susanooMax: 0.6,
  susanooYaochu: 9, // 配牌里幺九牌和风牌至少几张
  inari: 0.85,
  okuni: 0.6,
  takePress: 0.7,
  takeIppatsu: 0.6,
};

export const KOMAKI_GODS = [
  { id: 'ninigi', name: '琼琼杵尊', skill: '降临', desc: '配牌就听牌（天听）' },
  { id: 'sakuya', name: '木花咲耶姬', skill: '樱花火山', desc: '配牌有两组暗刻，杠后必定进张，三杠必定自摸' },
  { id: 'iwanaga', name: '磐长姬', skill: '诅咒', desc: '对手往大牌做时，她的手牌成型得更快，都是小牌' },
  { id: 'amaterasu', name: '天照', skill: '天岩户', desc: '其他人的能力失效，照魔镜照不穿她，看得出手里的铳牌，进张效率上升' },
  { id: 'susanoo', name: '须佐之男', skill: '暴风', desc: '配牌偏幺九牌和风牌，每碰一次进张效率上升' },
  { id: 'uzume', name: '天宇受卖命', skill: '神乐', desc: `醒来以后才有：每被点和一次积一点，满 ${KOMAKI.kagura} 点降下新神` },
  { id: 'inari', name: '稻荷神', skill: '丰收', desc: '手里哪门数牌最多，进张就一直是那一门' },
  { id: 'okuni', name: '大国主神', skill: '结缘', desc: '进张效率上升，补嵌张，把孤张连成对子、刻子' },
  { id: 'take', name: '建御雷神', skill: '威压', desc: '立直以后强力压制其他三家，一发很容易自摸' },
] as const;
export type GodId = (typeof KOMAKI_GODS)[number]['id'];
const godOf = (id: GodId) => KOMAKI_GODS.find((x) => x.id === id)!;
// 能降下来的神（天宇受卖命不算）
const DESCENDING = KOMAKI_GODS.map((x) => x.id).filter((id) => id !== 'uzume');

interface KomakiGameState {
  first?: GodId; // 初始神
  second?: GodId; // 神乐降下的新神
  secondFrom?: number; // 新神从第几局起
  kagura?: number; // 醒来以后被点和了几次
  wins?: number[]; // 她在第几局和了（计时器每次减一）
  ended?: number; // g.events 里看过几次 roundEnd（第 n 次是第 n 局）
  seen?: number; // g.events 里看到哪了
}
interface KomakiState {
  announced?: boolean;
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as KomakiGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as KomakiState;

// 用开局的种子另起一个随机数挑神：什么时候问都一样，也不动牌局的随机数
function pickGod(g: Game, seat: number, salt: number, not?: GodId): GodId {
  const rng = new Rng((g.seed * 31 + seat * 7919 + salt * 104729) ^ 0x6b6d6b);
  const pool = DESCENDING.filter((id) => id !== not);
  return pool[rng.int(pool.length)];
}

// 桌上 3 费以上的对手有几个
export function komakiStrong(g: Game, seat: number): number {
  return [0, 1, 2, 3].filter((s) => s !== seat && seatCost(g, s) >= KOMAKI.strongCost).length;
}

// 看不见的计时器：第 round 局开始时还剩几点（之前的局：每局减强者数，她和一次减一）
function timerOf(g: Game, seat: number, gs: KomakiGameState, round: number): number {
  const won = (gs.wins ?? []).filter((r) => r < round).length;
  return Math.max(0, KOMAKI.timer - komakiStrong(g, seat) * Math.max(0, round - 1) - won);
}
export function komakiTimer(g: Game, seat: number, round = g.round): number {
  return timerOf(g, seat, sync(g, seat), round);
}

// 第 round 局还在睡
export function komakiAsleep(g: Game, seat: number, round = g.round): boolean {
  return komakiTimer(g, seat, round) > 0;
}

// 把打完的局算进神乐：醒来以后每被点和一次积一点，满了降下新神（下一局起）
function sync(g: Game, seat: number): KomakiGameState {
  const gs = gameStateOf(g, seat);
  gs.first ??= pickGod(g, seat, 1);
  for (let i = gs.seen ?? 0; i < g.events.length; i++) {
    const e = g.events[i];
    if (e.type !== 'roundEnd') continue;
    const round = (gs.ended = (gs.ended ?? 0) + 1);
    const asleep = timerOf(g, seat, gs, round) > 0;
    if (e.result.wins.some((w) => w.seat === seat)) (gs.wins ??= []).push(round);
    if (gs.second || asleep) continue;
    if (!e.result.wins.some((w) => w.from === seat)) continue;
    gs.kagura = (gs.kagura ?? 0) + 1;
    if (gs.kagura >= KOMAKI.kagura) {
      gs.second = pickGod(g, seat, 2, gs.first);
      gs.secondFrom = round + 1;
    }
  }
  gs.seen = g.events.length;
  return gs;
}

// 第 round 局附身的神：睡着是初始神，醒了是 null，神乐降下新神以后是新神
export function komakiGod(g: Game, seat: number, round = g.round): GodId | null {
  const gs = sync(g, seat);
  if (komakiAsleep(g, seat, round)) return gs.first!;
  if (gs.second && round >= gs.secondFrom!) return gs.second;
  return null;
}

// 这一局起作用的神（被封印就没有）
export function komakiActiveGod(g: Game, seat: number): GodId | null {
  return g.active(seat)?.id === 'komaki' ? komakiGod(g, seat) : null;
}

// 神乐积了几点（还没醒、新神已经降下来是 null）
export function komakiKagura(g: Game, seat: number): number | null {
  const gs = sync(g, seat);
  if (komakiAsleep(g, seat) || gs.second) return null;
  return gs.kagura ?? 0;
}

// ---------- 摸牌 ----------

// 摸牌前把下一张换成进张（能减少向听的牌）。prefer：先挑这些；strict：只要这些
function boost(g: Game, seat: number, chance: number, prefer?: (k: Kind) => boolean, strict = false): boolean {
  if (!g.rng.chance(chance)) return false;
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const m = p.melds.length;
  const sh = shanten(counts, m);
  if (sh < 0) return false;
  const useful = (t: TileId) => {
    counts[kindOf(t)]++;
    const after = shanten(counts, m);
    counts[kindOf(t)]--;
    return after < sh;
  };
  const w = g.wall;
  const top = w.live[0];
  if (useful(top) && (!prefer || prefer(kindOf(top)))) return false;
  if (prefer && w.bringToLive(0, (t) => useful(t) && prefer(kindOf(t)), g.rng)) return true;
  if (strict || useful(top)) return false;
  return w.bringToLive(0, useful, g.rng);
}

// 一家的手牌在往大牌走：宝牌（含赤宝牌）3 张以上、一门数牌加字牌占 11 张以上、或者字牌 8 张以上
export function bigHand(g: Game, seat: number): boolean {
  const p = g.players[seat];
  const tiles = [...p.hand, ...p.melds.flatMap((m) => m.tiles)];
  if (tiles.filter((t) => isDoraTile(g, t)).length >= 3) return true;
  const per = [0, 0, 0, 0];
  for (const t of tiles) per[suitOf(kindOf(t))]++;
  const scale = 14 / Math.max(14, tiles.length); // 杠出来的牌多，按 14 张折算
  if ((Math.max(per[0], per[1], per[2]) + per[3]) * scale >= 11) return true;
  return per[3] * scale >= 8;
}

// 嵌张缺的那张、孤张（左右两格内没有同门的牌）
function bondKinds(counts: number[]): Set<Kind> {
  const out = new Set<Kind>();
  for (let k = 0; k < 27; k++) {
    const n = k % 9;
    if (n <= 6 && counts[k] > 0 && counts[k + 2] > 0 && counts[k + 1] === 0) out.add(k + 1);
    if (counts[k] !== 1) continue;
    let lonely = true;
    for (let d = -2; d <= 2; d++) if (d !== 0 && n + d >= 0 && n + d <= 8 && counts[k + d] > 0) lonely = false;
    if (lonely) out.add(k);
  }
  for (let k = 27; k < KIND_COUNT; k++) if (counts[k] === 1) out.add(k);
  return out;
}

// 木花咲耶姬：手里的暗刻、碰过的牌（第四张能杠）
function kanKinds(g: Game, seat: number): Kind[] {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const out: Kind[] = [];
  for (let k = 0; k < KIND_COUNT; k++) if (counts[k] === 3) out.push(k);
  for (const m of p.melds) if (m.type === 'pon') out.push(kindOf(m.tiles[0]));
  return out;
}
const kansOf = (g: Game, seat: number) => g.players[seat].melds.filter((m) => m.type === 'ankan' || m.type === 'minkan' || m.type === 'kakan').length;

// ---------- 配牌 ----------

// 琼琼杵尊：随机配一手听牌（三组面子 + 雀头 + 两面搭子）。accept：别人对她配牌的规矩
function planTenpai(avail: number[], rng: Rng, accept: (kinds: Kind[]) => boolean): Kind[] | null {
  for (let attempt = 0; attempt < KOMAKI.ninigiTries; attempt++) {
    const need = new Array<number>(KIND_COUNT).fill(0);
    for (let i = 0; i < 3; i++) {
      if (rng.chance(0.3)) need[rng.int(KIND_COUNT)] += 3;
      else {
        const k = rng.int(3) * 9 + rng.int(7);
        need[k]++;
        need[k + 1]++;
        need[k + 2]++;
      }
    }
    need[rng.int(KIND_COUNT)] += 2;
    const r = rng.int(3) * 9 + 1 + rng.int(6);
    need[r]++;
    need[r + 1]++;
    if (need.some((n, k) => n > avail[k] || n > 4)) continue;
    if (waitingKinds(need, 0).length === 0) continue;
    const kinds: Kind[] = [];
    need.forEach((n, k) => {
      for (let i = 0; i < n; i++) kinds.push(k);
    });
    if (accept(kinds)) return kinds;
  }
  return null;
}

// 木花咲耶姬：配牌里凑两组暗刻（第四张还在牌山里），其余的牌尽量不动
function planTriplets(g: Game, seat: number): Kind[] | null {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  const cur = mine.map((i) => kindOf(w.live[i]));
  const counts = toCounts(mine.map((i) => w.live[i]));
  const pool = toCounts([...mine.map((i) => w.live[i]), ...w.live.slice(52)].filter((t) => !w.locked.has(t)));
  const cands = g.rng.shuffle(Array.from({ length: KIND_COUNT }, (_, k) => k).filter((k) => pool[k] === 4));
  cands.sort((a, b) => counts[b] - counts[a]);
  if (cands.length < 2) return null;
  const [a, b] = cands;
  // 第四张留在牌山里给她杠
  const out = cur.slice();
  for (const k of [a, b]) while (out.filter((x) => x === k).length > 3) out.splice(out.indexOf(k), 1);
  // 腾出位置：先拿掉孤张，再随便拿
  const lonely = bondKinds(counts);
  const others = g.rng.shuffle(out.filter((x) => x !== a && x !== b)).sort((x, y) => Number(lonely.has(y)) - Number(lonely.has(x)));
  const need = 6 - out.filter((x) => x === a || x === b).length;
  const drop = others.slice(0, Math.max(0, out.length + need - 13));
  for (const k of drop) out.splice(out.indexOf(k), 1);
  for (const k of [a, b]) while (out.filter((x) => x === k).length < 3) out.push(k);
  return out.length === 13 ? out : null;
}

// 须佐之男：把配牌里的中张换成幺九牌、风牌，先挑手里已经有的（凑对子），向听不变差就换
function stormDeal(g: Game, seat: number): void {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  for (let n = 0; n < 6; n++) {
    const tiles = mine.map((i) => w.live[i]);
    if (tiles.filter((t) => isYaochu(kindOf(t))).length >= KOMAKI.susanooYaochu) return;
    const counts = toCounts(tiles);
    const cur = shanten(counts);
    let done = false;
    for (const i of g.rng.shuffle(mine.filter((i) => !isYaochu(kindOf(w.live[i]))))) {
      const k = kindOf(w.live[i]);
      counts[k]--;
      const fine = (t: TileId) => {
        if (!isYaochu(kindOf(t))) return false;
        counts[kindOf(t)]++;
        const ok = shanten(counts) <= cur + 1;
        counts[kindOf(t)]--;
        return ok;
      };
      const paired = (t: TileId) => fine(t) && counts[kindOf(t)] > 0;
      const windy = (t: TileId) => fine(t) && isWind(kindOf(t));
      done = w.bringToLive(i, paired, g.rng, (j) => j >= 52) || w.bringToLive(i, windy, g.rng, (j) => j >= 52) || w.bringToLive(i, fine, g.rng, (j) => j >= 52);
      counts[k]++;
      if (done) break;
    }
    if (!done) return;
  }
}

function sameKinds(hand: TileId[], kinds: Kind[]): boolean {
  return [...hand].map(kindOf).sort((x, y) => x - y).join() === [...kinds].sort((x, y) => x - y).join();
}

export const komakiAbility: Ability = {
  id: 'komaki',
  name: '神降',
  description: `开局就睡着，随机一位神明附身（${KOMAKI_GODS.filter((x) => x.id !== 'uzume')
    .map((x) => x.name)
    .join('、')}），各有各的能力。桌上的强者（${KOMAKI.strongCost} 费以上）越多、她自己和得越多，醒得越早；醒来后变回无能力者，换成天宇受卖命的神乐（封印不了）：每被点和一次积一点，满 ${KOMAKI.kagura} 点立刻降下新神。`,

  dealRules(g, seat) {
    sync(g, seat);
  },

  beforeDeal(g, seat) {
    const god = komakiGod(g, seat);
    const w = g.wall;
    const mine = g.dealIndices(seat);
    if (god === 'ninigi') {
      const others = g.dealRules.filter((r) => r.target === seat && r.seat !== seat);
      const avail = toCounts(w.live.filter((t) => !w.locked.has(t) && others.every((r) => r.bad([t]) === 0)));
      const plan =
        planTenpai(avail, g.rng, (kinds) => others.every((r) => r.bad(kinds.map((k) => k * 4 + 1)) === 0)) ?? planTenpai(toCounts(w.live), g.rng, () => true);
      if (!plan) return;
      if (placeHand(g, mine, plan) || g.dealFallback(seat, () => placeHand(g, mine, plan))) {
        g.addDealRule({ seat, ability: 'komaki', text: '降临', target: seat, bad: (hand) => (sameKinds(hand, plan) ? 0 : 1) });
      }
    } else if (god === 'sakuya') {
      const plan = planTriplets(g, seat);
      if (!plan) return;
      if (placeHand(g, mine, plan) || g.dealFallback(seat, () => placeHand(g, mine, plan))) {
        g.addDealRule({ seat, ability: 'komaki', text: '樱花火山', target: seat, bad: (hand) => Math.max(0, 2 - toCounts(hand).filter((n) => n >= 3).length) });
      }
    } else if (god === 'susanoo') stormDeal(g, seat);
  },

  onRoundStart(g, seat) {
    const gs = sync(g, seat);
    const god = komakiGod(g, seat);
    const st = stateOf(g, seat);
    if (st.announced) return;
    st.announced = true;
    // 第一局降神；醒来的那一局；神乐降下新神的那一局
    if (god && komakiAsleep(g, seat) && g.round === 1) g.emit({ type: 'ability', seat, ability: 'komaki', text: godOf(god).name });
    else if (!komakiAsleep(g, seat) && komakiAsleep(g, seat, g.round - 1)) g.emit({ type: 'ability', seat, ability: 'komaki', text: '醒来' });
    if (gs.second && g.round === gs.secondFrom) {
      g.emit({ type: 'ability', seat, ability: 'komaki', text: '神乐' });
      g.emit({ type: 'ability', seat, ability: 'komaki', text: godOf(gs.second).name });
    }
  },

  // 神乐（醒着、新神还没降下来）封印不了
  unsealable(g, seat, round) {
    return komakiGod(g, seat, round) === null;
  },

  // 琼琼杵尊的天听配牌：坐庄时第一张不给天和
  noTenhou(g, seat) {
    return komakiGod(g, seat) === 'ninigi';
  },

  // 天照：其他人的能力全部失效（自己被别人封住时不算）
  seals(g, seat, round) {
    if (komakiGod(g, seat, round) !== 'amaterasu') return false;
    return !g.abilities.some((a, o) => o !== seat && a?.id !== 'komaki' && !!a?.seals?.(g, o, round));
  },

  // 建御雷神：立直以后压住别人的进张
  beforeAnyDraw(g, seat, drawer, rinshan) {
    if (drawer === seat || rinshan || komakiGod(g, seat) !== 'take' || !g.players[seat].riichi) return;
    if (!g.rng.chance(KOMAKI.takePress)) return;
    const p = g.players[drawer];
    const counts = toCounts(p.hand);
    const m = p.melds.length;
    const sh = shanten(counts, m);
    return {
      seat,
      ability: 'komaki',
      text: '威压',
      deny: (t) => {
        counts[kindOf(t)]++;
        const better = shanten(counts, m) < sh;
        counts[kindOf(t)]--;
        return better;
      },
    };
  },

  beforeDraw(g, seat, rinshan) {
    const god = komakiGod(g, seat);
    if (!god) return;
    const p = g.players[seat];
    const w = g.wall;
    const say = (text: string) => g.emit({ type: 'ability', seat, ability: 'komaki', text });
    if (god === 'sakuya') {
      const waits = g.waits(seat);
      // 杠后岭上牌：听牌就是和了牌，不然是进张
      if (rinshan) {
        if (waits.length ? w.bringToRinshan((t) => waits.includes(kindOf(t)), g.rng) : bringUsefulRinshan(g, seat)) say('樱花火山');
        return;
      }
      // 开了三杠以后，听牌就自摸
      if (kansOf(g, seat) >= 3 && waits.length && w.bringToLive(0, (t) => waits.includes(kindOf(t)), g.rng)) {
        say('樱花火山');
        return;
      }
      if (g.totalKans() >= 4 || w.remaining <= 1) return;
      const kinds = kanKinds(g, seat);
      if (kinds.length && g.rng.chance(KOMAKI.sakuyaKan)) w.bringToLive(0, (t) => kinds.includes(kindOf(t)), g.rng);
      return;
    }
    if (rinshan) return;
    if (god === 'iwanaga') {
      if ([0, 1, 2, 3].some((s) => s !== seat && bigHand(g, s)) && boost(g, seat, KOMAKI.iwanaga)) say('诅咒');
    } else if (god === 'amaterasu') boost(g, seat, KOMAKI.amaterasu);
    else if (god === 'susanoo') {
      const pons = p.melds.filter((m) => m.type === 'pon').length;
      boost(g, seat, Math.min(KOMAKI.susanooMax, KOMAKI.susanooBase + KOMAKI.susanooPerPon * pons));
    } else if (god === 'inari') {
      const per = [0, 0, 0];
      for (const t of p.hand) if (!isHonor(kindOf(t))) per[suitOf(kindOf(t))]++;
      const suit = per.indexOf(Math.max(...per));
      const inSuit = (k: Kind) => suitOf(k) === suit;
      if (!g.rng.chance(KOMAKI.inari)) return;
      if (!boost(g, seat, 1, inSuit, true) && !inSuit(kindOf(w.live[0]))) w.bringToLive(0, (t) => inSuit(kindOf(t)), g.rng);
    } else if (god === 'okuni') {
      const bonds = bondKinds(toCounts(p.hand));
      if (!g.rng.chance(KOMAKI.okuni)) return;
      if (!boost(g, seat, 1, (k) => bonds.has(k)) && !bonds.has(kindOf(w.live[0]))) w.bringToLive(0, (t) => bonds.has(kindOf(t)), g.rng);
    } else if (god === 'take') {
      // 一发的那一巡：下一张就是和了牌
      const waits = g.waits(seat);
      if (p.ippatsu && waits.length && g.rng.chance(KOMAKI.takeIppatsu) && w.bringToLive(0, (t) => waits.includes(kindOf(t)), g.rng)) say('威压');
    }
  },

  // 照魔镜照不穿天照
  mirrorProof(g, seat) {
    return komakiActiveGod(g, seat) === 'amaterasu';
  },

  badge(g, seat) {
    const god = komakiGod(g, seat);
    if (komakiAsleep(g, seat)) return `睡·${godOf(god!).name}`;
    if (god) return godOf(god).name;
    return `神乐 ${komakiKagura(g, seat) ?? 0}/${KOMAKI.kagura}`;
  },

  skill(g, seat) {
    const god = komakiGod(g, seat);
    if (god) {
      const x = godOf(god);
      return { label: `${x.name}·${x.skill}`, note: `${komakiAsleep(g, seat) ? '睡着，' : '神乐降下的新神，'}${x.desc}`, enabled: false, active: true };
    }
    const n = komakiKagura(g, seat) ?? 0;
    return { label: '神乐', note: `醒着，没有能力。被点和一次积一点，满 ${KOMAKI.kagura} 点降下新神`, enabled: false, meter: { value: n, max: KOMAKI.kagura } };
  },

  insight(g, seat) {
    const god = komakiGod(g, seat);
    if (god) {
      const x = godOf(god);
      return [`${komakiAsleep(g, seat) ? '睡着' : '神乐降神'}：${x.name}附身`, `${x.skill}：${x.desc}`];
    }
    return ['醒着，没有能力', `神乐：被点和 ${komakiKagura(g, seat) ?? 0}/${KOMAKI.kagura} 次`];
  },
};

// 岭上牌换成进张
function bringUsefulRinshan(g: Game, seat: number): boolean {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const m = p.melds.length;
  const sh = shanten(counts, m);
  return g.wall.bringToRinshan((t) => {
    counts[kindOf(t)]++;
    const after = shanten(counts, m);
    counts[kindOf(t)]--;
    return after < sh;
  }, g.rng);
}
