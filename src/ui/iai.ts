import type { SatohaBlade } from '../abilities/satoha';

// 辻垣内智叶「居合」的画面：头像旁竖着的刀（从鞘里推出来几分跟着间合走）、和牌的刀光、断连庄的「斬」。
// 都是 DOM + SVG，三种视角共用

// 「斬」的字形：霞鹜文楷 TC（LXGW WenKai TC）Bold，SIL Open Font License 1.1（和牌面的字同一套字体，见 glyphs.ts）
const ZAN = {
  d: 'M18.1-37.1L25-37.5L25-30.5L18.6-30.2L18.1-37.1ZM32.1-37.7L39.5-38.2L38.9-31L32.1-30.7L32.1-37.7ZM17.4-48.7L25.1-49.2L25.1-43.3L17.8-42.9L17.4-48.7ZM32.2-49.5L40.4-50L39.9-44.1L32.1-43.6L32.2-49.5ZM62.2-41L73.8-41.8L73.6-2Q73.6-0.4 73.5 1.0Q73.4 2.3 73.1 3.7L73.1 3.7Q73 4.1 73.0 4.5Q72.9 4.9 72.9 5.2L72.9 5.2Q72.9 6.9 74.1 8Q75.3 9.1 76.7 9.6Q78 10.1 78.7 10.1L78.7 10.1Q81 10.1 81 6.7L81 6.7L81.1-42.2L94.2-43.1Q97.2-43.3 97.2-45.1L97.2-45.1Q97.2-46.2 96.2-47.5Q95.1-48.7 93.8-49.6Q92.4-50.4 91.3-50.4L91.3-50.4Q90.6-50.4 90.2-50.3L90.2-50.3Q89.2-49.9 88.2-49.8Q87.2-49.6 86.2-49.5L86.2-49.5L62.4-47.8Q62.6-50.1 62.6-53.2Q62.6-56.3 62.6-59.1L62.6-59.1Q69.3-61.4 75.2-64.5Q81.1-67.7 86.8-71.7L86.8-71.7Q88.5-72.8 88.5-74.2L88.5-74.2Q88.5-75.2 87.7-76.7Q86.8-78.2 85.6-79.5Q84.4-80.7 83.2-80.7Q82-80.7 81.4-79.2L81.4-79.2Q80.8-78 78.1-75.5Q75.3-73 71-70.1Q66.7-67.2 61.6-64.9L61.6-64.9Q59.3-66.1 57.8-66.6Q56.2-67.1 55.3-67.1L55.3-67.1Q53.8-67.1 53.8-65.7L53.8-65.7Q53.8-65.3 54.0-64.8Q54.1-64.3 54.2-63.8L54.2-63.8Q54.7-62.5 55-60.5Q55.3-58.5 55.3-53L55.3-53Q55.3-40.5 54.3-31.5Q53.2-22.4 51.4-16L51.4-16Q51.3-15.5 51.2-15.1L51.2-15.1Q51-15.7 50.6-16.4L50.6-16.4Q49.8-17.6 48.6-18.6Q47.4-19.6 46.2-19.6L46.2-19.6Q45.5-19.6 45.1-19.5L45.1-19.5Q43.5-19.1 41.1-18.9L41.1-18.9L32-18.5L32-24.8L44.6-25.3Q45.8-25.4 46.8-25.6Q47.8-25.8 47.8-27L47.8-27Q47.8-27.7 47.3-28.7Q46.7-29.6 45.5-30.7L45.5-30.7L47.5-50.2Q47.6-50.6 47.9-51.2Q48.1-51.7 48.1-52.4L48.1-52.4Q48.1-53.8 46.6-55Q45-56.2 43.2-56.2L43.2-56.2L42.4-56.2L32.2-55.6L32.2-61.3L47.9-62.2Q49-62.3 49.9-62.7Q50.8-63.1 50.8-64.2L50.8-64.2Q50.8-64.8 49.9-66.0Q49-67.1 47.7-68.1Q46.4-69.1 45-69.1L45-69.1Q44.5-69.1 43.9-68.8L43.9-68.8Q42.3-68.1 40.5-68L40.5-68L32.2-67.6L32.3-77.9Q32.3-79.6 30.9-80.6Q29.4-81.6 27.9-82.0Q26.3-82.3 25.4-82.3L25.4-82.3Q23.6-82.3 23.6-80.9L23.6-80.9Q23.6-80.3 24.1-79.5L24.1-79.5Q25.1-77.8 25.1-75.9L25.1-75.9L25.1-67.3L12.5-66.6L11.3-66.6Q9.3-66.6 8.1-67L8.1-67Q7.8-67.1 7.3-67.1L7.3-67.1Q6.2-67.1 6.2-66L6.2-66Q6.2-65.5 6.3-65.2L6.3-65.2Q7.5-61.8 9.1-61.1Q10.6-60.3 12-60.3L12-60.3Q12.5-60.3 13.1-60.4Q13.6-60.4 14.2-60.4L14.2-60.4L25.1-61L25.1-55.2L16.9-54.7Q12.2-56.7 10.7-56.7L10.7-56.7Q9.1-56.7 9.1-55.3L9.1-55.3Q9.1-54.7 9.6-53.3L9.6-53.3Q10-52.4 10.4-50.8Q10.7-49.1 10.8-47.6L10.8-47.6L11.9-31.2Q12-30.6 12-29.9Q12-29.2 12-28.5L12-28.5Q12-27.9 12-27.4Q12-26.9 11.9-26.4L11.9-26.4L11.9-25.7Q11.9-24 13.0-23.0Q14-21.9 15.2-21.4Q16.3-20.9 17-20.9L17-20.9Q18.9-20.9 18.9-23.2L18.9-23.2L18.9-23.5L18.8-24.2L25-24.5L25-18.3L9.4-17.6L8.4-17.6Q6.6-17.6 5.1-18L5.1-18Q4.7-18.1 4.0-18.1Q3.2-18.1 3.2-17.1L3.2-17.1Q3.2-16.3 3.9-14.8Q4.6-13.2 5.9-11.9L5.9-11.9Q6.7-11.1 8.8-11.1L8.8-11.1Q9.3-11.1 9.9-11.2Q10.4-11.2 11.1-11.2L11.1-11.2L25-11.8L25-3.1Q25-1.3 24.9 0Q24.7 1.3 24.4 2.6L24.4 2.6Q24.3 3 24.3 3.6L24.3 3.6Q24.3 5.6 25.6 6.7Q26.9 7.7 28.3 8.2Q29.6 8.6 29.9 8.6L29.9 8.6Q31.9 8.6 31.9 5.7L31.9 5.7L32-12L48.8-12.7Q49.8-12.8 50.6-13.2L50.6-13.2Q50.6-13.2 50.6-13.2L50.6-13.2Q49.2-8.6 47.6-5.2L47.6-5.2Q45.6-0.9 43.5 2.3L43.5 2.3Q42.3 4 42.3 5.3L42.3 5.3Q42.3 6.5 43.4 6.5L43.4 6.5Q44.3 6.5 45.7 5.2L45.7 5.2L46.2 4.7Q50.6 0.4 53.5-5.0Q56.3-10.3 58-15.8Q59.7-21.3 60.6-26.4Q61.4-31.4 61.8-35.4Q62.1-39.4 62.2-41L62.2-41Z',
  box: [3.2, -82.3, 97.2, 10.1],
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
const STAGE_NAMES = ['收在鞘里', '推镡一寸', '出鞘三分', '刀已出鞘'];
// 刀从鞘里推出来多少（viewBox 里的长度）：收着、拇指把刀镡推开一寸、三分；立直以后鞘退掉，刀再提起一点
export const IAI_DRAWN = [0, 10, 30, 40];
// 推出来、收回去那一下走多久（毫秒）
export const IAI_PUSH_MS = 1100;

// 头像旁竖着的刀，刀柄朝上。只给操作她的玩家看：别人离听牌越近，刀从鞘里推出来越多；鞘里听着牌、拔得了刀时刀镡亮起来；
// 立直以后刀出鞘：鞘往下退掉，露出刀身。不画整把刀：鞘（出鞘后是刀身）往下淡掉。
// move：刚换了档位——从哪儿推到现在的位置、已经走了多久。画面每次重画都是新的节点，动画靠这个接着放
export function bladeHtml(b: SatohaBlade, tenpai: boolean, renchan: boolean, move?: { from: number; elapsed: number }): string {
  const bare = b.stage === 3;
  const to = IAI_DRAWN[b.stage];
  const label = bare ? '立直了，没有加成' : b.off ? '被封住了' : tenpai ? (b.ready ? `摸到和了牌 ${pct(b.chance)}` : '没有役，拔不了刀') : `进张 +${pct(b.chance)}`;
  const near = b.gap <= 0 ? '有人听牌' : b.gap === 1 ? '有人一向听' : '还没人逼近';
  const what = b.off ? '被封住了：进张、拔刀不起作用' : tenpai ? (b.ready ? `听牌没立直：每次摸牌有 ${pct(b.chance)} 的概率摸到和了牌` : '听牌没立直，但没有役，拔不了刀') : `没听牌：进张 +${pct(b.chance)}`;
  const title = bare ? '立直了：刀已出鞘，藏不住，也没有进张、拔刀的加成' : `间合：${near}${renchan ? '（庄家在连庄，少算一步）' : ''}。${what}`;
  const cls = `iai-blade s${b.stage}${move ? ' moving' : ''}${b.ready && !b.off ? ' ready' : ''}${b.off ? ' off' : ''}${b.ready && b.stage === 2 && !b.off ? ' strike' : ''}`;
  const go = move ? ` go${to > move.from ? ' out' : ''}` : '';
  const vars = `--to:${-to}px${move ? `;--from:${-move.from}px;--skip:${-Math.round(move.elapsed)}ms` : ''}`;
  // 刀柄的柄卷：一格一格的菱形
  let ito = '';
  for (let y = 76; y < 124; y += 8) ito += `M23 ${y} L37 ${y + 8} M37 ${y} L23 ${y + 8} `;
  return `<div class="${cls}" style="${vars}" title="${title}">
    <svg class="iai-sword" viewBox="0 0 60 260" aria-hidden="true">
      <defs>
        <linearGradient id="iai-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7f8a99"/><stop offset="0.3" stop-color="#f6f9fc"/><stop offset="0.56" stop-color="#c5cdd8"/><stop offset="0.6" stop-color="#8a94a3"/><stop offset="1" stop-color="#e9eef4"/></linearGradient>
        <linearGradient id="iai-lac" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a0a10"/><stop offset="0.28" stop-color="#b53a45"/><stop offset="0.55" stop-color="#6a151d"/><stop offset="1" stop-color="#2a060b"/></linearGradient>
        <linearGradient id="iai-fade-g" gradientUnits="userSpaceOnUse" x1="0" y1="188" x2="0" y2="257"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
        <linearGradient id="iai-hide-g" gradientUnits="userSpaceOnUse" x1="0" y1="176" x2="0" y2="190"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
        <mask id="iai-fade" maskUnits="userSpaceOnUse" x="0" y="0" width="60" height="260"><rect width="60" height="260" fill="url(#iai-fade-g)"/></mask>
        <mask id="iai-hide" maskUnits="userSpaceOnUse" x="0" y="0" width="60" height="260"><rect width="60" height="260" fill="url(#iai-hide-g)"/></mask>
      </defs>
      <g mask="url(#iai-hide)"><g class="iai-move${go}">
        <path class="iai-steel" d="M25 141 L35 141 L35 207 L25 207 Z" fill="url(#iai-steel)"/>
        <path class="iai-hamon" d="M34 141 q-1.8 4 0 8 q-1.8 4 0 8 q-1.8 4 0 8 q-1.8 4 0 8 q-1.8 4 0 8 q-1.8 4 0 8 q-1.8 4 0 8 q-1.8 4 0 8" stroke="rgba(255,255,255,0.75)" stroke-width="0.7" fill="none"/>
        <path class="iai-shine" d="M27.4 143 L27.4 205" stroke="#fff" stroke-width="1.2" stroke-linecap="round" fill="none"/>
      </g></g>
      <g class="iai-saya" mask="url(#iai-fade)">
        <path d="M21 137 L39 137 L39 196 Q39 232 35 260 L19.5 260 Q23 232 21 196 Z" fill="url(#iai-lac)" stroke="rgba(255,255,255,0.28)" stroke-width="0.7"/>
        <path d="M25.4 144 L25.4 198 Q26 228 24.4 252" stroke="rgba(255,255,255,0.42)" stroke-width="1.1" stroke-linecap="round" fill="none"/>
        <rect x="20.3" y="136.4" width="19.4" height="6" rx="1.3" fill="#1c1a22" stroke="rgba(255,255,255,0.35)" stroke-width="0.6"/>
        <rect x="38.4" y="158" width="4.6" height="9.5" rx="1.6" fill="#1c1a22" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>
        <path d="M41 160.5 q7 3 3.4 10 q-2.6 5 -8 4.4 M41 164.5 q6 6 1 12" stroke="#7a68b8" stroke-width="1.6" stroke-linecap="round" fill="none"/>
      </g>
      <g class="iai-bare" mask="url(#iai-fade)"><g class="iai-move${go}">
        <path d="M25 141 L35 141 L35 236 Q35 272 31.5 300 L22.5 300 Q25.5 272 25 236 Z" fill="url(#iai-steel)"/>
        <path d="M34 141 L34 236 Q34 272 30.8 300" stroke="rgba(255,255,255,0.7)" stroke-width="0.7" fill="none"/>
        <path class="iai-shine" d="M27.4 143 L27.4 236 Q27.6 262 26 284" stroke="#fff" stroke-width="1.2" stroke-linecap="round" fill="none"/>
      </g></g>
      <g class="iai-move${go}">
        <rect class="iai-habaki" x="24" y="134.6" width="12" height="7" rx="0.8" fill="#dcbb62" stroke="rgba(0,0,0,0.35)" stroke-width="0.4"/>
        <rect class="iai-tsuka" x="23" y="74" width="14" height="54" rx="2.4" fill="#2f2a45" stroke="rgba(255,255,255,0.4)" stroke-width="0.7"/>
        <path class="iai-ito" d="${ito}" stroke="#d6c8f0" stroke-width="1.1" fill="none"/>
        <rect x="22.4" y="68.6" width="15.2" height="7.4" rx="2.8" fill="#b9a26a" stroke="rgba(0,0,0,0.4)" stroke-width="0.5"/>
        <rect x="22.4" y="125.2" width="15.2" height="5.2" rx="1" fill="#b9a26a" stroke="rgba(0,0,0,0.4)" stroke-width="0.5"/>
        <ellipse class="iai-tsuba" cx="30" cy="132.6" rx="18" ry="4.6" fill="#b9a26a" stroke="rgba(0,0,0,0.45)" stroke-width="0.6"/>
        <path class="iai-glint" d="M30 127 L31.4 136.6 L41 138 L31.4 139.4 L30 149 L28.6 139.4 L19 138 L28.6 136.6 Z" fill="#fff"/>
      </g>
    </svg>
    <span class="iai-text"><b>${STAGE_NAMES[b.stage]}</b><span>${label}</span></span>
  </div>`;
}

// 四家在画面上的大概位置（百分比）：自己在下，下家在右
const SPOT: Record<string, [number, number]> = { bottom: [50, 82], right: [86, 50], top: [50, 16], left: [14, 50] };

// 和牌的刀光。先暗一下（IAI_WINDUP_MS），再一道白光切过画面，刀口留一会儿才淡掉。
// 荣和时从她切向放铳的人（to 是放铳的人的位置），自摸时横切另外三家（to 是 null）。
// 刀划完那一下画面沿刀口晃一晃。host 是不跟着牌局重画的那一层
export const IAI_WINDUP_MS = 320;
const IAI_STROKE_MS = 240;
// 整段刀光放完要多久
export const IAI_SLASH_ALL_MS = 1700;
export function iaiSlash(host: HTMLElement, from: string, to: string | null): void {
  const a = SPOT[from] ?? SPOT.bottom;
  let cx = 50;
  let cy = 50;
  let deg: number;
  if (to && SPOT[to]) {
    const b = SPOT[to];
    cx = (a[0] + b[0]) / 2;
    cy = (a[1] + b[1]) / 2;
    // 画面不是正方的，按 16:9 估角度就够了
    deg = (Math.atan2((b[1] - a[1]) * 9, (b[0] - a[0]) * 16) * 180) / Math.PI;
  } else {
    // 自摸：垂直于她看出去的方向，略斜一点
    deg = (from === 'left' || from === 'right' ? 90 : 0) - 9;
    cx = 50 + (50 - a[0]) * 0.12;
    cy = 50 + (50 - a[1]) * 0.12;
  }
  const el = document.createElement('div');
  el.className = 'iai-fx';
  el.innerHTML = `<i class="iai-dim"></i><i class="iai-flash"></i><i class="iai-slash" style="left:${cx}%;top:${cy}%;transform:rotate(${deg}deg)"><b></b></i>`;
  host.appendChild(el);
  host.style.setProperty('--iai-deg', `${deg}deg`);
  window.setTimeout(() => host.classList.add('iai-jolt'), IAI_WINDUP_MS + IAI_STROKE_MS);
  window.setTimeout(() => host.classList.remove('iai-jolt'), IAI_WINDUP_MS + IAI_STROKE_MS + 340);
  window.setTimeout(() => el.remove(), IAI_SLASH_ALL_MS + 60);
}

// 她和牌结束了别人的连庄：牌桌中央一个毛笔字「斬」，一道刀口切过字，下面一行小字写断的是谁的连庄
export const IAI_ZAN_ALL_MS = 2700;
export function zanFx(host: HTMLElement, dealerName: string): void {
  const [x1, y1, x2, y2] = ZAN.box;
  const pad = 8;
  const el = document.createElement('div');
  el.className = 'iai-zan';
  el.innerHTML = `<div class="iai-zan-in"><svg viewBox="${x1 - pad} ${y1 - pad} ${x2 - x1 + pad * 2} ${y2 - y1 + pad * 2}" aria-label="斬"><path d="${ZAN.d}"/></svg><i class="iai-zan-cut"></i><span>${dealerName} 的连庄到此为止</span></div>`;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), IAI_ZAN_ALL_MS + 60);
}
