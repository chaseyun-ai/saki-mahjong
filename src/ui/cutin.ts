import { cutinArt } from '../ui3d/looks';

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

// 正在放的比新来的重要（比如和牌时来了个能力），新来的就不放了
const RANK: Record<CutinKind, number> = { ability: 0, call: 1, kan: 1, riichi: 2, win: 3 };

export interface CutinSpec {
  pos: string; // 座位在画面上的方位：bottom、right、top、left
  id: string; // 角色 id，用来找立绘
  color: string;
  word: string;
  kind: CutinKind;
}

export class Cutins {
  private current: { el: HTMLElement; kind: CutinKind; timer: number } | null = null;

  constructor(private layer: HTMLElement) {}

  // 放一段切入，返回是否真的放了
  show(c: CutinSpec): boolean {
    if (this.current && RANK[this.current.kind] > RANK[c.kind]) return false;
    this.clear();
    const [enter, hold, leave] = TIMING[c.kind];
    const el = document.createElement('div');
    const art = cutinArt(c.id, c.kind);
    el.className = `cutin ${c.pos} ${c.kind}${art.wide ? ' wide' : ''}`;
    el.style.setProperty('--c', c.color);
    el.style.setProperty('--in', `${enter}s`);
    el.style.setProperty('--hold', `${hold}s`);
    el.style.setProperty('--out', `${leave}s`);
    el.innerHTML = `<div class="band"></div><img class="art" src="${art.url}" alt="" onerror="this.remove()" /><div class="word"><span>${c.word}</span></div>`;
    this.layer.appendChild(el);
    const timer = window.setTimeout(() => this.clear(), (enter + hold + leave) * 1000);
    this.current = { el, kind: c.kind, timer };
    return true;
  }

  clear(): void {
    if (!this.current) return;
    clearTimeout(this.current.timer);
    this.current.el.remove();
    this.current = null;
  }
}
