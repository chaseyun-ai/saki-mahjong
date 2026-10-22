import type { Ability } from '../abilities/types';
import { Rng } from './rng';
import { Meld, WinResult, evaluateWin } from './score';
import { shanten, waitingKinds } from './shanten';
import {
  EAST,
  Kind,
  TileId,
  YAOCHU_KINDS,
  isRed,
  isWind,
  kindOf,
  toCounts,
} from './tiles';
import { Wall } from './wall';

export type Action =
  | { type: 'discard'; tile: TileId; riichi?: boolean }
  | { type: 'tsumo' }
  | { type: 'ankan'; kind: Kind }
  | { type: 'kakan'; tile: TileId }
  | { type: 'kyuushu' }
  | { type: 'ron' }
  | { type: 'pon'; tiles: [TileId, TileId] }
  | { type: 'chi'; tiles: [TileId, TileId] }
  | { type: 'daiminkan' }
  | { type: 'pass' };

export interface Discard {
  tile: TileId;
  riichi: boolean;
  tsumogiri: boolean;
  called: boolean;
}

export interface PlayerState {
  seat: number;
  name: string;
  score: number;
  hand: TileId[];
  melds: Meld[];
  discards: Discard[];
  drawn: TileId | null;
  riichi: boolean;
  doubleRiichi: boolean;
  riichiPending: boolean;
  ippatsu: boolean;
  furitenTemp: boolean;
  furitenRiichi: boolean;
  kuikaeBan: Kind[];
}

export type Phase = 'turn' | 'calls' | 'roundEnd' | 'gameEnd';

export interface WinInfo {
  seat: number;
  from: number | null; // null 为自摸
  tile: TileId;
  hand: TileId[];
  melds: Meld[];
  result: WinResult;
  uraIndicators: TileId[];
}

export interface RoundResult {
  kind: 'win' | 'exhaustive' | 'abortive';
  reason?: string;
  wins: WinInfo[];
  tenpai: boolean[];
  deltas: number[];
}

export type GameEvent =
  | { type: 'roundStart'; label: string }
  | { type: 'draw'; seat: number }
  | { type: 'discard'; seat: number; tile: TileId; riichi: boolean }
  | { type: 'call'; seat: number; call: string }
  | { type: 'ability'; seat: number; ability: string; text: string }
  | { type: 'roundEnd'; result: RoundResult };

export interface PlayerConfig {
  name: string;
  ability?: Ability | null;
}

export interface GameOptions {
  seed: number;
  players: PlayerConfig[];
  startScore?: number;
}

const WIND_NAMES = ['东', '南', '西', '北'];

export class Game {
  rng: Rng;
  players: PlayerState[];
  abilities: (Ability | null)[];
  // 能力的私有状态，按座位存
  abilityState: Record<string, unknown>[] = [{}, {}, {}, {}];

  roundWind = 0; // 0 东场，1 南场
  roundNumber = 0; // 0-3，等于庄家座位
  honba = 0;
  riichiSticks = 0;
  wall!: Wall;

  phase: Phase = 'turn';
  turn = 0;
  lastDiscard: { seat: number; tile: TileId } | null = null;
  pending = new Map<number, Action[]>();
  responses = new Map<number, Action>();
  callKind: 'discard' | 'chankan' = 'discard';
  kakanInfo: { seat: number; tile: TileId } | null = null;
  rinshanDraw = false;
  pendingDora = 0;
  kanBy: number[] = [];
  noCallsYet = true;
  roundResult: RoundResult | null = null;
  events: GameEvent[] = [];
  private eventListeners: ((e: GameEvent) => void)[] = [];

  constructor(opts: GameOptions) {
    this.rng = new Rng(opts.seed);
    this.players = opts.players.map((p, seat) => ({
      seat,
      name: p.name,
      score: opts.startScore ?? 25000,
      hand: [],
      melds: [],
      discards: [],
      drawn: null,
      riichi: false,
      doubleRiichi: false,
      riichiPending: false,
      ippatsu: false,
      furitenTemp: false,
      furitenRiichi: false,
      kuikaeBan: [],
    }));
    this.abilities = opts.players.map((p) => p.ability ?? null);
    this.startRound();
  }

  // ---------- 查询 ----------

  get dealer(): number {
    return this.roundNumber;
  }

  roundLabel(): string {
    return `${WIND_NAMES[this.roundWind]}${this.roundNumber + 1}局 ${this.honba}本场`;
  }

  seatWind(seat: number): Kind {
    return EAST + ((seat - this.dealer + 4) % 4);
  }

  onEvent(fn: (e: GameEvent) => void): void {
    this.eventListeners.push(fn);
  }

  emit(e: GameEvent): void {
    this.events.push(e);
    for (const fn of this.eventListeners) fn(e);
  }

  // 现在需要做决定的座位
  waitingSeats(): number[] {
    if (this.phase === 'turn') return [this.turn];
    if (this.phase === 'calls') return [...this.pending.keys()].filter((s) => !this.responses.has(s));
    return [];
  }

  waits(seat: number): Kind[] {
    const p = this.players[seat];
    if ((p.hand.length + 3 * p.melds.length) % 3 !== 1) return [];
    return waitingKinds(toCounts(p.hand), p.melds.length);
  }

  isFuriten(seat: number): boolean {
    const p = this.players[seat];
    if (p.furitenTemp || p.furitenRiichi) return true;
    const w = this.waits(seat);
    return p.discards.some((d) => w.includes(kindOf(d.tile)));
  }

  totalKans(): number {
    return this.kanBy.length;
  }

  // ---------- 一局的流程 ----------

  private startRound(): void {
    this.wall = new Wall(this.rng);
    for (const p of this.players) {
      p.hand = [];
      p.melds = [];
      p.discards = [];
      p.drawn = null;
      p.riichi = false;
      p.doubleRiichi = false;
      p.riichiPending = false;
      p.ippatsu = false;
      p.furitenTemp = false;
      p.furitenRiichi = false;
      p.kuikaeBan = [];
    }
    this.abilityState = [{}, {}, {}, {}];
    this.lastDiscard = null;
    this.pending.clear();
    this.responses.clear();
    this.kakanInfo = null;
    this.rinshanDraw = false;
    this.pendingDora = 0;
    this.kanBy = [];
    this.noCallsYet = true;
    this.roundResult = null;
    for (let i = 0; i < 13; i++) {
      for (let k = 0; k < 4; k++) {
        this.players[(this.dealer + k) % 4].hand.push(this.wall.draw());
      }
    }
    this.emit({ type: 'roundStart', label: this.roundLabel() });
    for (let s = 0; s < 4; s++) this.abilities[s]?.onRoundStart?.(this, s);
    this.drawFor(this.dealer, false);
  }

  private drawFor(seat: number, rinshan: boolean): void {
    if (!rinshan && this.wall.remaining === 0) {
      this.exhaustiveDraw();
      return;
    }
    this.abilities[seat]?.beforeDraw?.(this, seat, rinshan);
    const tile = rinshan ? this.wall.drawRinshan() : this.wall.draw();
    const p = this.players[seat];
    p.hand.push(tile);
    p.drawn = tile;
    p.furitenTemp = false;
    this.rinshanDraw = rinshan;
    this.turn = seat;
    this.phase = 'turn';
    this.emit({ type: 'draw', seat });
    this.abilities[seat]?.afterDraw?.(this, seat);
  }

  private isFirstTurn(seat: number): boolean {
    return this.noCallsYet && this.players[seat].discards.length === 0;
  }

  // ---------- 合法操作 ----------

  legalActions(seat: number): Action[] {
    if (this.phase === 'calls') return this.responses.has(seat) ? [] : this.pending.get(seat) ?? [];
    if (this.phase !== 'turn' || seat !== this.turn) return [];
    const p = this.players[seat];
    const out: Action[] = [];
    if (p.drawn !== null) {
      if (this.winResult(seat, p.drawn, true)) out.push({ type: 'tsumo' });
      if (this.isFirstTurn(seat)) {
        const kinds = new Set(p.hand.map(kindOf));
        if (YAOCHU_KINDS.filter((k) => kinds.has(k)).length >= 9) out.push({ type: 'kyuushu' });
      }
      if (this.wall.remaining > 0 && this.totalKans() < 4) {
        const counts = toCounts(p.hand);
        for (let k = 0; k < 34; k++) {
          if (counts[k] !== 4) continue;
          if (p.riichi && !this.riichiAnkanOk(seat, k)) continue;
          out.push({ type: 'ankan', kind: k });
        }
        if (!p.riichi) {
          for (const m of p.melds) {
            if (m.type !== 'pon') continue;
            const t = p.hand.find((x) => kindOf(x) === kindOf(m.tiles[0]));
            if (t !== undefined) out.push({ type: 'kakan', tile: t });
          }
        }
      }
    }
    if (p.riichi) {
      if (p.drawn !== null) out.push({ type: 'discard', tile: p.drawn });
      return out;
    }
    const canRiichi =
      p.drawn !== null &&
      p.melds.every((m) => m.type === 'ankan') &&
      p.score >= 1000 &&
      this.wall.remaining >= 4;
    const seenKinds = new Set<string>();
    for (const t of p.hand) {
      if (p.kuikaeBan.includes(kindOf(t))) continue;
      out.push({ type: 'discard', tile: t });
      if (!canRiichi) continue;
      const key = `${kindOf(t)}-${isRed(t)}`;
      if (seenKinds.has(key)) continue;
      seenKinds.add(key);
      const rest = p.hand.filter((x) => x !== t);
      if (shanten(toCounts(rest), p.melds.length) === 0) out.push({ type: 'discard', tile: t, riichi: true });
    }
    return out;
  }

  // 立直后暗杠：不能改变听牌
  private riichiAnkanOk(seat: number, kind: Kind): boolean {
    const p = this.players[seat];
    if (p.drawn === null || kindOf(p.drawn) !== kind) return false;
    const before = waitingKinds(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
    const after = waitingKinds(toCounts(p.hand.filter((t) => kindOf(t) !== kind)), p.melds.length + 1);
    return before.length > 0 && before.join() === after.join();
  }

  winResult(seat: number, tile: TileId, tsumo: boolean): WinResult | null {
    const p = this.players[seat];
    const closed = tsumo ? p.hand.slice() : [...p.hand, tile];
    if (shanten(toCounts(closed), p.melds.length) !== -1) return null;
    if (!tsumo && this.isFuriten(seat)) return null;
    const first = this.isFirstTurn(seat) && !this.rinshanDraw;
    const dora = [...this.wall.visibleDoraIndicators()];
    const ura = [...this.wall.visibleUraIndicators()];
    // 杠后还没翻的宝牌，和了时一起翻
    for (let i = 0; i < this.pendingDora; i++) {
      dora.push(this.wall.doraIndicators[dora.length]);
      ura.push(this.wall.uraIndicators[ura.length]);
    }
    return evaluateWin({
      closed,
      melds: p.melds,
      winTile: tile,
      tsumo,
      seatWind: this.seatWind(seat),
      roundWind: EAST + this.roundWind,
      isDealer: seat === this.dealer,
      riichi: p.riichi,
      doubleRiichi: p.doubleRiichi,
      ippatsu: p.ippatsu,
      haitei: tsumo && this.wall.remaining === 0 && !this.rinshanDraw,
      houtei: !tsumo && this.wall.remaining === 0 && this.callKind === 'discard',
      rinshan: tsumo && this.rinshanDraw,
      chankan: !tsumo && this.callKind === 'chankan',
      tenhou: tsumo && first && seat === this.dealer,
      chiihou: tsumo && first && seat !== this.dealer,
      doraIndicators: dora.map(kindOf),
      uraIndicators: ura.map(kindOf),
    });
  }

  // ---------- 执行操作 ----------

  act(seat: number, action: Action): void {
    const legal = this.legalActions(seat);
    if (!legal.some((a) => sameAction(a, action))) {
      throw new Error(`不合法的操作: 座位 ${seat} ${JSON.stringify(action)}`);
    }
    if (this.phase === 'calls') {
      this.responses.set(seat, action);
      if (this.waitingSeats().length === 0) this.resolveCalls();
      return;
    }
    switch (action.type) {
      case 'discard':
        this.doDiscard(seat, action.tile, !!action.riichi);
        break;
      case 'tsumo':
        this.doTsumo(seat);
        break;
      case 'ankan':
        this.doAnkan(seat, action.kind);
        break;
      case 'kakan':
        this.doKakan(seat, action.tile);
        break;
      case 'kyuushu':
        this.abortiveDraw('九种九牌');
        break;
      default:
        throw new Error(`轮到自己时不能 ${action.type}`);
    }
  }

  private doDiscard(seat: number, tile: TileId, riichi: boolean): void {
    const p = this.players[seat];
    const firstTurn = this.isFirstTurn(seat);
    p.hand.splice(p.hand.indexOf(tile), 1);
    p.discards.push({ tile, riichi, tsumogiri: tile === p.drawn, called: false });
    if (p.riichi) p.ippatsu = false;
    if (riichi) {
      p.riichiPending = true;
      p.doubleRiichi = firstTurn;
    }
    p.drawn = null;
    p.kuikaeBan = [];
    this.rinshanDraw = false;
    this.lastDiscard = { seat, tile };
    this.emit({ type: 'discard', seat, tile, riichi });
    this.abilities[seat]?.afterDiscard?.(this, seat, tile);
    while (this.pendingDora > 0) {
      this.wall.revealDora();
      this.pendingDora--;
    }

    this.callKind = 'discard';
    this.pending.clear();
    this.responses.clear();
    const kind = kindOf(tile);
    for (let o = 0; o < 4; o++) {
      if (o === seat) continue;
      const q = this.players[o];
      const opts: Action[] = [];
      if (this.winResult(o, tile, false)) opts.push({ type: 'ron' });
      if (this.wall.remaining > 0 && !q.riichi) {
        const same = q.hand.filter((t) => kindOf(t) === kind);
        for (const pair of distinctPairs(same)) opts.push({ type: 'pon', tiles: pair });
        if (same.length === 3 && this.totalKans() < 4) opts.push({ type: 'daiminkan' });
        if (o === (seat + 1) % 4 && kind < 27) {
          const n = kind % 9;
          const shapes: [number, number][] = [];
          if (n >= 2) shapes.push([kind - 2, kind - 1]);
          if (n >= 1 && n <= 7) shapes.push([kind - 1, kind + 1]);
          if (n <= 6) shapes.push([kind + 1, kind + 2]);
          for (const [a, b] of shapes) {
            const as = distinctByRed(q.hand.filter((t) => kindOf(t) === a));
            const bs = distinctByRed(q.hand.filter((t) => kindOf(t) === b));
            for (const x of as) for (const y of bs) opts.push({ type: 'chi', tiles: [x, y] });
          }
        }
      }
      if (opts.length) {
        opts.push({ type: 'pass' });
        this.pending.set(o, opts);
      }
    }
    if (this.pending.size > 0) {
      this.phase = 'calls';
    } else {
      this.afterDiscardSettled();
    }
  }

  private establishRiichi(): void {
    for (const p of this.players) {
      if (!p.riichiPending) continue;
      p.riichiPending = false;
      p.riichi = true;
      p.ippatsu = true;
      p.score -= 1000;
      this.riichiSticks++;
    }
  }

  // 打出的牌没人要：判断途中流局，然后下一家摸牌
  private afterDiscardSettled(): void {
    this.markPassedFuriten();
    this.establishRiichi();
    const seat = this.lastDiscard!.seat;
    if (this.noCallsYet && this.players.every((p) => p.discards.length === 1)) {
      const kinds = this.players.map((p) => kindOf(p.discards[0].tile));
      if (isWind(kinds[0]) && kinds.every((k) => k === kinds[0])) {
        this.abortiveDraw('四风连打');
        return;
      }
    }
    if (this.players.every((p) => p.riichi)) {
      this.abortiveDraw('四家立直');
      return;
    }
    if (this.totalKans() === 4 && new Set(this.kanBy).size > 1) {
      this.abortiveDraw('四杠散了');
      return;
    }
    this.drawFor((seat + 1) % 4, false);
  }

  // 能荣和却没荣和的人进入振听
  private markPassedFuriten(): void {
    if (!this.lastDiscard && !this.kakanInfo) return;
    const src = this.callKind === 'chankan' ? this.kakanInfo! : this.lastDiscard!;
    const kind = kindOf(src.tile);
    for (let o = 0; o < 4; o++) {
      if (o === src.seat) continue;
      if (this.responses.get(o)?.type === 'ron') continue;
      if (!this.waits(o).includes(kind)) continue;
      const p = this.players[o];
      p.furitenTemp = true;
      if (p.riichi) p.furitenRiichi = true;
    }
  }

  private resolveCalls(): void {
    const src = this.callKind === 'chankan' ? this.kakanInfo! : this.lastDiscard!;
    const order = [1, 2, 3].map((d) => (src.seat + d) % 4);
    const rons = order.filter((s) => this.responses.get(s)?.type === 'ron');
    if (rons.length === 3) {
      this.abortiveDraw('三家和了');
      return;
    }
    if (rons.length > 0) {
      this.doRon(rons, src.seat, src.tile);
      return;
    }
    this.pending.clear();
    if (this.callKind === 'chankan') {
      this.markPassedFuriten();
      this.completeKakan();
      return;
    }
    const caller =
      order.find((s) => ['pon', 'daiminkan'].includes(this.responses.get(s)?.type ?? '')) ??
      order.find((s) => this.responses.get(s)?.type === 'chi');
    if (caller === undefined) {
      this.afterDiscardSettled();
      return;
    }
    this.markPassedFuriten();
    this.establishRiichi();
    this.doCall(caller, this.responses.get(caller)!);
  }

  private doCall(seat: number, action: Action): void {
    const { seat: from, tile } = this.lastDiscard!;
    const p = this.players[seat];
    const fromP = this.players[from];
    fromP.discards[fromP.discards.length - 1].called = true;
    this.noCallsYet = false;
    for (const q of this.players) q.ippatsu = false;
    const kind = kindOf(tile);
    const take = (ids: TileId[]) => {
      for (const t of ids) p.hand.splice(p.hand.indexOf(t), 1);
    };
    if (action.type === 'pon') {
      take(action.tiles);
      p.melds.push({ type: 'pon', tiles: [...action.tiles, tile], calledTile: tile, from });
      p.kuikaeBan = [kind];
      this.emit({ type: 'call', seat, call: '碰' });
    } else if (action.type === 'chi') {
      take(action.tiles);
      p.melds.push({ type: 'chi', tiles: [...action.tiles, tile], calledTile: tile, from });
      const ks = action.tiles.map(kindOf).sort((a, b) => a - b);
      const ban = [kind];
      // 两面吃的另一端也不能打（食替）
      if (kind < ks[0] && ks[1] % 9 < 8) ban.push(ks[1] + 1);
      if (kind > ks[1] && ks[0] % 9 > 0) ban.push(ks[0] - 1);
      p.kuikaeBan = ban;
      this.emit({ type: 'call', seat, call: '吃' });
    } else if (action.type === 'daiminkan') {
      const ids = p.hand.filter((t) => kindOf(t) === kind);
      take(ids);
      p.melds.push({ type: 'minkan', tiles: [...ids, tile], calledTile: tile, from });
      this.kanBy.push(seat);
      this.pendingDora++;
      this.emit({ type: 'call', seat, call: '杠' });
      this.drawFor(seat, true);
      return;
    }
    p.drawn = null;
    this.turn = seat;
    this.phase = 'turn';
    // 吃碰后如果所有牌都被食替禁止，就解除限制
    if (p.hand.every((t) => p.kuikaeBan.includes(kindOf(t)))) p.kuikaeBan = [];
  }

  private doAnkan(seat: number, kind: Kind): void {
    const p = this.players[seat];
    const ids = p.hand.filter((t) => kindOf(t) === kind);
    p.hand = p.hand.filter((t) => kindOf(t) !== kind);
    p.drawn = null;
    p.melds.push({ type: 'ankan', tiles: ids });
    this.kanBy.push(seat);
    for (const q of this.players) q.ippatsu = false;
    this.noCallsYet = false;
    this.wall.revealDora();
    this.emit({ type: 'call', seat, call: '暗杠' });
    this.drawFor(seat, true);
  }

  private doKakan(seat: number, tile: TileId): void {
    const p = this.players[seat];
    p.hand.splice(p.hand.indexOf(tile), 1);
    p.drawn = null;
    this.kakanInfo = { seat, tile };
    this.callKind = 'chankan';
    this.pending.clear();
    this.responses.clear();
    for (let o = 0; o < 4; o++) {
      if (o === seat) continue;
      if (this.winResult(o, tile, false)) this.pending.set(o, [{ type: 'ron' }, { type: 'pass' }]);
    }
    if (this.pending.size > 0) {
      this.phase = 'calls';
      return;
    }
    this.completeKakan();
  }

  private completeKakan(): void {
    const { seat, tile } = this.kakanInfo!;
    const p = this.players[seat];
    const m = p.melds.find((x) => x.type === 'pon' && kindOf(x.tiles[0]) === kindOf(tile))!;
    m.type = 'kakan';
    m.tiles.push(tile);
    this.kakanInfo = null;
    this.callKind = 'discard';
    this.kanBy.push(seat);
    for (const q of this.players) q.ippatsu = false;
    this.pendingDora++;
    this.emit({ type: 'call', seat, call: '加杠' });
    this.drawFor(seat, true);
  }

  // ---------- 结算 ----------

  private revealPendingDora(): void {
    while (this.pendingDora > 0) {
      this.wall.revealDora();
      this.pendingDora--;
    }
  }

  private doTsumo(seat: number): void {
    const p = this.players[seat];
    const result = this.winResult(seat, p.drawn!, true)!;
    this.revealPendingDora();
    const deltas = [0, 0, 0, 0];
    for (let o = 0; o < 4; o++) {
      if (o === seat) continue;
      const pay =
        (o === this.dealer ? result.tsumoDealerPays : result.tsumoOtherPays) + 100 * this.honba;
      deltas[o] -= pay;
      deltas[seat] += pay;
    }
    deltas[seat] += 1000 * this.riichiSticks;
    this.riichiSticks = 0;
    this.endRound({
      kind: 'win',
      wins: [this.winInfo(seat, null, p.drawn!, p.hand.slice(), result)],
      tenpai: [false, false, false, false],
      deltas,
    });
  }

  private doRon(seats: number[], from: number, tile: TileId): void {
    const results = seats.map((s) => this.winResult(s, tile, false)!);
    this.revealPendingDora();
    const deltas = [0, 0, 0, 0];
    const wins: WinInfo[] = [];
    seats.forEach((s, i) => {
      const r = results[i];
      const pay = r.ron + (i === 0 ? 300 * this.honba : 0);
      deltas[from] -= pay;
      deltas[s] += pay;
      if (i === 0) {
        deltas[s] += 1000 * this.riichiSticks;
        this.riichiSticks = 0;
      }
      wins.push(this.winInfo(s, from, tile, [...this.players[s].hand, tile], r));
    });
    this.endRound({ kind: 'win', wins, tenpai: [false, false, false, false], deltas });
  }

  private winInfo(seat: number, from: number | null, tile: TileId, hand: TileId[], result: WinResult): WinInfo {
    const p = this.players[seat];
    return {
      seat,
      from,
      tile,
      hand,
      melds: p.melds.map((m) => ({ ...m, tiles: m.tiles.slice() })),
      result,
      uraIndicators: p.riichi ? this.wall.visibleUraIndicators() : [],
    };
  }

  private exhaustiveDraw(): void {
    const tenpai = this.players.map((p) => shanten(toCounts(p.hand), p.melds.length) === 0);
    const n = tenpai.filter(Boolean).length;
    const deltas = [0, 0, 0, 0];
    if (n > 0 && n < 4) {
      for (let s = 0; s < 4; s++) deltas[s] = tenpai[s] ? 3000 / n : -3000 / (4 - n);
    }
    this.endRound({ kind: 'exhaustive', wins: [], tenpai, deltas });
  }

  private abortiveDraw(reason: string): void {
    this.endRound({ kind: 'abortive', reason, wins: [], tenpai: [false, false, false, false], deltas: [0, 0, 0, 0] });
  }

  private endRound(result: RoundResult): void {
    result.deltas.forEach((d, s) => (this.players[s].score += d));
    this.roundResult = result;
    this.pending.clear();
    this.responses.clear();
    this.phase = 'roundEnd';
    this.emit({ type: 'roundEnd', result });
  }

  // 结算画面之后调用：进入下一局或结束对局
  nextRound(): void {
    if (this.phase !== 'roundEnd' || !this.roundResult) return;
    const r = this.roundResult;
    let renchan: boolean;
    if (r.kind === 'win') renchan = r.wins.some((w) => w.seat === this.dealer);
    else if (r.kind === 'exhaustive') renchan = r.tenpai[this.dealer];
    else renchan = true;

    const scores = this.players.map((p) => p.score);
    const top = Math.max(...scores);
    const isLast = this.roundNumber === 3;
    const dealerTop = scores[this.dealer] === top && scores.filter((s) => s === top).length === 1;
    let end = scores.some((s) => s < 0);
    if (this.roundWind === 0) {
      if (isLast && renchan && dealerTop && top >= 30000) end = true;
      if (isLast && !renchan && top >= 30000) end = true;
    } else {
      // 南入后谁先到 30000 点就结束
      if (top >= 30000) end = true;
      if (isLast && !renchan) end = true;
    }
    if (end) {
      this.finishGame();
      return;
    }
    if (renchan) {
      this.honba++;
    } else {
      this.honba = r.kind === 'win' ? 0 : this.honba + 1;
      this.roundNumber++;
      if (this.roundNumber === 4) {
        this.roundNumber = 0;
        this.roundWind++;
      }
    }
    this.startRound();
  }

  private finishGame(): void {
    if (this.riichiSticks > 0) {
      const top = this.ranking()[0];
      this.players[top].score += 1000 * this.riichiSticks;
      this.riichiSticks = 0;
    }
    this.phase = 'gameEnd';
  }

  // 名次：点数高的在前，同分时起家优先
  ranking(): number[] {
    return [0, 1, 2, 3].sort((a, b) => this.players[b].score - this.players[a].score || a - b);
  }
}

function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'discard':
      return a.tile === (b as typeof a).tile && !!a.riichi === !!(b as typeof a).riichi;
    case 'ankan':
      return a.kind === (b as typeof a).kind;
    case 'kakan':
      return a.tile === (b as typeof a).tile;
    case 'pon':
    case 'chi': {
      const x = [...a.tiles].sort();
      const y = [...(b as typeof a).tiles].sort();
      return x[0] === y[0] && x[1] === y[1];
    }
    default:
      return true;
  }
}

// 同种牌里，只按“是不是赤牌”区分
function distinctByRed(ids: TileId[]): TileId[] {
  const out: TileId[] = [];
  const red = ids.find(isRed);
  const plain = ids.find((t) => !isRed(t));
  if (plain !== undefined) out.push(plain);
  if (red !== undefined) out.push(red);
  return out;
}

function distinctPairs(ids: TileId[]): [TileId, TileId][] {
  if (ids.length < 2) return [];
  const plain = ids.filter((t) => !isRed(t));
  const red = ids.find(isRed);
  const out: [TileId, TileId][] = [];
  if (plain.length >= 2) out.push([plain[0], plain[1]]);
  if (red !== undefined && plain.length >= 1) out.push([red, plain[0]]);
  return out;
}
