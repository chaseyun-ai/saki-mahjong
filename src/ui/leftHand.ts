// 真屋由晖子「左手」的画面：换左手摸牌的那一局开头，她身后亮起一个光的十字，飘出一句经文；
// 左手的局和牌时，十字再亮一次，光从她的座位铺满整张桌子。都是 DOM + SVG，三种视角共用

// 四家在画面上的大概位置（百分比）：自己在下，下家在右
const SPOT: Record<string, [number, number]> = { bottom: [50, 76], right: [82, 48], top: [50, 28], left: [18, 48] };

// 十字（viewBox 0 0 60 90）：竖长横短，四个端头略微张开
const CROSS = `<svg viewBox="0 0 60 90" aria-hidden="true"><path d="M26 2h8l1 22h21l2 4v4l-2 4H35l-1 52h-8l-1-52H4l-2-4v-4l2-4h21z"/></svg>`;

function rays(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += `<u style="--r:${(360 / n) * i}deg;animation-delay:${(i % 4) * 60}ms"></u>`;
  return out;
}

// 开局：她身后亮起十字，一圈光往外放，经文一个字一个字浮出来
export function leftHandCross(host: HTMLElement, pos: string, verse: string, ref: string): void {
  const [x, y] = SPOT[pos] ?? SPOT.bottom;
  const el = document.createElement('div');
  el.className = `lh-cross at-${pos}`;
  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
  const chars = [...verse].map((ch, i) => `<span style="animation-delay:${600 + i * 45}ms">${ch}</span>`).join('');
  el.innerHTML = `<div class="lh-glow">${rays(12)}${CROSS}</div><p class="lh-verse">${chars}<cite>${ref}</cite></p><b class="lh-word">左手</b>`;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 4200);
}

// 左手的局和牌：十字再亮一次，光从她的座位铺满整张桌子
export function leftHandWin(host: HTMLElement, pos: string): void {
  const [x, y] = SPOT[pos] ?? SPOT.bottom;
  const el = document.createElement('div');
  el.className = 'lh-win';
  el.style.setProperty('--x', `${x}%`);
  el.style.setProperty('--y', `${y}%`);
  el.innerHTML = `<div class="lh-glow" style="left:${x}%;top:${y}%">${rays(16)}${CROSS}</div>`;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 2400);
}
