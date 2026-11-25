import './resultFlow.css';
import { DENOMS, StickMove, Sticks, count, total } from './tenbou';

// 新结算（试做，视觉设置「结算画面：新」）：一局结束以后照雀魂的节奏分几页放，盖在 3D / 2.5D 牌桌上面。
//   荒牌流局、途中流局：牌桌中间先出大字，每家手牌上挂「听牌 / 未听」，听牌的带上听哪几张
//   和牌：每个和牌的人一页（全屏立绘、手牌、宝牌里宝牌、役一条条出来、最后盖番符章），再进点数移动
//   点数移动：四家的点数卡摆在各自那一边；点棒排着队一根根沿弧线从付的人走到收的人，
//     多给的那边找零的棒再沿原路走回来，数字跟着变，名次重排（点棒怎么配、怎么找零在 tenbou.ts）
// 每页右下角「继续」带倒数，数到 0 自己翻页；最后一页翻完交回 app 进下一局。
// 原版的结算弹窗不动（app.ts 的 resultHtml），这里只管新结算的几页。

export interface FlowPage {
  html: string;
  // 这一页倒数几秒自己翻页
  secs: number;
  // 页面放进去以后要做的事（点棒走、点数滚动）；返回收尾函数
  after?: (el: HTMLElement) => (() => void) | void;
}

export class ResultFlow {
  private idx = -1;
  private tick: number | null = null;
  private left = 0;
  private paused = false;
  private cleanup: (() => void) | null = null;

  constructor(
    private layer: HTMLElement,
    private pages: FlowPage[],
    private onDone: () => void,
  ) {
    layer.addEventListener('click', this.onClick);
    // 打开能力痕迹看的时候不自己翻页
    layer.addEventListener('toggle', this.onToggle, true);
    this.next();
  }

  private onClick = (e: MouseEvent): void => {
    if ((e.target as HTMLElement).closest('[data-ui=rf-next]')) this.next();
  };

  private onToggle = (e: Event): void => {
    if ((e.target as HTMLDetailsElement).open) this.pause();
  };

  next(): void {
    this.stop();
    this.idx++;
    if (this.idx >= this.pages.length) {
      this.dispose();
      this.onDone();
      return;
    }
    const p = this.pages[this.idx];
    this.layer.innerHTML = p.html;
    const el = this.layer.firstElementChild as HTMLElement | null;
    const done = el && p.after ? p.after(el) : null;
    this.cleanup = done || null;
    this.left = p.secs;
    this.paused = false;
    this.paint();
    this.tick = window.setInterval(() => {
      if (this.paused) return;
      this.left--;
      this.paint();
      if (this.left <= 0) this.next();
    }, 1000);
  }

  private pause(): void {
    this.paused = true;
    this.paint();
  }

  private paint(): void {
    const n = this.layer.querySelector('.rf-next i');
    if (n) n.textContent = this.paused ? '' : String(Math.max(0, this.left));
  }

  private stop(): void {
    if (this.tick !== null) clearInterval(this.tick);
    this.tick = null;
    this.cleanup?.();
    this.cleanup = null;
  }

  dispose(): void {
    this.stop();
    this.layer.removeEventListener('click', this.onClick);
    this.layer.removeEventListener('toggle', this.onToggle, true);
    this.layer.innerHTML = '';
  }
}

// ---------- 流局的大字 ----------

// 牌桌中间的大字（荒牌流局 / 途中流局：四风连打…），tags 是挂在每家手牌上的「听牌 / 未听」，waits 是听的那几张牌
export function drawBannerHtml(main: string, sub: string, tags: { x: number; y: number; tenpai: boolean; waits?: string }[]): string {
  const t = tags
    .map(
      (g) =>
        `<div class="rf-tag${g.tenpai ? ' yes' : ''}${g.tenpai && g.waits ? ' with-tiles' : ''}" style="left:${g.x.toFixed(0)}px;top:${g.y.toFixed(0)}px">${g.tenpai ? '听牌' : '未听'}${g.tenpai && g.waits ? `<div class="rf-tag-waits">${g.waits}</div>` : ''}</div>`,
    )
    .join('');
  return `<div class="rf-draw"><div class="rf-draw-band"><span class="rf-draw-main">${main}</span>${sub ? `<span class="rf-draw-sub">${sub}</span>` : ''}</div>${t}</div>`;
}

// ---------- 点数移动（点棒） ----------

export interface PointSeat {
  seat: number;
  rel: number; // 0 自己（下面）、1 下家（右）、2 对家（上）、3 上家（左）
  name: string;
  color: string;
  portrait: string; // 头像图，空的用名字最后一个字
  glyph: string;
  before: number;
  after: number;
  rankBefore: number; // 1..4
  rankAfter: number;
  mine: boolean;
  // 荒牌流局时点数卡下面那一行：听哪几张 / 未听（和牌、途中流局没有）
  wait?: string;
}

// 点棒这一页要的东西：每家结算前手里的棒（只用来算怎么付、怎么找零，不画出来）、一笔笔怎么走、
// 桌上留着的立直棒（荒牌流局没人拿走）
export interface StickPlay {
  start: Sticks[];
  moves: StickMove[];
  potLeft: number;
}

const POS = ['bottom', 'right', 'top', 'left'];
const fmt = (n: number) => n.toLocaleString('en-US');

// 一根点棒（颜色、点的花样在 CSS 里按面额画）
const stick = (i: number) => `<i class="tb tb-${DENOMS[i]}"></i>`;

// 中间的立直棒（供托）
function potHtml(n: number): string {
  return `${Array.from({ length: Math.min(n, 8) }, () => stick(2)).join('')}<b>供托 ×${n}</b>`;
}

// 页面最下面的图例：颜色对点数
const LEGEND = `<div class="rf-legend">${DENOMS.map((d, i) => `<span>${stick(i)}${fmt(d)}</span>`).join('')}</div>`;

// extra：流局时没有和牌页，能力痕迹放在这一页左下角
export function pointsPageHtml(round: string, seats: PointSeat[], extra = '', sticks?: StickPlay): string {
  const cards = seats
    .map((p) => {
      const d = p.after - p.before;
      const cls = d > 0 ? 'plus' : d < 0 ? 'minus' : 'zero';
      const img = p.portrait ? `<img src="${p.portrait}" alt="" onerror="this.remove()" />` : '';
      return `<div class="rf-card ${POS[p.rel]}${p.mine ? ' mine' : ''}" data-seat="${p.seat}" style="--c:${p.color}">
        <span class="rf-rank" data-to="${p.rankAfter}"><b>${p.rankBefore}</b>位</span>
        <span class="rf-face"><span>${p.glyph}</span>${img}</span>
        <span class="rf-info">
          <span class="rf-line"><span class="rf-cname">${p.name}</span><span class="rf-delta ${cls}">${d > 0 ? '+' : ''}${d ? fmt(d) : '±0'}</span></span>
          <span class="rf-score" data-from="${p.before}" data-to="${p.after}">${fmt(p.before)}</span>
        </span>
        ${p.wait ?? ''}
      </div>`;
    })
    .join('');
  const potN = sticks ? sticks.moves.filter((m) => m.from < 0).reduce((a, m) => a + count(m.give), 0) + sticks.potLeft : 0;
  const pot = sticks ? `<div class="rf-pot${potN ? '' : ' empty'}">${potN ? potHtml(potN) : ''}</div>` : '';
  return `<div class="rf-page rf-points">
    <div class="rf-round">${round}</div>
    ${pot}
    ${cards}
    ${sticks ? LEGEND : ''}
    ${extra}
    <button class="rf-next" data-ui="rf-next">继续 <i></i></button>
  </div>`;
}

// 一笔里的棒从大到小排成队（递过去、找回来都是这个顺序）
export function queueOf(h: Sticks): number[] {
  const out: number[] = [];
  h.forEach((n, i) => {
    for (let k = 0; k < n; k++) out.push(i);
  });
  return out;
}

// 点棒怎么走的时间表（毫秒，从这一页放进去算）：每一笔隔一会儿开始，几笔可以同时走；
// 一笔里先是付的人的棒一根接一根沿弧线走过去，最后一根到了，找零的棒再一根接一根沿原路走回来。
// fly：一根走完这条路要多久；step：一根接一根隔多久（横着的棒顺着路走时要隔开一根的长度，不然叠在一起）
export const STICK_T = { first: 700, apart: 520, step: 80, gap: 160, fly: 1000 };
export interface StickRun {
  move: number;
  give: { start: number; arrive: number }; // 第一根出发、最后一根到
  back: { start: number; arrive: number } | null;
  step: number; // 一根接一根隔多久出发
}
export function stickTimeline(
  moves: StickMove[],
  fly: (move: number) => number = () => STICK_T.fly,
  step: (move: number) => number = () => STICK_T.step,
): { runs: StickRun[]; end: number } {
  let end = STICK_T.first;
  const runs = moves.map((m, i) => {
    const f = fly(i);
    const st = step(i);
    const g0 = STICK_T.first + i * STICK_T.apart;
    const give = { start: g0, arrive: g0 + (queueOf(m.give).length - 1) * st + f };
    const nb = queueOf(m.back).length;
    const back = nb ? { start: give.arrive + STICK_T.gap, arrive: give.arrive + STICK_T.gap + (nb - 1) * st + f } : null;
    end = Math.max(end, (back ?? give).arrive);
    return { move: i, give, back, step: st };
  });
  return { runs, end };
}

// 点数页放进去以后：点棒排着队，一根一根从付的人沿弧线走到收的人那里，路中间写着这一笔多少点；
// 有找零的，找零的棒再一根根沿原路走回来。最后一根走到的时候两家的点数滚过去，全部走完换名次。
// 没有点棒（老的调用）就只滚数字
export function animatePoints(el: HTMLElement, seats: PointSeat[], sticks?: StickPlay): () => void {
  const timers: number[] = [];
  const rafs = new Set<number>();
  const anims: Animation[] = [];
  const later = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const scoreEl = (s: number) => el.querySelector<HTMLElement>(`.rf-card[data-seat="${s}"] .rf-score`);
  const shown = seats.map((p) => p.before);
  // 点数从现在显示的滚到 to
  const roll = (s: number, to: number, dur: number) => {
    const node = scoreEl(s);
    if (!node) return;
    const from = shown[s];
    shown[s] = to;
    if (still || dur <= 0) {
      node.textContent = fmt(to);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      node.textContent = fmt(Math.round(from + (to - from) * e));
      if (k < 1) rafs.add(requestAnimationFrame(step));
    };
    rafs.add(requestAnimationFrame(step));
  };
  const swapRanks = () => {
    for (const r of el.querySelectorAll<HTMLElement>('.rf-rank')) {
      const b = r.querySelector('b');
      if (!b || b.textContent === r.dataset.to) continue;
      b.textContent = r.dataset.to ?? '';
      r.classList.add('moved');
    }
  };
  const done = () => {
    timers.forEach(clearTimeout);
    rafs.forEach(cancelAnimationFrame);
    anims.forEach((a) => a.cancel());
  };

  if (!sticks || still) {
    if (still) {
      el.querySelector('.rf-pot')?.classList.toggle('empty', !sticks?.potLeft);
      seats.forEach((p) => roll(p.seat, p.after, 0));
      swapRanks();
      return done;
    }
    later(550, () => seats.forEach((p) => roll(p.seat, p.after, 1100)));
    later(550 + 1100 + 120, swapRanks);
    return done;
  }

  const box = el.getBoundingClientRect();
  const rectOf = (s: number) => el.querySelector<HTMLElement>(`.rf-card[data-seat="${s}"]`)?.getBoundingClientRect() ?? null;
  const center = (r: DOMRect) => ({ x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top });
  // 从矩形中心朝 to 走，走到矩形边上再空一点
  const edge = (r: DOMRect, to: { x: number; y: number }, pad: number) => {
    const c = center(r);
    const dx = to.x - c.x;
    const dy = to.y - c.y;
    const k = Math.min(Math.abs(r.width / 2 / (dx || 1e-6)), Math.abs(r.height / 2 / (dy || 1e-6)));
    const len = Math.hypot(dx, dy) || 1;
    return { x: c.x + dx * k + (dx / len) * pad, y: c.y + dy * k + (dy / len) * pad };
  };
  const pot = el.querySelector<HTMLElement>('.rf-pot');
  const potRect = pot?.getBoundingClientRect();
  const potAt = potRect && potRect.width ? center(potRect) : { x: box.width / 2, y: box.height / 2 };

  // 每一笔的路：和最早的箭头一样，从付的人卡边出发、往牌桌中间弯一点、到收的人卡边（供托从桌子中间出发）
  type Pt = { x: number; y: number };
  const paths = sticks.moves.map((m) => {
    const rb = rectOf(m.to);
    if (!rb) return null;
    let s: Pt;
    if (m.from < 0) s = potAt;
    else {
      const ra = rectOf(m.from);
      if (!ra) return null;
      s = edge(ra, center(rb), 4);
    }
    const t = edge(rb, m.from < 0 ? potAt : center(rectOf(m.from)!), 6);
    const mx = (s.x + t.x) / 2;
    const my = (s.y + t.y) / 2;
    const c = m.from < 0 ? { x: mx, y: my } : { x: mx + (box.width / 2 - mx) * 0.35, y: my + (box.height / 2 - my) * 0.35 };
    const at = (u: number): Pt => ({ x: (1 - u) ** 2 * s.x + 2 * (1 - u) * u * c.x + u * u * t.x, y: (1 - u) ** 2 * s.y + 2 * (1 - u) * u * c.y + u * u * t.y });
    const dir = (u: number): Pt => ({ x: 2 * (1 - u) * (c.x - s.x) + 2 * u * (t.x - c.x), y: 2 * (1 - u) * (c.y - s.y) + 2 * u * (t.y - c.y) });
    let len = 0;
    for (let k = 1; k <= 20; k++) len += Math.hypot(at(k / 20).x - at((k - 1) / 20).x, at(k / 20).y - at((k - 1) / 20).y);
    return { at, dir, len };
  });
  // 走的棒半根多长（手机上短一点，CSS 里定的 --rw）
  const runHalf = () => (parseFloat(getComputedStyle(el).getPropertyValue('--rw')) || 112) / 2;
  // 走多久跟着路有多长（一秒走 650 像素左右）
  const flyOf = (i: number) => Math.min(1300, Math.max(750, (paths[i]?.len ?? 600) / 0.65));
  // 一根接一根隔多久：横着的棒沿路往前走，前后两根在走的方向上要让开「棒在这个方向上占的长度」再空一点
  const stepOf = (i: number) => {
    const path = paths[i];
    if (!path) return STICK_T.step;
    const w = runHalf() * 2;
    const h = w * 0.11;
    let need = 0;
    for (let k = 0; k <= 10; k++) {
      const v = path.dir(k / 10);
      const len = Math.hypot(v.x, v.y) || 1;
      need = Math.max(need, (Math.abs(v.x) / len) * w + (Math.abs(v.y) / len) * h);
    }
    const speed = path.len / flyOf(i);
    return Math.max(STICK_T.step, (need + Math.max(10, h * 1.6)) / speed);
  };
  const { runs, end } = stickTimeline(sticks.moves, flyOf, stepOf);

  // 一根棒沿路走一趟（reverse：找零，从收的人走回付的人）。棒一直横着放（像摆在桌上那样），一根根排成队往前走；
  // 落在下面的影子在外层，所以不管往哪走影子都往下
  const runStick = (d: number, path: NonNullable<(typeof paths)[number]>, ms: number, reverse: boolean) => {
    const node = document.createElement('span');
    node.className = 'rf-run';
    node.innerHTML = `<i class="tb tb-${DENOMS[d]}"></i>`;
    el.appendChild(node);
    const move: Keyframe[] = [];
    const N = 24;
    for (let k = 0; k <= N; k++) {
      const p = path.at(reverse ? 1 - k / N : k / N);
      move.push({ transform: `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`, opacity: k === 0 || k === N ? 0 : 1, offset: k / N });
    }
    // 匀速走，排的队间隔一样
    anims.push(node.animate(move, { duration: ms, easing: 'linear', fill: 'forwards' }));
    later(ms + 20, () => node.remove());
  };
  // 路中间的点数牌子（往外让开一点，不压着走过的棒）
  const label = (path: NonNullable<(typeof paths)[number]>, text: string, change: boolean, from: number, to: number) => {
    const half = runHalf();
    const node = document.createElement('div');
    node.className = `rf-amt${change ? ' change' : ''}`;
    node.textContent = text;
    const p = path.at(0.5);
    const v = path.dir(0.5);
    const len = Math.hypot(v.x, v.y) || 1;
    let nx = -v.y / len;
    let ny = v.x / len;
    // 朝离牌桌中间远的那边让
    if (nx * (box.width / 2 - p.x) + ny * (box.height / 2 - p.y) > 0) {
      nx = -nx;
      ny = -ny;
    }
    // 牌子让到横着的棒外面：法线方向上棒占多宽，再空一点
    const off = (change ? -1 : 1) * (Math.abs(nx) * half + Math.abs(ny) * half * 0.11 + 18);
    node.style.left = `${(p.x + nx * off).toFixed(1)}px`;
    node.style.top = `${(p.y + ny * off).toFixed(1)}px`;
    el.appendChild(node);
    later(from, () => node.classList.add('on'));
    later(to, () => node.classList.remove('on'));
  };

  let potN = sticks.moves.filter((m) => m.from < 0).reduce((a, m) => a + count(m.give), 0) + sticks.potLeft;
  runs.forEach((run) => {
    const m = sticks.moves[run.move];
    const path = paths[run.move];
    const fly = flyOf(run.move);
    if (path) {
      const owe = m.short ? `（欠 ${fmt(m.short)}）` : '';
      label(path, m.from < 0 ? `供托 ${fmt(m.pts)}` : `${fmt(m.pts)}${owe}`, false, run.give.start, (run.back ?? run.give).arrive + 500);
      queueOf(m.give).forEach((d, k) =>
        later(run.give.start + k * run.step, () => {
          // 供托：桌子中间少一根
          if (m.from < 0 && pot) {
            potN--;
            pot.innerHTML = potN ? potHtml(potN) : '';
            pot.classList.toggle('empty', !potN);
          }
          runStick(d, path, fly, false);
        }),
      );
      if (run.back) {
        label(path, `找零 ${fmt(total(m.back))}`, true, run.back.start, run.back.arrive + 500);
        queueOf(m.back).forEach((d, k) => later(run.back!.start + k * run.step, () => runStick(d, path, fly, true)));
      }
    }
    // 最后一根递到的时候两家点数滚过去（找零不改点数）
    later(run.give.arrive, () => {
      if (m.from >= 0) roll(m.from, shown[m.from] - m.pts, 420);
      roll(m.to, shown[m.to] + m.pts, 420);
    });
  });
  // 最后对一下：点数按 Game 算的为准（欠的、算不进棒里的零头）
  later(end, () => seats.forEach((p) => shown[p.seat] !== p.after && roll(p.seat, p.after, 300)));
  later(end + 150, swapRanks);
  return done;
}

// 名次：点数高的在前，同分时起家那边的在前（和 Game.ranking 一样）
export function ranksOf(scores: number[], firstDealer: number): number[] {
  const from = (s: number) => (s - firstDealer + 4) % 4;
  const order = [0, 1, 2, 3].sort((a, b) => scores[b] - scores[a] || from(a) - from(b));
  const rank = [0, 0, 0, 0];
  order.forEach((s, i) => (rank[s] = i + 1));
  return rank;
}
