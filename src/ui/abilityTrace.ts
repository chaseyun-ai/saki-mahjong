import { AWAI } from '../abilities/awai';
import { MOON_PHASES } from '../abilities/koromo';
import { TOKA } from '../abilities/toka';
import type { Game, GameEvent } from '../engine/game';
import { TileId, kindOf } from '../engine/tiles';
import { waitInfo } from './waitInfo';
import { tokiSeen } from '../abilities/toki';

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
      by: number | null; // 换牌的是别人的控场能力时，是谁
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

interface Pending {
  seat: number;
  ability: string;
  text: string;
  target: number;
}

export class AbilityTrace {
  // 这一局到现在的记录，按发生顺序
  entries: TraceEntry[] = [];
  // 牌山本来的顺序：上一个事件之后的样子
  private live: TileId[];
  private rinshan: TileId[] = [];
  // 摸牌前发出的能力消息，等摸牌的那家摸完牌一起记
  private pending: Pending[] = [];

  // 牌局建好时（第一局已经发完牌、庄家摸了第一张）挂上。第一局本来的牌山用规则引擎发完牌时留的底
  constructor(private g: Game) {
    const past = [...g.events];
    this.live = g.dealtWall.live.slice();
    this.rinshan = g.dealtWall.rinshan.slice();
    g.onEvent((e) => this.onEvent(e));
    for (const e of past) if (e.type !== 'roundStart') this.onEvent(e);
  }

  private onEvent(e: GameEvent): void {
    const g = this.g;
    if (e.type === 'roundStart') {
      this.entries = [];
      this.pending = [];
      this.snapshot();
      return;
    }
    if (e.type === 'ability') {
      this.pending.push({ seat: e.seat, ability: e.ability, text: e.text, target: e.target ?? e.seat });
      return;
    }
    if (e.type === 'draw') {
      const mine = this.pending.filter((p) => p.target === e.seat);
      this.pending = this.pending.filter((p) => p.target !== e.seat);
      this.flush();
      this.onDraw(e.seat, mine);
    } else {
      this.flush();
      if (e.type === 'call' && SHIFT_CALLS.includes(e.call) && g.lastDiscard) this.onCall(e.seat, e.call);
    }
    this.snapshot();
  }

  private snapshot(): void {
    this.live = [...this.g.wall.live];
    this.rinshan = [...this.g.wall.rinshan];
  }

  // 能力消息后面没有跟着换牌，就单独记一条
  private flush(list = this.pending): void {
    for (const p of list) this.entries.push({ kind: 'note', seat: p.seat, turn: this.turn(), ability: p.ability, text: p.text });
    if (list === this.pending) this.pending = [];
  }

  // 第几巡：按这一局从牌山摸了几张算，四张一巡（鸣牌跳过的人不另算），整局从前往后不会倒退
  private turn(): number {
    const w = this.g.wall;
    const drawn = 70 - w.remaining - w.overflow.length;
    return Math.floor(Math.max(0, drawn - 1) / 4) + 1;
  }

  // abilities：摸牌前作用在这家摸牌上的能力消息。最后一条算换牌的（控场的规矩最后执行），其余的单独记
  private onDraw(seat: number, abilities: Pending[]): void {
    const g = this.g;
    const p = g.players[seat];
    const got = p.drawn!;
    const rinshan = g.rinshanDraw;
    const expected = rinshan ? this.rinshan[0] : this.live[0];
    if (expected === undefined || got === expected) {
      this.flush(abilities);
      return;
    }
    this.flush(abilities.slice(0, -1));
    const ability = abilities.at(-1) ?? null;
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
      turn: this.turn(),
      ability: ability?.ability ?? g.abilities[seat]?.id ?? null,
      text: ability?.text ?? null,
      by: ability && ability.seat !== seat ? ability.seat : null,
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
    const seen = tokiSeat >= 0 ? tokiSeen(g, tokiSeat) : [];
    const foresight = next.some((t) => seen.includes(t)) ? tokiSeat : null;
    this.entries.push({
      kind: 'shift',
      seat,
      turn: this.turn(),
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
      if (w?.tsumo) this.entries.push({ kind: 'nearMiss', seat: owner, turn: this.turn(), tile: t, by: seat, call });
    });
  }
}

// ---------- 讲给玩家听 ----------

export interface TraceLine {
  turn: number;
  tag: '能力' | '错位' | '差一点';
  cls: 'ability' | 'shift' | 'miss';
  html: string;
}

// 不换牌的能力消息，有的换个说法更好懂
const NOTE_TEXT: Record<string, (who: string) => string> = {
  'awai-时间迟滞': (who) => `${who}的时间迟滞：另外三家的配牌压到 ${AWAI.slowShanten}–${AWAI.slowShanten + 1} 向听（挡得住、会支配牌山的人是 ${AWAI.slowShantenWeak} 向听）。`,
  'koromo-海底捞月': (who) => `${who}摸到了牌山最后一张：海底捞月。`,
  ...Object.fromEntries(
    MOON_PHASES.map((m) => [`koromo-${m.name}`, (who: string) => `今晚是${m.name}${m.icon}，${who}的能力${m.power >= 1 ? '全开' : `只有满月时的 ${Math.round(m.power * 100)}%`}。`]),
  ),
  'hatsumi-鬼门': (who) => `${who}坐北家：鬼门打开，配牌里东风、北风各两张。`,
  'hatsumi-里鬼门': (who) => `${who}把东风、北风都鸣了出来：里鬼门，西风、南风会接着来。`,
  'hatsumi-西风': (who) => `${who}的里鬼门：摸到西风。`,
  'hatsumi-南风': (who) => `${who}的里鬼门：摸到南风。`,
  'hatsumi-鬼门·杠': (who) => `${who}配牌的风牌暗刻，摸到了第四张。`,
  'toka-治水': (who) => `场上的点数已经动了 ${TOKA.threshold / 10000} 万点以上，${who}进入治水：牌局平静如水，别人只摸得到谁也鸣不了的牌。`,
  'jun-错开流向': (who) => `${who}鸣牌错开了流向：到她下一次摸牌之前，别人摸牌不进张。`,
  'haru-快和': (who) => `有人立直了，${who}只想快点结束：摸到一张小和了牌。`,
  'kasumi-请神': (who) => `${who}落后了，请神上身。之后整场都不会退。`,
  ...Object.fromEntries(
    ['万', '筒', '索'].map((s) => [`kasumi-绝一门·${s}子`, (who: string) => `${who}这一局绝了${s}子：别人的配牌里没有，摸也摸不到。`]),
  ),
};

// 把一条记录写成解说的一句话。name：座位的名字；tile：一张牌的样子（结算画面用小牌图）
export function traceLine(x: TraceEntry, name: (seat: number) => string, tile: (t: TileId) => string): TraceLine {
  const who = name(x.seat);
  if (x.kind === 'note') {
    const html = NOTE_TEXT[`${x.ability}-${x.text}`]?.(who) ?? `${who}${x.text}。`;
    return { turn: x.turn, tag: '能力', cls: 'ability', html };
  }
  if (x.kind === 'nearMiss') {
    return { turn: x.turn, tag: '差一点', cls: 'miss', html: `要不是${name(x.by)}这一${x.call}，${who}下一次摸牌就能自摸 ${tile(x.tile)}。` };
  }
  if (x.kind === 'shift') {
    let html = `${who}${x.call}了${name(x.from)}打的 ${tile(x.tile)}，牌序错开：下一张本来是${name(x.nextWas)}摸，现在轮到${name(x.nextNow)}。`;
    if (x.skipped.length) html += `${x.skipped.map(name).join('、')}少摸了一次。`;
    // 一巡先见几乎每次鸣牌都会被改写，只在怜自己鸣牌时说（她是看着未来去改的）
    if (x.foresight === x.seat) html += `${who}用这一手改写了自己看到的一巡。`;
    return { turn: x.turn, tag: '错位', cls: 'shift', html };
  }
  const from =
    x.source === 'rinshan'
      ? `这张原本是第 ${x.depth + 1} 张岭上牌。`
      : `这张原本埋在牌山第 ${x.depth + 1} 张${x.depth >= 4 ? `，本来要 ${Math.floor(x.depth / 4)} 巡以后才露面` : ''}。`;
  let html: string;
  if (x.rinshan) {
    html = `${who}开杠，岭上牌本来是 ${tile(x.expected)}，翻上来的却是 ${tile(x.got)}。${from}`;
  } else {
    const got =
      x.text === '宝牌聚集'
        ? `宝牌 ${tile(x.got)}`
        : x.text === '杠的气息'
          ? `能开杠的 ${tile(x.got)}`
          : x.text === '杠里'
            ? `和了牌 ${tile(x.got)}`
            : tile(x.got);
    html = `${who}本来该摸 ${tile(x.expected)}，摸到的却是${got}。${from}`;
    if (x.by !== null) html = `${name(x.by)}的「${x.text}」：${html}`;
    if (x.ability === 'saki' && x.text === null) html += '对子悄悄长成了刻子，没有人察觉。';
    if (x.ability === 'awai' && x.text === null) html += '她在等转角暗杠，和了牌先往后放一放。';
    if (x.ability === 'kuro' && x.text === null) html += '她打出过宝牌，宝牌再也不来了。';
  }
  if (x.madeWin) html += '这一张正好和了。';
  if (x.lostWin) html += `被换走的那张，本来能让${who}直接自摸。`;
  return { turn: x.turn, tag: '能力', cls: 'ability', html };
}
