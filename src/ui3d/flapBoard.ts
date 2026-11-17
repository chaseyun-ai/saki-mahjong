// 翻牌屏（牌桌风格「翻牌屏」）仪表盘上的一块块翻牌：字变了就像车站的翻牌屏那样，一页一页翻，翻到新字为止
// （往近的那头翻：点数 25000 变 17000 是 16000、17000，不会先翻到 97000 再绕回来，看着不会以为涨了）
// （consoleLooks.ts 的 flap 照这个画，table3d.ts 翻着的时候每帧重画仪表盘，只把翻动的那几块传给显卡）。
// 每一块翻牌一个 key；第一次见到的直接是新字，不翻（刚进牌桌、指着仪表盘看点差的时候）

// 翻一页要多久（秒）；一排里从左到右每块晚多少开始翻
const STEP_T = 0.075;
const STAGGER = 0.03;

// 一块翻牌上的字按什么顺序排（翻一页是挨着的下一个字）：点数、本场是 0 到 9，余牌倒着排，风位东南西北
export const FLAP_UP = ' 0123456789';
export const FLAP_DOWN = '9876543210';
export const FLAP_WINDS = '东南西北';

interface Cell {
  // 现在露着的字（正在翻的话是翻之前那一页）
  shown: string;
  target: string;
  // 正在翻的这一页什么时候开始翻
  at: number;
  quiet: boolean;
}

// 一块翻牌这一帧的样子：cur 露着的字；next 正在翻出来的下一页（没在翻是 null），p 这一页翻了多少（0 到 1）
export interface FlapFace {
  cur: string;
  next: string | null;
  p: number;
}

// 翻一页是什么字：顺着这一圈往目标字近的那头走一个；目标字（或者现在的字）不在这一圈里就一页直接翻到
function nextFace(cur: string, target: string, cycle: string): string {
  const i = cycle.indexOf(cur);
  const j = cycle.indexOf(target);
  if (i < 0 || j < 0 || cur.length !== 1 || target.length !== 1) return target;
  const n = cycle.length;
  const ahead = (j - i + n) % n;
  return cycle[(i + (ahead <= n - ahead ? 1 : n - 1)) % n];
}

// 画布上的一块（像素，左上角起）
export interface FlapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class FlapBoard {
  now = 0;
  private cells = new Map<string, Cell>();
  private seen = new Set<string>();
  // 每块翻牌上一遍画成什么样；这一遍画得不一样的那几块在画布上的位置（table3d.ts 只把这几块传给显卡）
  private drawn = new Map<string, string>();
  private dirty: FlapRect[] = [];
  // 上次取走以后翻过几页（不算 quiet 的）：放翻牌声用
  private flips = 0;

  // 还有没翻完的（翻着的时候每帧重画仪表盘）
  get busy(): boolean {
    for (const c of this.cells.values()) if (c.shown !== c.target) return true;
    return false;
  }

  // 这一块现在该画什么。order：一排里第几块，越往右越晚开始翻一点；quiet：翻的时候不出声（余牌每摸一张都翻）
  face(key: string, target: string, cycle: string, order = 0, quiet = false): FlapFace {
    this.seen.add(key);
    let c = this.cells.get(key);
    if (!c) {
      c = { shown: target, target, at: this.now, quiet };
      this.cells.set(key, c);
    }
    if (c.target !== target) {
      // 正在翻的就接着翻（翻到哪页从哪页往新字翻）；停着的晚一点开始
      if (c.shown === c.target) c.at = this.now + order * STAGGER;
      c.target = target;
    }
    while (c.shown !== c.target && this.now >= c.at + STEP_T) {
      c.shown = nextFace(c.shown, c.target, cycle);
      c.at += STEP_T;
      if (!c.quiet) this.flips++;
    }
    if (c.shown === c.target || this.now < c.at) return { cur: c.shown, next: null, p: 0 };
    return { cur: c.shown, next: nextFace(c.shown, c.target, cycle), p: Math.min(1, (this.now - c.at) / STEP_T) };
  }

  // 这一块这一遍画成了 look（字、翻到哪、颜色、位置），在画布上占 rect：和上一遍画的不一样就记下来
  touch(key: string, look: string, rect: FlapRect): void {
    this.seen.add(key);
    if (this.drawn.get(key) === look) return;
    this.drawn.set(key, look);
    this.dirty.push(rect);
  }

  // 取走这一遍画得不一样的那几块
  takeDirty(): FlapRect[] {
    const d = this.dirty;
    this.dirty = [];
    return d;
  }

  // 画完一遍：这次没画到的翻牌扔掉（点数位数变了、换成点差、仪表盘换了样子）
  endFrame(): void {
    for (const k of this.cells.keys()) if (!this.seen.has(k)) this.cells.delete(k);
    for (const k of this.drawn.keys()) if (!this.seen.has(k)) this.drawn.delete(k);
    this.seen.clear();
  }

  // 取走翻过的页数
  takeFlips(): number {
    const n = this.flips;
    this.flips = 0;
    return n;
  }

  // 马上都翻到（跳过动画）
  snap(): void {
    for (const c of this.cells.values()) c.shown = c.target;
  }
}

// 2D 翻牌屏（app.ts 的 flip2d）：一块翻牌从 from 翻到 to，一页一页都是什么字（每一位各自往近的那头翻，翻到了就停；位数不一样就一页翻到）。
// 最多 max 页，超了最后一页直接是 to
export function flapPages(from: string, to: string, max = 11): string[] {
  const a = [...from];
  const b = [...to];
  if (a.length !== b.length) return from === to ? [] : [to];
  const cycleOf = (ch: string) => (FLAP_UP.includes(ch) ? FLAP_UP : FLAP_WINDS.includes(ch) ? FLAP_WINDS : '');
  const pages: string[] = [];
  let cur = a;
  while (cur.join('') !== to && pages.length < max) {
    cur = cur.map((ch, i) => (ch === b[i] ? ch : nextFace(ch, b[i], cycleOf(ch))));
    pages.push(cur.join(''));
  }
  if (pages.length && pages[pages.length - 1] !== to) pages[pages.length - 1] = to;
  return pages;
}
