// 雀明华「风神」的画面：开局她座位上吹起的一阵风（带自风的字）、头像旁飘着的音符、断风、唱着歌和牌时吹过整张桌子的风。
// 都是 DOM + SVG，三种视角共用

// 四家在画面上的大概位置（百分比）：自己在下，下家在右
const SPOT: Record<string, [number, number]> = { bottom: [50, 80], right: [84, 50], top: [50, 18], left: [16, 50] };
const WIND_CHAR = ['東', '南', '西', '北'];
const STAGE = ['', '一', '二', '三'];

// 几道弯弯的风丝（viewBox 0 0 300 160），一道接一道划过去
const STREAKS = [
  'M10 96 C70 40 150 46 196 78 S262 120 292 70',
  'M4 62 C60 22 132 20 176 44 S236 84 284 40',
  'M22 126 C86 84 150 88 204 108 S266 132 296 104',
  'M40 40 C92 8 150 10 190 26',
  'M60 146 C120 120 176 122 232 138',
];

function streaksSvg(): string {
  return `<svg viewBox="0 0 300 160" aria-hidden="true">${STREAKS.map((d, i) => `<path d="${d}" pathLength="100" style="animation-delay:${i * 90}ms"/>`).join('')}</svg>`;
}

// 开局起风：她座位上一阵青白色的风，风里浮出这一局自风的字，旁边小一号的是这一局还收的风（场风、南场的客风）。
// level 是歌唱到第几段（唱着的局风更大）
export function fuujinBreeze(host: HTMLElement, pos: string, wind: number, level: number, more: number[] = []): void {
  const [x, y] = SPOT[pos] ?? SPOT.bottom;
  const el = document.createElement('div');
  el.className = `fj-breeze l${level}`;
  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
  el.innerHTML = `${streaksSvg()}<b>${WIND_CHAR[wind] ?? ''}${more.length ? `<small>${more.map((k) => WIND_CHAR[k] ?? '').join('')}</small>` : ''}</b>`;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 2100);
}

// 断风：那一家座位上的风被一道横线截断，散掉
export function fuujinCut(host: HTMLElement, pos: string): void {
  const [x, y] = SPOT[pos] ?? SPOT.bottom;
  const el = document.createElement('div');
  el.className = 'fj-cutfx';
  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
  el.innerHTML = `${streaksSvg()}<i></i><b>無風</b>`;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 2300);
}

// 唱着歌和牌：一阵风从她的座位吹过整张桌子，带着几片花瓣
export function fuujinGust(host: HTMLElement, pos: string): void {
  const deg = { bottom: -90, right: 180, top: 90, left: 0 }[pos] ?? -90;
  const el = document.createElement('div');
  el.className = 'fj-gust';
  let petals = '';
  for (let i = 0; i < 14; i++) {
    const top = 8 + ((i * 37) % 84);
    petals += `<u style="top:${top}%;animation-delay:${(i * 53) % 600}ms;--r:${(i * 67) % 360}deg;--s:${0.7 + ((i * 29) % 60) / 100}"></u>`;
  }
  el.innerHTML = `<div class="fj-gust-in" style="transform:rotate(${deg}deg)">${streaksSvg()}${streaksSvg()}${petals}</div>`;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 2000);
}

// 头像旁的音符：歌唱到第几段就飘几组。skip：动画已经放了多久（画面每次重画都是新的节点，靠它接着放）
export function songHtml(level: number, skip: number, note: string): string {
  if (level <= 0) return '';
  const marks = ['♪', '♫', '♩', '♬'];
  let notes = '';
  for (let i = 0; i <= level; i++) notes += `<i style="--i:${i};animation-delay:${-Math.round(skip + i * 800)}ms">${marks[i % marks.length]}</i>`;
  return `<span class="fj-song l${level}" title="${note}"><em>歌·${STAGE[level]}</em>${notes}</span>`;
}

// 被断风的那一家头像上的小牌子
export function cutTagHtml(): string {
  return '<span class="fj-cut" title="被雀明华断风：这一局配牌里没有风牌，也摸不到">無風</span>';
}
