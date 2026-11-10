import type { Character } from '../../src/abilities/characters';
import type { Ability, DrawRule } from '../../src/abilities/types';
import { chooseAction } from '../../src/ai/ai';
import { Game } from '../../src/engine/game';
import { Rng } from '../../src/engine/rng';
import { Wall } from '../../src/engine/wall';
import { TileId, isRed, kindLabel, kindOf } from '../../src/engine/tiles';

// 能力记录器：不改游戏代码，在外面包一层，记下每次摸牌从能力处理到取牌的全过程。
// - 每个能力钩子什么时候被调用、定了什么规矩
// - 每次“找牌来换”的调用：谁调的、换没换、换了哪两张
// - 摸牌前后核对：牌守恒、公开的牌没变、锁住的牌没动、没有钩子套钩子
// 配牌阶段的换牌也记下来（按局）。

export const tileText = (t: TileId | undefined) => (t === undefined ? '—' : `${kindLabel(kindOf(t))}${isRed(t) ? '(赤)' : ''}#${t}`);

export interface SwapRec {
  by: string; // 'awai.beforeDeal'、'kuro.beforeDraw'、'对账' 之类
  a: string; // 位置，比如 '牌山[0]'
  ta: TileId;
  b: string;
  tb: TileId;
  sameKind: boolean;
  redDiffers: boolean;
}

export interface DrawRec {
  round: string;
  idx: number; // 这一场的第几次摸牌
  seat: number;
  rinshan: boolean;
  lines: string[];
  hooks: string[]; // 依次调用的钩子
  bringCalls: number;
  swaps: SwapRec[];
  rules: { by: string; text: string; deniedHead: boolean }[];
  enforceTries: number;
  nested: number;
  conserved: boolean;
  publicSame: boolean;
  locksStay: boolean;
  drawn?: TileId;
}

export interface DealRec {
  round: string;
  swaps: SwapRec[];
  hooks: string[];
}

export interface GameRec {
  tag: string;
  seats: Character[];
  draws: DrawRec[];
  deals: DealRec[];
  game: Game;
}

// ---------- 记录状态 ----------
let curDraw: DrawRec | null = null;
let curDeal: DealRec | null = null;
let inApply = false;
const hookStack: string[] = [];
let nestedOutside = 0;

const say = (text: string) => curDraw?.lines.push(text);

function where(w: Wall): Map<TileId, string> {
  const m = new Map<TileId, string>();
  w.live.forEach((t, i) => m.set(t, `牌山[${i}]`));
  w.rinshan.forEach((t, i) => m.set(t, `岭上[${i}]`));
  w.doraIndicators.forEach((t, i) => m.set(t, `宝牌指示[${i}]`));
  w.uraIndicators.forEach((t, i) => m.set(t, `里宝指示[${i}]`));
  w.overflow.forEach((t, i) => m.set(t, `补进王牌[${i}]`));
  return m;
}

function headView(w: Wall, n = 8): string {
  return w.live
    .slice(0, n)
    .map((t) => `${tileText(t)}${w.locked.has(t) ? `🔒${w.locked.ownersOf(t).join('+')}` : ''}`)
    .join(' ');
}

export function tilesInPlay(g: Game): TileId[] {
  const all = [...g.wall.allTiles()];
  // 加杠等别人抢杠时，那张牌既不在手里也还没进副露
  if (g.kakanInfo) all.push(g.kakanInfo.tile);
  for (const p of g.players) {
    all.push(...p.hand);
    p.melds.forEach((m) => all.push(...m.tiles));
    p.discards.forEach((d) => {
      if (!d.called) all.push(d.tile);
    });
  }
  return all;
}

function conserved(g: Game): boolean {
  const t = tilesInPlay(g).sort((a, b) => a - b);
  return t.length === 136 && t.every((x, i) => x === i);
}

function publicView(g: Game) {
  return {
    hands: g.players.map((p) => [...p.hand].sort((a, b) => a - b)),
    melds: g.players.map((p) => JSON.stringify(p.melds)),
    discards: g.players.map((p) => JSON.stringify(p.discards)),
    dora: g.wall.visibleDoraIndicators().join(','),
  };
}

// ---------- 装上 / 卸下 ----------
type Restore = () => void;
let restores: Restore[] = [];

function patch(proto: any, name: string, make: (orig: any) => any) {
  const orig = proto[name];
  if (typeof orig !== 'function') throw new Error(`记录器：找不到 ${name}，游戏代码改名了？`);
  proto[name] = make(orig);
  restores.push(() => (proto[name] = orig));
}

function install() {
  if (restores.length) return;
  for (const name of ['bringToLive', 'bringToRinshan', 'bringToUra'] as const) {
    patch(Wall.prototype, name, (orig) =>
      function (this: Wall, ...args: any[]) {
        const before = where(this);
        const ok = orig.apply(this, args);
        const after = where(this);
        const moved = [...before].filter(([t, p]) => after.get(t) !== p).map(([t]) => t);
        if (moved.length !== 0 && moved.length !== 2) throw new Error(`一次换牌动了 ${moved.length} 张`);
        const by = hookStack.at(-1) ?? (inApply ? '对账' : '其他');
        const swaps: SwapRec[] = [];
        if (moved.length === 2) {
          const [x, y] = moved;
          swaps.push({ by, a: before.get(x)!, ta: x, b: before.get(y)!, tb: y, sameKind: kindOf(x) === kindOf(y), redDiffers: isRed(x) !== isRed(y) });
        }
        if (curDraw) {
          curDraw.bringCalls++;
          if (by === '对账') curDraw.enforceTries++;
          const target = name === 'bringToLive' ? `牌山[${args[0]}]` : name === 'bringToRinshan' ? '岭上[0]' : `里宝指示[${args[0]}]`;
          const s = swaps[0];
          const how = !ok ? '失败' : s ? `交换 ${s.a} ${tileText(s.ta)} ⇄ ${s.b} ${tileText(s.tb)}${s.sameKind ? '（同种牌）' : ''}` : '已满足，不换';
          say(`  · [${by}] ${name}(${target}) → ${how}`);
          curDraw.swaps.push(...swaps);
        } else if (curDeal) curDeal.swaps.push(...swaps);
        return ok;
      },
    );
  }

  patch(Game.prototype, 'startRound', (orig) =>
    function (this: Game) {
      curDeal = { round: '', swaps: [], hooks: [] };
      recorder.deals.push(curDeal);
      orig.call(this);
    },
  );

  patch(Game.prototype, 'drawFor', (orig) =>
    function (this: Game, seat: number, rinshan: boolean) {
      if (curDeal) {
        curDeal.round = this.roundLabel();
        curDeal = null;
      }
      if (!rinshan && this.wall.remaining === 0) return orig.call(this, seat, rinshan);
      const rec: DrawRec = {
        round: this.roundLabel(),
        idx: recorder.draws.length,
        seat,
        rinshan,
        lines: [],
        hooks: [],
        bringCalls: 0,
        swaps: [],
        rules: [],
        enforceTries: 0,
        nested: curDraw ? 1 : 0,
        conserved: true,
        publicSame: true,
        locksStay: true,
      };
      if (curDraw) curDraw.nested++;
      curDraw = rec;
      recorder.draws.push(rec);
      const w = this.wall;
      const head = rinshan ? w.rinshan[0] : w.live[0];
      const pub0 = publicView(this);
      const pos0 = where(w);
      const locked0 = [...w.locked].map((t) => ({ t, at: pos0.get(t)!, owners: w.locked.ownersOf(t) }));
      rec.conserved = conserved(this);
      say(`摸牌开始：${recorder.names[seat]}（座位 ${seat}）${rinshan ? '摸岭上牌' : '摸牌山'}，下一张是 ${tileText(head)}，牌山剩 ${w.remaining} 张`);
      say(`  牌山前 8 张：${headView(w)}`);
      orig.call(this, seat, rinshan);
      rec.drawn = this.players[seat].drawn ?? undefined;
      say(`取牌：${recorder.names[seat]} 摸到 ${tileText(rec.drawn)}`);
      say(`  牌山前 8 张（取牌后）：${headView(w)}`);
      rec.conserved &&= conserved(this);
      const pub1 = publicView(this);
      const expect = [...pub0.hands[seat], rec.drawn!].sort((a, b) => a - b).join();
      rec.publicSame =
        pub1.dora === pub0.dora &&
        pub1.hands.every((h, s) => h.join() === (s === seat ? expect : pub0.hands[s].join())) &&
        pub1.melds.every((m, s) => m === pub0.melds[s]) &&
        pub1.discards.every((d, s) => d === pub0.discards[s]);
      // 锁住的牌：除了被摸走的、被主人自己解开的，摸牌前后位置一样（牌山整体前移一格不算）
      const pos1 = where(w);
      for (const { t, at, owners } of locked0) {
        if (t === rec.drawn) continue;
        const shifted = /^牌山\[(\d+)\]$/.exec(at);
        // 摸岭上牌时，后面的岭上牌往前挪一格（咲看见的岭上牌是锁着的）
        const dead = /^岭上\[(\d+)\]$/.exec(at);
        const expectAt = shifted && !rinshan ? `牌山[${+shifted[1] - 1}]` : dead && rinshan ? `岭上[${+dead[1] - 1}]` : at;
        const now = pos1.get(t)!;
        if (now === expectAt) continue;
        if (rinshan && now.startsWith('补进王牌')) continue;
        if (!w.locked.has(t) && owners.every((o) => o === 'koromo')) continue; // 衣解开自己的海底锁，重新安排
        rec.locksStay = false;
      }
      curDraw = null;
    },
  );

  patch(Game.prototype, 'applyDrawAbilities', (orig) =>
    function (this: Game, seat: number, rinshan: boolean, ...rest: unknown[]) {
      inApply = true;
      try {
        orig.call(this, seat, rinshan, ...rest);
      } finally {
        inApply = false;
      }
      say(`对账结束：下一张定为 ${tileText(rinshan ? this.wall.rinshan[0] : this.wall.live[0])}`);
    },
  );
}

export function uninstallRecorder() {
  for (const r of restores.reverse()) r();
  restores = [];
}

// 每个能力的每个钩子包一层：记下调用、规矩，发现钩子套钩子
const HOOKS = ['beforeDeal', 'onRoundStart', 'beforeAnyDraw', 'beforeDraw', 'afterDraw', 'afterDiscard'] as const;
function wrapAbility(a: Ability | null, who: string): Ability | null {
  if (!a) return a;
  const out: any = { ...a };
  for (const h of HOOKS) {
    const inner = (a as any)[h];
    if (!inner) continue;
    out[h] = (...args: any[]) => {
      const g = args[0] as Game;
      const label = `${who}.${h}`;
      if (hookStack.length) {
        if (curDraw) curDraw.nested++;
        else nestedOutside++;
      }
      if (curDraw) {
        curDraw.hooks.push(label);
        say(`▶ ${label}${h === 'beforeAnyDraw' || h === 'beforeDraw' ? `（已生效的规矩：${g.wall.deny ? '有' : '无'}）` : ''}`);
      } else curDeal?.hooks.push(label);
      hookStack.push(label);
      let r: DrawRule | null | void;
      try {
        r = inner.apply(a, args);
      } finally {
        hookStack.pop();
      }
      if (curDraw && h === 'beforeAnyDraw') {
        if (r) {
          const head = curDraw.rinshan ? g.wall.rinshan[0] : g.wall.live[0];
          const denied = r.deny(head);
          curDraw.rules.push({ by: who, text: r.text, deniedHead: denied });
          say(`  · 定下规矩「${r.text}」：下一张 ${tileText(head)} ${denied ? '违反' : '不违反'}`);
        } else say('  · 不定规矩');
      }
      return r;
    };
  }
  return out;
}

const recorder = { draws: [] as DrawRec[], deals: [] as DealRec[], names: [] as string[] };

export const nestedOutsideDraws = () => nestedOutside;

// 打一整场，记下全部摸牌。座位按种子打乱（和大乱斗一样）
export function recordGame(seed: number, chars: Character[]): GameRec {
  install();
  const seats = new Rng(seed * 7919).shuffle([...chars]);
  recorder.draws = [];
  recorder.deals = [];
  recorder.names = seats.map((c) => c.name);
  const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: wrapAbility(c.ability, c.id) })) });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  if (g.phase !== 'gameEnd') throw new Error(`种子 ${seed} 打不完`);
  return { tag: `种子 ${seed}：${seats.map((c, i) => `${i}${c.name}`).join(' ')}`, seats, draws: recorder.draws, deals: recorder.deals, game: g };
}
