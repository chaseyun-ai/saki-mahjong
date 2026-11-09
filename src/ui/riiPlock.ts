import type { PlockStyleId } from './riiLook';
import { padlockSvg } from './riiPadlock';

// 白水哩缚上以后头像上挂的锁，几种样子（试看用，挑好以后留一种）：
// 锁徽（角上一枚圆章）、锁链框（方链绕头像一圈，侧边扣一把锁）、交叉锁链（两道方链交叉，交叉处一把锁）、
// 缚印（朱红方印「缚」）、光锁（头像一圈淡蓝的光，挂一把光做的锁）。
// 大锁飞过来时落在 .rpl-lock 上（app.ts 量它的位置）；结算时的开锁变金 / 碎掉（没和成、番数不够）在 style.css 的 .rii-plock.key / .broken

export type PlockPlace = 'seat' | 'net' | 'plate'; // 头像框、网络对战的头像卡、2D 的名牌
export type PlockEnd = 'key' | 'broken';

// 头像里面多大（去掉边框），按这个比例画，不变形
const BOX: Record<PlockPlace, { w: number; h: number; r: number; border: number }> = {
  seat: { w: 96, h: 117, r: 10, border: 2 },
  net: { w: 88, h: 116, r: 3, border: 2 },
  plate: { w: 36, h: 36, r: 18, border: 0 },
};

const HAN = '一二三四五六七八九十';
const f = (v: number) => (Math.round(v * 100) / 100).toString();
let uid = 0;

// 沿着一条路画方形锁链：正面的链环（中间一道方孔）和侧面的链环一个隔一个，互相扣着。
// len 是这条路多长，pitch 大概一节多长（会凑成整数节，闭合的路接头不错位），w 链环多宽
function chainAlong(d: string, len: number, pitch: number, w: number): string {
  const n = Math.max(1, Math.round(len / pitch));
  const p = len / n;
  const face = p * 0.62;
  const wall = w * 0.3;
  const edge = p * 0.52;
  const ew = w * 0.42;
  const at = face - p * 0.07; // 侧面的链环从哪里起，两头各压进正面的链环一点
  const seg = (cls: string, width: number, on: number, start: number, extra = '') =>
    `<path d="${d}" class="${cls}" stroke-width="${f(width)}" stroke-dasharray="${f(on)} ${f(p - on)}" stroke-dashoffset="${f(-start)}"${extra}/>`;
  return `<g class="rpl-links" fill="none">
    ${seg('ck-shade', w + 2.4, face + 1.2, -0.6, ' transform="translate(0 1.4)"')}
    ${seg('ck-out', w + 1.4, face + 0.9, -0.45)}
    ${seg('ck-face', w, face, 0)}
    ${seg('ck-lit', w * 0.62, face - wall * 0.6, wall * 0.3)}
    ${seg('ck-hole', w - 2 * wall, face - 2 * wall, wall)}
    ${seg('ck-out', ew + 1.4, edge + 0.9, at - 0.45)}
    ${seg('ck-edge', ew, edge, at)}
    ${seg('ck-lit', ew * 0.42, edge - 1, at + 0.5)}
  </g>`;
}

// 圆角方框（从上边中间起笔，接头在看不出来的地方），返回路径和周长
function roundRect(x: number, y: number, w: number, h: number, r: number): { d: string; len: number } {
  r = Math.min(r, w / 2, h / 2);
  const d = `M${f(x + w / 2)} ${f(y)} H${f(x + w - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)} V${f(y + h - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)} H${f(x + r)} A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y + h - r)} V${f(y + r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)} Z`;
  return { d, len: 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r };
}

// 锁链框：方链绕头像一圈，压在头像的边框上
function frameDeco(place: PlockPlace): string {
  const b = BOX[place];
  const pad = place === 'plate' ? 4 : 6;
  const w = place === 'plate' ? 3.4 : 6;
  const c = b.border / 2;
  const rr = roundRect(pad - c, pad - c, b.w + 2 * c, b.h + 2 * c, b.r + c);
  return `<span class="rpl-deco" style="inset:-${pad}px"><svg viewBox="0 0 ${b.w + 2 * pad} ${b.h + 2 * pad}" aria-hidden="true">${chainAlong(rr.d, rr.len, place === 'plate' ? 6 : 10.5, w)}</svg></span>`;
}

// 交叉锁链：两道方链从头像的四个角斜着交叉过去
function crossDeco(place: PlockPlace): string {
  const b = BOX[place];
  const w = place === 'plate' ? 3.6 : 7.5;
  const pitch = place === 'plate' ? 6.5 : 12.5;
  const line = (x1: number, y1: number, x2: number, y2: number) => chainAlong(`M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)}`, Math.hypot(x2 - x1, y2 - y1), pitch, w);
  const t = b.h * 0.16;
  return `<span class="rpl-deco"><svg viewBox="0 0 ${b.w} ${b.h}" aria-hidden="true"><g class="rpl-x a">${line(-6, t, b.w + 6, b.h - t)}</g><g class="rpl-x b">${line(-6, b.h - t, b.w + 6, t)}</g></svg></span>`;
}

// 光锁：头像一圈淡蓝的光
function glowDeco(): string {
  return `<span class="rpl-deco"><i class="rpl-glow"></i></span>`;
}

// 锁徽：深色圆章，银边，中间一把小锁，下面一块小牌写缚几番
function badgeSvg(n: number): string {
  const id = `rpb${uid++}`;
  return `<svg class="rii-lock-svg badge-svg" viewBox="0 0 100 124" aria-hidden="true">
    <defs>
      <linearGradient id="${id}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="s1"/><stop offset=".55" class="s2"/><stop offset="1" class="s3"/></linearGradient>
      <radialGradient id="${id}d" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#34405a"/><stop offset="1" stop-color="#0b0f18"/></radialGradient>
    </defs>
    <circle cx="50" cy="50" r="45" fill="url(#${id}d)" stroke="url(#${id}r)" stroke-width="6"/>
    <circle cx="50" cy="50" r="37" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1.5"/>
    <g class="shackle"><path d="M39 50 V40 a11 11 0 0 1 22 0 V50" fill="none" stroke="url(#${id}r)" stroke-width="6.5" stroke-linecap="round"/></g>
    <rect x="30" y="46" width="40" height="30" rx="6" fill="url(#${id}r)"/>
    <rect x="33" y="49" width="34" height="3" rx="1.5" fill="rgba(255,255,255,.45)"/>
    <circle cx="50" cy="58.5" r="4" class="hole"/><path d="M47.8 60 h4.4 l-1 8 h-2.4 z" class="hole"/>
    ${n > 0 ? `<rect x="24" y="96" width="52" height="25" rx="12.5" class="tag"/><text x="50" y="114.5" text-anchor="middle" class="tag-text">缚${HAN[n - 1] ?? n}</text>` : ''}
  </svg>`;
}

// 缚印：朱红方印，白字「缚」，下面小字几番；边上有点斑驳
function sealSvg(n: number): string {
  const id = `rps${uid++}`;
  return `<svg class="rii-lock-svg seal-svg" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <filter id="${id}" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.75" result="m"/>
        <feComposite in="SourceGraphic" in2="m" operator="in" result="ink"/>
        <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="1" seed="3" result="w"/>
        <feDisplacementMap in="ink" in2="w" scale="3"/>
      </filter>
    </defs>
    <g filter="url(#${id})">
      <rect x="5" y="5" width="90" height="90" rx="7" class="seal"/>
      <rect x="12" y="12" width="76" height="76" rx="3" class="seal-line" stroke-width="3"/>
      <text x="50" y="${n > 0 ? 61 : 68}" text-anchor="middle" class="seal-ink seal-big">缚</text>
      ${n > 0 ? `<text x="50" y="82" text-anchor="middle" class="seal-ink seal-small">${HAN[n - 1] ?? n}番</text>` : ''}
    </g>
    <path class="crack" d="M58 4 L50 30 L60 46 L44 70 L52 96" fill="none" stroke-width="3"/>
  </svg>`;
}

// 光锁：只有轮廓的锁，淡蓝发光
function glowLockSvg(): string {
  return `<svg class="rii-lock-svg glow-svg" viewBox="0 0 100 120" aria-hidden="true">
    <g class="shackle"><path d="M29 58 V36 a21 21 0 0 1 42 0 V58" fill="none" class="gl-line" stroke-width="9" stroke-linecap="round"/></g>
    <rect x="13" y="54" width="74" height="58" rx="12" class="gl-body gl-line" stroke-width="6"/>
    <circle cx="50" cy="79" r="7.5" class="gl-dot"/><path d="M46 81 h8 l-2 13 h-4 z" class="gl-dot"/>
  </svg>`;
}

// 头像上的锁整个的 HTML。d：锁飞到的时候（从现在算，秒，过了是负的）；e：结算开始
export function plockHtml(style: PlockStyleId, place: PlockPlace, n: number, end: PlockEnd | null, d: number, e: number): string {
  const deco = style === 'frame' ? frameDeco(place) : style === 'cross' ? crossDeco(place) : style === 'glow' ? glowDeco() : '';
  const lock = style === 'badge' ? badgeSvg(place === 'plate' ? 0 : n) : style === 'seal' ? sealSvg(place === 'plate' ? 0 : n) : style === 'glow' ? glowLockSvg() : padlockSvg();
  return `<span class="rii-plock pl-${style} at-${place}${end ? ` ${end}` : ''}" style="--d:${d.toFixed(3)}s;--e:${e.toFixed(3)}s">${deco}<span class="rpl-lock"><span class="rpl-in">${lock}</span></span></span>`;
}
