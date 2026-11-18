// 真屋由晖子「左手」的画面：换左手的时候，她座位上亮起腓尼基字母 𐤄（「窗」）；
// 左手的局和牌时，𐤄 再亮一次，光从她的座位铺满整张桌子。都是 DOM + SVG，三种视角共用。
// 技能按钮也画成这个字母（字体里多半没有腓尼基文字，所以用 SVG 画）

// 四家在画面上的大概位置（百分比）：自己在下，下家在右
const SPOT: Record<string, [number, number]> = { bottom: [50, 72], right: [82, 48], top: [50, 28], left: [18, 48] };

// 𐤄（viewBox 0 0 60 90）：右边一竖往下拖长，向左伸出三横，横画略往左下斜
const HE_PATH = 'M42 6V86M42 9L13 16M42 31L15 38M42 53L17 60';
export const HE_SVG = `<svg class="he-glyph" viewBox="0 0 60 90" aria-hidden="true"><path d="${HE_PATH}"/></svg>`;

function rays(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += `<u style="--r:${(360 / n) * i}deg;animation-delay:${(i % 4) * 60}ms"></u>`;
  return out;
}

// 换左手：她座位上亮起 𐤄，一圈光往外放
export function leftHandSign(host: HTMLElement, pos: string): void {
  const [x, y] = SPOT[pos] ?? SPOT.bottom;
  const el = document.createElement('div');
  el.className = `lh-sign at-${pos}`;
  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
  el.innerHTML = `<div class="lh-glow">${rays(12)}${HE_SVG}</div><b class="lh-word">左手</b>`;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 3600);
}

// 左手的局和牌：𐤄 再亮一次，光从她的座位铺满整张桌子
export function leftHandWin(host: HTMLElement, pos: string): void {
  const [x, y] = SPOT[pos] ?? SPOT.bottom;
  const el = document.createElement('div');
  el.className = 'lh-win';
  el.style.setProperty('--x', `${x}%`);
  el.style.setProperty('--y', `${y}%`);
  el.innerHTML = `<div class="lh-glow" style="left:${x}%;top:${y}%">${rays(16)}${HE_SVG}</div>`;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 2400);
}
