import './resultFlow.css';
import { DENOMS, StickMove, Sticks, count, total } from './tenbou';

// 新结算（试做，视觉设置「结算画面：新」）：一局结束以后照雀魂的节奏分几页放，盖在 3D / 2.5D 牌桌上面。
//   荒牌流局、途中流局：牌桌中间先出大字，每家手牌上挂「听牌 / 未听」，听牌的带上听哪几张
//   和牌：每个和牌的人一页（全屏立绘、手牌、宝牌里宝牌、役一条条出来、最后盖番符章），再进点数移动
//   点数移动：四家的点数卡摆在各自那一边，卡片下面是各家手里的点棒；点棒从付的人那里飞到收的人面前，
//     多给的那边找零飞回来，数字跟着变，名次重排（点棒怎么配、怎么找零在 tenbou.ts）
// 每页右下角「继续」带倒数，数到 0 自己翻页；最后一页翻完交回 app 进下一局。
// 原版的结算弹窗不动（app.ts 的 resultHtml），这里只管新结算的几页。

export interface FlowPage {
  html: string;
  // 这一页倒数几秒自己翻页
  secs: number;
  // 页面放进去以后要做的事（点棒飞、点数滚动）；返回收尾函数
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

// 点棒这一页要的东西：每家结算前手里的棒、一笔笔怎么走、桌上留着的立直棒（荒牌流局没人拿走）
export interface StickPlay {
  start: Sticks[];
  moves: StickMove[];
  potLeft: number;
}

const POS = ['bottom', 'right', 'top', 'left'];
const fmt = (n: number) => n.toLocaleString('en-US');

// 一根点棒（颜色、点的花样在 CSS 里按面额画）
const stick = (i: number) => `<i class="tb tb-${DENOMS[i]}"></i>`;

// 卡片下面的点棒盒：五格，从大到小，每格摞着这种棒，右下角写几根
export function trayHtml(h: Sticks): string {
  return DENOMS.map((_, i) => {
    const n = h[i];
    const shown = Math.min(n, 10);
    return `<span class="tb-g${n ? '' : ' empty'}" data-d="${i}"><span class="tb-pile" style="--n:${shown}">${Array.from({ length: shown }, () => stick(i)).join('')}</span><small>${n}</small></span>`;
  }).join('');
}

// 一把递过去的棒：大的在下面，一根根错开摞着
function bundleHtml(h: Sticks): string {
  const out: string[] = [];
  h.forEach((n, i) => {
    for (let k = 0; k < n; k++) out.push(stick(i));
  });
  return out.map((s, k) => s.replace('<i class', `<i style="--k:${k}" class`)).join('');
}

// 中间的立直棒（供托）
function potHtml(n: number): string {
  return `${Array.from({ length: Math.min(n, 8) }, (_, k) => `<i style="--k:${k}" class="tb tb-1000"></i>`).join('')}<b>供托 ×${n}</b>`;
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
      const tray = sticks ? `<span class="rf-sticks" data-seat="${p.seat}">${trayHtml(sticks.start[p.seat])}</span>` : '';
      return `<div class="rf-card ${POS[p.rel]}${p.mine ? ' mine' : ''}" data-seat="${p.seat}" style="--c:${p.color}">
        <span class="rf-rank" data-to="${p.rankAfter}"><b>${p.rankBefore}</b>位</span>
        <span class="rf-face"><span>${p.glyph}</span>${img}</span>
        <span class="rf-info">
          <span class="rf-line"><span class="rf-cname">${p.name}</span><span class="rf-delta ${cls}">${d > 0 ? '+' : ''}${d ? fmt(d) : '±0'}</span></span>
          <span class="rf-score" data-from="${p.before}" data-to="${p.after}">${fmt(p.before)}</span>
        </span>
        ${tray}
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

// 点棒怎么飞的时间表（毫秒，从这一页放进去算）：一笔一笔来，有找零的等找零飞回去再走下一笔
export interface StickBeat {
  move: number;
  back: boolean; // 找零那一趟
  start: number;
  land: number;
}
export const STICK_T = { first: 700, fly: 850, backFly: 700, gap: 160 };
export function stickTimeline(moves: StickMove[]): { beats: StickBeat[]; end: number } {
  const beats: StickBeat[] = [];
  let t = STICK_T.first;
  moves.forEach((m, i) => {
    const fly = m.from < 0 ? STICK_T.fly - 80 : STICK_T.fly;
    beats.push({ move: i, back: false, start: t, land: t + fly });
    t += fly + STICK_T.gap;
    if (count(m.back)) {
      beats.push({ move: i, back: true, start: t - 40, land: t - 40 + STICK_T.backFly });
      t += STICK_T.backFly + STICK_T.gap - 40;
    }
  });
  return { beats, end: moves.length ? t : STICK_T.first };
}

// 点数页放进去以后：点棒一把把从付的人那里飞到收的人面前，多给的那边找零飞回来；
// 落下来的时候两边的点棒盒、点数跟着变，最后名次换成新的。没有点棒（老的调用）就只滚数字
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
      if (k < 1) {
        const id = requestAnimationFrame(step);
        rafs.add(id);
      }
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

  if (!sticks) {
    later(550, () => seats.forEach((p) => roll(p.seat, p.after, 1100)));
    later(550 + 1100 + 120, swapRanks);
    return done;
  }

  const hold = sticks.start.map((h) => h.slice());
  const trayOf = (s: number) => el.querySelector<HTMLElement>(`.rf-sticks[data-seat="${s}"]`);
  const pot = el.querySelector<HTMLElement>('.rf-pot');
  let potN = sticks.moves.filter((m) => m.from < 0).reduce((a, m) => a + count(m.give), 0) + sticks.potLeft;
  // 点棒盒换成新的数，变了的那几格闪一下（多了往上跳，少了往下沉）
  const setTray = (s: number, next: Sticks) => {
    const tray = trayOf(s);
    const prev = hold[s];
    hold[s] = next;
    if (!tray || next.every((n, i) => n === prev[i])) return;
    tray.innerHTML = trayHtml(next);
    if (still) return;
    next.forEach((n, i) => {
      if (n === prev[i]) return;
      tray.querySelector(`.tb-g[data-d="${i}"]`)?.classList.add(n > prev[i] ? 'in' : 'out');
    });
  };
  const plus = (a: Sticks, b: Sticks) => a.map((n, i) => n + b[i]);
  const minus = (a: Sticks, b: Sticks) => a.map((n, i) => Math.max(0, n - b[i]));

  const { beats, end } = stickTimeline(sticks.moves);
  if (still) {
    sticks.moves.forEach((m) => {
      if (m.from >= 0) setTray(m.from, m.post[0]);
      setTray(m.to, m.post[1]);
    });
    if (pot && !sticks.potLeft) pot.classList.add('empty');
    seats.forEach((p) => roll(p.seat, p.after, 0));
    swapRanks();
    return done;
  }

  const box = el.getBoundingClientRect();
  // 点棒盒的中心（相对这一页）；中间的供托用它自己的位置
  const at = (node: Element | null) => {
    const r = node?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top } : { x: box.width / 2, y: box.height / 2 };
  };
  // 一把棒沿弧线飞过去（往牌桌中间弯一点），落地时做 onLand
  const fly = (give: Sticks, label: string, from: Element | null, to: Element | null, ms: number, change: boolean) => {
    const a = at(from);
    const b = at(to);
    const node = document.createElement('div');
    node.className = `rf-fly${change ? ' change' : ''}`;
    node.innerHTML = `<span class="rf-fly-sticks" style="--n:${count(give)}">${bundleHtml(give)}</span><b>${label}</b>`;
    el.appendChild(node);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const cx = mx + (box.width / 2 - mx) * 0.4;
    const cy = my + (box.height / 2 - my) * 0.4 - Math.hypot(b.x - a.x, b.y - a.y) * 0.08;
    const frames: Keyframe[] = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const x = (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x;
      const y = (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y;
      const s = 0.75 + 0.3 * Math.sin(Math.PI * t);
      frames.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${s.toFixed(3)})`, opacity: k === 0 ? 0 : k === 16 ? 0.15 : 1, offset: t });
    }
    const anim = node.animate(frames, { duration: ms, easing: 'cubic-bezier(0.45, 0, 0.3, 1)', fill: 'forwards' });
    anims.push(anim);
    later(ms + 30, () => node.remove());
  };

  for (const beat of beats) {
    const m = sticks.moves[beat.move];
    const ms = beat.land - beat.start;
    later(beat.start, () => {
      if (!beat.back) {
        // 付的人手里少了这几根（供托从桌子中间拿）
        const src = m.from < 0 ? pot : trayOf(m.from);
        if (m.from < 0) {
          potN -= count(m.give);
          if (pot) {
            pot.innerHTML = potN ? potHtml(potN) : '';
            pot.classList.toggle('empty', !potN);
          }
        } else setTray(m.from, minus(m.pre[0], m.give));
        const owe = m.short ? `（欠 ${fmt(m.short)}）` : '';
        fly(m.give, m.from < 0 ? `供托 ${fmt(m.pts)}` : `${fmt(m.pts)}${owe}`, src, trayOf(m.to), ms, false);
      } else {
        setTray(m.to, minus(plus(m.pre[1], m.give), m.back));
        fly(m.back, `找零 ${fmt(total(m.back))}`, trayOf(m.to), trayOf(m.from), ms, true);
      }
    });
    later(beat.land, () => {
      if (!beat.back) {
        setTray(m.to, count(m.back) ? plus(m.pre[1], m.give) : m.post[1]);
        if (m.from >= 0) roll(m.from, shown[m.from] - m.pts, 380);
        roll(m.to, shown[m.to] + m.pts, 380);
      }
      // 这一笔走完：两家的盒子对上账（找不开跟桌外换过的也在这里对上）
      if (beat.back || !count(m.back)) {
        if (m.from >= 0) setTray(m.from, m.post[0]);
        setTray(m.to, m.post[1]);
      }
    });
  }
  // 最后对一下：点数按 Game 算的为准（欠的、算不进棒里的零头）
  later(end, () => seats.forEach((p) => shown[p.seat] !== p.after && roll(p.seat, p.after, 300)));
  later(end + 120, swapRanks);
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
