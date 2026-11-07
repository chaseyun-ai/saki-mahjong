import { PADLOCK, landTime, vanishTime } from './riiChainPlan';

// 白水哩番缚锁死的那一下：最后一条锁链压上手牌时，一把大锁从上面砸下来，锁扣“咔”地合上
// （闪光、冲击波、震屏、撞击声由 onSlam 做），停一会儿；锁链消散时大锁缩小飞到她的头像上，
// 之后头像角上一直挂着这把锁（app.ts 的 riiLockHtml），结算时开锁变金 / 碎掉。
// 用网页动画（Web Animations）画在页面最上面，三种视角都一样。

let uid = 0;

// 一把锁：锁扣（.shackle，合上的位置）、锁身、锁孔。颜色跟着 CSS 变量走（金色、碎掉都在 style.css）
export function padlockSvg(): string {
  const id = `rpl${uid++}`;
  return `<svg class="rii-lock-svg" viewBox="0 0 100 120" aria-hidden="true">
    <defs>
      <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="s1"/><stop offset=".5" class="s2"/><stop offset="1" class="s3"/></linearGradient>
      <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" class="s3"/><stop offset=".45" class="s1"/><stop offset="1" class="s3"/></linearGradient>
    </defs>
    <g class="shackle"><path d="M29 58 V36 a21 21 0 0 1 42 0 V58" fill="none" stroke="url(#${id}s)" stroke-width="12" stroke-linecap="round"/></g>
    <rect x="11" y="52" width="78" height="62" rx="11" fill="url(#${id}b)" stroke="rgba(10,12,18,.55)" stroke-width="2.5"/>
    <rect x="17" y="57" width="66" height="6" rx="3" fill="rgba(255,255,255,.38)"/>
    <rect x="17" y="100" width="66" height="5" rx="2.5" fill="rgba(0,0,0,.18)"/>
    <circle cx="50" cy="79" r="8.5" class="hole"/><path d="M45.5 81 h9 l-2.2 15 h-4.6 z" class="hole"/>
  </svg>`;
}

export interface PadlockPlay {
  from: { x: number; y: number; w: number }; // 手牌中间（页面坐标）、手牌多宽
  n: number; // 缚几番（几条锁链，决定什么时候砸下来）
  to: () => DOMRect | null; // 头像（飞过去的时候再量）
  onSlam?: () => void;
}

// 开始放（和锁链同时开始）。返回取消用的函数
export function playPadlock(p: PadlockPlay): () => void {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const size = Math.max(84, Math.min(150, p.from.w * 0.16));
  const el = document.createElement('div');
  el.className = 'rii-padlock';
  el.style.left = `${p.from.x}px`;
  el.style.top = `${p.from.y}px`;
  el.style.width = `${size}px`;
  el.style.height = `${size * 1.2}px`;
  el.style.transform = 'translate(-50%, -50%)';
  el.innerHTML = `<span class="rpl-flash"></span><span class="rpl-ring"></span>${padlockSvg()}`;
  document.body.appendChild(el);
  const ms = (s: number) => Math.max(0, s * 1000);
  const dropAt = landTime(p.n) - PADLOCK.lead;
  const slamAt = dropAt + PADLOCK.drop;
  const flyAt = vanishTime(p.n);
  const base = 'translate(-50%, -50%)';
  const timers: number[] = [];
  const anims: Animation[] = [];
  const play = (target: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions) => {
    if (target) anims.push(target.animate(frames, opts));
  };
  if (!reduced) {
    // 从上面斜着砸下来，越落越快
    play(
      el,
      [
        { opacity: 0, transform: `${base} translateY(-${size * 2.6}px) scale(2.3) rotate(-14deg)` },
        { opacity: 1, offset: 0.3 },
        { opacity: 1, transform: `${base} translateY(0) scale(1) rotate(0deg)` },
      ],
      { duration: ms(PADLOCK.drop), delay: ms(dropAt), easing: 'cubic-bezier(.55,0,1,.4)', fill: 'backwards' },
    );
    // 砸下去：压扁一下再弹回来
    play(
      el,
      [{ transform: `${base} scale(1.2, .82)` }, { transform: `${base} scale(.94, 1.07)`, offset: 0.45 }, { transform: `${base} scale(1)` }],
      { duration: 280, delay: ms(slamAt), easing: 'ease-out'},
    );
    // 锁扣在砸下去那一下合上
    play(el.querySelector('.shackle'), [{ transform: 'translateY(-17px)' }, { transform: 'translateY(-17px)', offset: 0.75 }, { transform: 'translateY(0)' }], {
      duration: ms(PADLOCK.drop + 0.06),
      delay: ms(dropAt),
      easing: 'ease-in',
      fill: 'backwards',
    });
    play(el.querySelector('.rpl-flash'), [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1)', offset: 0.12 }, { opacity: 0, transform: 'scale(2.6)' }], {
      duration: 520,
      delay: ms(slamAt),
      easing: 'ease-out',
      fill: 'both',
    });
    play(el.querySelector('.rpl-ring'), [{ opacity: 0.95, transform: 'scale(.35)' }, { opacity: 0, transform: 'scale(4.2)' }], {
      duration: 620,
      delay: ms(slamAt),
      easing: 'cubic-bezier(.2,.7,.3,1)',
      fill: 'both',
    });
  }
  timers.push(window.setTimeout(() => p.onSlam?.(), ms(reduced ? 0 : slamAt)));
  // 锁链消散的时候，大锁缩小、划一道弧飞到头像右下角
  timers.push(
    window.setTimeout(() => {
      const r = p.to();
      if (!r || reduced) {
        el.remove();
        return;
      }
      // 头像右下角（和 style.css 的 .rii-plock 一样：离边 3%，宽 44%）
      const w = r.width * 0.44;
      const tx = r.right - r.width * 0.03 - w / 2 - p.from.x;
      const ty = r.bottom - r.height * 0.03 - (w * 1.2) / 2 - p.from.y;
      const k = Math.max(0.2, w / size);
      const fly = el.animate(
        [
          { transform: `${base}` },
          { transform: `${base} translate(${tx * 0.35}px, ${ty * 0.35 - size * 1.1}px) scale(${(1 + k) / 2 + 0.1}) rotate(8deg)`, offset: 0.45 },
          { transform: `${base} translate(${tx}px, ${ty}px) scale(${k})` },
        ],
        { duration: ms(PADLOCK.fly), easing: 'cubic-bezier(.5,0,.4,1)', fill: 'forwards' },
      );
      anims.push(fly);
      fly.onfinish = () => el.remove();
    }, ms(flyAt)),
  );
  return () => {
    timers.forEach((t) => clearTimeout(t));
    anims.forEach((a) => a.cancel());
    el.remove();
  };
}

// 头像上的锁什么时候挂上去（从按下番缚算起，毫秒）
export function padlockArrive(n: number): number {
  return (vanishTime(n) + PADLOCK.fly) * 1000;
}

// 锁死的那一下离按下番缚多久（毫秒）
export function padlockSlam(n: number): number {
  return (landTime(n) - PADLOCK.lead + PADLOCK.drop) * 1000;
}
