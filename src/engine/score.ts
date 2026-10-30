import { decompose, isChiitoi, isKokushi } from './agari';
import {
  CHUN,
  HAKU,
  HATSU,
  Kind,
  TileId,
  doraFromIndicator,
  isDragon,
  isHonor,
  isRed,
  isSimple,
  isTerminal,
  isWind,
  isYaochu,
  kindOf,
  suitOf,
  toCounts,
} from './tiles';

export type MeldType = 'chi' | 'pon' | 'minkan' | 'ankan' | 'kakan';

export interface Meld {
  type: MeldType;
  tiles: TileId[];
  calledTile?: TileId;
  from?: number;
}

export interface WinContext {
  closed: TileId[]; // 门内手牌，包含和了牌，共 14 - 3 × 副露数 张
  melds: Meld[];
  // 食断：false 时鸣了牌的断幺九不算（不写算）
  kuitan?: boolean;
  winTile: TileId;
  tsumo: boolean;
  seatWind: Kind;
  roundWind: Kind;
  isDealer: boolean;
  riichi?: boolean;
  doubleRiichi?: boolean;
  ippatsu?: boolean;
  haitei?: boolean;
  houtei?: boolean;
  rinshan?: boolean;
  chankan?: boolean;
  tenhou?: boolean;
  chiihou?: boolean;
  doraIndicators: Kind[];
  uraIndicators?: Kind[];
}

export interface YakuEntry {
  name: string;
  han: number; // 役满时为役满倍数 × 13
}

export interface WinResult {
  yaku: YakuEntry[];
  dora: number;
  aka: number;
  ura: number;
  han: number;
  fu: number;
  yakuman: number;
  base: number;
  limitName: string;
  ron: number; // 荣和时放铳者支付（不含本场）
  tsumoDealerPays: number; // 自摸时庄家支付（闲家和了）
  tsumoOtherPays: number; // 自摸时闲家各自支付
}

type WaitType = 'ryanmen' | 'kanchan' | 'penchan' | 'shanpon' | 'tanki';

interface HandSet {
  type: 'shuntsu' | 'koutsu' | 'kantsu';
  kind: Kind;
  open: boolean;
}

interface Shape {
  sets: HandSet[];
  head: Kind;
  wait: WaitType;
}

const ceil100 = (n: number) => Math.ceil(n / 100) * 100;

export function evaluateWin(ctx: WinContext): WinResult | null {
  const counts = toCounts(ctx.closed);
  const winKind = kindOf(ctx.winTile);
  const menzen = ctx.melds.every((m) => m.type === 'ankan');
  const candidates: WinResult[] = [];

  const meldSets: HandSet[] = ctx.melds.map((m) => ({
    type: m.type === 'chi' ? 'shuntsu' : m.type === 'pon' ? 'koutsu' : 'kantsu',
    kind: Math.min(...m.tiles.map(kindOf)),
    open: m.type !== 'ankan',
  }));

  if (ctx.melds.length === 0 && isKokushi(counts)) {
    const r = finish(ctx, [{ name: '国士无双', han: 13 }], 0, true);
    if (r) candidates.push(r);
  }

  if (ctx.melds.length === 0 && isChiitoi(counts)) {
    const r = scoreChiitoi(ctx);
    if (r) candidates.push(r);
  }

  for (const d of decompose(counts)) {
    for (const shape of shapesFor(d.head, d.blocks, winKind, ctx.tsumo)) {
      shape.sets.push(...meldSets);
      const r = scoreShape(ctx, shape, counts, menzen);
      if (r) candidates.push(r);
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.base - a.base || b.han - a.han || b.fu - a.fu);
  return candidates[0];
}

// 和了牌可能落在不同的块里，每种情况的听牌形状不同
function shapesFor(
  head: Kind,
  blocks: { type: 'shuntsu' | 'koutsu'; kind: Kind }[],
  winKind: Kind,
  tsumo: boolean,
): Shape[] {
  const out: Shape[] = [];
  const base = (): HandSet[] => blocks.map((b) => ({ type: b.type, kind: b.kind, open: false }));
  if (head === winKind) out.push({ sets: base(), head, wait: 'tanki' });
  blocks.forEach((b, i) => {
    if (b.type === 'koutsu' && b.kind === winKind) {
      const sets = base();
      // 荣和完成的刻子算明刻
      if (!tsumo) sets[i].open = true;
      out.push({ sets, head, wait: 'shanpon' });
    }
    if (b.type === 'shuntsu' && winKind >= b.kind && winKind <= b.kind + 2) {
      const pos = winKind - b.kind;
      const n = b.kind % 9; // 0 表示 123
      let wait: WaitType;
      if (pos === 1) wait = 'kanchan';
      else if (pos === 0) wait = n === 6 ? 'penchan' : 'ryanmen';
      else wait = n === 0 ? 'penchan' : 'ryanmen';
      out.push({ sets: base(), head, wait });
    }
  });
  return out;
}

function isYakuhaiKind(k: Kind, ctx: WinContext): number {
  let n = 0;
  if (isDragon(k)) n++;
  if (k === ctx.seatWind) n++;
  if (k === ctx.roundWind) n++;
  return n;
}

function situationalYaku(ctx: WinContext, menzen: boolean): YakuEntry[] {
  const y: YakuEntry[] = [];
  if (ctx.doubleRiichi) y.push({ name: '两立直', han: 2 });
  else if (ctx.riichi) y.push({ name: '立直', han: 1 });
  if (ctx.ippatsu) y.push({ name: '一发', han: 1 });
  if (ctx.tsumo && menzen) y.push({ name: '门前清自摸和', han: 1 });
  if (ctx.haitei) y.push({ name: '海底摸月', han: 1 });
  if (ctx.houtei) y.push({ name: '河底捞鱼', han: 1 });
  if (ctx.rinshan) y.push({ name: '岭上开花', han: 1 });
  if (ctx.chankan) y.push({ name: '抢杠', han: 1 });
  return y;
}

function situationalYakuman(ctx: WinContext): YakuEntry[] {
  const y: YakuEntry[] = [];
  if (ctx.tenhou) y.push({ name: '天和', han: 13 });
  if (ctx.chiihou) y.push({ name: '地和', han: 13 });
  return y;
}

function allKinds(ctx: WinContext): Kind[] {
  return [...ctx.closed, ...ctx.melds.flatMap((m) => m.tiles)].map(kindOf);
}

function colorYaku(kinds: Kind[], menzen: boolean): YakuEntry[] {
  const suits = new Set(kinds.filter((k) => !isHonor(k)).map(suitOf));
  const hasHonor = kinds.some(isHonor);
  if (suits.size === 1 && !hasHonor) return [{ name: '清一色', han: menzen ? 6 : 5 }];
  if (suits.size === 1 && hasHonor) return [{ name: '混一色', han: menzen ? 3 : 2 }];
  return [];
}

function scoreChiitoi(ctx: WinContext): WinResult | null {
  const kinds = allKinds(ctx);
  const yakuman = situationalYakuman(ctx);
  if (kinds.every(isHonor)) yakuman.push({ name: '字一色', han: 13 });
  if (yakuman.length) return finish(ctx, yakuman, 25, true);

  const yaku: YakuEntry[] = [...situationalYaku(ctx, true), { name: '七对子', han: 2 }];
  if (kinds.every(isSimple)) yaku.push({ name: '断幺九', han: 1 });
  if (kinds.every(isYaochu)) yaku.push({ name: '混老头', han: 2 });
  yaku.push(...colorYaku(kinds, true));
  return finish(ctx, yaku, 25, false);
}

function scoreShape(ctx: WinContext, shape: Shape, counts: number[], menzen: boolean): WinResult | null {
  const { sets, head } = shape;
  const kinds = allKinds(ctx);
  const triplets = sets.filter((s) => s.type !== 'shuntsu');
  const sequences = sets.filter((s) => s.type === 'shuntsu');
  const concealedTriplets = triplets.filter((s) => !s.open).length;
  const kans = sets.filter((s) => s.type === 'kantsu').length;
  const tripletKinds = triplets.map((s) => s.kind);

  // 役满
  const yakuman = situationalYakuman(ctx);
  const dragonTriplets = tripletKinds.filter(isDragon).length;
  const windTriplets = tripletKinds.filter(isWind).length;
  if (dragonTriplets === 3) yakuman.push({ name: '大三元', han: 13 });
  if (concealedTriplets === 4) yakuman.push({ name: '四暗刻', han: 13 });
  if (windTriplets === 4) yakuman.push({ name: '大四喜', han: 13 });
  else if (windTriplets === 3 && isWind(head)) yakuman.push({ name: '小四喜', han: 13 });
  if (kinds.every(isHonor)) yakuman.push({ name: '字一色', han: 13 });
  if (kinds.every((k) => [19, 20, 21, 23, 25, HATSU].includes(k))) yakuman.push({ name: '绿一色', han: 13 });
  if (kinds.every(isTerminal)) yakuman.push({ name: '清老头', han: 13 });
  if (kans === 4) yakuman.push({ name: '四杠子', han: 13 });
  if (menzen && ctx.melds.length === 0 && isChuuren(counts)) yakuman.push({ name: '九莲宝灯', han: 13 });
  if (yakuman.length) return finish(ctx, yakuman, 0, true);

  const yaku: YakuEntry[] = situationalYaku(ctx, menzen);

  const pinfu =
    menzen &&
    sequences.length === 4 &&
    shape.wait === 'ryanmen' &&
    isYakuhaiKind(head, ctx) === 0;
  if (pinfu) yaku.push({ name: '平和', han: 1 });
  if (kinds.every(isSimple) && (menzen || ctx.kuitan !== false)) yaku.push({ name: '断幺九', han: 1 });

  if (menzen) {
    const seqKinds = sequences.map((s) => s.kind).sort((a, b) => a - b);
    let pairs = 0;
    for (let i = 0; i + 1 < seqKinds.length; i++) {
      if (seqKinds[i] === seqKinds[i + 1]) {
        pairs++;
        i++;
      }
    }
    if (pairs === 2) yaku.push({ name: '二杯口', han: 3 });
    else if (pairs === 1) yaku.push({ name: '一杯口', han: 1 });
  }

  for (const k of tripletKinds) {
    if (k === HAKU) yaku.push({ name: '役牌 白', han: 1 });
    if (k === HATSU) yaku.push({ name: '役牌 发', han: 1 });
    if (k === CHUN) yaku.push({ name: '役牌 中', han: 1 });
    if (k === ctx.seatWind) yaku.push({ name: '自风牌', han: 1 });
    if (k === ctx.roundWind) yaku.push({ name: '场风牌', han: 1 });
  }

  const seqNums = (suit: number) => new Set(sequences.filter((s) => suitOf(s.kind) === suit).map((s) => s.kind % 9));
  for (let n = 0; n < 7; n++) {
    if ([0, 1, 2].every((suit) => seqNums(suit).has(n))) {
      yaku.push({ name: '三色同顺', han: menzen ? 2 : 1 });
      break;
    }
  }
  for (let suit = 0; suit < 3; suit++) {
    const ns = seqNums(suit);
    if (ns.has(0) && ns.has(3) && ns.has(6)) {
      yaku.push({ name: '一气通贯', han: menzen ? 2 : 1 });
      break;
    }
  }

  const setHasYaochu = (s: HandSet) =>
    s.type === 'shuntsu' ? isTerminal(s.kind) || isTerminal(s.kind + 2) : isYaochu(s.kind);
  if (sequences.length > 0 && sets.every(setHasYaochu) && isYaochu(head)) {
    const honors = kinds.some(isHonor);
    if (honors) yaku.push({ name: '混全带幺九', han: menzen ? 2 : 1 });
    else yaku.push({ name: '纯全带幺九', han: menzen ? 3 : 2 });
  }

  if (triplets.length === 4) yaku.push({ name: '对对和', han: 2 });
  if (concealedTriplets === 3) yaku.push({ name: '三暗刻', han: 2 });
  for (let n = 0; n < 9; n++) {
    if ([0, 1, 2].every((suit) => tripletKinds.includes(suit * 9 + n))) {
      yaku.push({ name: '三色同刻', han: 2 });
      break;
    }
  }
  if (kans === 3) yaku.push({ name: '三杠子', han: 2 });
  if (kinds.every(isYaochu)) yaku.push({ name: '混老头', han: 2 });
  if (dragonTriplets === 2 && isDragon(head)) yaku.push({ name: '小三元', han: 2 });
  yaku.push(...colorYaku(kinds, menzen));

  if (yaku.length === 0) return null;

  // 符
  let fu: number;
  if (pinfu) {
    fu = ctx.tsumo ? 20 : 30;
  } else {
    fu = 20;
    if (menzen && !ctx.tsumo) fu += 10;
    if (ctx.tsumo) fu += 2;
    for (const s of sets) {
      if (s.type === 'shuntsu') continue;
      let f = s.open ? 2 : 4;
      if (isYaochu(s.kind)) f *= 2;
      if (s.type === 'kantsu') f *= 4;
      fu += f;
    }
    fu += 2 * isYakuhaiKind(head, ctx);
    if (shape.wait === 'kanchan' || shape.wait === 'penchan' || shape.wait === 'tanki') fu += 2;
    fu = Math.ceil(fu / 10) * 10;
    if (fu === 20) fu = 30; // 副露平和形荣和
  }
  return finish(ctx, yaku, fu, false);
}

function isChuuren(counts: number[]): boolean {
  const suits = [0, 1, 2].filter((s) => counts.slice(s * 9, s * 9 + 9).some((n) => n > 0));
  if (suits.length !== 1 || counts.slice(27).some((n) => n > 0)) return false;
  const c = counts.slice(suits[0] * 9, suits[0] * 9 + 9);
  const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  return c.every((n, i) => n >= need[i]);
}

function countDora(ctx: WinContext): { dora: number; aka: number; ura: number } {
  const tiles = [...ctx.closed, ...ctx.melds.flatMap((m) => m.tiles)];
  const kinds = tiles.map(kindOf);
  const count = (indicators: Kind[]) =>
    indicators.reduce((sum, ind) => {
      const d = doraFromIndicator(ind);
      return sum + kinds.filter((k) => k === d).length;
    }, 0);
  return {
    dora: count(ctx.doraIndicators),
    aka: tiles.filter(isRed).length,
    ura: ctx.riichi || ctx.doubleRiichi ? count(ctx.uraIndicators ?? []) : 0,
  };
}

function finish(ctx: WinContext, yaku: YakuEntry[], fu: number, isYakuman: boolean): WinResult | null {
  if (yaku.length === 0) return null;
  let han = yaku.reduce((s, y) => s + y.han, 0);
  let dora = 0;
  let aka = 0;
  let ura = 0;
  let base: number;
  let limitName = '';
  let yakuman = 0;
  if (isYakuman) {
    yakuman = Math.floor(han / 13);
    base = 8000 * yakuman;
    limitName = yakuman > 1 ? `${yakuman} 倍役满` : '役满';
  } else {
    ({ dora, aka, ura } = countDora(ctx));
    han += dora + aka + ura;
    if (han >= 13) {
      base = 8000;
      limitName = '累计役满';
    } else if (han >= 11) {
      base = 6000;
      limitName = '三倍满';
    } else if (han >= 8) {
      base = 4000;
      limitName = '倍满';
    } else if (han >= 6) {
      base = 3000;
      limitName = '跳满';
    } else {
      base = fu * 2 ** (han + 2);
      if (han >= 5 || base >= 2000) {
        base = 2000;
        limitName = '满贯';
      }
    }
  }
  return {
    yaku,
    dora,
    aka,
    ura,
    han,
    fu,
    yakuman,
    base,
    limitName,
    ron: ceil100(base * (ctx.isDealer ? 6 : 4)),
    tsumoDealerPays: ceil100(base * 2),
    tsumoOtherPays: ceil100(base * (ctx.isDealer ? 2 : 1)),
  };
}
