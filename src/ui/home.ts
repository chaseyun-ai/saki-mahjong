import './home.css';
import { playClick, playFlip, playLily } from './sound';
import { type TransitionKind, transition } from './transition';

// 主页：麻将部的部室（用户用 Gemini 画的图，public/home/ 下清晨、白天、黄昏、夜晚各一张，构图一样）。
// 黄昏那张原来桌上摆着画错的牌，换成了清晨那张的空桌面（只留茶杯），所以茶的热气只有黄昏有。
// 图上的东西就是入口：
// - 白板上那张纸写着三种玩法（个人对局、团体赛、全国大赛），点一行，红笔圈一下再进去
// - 便签上画一个小齿轮：设置（对局、视觉、声音三页在一个面板里）
// - 收音机：角色图鉴；中间的麻将桌：随机出场（坐下就打）；窗户：换个时间（清晨 → 白天 → 黄昏 → 夜晚）
//
// 整张图按原图像素排在一个 2752×1536 的舞台上，再整体缩放铺满屏幕；纸和便签上的字用 matrix3d 贴到图里纸的四个角上，
// 所以斜着、近大远小都对得上。屏幕比图窄很多（手机竖屏、平板）时不硬裁，改成左右拖着看，一开始停在白板那边。
// 点击走 App.onClick（data-ui：home-go、open-settings、codex），换时间在这里自己处理。

export type HomeTod = 'dawn' | 'day' | 'dusk' | 'night';
export const TODS: HomeTod[] = ['dawn', 'day', 'dusk', 'night'];
const TOD_NAME: Record<HomeTod, string> = { dawn: '清晨', day: '白天', dusk: '黄昏', night: '夜晚' };

export const IMG_W = 2752;
export const IMG_H = 1536;

// 跟着本地时间：5 点到 9 点清晨，9 点到 16 点白天，16 点到 19 点黄昏，其余是夜里。点窗户换过的这一次打开里一直照换过的
export function timeOfDay(hour = new Date().getHours()): HomeTod {
  if (hour >= 5 && hour < 9) return 'dawn';
  if (hour >= 9 && hour < 16) return 'day';
  if (hour >= 16 && hour < 19) return 'dusk';
  return 'night';
}
const TOD_KEY = 'saki-home-tod';
function currentTod(): HomeTod {
  try {
    const v = sessionStorage.getItem(TOD_KEY) as HomeTod | null;
    if (v && TODS.includes(v)) return v;
  } catch {
    // 读不到就照时间
  }
  return timeOfDay();
}
function saveTod(t: HomeTod): void {
  try {
    sessionStorage.setItem(TOD_KEY, t);
  } catch {
    // 存不了就只管这一次
  }
}
const imgOf = (t: HomeTod) => `home/${t}.webp`;

type Pt = [number, number];
// 图里几样东西的位置（原图像素）
const PAPER: Pt[] = [
  [2003, 225],
  [2478, 178],
  [2466, 897],
  [1997, 867],
];
const PAPER_W = 480;
const PAPER_H = 700;
const NOTE: Pt[] = [
  [2415, 968],
  [2586, 982],
  [2566, 1154],
  [2395, 1135],
];
const NOTE_W = 180;
const NOTE_H = 180;
const RADIO = { x: 612, y: 762, w: 196, h: 126, r: 26 };
const ANTENNA: Pt[] = [
  [628, 703],
  [637, 699],
  [751, 757],
  [743, 764],
];
const TABLE: Pt[] = [
  [364, 1134],
  [450, 1013],
  [871, 956],
  [1543, 984],
  [1600, 1106],
  [1514, 1300],
  [1100, 1392],
  [843, 1332],
  [400, 1250],
];
const WINDOW = { x: 958, y: 0, w: 935, h: 880 };
const CUP: Pt = [553, 1000];
const FELT: Pt = [1010, 1062];

// 把 w×h 的方块贴到四边形 q（左上、右上、右下、左下）上：射影变换写成 CSS 的 matrix3d
export function quadMatrix(w: number, h: number, q: Pt[]): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const hh = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + hh * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + hh * y3;
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.map((v) => +v.toFixed(8)).join(',')})`;
}

const poly = (pts: Pt[]) => `polygon(${pts.map(([x, y]) => `${x}px ${y}px`).join(',')})`;
const radioClip = `inset(${RADIO.y}px ${IMG_W - RADIO.x - RADIO.w}px ${IMG_H - RADIO.y - RADIO.h}px ${RADIO.x}px round ${RADIO.r}px)`;
const centerOf = (pts: Pt[]): Pt => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

interface Entry {
  v: 'single' | 'team' | 'story';
  no: string;
  label: string;
  sub: string;
}
const ENTRIES: Entry[] = [
  { v: 'single', no: '一', label: '个人对局', sub: '选一位，和三个电脑打' },
  { v: 'team', no: '二', label: '团体赛', sub: '四队蛇形选人，五人接力' },
  { v: 'story', no: '三', label: '全国大赛', sub: '十六校，三轮打到决赛' },
];

// 便签上手画的小齿轮：八个梯形齿，中间一个孔
function gearPath(teeth: number, rOut: number, rIn: number): string {
  const step = (Math.PI * 2) / teeth;
  const at = (a: number, r: number) => `${(24 + Math.cos(a) * r).toFixed(2)} ${(24 + Math.sin(a) * r).toFixed(2)}`;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    d += `${i ? 'L' : 'M'}${at(a - step * 0.3, rIn)} L${at(a - step * 0.17, rOut)} L${at(a + step * 0.17, rOut)} L${at(a + step * 0.3, rIn)} `;
  }
  return `${d}Z`;
}
const GEAR_SVG = `<svg class="hr-gear" viewBox="0 0 48 48" aria-hidden="true"><path d="${gearPath(8, 21, 15.5)}"/><circle cx="24" cy="24" r="6"/></svg>`;

function entryHtml(e: Entry): string {
  return `<button class="hr-entry" data-ui="home-go" data-v="${e.v}"><span class="hr-no">${e.no}</span><span class="hr-entry-t"><b>${e.label}</b><small>${e.sub}</small></span></button>`;
}

export function homeHtml(opts: { gate: boolean }): string {
  const tod = currentTod();
  const paper = quadMatrix(PAPER_W, PAPER_H, PAPER);
  const note = quadMatrix(NOTE_W, NOTE_H, NOTE);
  const [ncx, ncy] = centerOf(NOTE);
  const motes = Array.from({ length: 26 }, (_, i) => {
    const x = 330 + ((i * 397) % 820);
    const y = 120 + ((i * 263) % 760);
    return `<i style="left:${x}px;top:${y}px;--d:${(7 + (i % 5) * 1.7).toFixed(1)}s;--o:${(-(i * 0.83) % 9).toFixed(2)}s;--s:${(0.6 + (i % 4) * 0.25).toFixed(2)}"></i>`;
  }).join('');
  return `<div class="home-room${opts.gate ? ' gated' : ''}" data-tod="${tod}" style="--bg:url('${imgOf(tod)}')">
    <h1 class="hr-sr">超能力麻将</h1>
    <div class="hr-view">
      <div class="hr-sizer">
        <div class="hr-stage" style="width:${IMG_W}px;height:${IMG_H}px">
          <img class="hr-bg" src="${imgOf(tod)}" alt="" draggable="false" />
          <div class="hr-fx" aria-hidden="true">
            <div class="hr-motes">${motes}</div>
            <div class="hr-steam" style="left:${CUP[0]}px;top:${CUP[1]}px"><i></i><i></i><i></i></div>
            <div class="hr-felt" style="left:${FELT[0]}px;top:${FELT[1]}px"></div>
            <div class="hr-dial" style="left:${RADIO.x + 150}px;top:${RADIO.y + 52}px"></div>
          </div>
          <button class="hr-hot hr-window" data-hot="window" style="left:${WINDOW.x}px;top:${WINDOW.y}px;width:${WINDOW.w}px;height:${WINDOW.h}px" aria-label="换个时间（现在是${TOD_NAME[tod]}）"></button>
          <button class="hr-hot hr-table" data-ui="home-go" data-v="random" data-hot="table" style="clip-path:${poly(TABLE)}" aria-label="随机出场：随便抽一位坐下就打"></button>
          <div class="hr-pop" data-pop="radio" style="transform-origin:${RADIO.x + RADIO.w / 2}px ${RADIO.y + RADIO.h}px" aria-hidden="true">
            <i style="clip-path:${radioClip}"></i><i style="clip-path:${poly(ANTENNA)}"></i>
          </div>
          <button class="hr-hot hr-radio" data-ui="codex" data-hot="radio" style="clip-path:${radioClip}" aria-label="角色图鉴"></button>
          <div class="hr-pop hr-note-pop" data-pop="note" style="transform-origin:${ncx}px ${ncy}px">
            <i style="clip-path:${poly(NOTE)}" aria-hidden="true"></i>
            <button class="hr-note" data-ui="open-settings" data-hot="note" aria-haspopup="dialog" aria-label="设置：对局、视觉、声音" style="width:${NOTE_W}px;height:${NOTE_H}px;transform:${note}">
              <span class="hr-note-t">设置</span>${GEAR_SVG}<small>对局 · 视觉 · 声音</small>
            </button>
          </div>
          <nav class="hr-paper" aria-label="主菜单" style="width:${PAPER_W}px;height:${PAPER_H}px;transform:${paper}">
            <div class="hr-paper-head"><b>超能力麻将部</b><small>今日活动</small></div>
            ${ENTRIES.map(entryHtml).join('')}
            <svg class="hr-ink" viewBox="0 0 ${PAPER_W} ${PAPER_H}" aria-hidden="true"></svg>
          </nav>
        </div>
      </div>
    </div>
    <div class="hr-tip" aria-hidden="true"></div>
    <div class="hr-say hr-sr" role="status" aria-live="polite"></div>
    <div class="hr-pan" aria-hidden="true">← 左右拖动，看看部室 →</div>
    ${opts.gate ? '<div class="hr-gate" role="button" tabindex="0" aria-label="点一下开始"><div class="hr-logo">超能力麻将</div><span class="hr-start"><span class="hr-loading">整理部室中…</span><span class="hr-go">点一下开始</span></span></div>' : ''}
    <p class="hr-foot">原型 · 角色与能力参考《天才麻将少女》，同人非商业作品</p>
    <div id="setup"></div>
  </div>`;
}

const TIPS: Record<string, string> = {
  window: '换个时间',
  table: '随机出场 · 坐下就打',
  radio: '角色图鉴',
};
// 提示冒在哪（原图像素）：收音机、桌子的正上方，窗户中间
const TIP_AT: Record<string, Pt> = {
  window: [1425, 330],
  table: [990, 940],
  radio: [712, 690],
};

// 主页摆好以后：铺满屏幕、悬停提示、换时间、拖着看、开场
export function mountHome(room: HTMLElement): void {
  const view = room.querySelector<HTMLElement>('.hr-view')!;
  const sizer = room.querySelector<HTMLElement>('.hr-sizer')!;
  const stage = room.querySelector<HTMLElement>('.hr-stage')!;
  const bg = room.querySelector<HTMLImageElement>('.hr-bg')!;
  const tip = room.querySelector<HTMLElement>('.hr-tip')!;
  const gate = room.querySelector<HTMLElement>('.hr-gate');

  // 铺满：等比缩放到盖住屏幕；屏幕太窄（图要裁掉一大块）就改成按高度放、左右拖着看
  let scroll = false;
  const fit = (): void => {
    const vw = view.clientWidth || window.innerWidth;
    const vh = view.clientHeight || window.innerHeight;
    const cover = Math.max(vw / IMG_W, vh / IMG_H);
    scroll = (IMG_W * cover - vw) / vw > 0.16;
    const s = scroll ? vh / IMG_H : cover;
    stage.style.transform = `scale(${s})`;
    sizer.style.width = `${IMG_W * s}px`;
    sizer.style.height = `${IMG_H * s}px`;
    room.classList.toggle('pan', scroll);
    if (scroll) {
      sizer.style.left = '0';
      sizer.style.top = '0';
    } else {
      sizer.style.left = `${(vw - IMG_W * s) / 2}px`;
      sizer.style.top = `${(vh - IMG_H * s) / 2}px`;
    }
    return;
  };
  fit();
  // 一开始停在白板那边：那张纸（三种玩法）放在屏幕正中
  if (scroll) {
    const s = view.clientHeight / IMG_H;
    view.scrollLeft = centerOf(PAPER)[0] * s - view.clientWidth / 2;
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
  ro?.observe(view);
  // 离开主页（整页被换掉）以后不再跟着窗口变
  const alive = () => room.isConnected;
  const cleanup = (): void => {
    if (!alive()) ro?.disconnect();
  };
  window.addEventListener('resize', cleanup, { once: true });

  // 拖着看：手机本来就能滑；鼠标按住拖也行（拖过几像素就不算点击）
  let drag: { x: number; left: number; moved: boolean } | null = null;
  view.addEventListener('pointerdown', (e) => {
    if (!scroll || e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, left: view.scrollLeft, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || !alive()) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 6) drag.moved = true;
    if (drag.moved) view.scrollLeft = drag.left - dx;
  });
  window.addEventListener('pointerup', () => {
    if (drag?.moved) {
      // 这一下是拖，不是点：吞掉接着来的 click
      const eat = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      view.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => view.removeEventListener('click', eat, { capture: true }), 0);
    }
    drag = null;
  });
  // 玩家自己拖过一次，「左右拖动」的提示就收起来
  for (const ev of ['pointerdown', 'wheel', 'touchstart']) view.addEventListener(ev, () => room.classList.add('panned'), { passive: true, once: true });

  // 悬停：收音机、便签浮起来，桌子、窗户冒一句提示
  const pops = new Map<string, HTMLElement>();
  for (const p of room.querySelectorAll<HTMLElement>('.hr-pop')) pops.set(p.dataset.pop!, p);
  const showTip = (el: HTMLElement | null): void => {
    const id = el?.dataset.hot ?? '';
    for (const [k, p] of pops) p.classList.toggle('on', k === id);
    room.querySelector('.hr-felt')?.classList.toggle('on', id === 'table');
    const text = id === 'window' ? `${TIPS.window}（现在是${TOD_NAME[room.dataset.tod as HomeTod]}）` : TIPS[id];
    if (!el || !text) {
      tip.classList.remove('show');
      return;
    }
    tip.textContent = text;
    const st = stage.getBoundingClientRect();
    const box = room.getBoundingClientRect();
    const s = st.width / IMG_W;
    const [ax, ay] = TIP_AT[id];
    const x = Math.min(box.width - 90, Math.max(90, st.left + ax * s - box.left));
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.max(40, st.top + ay * s - box.top)}px`;
    tip.classList.add('show');
  };
  for (const el of room.querySelectorAll<HTMLElement>('[data-hot]')) {
    el.addEventListener('pointerenter', () => showTip(el));
    el.addEventListener('pointerleave', () => showTip(null));
    el.addEventListener('focus', () => {
      if (el.matches(':focus-visible')) showTip(el);
    });
    el.addEventListener('blur', () => showTip(null));
  }

  // 窗户：清晨 → 白天 → 黄昏 → 夜晚，新图淡进来
  room.querySelector<HTMLElement>('.hr-window')?.addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLElement;
    const now = room.dataset.tod as HomeTod;
    const next = TODS[(TODS.indexOf(now) + 1) % TODS.length];
    setTod(room, next);
    btn.setAttribute('aria-label', `换个时间（现在是${TOD_NAME[next]}）`);
    const say = room.querySelector('.hr-say');
    if (say) say.textContent = `现在是${TOD_NAME[next]}`;
    playFlip('latch', 0.15);
    showTip(btn);
  });

  // 便签的齿轮：按下去转一圈
  room.querySelector<HTMLElement>('.hr-note')?.addEventListener('click', (e) => {
    const g = (e.currentTarget as HTMLElement).querySelector('.hr-gear');
    g?.classList.remove('spin');
    void (g as HTMLElement | null)?.getBoundingClientRect();
    g?.classList.add('spin');
  });

  // 开场：图读好了才写「点一下开始」；点了才放声音（浏览器要等玩家点过才能出声）
  const ready = (): void => gate?.classList.add('ready');
  if (bg.complete && bg.naturalWidth) ready();
  else {
    bg.addEventListener('load', ready, { once: true });
    bg.addEventListener(
      'error',
      () => {
        room.classList.add('no-img');
        ready();
      },
      { once: true },
    );
  }
  if (gate) {
    const open = (): void => {
      if (!gate.classList.contains('ready') || gate.classList.contains('gone')) return;
      room.classList.remove('gated');
      gate.classList.add('gone');
      playLily(0.3);
      setTimeout(() => gate.remove(), 700);
    };
    gate.addEventListener('click', open);
    gate.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
    gate.focus({ preventScroll: true });
  }
}

function setTod(room: HTMLElement, t: HomeTod): void {
  saveTod(t);
  const old = room.querySelector<HTMLImageElement>('.hr-bg');
  if (!old) return;
  const img = old.cloneNode() as HTMLImageElement;
  img.src = imgOf(t);
  img.classList.add('in');
  old.after(img);
  const done = (): void => {
    room.dataset.tod = t;
    room.style.setProperty('--bg', `url('${imgOf(t)}')`);
    setTimeout(() => old.remove(), 650);
  };
  if (img.complete) done();
  else img.addEventListener('load', done, { once: true });
}

// 纸上那一行：红笔画一圈（手画的样子：转一圈多一点，起笔收笔不重合），画完再换页
function circlePath(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2 + 22;
  const ry = h / 2 + 16;
  const start = Math.PI * 1.08;
  const turns = 1.13;
  const pts: Pt[] = [];
  const N = 44;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const a = start + u * turns * Math.PI * 2;
    const wob = 1 + 0.035 * Math.sin(a * 3 + 0.7) + 0.02 * Math.sin(a * 5);
    // 一边画一边往右上偏一点，收笔不回到起笔
    pts.push([cx + Math.cos(a) * rx * wob + u * 10, cy + Math.sin(a) * ry * wob - u * 8]);
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    d += ` Q${x1.toFixed(1)} ${y1.toFixed(1)} ${((x1 + x2) / 2).toFixed(1)} ${((y1 + y2) / 2).toFixed(1)}`;
  }
  return d;
}

// 点了纸上一行、或者麻将桌：先演一下（红笔圈 / 桌子闪一下），再过场换页
export function homeGo(btn: HTMLElement, kind: TransitionKind, go: () => void): void {
  const room = btn.closest<HTMLElement>('.home-room');
  if (!room || room.classList.contains('leaving')) return;
  room.classList.add('leaving');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let wait = 0;
  if (btn.classList.contains('hr-entry')) {
    const svg = room.querySelector<SVGSVGElement>('.hr-ink');
    if (svg) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', circlePath(btn.offsetLeft, btn.offsetTop, btn.offsetWidth, btn.offsetHeight));
      svg.appendChild(path);
      const len = path.getTotalLength?.() ?? 1200;
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = reduce ? '0' : `${len}`;
      void path.getBoundingClientRect();
      path.classList.add('draw');
      path.style.strokeDashoffset = '0';
      btn.classList.add('picked');
      wait = reduce ? 0 : 430;
    }
    playFlip('riffle', 0.25);
  } else {
    room.querySelector('.hr-felt')?.classList.add('on', 'flash');
    playClick({ varied: true });
  }
  setTimeout(() => {
    if (!btn.isConnected) return;
    transition(kind, () => {
      if (btn.isConnected) go();
    });
  }, wait);
}
