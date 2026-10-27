import { SkinArt, cutinArt } from '../ui3d/looks';

// 切入演出：角色立绘和大字从画面一侧滑进来，停一下再滑走（雀魂碰牌、立直时的那种）。
// 只是画面效果：不挡点击，不等它放完牌局就往下走。

export type CutinKind = 'call' | 'kan' | 'riichi' | 'win' | 'ability';

// 进场、停留、退场各多少秒（雀魂碰的立绘停约 0.45 秒，立直约 0.6 秒，和牌的大字约 0.7 秒；
// 和牌的切入放完牌桌上才劈闪电，见 table3d.ts 的 REVEAL_DELAY_25D）
const TIMING: Record<CutinKind, [number, number, number]> = {
  call: [0.16, 0.5, 0.2],
  kan: [0.16, 0.55, 0.2],
  riichi: [0.16, 0.6, 0.24],
  ability: [0.16, 0.6, 0.24],
  win: [0.2, 0.7, 0.25],
};

// 单个技能的动画（素材页换上的）停得久一点；视频按它自己的长度放，最长 SKILL_VIDEO_MAX 秒
const SKILL_HOLD = 1.4;
const SKILL_VIDEO_MAX = 6;

// 正在放的比新来的重要（比如和牌时来了个能力），新来的就不放了；
// 两个能力撞在一起（爽一局叫了好几样）排队一个个放
const RANK: Record<CutinKind, number> = { ability: 0, call: 1, kan: 1, riichi: 2, win: 3 };

export interface CutinSpec {
  pos: string; // 座位在画面上的方位：bottom、right、top、left
  id: string; // 角色 id，用来找立绘
  color: string;
  word: string;
  kind: CutinKind;
  art?: SkinArt; // 这个技能自己的动画，盖过角色的切入图
}

export class Cutins {
  private current: { el: HTMLElement; kind: CutinKind; timer: number } | null = null;
  private queue: CutinSpec[] = [];

  constructor(private layer: HTMLElement) {}

  // 放一段切入，返回是否真的放了（排上队也算）
  show(c: CutinSpec): boolean {
    if (this.current?.kind === 'ability' && c.kind === 'ability') {
      this.queue.push(c);
      return true;
    }
    if (this.current && RANK[this.current.kind] > RANK[c.kind]) return false;
    this.clear();
    const [enter, hold, leave] = TIMING[c.kind];
    const el = document.createElement('div');
    const art = c.art ? { url: c.art.url, wide: c.art.w > c.art.h * 1.1 } : cutinArt(c.id, c.kind);
    el.className = `cutin ${c.pos} ${c.kind}${art.wide ? ' wide' : ''}${c.art ? ' skill' : ''}`;
    el.style.setProperty('--c', c.color);
    el.style.setProperty('--in', `${enter}s`);
    el.style.setProperty('--out', `${leave}s`);
    const media = c.art?.video
      ? `<video class="art" src="${art.url}" muted autoplay playsinline></video>`
      : `<img class="art" src="${art.url}" alt="" onerror="this.remove()" />`;
    el.innerHTML = `<div class="band"></div>${media}<div class="word"><span>${c.word}</span></div>`;
    this.current = { el, kind: c.kind, timer: 0 };
    const start = (secs: number) => {
      if (this.current?.el !== el) return;
      el.style.setProperty('--hold', `${secs}s`);
      this.layer.appendChild(el);
      const v = el.querySelector('video');
      if (v) {
        v.currentTime = 0;
        void v.play().catch(() => {});
      }
      this.current.timer = window.setTimeout(() => this.next(), (enter + secs + leave) * 1000);
    };
    const video = el.querySelector('video');
    if (video) {
      // 先读出视频多长再放，读不出来就按图的时间
      const fallback = window.setTimeout(() => start(SKILL_HOLD), 1500);
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(fallback);
        start(Math.min(SKILL_VIDEO_MAX, Math.max(SKILL_HOLD, video.duration - enter || SKILL_HOLD)));
      });
      video.addEventListener('error', () => {
        clearTimeout(fallback);
        start(SKILL_HOLD);
      });
    } else start(c.art ? SKILL_HOLD : hold);
    return true;
  }

  private next(): void {
    this.remove();
    const c = this.queue.shift();
    if (c) this.show(c);
  }

  private remove(): void {
    if (!this.current) return;
    clearTimeout(this.current.timer);
    this.current.el.remove();
    this.current = null;
  }

  clear(): void {
    this.queue = [];
    this.remove();
  }
}
