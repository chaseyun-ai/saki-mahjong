import type { Game, GameEvent } from '../engine/game';
import { Rng } from '../engine/rng';
import { TileId, kindOf } from '../engine/tiles';
import { Wall } from '../engine/wall';
import { waitInfo } from './waitInfo';

// 能力痕迹：牌局进行时在旁边记下牌山被动过的地方，一局结束在结算画面里讲给玩家听。
// 只看不碰：自己留一份牌山本来的顺序，每次有人摸牌就拿实际摸到的和本来该摸的对一下。
// 不用随机数，也不改牌局里的任何东西，开不开它牌局都一模一样。

export type TraceEntry =
  // 摸牌时被能力换了牌。depth：换来的牌原本在牌山（或岭上牌）的第几张，0 是最前面
  | {
      kind: 'swap';
      seat: number;
      turn: number;
      ability: string | null;
      text: string | null;
      rinshan: boolean;
      expected: TileId;
      got: TileId;
      source: 'live' | 'rinshan';
      depth: number;
      lostWin: boolean; // 换走的那张本来能让她自摸
      madeWin: boolean; // 换来的这张正好让她和了
    }
  // 吃、碰、明杠让后面的摸牌顺序错开。nextWas/nextNow：下一张牌本来谁摸、现在谁摸
  | {
      kind: 'shift';
      seat: number;
      turn: number;
      call: string;
      from: number;
      tile: TileId;
      nextWas: number;
      nextNow: number;
      skipped: number[];
      foresight: number | null; // 一巡先见被改写了：看见这一巡的人的座位
    }
  // 被错开的牌里有人本来下一次摸牌就能自摸
  | { kind: 'nearMiss'; seat: number; turn: number; tile: TileId; by: number; call: string }
  // 不换牌的能力消息，比如松实玄打出宝牌
  | { kind: 'note'; seat: number; turn: number; ability: string; text: string };

const SHIFT_CALLS = ['吃', '碰', '杠'];

export class AbilityTrace {
  // 这一局到现在的记录，按发生顺序
  entries: TraceEntry[] = [];
  // 牌山本来的顺序：上一个事件之后的样子
  private live: TileId[] | null = null;
  private rinshan: TileId[] = [];
  // 摸牌前发出的能力消息，等这家摸完牌一起记
  private pending: { seat: number; ability: string; text: string } | null = null;

  // 牌局建好时（第一局已经发完牌、庄家摸了第一张）挂上。
  // 第一局开局时还没挂上，用种子重新洗一遍得到本来的牌山（建牌局时第一件事就是洗牌）
  constructor(
    private g: Game,
    seed: number,
  ) {
    const past = [...g.events];
    const first = new Wall(new Rng(seed));
    if (this.dealtMatches(first)) {
      this.live = first.live.slice(52);
      this.rinshan = first.rinshan.slice();
    }
    g.onEvent((e) => this.onEvent(e));
    for (const e of past) if (e.type !== 'roundStart') this.onEvent(e);
  }

  // 还原的牌山发出去的 52 张，要正好是现在四家手里的牌（庄家刚摸的那张除外）
  private dealtMatches(first: Wall): boolean {
    const g = this.g;
    const held = g.players.flatMap((p) => p.hand.filter((t) => t !== p.drawn || p.seat !== g.dealer));
    const dealt = first.live.slice(0, 52);
    return held.length === 52 && [...held].sort((a, b) => a - b).join() === [...dealt].sort((a, b) => a - b).join();
  }

  private onEvent(e: GameEvent): void {
    const g = this.g;
    if (e.type === 'roundStart') {
      this.entries = [];
      this.pending = null;
      this.snapshot();
      return;
    }
    if (e.type === 'ability') {
      this.flush();
      this.pending = { seat: e.seat, ability: e.ability, text: e.text };
      return;
    }
    if (e.type === 'draw' && this.pending?.seat === e.seat) {
      const p = this.pending;
      this.pending = null;
      this.onDraw(e.seat, p);
    } else {
      this.flush();
      if (e.type === 'draw') this.onDraw(e.seat, null);
      if (e.type === 'call' && SHIFT_CALLS.includes(e.call) && g.lastDiscard) this.onCall(e.seat, e.call);
    }
    this.snapshot();
  }

  private snapshot(): void {
    this.live = [...this.g.wall.live];
    this.rinshan = [...this.g.wall.rinshan];
  }

  // 能力消息后面没有跟着这家摸牌，就单独记一条
  private flush(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.entries.push({ kind: 'note', seat: p.seat, turn: this.turnOf(p.seat), ability: p.ability, text: p.text });
  }

  private turnOf(seat: number): number {
    return this.g.players[seat].discards.length + 1;
  }

  private onDraw(seat: number, ability: { ability: string; text: string } | null): void {
    const g = this.g;
    if (!this.live) return;
    const p = g.players[seat];
    const got = p.drawn!;
    const rinshan = g.rinshanDraw;
    const expected = rinshan ? this.rinshan[0] : this.live[0];
    if (expected === undefined || got === expected) return;
    let source: 'live' | 'rinshan' = 'live';
    let depth = this.live.indexOf(got);
    if (depth < 0) {
      source = 'rinshan';
      depth = this.rinshan.indexOf(got);
    }
    // 摸牌前的手牌听什么：就是“假设把刚摸的这张打掉”。岭上开花本身是役，摸到听的牌就能和
    const waits = waitInfo(g, seat, got).tiles;
    const wins = (t: TileId) => {
      const w = waits.find((x) => x.kind === kindOf(t));
      return !!w && (rinshan || !!w.tsumo);
    };
    this.entries.push({
      kind: 'swap',
      seat,
      turn: this.turnOf(seat),
      ability: ability?.ability ?? g.abilities[seat]?.id ?? null,
      text: ability?.text ?? null,
      rinshan,
      expected,
      got,
      source,
      depth,
      lostWin: wins(expected) && !wins(got),
      madeWin: g.legalActions(seat).some((a) => a.type === 'tsumo'),
    });
  }

  private onCall(seat: number, call: string): void {
    const g = this.g;
    const { seat: from, tile } = g.lastDiscard!;
    const shift = (seat - from + 4) % 4;
    const skipped = Array.from({ length: shift - 1 }, (_, i) => (from + 1 + i) % 4);
    const next = g.wall.live.slice(0, 4);
    const tokiSeat = g.abilities.findIndex((a) => a?.id === 'toki');
    const foresight = tokiSeat >= 0 && next.some((t) => g.wall.locked.has(t)) ? tokiSeat : null;
    this.entries.push({
      kind: 'shift',
      seat,
      turn: this.turnOf(seat),
      call,
      from,
      tile,
      nextWas: (from + 1) % 4,
      nextNow: (seat + 1) % 4,
      skipped,
      foresight,
    });
    // 接下来四张本来各归谁：打牌的下家起依次一人一张。本来能自摸的，记一笔“差一点”
    next.forEach((t, k) => {
      const owner = (from + 1 + k) % 4;
      if (owner === seat) return;
      const w = waitInfo(g, owner).tiles.find((x) => x.kind === kindOf(t));
      if (w?.tsumo) this.entries.push({ kind: 'nearMiss', seat: owner, turn: this.turnOf(owner), tile: t, by: seat, call });
    });
  }
}
