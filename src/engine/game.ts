import { PRIORITY, type Ability, type DealRule, type DrawRule } from '../abilities/types';
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
import { Wall, isCornerDraw } from './wall';

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

// predeal：发牌前等玩家选技能（玩家操作的座位有发牌前技能可选时），选好后调 deal()
// postdeal：配完牌、庄家摸第一张之前等玩家看着手牌选技能（爽的云和神威），选好后调 deal()
export type Phase = 'predeal' | 'postdeal' | 'turn' | 'calls' | 'roundEnd' | 'gameEnd';

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
  // slot：这一局是第几局（东 1 是 0，南 1 是 4；连庄、流局重打的局还是同一个数）
  | { type: 'roundStart'; label: string; slot?: number }
  // 配完牌以后的技能（爽的云和神威）都换好了牌，庄家马上摸第一张
  | { type: 'dealt' }
  | { type: 'draw'; seat: number }
  | { type: 'discard'; seat: number; tile: TileId; riichi: boolean }
  | { type: 'call'; seat: number; call: string }
  // target：能力作用在谁的摸牌上（没写就是发动能力的人自己）
  | { type: 'ability'; seat: number; ability: string; text: string; target?: number }
  | { type: 'roundEnd'; result: RoundResult };

export interface PlayerConfig {
  name: string;
  ability?: Ability | null;
  // 玩家操作的座位：能主动开关技能的能力听玩家的，不替玩家做决定
  manual?: boolean;
}

export interface GameOptions {
  seed: number;
  players: PlayerConfig[];
  startScore?: number;
  // 每家开局的点数（团体赛：每人带着自己队伍现在的点数上场），盖过 startScore
  scores?: number[];
  // 上一场留下的立直棒（团体赛接着给下一个位置）
  riichiSticks?: number;
  // 起家（东 1 局的庄家）坐哪：界面开局时随机给；不给是 0 号位。片冈优希在场时一定是她
  firstDealer?: number;
  // east：东风战（东 4 局后有人到 30000 就结束，不到就南入）；
  // south：半庄战（东南两场，南 4 局结束；南 4 局庄家连庄时，庄家第一、到 30000 就结束）；
  // team：团体赛的半庄，打满东南两场，南 4 局庄家没连庄就结束，谁到 30000 都不提前结束，有人小于 0 立刻结束，
  //   剩下的立直棒不给第一名，留给下一个位置
  format?: 'east' | 'south' | 'team';
  // 团体赛：每个座位自己队里的全部队员（角色 id，包括自己和不在这一桌的人）。龙华的膝枕要和怜同队
  allies?: string[][];
}

const WIND_NAMES = ['东', '南', '西', '北'];

export class Game {
  rng: Rng;
  players: PlayerState[];
  abilities: (Ability | null)[];
  // 能力的私有状态，按座位存：abilityState 每局清空，abilityGameState 整场都在
  abilityState: Record<string, unknown>[] = [{}, {}, {}, {}];
  abilityGameState: Record<string, unknown>[] = [{}, {}, {}, {}];
  // 哪些座位是玩家操作的（见 PlayerConfig.manual）
  manual: boolean[] = [false, false, false, false];
  format: 'east' | 'south' | 'team' = 'east';
  // 每个座位的队友（见 GameOptions.allies），不是团体赛是空的
  allies: string[][] = [[], [], [], []];

  // 第几局（从 1 起，每开一局加一，连庄也算）；发牌前等玩家选技能时还是上一局的
  round = 0;
  roundWind = 0; // 0 东场，1 南场
  roundNumber = 0; // 0-3，东 1 局是 0
  firstDealer = 0; // 起家（东 1 局的庄家）：见 GameOptions.firstDealer
  honba = 0;
  riichiSticks = 0;
  wall!: Wall;
  // 开局掷的两颗骰子，决定从哪里开牌（只影响牌山的摆放，不影响摸牌顺序）
  dice: [number, number] = [1, 1];

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
  // 这一局发完配牌、庄家还没摸第一张时牌山的样子（给能力痕迹对照用）
  dealtWall: { live: TileId[]; rinshan: TileId[] } = { live: [], rinshan: [] };
  // 这一局对配牌定的规矩；调整完还没满足的（无解降级）记在 dealUnmet
  dealRules: DealRule[] = [];
  dealUnmet: DealRule[] = [];
  // 正在调整配牌的人（他自己的规矩由他自己权衡，不拦他）；降级中的人：只顾比他先动的人的规矩
  private dealActor: number | null = null;
  private dealRelaxFor: number | null = null;
  // 这一局调整配牌时碰不到谁的配牌（天使和挡掉的）：`${调整的人}-${配牌的人}`
  private dealShrugged = new Set<string>();
  events: GameEvent[] = [];
  private eventListeners: ((e: GameEvent) => void)[] = [];

  constructor(opts: GameOptions) {
    this.rng = new Rng(opts.seed);
    this.players = opts.players.map((p, seat) => ({
      seat,
      name: p.name,
      score: opts.scores?.[seat] ?? opts.startScore ?? 25000,
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
    const yuuki = this.abilities.findIndex((a) => a?.firstDealer);
    this.firstDealer = yuuki >= 0 ? yuuki : (opts.firstDealer ?? 0) % 4;
    this.manual = opts.players.map((p) => !!p.manual);
    this.format = opts.format ?? 'east';
    if (opts.allies) this.allies = opts.allies.map((a) => [...a]);
    this.riichiSticks = opts.riichiSticks ?? 0;
    this.startOrWait();
  }

  // ---------- 查询 ----------

  get dealer(): number {
    return (this.firstDealer + this.roundNumber) % 4;
  }

  // 这个人在每一圈的第几局坐庄（0–3）
  dealerRound(seat: number): number {
    return (seat - this.firstDealer + 4) % 4;
  }

  roundLabel(): string {
    return `${WIND_NAMES[this.roundWind]}${this.roundNumber + 1}局 ${this.honba}本场`;
  }

  // 打满东南两场（半庄战、团体赛）
  get fullHanchan(): boolean {
    return this.format !== 'east';
  }

  // 照计划这一局是不是最后 n 局里的（东风战最后是东 4，半庄战、团体赛是南 4；南入、连庄以后一直算）
  isLastRounds(n: number): boolean {
    const last = this.fullHanchan ? 7 : 3;
    return this.roundWind * 4 + this.roundNumber > last - n;
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

  // 能力允不允许这家现在和牌（照的照魔镜那一局不和）。这是自己给自己的限制，被封印也照样
  // 别人的能力也可能不许他和（涅莉的七姐妹）
  canWin(seat: number): boolean {
    if (!(this.abilities[seat]?.canWin?.(this, seat) ?? true)) return false;
    return ![0, 1, 2, 3].some((o) => o !== seat && this.binds(o, seat) && !!this.active(o)?.forbidsWin?.(this, o, seat));
  }

  // 这家的能力这一局被别人封印了没有（爽的霍亚乌神威）。round 不写是现在这一局（发牌前是马上要开的那一局）
  isSealed(seat: number, round = this.phase === 'predeal' ? this.round + 1 : this.round): boolean {
    const own = this.abilities[seat];
    if (own?.immune || own?.absolute) return false;
    return this.abilities.some((a, o) => o !== seat && !!a?.seals?.(this, o, round));
  }

  // 这一局起作用的能力：被封印的算没有
  active(seat: number): Ability | null {
    const a = this.abilities[seat];
    return a && !this.isSealed(seat, this.round) ? a : null;
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

  // 有能力的座位，按“谁说了算”的顺序：priority 小的先动；一样时从庄家起按座位
  abilityOrder(): number[] {
    const pri = (s: number) => this.abilities[s]?.priority ?? PRIORITY.self;
    return [0, 1, 2, 3]
      .map((k) => (this.dealer + k) % 4)
      .filter((s) => this.active(s))
      .sort((a, b) => pri(a) - pri(b));
  }

  // 配牌时 seat 会拿到 live 里的哪几张（配牌前调用才有意义）：从庄家起一人一张，发 13 圈
  dealIndices(seat: number): number[] {
    const rel = (seat - this.dealer + 4) % 4;
    return Array.from({ length: 13 }, (_, i) => i * 4 + rel);
  }

  // 这一家现在会拿到的配牌（配牌前调用才有意义）
  dealHand(seat: number): TileId[] {
    return this.dealIndices(seat).map((i) => this.wall.live[i]);
  }

  // 配牌调整期间补一条规矩（比如淡定好了自己的配牌以后）
  addDealRule(r: DealRule): boolean {
    if (!this.binds(r.seat, r.target) || this.shrugs(r.seat, r.target)) return false;
    this.dealRules.push(r);
    return true;
  }

  // 配完牌以后（afterDeal）actor 把 seat 手里第 i 张换成牌山里一张符合条件的牌：
  // 只从牌山后面没锁的牌里挑，比 actor 先动的人给 seat 配牌定的规矩不能变差；管不到、这一局碰不到 seat 的配牌时不换
  swapHandTile(actor: number, seat: number, i: number, pred: (t: TileId) => boolean): boolean {
    if (!this.binds(actor, seat) || this.dealShrugged.has(`${actor}-${seat}`)) return false;
    const hand = this.players[seat].hand;
    if (pred(hand[i])) return true;
    const pri = (s: number) => this.abilities[s]?.priority ?? PRIORITY.self;
    const rules = this.dealRules.filter((r) => r.target === seat && r.seat !== actor && pri(r.seat) < pri(actor));
    const cands: number[] = [];
    // 前几张马上要摸，别动
    for (let j = 8; j < this.wall.live.length; j++) {
      const t = this.wall.live[j];
      if (this.wall.locked.has(t) || !pred(t)) continue;
      const after = hand.slice();
      after[i] = t;
      if (rules.some((r) => r.bad(after) > r.bad(hand))) continue;
      cands.push(j);
    }
    if (!cands.length) return false;
    const j = cands[this.rng.int(cands.length)];
    [hand[i], this.wall.live[j]] = [this.wall.live[j], hand[i]];
    return true;
  }

  // from 的能力管不管得到 target（照这样 immune 的人只听自己和 absolute 的）
  binds(from: number, target: number): boolean {
    return from === target || !this.abilities[target]?.immune || !!this.abilities[from]?.absolute;
  }

  // target 这一下挡住了 from 的影响（天使和：一半的概率）。absolute 的挡不住；没有 resist 的人不掷随机数
  private shrugs(from: number, target: number): boolean {
    if (from === target || this.abilities[from]?.absolute) return false;
    const r = this.active(target)?.resist?.(this, target) ?? 0;
    return r > 0 && this.rng.chance(r);
  }

  // 调整不下去时降级：fn 里的换牌只顾比 seat 先动的人的规矩
  dealFallback<T>(seat: number, fn: () => T): T {
    const prev = this.dealRelaxFor;
    this.dealRelaxFor = seat;
    try {
      return fn();
    } finally {
      this.dealRelaxFor = prev;
    }
  }

  // 配牌调整期间的把关：live 的这些位置换成这些牌以后，受影响的配牌上别人的规矩没有一条变差
  private dealChangeOk(changes: [number, TileId][]): boolean {
    const order = this.abilityOrder();
    const limit = this.dealRelaxFor === null ? Infinity : order.indexOf(this.dealRelaxFor);
    const bySeat = new Map<number, Map<number, TileId>>();
    for (const [i, t] of changes) {
      if (i >= 52) continue;
      const seat = (this.dealer + (i % 4)) % 4;
      if (!bySeat.has(seat)) bySeat.set(seat, new Map());
      bySeat.get(seat)!.set(i, t);
    }
    for (const [seat, ch] of bySeat) {
      // 别人换不到 immune 的人的配牌
      if (this.dealActor !== null && !this.binds(this.dealActor, seat)) return false;
      if (this.dealShrugged.has(`${this.dealActor}-${seat}`)) return false;
      const idx = this.dealIndices(seat);
      const before = idx.map((i) => this.wall.live[i]);
      const after = idx.map((i) => ch.get(i) ?? this.wall.live[i]);
      for (const r of this.dealRules) {
        if (r.target !== seat || r.seat === this.dealActor || order.indexOf(r.seat) > limit) continue;
        if (r.bad(after) > r.bad(before)) return false;
      }
    }
    return true;
  }

  // 下一张牌（live[0]）谁摸：假设没人鸣牌
  nextDrawer(): number {
    if (this.phase === 'turn') return (this.turn + 1) % 4;
    return ((this.lastDiscard?.seat ?? this.turn) + 1) % 4;
  }

  // live[k] 会被谁摸到：假设没人鸣牌、没人开杠
  drawerOf(k: number): number {
    return (this.nextDrawer() + k) % 4;
  }

  // 牌山转角：live 里哪些位置是一排牌山的最后一张（摸完就拐弯）。从前往后
  cornerIndices(): number[] {
    const sum = this.dice[0] + this.dice[1];
    const front = this.wall.frontDrawn;
    const out: number[] = [];
    for (let k = 0; k < this.wall.live.length; k++) if (isCornerDraw(this.dealer, sum, front + k)) out.push(k);
    return out;
  }

  // ---------- 一局的流程 ----------

  private startRound(): void {
    this.round++;
    // 发牌前等玩家选技能的那一段结束了（不然 isSealed 之类会以为还在等下一局）
    if (this.phase === 'predeal') this.phase = 'turn';
    this.wall = new Wall(this.rng);
    this.dice = [this.rng.int(6) + 1, this.rng.int(6) + 1];
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
    // 配牌：先由所有人定规矩，再依次调整（换牌不能让任何一条规矩变差），最后统一锁定、发牌
    const order = this.abilityOrder();
    this.dealRules = [];
    // 爽的霍亚乌在她自己的 dealRules 里定下来（她最先动），后面被封印的人就不再出手
    for (const s of order) this.dealRules.push(...(this.active(s)?.dealRules?.(this, s) ?? []).filter((r) => this.binds(r.seat, r.target) && !this.shrugs(r.seat, r.target)));
    this.dealShrugged.clear();
    for (const s of order) for (let t = 0; t < 4; t++) if (this.shrugs(s, t)) this.dealShrugged.add(`${s}-${t}`);
    this.wall.guard = (changes) => this.dealChangeOk(changes);
    try {
      for (const s of order) {
        this.dealActor = s;
        this.active(s)?.beforeDeal?.(this, s);
      }
    } finally {
      this.wall.guard = null;
      this.dealActor = null;
    }
    this.dealUnmet = this.dealRules.filter((r) => r.bad(this.dealHand(r.target)) > 0);
    for (let i = 0; i < 52; i++) this.wall.locked.add(this.wall.live[i], 'deal');
    for (let i = 0; i < 13; i++) {
      for (let k = 0; k < 4; k++) {
        this.players[(this.dealer + k) % 4].hand.push(this.wall.draw());
      }
    }
    this.dealtWall = { live: this.wall.live.slice(), rinshan: this.wall.rinshan.slice() };
    this.emit({ type: 'roundStart', label: this.roundLabel(), slot: this.roundWind * 4 + this.roundNumber });
    // 玩家操作的座位有配牌后的技能可选：停下来让玩家看着手牌选（电脑在 afterDeal 里自己决定）
    const ask = this.manual.some((m, s) => m && (this.active(s)?.postDeal?.(this, s) ?? []).some((o) => o.enabled));
    if (ask) this.phase = 'postdeal';
    else this.finishDeal();
  }

  // 配牌后的技能换完牌，开始摸牌
  private finishDeal(): void {
    this.phase = 'turn';
    const order = this.abilityOrder();
    if (order.some((s) => this.active(s)!.afterDeal)) {
      for (const s of order) this.active(s)?.afterDeal?.(this, s);
      this.dealtWall = { live: this.wall.live.slice(), rinshan: this.wall.rinshan.slice() };
      this.emit({ type: 'dealt' });
    }
    for (const s of this.abilityOrder()) this.active(s)!.onRoundStart?.(this, s);
    this.drawFor(this.dealer, false);
  }

  private drawFor(seat: number, rinshan: boolean): void {
    if (!rinshan && this.wall.remaining === 0) {
      this.exhaustiveDraw();
      return;
    }
    this.applyDrawAbilities(seat, rinshan);
    const tile = rinshan ? this.wall.drawRinshan() : this.wall.draw();
    const p = this.players[seat];
    p.hand.push(tile);
    p.drawn = tile;
    p.furitenTemp = false;
    this.rinshanDraw = rinshan;
    this.turn = seat;
    this.phase = 'turn';
    this.emit({ type: 'draw', seat });
    this.active(seat)?.afterDraw?.(this, seat);
  }

  // 摸牌前：控场的人按顺序先动、定规矩，摸牌的人自己的能力最后动，最后把违反规矩的牌换走
  private applyDrawAbilities(seat: number, rinshan: boolean): void {
    const w = this.wall;
    const rules: DrawRule[] = [];
    const union = (n: number) => (n === 0 ? null : (t: TileId) => rules.slice(0, n).some((r) => r.deny(t)));
    for (const s of this.abilityOrder()) {
      const a = this.active(s)!;
      if (!a.beforeAnyDraw) continue;
      w.deny = union(rules.length);
      const r = a.beforeAnyDraw(this, s, seat, rinshan);
      // 管不到 immune 的人：定的规矩不算（能力自己整理牌山的部分照做，比如衣安排海底）
      // 天使和挡掉一半
      if (r && this.binds(s, seat) && !this.shrugs(s, seat)) rules.push(r);
    }
    w.deny = union(rules.length);
    this.active(seat)?.beforeDraw?.(this, seat, rinshan);
    w.deny = null;
    if (rules.length === 0) return;
    const next = () => (rinshan ? w.rinshan[0] : w.live[0]);
    const before = next();
    if (before === undefined || !rules.some((r) => r.deny(before))) return;
    // 换不出同时满足所有规矩的牌时，先满足先定的规矩
    let n = rules.length;
    for (; n > 0; n--) {
      const deny = union(n)!;
      if (!deny(before)) return;
      const ok = rinshan ? w.bringToRinshan((t) => !deny(t), this.rng) : w.bringToLive(0, (t) => !deny(t), this.rng);
      if (ok) break;
    }
    if (next() === before) return;
    for (const r of rules.slice(0, n)) {
      if (r.deny(before)) this.emit({ type: 'ability', seat: r.seat, ability: r.ability, text: r.text, target: seat });
    }
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
      if (this.canWin(seat) && this.winResult(seat, p.drawn, true)) out.push({ type: 'tsumo' });
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
    // 同一种牌每一张都能当立直宣言牌（包括刚摸到的那张），向听只算一次
    const tenpaiAfter = new Map<string, boolean>();
    for (const t of p.hand) {
      if (p.kuikaeBan.includes(kindOf(t))) continue;
      out.push({ type: 'discard', tile: t });
      if (!canRiichi) continue;
      const key = `${kindOf(t)}-${isRed(t)}`;
      if (!tenpaiAfter.has(key)) tenpaiAfter.set(key, shanten(toCounts(p.hand.filter((x) => x !== t)), p.melds.length) === 0);
      if (tenpaiAfter.get(key)) out.push({ type: 'discard', tile: t, riichi: true });
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
    this.active(seat)?.afterDiscard?.(this, seat, tile);
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
      if (this.canWin(o) && this.winResult(o, tile, false)) opts.push({ type: 'ron' });
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
      if (this.canWin(o) && this.winResult(o, tile, false)) this.pending.set(o, [{ type: 'ron' }, { type: 'pass' }]);
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
    if (this.format === 'team') {
      if (this.roundWind === 1 && isLast && !renchan) end = true;
    } else if (this.format === 'south') {
      if (this.roundWind >= 1 && isLast && renchan && dealerTop && top >= 30000) end = true;
      if (this.roundWind >= 1 && isLast && !renchan) end = true;
    } else if (this.roundWind === 0) {
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
    this.startOrWait();
  }

  // 玩家操作的座位有发牌前技能可选，就先停在 predeal 等玩家（电脑在 dealRules 里自己决定）
  private startOrWait(): void {
    const ask = this.manual.some((m, s) => m && !this.isSealed(s, this.round + 1) && (this.abilities[s]?.preDeal?.(this, s) ?? []).some((o) => o.enabled));
    if (ask) this.phase = 'predeal';
    else this.startRound();
  }

  // 玩家选好发牌前的技能（Ability.setPreDeal）以后发牌；配牌后的技能（Ability.setPostDeal）选好以后开始摸牌
  deal(): void {
    if (this.phase === 'predeal') this.startRound();
    else if (this.phase === 'postdeal') this.finishDeal();
  }

  private finishGame(): void {
    if (this.riichiSticks > 0 && this.format !== 'team') {
      const top = this.ranking()[0];
      this.players[top].score += 1000 * this.riichiSticks;
      this.riichiSticks = 0;
    }
    this.phase = 'gameEnd';
  }

  // 名次：点数高的在前，同分时起家优先
  ranking(): number[] {
    const from = (s: number) => (s - this.firstDealer + 4) % 4;
    return [0, 1, 2, 3].sort((a, b) => this.players[b].score - this.players[a].score || from(a) - from(b));
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
