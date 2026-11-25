import { BLOCK, BLOCK_COLORS, feltTexture16, pixelCanvas, plankTexture, stoneTexture } from './blocks';

// 像素皮肤开页面时挂一次的东西：
// 1. SVG 滤镜：一块块取色（每块取正中一点的颜色铺满整块），头像、立绘看起来就是一格格的像素。
//    做法：每 N×N 一块只留正中一个像素（feFlood + feTile 做出一张点阵当遮罩），再往四周膨胀 N/2 格（feMorphology）把整块填满。
//    （主页的图不用这个：图是现做成像素画的，见 pixelate.ts）pixel.css 里用 filter: url('#px-blocks') 引用
// 2. 方块小图：和 3D 牌桌同一套 16×16 的图（blocks.ts），做成 data: 网址放进 CSS 变量 --px-tex-*，按钮、面板、2D 桌布拿来铺

const FILTERS: [id: string, n: number][] = [
  // 头像、立绘：6 个 CSS 像素一块
  ['px-blocks', 6],
];

export function installPixelDefs(): void {
  if (typeof document === 'undefined' || document.getElementById('px-defs')) return;
  const half = (n: number) => Math.floor(n / 2);
  const svg = `<svg id="px-defs" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false"><defs>${FILTERS.map(
    ([id, n]) =>
      `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feFlood x="${half(n)}" y="${half(n)}" width="1" height="1"/><feComposite width="${n}" height="${n}"/><feTile result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/><feMorphology operator="dilate" radius="${half(n)}"/></filter>`,
  ).join('')}</defs></svg>`;
  document.body.insertAdjacentHTML('beforeend', svg);
  const tex: [string, Uint32Array][] = [
    ['stone', stoneTexture('#7d7a75', 61, 0.25)],
    // 乘在按钮底色上的颗粒：几乎白的石头，乘上去只多一点深浅
    ['grain', stoneTexture('#f2f1ee', 71, 0.14)],
    // 深色面板（结算、2D 中间那块）：字写在上面，颗粒很淡
    ['stone-dark', stoneTexture(BLOCK_COLORS.stoneDark, 67, 0.14)],
    ['plank', plankTexture(BLOCK_COLORS.plank)],
    ['plank-dark', plankTexture(BLOCK_COLORS.plankDark, 29)],
    ['felt', feltTexture16(BLOCK_COLORS.felt)],
  ];
  const root = document.documentElement.style;
  for (const [name, px] of tex) {
    try {
      root.setProperty(`--px-tex-${name}`, `url(${pixelCanvas(px, BLOCK, BLOCK).toDataURL('image/png')})`);
    } catch {
      // 画不出来（没有画布）就不铺图，CSS 里都有底色
    }
  }
}
