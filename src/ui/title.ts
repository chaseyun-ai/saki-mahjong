// 主页封面（游戏一打开先到这里）：榻榻米上一张麻将桌，从斜上方往下看（画面在 ui3d/titleScene.ts）。
// 桌子中间五张大牌是 logo；四边各有一排牌拼出一种玩法：个人对局、团体赛、随机出场、全国大赛（还没开放，扣着贴了封条）；
// 右下角三根点棒是对局设置、视觉设置、声音设置；中间两颗骰子可以掷着玩。
//
// 画面里的东西不能直接点，所以每一块上面盖一个看不见的按钮（位置每一帧跟着画面走）。按钮照样是 data-ui，
// 点击由 App.onClick 处理（title-go、open-match、open-visual、open-sound），键盘和读屏也能用。
//
// 第一次打开先盖着开场：镜头凑近 logo，牌山一墩墩从桌面升起来，然后写着「点一下开始」。点了才放音乐
// （浏览器要等玩家点过才能出声），镜头拉开，四排牌从牌山发出来翻开。之后从选人页回到主页就不再盖。
//
// 画不了 3D 的浏览器（没有 WebGL）：按钮变成一列看得见的普通按钮。

import { playClick, playFlip, playLily } from './sound';
import { TitleScene, type TitleHotId, type TitleTod } from '../ui3d/titleScene';
import { transition } from './transition';

// 灯光跟着本地时间：5 点到 16 点白天，16 点到 19 点黄昏，其余是夜里
export function timeOfDay(hour = new Date().getHours()): TitleTod {
  if (hour >= 5 && hour < 16) return 'day';
  if (hour >= 16 && hour < 19) return 'dusk';
  return 'night';
}

// 有没有来过：便签上第一次写「欢迎！」，之后写「欢迎回来！」
const SEEN_KEY = 'saki-title-seen';
function seenBefore(): boolean {
  try {
    const v = localStorage.getItem(SEEN_KEY) === '1';
    localStorage.setItem(SEEN_KEY, '1');
    return v;
  } catch {
    return false;
  }
}

interface HotDef {
  id: TitleHotId;
  // data-ui：点了以后 App 怎么处理（骰子没有，只是掷着玩）
  ui?: string;
  label: string;
  sub: string;
  lock?: boolean;
  dialog?: boolean;
}

const HOTS: HotDef[] = [
  { id: 'single', ui: 'title-go', label: '个人对局', sub: '选一位，和三个电脑打' },
  { id: 'team', ui: 'title-go', label: '团体赛', sub: '四队蛇形选人，五人接力' },
  { id: 'random', ui: 'title-go', label: '随机出场', sub: '抽一位直接开局' },
  { id: 'story', ui: 'title-go', label: '全国大赛', sub: '剧情模式还在做，敬请期待', lock: true },
  { id: 'dice', label: '掷骰子', sub: '掷着玩' },
  { id: 'match', ui: 'open-match', label: '对局设置', sub: '局数、规则、电脑强度', dialog: true },
  { id: 'visual', ui: 'open-visual', label: '视觉设置', sub: '主题、牌桌、动画', dialog: true },
  { id: 'sound', ui: 'open-sound', label: '声音设置', sub: '音乐和音效', dialog: true },
];

function hotHtml(h: HotDef): string {
  const ui = h.ui ? ` data-ui="${h.ui}"` : '';
  const v = h.ui === 'title-go' ? ` data-v="${h.id}"` : '';
  return `<button class="tt-hot${h.lock ? ' lock' : ''}" data-hot="${h.id}"${ui}${v}${h.dialog ? ' aria-haspopup="dialog"' : ''}><span class="tt-hot-t"><b>${h.label}</b><small>${h.sub}</small></span></button>`;
}

export function titleHtml(opts: { gate: boolean; tod?: TitleTod }): string {
  const tod = opts.tod ?? timeOfDay();
  return `<div class="title-screen${opts.gate ? ' gated' : ' opened'}" data-tod="${tod}" data-back="${seenBefore() ? 1 : 0}">
    <h1 class="tt-sr">超能力麻将</h1>
    <canvas class="tt-canvas" aria-hidden="true"></canvas>
    <div class="tt-vig" aria-hidden="true"></div>
    <nav class="tt-hots" aria-label="主菜单">${HOTS.map(hotHtml).join('')}</nav>
    <div class="tt-chips">${HOTS.filter((h) => h.dialog).map((h) => `<button data-ui="${h.ui}" aria-haspopup="dialog">${h.label}</button>`).join('')}</div>
    <div class="tt-tip" aria-hidden="true"><b></b><small></small></div>
    <div class="tt-say tt-sr" role="status" aria-live="polite"></div>
    ${opts.gate ? '<div class="tt-gate" role="button" tabindex="0" aria-label="点一下开始"><span class="tt-start"><span class="tt-loading">洗牌中…</span><span class="tt-go">点一下开始</span></span></div>' : ''}
    <p class="tt-foot">原型 · 角色与能力参考《天才麻将少女》，同人非商业作品</p>
    <div id="setup"></div>
  </div>`;
}

// 每个主页对应的那张牌桌（titleGo 要用它让牌跳一下）
const scenes = new WeakMap<HTMLElement, TitleScene>();

// 把牌桌画出来，把按钮盖到画面里对应的东西上。画布被换掉（离开主页）以后牌桌自己收摊
export function mountTitle(screen: HTMLElement): void {
  const canvas = screen.querySelector<HTMLCanvasElement>('.tt-canvas');
  const gate = screen.querySelector<HTMLElement>('.tt-gate');
  const tip = screen.querySelector<HTMLElement>('.tt-tip');
  const buttons = new Map<TitleHotId, HTMLElement>();
  for (const b of screen.querySelectorAll<HTMLElement>('.tt-hot')) buttons.set(b.dataset.hot as TitleHotId, b);
  let scene: TitleScene | null = null;
  let lastClack = 0;
  let tipFor: TitleHotId | null = null;
  const rectOf = new Map<TitleHotId, { x: number; y: number; w: number; h: number }>();

  const placeTip = (): void => {
    if (!tip || !tipFor) return;
    const r = rectOf.get(tipFor);
    if (!r) return;
    const W = screen.clientWidth;
    // 靠上的那一排，字放在下面；其他放上面
    const below = r.y < screen.clientHeight * 0.22;
    const half = tip.offsetWidth / 2 + 8;
    const x = Math.min(W - half, Math.max(half, r.x + r.w / 2));
    tip.style.left = `${x.toFixed(1)}px`;
    tip.style.top = `${(below ? r.y + r.h + 10 : r.y - 10).toFixed(1)}px`;
    tip.classList.toggle('below', below);
  };

  if (canvas) {
    try {
      scene = new TitleScene(canvas, {
        gate: !!gate,
        tod: (screen.dataset.tod as TitleTod) || 'day',
        back: screen.dataset.back === '1',
        onRects: (rects) => {
          for (const [id, r] of rects) {
            const b = buttons.get(id);
            if (!b) continue;
            rectOf.set(id, r);
            // 点棒很细，手指不好点：按钮至少 30 高
            const h = Math.max(r.h, 30);
            b.style.transform = `translate(${r.x.toFixed(1)}px, ${(r.y - (h - r.h) / 2).toFixed(1)}px)`;
            b.style.width = `${r.w.toFixed(1)}px`;
            b.style.height = `${h.toFixed(1)}px`;
          }
          placeTip();
        },
        onReady: () => gate?.classList.add('ready'),
        onClack: () => {
          // 发牌时一张张落桌：别响得太密
          const now = performance.now();
          if (now - lastClack < 70) return;
          lastClack = now;
          playClick({ varied: true });
        },
      });
      scenes.set(screen, scene);
    } catch {
      scene = null;
    }
  }
  if (!scene) {
    // 画不了 3D：按钮排成一列，直接能点
    screen.classList.add('no3d', 'opened');
    screen.classList.remove('gated');
    gate?.remove();
    return;
  }

  const setTip = (id: TitleHotId | null): void => {
    tipFor = id;
    scene?.setHover(id);
    if (!tip) return;
    const def = id ? HOTS.find((h) => h.id === id) : null;
    tip.classList.toggle('show', !!def);
    if (!def) return;
    tip.querySelector('b')!.textContent = def.label;
    tip.querySelector('small')!.textContent = def.sub;
    tip.classList.toggle('lock', !!def.lock);
    placeTip();
  };
  for (const [id, b] of buttons) {
    b.addEventListener('pointerenter', () => setTip(id));
    b.addEventListener('pointerleave', () => {
      if (tipFor === id) setTip(null);
    });
    b.addEventListener('focus', () => {
      if (b.matches(':focus-visible')) setTip(id);
    });
    b.addEventListener('blur', () => {
      if (tipFor === id) setTip(null);
    });
    // 设置的点棒、骰子：点了跳一下（四排牌的跳归 titleGo 管）
    if (b.dataset.ui !== 'title-go') {
      b.addEventListener('click', () => {
        if (id === 'dice') {
          scene?.roll();
          playFlip('latch', 0.18);
        } else scene?.press(id);
      });
    }
  }

  if (gate) {
    const open = (): void => {
      if (!gate.isConnected || gate.classList.contains('gone')) return;
      scene?.open();
      screen.classList.remove('gated');
      screen.classList.add('opened');
      gate.classList.add('gone');
      playLily(0.3);
      setTimeout(() => gate.remove(), 600);
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

// 点了四排牌里的一排：牌一张张跳起来，再去对应的页面（贴着封条的那排晃一晃、冒一句话）
export function titleGo(btn: HTMLElement, go: () => void): void {
  const screen = btn.closest<HTMLElement>('.title-screen');
  if (!screen || screen.classList.contains('leaving')) return;
  const scene = scenes.get(screen);
  const id = btn.dataset.hot as TitleHotId;
  if (btn.classList.contains('lock')) {
    scene?.shake(id);
    playFlip('latch', 0.2);
    // 读屏念一句；看得见的那条说明抖一下
    const say = screen.querySelector<HTMLElement>('.tt-say');
    if (say) say.textContent = '全国大赛的剧情模式还在做，敬请期待！';
    const tip = screen.querySelector<HTMLElement>('.tt-tip');
    if (tip) {
      tip.classList.remove('nudge');
      void tip.offsetWidth;
      tip.classList.add('nudge');
    }
    return;
  }
  screen.classList.add('leaving');
  scene?.press(id);
  playClick({ varied: true });
  // 牌跳起来的同时开始过场（transition.ts）：随机出场直接开局，用牌背；其余换页用一筒
  transition(id === 'random' ? 'tiles' : 'pin', () => {
    if (btn.isConnected) go();
  });
}
