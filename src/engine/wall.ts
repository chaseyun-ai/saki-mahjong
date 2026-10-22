import { Rng } from './rng';
import { TILE_COUNT, TileId } from './tiles';

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
  // 被园城寺怜看到的牌，其他能力不能再移动它们
  locked = new Set<TileId>();

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
    if (moved !== undefined) this.overflow.push(moved);
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

  // 在牌山里找一张符合条件、没被锁定的牌，换到 live[target] 的位置
  bringToLive(target: number, pred: (t: TileId) => boolean, rng: Rng): boolean {
    if (target >= this.live.length || this.locked.has(this.live[target])) return false;
    if (pred(this.live[target])) return true;
    const cands: number[] = [];
    for (let i = 0; i < this.live.length; i++) {
      if (i === target || this.locked.has(this.live[i])) continue;
      if (pred(this.live[i])) cands.push(i);
    }
    if (cands.length === 0) return false;
    const j = cands[rng.int(cands.length)];
    [this.live[target], this.live[j]] = [this.live[j], this.live[target]];
    return true;
  }

  // 把符合条件的牌换成下一张岭上牌（来源可以是牌山或其他岭上牌）
  bringToRinshan(pred: (t: TileId) => boolean, rng: Rng): boolean {
    if (this.rinshan.length === 0 || this.locked.has(this.rinshan[0])) return false;
    if (pred(this.rinshan[0])) return true;
    const cands: { from: 'live' | 'rinshan'; i: number }[] = [];
    this.live.forEach((t, i) => {
      if (!this.locked.has(t) && pred(t)) cands.push({ from: 'live', i });
    });
    this.rinshan.forEach((t, i) => {
      if (i > 0 && !this.locked.has(t) && pred(t)) cands.push({ from: 'rinshan', i });
    });
    if (cands.length === 0) return false;
    const c = cands[rng.int(cands.length)];
    const src = c.from === 'live' ? this.live : this.rinshan;
    [this.rinshan[0], src[c.i]] = [src[c.i], this.rinshan[0]];
    return true;
  }

  allTiles(): TileId[] {
    return [...this.live, ...this.rinshan, ...this.doraIndicators, ...this.uraIndicators, ...this.overflow];
  }
}
