import { Rng } from './rng';
import { TILE_COUNT, TileId } from './tiles';

// 锁住的牌，记着是谁锁的：一张牌可以被好几个人锁，各人只能解开自己的锁，全解开才算没锁。被摸走时所有锁一起解开
export class Locks {
  private owners = new Map<TileId, Set<string>>();

  has(t: TileId): boolean {
    return this.owners.has(t);
  }

  add(t: TileId, owner: string): void {
    const set = this.owners.get(t) ?? new Set<string>();
    set.add(owner);
    this.owners.set(t, set);
  }

  // 没写 owner：所有锁一起解开（牌被摸走、挪进王牌区时）
  delete(t: TileId, owner?: string): void {
    if (owner === undefined) {
      this.owners.delete(t);
      return;
    }
    const set = this.owners.get(t);
    set?.delete(owner);
    if (set?.size === 0) this.owners.delete(t);
  }

  ownersOf(t: TileId): string[] {
    return [...(this.owners.get(t) ?? [])].sort();
  }

  [Symbol.iterator](): IterableIterator<TileId> {
    return this.owners.keys();
  }
}

// 牌山：前 122 张是可摸的牌（live[0] 是下一张），后 14 张是王牌
// 能力只能交换没公开的牌，牌的总数永远是 136

export class Wall {
  live: TileId[];
  rinshan: TileId[];
  doraIndicators: TileId[];
  uraIndicators: TileId[];
  // 开杠后从牌山末尾补进王牌区的牌，不再参与游戏
  overflow: TileId[] = [];
  doraRevealed = 1;
  // 被锁住的牌（园城寺怜看到的、能力预定好的），谁都不能再移动它们
  locked = new Locks();
  // 控场能力给这一次摸牌定的规矩：为真的牌不能换到下一张摸的位置（live[0] 或 rinshan[0]）
  deny: ((t: TileId) => boolean) | null = null;

  constructor(rng: Rng) {
    const tiles = rng.shuffle(Array.from({ length: TILE_COUNT }, (_, i) => i));
    this.live = tiles.slice(0, 122);
    this.rinshan = tiles.slice(122, 126);
    this.doraIndicators = tiles.slice(126, 131);
    this.uraIndicators = tiles.slice(131, 136);
  }

  get remaining(): number {
    return this.live.length;
  }

  draw(): TileId {
    const t = this.live.shift();
    if (t === undefined) throw new Error('牌山已经摸完');
    this.locked.delete(t);
    return t;
  }

  drawRinshan(): TileId {
    const t = this.rinshan.shift();
    if (t === undefined) throw new Error('岭上牌已经摸完');
    const moved = this.live.pop();
    if (moved !== undefined) {
      this.overflow.push(moved);
      this.locked.delete(moved);
    }
    this.locked.delete(t);
    return t;
  }

  revealDora(): void {
    if (this.doraRevealed < 5) this.doraRevealed++;
  }

  visibleDoraIndicators(): TileId[] {
    return this.doraIndicators.slice(0, this.doraRevealed);
  }

  visibleUraIndicators(): TileId[] {
    return this.uraIndicators.slice(0, this.doraRevealed);
  }

  // 从摸牌起点数，第几张摸到的牌（包括配牌的 52 张）在 live 里的位置；开杠补进王牌的牌从末尾去掉
  get frontDrawn(): number {
    return 122 - this.live.length - this.overflow.length;
  }

  // 在牌山里找一张符合条件、没被锁定的牌，换到 live[target] 的位置。from：只从 live 的这些位置里找
  bringToLive(target: number, pred: (t: TileId) => boolean, rng: Rng, from?: (i: number) => boolean): boolean {
    if (target >= this.live.length || this.locked.has(this.live[target])) return false;
    const deny = target === 0 ? this.deny : null;
    const ok = (t: TileId) => pred(t) && !deny?.(t);
    if (ok(this.live[target])) return true;
    const cands: number[] = [];
    for (let i = 0; i < this.live.length; i++) {
      if (i === target || this.locked.has(this.live[i]) || (from && !from(i))) continue;
      if (ok(this.live[i])) cands.push(i);
    }
    if (cands.length === 0) return false;
    const j = cands[rng.int(cands.length)];
    [this.live[target], this.live[j]] = [this.live[j], this.live[target]];
    return true;
  }

  // 把符合条件的牌换成下一张岭上牌（来源可以是牌山或其他岭上牌）
  bringToRinshan(pred: (t: TileId) => boolean, rng: Rng): boolean {
    if (this.rinshan.length === 0 || this.locked.has(this.rinshan[0])) return false;
    const ok = (t: TileId) => pred(t) && !this.deny?.(t);
    if (ok(this.rinshan[0])) return true;
    const cands: { from: 'live' | 'rinshan'; i: number }[] = [];
    this.live.forEach((t, i) => {
      if (!this.locked.has(t) && ok(t)) cands.push({ from: 'live', i });
    });
    this.rinshan.forEach((t, i) => {
      if (i > 0 && !this.locked.has(t) && ok(t)) cands.push({ from: 'rinshan', i });
    });
    if (cands.length === 0) return false;
    const c = cands[rng.int(cands.length)];
    const src = c.from === 'live' ? this.live : this.rinshan;
    [this.rinshan[0], src[c.i]] = [src[c.i], this.rinshan[0]];
    return true;
  }

  // 把符合条件的牌换成第 i 张里宝牌指示牌（还没翻开，和了时才看得到）。来源是牌山、岭上牌和后面的里宝牌指示牌
  // from：牌山里只从这些位置找
  bringToUra(i: number, pred: (t: TileId) => boolean, rng: Rng, from?: (j: number) => boolean): boolean {
    if (i >= this.uraIndicators.length || this.locked.has(this.uraIndicators[i])) return false;
    if (pred(this.uraIndicators[i])) return true;
    const cands: { src: TileId[]; i: number }[] = [];
    this.uraIndicators.forEach((t, j) => {
      if (j > i && !this.locked.has(t) && pred(t)) cands.push({ src: this.uraIndicators, i: j });
    });
    this.live.forEach((t, j) => {
      if (!this.locked.has(t) && (!from || from(j)) && pred(t)) cands.push({ src: this.live, i: j });
    });
    this.rinshan.forEach((t, j) => {
      if (!this.locked.has(t) && pred(t)) cands.push({ src: this.rinshan, i: j });
    });
    if (cands.length === 0) return false;
    const c = cands[rng.int(cands.length)];
    [this.uraIndicators[i], c.src[c.i]] = [c.src[c.i], this.uraIndicators[i]];
    return true;
  }

  allTiles(): TileId[] {
    return [...this.live, ...this.rinshan, ...this.doraIndicators, ...this.uraIndicators, ...this.overflow];
  }
}

// ---------- 牌山在桌上的样子 ----------
// 四家面前各 17 墩、每墩上下两张，共 68 墩。开牌：从庄家起逆时针数骰子点数，落在谁面前就开谁的牌山，
// 从他的右端数点数那么多墩处分开，往顺时针方向一直摸下去；分开处右边 7 墩是王牌。

export const STACKS_PER_WALL = 17;

// 从摸牌起点数第 p 墩（顺时针）在谁面前、从他的右端数第几墩（1..17）
export function stackAt(dealer: number, diceSum: number, p: number): { wall: number; stack: number } {
  const owner = (dealer + diceSum - 1) % 4;
  const idx = diceSum + p;
  const wall = (((owner - Math.floor(idx / STACKS_PER_WALL)) % 4) + 4) % 4;
  return { wall, stack: (idx % STACKS_PER_WALL) + 1 };
}

// 第 d 张摸到的牌（d 从 0 开始，包括配牌）是不是这一排牌山的最后一张：摸完它就要拐过牌山的转角
export function isCornerDraw(dealer: number, diceSum: number, d: number): boolean {
  if (d % 2 === 0) return false;
  const p = Math.floor(d / 2);
  return stackAt(dealer, diceSum, p).wall !== stackAt(dealer, diceSum, p + 1).wall;
}
