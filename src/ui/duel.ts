// 梅根·达文「决斗」的画面：听牌的对手头上的牛仔帽、决斗开始的正午、对手头像上的转轮和准星、击中的枪响、逃脱。
// 都是 DOM + SVG，三种视角共用

// 四家在画面上的大概位置（百分比）：自己在下，下家在右
const SPOT: Record<string, [number, number]> = { bottom: [50, 78], right: [84, 50], top: [50, 18], left: [16, 50] };

const HAT = `<svg viewBox="0 0 48 30" aria-hidden="true"><path d="M2 22c6 5 38 5 44 0-2-2-7-3-10-3 0-7-2-15-6-15-3 0-3 3-6 3s-3-3-6-3c-4 0-6 8-6 15-3 0-8 1-10 3z" fill="#8a5a2b" stroke="#3a2412" stroke-width="2" stroke-linejoin="round"/><path d="M12 17c6 2 18 2 24 0" fill="none" stroke="#e7c27a" stroke-width="2.4"/></svg>`;

// 她听牌时，听牌的对手头像上戴一顶牛仔帽（只给操作她的玩家看）
export function hatHtml(): string {
  return `<span class="dist tenpai mg-hat" title="决斗者的眼睛：这一家听牌了">${HAT}</span>`;
}

// 决斗的对手头像上：准星和三发的转轮（left：对方还要摸几次，打掉的弹巢是空的）
export function duelMarkHtml(by: string, left: number, steps: number): string {
  let cyl = '';
  for (let i = 0; i < steps; i++) cyl += `<i class="${i < steps - left ? 'spent' : ''}"></i>`;
  return `<span class="mg-mark" title="${by}的决斗：还要摸 ${left} 次牌。这几巡摸不到自己的和了牌，摸来的生张多半是她的和了牌；拆听就能逃"><b></b><em>${cyl}</em></span>`;
}

// 决斗开始：画面压成正午的旧照片色，两家之间拉一条线，中间落下「決闘」
export function duelStart(host: HTMLElement, from: string, to: string): void {
  const [x1, y1] = SPOT[from] ?? SPOT.bottom;
  const [x2, y2] = SPOT[to] ?? SPOT.top;
  const el = document.createElement('div');
  el.className = 'mg-noon';
  el.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" pathLength="100"/></svg><span class="mg-noon-a" style="left:${x1}%;top:${y1}%"></span><span class="mg-noon-b" style="left:${x2}%;top:${y2}%"></span><b>決闘</b>`;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 2400);
}

// 击中：对手座位上一团枪口焰和弹孔
export function duelShot(host: HTMLElement, pos: string): void {
  const [x, y] = SPOT[pos] ?? SPOT.top;
  const el = document.createElement('div');
  el.className = 'mg-shot';
  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
  el.innerHTML = '<i></i><u></u><b>命中</b>';
  host.appendChild(el);
  const flash = document.createElement('div');
  flash.className = 'mg-flash';
  host.appendChild(flash);
  window.setTimeout(() => flash.remove(), 500);
  window.setTimeout(() => el.remove(), 2200);
}

// 逃脱：对手拆了听牌，转轮空转一下
export function duelEscape(host: HTMLElement, pos: string): void {
  const [x, y] = SPOT[pos] ?? SPOT.top;
  const el = document.createElement('div');
  el.className = 'mg-escape';
  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
  el.innerHTML = '<b>逃</b>';
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 1700);
}
