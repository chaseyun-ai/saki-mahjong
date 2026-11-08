import './resultFlow.css';

// 新结算（试做，视觉设置「结算画面：新」）：一局结束以后照雀魂的节奏分几页放，盖在 3D / 2.5D 牌桌上面。
//   荒牌流局、途中流局：牌桌中间先出大字，每家手牌上挂「听牌 / 不听」
//   和牌：每个和牌的人一页（全屏立绘、手牌、宝牌里宝牌、役一条条出来、最后盖番符章），再进点数移动
//   点数移动：四家的点数卡摆在各自那一边，箭头从付点的人指向收点的人，数字滚过去，名次重排
// 每页右下角「继续」带倒数，数到 0 自己翻页；最后一页翻完交回 app 进下一局。
// 原版的结算弹窗不动（app.ts 的 resultHtml），这里只管新结算的几页。

export interface FlowPage {
  html: string;
  // 这一页倒数几秒自己翻页
  secs: number;
  // 页面放进去以后要做的事（点数滚动、画箭头）；返回收尾函数
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

// 牌桌中间的大字（荒牌流局 / 途中流局：四风连打…），tags 是挂在每家手牌上的「听牌 / 不听」
export function drawBannerHtml(main: string, sub: string, tags: { x: number; y: number; tenpai: boolean }[]): string {
  const t = tags
    .map((g) => `<span class="rf-tag${g.tenpai ? ' yes' : ''}" style="left:${g.x.toFixed(0)}px;top:${g.y.toFixed(0)}px">${g.tenpai ? '听牌' : '不听'}</span>`)
    .join('');
  return `<div class="rf-draw"><div class="rf-draw-band"><span class="rf-draw-main">${main}</span>${sub ? `<span class="rf-draw-sub">${sub}</span>` : ''}</div>${t}</div>`;
}

// ---------- 点数移动 ----------

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
}

const POS = ['bottom', 'right', 'top', 'left'];

// extra：流局时没有和牌页，能力痕迹放在这一页左下角
export function pointsPageHtml(round: string, seats: PointSeat[], extra = ''): string {
  const cards = seats
    .map((p) => {
      const d = p.after - p.before;
      const cls = d > 0 ? 'plus' : d < 0 ? 'minus' : 'zero';
      const img = p.portrait ? `<img src="${p.portrait}" alt="" onerror="this.remove()" />` : '';
      return `<div class="rf-card ${POS[p.rel]}${p.mine ? ' mine' : ''}" data-seat="${p.seat}" style="--c:${p.color}">
        <span class="rf-rank" data-to="${p.rankAfter}"><b>${p.rankBefore}</b>位</span>
        <span class="rf-face"><span>${p.glyph}</span>${img}</span>
        <span class="rf-info">
          <span class="rf-line"><span class="rf-cname">${p.name}</span><span class="rf-delta ${cls}">${d > 0 ? '+' : ''}${d ? d.toLocaleString('en-US') : '±0'}</span></span>
          <span class="rf-score" data-from="${p.before}" data-to="${p.after}">${p.before.toLocaleString('en-US')}</span>
        </span>
      </div>`;
    })
    .join('');
  return `<div class="rf-page rf-points">
    <div class="rf-round">${round}</div>
    <svg class="rf-arrows" aria-hidden="true"><defs><marker id="rf-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#eaf4ff"/></marker></defs></svg>
    ${cards}
    ${extra}
    <button class="rf-next" data-ui="rf-next">继续 <i></i></button>
  </div>`;
}

// 点数页放进去以后：画箭头（付点的人 → 收点的人），数字滚过去，名次换成新的
export function animatePoints(el: HTMLElement, seats: PointSeat[]): () => void {
  let raf = 0;
  const timers: number[] = [];
  const box = el.getBoundingClientRect();
  const rectOf = (s: number) => el.querySelector<HTMLElement>(`.rf-card[data-seat="${s}"]`)?.getBoundingClientRect() ?? null;
  // 从矩形中心朝 to 走，走到矩形边上再空一点
  const edge = (r: DOMRect, to: { x: number; y: number }, pad: number) => {
    const cx = r.left + r.width / 2 - box.left;
    const cy = r.top + r.height / 2 - box.top;
    const dx = to.x - cx;
    const dy = to.y - cy;
    const k = Math.min(Math.abs(r.width / 2 / (dx || 1e-6)), Math.abs(r.height / 2 / (dy || 1e-6)));
    const len = Math.hypot(dx, dy) || 1;
    return { x: cx + dx * k + (dx / len) * pad, y: cy + dy * k + (dy / len) * pad };
  };
  const center = (r: DOMRect) => ({ x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top });
  const svg = el.querySelector<SVGSVGElement>('.rf-arrows');
  if (svg) {
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    const payers = seats.filter((p) => p.after < p.before);
    const takers = seats.filter((p) => p.after > p.before);
    let n = 0;
    for (const a of payers)
      for (const b of takers) {
        const ra = rectOf(a.seat);
        const rb = rectOf(b.seat);
        if (!ra || !rb) continue;
        const s = edge(ra, center(rb), 6);
        const t = edge(rb, center(ra), 10);
        // 往牌桌中间弯一点
        const mx = (s.x + t.x) / 2;
        const my = (s.y + t.y) / 2;
        const cx = mx + (box.width / 2 - mx) * 0.35;
        const cy = my + (box.height / 2 - my) * 0.35;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M${s.x.toFixed(1)} ${s.y.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${t.x.toFixed(1)} ${t.y.toFixed(1)}`);
        path.setAttribute('marker-end', 'url(#rf-head)');
        // 线从头画到尾（CSS 的 stroke-dashoffset 按 1 算）
        path.setAttribute('pathLength', '1');
        path.style.setProperty('--d', `${0.25 + n * 0.08}s`);
        svg.appendChild(path);
        n++;
      }
  }
  // 数字滚动：0.55 秒后开始，滚 1.1 秒
  const scores = [...el.querySelectorAll<HTMLElement>('.rf-score')];
  const start = performance.now() + 550;
  const dur = 1100;
  const roll = (now: number) => {
    const k = Math.min(1, Math.max(0, (now - start) / dur));
    const e = 1 - (1 - k) ** 3;
    for (const s of scores) {
      const from = Number(s.dataset.from);
      const to = Number(s.dataset.to);
      s.textContent = Math.round(from + (to - from) * e).toLocaleString('en-US');
    }
    if (k < 1) raf = requestAnimationFrame(roll);
  };
  raf = requestAnimationFrame(roll);
  // 滚完换名次，变了的跳一下
  timers.push(
    window.setTimeout(() => {
      for (const r of el.querySelectorAll<HTMLElement>('.rf-rank')) {
        const b = r.querySelector('b');
        if (!b || b.textContent === r.dataset.to) continue;
        b.textContent = r.dataset.to ?? '';
        r.classList.add('moved');
      }
    }, 550 + dur + 120),
  );
  return () => {
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout);
  };
}

// 名次：点数高的在前，同分时起家那边的在前（和 Game.ranking 一样）
export function ranksOf(scores: number[], firstDealer: number): number[] {
  const from = (s: number) => (s - firstDealer + 4) % 4;
  const order = [0, 1, 2, 3].sort((a, b) => scores[b] - scores[a] || from(a) - from(b));
  const rank = [0, 0, 0, 0];
  order.forEach((s, i) => (rank[s] = i + 1));
  return rank;
}
