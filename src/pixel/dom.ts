// 像素皮肤用的 SVG 滤镜：一块块取色（每块取正中一点的颜色铺满整块），头像、立绘看起来就是一格格的像素。
// 做法：每 N×N 一块只留正中一个像素（feFlood + feTile 做出一张点阵当遮罩），再往四周膨胀 N/2 格（feMorphology）把整块填满。
// （主页的图不用这个：图是现做成像素画的，见 pixelate.ts）
// 只在 <body> 上挂一次，pixel.css 里用 filter: url('#px-blocks') 引用

const FILTERS: [id: string, n: number][] = [
  // 头像、立绘：5 个 CSS 像素一块
  ['px-blocks', 5],
];

export function installPixelDefs(): void {
  if (typeof document === 'undefined' || document.getElementById('px-defs')) return;
  const half = (n: number) => Math.floor(n / 2);
  const svg = `<svg id="px-defs" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false"><defs>${FILTERS.map(
    ([id, n]) =>
      `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feFlood x="${half(n)}" y="${half(n)}" width="1" height="1"/><feComposite width="${n}" height="${n}"/><feTile result="a"/><feComposite in="SourceGraphic" in2="a" operator="in"/><feMorphology operator="dilate" radius="${half(n)}"/></filter>`,
  ).join('')}</defs></svg>`;
  document.body.insertAdjacentHTML('beforeend', svg);
}
